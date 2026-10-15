#!/usr/bin/env node
/**
 * Look proofs: renders the per-level look system (season print, light, signature cartography, atmosphere) in Node
 * through a software canvas, with TEMPORARY look / season overrides injected here (level files are not touched).
 *
 *   node tools/look-preview.mjs [--only name,name] [--sheets] [--frames] [--crops] [--browser-perf] [--scale 3] [--out out/look]
 *
 * --browser-perf bakes each dressed sheet in headless Chromium (tools/render-preview.html) and times draw() with the
 * weather on, by day, dusk and night, plus the same level without its look for comparison.
 *
 * Writes out/look/sheet-<demo>.png (whole sheet, 1 px = 1 px), crop-<demo>-<what>.png (2x crops of each signature),
 * play-<demo>-<shot>.png (in-game frames, 3x) and prints bake timings and the palette audit (every frame and every
 * sheet must be strictly in the 35-colour palette).
 */
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { installSoftCanvas, SoftCanvas, encodePNG } from './lib/softcanvas.js';

installSoftCanvas();
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { LEVELS } = await import('../src/world/levels/index.js');
const { buildWorld } = await import('../src/world/terrain.js');
const { COVER, CELL_PX, dayPhase, phaseCentres, phaseBounds } = await import('../src/world/codes.js');
const { bakeMap, bakeOverview } = await import('../src/render/mapbake.js');
const { createRenderer } = await import('../src/render/renderer.js');
const { PAL_U32_LIST } = await import('../src/render/palette.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(root, opt('out', 'out/look'));
const ONLY = (opt('only', '') || '').split(',').filter(Boolean);
const SCALE = +opt('scale', 3);
const BROWSER_PERF = args.includes('--browser-perf');
const anyMode = args.includes('--sheets') || args.includes('--frames') || args.includes('--crops') || BROWSER_PERF;
const DO_SHEETS = !anyMode || args.includes('--sheets');
const DO_CROPS = !anyMode || args.includes('--crops');
const DO_FRAMES = !anyMode || args.includes('--frames');
fs.mkdirSync(OUT, { recursive: true });

const PAL_SET = new Set(PAL_U32_LIST.map((u) => u >>> 0));
let badTotal = 0;
function audit(name, u32) {
  const bad = new Set();
  for (let i = 0; i < u32.length; i++) if (!PAL_SET.has(u32[i] >>> 0)) bad.add((u32[i] >>> 0).toString(16));
  if (bad.size) { badTotal += bad.size; console.log('  OFF-PALETTE', name, [...bad].slice(0, 6).join(' ')); }
}
function savePNG(name, w, h, rgba, scale = 1) {
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, encodePNG(w, h, rgba, scale, deflateSync));
  console.log('  wrote', path.relative(root, f));
}
function crop(pixels, W, x, y, w, h) {
  const out = new Uint32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = Math.min(W - 1, Math.max(0, x + i)), Y = Math.min(W - 1, Math.max(0, y + j));
    out[j * w + i] = pixels[Y * W + X];
  }
  return out;
}

// ----------------------------------------------------------------------------------- placement helpers
const isWater = (c) => c === COVER.SHALLOW || c === COVER.DEEP;
function comps(w) {
  const N = w.size, comp = new Int32Array(N * N).fill(-1), list = [];
  for (let s = 0; s < N * N; s++) {
    if (comp[s] >= 0 || !isWater(w.cover[s])) continue;
    const id = list.length, cells = [s]; comp[s] = id; let edge = false;
    for (let k = 0; k < cells.length; k++) {
      const i = cells[k], x = i % N, y = (i / N) | 0;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) edge = true;
      for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) if (j >= 0 && comp[j] < 0 && isWater(w.cover[j])) { comp[j] = id; cells.push(j); }
    }
    list.push({ id, cells, edge, size: cells.length });
  }
  return { comp, list };
}
function landDist(w, cap = 30) {
  const N = w.size, d = new Uint8Array(N * N).fill(255), q = [];
  for (let i = 0; i < N * N; i++) if (!isWater(w.cover[i])) { d[i] = 0; q.push(i); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % N, y = (i / N) | 0, nd = d[i] + 1;
    if (nd > cap) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) if (j >= 0 && d[j] > nd) { d[j] = nd; q.push(j); }
  }
  return d;
}
/** least-effort route between two cells (Dijkstra on slope + water), subsampled to a polyline */
function route(w, a, b, every = 6) {
  const N = w.size, h = w.height, dist = new Float32Array(N * N).fill(Infinity), prev = new Int32Array(N * N).fill(-1);
  const heap = [];
  const push = (i, d) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const s = a[1] * N + a[0], t = b[1] * N + b[0];
  dist[s] = 0; push(s, 0);
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (i === t) break;
    const x = i % N, y = (i / N) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx, step = dx && dy ? 1.414 : 1;
      const dh = Math.abs(h[j] - h[i]) / step;
      const c = w.cover[j];
      const cost = step * (1 + dh * dh * 0.9 + (isWater(c) ? 30 : 0) + (c === COVER.CRAG ? 60 : 0));
      if (d + cost < dist[j]) { dist[j] = d + cost; prev[j] = i; push(j, d + cost); }
    }
  }
  const pts = [];
  for (let i = t; i >= 0; i = prev[i]) pts.push([i % N, (i / N) | 0]);
  pts.reverse();
  return pts.filter((_, k) => k % every === 0 || k === pts.length - 1);
}
function findCells(w, pred, n, minSep, seed = 1) {
  const N = w.size, out = [];
  let r = seed >>> 0;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  for (let tries = 0; tries < 40000 && out.length < n; tries++) {
    const x = 4 + Math.floor(rnd() * (N - 8)), y = 4 + Math.floor(rnd() * (N - 8));
    if (!pred(x, y)) continue;
    if (out.some(([a, b]) => Math.hypot(a - x, b - y) < minSep)) continue;
    out.push([x, y]);
  }
  return out;
}
const slopeAt = (w, x, y) => { const N = w.size, h = w.height, i = y * N + x; return Math.max(Math.abs(h[i + 1] - h[i - 1]), Math.abs(h[i + N] - h[i - N])) * 0.5; };

// ----------------------------------------------------------------------------------------- the demos
// Each demo borrows a current level's ground and dresses it as one of the new sheets (docs/LEVELS.md).
const DEMOS = {
  corryvreckan: {
    level: 'corryvreckan', title: 'I Corryvreckan (on assynt ground)',
    season: { night: 0.55, dawn: 0.1, dusk: 0.1, snowline: 600 },
    look(w) {
      const { list } = comps(w); const sea = list.filter((c) => c.edge).sort((a, b) => b.size - a.size)[0];
      const ld = landDist(w);
      const N = w.size; let best = null, bd = 1e9;
      for (const i of sea ? sea.cells : []) { const x = i % N, y = (i / N) | 0; if (ld[i] < 6 || ld[i] > 9) continue; const d = Math.hypot(x - N * 0.25, y - N * 0.5); if (d < bd) { bd = d; best = [x, y]; } }
      return { paper: 'paper', light: { az: 225, el: 15, strength: 1.05 }, signature: ['tidalRace', 'soundings', 'shingle', 'bracken', 'seaFret', 'whirlpool', 'firstSnow'], tidalRace: best ? { x: best[0], y: best[1], r: 9 } : null, seaFret: { from: 'W' } };
    },
  },
  cruachan: {
    level: 'cruachan', title: 'II Cruachan (on affric ground)',
    season: { night: 0.60, dawn: 0.09, dusk: 0.09, snowline: 850 },
    look(w) {
      const N = w.size, { comp, list } = comps(w);
      const lochs = list.filter((c) => !c.edge).sort((a, b) => b.size - a.size);
      const big = lochs[0];
      // dam: across the outlet (lowest shore cell) of a mid-size lochan
      const mid = lochs.find((c) => c.size > 30 && c.size < 900) || lochs[1] || big;
      let out = null, oh = 1e9;
      for (const i of mid.cells) { const x = i % N, y = (i / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * N + x + dx; if (!isWater(w.cover[j]) && w.height[j] < oh) { oh = w.height[j]; out = [x, y, dx, dy]; } } }
      const dam = out ? { x0: out[0] + out[2] - out[3] * 4, y0: out[1] + out[3] - out[2] * 4, x1: out[0] + out[2] + out[3] * 4, y1: out[1] + out[3] + out[2] * 4 } : null;
      // castle: on the shore of the biggest loch
      let castle = null;
      for (const i of big.cells) { const x = i % N, y = (i / N) | 0; if (!isWater(w.cover[y * N + x + 3])) { castle = { x: x + 3, y, name: 'Caisteal (ruin)' }; break; } }
      const rail = route(w, [2, Math.round(N * 0.62)], [N - 3, Math.round(N * 0.4)]);
      void comp;
      return { paper: 'paper2', light: { az: 180, el: 12, strength: 1 }, signature: ['dam', 'castle', 'railway', 'cloudCap'], dam, castle, railway: { points: rail, halts: [{ x: rail[Math.floor(rail.length * 0.55)][0], y: rail[Math.floor(rail.length * 0.55)][1], name: 'Falls of Cruachan' }] }, cloudCap: { above: 0.62 } };
    },
  },
  lyon: {
    level: 'lyon', title: 'III Glen Lyon (on torridon ground)',
    season: { night: 0.63, dawn: 0.08, dusk: 0.08, snowline: 650 },
    look(w) {
      const N = w.size;
      const sh = findCells(w, (x, y) => w.cover[y * N + x] === COVER.MOOR && slopeAt(w, x, y) < 3 && w.height[y * N + x] < w.minH + (w.maxH - w.minH) * 0.35, 5, 22, 7);
      return { paper: 'fog', light: { az: 180, el: 9, strength: 1 }, signature: ['fieldWalls', 'shieling', 'pineRibbon', 'riverIce', 'iceLochans', 'frostGlint', 'inversion'], shielings: sh, inversion: { top: 0.3 } };
    },
  },
  rannoch: {
    level: 'rannoch', title: 'IV Rannoch',
    season: { night: 0.66, dawn: 0.07, dusk: 0.07, snowline: 450 },
    look(w) {
      const N = w.size;
      const rail = route(w, [Math.round(N * 0.3), 2], [Math.round(N * 0.62), N - 3]);
      return { paper: 'frost', light: { az: 180, el: 7, strength: 1 }, signature: ['railway', 'iceLochans', 'boulders', 'squalls', 'deer'], railway: { points: rail, halts: [{ x: rail[Math.floor(rail.length * 0.45)][0], y: rail[Math.floor(rail.length * 0.45)][1], name: 'Halt' }] }, boulders: { x: Math.round(N * 0.72), y: Math.round(N * 0.45), r: 26 } };
    },
  },
  cairngorm: {
    level: 'cairngorm', title: 'V Cairngorm plateau',
    season: { night: 0.70, dawn: 0.06, dusk: 0.06, snowline: 600 },
    look() { return { paper: 'snow', light: { az: 180, el: 5, strength: 1.1 }, signature: ['blueContoursOnSnow', 'boulders', 'whiteout', 'aurora', 'spindrift'] }; },
  },
  coe: {
    level: 'coe', title: 'VI Glen Coe',
    season: { night: 0.62, dawn: 0.08, dusk: 0.08, snowline: 800 },
    look(w) {
      const N = w.size;
      // the Lost Valley: a hanging corrie among the crags (the 'Coire Gabhail' label of this ground, if it has one)
      const lab = ((w.features && w.features.labels) || []).find((l) => /gabhail/i.test(l.text));
      const p = lab || (w.pois.find((q) => q.type === 'stone') || w.pois[1]);
      return { paper: 'fog', light: { az: 180, el: 10, strength: 1.35 }, signature: ['gabbro', 'redScree', 'hiddenValley', 'storm', 'cloudCap'], hidden: { x: Math.round(p.x), y: Math.round(p.y + (lab ? 14 : 6)), r: 14, name: 'Lost Valley' }, redScree: { x: Math.round(N * 0.5), y: Math.round(N * 0.75), r: 70 }, cloudCap: { above: 0.7 } };
    },
  },
  cuillin: {
    level: 'cuillin', title: 'VII Cuillin',
    season: { night: 0.50, dawn: 0.1, dusk: 0.1, snowline: 750 },
    look(w) { const N = w.size; return { paper: 'paper2', light: { az: 225, el: 20, strength: 1.1 }, signature: ['gabbro', 'redScree', 'soundings', 'clearing'], gabbro: { x: Math.round(N * 0.3), y: Math.round(N * 0.5), r: Math.round(N * 0.3) }, redScree: { x: Math.round(N * 0.82), y: Math.round(N * 0.4), r: Math.round(N * 0.25) } }; },
  },
  nevis: {
    level: 'nevis', title: 'VIII Ben Nevis',
    season: { night: 0.30, dawn: 0.12, dusk: 0.12, snowline: 1100 },
    look() { return { paper: 'paper', light: { az: 225, el: 40, strength: 0.8 }, signature: ['spate', 'gullySnow', 'thawMist'] }; },
  },
};

const worldCache = new Map();
function demoWorld(key) {
  if (worldCache.has(key)) return worldCache.get(key);
  const D = DEMOS[key];
  const def = LEVELS.find((l) => l.id === D.level);
  const t0 = performance.now();
  const w = buildWorld(def);
  const ms = performance.now() - t0;
  // temporary overrides, on a copy of the level object only
  const level = { ...w.level, id: key, season: D.season };   // the new id: its WEATHER entry (fx.js) applies
  w.level = level;
  level.look = D.look(w);
  worldCache.set(key, w);
  console.log(`[${key}] ${D.title}: buildWorld ${Math.round(ms)} ms, look`, JSON.stringify({ paper: level.look.paper, light: level.look.light, signature: level.look.signature }));
  return w;
}

// ---------------------------------------------------------------------------------------------- sheets
const keys = Object.keys(DEMOS).filter((k) => !ONLY.length || ONLY.includes(k));
const bakes = {};
if (DO_SHEETS || DO_CROPS) {
  for (const key of keys) {
    const w = demoWorld(key);
    const t0 = performance.now();
    const c = bakeMap(w);
    const ms = performance.now() - t0;
    const plain = { ...w, level: { ...w.level, look: undefined } };
    const t1 = performance.now();
    const c0 = bakeMap(plain);
    const ms0 = performance.now() - t1;
    console.log(`  bake ${c.W}px: with look ${Math.round(ms)} ms (no look ${Math.round(ms0)} ms)  ${c.bakeProfile}`);
    audit('sheet-' + key, c.pixels);
    bakes[key] = { w, c, c0 };
    if (DO_SHEETS) {
      savePNG('sheet-' + key, c.W, c.W, new Uint8Array(c.pixels.buffer), 1);
      const ov = bakeOverview(w, 188, { grid: true });
      savePNG('overview-' + key, 188, 188, ov.getContext('2d').getImageData(0, 0, 188, 188).data, 2);
    }
  }
}

if (DO_CROPS) {
  for (const key of keys) {
    const { w, c, c0 } = bakes[key];
    const L = w.level.look, P = CELL_PX, W = c.W;
    const spots = [];
    const at = (name, x, y, s = 220) => spots.push([name, Math.round(x * P - s / 2), Math.round(y * P - s * 0.3), s, Math.round(s * 0.6)]);
    if (L.tidalRace) at('tidalrace', L.tidalRace.x, L.tidalRace.y);
    if (L.dam) at('dam', (L.dam.x0 + L.dam.x1) / 2, (L.dam.y0 + L.dam.y1) / 2);
    if (L.castle) at('castle', L.castle.x, L.castle.y);
    if (L.railway) { const pts = L.railway.points || L.railway; const m = pts[Math.floor(pts.length * 0.45)]; at('railway', m[0], m[1]); }
    if (L.shielings && L.shielings[0]) at('shieling', L.shielings[0][0], L.shielings[0][1]);
    if (L.hidden) at('hidden', L.hidden.x, L.hidden.y, 260);
    if (L.boulders) at('boulders', L.boulders.x, L.boulders.y);
    if (L.redScree) at('redscree', L.redScree.x, L.redScree.y);
    if (L.gabbro) at('gabbro', L.gabbro.x, L.gabbro.y);
    // generic: around the highest point and the spawn
    let hi = 0; for (let i = 1; i < w.height.length; i++) if (w.height[i] > w.height[hi]) hi = i;
    at('summit', hi % w.size, (hi / w.size) | 0);
    at('spawn', w.spawn.x, w.spawn.y);
    for (const [name, x, y, cw, ch] of spots) {
      const px = crop(c.pixels, W, Math.max(0, Math.min(W - cw, x)), Math.max(0, Math.min(W - ch, y)), cw, ch);
      savePNG(`crop-${key}-${name}`, cw, ch, new Uint8Array(px.buffer), 3);
      if (args.includes('--compare')) savePNG(`crop-${key}-${name}-plain`, cw, ch, new Uint8Array(crop(c0.pixels, W, Math.max(0, Math.min(W - cw, x)), Math.max(0, Math.min(W - ch, y)), cw, ch).buffer), 3);
    }
  }
}

// ---------------------------------------------------------------------------------------------- frames
function makeState(w, o = {}) {
  let pos = o.pos || { x: w.spawn.x, y: w.spawn.y };
  if (o.at) { const poi = w.pois.find((q) => q.type === o.at); if (poi) pos = { x: poi.x + (o.dx || 0), y: poi.y + (o.dy || 0) }; }
  if (o.cell) pos = { x: o.cell[0] + 0.5, y: o.cell[1] + 0.5 };
  const tod = o.tod ?? 0.3, hdg = o.heading ?? 0.4, speed = o.speed ?? 3;
  return {
    t: o.t ?? 12, dt: 1 / 60, level: w.level, world: w,
    player: { x: pos.x, y: pos.y, vx: Math.cos(hdg) * speed, vy: Math.sin(hdg) * speed, speed, heading: hdg, elevation: w.heightAt(pos.x, pos.y), vz: 0, slope: w.slopeAt(pos.x, pos.y), cover: w.coverAt(pos.x, pos.y), moving: speed > 0.3, still: 0, running: false, resting: false, sliding: false, contourIndex: Math.floor(w.heightAt(pos.x, pos.y) / w.contourInterval) },
    timeOfDay: tod, phase: dayPhase(tod, w.level), events: [], proximity: [], resonance: [], gateOpen: !!o.gateOpen,
    chainProgress: w.gate.chain.map((type) => ({ type, resonating: false, remaining: 0, count: 1, nearest: null })),
    knowledge: {}, trail: [], fragments: [], discovered: [], levelComplete: false, revealed: o.revealed,
  };
}

if (DO_FRAMES) {
  const canvas = new SoftCanvas(384, 216);
  const renderer = createRenderer(canvas);
  const ctx = canvas.getContext('2d');
  for (const key of keys) {
    const w = demoWorld(key);
    const t0 = performance.now();
    renderer.setWorld(w);
    console.log(`  renderer.setWorld ${Math.round(performance.now() - t0)} ms`);
    const pc = phaseCentres(w.level), pb = phaseBounds(w.level);
    const shots = (DEMOS[key].shots ? DEMOS[key].shots(w, pc, pb) : []).concat(defaultShots(key, w, pc, pb));
    for (const s of shots) {
      const st = makeState(w, s);
      const R = renderer._R; R.cam.ready = false; R.lastNow = null;
      const T = s.clock ?? 30;
      const frames = s.frames ?? 4;
      if (s.warmFrom != null) renderer.draw(st, { screen: 'play', time: s.warmFrom, showMinimap: true });   // e.g. the gate opened back then
      for (let i = 0; i < frames; i++) { st.t += 1 / 60; if (s.walk) { st.player.x += s.walk[0] / 60; st.player.y += s.walk[1] / 60; } renderer.draw(st, { screen: 'play', time: T + i / 60, showMinimap: true }); }
      const img = ctx.getImageData(0, 0, 384, 216);
      audit(`play-${key}-${s.name}`, new Uint32Array(img.data.buffer));
      savePNG(`play-${key}-${s.name}`, 384, 216, img.data, SCALE);
    }
    // frame timing (night, walking)
    const st = makeState(w, { tod: pc.night, speed: 3 });
    const times = [];
    renderer._R.cam.ready = false; renderer._R.lastNow = null;
    for (let i = 0; i < 90; i++) { st.t += 1 / 60; st.player.x += 0.05; const a = performance.now(); renderer.draw(st, { screen: 'play', time: 40 + i / 60 }); times.push(performance.now() - a); }
    const stD = makeState(w, { tod: pc.day, speed: 3 });
    for (let i = 0; i < 90; i++) { stD.t += 1 / 60; stD.player.x += 0.05; const a = performance.now(); renderer.draw(stD, { screen: 'play', time: 60 + i / 60 }); times.push(performance.now() - a); }
    times.sort((a, b) => a - b);
    console.log(`  draw() soft-canvas ms: avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)} p50 ${times[times.length >> 1].toFixed(2)} p99 ${times[Math.floor(times.length * 0.99)].toFixed(2)}`);
  }
}

function defaultShots(key, w, pc, pb) {
  const L = w.level.look;
  const shots = [
    { name: 'day', tod: pc.day },
    { name: 'dusk', tod: pc.dusk },
    { name: 'night', tod: pc.night },
  ];
  if (L.tidalRace) shots.push({ name: 'whirlpool', tod: pc.day, cell: [L.tidalRace.x + 10, L.tidalRace.y + 4], clock: 31 });
  if (L.signature.includes('firstSnow')) shots.push({ name: 'firstsnow', tod: pc.day, gateOpen: true, clock: 60, warmFrom: 30, at: 'cairn' });
  if (L.signature.includes('inversion') || L.signature.includes('thawMist') || L.signature.includes('cloudCap')) shots.push({ name: 'dawn', tod: pb[0] * 0.55 });
  if (L.hidden) {
    shots.push({ name: 'hidden-veiled', tod: pc.day, cell: [Math.round(L.hidden.x - L.hidden.r - 12), Math.round(L.hidden.y)] });
    shots.push({ name: 'hidden-revealed', tod: pc.day, cell: [Math.round(L.hidden.x), Math.round(L.hidden.y)], frames: 8 });
  }
  if (L.railway) { const pts = L.railway.points || L.railway; const m = pts[Math.floor(pts.length * 0.45)]; shots.push({ name: 'railway', tod: pc.day, cell: [m[0] + 3, m[1] + 2] }); }
  if (L.dam) shots.push({ name: 'dam', tod: pc.day, cell: [Math.round((L.dam.x0 + L.dam.x1) / 2) + 4, Math.round((L.dam.y0 + L.dam.y1) / 2) + 6] });
  if (L.castle) shots.push({ name: 'castle', tod: pc.day, cell: [L.castle.x + 6, L.castle.y + 6] });
  if (L.signature.includes('deer') || L.signature.includes('squalls')) {
    // near the high ground so the herd is in view
    let hi = 0; for (let i = 1; i < w.height.length; i++) if (w.height[i] > w.height[hi]) hi = i;
    const hx = hi % w.size, hy = (hi / w.size) | 0;
    shots.push({ name: 'squall', tod: pc.day, clock: 47, frames: 30, walk: [1.5, 0], cell: [Math.min(w.size - 30, hx + 34), Math.min(w.size - 20, hy + 14)] });
  }
  if (L.signature.includes('whiteout')) shots.push({ name: 'whiteout', tod: pc.day, at: 'summit', dx: 4, clock: 80 });
  let hi = 0; for (let i = 1; i < w.height.length; i++) if (w.height[i] > w.height[hi]) hi = i;
  const top = [hi % w.size, (hi / w.size) | 0];
  const near = (dx, dy) => [Math.max(4, Math.min(w.size - 5, top[0] + dx)), Math.max(30, Math.min(w.size - 5, top[1] + dy))];
  if (L.signature.includes('aurora')) shots.push({ name: 'aurora', tod: pc.night, clock: 50, cell: near(10, 40) });
  if (w.level.look.signature.includes('cloudCap') || (w.level.id && ['cruachan', 'coe'].includes(key))) {
    shots.push({ name: 'cap-night', tod: pc.night, cell: near(20, 20) });
    shots.push({ name: 'cap-dawn', tod: pb[0] * 0.7, cell: near(20, 20) });
    shots.push({ name: 'cap-day', tod: pc.day, cell: near(20, 20) });
  }
  return shots;
}

if (BROWSER_PERF) {
  const { createRequire } = await import('node:module');
  const { execSync } = await import('node:child_process');
  let pw;
  try { pw = await import('playwright'); } catch { pw = createRequire(import.meta.url)(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
  const { startServer } = await import('./lib/serve.mjs');
  const srv = await startServer(root, 0);
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${srv.port}/tools/render-preview.html`);
  await page.waitForFunction(() => window.__ready);
  await page.evaluate(() => window.P.initRenderer());
  for (const key of keys) {
    const w = demoWorld(key);
    const idx = LEVELS.findIndex((l) => l.id === DEMOS[key].level);
    const look = JSON.parse(JSON.stringify(w.level.look)), season = w.level.season;
    const res = {};
    for (const withLook of [false, true]) {
      await page.evaluate((x) => window.P.setWorld(x), 'real:' + idx);
      await page.evaluate(([l, s, id]) => { const w2 = window.P.world(); w2.level = { ...w2.level, id: l ? id : w2.level.id, look: l || undefined, season: l ? s : undefined }; }, [withLook ? look : null, season, key]);
      const bake = await page.evaluate(() => window.P.useWorldInRenderer());
      const pc = phaseCentres(withLook ? w.level : null);
      const t = {};
      for (const [name, tod] of [['day', pc.day], ['dusk', pc.dusk], ['night', pc.night]]) t[name] = await page.evaluate(([td]) => window.P.perfFx(150, { at: 'cairn', heading: 0.4, speed: 4, tod: td }), [tod]);
      if (withLook) for (const tod of [0.02, pc.day, pc.dusk, pc.night]) await page.evaluate(([td]) => window.P.frame({ state: { at: 'cairn', heading: 0.4, speed: 3, tod: td, gateOpen: true } }, 1), [tod]);
      res[withLook ? 'look' : 'plain'] = { bake: Math.round(bake), ...t };
    }
    const f = (r) => `bake ${r.bake} ms | draw ms avg/p95/max day ${r.day.avg.toFixed(2)}/${r.day.p95.toFixed(2)}/${r.day.max.toFixed(1)} dusk ${r.dusk.avg.toFixed(2)}/${r.dusk.p95.toFixed(2)}/${r.dusk.max.toFixed(1)} night ${r.night.avg.toFixed(2)}/${r.night.p95.toFixed(2)}/${r.night.max.toFixed(1)}`;
    console.log(`[browser ${key} on ${DEMOS[key].level}]\n  plain: ${f(res.plain)}\n  look : ${f(res.look)}`);
  }
  const pr = await page.evaluate(() => window.P.paletteReport());
  console.log(`browser palette audit (real canvas): ${pr.bad === 0 ? 'OK' : 'FAIL'}, off-palette ${pr.bad}`);
  badTotal += pr.bad;
  await browser.close(); await srv.close();
}

console.log(`palette audit: ${badTotal === 0 ? 'OK' : 'FAIL'} (${badTotal} off-palette colours)`);
process.exit(badTotal ? 1 : 0);
