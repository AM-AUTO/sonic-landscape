#!/usr/bin/env node
/**
 * Renders each level's World to out/world-<id>.png (hillshade + contours + cover + POIs)
 * and prints build timing / cover statistics / chain leg lengths.
 *
 *   node tools/world-preview.mjs [levelId ...] [--scale=3]
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LEVELS } from '../src/world/levels/index.js';
import { buildWorld } from '../src/world/terrain.js';
import { COVER, COVER_NAMES, MAP_SIZE as S } from '../src/world/codes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const SCALE = Number((args.find((a) => a.startsWith('--scale=')) || '--scale=3').split('=')[1]);
const only = args.filter((a) => !a.startsWith('--'));
const SHADE = args.includes('--shade'); // pure relief view (ignore cover colours)

// ---- minimal PNG encoder --------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- rendering -------------------------------------------------------------
const COL = {
  [COVER.MOOR]: [236, 228, 196], [COVER.PATH]: [194, 53, 126], [COVER.BOG]: [140, 186, 160],
  [COVER.SCREE]: [188, 182, 170], [COVER.CRAG]: [29, 26, 23], [COVER.SNOW]: [250, 250, 255],
  [COVER.WOOD]: [140, 190, 120], [COVER.SHALLOW]: [159, 211, 230], [COVER.DEEP]: [80, 150, 200], [COVER.ROCK]: [165, 158, 146],
};
const POI_COL = {
  trig: [40, 60, 230], cairn: [20, 20, 20], lochan: [0, 230, 230], waterfall: [255, 255, 255],
  bothy: [150, 80, 20], stone: [120, 120, 120], crag: [255, 120, 0], summit: [255, 230, 0],
};

function render(world) {
  const W = S * SCALE;
  const buf = Buffer.alloc(W * W * 3);
  const ci = world.contourInterval;
  const range = world.maxH - world.minH || 1;
  const hAt = new Float32Array(W * W);
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) hAt[py * W + px] = world.heightAt((px + 0.5) / SCALE - 0.5, (py + 0.5) / SCALE - 0.5);
  for (let py = 0; py < W; py++) {
    for (let px = 0; px < W; px++) {
      const cx = Math.min(S - 1, Math.floor(px / SCALE)), cy = Math.min(S - 1, Math.floor(py / SCALE));
      const i = cy * S + cx;
      const cv = world.cover[i];
      let [r, g, b] = SHADE && cv !== COVER.SHALLOW && cv !== COVER.DEEP ? [225, 220, 205] : COL[cv];
      const hh = hAt[py * W + px];
      // hillshade (light from NW)
      const hx = hAt[py * W + Math.min(W - 1, px + 1)] - hAt[py * W + Math.max(0, px - 1)];
      const hy = hAt[Math.min(W - 1, py + 1) * W + px] - hAt[Math.max(0, py - 1) * W + px];
      const k = SCALE / (2 * 40) * 40 / SCALE; // dh per px-pair -> per cell-pair normalisation
      const sh = Math.max(0.55, Math.min(1.35, 1 + (-(hx) - (hy)) * 0.012 * SCALE * 0.55));
      if (cv !== COVER.CRAG || SHADE) { r *= sh; g *= sh; b *= sh; }
      else { const s2 = Math.max(0, (sh - 0.7)) * 40; r += s2; g += s2; b += s2; }
      // elevation tint (darker brown at height)
      if (cv === COVER.MOOR || cv === COVER.BOG) { const t = (hh - world.minH) / range; r -= 25 * t; g -= 30 * t; b -= 30 * t; }
      // contours
      const hr = hAt[py * W + Math.min(W - 1, px + 1)], hd = hAt[Math.min(W - 1, py + 1) * W + px];
      const q0 = Math.floor(hh / ci), q1 = Math.floor(hr / ci), q2 = Math.floor(hd / ci);
      if ((q0 !== q1 || q0 !== q2) && cv !== COVER.DEEP) {
        const q = Math.max(q0, q1, q2);
        const idx = q % 5 === 0;
        if (cv === COVER.CRAG) { /* crags stay black */ }
        else if (idx) { r = 138; g = 90; b = 53; } else { r = 181 * 0.95 + 20; g = 131 * 0.95 + 20; b = 90 * 0.95 + 20; }
      }
      // streams
      if (world.stream[i] && cv !== COVER.PATH && cv !== COVER.CRAG) { r = 47; g = 111; b = 168; }
      const o = (py * W + px) * 3;
      buf[o] = Math.max(0, Math.min(255, r)); buf[o + 1] = Math.max(0, Math.min(255, g)); buf[o + 2] = Math.max(0, Math.min(255, b));
    }
  }
  const dot = (x, y, rad, col, ring) => {
    const cx = Math.round((x + 0.5) * SCALE), cy = Math.round((y + 0.5) * SCALE);
    for (let dy = -rad - 1; dy <= rad + 1; dy++) for (let dx = -rad - 1; dx <= rad + 1; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > rad + 1) continue;
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= W || py >= W) continue;
      const c = d > rad ? ring : col;
      const o = (py * W + px) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
    }
  };
  for (const f of world.features.waterfalls) dot(f.x, f.y, 2, [255, 255, 255], [47, 111, 168]);
  for (const s of world.features.spotHeights) dot(s.x, s.y, 1, [0, 0, 0], [0, 0, 0]);
  for (const l of world.features.labels) { dot(l.x, l.y, 1, l.kind === 'water' ? [47, 111, 168] : l.kind === 'peak' ? [0, 0, 0] : [140, 0, 140], [255, 255, 255]); }
  for (const p of world.pois) dot(p.x, p.y, 4, POI_COL[p.type], world.gate.chain.includes(p.type) ? [255, 255, 255] : [0, 0, 0]);
  dot(world.gate.x, world.gate.y, 5, [255, 0, 255], [0, 0, 0]);
  dot(world.spawn.x, world.spawn.y, 4, [255, 0, 0], [255, 255, 255]);
  return encodePNG(W, W, buf);
}

// BFS walk length between two cells over passable cells
function walkLen(world, a, b) {
  const dist = new Int32Array(S * S).fill(-1);
  const q = [a.y * S + a.x]; dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === b.y * S + b.x) return dist[c];
    const cx = c % S, cy = (c / S) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!world.passable(nx, ny) || dist[ny * S + nx] >= 0) continue;
      if (dx && dy && !world.passable(nx, cy) && !world.passable(cx, ny)) continue;
      dist[ny * S + nx] = dist[c] + 1; q.push(ny * S + nx);
    }
  }
  return -1;
}

for (const lv of LEVELS) {
  if (only.length && !only.includes(lv.id)) continue;
  const t0 = performance.now();
  const world = buildWorld(lv);
  const ms = performance.now() - t0;
  writeFileSync(join(outDir, `world-${lv.id}${SHADE ? '-shade' : ''}.png`), render(world));
  const counts = new Array(10).fill(0);
  for (const c of world.cover) counts[c]++;
  const pct = counts.map((n, i) => `${COVER_NAMES[i]} ${(100 * n / (S * S)).toFixed(1)}`).join(' | ');
  let streams = 0; for (const s of world.stream) streams += s;
  console.log(`\n== ${lv.id} (${ms.toFixed(0)} ms)  H ${world.minH.toFixed(0)}..${world.maxH.toFixed(0)} (declared ${lv.elevation.min}..${lv.elevation.max})  repairs ${world.stats.repairs}`);
  const sl = []; for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) sl.push(Math.hypot(world.height[y * S + x + 1] - world.height[y * S + x - 1], world.height[(y + 1) * S + x] - world.height[(y - 1) * S + x]) / 80);
  sl.sort((a, b) => a - b);
  console.log(`   slope p50 ${sl[sl.length >> 1].toFixed(2)} p90 ${sl[Math.floor(sl.length * 0.9)].toFixed(2)} p98 ${sl[Math.floor(sl.length * 0.98)].toFixed(2)}`);
  console.log(`   ${pct} | stream cells ${streams} | waterfalls ${world.features.waterfalls.length} | spot heights ${world.features.spotHeights.length}`);
  console.log(`   spawn ${world.spawn.x},${world.spawn.y}  gate ${world.gate.x},${world.gate.y} side ${world.gate.side} chain ${world.gate.chain.join('>')}`);
  const legs = [];
  const byType = (t) => world.pois.find((p) => p.type === t);
  let prev = world.spawn;
  for (const t of world.gate.chain) {
    const p = byType(t);
    legs.push(`${t}:${walkLen(world, prev, p)}`);
    prev = p;
  }
  legs.push(`gate:${walkLen(world, prev, world.gate)}`);
  console.log(`   legs ${legs.join('  ')}`);
  for (const p of world.pois) console.log(`   - ${p.id.padEnd(14)} ${p.type.padEnd(9)} ${String(p.x).padStart(3)},${String(p.y).padStart(3)} ${String(p.elevation).padStart(6)}m  ${JSON.stringify(p.condition)}`);
}
