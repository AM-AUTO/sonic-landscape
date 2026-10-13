/**
 * Painted scenes: full-bleed night-and-ember paintings made in code, no image assets.
 *
 * The art is impressionistic: big fields of colour, ordered-dither gradients, few objects. The sky
 * bleeds blood / rust / ember into heather and peat-black; hills are stacked dithered bands traced by
 * fine contour lines; lochans mirror the red sky; one small motif (a stag, a lit window, a lone figure,
 * a symbol stone) gives each scene its scale.
 *
 * Every painter writes palette colours (never blended: ordered dither only) into a Uint32Array
 * raster, so the same code runs in Node (tests hash the pixels) and in the browser (the raster is
 * put straight onto the canvas). A scene is painted once into a cached base raster, with a layer map
 * saying which depth each pixel belongs to; per frame a copy of the base gets the cheap animation on
 * top (drifting mist that respects the depth order, a flickering lamp, ravens, glints on the water).
 *
 *   spec = { kind: 'ridge'|'bothy'|'stone'|'dawn'|'title', levelIndex, seed?, motif?, locked? }
 *
 *   ridge   a track's own place: skyline from its real heightfield, a colour mood and ONE motif
 *   bothy   a vast red-black moor, one small lit window and a thread of smoke (field notes)
 *   stone   a Pictish symbol stone at dawn, warm glow (track complete)
 *   dawn    a wide dawn over the whole set of ridges (album complete)
 *   title   the cover, three variants (spec.variant 'A'|'B'|'C'): a standing stone on a contour map, the logo painted on top
 */
import { PAL, PAL_NAMES, PAL_U32 as C } from './palette.js';
import { hash2f } from '../core/rng.js';
import { paintStandingStone } from './stone.js';
import { paintTitleArt, animTitleArt, setTerrain, hasTerrain, TITLE_LEVELS, TITLE_DEFAULT, TITLE_VARIANTS, TITLE_LAYOUT } from './titleart.js';
import { Raster, bay, clamp, vnoise, lift, sink, skyAt, mistBand, drawMistBand } from './artkit.js';
import * as SP from './sprites.js';
import { LEVELS } from '../world/levels/index.js';
import { createSculptKit } from '../world/sculpt.js';

/** Full-bleed: the painting is the whole 384x216 screen (the caption band is drawn over its foot). */
export const PANEL = Object.freeze({ x: 0, y: 0, w: 384, h: 216 });
/** The title cover is full-bleed too. */
export const TITLE_SCENE = Object.freeze({ w: 384, h: 216 });
/** Tracklist thumbnails. */
export const THUMB = Object.freeze({ w: 112, h: 84 });

// ----------------------------------------------------------------------------- raster
const HEX2U32 = Object.fromEntries(PAL_NAMES.map((n) => [PAL[n].toLowerCase(), C[n]]));

// ----------------------------------------------------------------------------- track data
const accentU = (levelIndex) => {
  const lv = LEVELS[levelIndex] || LEVELS[0];
  const n = lv && lv.palette && lv.palette.accent;
  return n && C[n] ? C[n] : C.magenta;
};
const levelOf = (i) => LEVELS[clamp(i | 0, 0, LEVELS.length - 1)];

/**
 * The skyline of a track: three slabs of the heightfield (north = far, south = near) reduced to the
 * highest ground in each column, 0..1 of the slab's own range. Built from world.heightAt (the real map),
 * so every track's panels are its own place.
 */
export function buildProfile(heightAt, minH, maxH, size = 256) {
  const span = Math.max(1, maxH - minH);
  let rough = 0;
  const bands = [[0, 84], [85, 169], [170, size - 1]].map(([y0, y1]) => {
    const out = new Float32Array(size);
    for (let x = 0; x < size; x++) {
      let m = -Infinity;
      for (let y = y0; y <= y1; y += 3) { const h = heightAt(x, y); if (h > m) m = h; }
      out[x] = (m - minH) / span;
    }
    const sorted = Array.from(out).sort((a, b) => a - b);
    const lo = sorted[Math.floor(size * 0.05)], hi = Math.max(sorted[size - 1], lo + 0.3);
    for (let x = 0; x < size; x++) out[x] = clamp((out[x] - lo) / (hi - lo), 0, 1);
    for (let x = 1; x < size; x++) rough += Math.abs(out[x] - out[x - 1]);
    return out;
  });
  rough /= 3 * (size - 1);
  return { size, bands, relief: span, gamma: clamp(0.85 + rough * 4.5, 0.85, 1.7) };
}
const profiles = new Map();
export function setProfile(levelIndex, profile) { profiles.set(levelIndex, profile); }
export function hasProfile(levelIndex) { return profiles.has(levelIndex); }
export function getProfile(levelIndex) { return profiles.get(levelIndex) || null; }
/** Seed a track's profile from a built world (main.js does this on entering a track). */
export function setProfileFromWorld(levelIndex, world) {
  profiles.set(levelIndex, buildProfile((x, y) => world.heightAt(x, y), world.minH, world.maxH, world.size || 256));
  const S = world.size || 256;
  if (world.height && world.height.length === S * S) setTerrain(levelIndex, world.height, S);
}
/**
 * Build a track's profile from its sculpt alone (about 100 ms, no hydrology or cover): gives the tracklist and
 * the cover every track's real skyline without building eight worlds. Returns true once it exists.
 */
export function warmProfile(levelIndex) {
  if (profiles.has(levelIndex)) return true;
  const lv = LEVELS[levelIndex];
  if (!lv) return false;
  const { T, state } = createSculptKit(lv);
  lv.sculpt(T);
  const S = 256, h = state.h;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  profiles.set(levelIndex, buildProfile((x, y) => h[Math.min(S - 1, y) * S + Math.min(S - 1, x)], lo, hi, S));
  setTerrain(levelIndex, h, S);                                       // the cover draws on the same field
  return true;
}
/** A believable stand-in skyline until the real one is built (so a panel is never empty). */
function standIn(levelIndex) {
  const lv = levelOf(levelIndex);
  const seed = (lv.seed | 0) + 77;
  const bands = [0, 1, 2].map((b) => {
    const out = new Float32Array(256);
    for (let x = 0; x < 256; x++) out[x] = clamp(0.15 + 0.7 * vnoise(x * 0.03 + b * 9, b * 3.1, seed + b), 0, 1);
    return out;
  });
  const e = lv.elevation || { min: 0, max: 800 };
  return { size: 256, bands, relief: e.max - e.min, gamma: 1.1, provisional: true };
}
const profileOf = (i) => profiles.get(i) || standIn(i);

// ----------------------------------------------------------------------------- sky, sun, hills
function paintSky(r, W, H, horizon, stops, bias) {
  for (let y = 0; y < H; y++) {
    const t = Math.pow(clamp(y / horizon, 0, 1), bias);
    for (let x = 0; x < W; x++) r.px(x, y, skyAt(stops, t, x, y), 0);
  }
}

/** Long shallow streaks of cloud: some lighter (catching the sun), some darker. Strongest toward the horizon. */
function paintStreaks(r, W, horizon, seed, amount) {
  for (let y = 0; y < horizon; y++) {
    const w = 0.25 + 0.75 * (y / horizon);
    for (let x = 0; x < W; x++) {
      const v = vnoise(x * 0.006, (y + x * 0.035) * 0.19, seed) * 0.65 + vnoise(x * 0.02, y * 0.45, seed + 4) * 0.35;
      const hi = clamp((v - 0.56) * 4, 0, 1) * w * amount;
      const lo = clamp((0.36 - v) * 4, 0, 1) * (1.1 - w) * amount;
      if (hi > 0 && bay(x + 3, y + 1) < hi * 0.85) r.px(x, y, lift(r.get(x, y)));
      else if (lo > 0 && bay(x + 1, y + 5) < lo * 0.8) r.px(x, y, sink(r.get(x, y)));
    }
  }
}

/** A low sun: bone core, flame body, and a wide glow that lifts the sky a step or two by dither. */
function paintSun(r, sx, sy, rad, glow) {
  const halo = Math.round(rad * glow);
  for (let y = -halo; y <= halo; y++) for (let x = -halo; x <= halo; x++) {
    const d = Math.hypot(x, y);
    if (d > halo) continue;
    const X = sx + x, Y = sy + y;
    if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
    if (d <= rad) {
      r.px(X, Y, d < rad * 0.45 ? C.paper : d < rad * 0.8 ? C.flame : (bay(X, Y) < 0.5 ? C.flame : C.lamp), 0);
    } else {
      const k = Math.pow(1 - (d - rad) / (halo - rad), 1.7);
      if (bay(X, Y) < k * 0.95) r.px(X, Y, lift(r.get(X, Y)));
      if (k > 0.45 && bay(X + 5, Y + 3) < (k - 0.4) * 1.1) r.px(X, Y, lift(r.get(X, Y)));
    }
  }
}

/** Crest height (px) of one layer of hills at every column. */
function ridgeTops(W, band, size, o) {
  const tops = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    const u = (x / W) * size * o.span + o.off;
    const i0 = Math.floor(u), f = u - i0;
    const a = band[i0 % size], b = band[(i0 + 1) % size], c = band[(i0 + size - 1) % size];
    let n = a * (1 - f) + b * f;
    if (o.smooth) n = n * 0.6 + (c + (a + b) * 0.5) * 0.2;
    tops[x] = Math.round(o.base - Math.pow(n, o.gamma || 1) * o.amp);
  }
  return tops;
}

/**
 * One layer of hills: a silhouette that fades from an upper to a lower colour by dither, a lit rim along the
 * crest, and fine contour lines running down the hill parallel to the crest (the map showing through).
 */
function ridgeLayer(r, id, W, H, tops, o) {
  for (let x = 0; x < W; x++) {
    const top = clamp(tops[x], 2, H - 1);
    for (let y = top; y < H; y++) {
      const f = clamp((y - top) / o.fade, 0, 1);
      r.px(x, y, bay(x, y) < f ? o.lower : o.upper, id);
    }
  }
  const run = (x, off, c, dens) => {
    const t0 = clamp(tops[x] + off, 2, H - 1), t1 = clamp(tops[Math.min(W - 1, x + 1)] + off, 2, H - 1);
    const y1 = Math.max(t0, Math.min(t1, t0 + 8));
    for (let y = t0; y <= y1; y++) if (!dens || bay(x, y) < dens) r.px(x, y, c, id);
  };
  for (let k = 1; k <= (o.contours || 0); k++) {
    const off = Math.round(k * (o.cstep || 5) * (1 + k * 0.12));
    for (let x = 0; x < W; x++) {
      const y = clamp(tops[x] + off, 2, H - 1);
      if (r.layer(x, y) !== id) continue;
      run(x, off, o.cline ? o.cline : lift(r.get(x, y)), 0.8);
    }
  }
  if (o.rim) for (let x = 0; x < W; x++) { run(x, 0, o.rim, o.rimDens || 0); if (o.rim2 && bay(x, tops[x] + 1) < 0.5) r.px(x, clamp(tops[x] + 1, 2, H - 1), o.rim2, id); }
}

/** pine silhouettes standing on a crest */
function pines(r, id, tops, W, density, seed, sc, col) {
  for (let x = 2; x < W - 2; x++) {
    if (hash2f(x, 9, seed) > density) continue;
    const h = Math.round((6 + hash2f(x, 10, seed) * 10) * sc), top = tops[x];
    for (let k = 0; k < h; k++) {
      const w = Math.floor(((k + 1) / h) * 3 * sc + (k % 3 === 0 ? 1 : 0));
      for (let i = -w; i <= w; i++) r.px(x + i, top - h + k + 2, col, id);
    }
    r.px(x, top + 2, col, id); r.px(x, top + 3, col, id);
  }
}

// ----------------------------------------------------------------------------- creatures and figures
/** A red-deer stag in silhouette, facing right, hooves at (fx, fy). s = 1 is about 36 px tall with antlers. */
function drawStag(r, fx, fy, s, col, id) {
  const L = (x0, y0, x1, y1, th = 1) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * s));
    const T = Math.max(1, Math.round(th * s));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let a = 0; a < T; a++) for (let b = 0; b < T; b++) r.px(Math.round(fx + x * s) + a - (T >> 1), Math.round(fy + y * s) + b - (T >> 1), col, id);
    }
  };
  const T1 = Math.max(1, Math.round(s));
  const fill = (cx, cy, rx, ry) => {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) for (let a = 0; a < T1; a++) for (let b = 0; b < T1; b++) r.px(Math.round(fx + (cx + x) * s) + a, Math.round(fy + (cy + y) * s) + b, col, id);
  };
  fill(0, -15, 11, 5.5);                                 // body
  L(-8, -12, -9, 0); L(-5, -11, -5, 0); L(6, -11, 7, 0); L(9, -11, 10, 0);   // legs
  L(7, -16, 12, -26, 3);                                 // neck
  fill(14, -27, 4, 2.4);                                 // head
  L(16, -26, 20, -23, 2); L(12, -29, 11, -32);           // muzzle, ear
  for (const dx of [0, 5]) {                             // antlers: a heavy beam sweeping back and up, three tines, and its far twin
    L(13 + dx, -30, 10 + dx, -38, 2); L(10 + dx, -38, 9 + dx, -47, 2);
    L(10 + dx, -38, 16 + dx, -41); L(9 + dx, -44, 15 + dx, -47); L(9 + dx, -47, 5 + dx, -51); L(9 + dx, -47, 12 + dx, -53);
  }
}

function walkerPixels(frame) {
  if (typeof SP.walkerArt !== 'function') return null;
  const art = SP.walkerArt('S', 'idle', frame);
  const cmap = SP.COLORS || {};
  const out = [];
  art.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.' || ch === ' ') continue; const hex = cmap[ch]; const u = hex && HEX2U32[String(hex).toLowerCase()]; if (u) out.push([x, y, u, ch]); } });
  return out;
}
/** The wanderer at integer scale, feet at (fx, fy). The ink outline takes the rim colour so the figure reads against black. */
function drawWanderer(r, fx, fy, scale, id, rimCol) {
  const px = walkerPixels(0);
  const sz = SP.WALKER_SIZE || 12;
  const x0 = Math.round(fx - (sz * scale) / 2), y0 = fy - sz * scale;
  const a = typeof SP.lanternAnchor === 'function' ? SP.lanternAnchor('S', 'idle', 0) : { x: 9, y: 2 };
  // seen at dusk, the grey cloak is a dark red shape: the sprite's colours are re-keyed to the red hours
  const KEY = rimCol === C.ink ? { r: C.ink, n: C.ink, s: C.rust, S: C.rust, d: C.ink, c: C.ink } : { r: C.ink, n: C.blood, s: C.rust, S: C.rust, d: C.rust, c: C.heather };
  if (px) for (const [x, y, u, ch] of px) {
    const c = ch === 'k' ? (rimCol || u) : (KEY[ch] || u);
    for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) r.px(x0 + x * scale + i, y0 + y * scale + j, c, id);
  }
  return { x: x0 + a.x * scale + Math.floor(scale / 2), y: y0 + a.y * scale + Math.floor(scale / 2), scale };
}
/** Warm lantern light: lamp dither fading out from (cx, cy), only over pixels no deeper than maxLayer. */
function lanternGlow(r, cx, cy, rad, maxLayer, k) {
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    const d = Math.hypot(x, y);
    if (d > rad) continue;
    const X = cx + x, Y = cy + y;
    if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
    const i = Y * r.w + X;
    if (r.lay[i] > maxLayer) continue;
    const v = Math.pow(1 - d / rad, 1.6) * k;
    if (bay(X, Y) < v) r.d[i] = d < rad * 0.28 ? C.flame : C.lamp;
  }
}
/** A raven or eagle on the wing: two frames of a shallow V. */
function drawBird(r, x, y, flap, col, sc = 1) {
  const w = Math.max(2, Math.round(4 * sc));
  for (let i = 1; i <= w; i++) {
    const up = flap ? -Math.round(i * 0.5) : Math.round(i * 0.35);
    r.px(x - i, y + up, col); r.px(x + i, y + up, col);
  }
  r.px(x, y, col); r.px(x, y + 1, col);
}

// ----------------------------------------------------------------------------- generic scene
const SKY_RED = [C.ink, C.blood, C.heather, C.rust, C.ember, C.lamp, C.flame];
const SKY_DUSK = [C.ink, C.night, C.heather, C.rust, C.ember, C.lamp];
const SKY_SLIT = [C.ink, C.ink, C.night, C.blood, C.rust, C.ember, C.lamp];
/** a mood: how a place looks. One per track. */
const MOODS = {
  rannoch: {
    stops: SKY_RED, bias: 1.15, horizon: 0.6, sun: { x: 0.7, y: 0.585, r: 19, glow: 4.2 },
    layers: [
      { band: 0, base: 0.60, amp: 0.15, upper: C.heather, lower: C.blood, fade: 0.1, rim: C.rust, contours: 3, cstep: 4, span: 0.8, off: 6 },
      { band: 1, base: 0.655, amp: 0.075, upper: C.blood, lower: C.ink, fade: 0.09, rim: C.heather, contours: 0, span: 0.8, off: 30 },
    ],
    ground: { kind: 'moor', top: 0.668, lochans: 15 }, motif: 'stag', mist: [{ y: 0.585, hh: 0.1, layerMax: 1, speed: 4, dens: 0.8 }, { y: 0.66, hh: 0.07, layerMax: 3, speed: 7, dens: 0.6 }],
  },
  affric: {
    stops: SKY_RED, bias: 1.0, horizon: 0.62, sun: { x: 0.3, y: 0.52, r: 15, glow: 4.4 },
    layers: [
      { band: 0, base: 0.58, amp: 0.3, upper: C.heather, lower: C.blood, fade: 0.2, rim: C.rust, contours: 4, cstep: 5, span: 0.8, off: 4 },
      { band: 1, base: 0.74, amp: 0.3, upper: C.blood, lower: C.ink, fade: 0.2, rim: C.heather, trees: 0.13, span: 0.8, off: 28 },
      { band: 2, base: 0.97, amp: 0.3, upper: C.ink, lower: C.ink, fade: 0.04, rim: C.rust, trees: 0.28, span: 0.8, off: 44 },
    ],
    ground: { kind: 'none' }, motif: 'pines', mist: [{ y: 0.64, hh: 0.14, layerMax: 1, speed: 4, dens: 0.8 }, { y: 0.83, hh: 0.1, layerMax: 2, speed: 7, dens: 0.7 }],
  },
  coe: {
    stops: SKY_SLIT, bias: 1.35, horizon: 0.66, sun: { x: 0.5, y: 0.62, r: 7, glow: 7 },
    layers: [
      { band: 0, base: 0.66, amp: 0.34, upper: C.blood, lower: C.ink, fade: 0.25, rim: C.rust, contours: 2, cstep: 6, span: 0.8, off: 4, valley: { pow: 1.4, floor: 0.12, lift: 0.14 } },
      { band: 1, base: 0.86, amp: 0.46, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.heather, contours: 2, cstep: 8, cline: C.blood, span: 0.8, off: 22, valley: { pow: 1.2, floor: 0.1, lift: 0.2 } },
      { band: 2, base: 1.02, amp: 0.5, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.ember, span: 0.8, off: 40, valley: { pow: 1.1, floor: 0.08, lift: 0.22 } },
    ],
    ground: { kind: 'none' }, motif: 'figure', mist: [{ y: 0.62, hh: 0.12, layerMax: 1, speed: 3, dens: 0.8 }, { y: 0.78, hh: 0.14, layerMax: 2, speed: 5, dens: 0.8 }, { y: 0.93, hh: 0.1, layerMax: 3, speed: 8, dens: 0.55 }],
  },
  cairngorm: {
    stops: SKY_DUSK, bias: 1.1, horizon: 0.6, sun: { x: 0.24, y: 0.58, r: 14, glow: 4.6 },
    layers: [
      { band: 0, base: 0.6, amp: 0.2, upper: C.bolt, lower: C.heather, fade: 0.22, rim: C.paper, contours: 3, cstep: 5, cline: C.rust, span: 0.8, off: 5 },
      { band: 1, base: 0.74, amp: 0.2, upper: C.rock, lower: C.blood, fade: 0.2, rim: C.bolt, contours: 2, cstep: 6, cline: C.heather, span: 0.8, off: 26 },
      { band: 2, base: 0.97, amp: 0.2, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.ice, span: 0.8, off: 44 },
    ],
    ground: { kind: 'none' }, motif: 'snow', mist: [{ y: 0.66, hh: 0.14, layerMax: 1, speed: 6, dens: 0.8 }, { y: 0.84, hh: 0.1, layerMax: 2, speed: 10, dens: 0.6 }],
  },
  torridon: {
    stops: SKY_RED, bias: 1.0, horizon: 0.62, sun: { x: 0.78, y: 0.55, r: 12, glow: 5 },
    layers: [
      { band: 0, base: 0.6, amp: 0.3, upper: C.ember, lower: C.rust, fade: 0.25, rim: C.flame, contours: 7, cstep: 4, cline: C.blood, span: 0.8, off: 4 },
      { band: 1, base: 0.8, amp: 0.4, upper: C.rust, lower: C.blood, fade: 0.25, rim: C.ember, contours: 7, cstep: 5, cline: C.ink, span: 0.8, off: 24 },
      { band: 2, base: 0.99, amp: 0.3, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.lamp, span: 0.8, off: 44 },
    ],
    ground: { kind: 'none' }, motif: 'none', mist: [{ y: 0.64, hh: 0.14, layerMax: 1, speed: 4, dens: 0.7 }, { y: 0.86, hh: 0.1, layerMax: 2, speed: 7, dens: 0.55 }],
  },
  cuillin: {
    stops: SKY_RED, bias: 1.3, horizon: 0.64, sun: { x: 0.55, y: 0.6, r: 12, glow: 4.8 },
    layers: [
      { band: 0, base: 0.6, amp: 0.5, upper: C.blood, lower: C.ink, fade: 0.2, rim: C.ember, span: 0.8, off: 4, tall: 1.2 },
      { band: 1, base: 0.82, amp: 0.55, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.rust, span: 0.8, off: 22, tall: 1.2 },
      { band: 2, base: 1.0, amp: 0.4, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.heather, span: 0.8, off: 40 },
    ],
    ground: { kind: 'none' }, motif: 'ravens', mist: [{ y: 0.66, hh: 0.14, layerMax: 1, speed: 4, dens: 0.75 }, { y: 0.88, hh: 0.1, layerMax: 2, speed: 8, dens: 0.55 }],
  },
  assynt: {
    stops: SKY_RED, bias: 1.1, horizon: 0.6, sun: { x: 0.28, y: 0.58, r: 15, glow: 4.6 },
    layers: [
      { band: 1, base: 0.62, amp: 0.4, upper: C.heather, lower: C.blood, fade: 0.2, rim: C.rust, contours: 4, cstep: 5, span: 0.8, off: 30, gamma: 1.8 },
      { band: 2, base: 0.665, amp: 0.07, upper: C.blood, lower: C.ink, fade: 0.08, rim: C.heather, span: 0.8, off: 12 },
    ],
    ground: { kind: 'moor', top: 0.672, lochans: 14 }, motif: 'none', mist: [{ y: 0.6, hh: 0.1, layerMax: 1, speed: 4, dens: 0.8 }, { y: 0.67, hh: 0.07, layerMax: 3, speed: 6, dens: 0.6 }],
  },
  nevis: {
    stops: SKY_RED, bias: 0.95, horizon: 0.68, sun: null,
    layers: [
      { band: 0, base: 0.62, amp: 0.46, upper: C.heather, lower: C.blood, fade: 0.25, rim: C.ember, contours: 3, cstep: 6, span: 0.8, off: 4 },
      { band: 1, base: 0.82, amp: 0.46, upper: C.blood, lower: C.ink, fade: 0.2, rim: C.rust, span: 0.8, off: 24 },
      { band: 2, base: 1.0, amp: 0.46, upper: C.ink, lower: C.ink, fade: 0.05, rim: C.lamp, span: 0.8, off: 40 },
    ],
    ground: { kind: 'none' }, motif: 'cairn', mist: [{ y: 0.66, hh: 0.15, layerMax: 1, speed: 4, dens: 0.8 }, { y: 0.86, hh: 0.1, layerMax: 2, speed: 8, dens: 0.6 }],
  },
};

/** Lochans mirroring the sky, set in dark moor; returns the glint pixels for the animation. */
function paintMoor(r, W, H, top, count, seed, stops, sunX) {
  for (let y = top; y < H; y++) {
    const t = (y - top) / (H - top);
    for (let x = 0; x < W; x++) {
      const warm = bay(x, y) < (1 - t) * 0.5 * (0.5 + 0.5 * Math.exp(-(((x - sunX) / (W * 0.4)) ** 2)));
      let c = warm ? C.blood : (bay(x + 2, y) < 0.1 * (1 - t) ? C.heather : C.ink);
      const k = hash2f(x, y, seed + 70);
      if (k < 0.012 * (1 - t * 0.6)) c = k < 0.005 ? C.contour : k < 0.009 ? C.contourIdx : C.heather;      // dun-gold grass, heather
      r.px(x, y, c, 3);
    }
  }
  const glints = [];
  for (let i = 0; i < count; i++) {
    const t = Math.pow(hash2f(i, 1, seed + 71), 0.8);
    const cy = Math.round(top + 6 + t * (H - top - 16));
    const depth = (cy - top) / (H - top);
    const rx = Math.round((14 + hash2f(i, 2, seed + 71) * 40) * (0.4 + depth * 1.5));
    const ry = Math.max(2, Math.round(rx * (0.1 + depth * 0.14)));
    const cx = Math.round(hash2f(i, 3, seed + 71) * W);
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      const e = (x / rx) ** 2 + (y / ry) ** 2 + 0.25 * vnoise((cx + x) * 0.2, (cy + y) * 0.5, seed + i);
      if (e > 1) continue;
      const X = cx + x, Y = cy + y;
      if (X < 0 || X >= W || Y >= H) continue;
      // reflect the sky: bright where the lochan is far (near the horizon) and under the sun
      const within = (y + ry) / (2 * ry);          // 0 at the far shore .. 1 at the near shore
      const tt = clamp(0.95 - depth * 0.45 - within * 0.35 + 0.5 * Math.exp(-(((X - sunX) / (W * 0.14)) ** 2)) * (1 - depth * 0.5), 0, 1);
      let c = skyAt(stops, tt, X, Y);
      if (e > 0.82) c = bay(X, Y) < 0.5 ? C.ink : sink(c);                      // dark shore
      r.px(X, Y, c, 3);
      if (e < 0.8 && (Y + i) % 3 === 0 && hash2f(X >> 2, Y, seed + 72) < 0.22) r.px(X, Y, sink(sink(c)), 3);
      else if (e < 0.8 && hash2f(X, Y, seed + 73) < 0.012) glints.push([X, Y, c]);
    }
  }
  return glints;
}

function paintScene(r, spec, S, cfg) {
  const W = r.w, H = r.h, sc = H / 216;
  const lv = levelOf(spec.levelIndex), prof = profileOf(spec.levelIndex);
  const seed = (lv.seed | 0) + (spec.seed | 0);
  S.seed = seed;
  const horizon = Math.round(H * cfg.horizon);
  paintSky(r, W, H, horizon, cfg.stops, cfg.bias);
  paintStreaks(r, W, horizon, seed + 3, 1);
  S.stars = [];
  for (let i = 0; i < Math.round(W * H * 0.0005); i++) {
    const x = Math.floor(hash2f(i, 1, seed + 40) * W), y = Math.floor(Math.pow(hash2f(i, 2, seed + 40), 1.6) * horizon * 0.5);
    if (r.get(x, y) === C.ink || r.get(x, y) === C.night) S.stars.push({ x, y, ph: hash2f(i, 3, seed + 40) * 6.28 });
  }
  const sunX = cfg.sun ? Math.round(cfg.sun.x * W) : Math.round(W * 0.5);
  if (cfg.sun) paintSun(r, sunX, Math.round(cfg.sun.y * H), Math.max(3, Math.round(cfg.sun.r * sc)), cfg.sun.glow);
  const gm = prof.gamma || 1.1;
  const rf = clamp(0.8 + prof.relief / 5000, 0.8, 1.05);
  const tops = [];
  cfg.layers.forEach((L, i) => {
    const band = prof.bands[L.band] || prof.bands[0];
    const t = ridgeTops(W, band, prof.size, { span: L.span, off: L.off, base: L.base * H, amp: L.amp * H * rf * (L.tall || 1), gamma: L.gamma || gm, smooth: i === 0 || !!L.valley });
    if (L.valley) {
      // vast walls either side of a narrow glen: the real crest is lifted toward the screen edges and sunk toward the middle
      for (let x = 0; x < W; x++) { const e = Math.pow(Math.abs((2 * x) / W - 1), L.valley.pow), k = L.valley.floor + (1 - L.valley.floor) * e; t[x] = Math.round(L.base * H - (L.base * H - t[x]) * k - L.valley.lift * H * e); }
    }
    tops.push(t);
    ridgeLayer(r, i + 1, W, H, t, {
      upper: L.upper, lower: L.lower, fade: Math.max(4, L.fade * H), rim: L.rim, rim2: L.rim2, rimDens: L.rimDens,
      contours: L.contours, cstep: (L.cstep || 5) * sc, cline: L.cline,
    });
    if (L.trees) pines(r, i + 1, t, W, L.trees, seed + i, sc, C.ink);
  });
  S.tops = tops;
  S.glints = [];
  if (cfg.ground.kind === 'moor') S.glints = paintMoor(r, W, H, Math.round(cfg.ground.top * H), cfg.ground.lochans, seed, cfg.stops, sunX);
  S.sc = sc;
  const motif = spec.motif || cfg.motif;
  if (motif === 'stag') {
    const x = Math.round(W * 0.23);
    drawStag(r, x, tops[0][x] + 2, 0.78 * sc * 1.3, C.ink, 1);
  } else if (motif === 'figure') {
    S.lantern = drawWanderer(r, Math.round(W * 0.5), Math.round(H * 0.9), Math.max(1, Math.round(2 * sc)), 4, C.heather);
  } else if (motif === 'ravens') {
    S.ravens = [0, 1, 2, 3].map((i) => ({ x: hash2f(i, 1, seed) * W, y: H * (0.18 + 0.22 * hash2f(i, 2, seed)), sp: 7 + i * 2, ph: i * 1.3 }));
  } else if (motif === 'cairn') {
    const t = tops[0];
    let px = 0, py = 1e9;
    for (let x = Math.round(W * 0.2); x < W * 0.8; x++) if (t[x] < py) { py = t[x]; px = x; }
    const s = Math.max(1, Math.round(sc * 2));
    [[-3, 3], [-2, 2], [-1, 1], [0, 0]].forEach(([a, b], k) => { for (let i = a; i <= b; i++) r.rect(px + i * s, py - (k + 1) * s * 2 + s, s, s * 2, C.ink, 1); });
    r.rect(px - 3 * s, py - s, s * 7, s * 2, C.ink, 1);
  } else if (motif === 'snow') {
    S.flakes = [];
    for (let i = 0; i < 46; i++) S.flakes.push({ x: hash2f(i, 1, seed + 33) * W, y: H * (0.3 + 0.62 * hash2f(i, 2, seed + 33)), sp: 40 + hash2f(i, 3, seed + 33) * 60, len: 4 + Math.floor(hash2f(i, 4, seed + 33) * 10) });
  }
  S.bands = cfg.mist.map((m, i) => mistBand(W, Math.max(6, Math.round(m.hh * H)), seed + i + 1, { y: Math.round(m.y * H - (m.hh * H) / 2), layerMax: m.layerMax, speed: m.speed, dens: m.dens, phase: (i + 1) * 37 }));
  S.sunX = sunX;
}

function animScene(r, spec, S, t) {
  const W = r.w, sc = S.sc || 1;
  for (const s of S.stars || []) {
    const k = Math.sin(t * 1.7 + s.ph);
    if (k > 0.8 || r.lay[s.y * W + s.x] !== 0) continue;
    r.d[s.y * W + s.x] = k > 0.2 ? C.paper2 : C.rock;
  }
  for (const b of S.bands) drawMistBand(r, b, t);
  for (const g of S.glints || []) {
    const k = Math.sin(t * 2.2 + g[0] * 0.7 + g[1] * 1.3);
    if (k > 0.55) r.px(g[0], g[1], lift(lift(g[2])));
  }
  if (S.ravens) S.ravens.forEach((b, i) => drawBird(r, Math.round(((b.x + t * b.sp) % (W + 20)) - 10), Math.round(b.y + Math.sin(t * 0.8 + b.ph) * 4), Math.floor(t * 3 + b.ph) & 1, i % 2 ? C.ink : C.blood, Math.max(1, sc * 1.4)));
  if (S.flakes) {
    for (const f of S.flakes) {
      const x = Math.round(((f.x + t * f.sp) % (W + 30)) - 15), y = Math.round(f.y + Math.sin(t * 1.3 + f.x) * 2);
      for (let i = 0; i < f.len; i++) r.px(x - i, y, i < 2 ? C.paper : i < f.len - 3 ? C.bolt : C.rock);
    }
  }
  if (S.lantern) {
    const f = 0.55 + 0.45 * vnoise(t * 6, 3.3, S.seed + 50);
    lanternGlow(r, S.lantern.x, S.lantern.y, Math.round(16 * Math.max(1, sc)), 4, f * 0.8);
    r.px(S.lantern.x, S.lantern.y, f > 0.7 ? C.flame : C.lamp);
  }
}

// ======================================================================================== RIDGE
function paintRidge(r, spec, S) {
  const lv = levelOf(spec.levelIndex);
  paintScene(r, spec, S, MOODS[lv.id] || MOODS.rannoch);
  if (spec.locked) desaturate(r);
}
/** locked tracks are painted in cold greys: the colour is the reward */
function desaturate(r) {
  const GREY = [C.ink, C.night, C.dusk, C.rock];
  const lum = new Map();
  for (const n of PAL_NAMES) { const v = parseInt(PAL[n].slice(1), 16); lum.set(C[n], (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255); }
  for (let i = 0; i < r.d.length; i++) {
    const l = lum.get(r.d[i]) ?? 0;
    r.d[i] = l < 0.12 ? GREY[0] : l < 0.3 ? GREY[1] : l < 0.5 ? GREY[2] : GREY[3];
  }
}

// ======================================================================================== BOTHY
function paintBothy(r, spec, S) {
  const W = r.w, H = r.h, sc = H / 216;
  const seed = 9000 + (spec.levelIndex | 0) * 19 + (spec.seed | 0);
  S.seed = seed; S.sc = sc;
  const horizon = Math.round(H * 0.7);
  // a vast sky: black overhead bleeding to a low bruise of blood and heather at the horizon
  paintSky(r, W, H, horizon, [C.ink, C.ink, C.blood, C.heather, C.rust], 1.35);
  paintStreaks(r, W, horizon, seed + 3, 0.8);
  S.stars = [];
  for (let i = 0; i < Math.round(W * H * 0.0006); i++) S.stars.push({ x: Math.floor(hash2f(i, 1, seed + 40) * W), y: Math.floor(Math.pow(hash2f(i, 2, seed + 40), 1.5) * horizon * 0.55), ph: hash2f(i, 3, seed + 40) * 6.28 });
  S.stars = S.stars.filter((s) => r.get(s.x, s.y) === C.ink);
  // far hills, barely there: a darker swell on the horizon
  for (let x = 0; x < W; x++) {
    const h0 = Math.round(horizon - 4 * sc - 7 * sc * vnoise(x * 0.012, 2, seed) - 3 * sc * vnoise(x * 0.04, 7, seed));
    for (let y = h0; y < H; y++) r.px(x, y, bay(x, y) < clamp((y - h0) / (14 * sc), 0, 1) * 0.7 + 0.1 ? C.blood : C.heather, 1);
  }
  // the moor: black peat, its far edge lit faintly red, heather and dun grass flecking
  for (let y = horizon - 2; y < H; y++) {
    const t = (y - horizon) / (H - horizon);
    for (let x = 0; x < W; x++) {
      const warm = bay(x, y) < Math.max(0, 0.42 - t * 1.1);
      let c = warm ? C.blood : (bay(x + 2, y + 1) < 0.05 * (1 - t) ? C.heather : C.ink);
      const k = hash2f(x, y, seed + 70);
      if (k < 0.006 * (1 - t * 0.5)) c = k < 0.002 ? C.contourIdx : k < 0.004 ? C.rust : C.heather;
      r.px(x, y, c, 2);
    }
  }
  // the bothy: a black box with a pitched roof, small against the immensity
  const bx = Math.round(W * 0.64), by = Math.round(horizon + 5 * sc);
  const bw = Math.max(6, Math.round(28 * sc)), bh = Math.max(3, Math.round(11 * sc));
  r.rect(bx, by - bh, bw, bh, C.ink, 3);
  for (let k = 0; k < Math.round(6 * sc); k++) r.rect(bx - 1 + k, by - bh - 1 - k, bw + 2 - 2 * k, 1, C.ink, 3);
  r.rect(bx + bw - Math.max(2, Math.round(3 * sc)), by - bh - Math.round(6 * sc), Math.max(2, Math.round(2 * sc)), Math.round(5 * sc), C.ink, 3);
  // the faint path to the door, a pale thread through the heather
  for (let y = by; y < H; y++) {
    const t = (y - by) / (H - by);
    const x = Math.round(bx + bw * 0.4 - t * W * 0.22 + Math.sin(t * 5) * 6 * sc * t);
    for (let k = -Math.round(t * 2 + 0.5); k <= Math.round(t * 2 + 0.5); k++) if (bay(x + k, y) < 0.16) r.px(x + k, y, C.heather, 2);
  }
  S.window = { x: bx + Math.round(bw * 0.3), y: by - bh + Math.max(1, Math.round(2.5 * sc)), w: Math.max(2, Math.round(5 * sc)), h: Math.max(2, Math.round(4 * sc)) };
  S.chimney = { x: bx + bw - Math.max(1, Math.round(2 * sc)), y: by - bh - Math.round(7 * sc) };
  S.bands = [mistBand(W, Math.round(H * 0.1), seed + 1, { y: Math.round(horizon - H * 0.03), layerMax: 1, speed: 3, dens: 0.8, phase: 5 }), mistBand(W, Math.round(H * 0.12), seed + 2, { y: Math.round(H * 0.88), layerMax: 3, speed: 6, dens: 0.45, phase: 9 })];
  if (spec.locked) desaturate(r);
}
function animBothy(r, spec, S, t) {
  const W = r.w, H = r.h, sc = S.sc || 1;
  for (const s of S.stars) { const k = Math.sin(t * 1.5 + s.ph); if (k < 0.75) r.px(s.x, s.y, k > 0.2 ? C.paper2 : C.rock); }
  for (const b of S.bands) drawMistBand(r, b, t);
  // the window: the one warm thing in the whole dark, flickering
  const w = S.window, f = vnoise(t * 6, 0.5, S.seed + 40), hot = f > 0.55;
  const cx = w.x + (w.w >> 1), cy = w.y + (w.h >> 1);
  const rad = Math.round(44 * sc * (0.85 + f * 0.3));
  for (let y = -rad; y <= rad; y++) for (let x = -Math.round(rad * 1.4); x <= Math.round(rad * 1.4); x++) {
    const d = Math.hypot(x / 1.4, y);
    if (d > rad || d < 1) continue;
    const X = cx + x, Y = cy + y;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const k = Math.pow(1 - d / rad, 1.8) * 1.1;
    if (bay(X, Y) < k) { const i = Y * W + X; if (r.lay[i] !== 3) r.d[i] = d < rad * 0.35 ? lift(lift(lift(r.d[i]))) : d < rad * 0.65 ? lift(lift(r.d[i])) : lift(r.d[i]); }
  }
  r.rect(w.x, w.y, w.w, w.h, hot ? C.flame : C.lamp);
  if (hot) r.px(w.x, w.y, C.paper);
  // the thread of smoke: a wavering line of dots climbing, bending with the wind, fading to the sky
  const n = Math.round(46 * sc);
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const xi = Math.round(S.chimney.x + Math.sin(a * 5 + t * 0.9) * (1 + a * 6) * sc + a * a * 28 * sc);
    const yi = Math.round(S.chimney.y - a * 58 * sc);
    if (yi < 0) continue;
    if (bay(xi, yi) < 0.98 - a * 0.8) { r.px(xi, yi, a < 0.6 ? C.rock : C.heather); r.px(xi + 1, yi, a < 0.6 ? C.rock : C.heather); }
    if (a < 0.6 && bay(xi + 2, yi) < 0.5) r.px(xi + 2, yi, C.heather);
  }
}

// ======================================================================================== STONE
function paintStone(r, spec, S) {
  const W = r.w, H = r.h, sc = H / 216;
  const li = spec.levelIndex | 0;
  const seed = 11000 + li * 29 + (spec.seed | 0);
  S.seed = seed; S.sc = sc;
  const horizon = Math.round(H * 0.7);
  paintSky(r, W, H, horizon, [C.night, C.blood, C.heather, C.rust, C.ember, C.lamp, C.flame], 1.05);
  paintStreaks(r, W, horizon, seed + 3, 1);
  paintSun(r, Math.round(W * 0.5), Math.round(H * 0.66), Math.round(18 * sc), 4.6);
  const prof = profileOf(li);
  const t1 = ridgeTops(W, prof.bands[0], prof.size, { span: 0.8, off: 6, base: H * 0.68, amp: H * 0.16, gamma: prof.gamma, smooth: true });
  ridgeLayer(r, 1, W, H, t1, { upper: C.heather, lower: C.blood, fade: H * 0.12, rim: C.rust, contours: 3, cstep: 4 * sc });
  const t2 = ridgeTops(W, prof.bands[1], prof.size, { span: 0.8, off: 30, base: H * 0.78, amp: H * 0.12, gamma: prof.gamma });
  ridgeLayer(r, 2, W, H, t2, { upper: C.blood, lower: C.ink, fade: H * 0.14, rim: C.heather });
  const top = Math.round(H * 0.84);
  for (let y = top; y < H; y++) for (let x = 0; x < W; x++) {
    const t = (y - top) / (H - top), k = hash2f(x, y, seed + 70);
    r.px(x, y, bay(x, y) < 0.35 * (1 - t) ? C.rust : k < 0.05 ? C.contour : k < 0.1 ? C.contourIdx : (bay(x + 1, y) < 0.3 ? C.blood : C.ink), 3);
  }
  // the symbol stone: a tall tapering slab, lit warm on its sunward face, the crescent and V-rod incised
  const sh = Math.round(H * 0.5), sw0 = Math.round(W * 0.085), baseY = Math.round(H * 0.86), cx = Math.round(W * 0.5);
  for (let y = 0; y < sh; y++) {
    const t = y / sh;
    const half = Math.round(sw0 * (0.62 + 0.38 * t) + 2 * Math.sin(t * 5 + seed));
    const left = cx - half, right = cx + half;
    const topCap = y < sh * 0.1 ? Math.round((1 - y / (sh * 0.1)) * half * 0.6) : 0;
    for (let x = left + topCap; x <= right - topCap; x++) {
      const nx = (x - left) / (2 * half), k = hash2f(x, y, seed + 5);
      let c = nx < 0.2 ? (bay(x, y) < 0.6 ? C.ember : C.rust) : nx < 0.5 ? (k < 0.35 ? C.heather : C.blood) : (k < 0.3 ? C.blood : C.ink);
      if (x === left + topCap) c = C.lamp;
      if (x === right - topCap) c = C.ink;
      r.px(x, baseY - sh + y, c, 4);
    }
  }
  const sx = cx, sy = baseY - sh + Math.round(sh * 0.36), R = Math.round(sw0 * 0.62);
  S.symbol = [];
  for (let a = 0.9; a < 2 * Math.PI - 0.9; a += 0.025) { S.symbol.push([Math.round(sx + Math.cos(a) * R), Math.round(sy + Math.sin(a) * R)]); S.symbol.push([Math.round(sx + Math.cos(a) * (R - 3 * sc)) + Math.round(R * 0.3), Math.round(sy + Math.sin(a) * (R - 3 * sc))]); }
  const addLine = (a, b) => { const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); for (let i = 0; i <= n; i++) S.symbol.push([Math.round(a[0] + ((b[0] - a[0]) * i) / n), Math.round(a[1] + ((b[1] - a[1]) * i) / n)]); };
  addLine([sx - R, sy + R * 1.3], [sx, sy + R * 2.2]); addLine([sx, sy + R * 2.2], [sx + R, sy + R * 1.3]);
  addLine([sx - R * 1.1, sy + R * 1.9], [sx + R * 1.1, sy + R * 1.0]); addLine([sx, sy - R * 0.3], [sx, sy + R * 3.4]);
  for (const [x, y] of S.symbol) r.px(x, y, C.ink, 4);
  S.bands = [mistBand(W, Math.round(H * 0.09), seed + 1, { y: Math.round(H * 0.74), layerMax: 2, speed: 3, dens: 0.75, phase: 5 }), mistBand(W, Math.round(H * 0.1), seed + 2, { y: Math.round(H * 0.9), layerMax: 3, speed: 6, dens: 0.5, phase: 9 })];
  S.cx = cx; S.sy = sy; S.baseY = baseY;
}
function animStone(r, spec, S, t) {
  const W = r.w, H = r.h;
  for (const b of S.bands) drawMistBand(r, b, t);
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.3);
  for (const [x, y] of S.symbol) r.px(x, y, pulse > 0.5 ? C.flame : C.ember, 4);
  const rad = Math.round(H * 0.3);
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    const d = Math.hypot(x * 0.7, y);
    if (d > rad) continue;
    const X = S.cx + x, Y = S.sy + y;
    if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
    const i = Y * W + X;
    if (r.lay[i] === 4) continue;
    if (bay(X, Y) < Math.pow(1 - d / rad, 2.2) * (0.35 + pulse * 0.15)) r.d[i] = lift(r.d[i]);
  }
  for (let i = 0; i < 16; i++) {
    const a = (t * 0.07 + i / 16) % 1;
    r.px(Math.round(S.cx + Math.sin(i * 2.7 + t * 0.6) * H * 0.2), Math.round(S.baseY - a * H * 0.5), a < 0.6 ? C.flame : C.rust);
  }
}

// ======================================================================================== DAWN
function paintDawn(r, spec, S) {
  const W = r.w, H = r.h, sc = H / 216;
  const seed = 13000 + (spec.seed | 0);
  S.seed = seed; S.sc = sc;
  const horizon = Math.round(H * 0.66);
  paintSky(r, W, H, horizon, [C.blood, C.heather, C.rust, C.ember, C.lamp, C.flame, C.paper], 1.0);
  paintStreaks(r, W, horizon, seed + 3, 1.1);
  paintSun(r, Math.round(W * 0.5), Math.round(H * 0.64), Math.round(22 * sc), 4.8);
  // eight ridges, one for each glen, from the palest to the blackest
  const ups = [C.rust, C.heather, C.heather, C.blood, C.blood, C.ink, C.ink, C.ink];
  const lows = [C.heather, C.blood, C.blood, C.ink, C.ink, C.ink, C.ink, C.ink];
  const rims = [C.ember, C.rust, C.rust, C.heather, C.heather, C.blood, C.blood, C.blood];
  for (let i = 0; i < 8; i++) {
    const prof = profileOf(i);
    const t = ridgeTops(W, prof.bands[i % 3], prof.size, { span: 0.8, off: (i * 13) % 50, base: H * (0.6 + i * 0.045), amp: H * (0.2 + 0.03 * i), gamma: prof.gamma, smooth: i < 3 });
    ridgeLayer(r, Math.min(i + 1, 7), W, H, t, { upper: ups[i], lower: lows[i], fade: H * 0.1, rim: rims[i], contours: i < 4 ? 2 : 0, cstep: 5 * sc });
  }
  S.bands = [0.62, 0.72, 0.82, 0.92].map((y, i) => mistBand(W, Math.round(H * 0.08), seed + i + 1, { y: Math.round(H * y), layerMax: 7, speed: 3 + i * 2, dens: 0.7 - i * 0.08, phase: 11 * (i + 1) }));
}
function animDawn(r, spec, S, t) { for (const b of S.bands) drawMistBand(r, b, t); }

// ======================================================================================== TITLE
// The cover is three full-bleed paintings of one idea (a standing stone on an Ordnance Survey sheet); titleart.js paints them
// and spec.variant ('A' Survey, 'B' Summit, 'C' Close) picks one. The field each draws on is a track's own heightfield.
function paintTitle(r, spec, S) { paintTitleArt(r, spec, S); }
function animTitle(r, spec, S, t) { animTitleArt(r, spec, S, t); }

// ======================================================================================== registry
const PAINTERS = {
  ridge: [paintRidge, animScene], bothy: [paintBothy, animBothy], stone: [paintStone, animStone], dawn: [paintDawn, animDawn], title: [paintTitle, animTitle],
};
export const PANEL_KINDS = Object.freeze(Object.keys(PAINTERS));
export { TITLE_VARIANTS, TITLE_DEFAULT, TITLE_LAYOUT, TITLE_LEVELS, Raster, paintStandingStone };

const cache = new Map();
const variantOf = (spec) => (spec.kind === 'title' ? (TITLE_VARIANTS.includes(spec.variant) ? spec.variant : TITLE_DEFAULT) : '');
const stemOf = (spec) => `${spec.kind}|${spec.levelIndex | 0}|${spec.seed | 0}|${spec.motif || ''}|${spec.locked ? 'L' : ''}|${variantOf(spec)}|`;
/** 'p' once the field(s) a panel draws on are real, 'q' while it still uses stand-ins (the panel is then repainted once). */
const readyOf = (spec) => (spec.kind === 'title' ? TITLE_LEVELS[variantOf(spec)].every((i) => hasTerrain(i)) : hasProfile(spec.levelIndex | 0));
const cacheKey = (spec, W, H) => `${stemOf(spec)}${readyOf(spec) ? 'p' : 'q'}|${W}x${H}`;

/** The cached state of a panel: base raster, work raster, per-panel animation data. */
export function getPanel(spec, W = PANEL.w, H = PANEL.h) {
  // a screen that asks for it ({ warm: true }) has the fields its cover draws on built first (about 100 ms each, once), so it never shows a stand-in
  if (spec.warm && spec.kind === 'title') for (const i of TITLE_LEVELS[variantOf(spec)]) warmProfile(i);
  const key = cacheKey(spec, W, H);
  let p = cache.get(key);
  if (p) return p;
  const pair = PAINTERS[spec.kind];
  if (!pair) throw new Error('unknown panel kind ' + spec.kind);
  const base = new Raster(W, H);
  const S = {};
  pair[0](base, spec, S);
  const work = new Raster(W, H);
  p = { key, spec, W, H, base, work, S, anim: pair[1], img: null };
  cache.set(key, p);
  // an older version of the same panel (stand-in profile) is dropped once the real one arrives
  for (const k of [...cache.keys()]) if (k !== key && k.startsWith(stemOf(spec)) && k.endsWith(`|${W}x${H}`)) cache.delete(k);
  return p;
}

/** Paint the panel at time t (seconds) into its work raster and return the pixels (Uint32Array, W*H). */
export function renderPanel(spec, W = PANEL.w, H = PANEL.h, t = 0) {
  const p = getPanel(spec, W, H);
  p.work.d.set(p.base.d);
  p.work.lay.set(p.base.lay);
  if (p.anim && t != null) p.anim(p.work, spec, p.S, t);
  return p.work.d;
}
/** The base picture alone (no animation): what the tests hash and the tracklist thumbnails use. */
export function paintBase(spec, W = PANEL.w, H = PANEL.h) { return getPanel(spec, W, H).base.d; }
/** A fresh, uncached paint of the base (for determinism tests). */
export function freshBase(spec, W = PANEL.w, H = PANEL.h) {
  const pair = PAINTERS[spec.kind];
  const base = new Raster(W, H);
  pair[0](base, spec, {});
  return base.d;
}

/** FNV-1a over the pixels. */
export function pixelHash(d) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/** Browser: put the panel at (x, y) on the canvas context (a single putImageData). */
export function drawPanel(ctx, spec, x, y, W = PANEL.w, H = PANEL.h, t = 0, still = false) {
  const p = getPanel(spec, W, H);
  const d = still ? paintBase(spec, W, H) : renderPanel(spec, W, H, t);
  if (!p.img || p.imgSrc !== d) { p.img = new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset, d.length * 4), W, H); p.imgSrc = d; }
  ctx.putImageData(p.img, x | 0, y | 0);
}
