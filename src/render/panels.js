/**
 * Story panels: small night paintings made in code, no image assets.
 *
 * Every painter writes palette colours (never blended: ordered dither only) into a Uint32Array
 * raster, so the same code runs in Node (tests hash the pixels) and in the browser (the raster
 * is put straight onto the canvas). A panel is painted once into a cached base raster, plus a
 * layer map saying which depth each pixel belongs to; per frame a copy of the base gets the cheap
 * animation on top (drifting mist bands that respect the depth order, twinkling stars, smoke,
 * flicker, lightning).
 *
 *   spec = { kind: 'ridge'|'cross'|'bothy'|'gate'|'title', levelIndex, seed?, locked? }
 *
 *   ridge   dithered night sky, crescent moon, 3 layers of hills taken from the track's own
 *           heightfield, mist; tinted by the track's accent hue
 *   cross   a Celtic ring-cross among ruined arches, ice-lit, with a lightning bolt
 *   bothy   the snowed-in hut at night: diagonal streaked cloud, orange windows, chimney smoke
 *   gate    a misty stone gateway with the wanderer standing at it
 *   title   ridges, fog, the ring-cross gate and the wanderer with a lit lantern (title screen)
 */
import { PAL, PAL_NAMES, PAL_U32 as C, BAYER8 } from './palette.js';
import { hash2f } from '../core/rng.js';
import * as SP from './sprites.js';
import { LEVELS } from '../world/levels/index.js';
import { createSculptKit } from '../world/sculpt.js';

/** Where the letterboxed picture sits inside the filmstrip frame (screens.js draws the frame around it). */
export const PANEL = Object.freeze({ x: 32, y: 12, w: 320, h: 136 });
/** The title screen's night scene window. */
export const TITLE_SCENE = Object.freeze({ w: 312, h: 90 });
/** Tracklist thumbnails. */
export const THUMB = Object.freeze({ w: 112, h: 84 });

// ----------------------------------------------------------------------------- raster
const bay = (x, y) => (BAYER8[((y & 7) << 3) | (x & 7)] + 0.5) / 64;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const HEX2U32 = Object.fromEntries(PAL_NAMES.map((n) => [PAL[n].toLowerCase(), C[n]]));

class Raster {
  constructor(w, h, d) { this.w = w; this.h = h; this.d = d || new Uint32Array(w * h); this.lay = new Uint8Array(w * h); }
  px(x, y, c, l) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.d[i] = c;
    if (l !== undefined) this.lay[i] = l;
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[y * this.w + x]; }
  layer(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.lay[y * this.w + x]; }
  rect(x, y, w, h, c, l) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, l); }
  /** ordered dither of colour c at density 0..1 over a rect (pattern anchored to the raster) */
  dith(x, y, w, h, c, dens, l) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (bay(x + i, y + j) < dens) this.px(x + i, y + j, c, l);
  }
  line(x0, y0, x1, y1, c, l) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c, l);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  disc(cx, cy, rad, c, l) {
    for (let y = -rad; y <= rad; y++) {
      const w = Math.floor(Math.sqrt(rad * rad + rad * 0.6 - y * y));
      for (let x = -w; x <= w; x++) this.px(cx + x, cy + y, c, l);
    }
  }
}

/** value noise on an integer lattice; px/py > 0 make it wrap (tileable) */
function vnoise(x, y, seed, per = 0, perY = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const H = (i, j) => hash2f(per ? ((i % per) + per) % per : i, perY ? ((j % perY) + perY) % perY : j, seed);
  const a = H(x0, y0), b = H(x0 + 1, y0), c = H(x0, y0 + 1), d = H(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
function fbm(x, y, seed, oct = 3) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2; }
  return v / n;
}

/** One step lighter on the night ramp: what mist and cloud do to whatever lies beneath. */
const LIFT = new Map([
  [C.ink, C.night], [C.night, C.dusk], [C.dusk, C.waterInk], [C.waterInk, C.grid], [C.grid, C.water],
  [C.woodDark, C.wood], [C.contourIdx, C.contour], [C.contour, C.paper2],
  [C.bog, C.water], [C.wood, C.paper2], [C.rock, C.paper2],
]);
const lift = (c) => LIFT.get(c) || c;
/** and a gentler lift for mist on dark sky: ink -> night -> dusk -> rock */
const MIST = new Map([[C.ink, C.night], [C.night, C.dusk], [C.dusk, C.rock], [C.waterInk, C.grid], [C.grid, C.water], [C.woodDark, C.dusk], [C.contourIdx, C.dusk], [C.contour, C.rock]]);
const mist = (c) => MIST.get(c) || c;

// ----------------------------------------------------------------------------- track data
const accentU = (levelIndex) => {
  const lv = LEVELS[levelIndex] || LEVELS[0];
  const n = lv && lv.palette && lv.palette.accent;
  return n && C[n] ? C[n] : C.magenta;
};
const levelOf = (i) => LEVELS[clamp(i | 0, 0, LEVELS.length - 1)];

/**
 * The skyline of a track: three slabs of the heightfield (north = far, south = near) reduced to the
 * highest ground in each column, 0..1 of the track's own height range. Built from world.heightAt
 * (the real map), so every track's panels are its own place.
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
    // each slab uses the full height of the picture: its lowest ground to its highest summit (a flat slab stays flat)
    const sorted = Array.from(out).sort((a, b) => a - b);
    const lo = sorted[Math.floor(size * 0.05)], hi = Math.max(sorted[size - 1], lo + 0.3);
    for (let x = 0; x < size; x++) out[x] = clamp((out[x] - lo) / (hi - lo), 0, 1);
    for (let x = 1; x < size; x++) rough += Math.abs(out[x] - out[x - 1]);
    return out;
  });
  rough /= 3 * (size - 1);
  // jagged ranges (the Cuillin, Nevis) get their peaks pushed up; broad moor is eased
  return { size, bands, relief: span, gamma: clamp(0.85 + rough * 4.5, 0.85, 1.7) };
}
const profiles = new Map();
export function setProfile(levelIndex, profile) { profiles.set(levelIndex, profile); }
export function hasProfile(levelIndex) { return profiles.has(levelIndex); }
export function getProfile(levelIndex) { return profiles.get(levelIndex) || null; }
/** Seed a track's profile from a built world (main.js does this on entering a track). */
export function setProfileFromWorld(levelIndex, world) { profiles.set(levelIndex, buildProfile((x, y) => world.heightAt(x, y), world.minH, world.maxH, world.size || 256)); }
/**
 * Build a track's profile from its sculpt alone (about 100 ms, no hydrology or cover): used to give the
 * tracklist every track's real skyline without building eight worlds. Returns true once it exists.
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
  const at = (x, y) => h[Math.min(S - 1, y) * S + Math.min(S - 1, x)];
  profiles.set(levelIndex, buildProfile(at, lo, hi, S));
  return true;
}
/** A believable stand-in skyline until the real one is built (so a panel is never empty). */
function standIn(levelIndex) {
  const lv = levelOf(levelIndex);
  const seed = (lv.seed | 0) + 77;
  const bands = [0, 1, 2].map((b) => {
    const out = new Float32Array(256);
    for (let x = 0; x < 256; x++) out[x] = clamp(0.15 + 0.6 * fbm(x * 0.03 + b * 9, b * 3.1, seed + b, 4), 0, 1);
    return out;
  });
  const e = lv.elevation || { min: 0, max: 800 };
  return { size: 256, bands, relief: e.max - e.min, provisional: true };
}
const profileOf = (i) => profiles.get(i) || standIn(i);

// ----------------------------------------------------------------------------- shared painters
const SKY_STOPS = [C.ink, C.night, C.dusk];

function paintSky(r, W, H, horizon, accent, seed, locked) {
  for (let y = 0; y < H; y++) {
    const t = clamp(y / horizon, 0, 1);
    const pos = t * 3;
    const i = Math.min(2, Math.floor(pos));
    const f = pos - i;
    for (let x = 0; x < W; x++) {
      let c;
      if (i < 2) c = bay(x, y) < f ? SKY_STOPS[i + 1] : SKY_STOPS[i];
      else {
        // the last stretch to the horizon: dusk, with a breath of the track's hue
        c = SKY_STOPS[2];
        if (!locked && bay(x, y) < clamp((f - 0.25) * 0.4, 0, 0.14) && ((x + y) & 1) === 0) c = accent;
      }
      if (locked && i >= 1) c = bay(x, y) < f * 0.6 && i === 1 ? C.night : C.night;
      r.px(x, y, c, 0);
    }
  }
  // streaks of cloud, long and shallow
  for (let y = 0; y < Math.min(H, horizon); y++) {
    for (let x = 0; x < W; x++) {
      const v = vnoise(x * 0.016, (y + x * 0.16) * 0.085, seed + 3) * 0.7 + vnoise(x * 0.04, (y + x * 0.16) * 0.2, seed + 5) * 0.3;
      const k = clamp((v - 0.56) * 3.4, 0, 1) * (0.35 + 0.65 * Math.sin((y / horizon) * Math.PI * 0.9));
      if (k > 0 && bay(x + 3, y + 5) < k * 0.55) r.px(x, y, lift(r.get(x, y)), 0);
    }
  }
}

function paintStars(r, W, H, horizon, seed) {
  const stars = [];
  for (let i = 0; i < Math.round(W * horizon * 0.0035); i++) {
    const x = Math.floor(hash2f(i, 1, seed + 40) * W), y = Math.floor(Math.pow(hash2f(i, 2, seed + 40), 1.4) * horizon * 0.8);
    stars.push({ x, y, ph: hash2f(i, 3, seed + 40) * 6.28, c: hash2f(i, 4, seed + 40) < 0.2 ? C.snow : C.rock });
  }
  return stars;
}

function paintMoon(r, mx, my, rad, locked) {
  if (locked) return;
  const halo = Math.round(rad * 2.6);
  for (let y = -halo; y <= halo; y++) for (let x = -halo; x <= halo; x++) {
    const d = Math.hypot(x, y);
    if (d > halo || d < rad) continue;
    const k = Math.pow(1 - d / halo, 1.8) * 0.5;
    if (bay(mx + x, my + y) < k) r.px(mx + x, my + y, lift(r.get(mx + x, my + y)), 0);
  }
  const ox = rad * 0.55, oy = -rad * 0.25, r2 = rad * 0.88;
  for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) {
    if (x * x + y * y > rad * rad + rad * 0.5) continue;
    if ((x - ox) * (x - ox) + (y - oy) * (y - oy) <= r2 * r2) continue;       // the bite that makes the crescent
    const edge = (x - ox) * (x - ox) + (y - oy) * (y - oy) <= (r2 + 1.6) * (r2 + 1.6);
    r.px(mx + x, my + y, edge && bay(mx + x, my + y) < 0.5 ? C.paper2 : C.paper, 0);
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
/** One layer of hills. Fills from the crest to the bottom with an upper/lower colour that fades by dither. */
function ridgeLayer(r, id, W, H, band, size, o) {
  const tops = ridgeTops(W, band, size, o);
  for (let x = 0; x < W; x++) {
    const top = clamp(tops[x], 2, H - 1);
    for (let y = top; y < H; y++) {
      const f = clamp((y - top) / o.fade, 0, 1);
      const c = bay(x, y) < f ? o.lower : o.upper;
      r.px(x, y, c, id);
    }
    if (o.rim && (!o.rimDens || bay(x, top) < o.rimDens)) {
      r.px(x, top, o.rim, id);
      if (o.rim2 && bay(x, top + 1) < 0.5) r.px(x, top + 1, o.rim2, id);
    }
  }
  return tops;
}

function conifers(r, id, tops, W, density, seed, col) {
  for (let x = 2; x < W - 2; x++) {
    if (hash2f(x, 9, seed) > density) continue;
    const h = 4 + Math.floor(hash2f(x, 10, seed) * 6), top = tops[x];
    for (let k = 0; k < h; k++) {
      const w = Math.floor((k + 1) / 3);
      for (let i = -w; i <= w; i++) r.px(x + i, top - h + k + 2, col, id);
    }
  }
}

// ----------------------------------------------------------------------------- mist bands (animated)
/** A tileable streaky noise strip; scrolling it is the whole animation. */
function mistBand(W, rows, seed, opts) {
  const TW = 512;
  const tex = new Float32Array(TW * rows);
  for (let y = 0; y < rows; y++) {
    const env = Math.pow(Math.max(0, 1 - Math.abs((y - rows / 2) / (rows / 2))), 0.9);
    for (let x = 0; x < TW; x++) {
      const n = vnoise(x / 22, y / 3.2, seed, TW / 22, 0) * 0.65 + vnoise(x / 9, y / 1.6, seed + 11, TW / 9, 0) * 0.35;
      tex[y * TW + x] = clamp((n - 0.3) * 2.6, 0, 1) * env;
    }
  }
  return { tex, TW, rows, ...opts };
}
function drawMistBand(r, B, t) {
  const { tex, TW, rows, y: y0, layerMax, speed, dens } = B;
  const off = Math.floor(t * speed) + B.phase, bob = Math.round(Math.sin(t * 0.35 + B.phase) * 1.2);
  const W = r.w;
  for (let j = 0; j < rows; j++) {
    const y = y0 + j + bob;
    if (y < 0 || y >= r.h) continue;
    const row = j * TW;
    for (let x = 0; x < W; x++) {
      const v = tex[row + ((x + off) % TW + TW) % TW] * dens;
      if (v <= 0.02) continue;
      const i = y * W + x;
      if (r.lay[i] > layerMax) continue;
      if (bay(x, y) < v) r.d[i] = mist(r.d[i]);
      if (v > 0.62 && bay(x + 4, y + 2) < v - 0.45) r.d[i] = mist(r.d[i]);
    }
  }
}

function twinkle(r, stars, t) {
  for (const s of stars) {
    const k = Math.sin(t * 1.7 + s.ph);
    if (k > 0.85) continue;                      // blinks out for a moment
    if (r.lay[s.y * r.w + s.x] !== 0) continue;
    r.d[s.y * r.w + s.x] = k > 0.2 ? s.c : C.dusk;
  }
}

// ----------------------------------------------------------------------------- the wanderer, pixel-exact
function walkerPixels(frame) {
  if (typeof SP.walkerArt !== 'function') return null;
  const art = SP.walkerArt('S', 'idle', frame);
  const cmap = SP.COLORS || {};
  const out = [];
  art.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.' || ch === ' ') continue; const hex = cmap[ch]; const u = hex && HEX2U32[String(hex).toLowerCase()]; if (u) out.push([x, y, u, ch]); } });
  return out;
}
/** Draw the wanderer at integer scale, standing with feet at (fx, fy). Returns the lantern pixel. */
function drawWanderer(r, fx, fy, scale, frame, id, lanternCol, rimCol) {
  const px = walkerPixels(frame);
  const sz = SP.WALKER_SIZE || 12;
  const x0 = Math.round(fx - (sz * scale) / 2), y0 = fy - sz * scale;
  const a = typeof SP.lanternAnchor === 'function' ? SP.lanternAnchor('S', 'idle', frame) : { x: 9, y: 2 };
  if (!px) return { x: x0 + a.x * scale, y: y0 + a.y * scale, scale };
  for (const [x, y, u, ch] of px) {
    const c = ch === 'f' && lanternCol ? lanternCol : (ch === 'k' && rimCol ? rimCol : u);
    for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) r.px(x0 + x * scale + i, y0 + y * scale + j, c, id);
  }
  return { x: x0 + a.x * scale + Math.floor(scale / 2), y: y0 + a.y * scale + Math.floor(scale / 2), scale, x0, y0 };
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

// ----------------------------------------------------------------------------- bolt
function boltPath(seed, W, H, x0, ymax) {
  const pts = [];
  let x = x0, y = 0, s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return (s >>> 8) / 16777216; };
  while (y < ymax) {
    pts.push([x, y]);
    const dy = 5 + Math.floor(rnd() * 8);
    x += Math.round((rnd() - 0.5) * 18);
    y += dy;
  }
  pts.push([x, ymax]);
  const branch = [];
  const bi = 2 + Math.floor(rnd() * 2);
  if (pts[bi]) {
    let bx = pts[bi][0], by = pts[bi][1];
    branch.push([bx, by]);
    for (let k = 0; k < 3; k++) { bx += 7 + Math.floor(rnd() * 6); by += 5 + Math.floor(rnd() * 5); branch.push([bx, by]); }
  }
  return { pts, branch };
}
function drawBolt(r, bolt, glow) {
  const draw = (pts, thick) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = pts[i], [c, d] = pts[i + 1];
      r.line(a, b, c, d, C.bolt);
      if (thick) r.line(a + 1, b, c + 1, d, C.bolt);
    }
  };
  if (glow) {
    // a halo around the stroke, dithered
    const marks = [];
    for (let i = 0; i < bolt.pts.length - 1; i++) {
      const [a, b] = bolt.pts[i], [c, d] = bolt.pts[i + 1];
      const n = Math.max(Math.abs(c - a), Math.abs(d - b), 1);
      for (let k = 0; k <= n; k++) marks.push([Math.round(a + ((c - a) * k) / n), Math.round(b + ((d - b) * k) / n)]);
    }
    for (const [mx, my] of marks) for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const d = Math.hypot(x, y);
      if (d > 3.2 || d < 1) continue;
      const X = mx + x, Y = my + y;
      if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
      if (bay(X, Y) < 0.22 * (1 - d / 3.4)) r.d[Y * r.w + X] = lift(lift(r.d[Y * r.w + X]));
    }
  }
  draw(bolt.pts, true);
  draw(bolt.branch, false);
}

// ----------------------------------------------------------------------------- the ring-cross
/** Mask of a Celtic ring-cross standing with its foot at (cx, gy): { mask, w, h, ox, oy, ring } */
function crossMask(H) {
  const sh = Math.round(H);               // total height
  const ringR = Math.round(sh * 0.235), t = Math.max(3, Math.round(sh * 0.045));
  const cyOff = Math.round(ringR + 3);
  const arm = Math.round(ringR * 1.45);
  const shaft = Math.max(5, Math.round(sh * 0.09)), bar = Math.max(5, Math.round(sh * 0.09));
  const w = arm * 2 + 5, h = sh;
  const mask = new Uint8Array(w * h);
  const cx = Math.floor(w / 2), cy = cyOff;
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) mask[y * w + x] = 1; };
  // ring
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    if (d <= ringR && d >= ringR - t) set(x, y);
  }
  // shaft (slightly tapering) and bar
  for (let y = 0; y < h; y++) {
    const half = Math.floor(shaft / 2) + (y > cy + ringR ? Math.floor((y - cy - ringR) / 14) : 0);
    for (let x = -half; x <= half; x++) set(cx + x, y);
  }
  for (let x = -arm; x <= arm; x++) for (let y = -Math.floor(bar / 2); y <= Math.floor(bar / 2); y++) set(cx + x, cy + y);
  // the flared ends of the arms and head
  for (const [ex, ey] of [[cx - arm, cy], [cx + arm, cy], [cx, 0]]) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
    if (Math.abs(x) + Math.abs(y) <= 4 && (ex === cx ? y >= -1 : true)) set(ex + x + (ex < cx ? 1 : ex > cx ? -1 : 0), ey + y + (ex === cx ? 3 : 0));
  }
  return { mask, w, h, cx, cy, ringR, t, arm };
}

function paintRingCross(r, cx, gy, height, seed, accent) {
  const M = crossMask(height);
  const x0 = cx - M.cx, y0 = gy - M.h;
  const at = (x, y) => x >= 0 && y >= 0 && x < M.w && y < M.h && M.mask[y * M.w + x] === 1;
  // halo first: a dithered cyan light round the stone
  const halo = 5;
  for (let y = -halo; y < M.h + halo; y++) for (let x = -halo; x < M.w + halo; x++) {
    if (at(x, y)) continue;
    let dmin = 99;
    for (let j = -halo; j <= halo && dmin > 1; j++) for (let i = -halo; i <= halo; i++) {
      if (at(x + i, y + j)) { const d = Math.hypot(i, j); if (d < dmin) dmin = d; }
    }
    if (dmin <= halo) {
      const k = Math.pow(1 - dmin / (halo + 0.5), 1.5) * 0.34;
      const X = x0 + x, Y = y0 + y;
      if (Y < gy && bay(X, Y) < k) r.px(X, Y, ((X + Y) & 1) || dmin < 2.2 ? C.ice : C.waterInk, 1);
    }
  }
  // body: ink stone mossed from the foot upward; ice at the edge
  for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) {
    if (!at(x, y)) continue;
    const X = x0 + x, Y = y0 + y;
    const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
    let c;
    if (edge) c = C.ice;
    else {
      const down = y / M.h;
      const moss = hash2f(X, Y, seed + 21) < 0.12 + down * 0.5;
      c = moss ? (bay(X, Y) < 0.55 ? C.woodDark : C.ink) : (bay(X, Y) < 0.22 ? C.night : C.ink);
      if (moss && hash2f(X, Y, seed + 22) < 0.1) c = C.wood;
    }
    r.px(X, Y, c, 1);
  }
  // inlaid lines (the knotwork, in a single thread) and the boss
  const inlay = (xa, ya, xb, yb) => {
    const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya));
    for (let k = 0; k <= n; k += 1) {
      const x = Math.round(xa + ((xb - xa) * k) / n), y = Math.round(ya + ((yb - ya) * k) / n);
      if (at(x - x0 + x0 - x0, y - y0) && (k % 3 !== 2)) r.px(x0 + (x - x0), y, k % 2 ? C.waterInk : C.ice, 1);
    }
  };
  inlay(x0 + M.cx, y0 + 4, x0 + M.cx, y0 + M.h - 7);
  inlay(x0 + M.cx - M.arm + 4, y0 + M.cy, x0 + M.cx + M.arm - 4, y0 + M.cy);
  r.disc(x0 + M.cx, y0 + M.cy, 3, C.ink, 1);
  for (let a = 0; a < 8; a++) r.px(x0 + M.cx + Math.round(Math.cos(a * 0.785) * 3), y0 + M.cy + Math.round(Math.sin(a * 0.785) * 3), C.ice, 1);
  r.px(x0 + M.cx, y0 + M.cy, accent, 1);
  return { x0, y0, ...M };
}

// ----------------------------------------------------------------------------- brick and stone
function stoneFill(r, x, y, w, h, seed, o = {}) {
  const a = o.base || C.night, b = o.light || C.rock, m = o.moss === undefined ? 0.12 : o.moss;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = x + i, Y = y + j;
    const row = Math.floor(Y / 6), off = (row & 1) * 5;
    const mortar = (Y % 6 === 0) || ((X + off) % 11 === 0);
    let c = mortar ? C.ink : (hash2f(X >> 1, Y >> 1, seed) < (o.lit || 0.18) ? b : a);
    if (!mortar && hash2f(X, Y, seed + 5) < m) c = bay(X, Y) < 0.5 ? C.woodDark : c;
    r.px(X, Y, c, o.id);
  }
}

// ======================================================================================== RIDGE
function paintRidge(r, spec, S) {
  const W = r.w, H = r.h;
  const lv = levelOf(spec.levelIndex), prof = profileOf(spec.levelIndex);
  const accent = spec.locked ? C.rock : accentU(spec.levelIndex);
  const horizon = Math.round(H * 0.66);
  const seed = (lv.seed | 0) + (spec.seed | 0);
  S.seed = seed;
  paintSky(r, W, H, horizon, accent, seed, spec.locked);
  S.stars = paintStars(r, W, H, horizon, seed);
  const sc = W / 320;
  const rf = clamp(0.72 + prof.relief / 4000, 0.72, 1);
  const gm = prof.gamma || 1.1;
  const size = prof.size, off0 = Math.floor(hash2f(seed, 2, 5) * 12);
  const lock = !!spec.locked;
  const L1 = { span: 0.8, off: off0, base: H * 0.63, amp: H * 0.52 * rf, gamma: gm, smooth: true, fade: H * 0.28, upper: lock ? C.night : C.dusk, lower: C.night, rim: lock ? 0 : C.waterInk, rim2: 0, rimDens: 0.6 };
  const L2 = { span: 0.8, off: off0 + 22, base: H * 0.8, amp: H * 0.5 * rf, gamma: gm, fade: H * 0.26, upper: C.night, lower: C.ink, rim: lock ? 0 : C.dusk, rim2: 0 };
  const L3 = { span: 0.8, off: off0 + 40, base: H * 0.95, amp: H * 0.4 * rf, gamma: gm, fade: 6, upper: C.ink, lower: C.ink, rim: accent, rim2: lock ? 0 : accent };
  // the moon goes where the far hills leave the most sky
  const mr = Math.max(4, Math.round(9 * Math.min(1, sc * 1.05))), farTops = ridgeTops(W, prof.bands[0], size, L1);
  let mx = Math.round(W * 0.7), best = -1;
  for (let k = 0; k < 6; k++) {
    const cx = Math.round(W * (0.14 + 0.72 * hash2f(seed, 20 + k, 5)));
    let clear = 1e9;
    for (let x = cx - mr * 2; x <= cx + mr * 2; x++) clear = Math.min(clear, farTops[clamp(x, 0, W - 1)]);
    if (clear > best) { best = clear; mx = cx; }
  }
  paintMoon(r, mx, clamp(Math.round(best * 0.45), mr + 4, Math.round(H * 0.28)), mr, lock);
  ridgeLayer(r, 1, W, H, prof.bands[0], size, L1);
  ridgeLayer(r, 2, W, H, prof.bands[1], size, L2);
  const tops = ridgeLayer(r, 3, W, H, prof.bands[2], size, L3);
  const woods = (lv.cover && lv.cover.woodDensity) || 0;
  if (woods > 0.02 && !lock) conifers(r, 3, tops, W, clamp(woods * 0.3, 0.02, 0.1), seed, C.ink);
  // mist bands: sit between the layers and drift
  const mk = (y, hh, layerMax, speed, dens, ph) => mistBand(W, hh, seed + ph, { y: Math.round(y - hh / 2), layerMax, speed, dens, phase: ph * 37 });
  S.bands = [mk(H * 0.62, Math.round(H * 0.24), 1, 5, 0.8, 1), mk(H * 0.79, Math.round(H * 0.2), 2, 8, 0.85, 2), mk(H * 0.95, Math.round(H * 0.14), 3, 12, 0.7, 3)];
}
function animRidge(r, spec, S, t) {
  twinkle(r, S.stars, t);
  for (const b of S.bands) drawMistBand(r, b, t);
}

// ======================================================================================== CROSS
function paintCross(r, spec, S) {
  const W = r.w, H = r.h;
  const seed = 5000 + (spec.levelIndex | 0) * 31 + (spec.seed | 0);
  S.seed = seed;
  const accent = accentU(spec.levelIndex);
  const gy = Math.round(H * 0.8);
  r.rect(0, 0, W, H, C.ink, 0);
  // the walls behind: grey dithered masses top left and right, as the ruined abbey in the reference
  for (const [x0, w, hh] of [[0, Math.round(W * 0.2), Math.round(H * 0.34)], [Math.round(W * 0.78), Math.round(W * 0.22), Math.round(H * 0.4)]]) {
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const X = x0 + x, edgeD = Math.min(hh - y, Math.abs((x0 ? x : w - x))) ;
      const slant = (x0 ? x : w - 1 - x) * 0.45 + 2;
      if (y > hh - slant) continue;
      const k = hash2f(X, y, seed + 2);
      r.px(X, y, k < 0.55 ? C.night : (bay(X, y) < 0.5 ? C.rock : C.night), 1);
      void edgeD;
    }
  }
  // arches: stone outline, dithered grey, broken in places, with moss where it clings
  const arches = [[Math.round(W * 0.2), 34, 0.28], [Math.round(W * 0.5), 46, 0.12], [Math.round(W * 0.8), 34, 0.22]];
  arches.forEach(([ax, half, top], n) => {
    const spring = Math.round(H * top) + half;
    for (let y = Math.round(H * top) - 2; y <= gy; y++) for (let x = ax - half - 3; x <= ax + half + 3; x++) {
      let inBand = false;
      if (y <= spring) { const d = Math.hypot(x - ax, y - spring); inBand = d <= half + 3 && d >= half - 1; }
      else inBand = (x >= ax - half - 3 && x <= ax - half) || (x >= ax + half - 1 && x <= ax + half + 3);
      if (!inBand) continue;
      // broken: a bite out of the right arch's shoulder and the left arch's crown
      const brk = (n === 2 && x > ax + half * 0.3 && y < spring - half * 0.55) || (n === 0 && x > ax - half * 0.3 && x < ax + half * 0.25 && y < spring - half * 0.8) || vnoise(x * 0.3, y * 0.3, seed + n) < 0.16;
      if (brk) continue;
      const k = hash2f(x, y, seed + 9);
      const moss = k < 0.14 + 0.3 * (y / gy);
      let c = bay(x, y) < 0.5 ? C.rock : C.night;
      if (moss) c = k < 0.06 ? C.wood : C.woodDark;
      r.px(x, y, c, 2);
    }
  });
  // the ground: a course of dark stone with a mossy lip, and the plinth steps
  r.rect(0, gy, W, H - gy, C.ink, 3);
  for (let x = 0; x < W; x++) {
    const k = hash2f(x >> 1, 7, seed + 3);
    r.px(x, gy, k < 0.55 ? C.woodDark : C.rock, 3);
    if (k < 0.3) r.px(x, gy + 1, C.woodDark, 3);
  }
  for (let y = gy + 5; y < H; y += 9) for (let x = 0; x < W; x++) if (hash2f(x >> 2, y, seed + 4) < 0.7) r.px(x, y, bay(x, y) < 0.5 ? C.night : C.ink, 3);
  for (let y = gy + 2; y < H; y += 9) for (let x = 0; x < W; x += 2) if (hash2f(x, y, seed + 6) < 0.28) r.px(x, y, C.rock, 3);
  const cx = Math.round(W / 2);
  const stepY = [gy, gy + 5];
  [[34, 0], [52, 1]].forEach(([hw, i]) => { r.rect(cx - hw, stepY[i], hw * 2, 1, C.ice, 4); r.dith(cx - hw, stepY[i] + 1, hw * 2, 3, C.woodDark, 0.5, 4); });
  // the cross itself
  const chH = Math.round(H * 0.74);
  S.cross = paintRingCross(r, cx, gy, chH, seed, accent);
  S.cx = cx; S.gy = gy;
  // the bolt is its own picture and flickers in the animation
  S.boltX = Math.round(W * (0.82 + 0.06 * hash2f(seed, 3, 3)));
  S.embers = [];
  for (let i = 0; i < 12; i++) S.embers.push({ x: cx - 40 + hash2f(i, 1, seed + 8) * 80, ph: hash2f(i, 2, seed + 8), sp: 5 + hash2f(i, 3, seed + 8) * 6, a: hash2f(i, 4, seed + 8) * 6 });
  S.accent = accent;
  S.bands = [mistBand(W, 16, seed + 1, { y: gy - 12, layerMax: 3, speed: 6, dens: 0.7, phase: 11 })];
  S.bolt = null; S.boltIdx = -1;
}
function strikePhase(t, period, seedOff) {
  const idx = Math.floor((t + seedOff) / period), u = (t + seedOff) - idx * period;
  let on = 0;
  if (u < 0.09) on = 2; else if (u < 0.15) on = 0; else if (u < 0.3) on = 1; else if (u < 0.42) on = 0.5;
  return { idx, u, on };
}
function animCross(r, spec, S, t) {
  const W = r.w, H = r.h;
  drawMistBand(r, S.bands[0], t);
  // halo breathing: a second dither of ice around the ring, in and out
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
  const c = S.cross;
  if (c) {
    for (let i = 0; i < 38; i++) {
      const a = (i / 38) * Math.PI * 2 + t * 0.4;
      const rr = c.ringR + 3 + pulse * 2;
      const x = c.x0 + c.cx + Math.round(Math.cos(a) * rr), y = c.y0 + c.cy + Math.round(Math.sin(a) * rr);
      if (((i + Math.floor(t * 3)) & 1) === 0) r.px(x, y, pulse > 0.5 ? C.ice : C.waterInk);
    }
  }
  // embers of the track's hue rising from the plinth
  for (const e of S.embers) {
    const age = (t / e.sp * 1.4 + e.ph) % 1;
    const x = Math.round(e.x + Math.sin(t * 0.9 + e.a) * 4), y = Math.round(S.gy - 2 - age * H * 0.5);
    if (age < 0.85 && y > 0) r.px(x, y, age < 0.5 ? S.accent : C.dusk);
  }
  // lightning
  const sp = strikePhase(t, 7.3, 2.1);
  if (sp.on > 0) {
    if (S.boltIdx !== sp.idx) { S.boltIdx = sp.idx; S.bolt = boltPath(S.seed + sp.idx * 977, W, H, S.boltX + ((sp.idx * 37) % 40) - 20, Math.round(H * 0.8) - 6); }
    if (sp.on >= 1) {
      // the sky behind the arches flashes: lift everything in the far layers
      for (let i = 0; i < r.d.length; i++) {
        if (r.lay[i] <= 2 && r.d[i] === C.ink && bay(i % W, (i / W) | 0) < (sp.on === 2 ? 0.5 : 0.25)) r.d[i] = C.night;
      }
      drawBolt(r, S.bolt, sp.on === 2);
    } else if (sp.on === 0.5) {
      for (const [x, y] of S.bolt.pts) r.px(x, y, C.dusk);
    }
  }
}

// ======================================================================================== BOTHY
function paintBothy(r, spec, S) {
  const W = r.w, H = r.h;
  const seed = 9000 + (spec.levelIndex | 0) * 19 + (spec.seed | 0);
  S.seed = seed;
  const hx0 = Math.round(W * 0.17), hx1 = Math.round(W * 0.58), hxs = Math.round(W * 0.7);
  const wallB = Math.round(H * 0.87), roofL = Math.round(H * 0.58), roofR = Math.round(H * 0.4);
  const roofAt = (x) => Math.round(roofL + ((x - hx0) / (hx1 - hx0)) * (roofR - roofL));
  const bankY = (x) => Math.round(H * 0.7 - (x / W) * H * 0.42 + 4 * Math.sin(x * 0.035 + seed));
  // sky: dark teal, from ink and night dithered with a breath of sage and water blue; long shallow streaks of cloud
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = y / H;
    let c = bay(x, y) < 0.3 + t * 0.55 ? C.night : C.ink;
    const u = y + x * 0.34;
    const v = vnoise(x * 0.0065, u * 0.075, seed) * 0.65 + vnoise(x * 0.016, u * 0.15, seed + 3) * 0.35;
    const fil = Math.abs(vnoise(x * 0.009, u * 0.11, seed + 8) * 2 - 1);
    if (bay(x + 2, y + 1) < 0.06 + 0.1 * t) c = C.woodDark;                     // the teal in the dark
    if (v > 0.5 && bay(x + 1, y + 3) < (v - 0.5) * 2.4) c = bay(x, y) < 0.5 ? C.waterInk : C.night;
    if (fil < 0.05 && v > 0.45) c = bay(x, y) < 0.55 ? C.bog : C.waterInk;
    else if (fil < 0.1 && v > 0.45 && bay(x, y) < 0.4) c = C.waterInk;
    r.px(x, y, c, 0);
  }
  // the snow bank behind, a long diagonal rim: lit edge, dark mass, icicles
  for (let x = 0; x < W; x++) {
    const ry = bankY(x);
    for (let y = ry; y < H; y++) {
      const d = y - ry;
      const c = d < 2 ? C.snow : d < 4 ? (bay(x, y) < 0.5 ? C.ice : C.snow) : (bay(x, y) < clamp(0.55 - d * 0.025, 0.05, 0.5) ? C.waterInk : (bay(x, y) < 0.45 ? C.night : C.ink));
      r.px(x, y, c, 1);
    }
    if (hash2f(x, 4, seed) < 0.06) { const n = 2 + Math.floor(hash2f(x, 5, seed) * 7); for (let k = 2; k < n + 2; k++) r.px(x, ry + k, bay(x, ry + k) < 0.7 ? C.ice : C.waterInk, 1); }
  }
  // the hut's front wall: staggered courses of dark stone, a few pale with frost
  for (let x = hx0; x < hx1; x++) for (let y = roofAt(x); y < wallB; y++) {
    const row = Math.floor((y - 3) / 5), off = (row & 1) * 4;
    const mortar = ((y - 3) % 5 === 0) || ((x + off) % 9 === 0);
    const bx = Math.floor((x + off) / 9);
    const tone = hash2f(bx, row, seed + 6);
    let c = mortar ? C.ink : (tone < 0.3 ? C.night : tone < 0.6 ? (bay(x, y) < 0.45 ? C.night : C.ink) : C.ink);
    if (!mortar && hash2f(x, y, seed + 16) < 0.045) c = C.waterInk;
    r.px(x, y, c, 3);
  }
  // snow drifted along the wall foot
  for (let x = hx0 - 6; x < hxs + 8; x++) for (let j = 0; j < 4; j++) if (bay(x, wallB + j - 1) < 1 - j * 0.28) r.px(x, wallB + j - 1, j === 0 ? C.snow : (bay(x, wallB + j) < 0.6 ? C.snow : C.ice), 3);
  // the gable end in the light: snow-plastered stone, brighter at the top, shaded toward the ground
  for (let x = hx1; x < hxs; x++) for (let y = Math.round(roofR - (x - hx1) * 0.1); y < wallB; y++) {
    const down = clamp((y - roofR) / (wallB - roofR), 0, 1);
    const k = hash2f(x, y, seed + 7);
    let c = k < 0.5 - down * 0.3 ? C.snow : k < 0.85 - down * 0.2 ? C.ice : C.water;
    if (down > 0.4 && bay(x, y) < down * 0.5) c = C.waterDeep;
    if ((y % 5 === 0 || (x + (Math.floor(y / 5) & 1) * 4) % 9 === 0) && k < 0.7) c = C.waterInk;
    r.px(x, y, c, 3);
  }
  // chimney stack up from the gable
  const chw = 13, chx = hxs - chw - 1, chTop = Math.round(roofR - 24);
  for (let y = chTop; y < roofR + 3; y++) for (let x = chx; x < chx + chw; x++) {
    const side = x > chx + chw - 6;
    const k = hash2f(x, y, seed + 9);
    r.px(x, y, side ? (k < 0.55 ? C.snow : C.ice) : (bay(x, y) < 0.35 ? C.night : C.ink), 3);
  }
  r.rect(chx - 1, chTop - 2, chw + 2, 3, C.snow, 3);
  S.chimney = { x: chx + 5, y: chTop - 4 };
  // roof: a thick snow cap along the slope, a blue underside, icicles
  for (let x = hx0 - 5; x < hx1 + 2; x++) {
    const base = Math.round(roofL + ((x - hx0) / (hx1 - hx0)) * (roofR - roofL));
    for (let j = -3; j <= 2; j++) r.px(x, base + j, j <= 0 ? C.snow : (bay(x, base + j) < 0.6 ? C.ice : C.snow), 3);
    r.px(x, base + 3, bay(x, base + 3) < 0.5 ? C.waterInk : C.ice, 3);
    if (hash2f(x, 12, seed) < 0.12) { const n = 2 + Math.floor(hash2f(x, 13, seed) * 5); for (let k = 3; k < n + 3; k++) r.px(x, base + k, bay(x, k) < 0.8 ? C.ice : C.waterInk, 3); }
  }
  // the snowfield in front, lifting from dark teal to white in a few clean steps
  for (let y = Math.round(H * 0.85); y < H; y++) for (let x = 0; x < W; x++) {
    if (r.layer(x, y) >= 3 && y < wallB) continue;
    const k0 = clamp((y - H * 0.85) / (H * 0.15), 0, 1);
    const k = k0 * k0 * (3 - 2 * k0);
    const wave = Math.round(2 * Math.sin(x * 0.04 + seed * 0.1));
    const lit = bay(x, y + wave) < k * 1.15;
    r.px(x, y, lit ? (hash2f(x, y, seed + 2) < 0.12 + (1 - k) * 0.5 ? C.ice : C.snow) : (bay(x + 1, y) < 0.3 ? C.waterInk : (bay(x, y) < 0.55 ? C.night : C.ink)), 2);
  }
  // windows and door: the glass is left dark here, the lamp is the animation
  S.windows = [];
  const win = (x, y, w, h) => {
    r.rect(x - 1, y - 1, w + 2, h + 2, C.lamp, 4);
    r.rect(x, y, w, h, C.ink, 4);
    r.rect(x - 2, y + h + 1, w + 4, 1, C.snow, 4);
    S.windows.push({ x, y, w, h });
  };
  win(hx0 + 10, roofAt(hx0 + 14) + 13, 9, 11);
  win(hx0 + Math.round((hx1 - hx0) * 0.66), roofAt(hx0 + Math.round((hx1 - hx0) * 0.66)) + 9, 14, 13);
  const dw = 14, dh = 24, dx = hx0 + Math.round((hx1 - hx0) * 0.34);
  r.rect(dx, wallB - dh, dw, dh, C.ink, 4);
  r.rect(dx - 1, wallB - dh - 1, dw + 2, 1, C.lamp, 4); r.rect(dx - 1, wallB - dh, 1, dh, C.lamp, 4);
  r.rect(dx - 2, wallB, dw + 4, 2, C.snow, 4);
  S.door = { x: dx, y: wallB - dh, w: dw, h: dh };
  S.snow = [];
  for (let i = 0; i < 80; i++) S.snow.push({ x: hash2f(i, 1, seed + 33) * W, y: hash2f(i, 2, seed + 33) * H, sp: 7 + hash2f(i, 3, seed + 33) * 15, dr: 6 + hash2f(i, 4, seed + 33) * 9, big: hash2f(i, 5, seed + 33) < 0.18 });
  S.puffs = 30;
  S.bands = [mistBand(W, 16, seed + 4, { y: Math.round(H * 0.8), layerMax: 3, speed: 9, dens: 0.5, phase: 5 })];
}
function animBothy(r, spec, S, t) {
  const W = r.w, H = r.h;
  drawMistBand(r, S.bands[0], t);
  // window light: orange glass with ink muntins, the core flickering to flame, and a wash on the snow below
  S.windows.forEach((w, n) => {
    const f = vnoise(t * 7 + n * 13, 0.5, S.seed + 40);
    const hot = f > 0.58;
    r.rect(w.x, w.y, w.w, w.h, C.lamp);
    r.rect(w.x + 1, w.y + 1, w.w - 2, w.h - 2, hot ? C.flame : C.lamp);
    for (let y = 1; y < w.h - 1; y++) for (let x = 1; x < w.w - 1; x++) if (hot && bay(w.x + x, w.y + y) < 0.4) r.px(w.x + x, w.y + y, C.lamp);
    r.rect(w.x + (w.w >> 1), w.y, 1, w.h, C.ink); r.rect(w.x, w.y + (w.h >> 1) - 1, w.w, 1, C.ink);
    const spill = 0.16 + f * 0.12;
    for (let y = 1; y < 16; y++) for (let x = -6; x < w.w + 6; x++) {
      const X = w.x + x, Y = w.y + w.h + 2 + y;
      if (X < 0 || Y >= H) continue;
      const L = r.lay[Y * W + X];
      if (L === 0 || L > 3) continue;
      if (bay(X, Y) < spill * (1 - y / 16)) r.d[Y * W + X] = C.lamp;
    }
  });
  const door = S.door, df = vnoise(t * 5, 9.5, S.seed + 41);
  for (let y = 0; y < door.h; y += 2) r.px(door.x + door.w - 2, door.y + y, df > 0.4 ? C.lamp : C.ink);
  // chimney smoke: a slow diagonal drift of dithered puffs, pale near the pot, dusky as it climbs
  for (let i = 0; i < S.puffs; i++) {
    const age = ((t * 0.14) + i / S.puffs) % 1;
    const x = S.chimney.x + age * 90 + Math.sin(age * 8 + i * 1.7) * 3, y = S.chimney.y - age * 40 - Math.sin(i * 2.1) * 2;
    const rad = 1 + Math.floor(age * 7);
    for (let j = -rad; j <= rad; j++) for (let k = -rad; k <= rad; k++) {
      if (j * j + k * k > rad * rad + 1) continue;
      const X = Math.round(x + k), Y = Math.round(y + j);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      if (bay(X, Y) < 0.85 * (1 - age * 0.8)) r.px(X, Y, age < 0.3 ? C.paper2 : age < 0.6 ? C.rock : C.dusk);
    }
  }
  // snowfall, aslant with the wind
  for (const f of S.snow) {
    const x = Math.round(((f.x + t * f.dr) % W + W) % W), y = Math.round((f.y + t * f.sp) % H);
    r.px(x, y, f.big ? C.snow : C.paper2);
    if (f.big) r.px(x + 1, y, C.paper2);
  }
}

// ======================================================================================== GATE
/** A course of stone: staggered bricks of 10x5, each its own tone, a pale lip on top, ink mortar. */
function brickWall(r, x0, y0, x1, y1, seed, id, o = {}) {
  const BW = 10, BH = 5;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const row = Math.floor(y / BH), off = (row & 1) * 5;
    const col = Math.floor((x + off) / BW);
    const mortar = (y % BH === 0) || ((x + off) % BW === 0);
    let c;
    if (mortar) c = C.ink;
    else {
      const tone = hash2f(col, row, seed);
      const k = y % BH;                                   // 1..4 down the brick
      if (k === 1) c = tone > 0.3 ? (bay(x, y) < 0.7 ? C.contour : C.contourIdx) : C.contourIdx;   // the lit lip
      else if (k === 4) c = bay(x, y) < 0.5 ? C.contourIdx : C.ink;                              // the shadowed foot
      else c = tone < (o.dark || 0.5) ? (bay(x, y) < 0.55 ? C.contourIdx : C.ink) : C.contourIdx;
      if (hash2f(x, y, seed + 9) < 0.015) c = C.woodDark;
    }
    r.px(x, y, c, id);
  }
}
function paintGate(r, spec, S) {
  const W = r.w, H = r.h;
  const seed = 7000 + (spec.levelIndex | 0) * 23 + (spec.seed | 0);
  S.seed = seed;
  const accent = accentU(spec.levelIndex);
  const horizon = Math.round(H * 0.6);
  paintSky(r, W, H, horizon, accent, seed, false);
  S.stars = paintStars(r, W, H, horizon, seed);
  paintMoon(r, Math.round(W * 0.14), Math.round(H * 0.2), 7, false);
  // a castle in cloud: dark pinnacles dissolving into the mist behind the wall
  const cx = Math.round(W * 0.5);
  const tower = (x, w, top, spire) => {
    for (let y = top; y < Math.round(H * 0.62); y++) for (let i = 0; i < w; i++) if (bay(x + i, y) < 0.99 - (y - top) * 0.003) r.px(x + i, y, C.ink, 1);
    for (let k = 0; k < spire; k++) { const hw = Math.floor((spire - k) / 5); for (let i = -hw; i <= hw; i++) r.px(x + Math.floor(w / 2) + i, top - k, C.ink, 1); }
    for (let i = 0; i < w; i += 3) r.px(x + i, top - 1, C.ink, 1);
  };
  tower(cx - 44, 12, Math.round(H * 0.32), 18); tower(cx - 12, 18, Math.round(H * 0.2), 26); tower(cx + 26, 11, Math.round(H * 0.34), 16); tower(cx + 46, 9, Math.round(H * 0.42), 10);
  r.rect(cx - 46, Math.round(H * 0.42), 110, Math.round(H * 0.2), C.ink, 1);
  // pines along the foot of the hill
  const topsT = new Int16Array(W);
  for (let x = 0; x < W; x++) { topsT[x] = Math.round(H * 0.58 + 4 * Math.sin(x * 0.05 + seed) + 3 * hash2f(x, 3, seed)); for (let y = topsT[x]; y < H; y++) r.px(x, y, C.ink, 2); }
  conifers(r, 2, topsT, W, 0.1, seed, C.ink);
  // the wall: dark brown brick, battlemented, with the gateway in the middle
  const wallTop = Math.round(H * 0.5), wallBot = Math.round(H * 0.9);
  brickWall(r, 0, wallTop, W, wallBot, seed + 2, 3, { dark: 0.72 });
  for (let x = 2; x < W; x += 12) for (let y = wallTop - 6; y < wallTop; y++) for (let i = 0; i < 8; i++) {
    const edge = i === 0 || i === 7 || y === wallTop - 6;
    r.px(x + i, y, edge ? C.ink : (bay(x + i, y) < 0.5 ? C.contourIdx : C.ink), 3);
  }
  const gx = Math.round(W / 2), gw = 50, gTop = Math.round(H * 0.26);
  const spring = gTop + Math.round(gw / 2);
  // the gateway: dressed stone around a black opening
  for (let y = gTop - 8; y < wallBot; y++) for (let x = gx - gw / 2 - 10; x <= gx + gw / 2 + 10; x++) {
    const d = Math.hypot(x - gx, y - spring);
    const inside = y >= spring ? Math.abs(x - gx) < gw / 2 : d < gw / 2;
    if (inside) { r.px(x, y, C.ink, 4); continue; }
    const inArch = y < spring ? d < gw / 2 + 10 : Math.abs(x - gx) < gw / 2 + 10;
    if (!inArch) continue;
    const course = y < spring ? Math.floor(d) : Math.floor(y / 5);
    const tone = hash2f(Math.floor((y < spring ? Math.atan2(y - spring, x - gx) * 10 : x / 5)) + course * 31, course, seed + 12);
    const edge = y < spring ? (Math.floor(d) % 5 === 0) : (y % 5 === 0);
    r.px(x, y, edge ? C.ink : (tone < 0.5 ? (bay(x, y) < 0.35 ? C.contour : C.contourIdx) : C.contourIdx), 4);
  }
  // the opening picked out in the track's hue
  for (let a = Math.PI; a <= Math.PI * 2; a += 0.01) r.px(Math.round(gx + Math.cos(a) * (gw / 2 + 0.5)), Math.round(spring + Math.sin(a) * (gw / 2 + 0.5)), accent, 4);
  r.rect(gx - gw / 2, spring, 1, wallBot - spring, accent, 4); r.rect(gx + gw / 2, spring, 1, wallBot - spring, accent, 4);
  // portcullis chains hanging in the dark
  for (const sx of [gx - gw / 2 + 5, gx + gw / 2 - 6]) for (let y = gTop + 8; y < wallBot - 8; y += 2) r.px(sx, y, bay(sx, y) < 0.6 ? C.dusk : C.night, 4);
  // the road up to the gate
  for (let y = wallBot; y < H; y++) for (let x = 0; x < W; x++) {
    const t = (y - wallBot) / (H - wallBot);
    const road = Math.abs(x - gx) < gw / 2 + t * (W * 0.45);
    r.px(x, y, road ? (bay(x, y) < 0.3 + t * 0.4 ? C.contourIdx : (hash2f(x, y, seed + 3) < 0.4 ? C.night : C.ink)) : (bay(x, y) < 0.5 ? C.night : C.ink), 4);
  }
  // the wanderer in the gateway, three pixels to the pixel
  S.lantern = drawWanderer(r, gx, wallBot + 8, 3, 0, 5, null, C.dusk);
  S.bands = [
    mistBand(W, Math.round(H * 0.26), seed + 1, { y: Math.round(H * 0.28), layerMax: 1, speed: 4, dens: 0.85, phase: 1 }),
    mistBand(W, Math.round(H * 0.2), seed + 2, { y: Math.round(H * 0.56), layerMax: 3, speed: 7, dens: 0.8, phase: 2 }),
    mistBand(W, Math.round(H * 0.16), seed + 3, { y: Math.round(H * 0.88), layerMax: 5, speed: 11, dens: 0.75, phase: 3 }),
  ];
}
function animGate(r, spec, S, t) {
  twinkle(r, S.stars, t);
  for (const b of S.bands) drawMistBand(r, b, t);
  const f = 0.55 + 0.45 * vnoise(t * 6, 3.3, S.seed + 50);
  lanternGlow(r, S.lantern.x, S.lantern.y, 18, 4, f * 0.8);
  r.px(S.lantern.x, S.lantern.y, f > 0.7 ? C.flame : C.lamp);
}

// ======================================================================================== TITLE
function paintTitle(r, spec, S) {
  const W = r.w, H = r.h;
  const li = spec.levelIndex == null ? 3 : spec.levelIndex;
  const lv = levelOf(li), prof = profileOf(li);
  const seed = (lv.seed | 0) + 4242;
  S.seed = seed;
  const accent = C.magenta;
  const horizon = Math.round(H * 0.7);
  paintSky(r, W, H, horizon, accent, seed, false);
  S.stars = paintStars(r, W, H, horizon, seed);
  paintMoon(r, Math.round(W * 0.2), Math.round(H * 0.22), 8, false);
  const rf = 0.9, size = prof.size;
  ridgeLayer(r, 1, W, H, prof.bands[0], size, { span: 0.8, off: 6, base: H * 0.6, amp: H * 0.5 * rf, gamma: 1.05, smooth: true, fade: H * 0.28, upper: C.dusk, lower: C.night, rim: 0 });
  ridgeLayer(r, 2, W, H, prof.bands[1], size, { span: 0.8, off: 24, base: H * 0.76, amp: H * 0.44 * rf, gamma: 1.05, fade: H * 0.26, upper: C.night, lower: C.ink, rim: C.dusk });
  const tops = ridgeLayer(r, 3, W, H, prof.bands[2], size, { span: 0.8, off: 44, base: H * 0.96, amp: H * 0.3 * rf, gamma: 1.1, fade: 6, upper: C.ink, lower: C.ink, rim: C.magenta, rim2: C.magenta });
  conifers(r, 3, tops, W, 0.06, seed, C.ink);
  // a knoll for the cross and the wanderer: dark ground
  const kx = Math.round(W * 0.58), ky = Math.round(H * 0.86);
  for (let x = kx - 70; x < kx + 70; x++) {
    const top = Math.round(ky - Math.max(0, 1 - Math.pow((x - kx) / 70, 2)) * 6);
    for (let y = top; y < H; y++) r.px(x, y, C.ink, 4);
    r.px(x, top, bay(x, top) < 0.5 ? C.woodDark : C.ink, 4);
  }
  S.cross = paintRingCross(r, kx, ky, Math.round(H * 0.64), seed, C.magenta);
  S.cx = kx; S.gy = ky;
  S.lantern = drawWanderer(r, kx - 28, ky + 4, 2, 0, 5, null, C.dusk);
  S.bands = [
    mistBand(W, Math.round(H * 0.3), seed + 1, { y: Math.round(H * 0.5), layerMax: 1, speed: 3, dens: 0.75, phase: 1 }),
    mistBand(W, Math.round(H * 0.24), seed + 2, { y: Math.round(H * 0.7), layerMax: 3, speed: 6, dens: 0.8, phase: 2 }),
    mistBand(W, Math.round(H * 0.2), seed + 3, { y: Math.round(H * 0.9), layerMax: 5, speed: 10, dens: 0.8, phase: 3 }),
  ];
}
function animTitle(r, spec, S, t) {
  const W = r.w, H = r.h;
  twinkle(r, S.stars, t);
  for (const b of S.bands) drawMistBand(r, b, t);
  const c = S.cross, pulse = 0.5 + 0.5 * Math.sin(t * 1.4);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + t * 0.4, rr = c.ringR + 3 + pulse * 2;
    if (((i + Math.floor(t * 3)) & 1) === 0) r.px(c.x0 + c.cx + Math.round(Math.cos(a) * rr), c.y0 + c.cy + Math.round(Math.sin(a) * rr), pulse > 0.5 ? C.ice : C.waterInk);
  }
  const f = 0.55 + 0.45 * vnoise(t * 6, 3.3, S.seed + 50);
  lanternGlow(r, S.lantern.x, S.lantern.y, 14, 5, f * 0.75);
  r.px(S.lantern.x, S.lantern.y, f > 0.7 ? C.flame : C.lamp);
  // now and then the sky tears: a flash that lifts the far hills, and a bolt over the left ridge
  const sp = strikePhase(t, 11, 4.5);
  if (sp.on > 0) {
    const flash = sp.on >= 1;
    if (flash) for (let i = 0; i < r.d.length; i++) if (r.lay[i] <= 2 && bay(i % W, (i / W) | 0) < (sp.on === 2 ? 0.4 : 0.2)) r.d[i] = lift(r.d[i]);
    if (S.boltIdx !== sp.idx) { S.boltIdx = sp.idx; S.bolt = boltPath(S.seed + sp.idx * 313, W, H, Math.round(W * (0.75 + ((sp.idx * 7) % 10) / 60)), Math.round(H * 0.6)); }
    if (flash) drawBolt(r, S.bolt, sp.on === 2);
  }
}

// ======================================================================================== registry
const PAINTERS = {
  ridge: [paintRidge, animRidge], cross: [paintCross, animCross], bothy: [paintBothy, animBothy],
  gate: [paintGate, animGate], title: [paintTitle, animTitle],
};
export const PANEL_KINDS = Object.freeze(Object.keys(PAINTERS));

const cache = new Map();
const cacheKey = (spec, W, H) => `${spec.kind}|${spec.levelIndex | 0}|${spec.seed | 0}|${spec.locked ? 'L' : ''}|${hasProfile(spec.levelIndex | 0) ? 'p' : 'q'}|${W}x${H}`;

/** The cached state of a panel: base raster, work raster, per-panel animation data. */
export function getPanel(spec, W = PANEL.w, H = PANEL.h) {
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
  for (const k of [...cache.keys()]) if (k !== key && k.startsWith(`${spec.kind}|${spec.levelIndex | 0}|${spec.seed | 0}|${spec.locked ? 'L' : ''}|`) && k.endsWith(`|${W}x${H}`)) cache.delete(k);
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
