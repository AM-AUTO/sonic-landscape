/**
 * Small shared helpers for the painted scenes (panels.js, stone.js, titleart.js, title/*): ordered-dither threshold, value
 * noise, the red ramp that "lifting" or "sinking" a colour walks up and down, and a 3x5 map-label stamper.
 * Everything writes strict palette colours (the PAL_U32 values) into a Raster-like object { w, h, d, lay, px(), get() }.
 *
 * START-SCREEN COLOUR RULE: the five start screens (src/render/title/*) are greyscale with ONE accent. They use only
 *   ink  char  slate  ash  rock  fog  snow   (the GREY ramp below, dark -> light; paper / paper2 only as warm light endpoints)
 * plus ember (#dd5a38) as the single accent. No blue, green, yellow, purple, or the other reds. The old red/hypsometric
 * ramps (RED, lift, sink) stay for the in-game panels; on the start screens use GREY, liftG and sinkG instead.
 */
import { PAL_U32 as C, BAYER8 } from './palette.js';
import { hash2f } from '../core/rng.js';
import { FONTS } from './font.js';

/** The picture a painter writes into: palette u32 colours plus a layer id per pixel (which depth the mist may cover). */
export class Raster {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); this.lay = new Uint8Array(w * h); }
  px(x, y, c, l) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.d[i] = c;
    if (l !== undefined) this.lay[i] = l;
  }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[y * this.w + x]; }
  layer(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.lay[y * this.w + x]; }
  rect(x, y, w, h, c, l) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, l); }
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
}

export const bay = (x, y) => (BAYER8[((y & 7) << 3) | (x & 7)] + 0.5) / 64;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;

/** value noise on an integer lattice; per/perY > 0 make it wrap (tileable) */
export function vnoise(x, y, seed, per = 0, perY = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const H = (i, j) => hash2f(per ? ((i % per) + per) % per : i, perY ? ((j % perY) + perY) % perY : j, seed);
  const a = H(x0, y0), b = H(x0 + 1, y0), c = H(x0, y0 + 1), d = H(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}
/** fractal value noise, roughly 0..1 */
export function fbm(x, y, seed, oct = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, seed + i * 17); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / n;
}

/** The red hours, dark to bright. Lifting a colour is one step up this ramp; mist and glow do that. */
export const RED = [C.ink, C.blood, C.heather, C.rust, C.ember, C.lamp, C.flame, C.paper];
const LIFT = new Map();
const SINK = new Map();
RED.forEach((c, i) => { if (i + 1 < RED.length) { LIFT.set(c, RED[i + 1]); SINK.set(RED[i + 1], c); } });
for (const [a, b] of [[C.night, C.dusk], [C.dusk, C.heather], [C.contourIdx, C.contour], [C.contour, C.paper2], [C.rock, C.paper2], [C.woodDark, C.wood], [C.waterInk, C.grid], [C.grid, C.water], [C.bog, C.water], [C.bolt, C.paper]]) { if (!LIFT.has(a)) LIFT.set(a, b); if (!SINK.has(b)) SINK.set(b, a); }
// the warm greys join the generic lift / sink walk too (char < slate < ash < rock < fog < snow), so a grey is never reddened by accident
// (only the new greys get entries: the existing colours keep their old walk, so the in-game panels are unchanged)
LIFT.set(C.char, C.slate); LIFT.set(C.slate, C.ash); LIFT.set(C.ash, C.rock); LIFT.set(C.fog, C.snow);
SINK.set(C.char, C.ink); SINK.set(C.slate, C.char); SINK.set(C.ash, C.slate); SINK.set(C.fog, C.rock);
export const lift = (c) => LIFT.get(c) || c;
export const sink = (c) => SINK.get(c) || c;

/** The greyscale ramp of the start screens, dark -> light. ember is the one accent, kept apart from the ramp. */
export const GREY = Object.freeze([C.ink, C.char, C.slate, C.ash, C.rock, C.fog, C.snow]);
const GREY_AT = new Map(GREY.map((c, i) => [c, i]));
/** The cold ramp, dark -> light, paired step for step with GREY (snow is shared). */
export const BLUE = Object.freeze([C.deepblue, C.steelD, C.steel, C.blue, C.paleblue, C.frost, C.snow]);
const BLUE_AT = new Map(BLUE.map((c, i) => [c, i]));
/** One step up / down the ramp a colour belongs to: GREY stays grey, a blue stays blue (snow is both: it follows GREY). Any other colour is returned
 *  unchanged; the darkest step sinks to itself, snow lifts to snow. */
export const liftG = (c) => { let i = GREY_AT.get(c); if (i !== undefined) return GREY[Math.min(GREY.length - 1, i + 1)]; i = BLUE_AT.get(c); return i === undefined ? c : BLUE[Math.min(BLUE.length - 1, i + 1)]; };
export const sinkG = (c) => { let i = GREY_AT.get(c); if (i !== undefined) return GREY[Math.max(0, i - 1)]; i = BLUE_AT.get(c); return i === undefined ? c : BLUE[Math.max(0, i - 1)]; };

/** Sky colour at t (0 top .. 1 horizon): ordered dither between neighbouring stops. */
export function skyAt(stops, t, x, y) {
  const pos = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos)), f = pos - i;
  return bay(x, y) < f ? stops[i + 1] : stops[i];
}

/** Colour from a ramp (dark -> light) at v in 0..1, ordered-dithered between neighbouring stops at screen pixel (x, y). */
export function rampAt(ramp, v, x, y) {
  const pos = clamp(v, 0, 1) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  return bay(x, y) < pos - i ? ramp[i + 1] : ramp[i];
}

/** Stamp a line of the 3x5 map font into a raster (spot heights, grid numbers). Returns the width. */
export function stampSmall(r, text, x, y, col, halo, layer) {
  const f = FONTS.small;
  const str = String(text).toUpperCase();
  const px = (X, Y, c) => r.px(X, Y, c, layer);
  if (halo != null) {
    let cx = x;
    for (const ch of str) {
      const g = f.glyphs[ch] || f.glyphs['?'];
      for (let row = 0; row < 5; row++) for (let b = 0; b < g.w; b++) if (g.rows[row] & (1 << (f.bits - 1 - b))) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) px(cx + b + i, y + row + j, halo);
      cx += g.w + 1;
    }
  }
  let cx = x;
  for (const ch of str) {
    const g = f.glyphs[ch] || f.glyphs['?'];
    for (let row = 0; row < 5; row++) for (let b = 0; b < g.w; b++) if (g.rows[row] & (1 << (f.bits - 1 - b))) px(cx + b, y + row, col);
    cx += g.w + 1;
  }
  return cx - x - 1;
}
export function smallWidth(text) {
  const f = FONTS.small;
  let w = 0;
  for (const ch of String(text).toUpperCase()) w += (f.glyphs[ch] || f.glyphs['?']).w + 1;
  return w - 1;
}

// ----------------------------------------------------------------------------- mist (animated)
/** A tileable streaky noise strip; scrolling it is the whole animation. */
export function mistBand(W, rows, seed, opts) {
  const TW = 512;
  const tex = new Float32Array(TW * rows);
  for (let y = 0; y < rows; y++) {
    const env = Math.pow(Math.max(0, 1 - Math.abs((y - rows / 2) / (rows / 2))), 0.9);
    for (let x = 0; x < TW; x++) {
      const n = vnoise(x / 26, y / 3.4, seed, TW / 26, 0) * 0.65 + vnoise(x / 10, y / 1.7, seed + 11, TW / 10, 0) * 0.35;
      tex[y * TW + x] = clamp((n - 0.32) * 2.4, 0, 1) * env;
    }
  }
  return { tex, TW, rows, ...opts };
}
export function drawMistBand(r, B, t) {
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
      if (bay(x, y) < v) r.d[i] = lift(r.d[i]);
      if (v > 0.6 && bay(x + 4, y + 2) < v - 0.42) r.d[i] = lift(r.d[i]);
    }
  }
}

