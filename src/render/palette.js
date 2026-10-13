/**
 * CONTOURS palette: the strict 21 colours (the original 16 OS-sheet colours plus the five
 * gothic-ballad colours lamp / flame / bolt / ice / dusk), plus the day/night tint machinery.
 * No DOM here: everything works on plain typed arrays so it can run in Node.
 */

export const PAL = Object.freeze({
  paper: '#f2ead3',
  paper2: '#e6dcbc',
  contour: '#b5835a',
  contourIdx: '#8a5a35',
  water: '#9fd3e6',
  waterDeep: '#5fa8cf',
  waterInk: '#2f6fa8',
  wood: '#9cc58a',
  woodDark: '#5d8f4e',
  ink: '#1d1a17',
  magenta: '#c2357e',
  grid: '#6fa3c9',
  snow: '#ffffff',
  rock: '#a39d92',
  bog: '#7fb3a0',
  night: '#20263a',
  // gothic-ballad additions (indices 16..20)
  lamp: '#e8832a',      // orange: bothy windows, lantern glow
  flame: '#f4c43c',     // yellow: flame cores
  bolt: '#f6c8f6',      // pink-white: lightning
  ice: '#8ee6e6',       // cyan: cross glow, frost
  dusk: '#4b4a7a',      // violet: mist and sky at dusk/night
});

/** Number of colours in the strict palette. */
export const PAL_COUNT = 21;
/** The original OS-sheet colours (indices 0..15). Level tints still snap to these only. */
export const BASE_COUNT = 16;

export const PAL_NAMES = Object.freeze(Object.keys(PAL));
export const PAL_INDEX = Object.freeze(Object.fromEntries(PAL_NAMES.map((n, i) => [n, i])));

function hexToRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** name -> [r,g,b] */
export const PAL_RGB = Object.freeze(Object.fromEntries(PAL_NAMES.map((n) => [n, hexToRgb(PAL[n])])));

/** name -> little-endian ABGR uint32 (what a Uint32Array view of ImageData holds). */
export const PAL_U32 = Object.freeze(
  Object.fromEntries(PAL_NAMES.map((n) => {
    const [r, g, b] = PAL_RGB[n];
    return [n, ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0];
  })),
);

/** index -> u32 */
export const PAL_U32_LIST = Object.freeze(PAL_NAMES.map((n) => PAL_U32[n]));

export function rgbU32(r, g, b) { return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; }

// ---------------------------------------------------------------- quantize
/** Nearest palette index for an r,g,b triple (searches the first `limit` colours, default all). */
export function quantize(r, g, b, limit = PAL_NAMES.length) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < limit; i++) {
    const c = PAL_RGB[PAL_NAMES[i]];
    const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
    const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function quantizeHex(hex, limit = PAL_NAMES.length) {
  const c = hexToRgb(hex);
  return PAL_NAMES[quantize(c[0], c[1], c[2], limit)];
}

// ------------------------------------------------------- u32 -> palette idx
// Perfect-hash the palette colours into a small lookup table (multiply-shift, found at load
// time) so tint passes are branch-light. Non-palette pixels map to 255.
const HASH_KEYS = new Uint32Array(PAL_U32_LIST.map((u) => u & 0xffffff));
let HASH_MUL = 1, HASH_SHIFT = 26;
let HASH_LUT = null;
(function buildHash() {
  for (let bits = 6; bits <= 12; bits++) {
    const shift = 32 - bits;
    let m = 0x9e3779b1;
    for (let trial = 0; trial < 20000; trial++) {
      m = (Math.imul(m, 1664525) + 1013904223) >>> 0;
      const mul = m | 1;
      const seen = new Set();
      let ok = true;
      for (const k of HASH_KEYS) { const h = Math.imul(k, mul) >>> shift; if (seen.has(h)) { ok = false; break; } seen.add(h); }
      if (ok) {
        HASH_MUL = mul; HASH_SHIFT = shift;
        HASH_LUT = new Uint8Array(1 << bits).fill(255);
        HASH_KEYS.forEach((k, i) => { HASH_LUT[Math.imul(k, mul) >>> shift] = i; });
        return;
      }
    }
  }
  throw new Error('palette: no perfect hash found');
})();
/** palette index of a pixel (alpha ignored), or 255 if it isn't a palette colour. */
export function paletteIndexOf(u32) {
  const k = u32 & 0xffffff;
  const i = HASH_LUT[Math.imul(k, HASH_MUL) >>> HASH_SHIFT];
  return i !== 255 && HASH_KEYS[i] === k ? i : 255;
}

// ------------------------------------------------------------ ordered dither
/** 8x8 Bayer matrix, values 0..63 */
export const BAYER8 = (() => {
  const m = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let v = 0;
      for (let i = 0; i < 3; i++) {
        const xi = (x >> i) & 1, yi = (y >> i) & 1;
        const sh = 2 * (2 - i);
        v |= (((xi ^ yi) << 1) | yi) << sh;
      }
      m[y * 8 + x] = v;
    }
  }
  return m;
})();
/** 4x4 Bayer, values 0..15 */
export const BAYER4 = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
/** threshold in (0,1) for pixel x,y using the 8x8 matrix */
export function bayer(x, y) { return (BAYER8[((y & 7) << 3) | (x & 7)] + 0.5) / 64; }

// -------------------------------------------------------------- time of day
// Tint description (all colours are palette entries; nothing is blended):
// {
//   phase, night: 0..1  (ground -> dark variant / night colour, ordered dither)
//   warm:  0..1         (light ground -> warmer palette neighbour)
//   wash:  [{ color, density }]  (sparse dither of an accent over light ground only)
// }
const KEYS = {
  //            night  warm   wash
  dawn: { night: 0, warm: 0.3, wash: { magenta: 0, contour: 0 } },
  day: { night: 0, warm: 0, wash: { magenta: 0, contour: 0 } },
  dusk: { night: 0.12, warm: 0.4, wash: { magenta: 0, contour: 0 } },
  night: { night: 0.97, warm: 0, wash: { magenta: 0, contour: 0 } },
};
const PHASE_CENTRE = { dawn: 0.125, day: 0.375, dusk: 0.625, night: 0.875 };
const ORDER = ['dawn', 'day', 'dusk', 'night'];

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * tintFor(phase, levelTint) -> tint description for a named phase.
 * levelTint: optional '#rrggbb'; snapped to the palette and used as a faint ambient wash.
 */
export function tintFor(phase, levelTint) {
  const k = KEYS[phase] || KEYS.day;
  const t = {
    phase,
    night: k.night,
    warm: k.warm,
    wash: Object.entries(k.wash).filter(([, d]) => d > 0).map(([color, density]) => ({ color, density })),
  };
  if (levelTint) {
    const q = quantizeHex(levelTint, BASE_COUNT);   // level tints keep snapping to the original 16
    if (q !== 'paper' && q !== 'paper2' && q !== 'snow' && q !== 'night' && q !== 'ink') {
      const e = t.wash.find((w) => w.color === q);
      if (e) e.density = Math.min(0.3, e.density + 0.03);
      else t.wash.push({ color: q, density: 0.03 });
    }
  }
  return t;
}

/**
 * Where timeOfDay sits between two phase centres: { a, b, f } with f in [0,1] already held/eased
 * (each phase holds through the middle of its span and eases at the boundaries).
 */
export function phaseBlend(timeOfDay) {
  const p = ((timeOfDay % 1) + 1) % 1;
  let i0 = 3;                                     // before the first centre we are between night and dawn
  for (let i = 0; i < 4; i++) {
    const c = PHASE_CENTRE[ORDER[i]];
    if (p >= c) i0 = i;
  }
  const a = ORDER[i0], b = ORDER[(i0 + 1) % 4];
  const ca = PHASE_CENTRE[a];
  let cb = PHASE_CENTRE[b];
  let pp = p;
  if (cb <= ca) cb += 1;
  if (pp < ca) pp += 1;           // wrapped segment (night -> dawn)
  let f = (pp - ca) / (cb - ca);
  f = f < 0.25 ? 0 : f > 0.75 ? 1 : (f - 0.25) / 0.5;
  f = f * f * (3 - 2 * f);
  return { a, b, f };
}

/** Continuous tint from timeOfDay in [0,1): interpolates between phase centres. */
export function tintAt(timeOfDay, levelTint) {
  const { a, b, f } = phaseBlend(timeOfDay);
  const ta = tintFor(a, levelTint), tb = tintFor(b, levelTint);
  const colors = new Map();
  for (const w of ta.wash) colors.set(w.color, [w.density, 0]);
  for (const w of tb.wash) { const e = colors.get(w.color) || [0, 0]; e[1] = w.density; colors.set(w.color, e); }
  const wash = [];
  for (const [color, [da, db]] of colors) { const d = lerp(da, db, f); if (d > 0.004) wash.push({ color, density: d }); }
  // drop faint tails so full day is perfectly clean (no stray lattice dots)
  const clean = (v, th) => (v < th ? 0 : v);
  return {
    phase: f < 0.5 ? a : b,
    night: clean(lerp(ta.night, tb.night, f), 0.04),
    warm: clean(lerp(ta.warm, tb.warm, f), 0.06),
    wash: wash.filter((w2) => w2.density >= 0.035),
  };
}

// colour groups for the tint pass ------------------------------------------
const I = PAL_INDEX;
const LIGHT = new Uint8Array(PAL_COUNT);      // takes the warm / wash tints (hues of water and wood stay put)
[I.paper, I.paper2, I.snow].forEach((i) => { LIGHT[i] = 1; });
// warmer neighbour
const WARM = new Uint8Array(PAL_COUNT).map((_, i) => i);
WARM[I.paper] = I.paper2; WARM[I.snow] = I.paper;
// Night look: each colour becomes a 2-colour ordered dither (A, then B for a fraction W),
// chosen so the ground goes quiet and dark while contours, symbols and text glow.
const NIGHT_A = new Uint8Array(PAL_COUNT).map((_, i) => i);
const NIGHT_B = new Uint8Array(PAL_COUNT).map((_, i) => i);
const NIGHT_W = new Float32Array(PAL_COUNT);
function nightMap(c, a, b, w) { NIGHT_A[I[c]] = I[a]; NIGHT_B[I[c]] = I[b]; NIGHT_W[I[c]] = w; }
nightMap('paper', 'night', 'ink', 0.30);
nightMap('paper2', 'night', 'waterInk', 0.12);
nightMap('snow', 'rock', 'night', 0.25);
nightMap('water', 'waterInk', 'night', 0.45);
nightMap('waterDeep', 'waterDeep', 'waterInk', 0.30);
nightMap('wood', 'night', 'woodDark', 0.22);
nightMap('woodDark', 'woodDark', 'night', 0.35);
nightMap('bog', 'night', 'woodDark', 0.35);
nightMap('rock', 'contourIdx', 'night', 0.50);
nightMap('grid', 'waterInk', 'night', 0.30);
nightMap('contour', 'contourIdx', 'contourIdx', 0);
nightMap('contourIdx', 'contour', 'contour', 0);
nightMap('ink', 'rock', 'rock', 0);
nightMap('waterInk', 'waterDeep', 'waterDeep', 0);

/**
 * Apply a tint description to a region of a Uint32Array framebuffer.
 * buf: Uint32Array (w*h), tint from tintFor/tintAt. (ox,oy) = world offset of
 * pixel (0,0) so the dither pattern stays glued to the terrain when scrolling.
 * rows y0..y1 are processed (default all).
 * lightMap (optional Uint8Array w*h, 255 = unlit): scales the night amount per pixel, so a
 * lantern or a window can hold the darkness back (see fx.js).
 */
const WASH_D = new Float64Array(16), WASH_U = new Uint32Array(16);
const LIST32 = Uint32Array.from(PAL_U32_LIST);      // typed copy: the tint loop reads it per pixel
export function applyTint(buf, w, h, tint, ox = 0, oy = 0, y0 = 0, y1 = h, lightMap = null) {
  if (!tint) return;
  const night = tint.night, warm = tint.warm;
  const nw = Math.min(tint.wash.length, WASH_D.length);
  for (let k = 0; k < nw; k++) { WASH_D[k] = tint.wash[k].density * 2; WASH_U[k] = PAL_U32[tint.wash[k].color]; }
  if (night <= 0.004 && warm <= 0.004 && nw === 0) return;
  const doLight = warm > 0 || nw > 0;
  const inv255 = 1 / 255, inv64 = 1 / 64, inv16 = 1 / 16;
  const lut = HASH_LUT, keys = HASH_KEYS, mul = HASH_MUL, shift = HASH_SHIFT;
  for (let y = y0; y < y1; y++) {
    const wy = y + oy;
    const rowB = (wy & 7) << 3;
    const rowB2 = ((wy + 5) & 7) << 3;
    const rowB3 = ((wy + 3) & 7) << 3;
    const row4 = (wy & 3) << 2;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = buf[row + x];
      const kk = p & 0xffffff;
      const pi = lut[Math.imul(kk, mul) >>> shift];
      if (pi === 255 || keys[pi] !== kk) continue;
      const wx = x + ox;
      let out = p;
      if (doLight && LIGHT[pi]) {
        if (warm > 0) {
          const t = (BAYER8[rowB | (wx & 7)] + 0.5) * inv64;
          if (t < warm) out = LIST32[WARM[pi]];
        }
        for (let k = 0; k < nw; k++) {
          const t = (BAYER8[rowB2 | ((wx + 3) & 7)] + 0.5) * inv64;
          if (t < WASH_D[k] && ((wx + wy) & 1) === 0) out = WASH_U[k];
        }
      }
      const nt = lightMap ? night * lightMap[row + x] * inv255 : night;
      if (nt > 0) {
        const t = (BAYER8[rowB3 | ((wx + 1) & 7)] + 0.5) * inv64;
        if (t < nt) {
          const m = (BAYER4[row4 | (wx & 3)] + 0.5) * inv16;
          out = LIST32[m < NIGHT_W[pi] ? NIGHT_B[pi] : NIGHT_A[pi]];
        }
      }
      buf[row + x] = out;
    }
  }
}

export { LIGHT as LIGHT_GROUND, WARM as WARM_MAP, NIGHT_A, NIGHT_B, NIGHT_W };
