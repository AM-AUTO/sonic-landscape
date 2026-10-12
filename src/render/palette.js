/**
 * CONTOURS palette: the strict 16 colours, plus the day/night tint machinery.
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
});

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
/** Nearest palette index for an r,g,b triple. */
export function quantize(r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < PAL_NAMES.length; i++) {
    const c = PAL_RGB[PAL_NAMES[i]];
    const dr = c[0] - r, dg = c[1] - g, db = c[2] - b;
    const d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function quantizeHex(hex) {
  const c = hexToRgb(hex);
  return PAL_NAMES[quantize(c[0], c[1], c[2])];
}

// ------------------------------------------------------- u32 -> palette idx
// Perfect-hash the 16 colours into a small lookup table so tint passes are
// branch-light. Non-palette pixels map to 255.
let HASH_M = 0;
let HASH_LUT = null;
(function buildHash() {
  const keys = PAL_U32_LIST.map((u) => u & 0xffffff);
  for (let m = 31; m < 65536; m++) {
    const seen = new Set();
    let ok = true;
    for (const k of keys) { const h = k % m; if (seen.has(h)) { ok = false; break; } seen.add(h); }
    if (ok) { HASH_M = m; break; }
  }
  HASH_LUT = new Uint8Array(HASH_M).fill(255);
  keys.forEach((k, i) => { HASH_LUT[k % HASH_M] = i; });
})();
/** palette index of a pixel (alpha ignored), or 255 if it isn't a palette colour. */
export function paletteIndexOf(u32) {
  const i = HASH_LUT[(u32 & 0xffffff) % HASH_M];
  return i !== 255 && (PAL_U32_LIST[i] & 0xffffff) === (u32 & 0xffffff) ? i : 255;
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
  dawn: { night: 0, warm: 0.3, wash: { magenta: 0.04, contour: 0 } },
  day: { night: 0, warm: 0, wash: { magenta: 0, contour: 0 } },
  dusk: { night: 0.12, warm: 0.4, wash: { magenta: 0, contour: 0.05 } },
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
    const q = quantizeHex(levelTint);
    if (q !== 'paper' && q !== 'paper2' && q !== 'snow' && q !== 'night' && q !== 'ink') {
      const e = t.wash.find((w) => w.color === q);
      if (e) e.density = Math.min(0.3, e.density + 0.03);
      else t.wash.push({ color: q, density: 0.03 });
    }
  }
  return t;
}

/** Continuous tint from timeOfDay in [0,1): interpolates between phase centres. */
export function tintAt(timeOfDay, levelTint) {
  const p = ((timeOfDay % 1) + 1) % 1;
  // find the two phase centres around p
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
  // hold each phase for the middle part, ease between at the boundaries
  let f = (pp - ca) / (cb - ca);
  f = f < 0.25 ? 0 : f > 0.75 ? 1 : (f - 0.25) / 0.5;
  f = f * f * (3 - 2 * f);
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
const LIGHT = new Uint8Array(16);      // takes the warm / wash tints (hues of water and wood stay put)
[I.paper, I.paper2, I.snow].forEach((i) => { LIGHT[i] = 1; });
// warmer neighbour
const WARM = new Uint8Array(16).map((_, i) => i);
WARM[I.paper] = I.paper2; WARM[I.snow] = I.paper;
// Night look: each colour becomes a 2-colour ordered dither (A, then B for a fraction W),
// chosen so the ground goes quiet and dark while contours, symbols and text glow.
const NIGHT_A = new Uint8Array(16).map((_, i) => i);
const NIGHT_B = new Uint8Array(16).map((_, i) => i);
const NIGHT_W = new Float32Array(16);
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
 */
export function applyTint(buf, w, h, tint, ox = 0, oy = 0, y0 = 0, y1 = h) {
  if (!tint) return;
  const night = tint.night, warm = tint.warm;
  const washes = tint.wash.map((s) => ({ d: s.density, u: PAL_U32[s.color] }));
  if (night <= 0.004 && warm <= 0.004 && washes.length === 0) return;
  for (let y = y0; y < y1; y++) {
    const wy = y + oy;
    const rowB = (wy & 7) << 3;
    const rowB2 = ((wy + 5) & 7) << 3;
    const rowB3 = ((wy + 3) & 7) << 3;
    const row4 = (wy & 3) << 2;
    for (let x = 0; x < w; x++) {
      const p = buf[y * w + x];
      const pi = paletteIndexOf(p);
      if (pi === 255) continue;
      const wx = x + ox;
      let out = p;
      if (LIGHT[pi]) {
        if (warm > 0) {
          const t = (BAYER8[rowB | (wx & 7)] + 0.5) / 64;
          if (t < warm) out = PAL_U32_LIST[WARM[pi]];
        }
        for (let k = 0; k < washes.length; k++) {
          const t = (BAYER8[rowB2 | ((wx + 3) & 7)] + 0.5) / 64;
          if (t < washes[k].d * 2 && ((wx + wy) & 1) === 0) out = washes[k].u;
        }
      }
      if (night > 0) {
        const t = (BAYER8[rowB3 | ((wx + 1) & 7)] + 0.5) / 64;
        if (t < night) {
          const m = (BAYER4[row4 | (wx & 3)] + 0.5) / 16;
          out = PAL_U32_LIST[m < NIGHT_W[pi] ? NIGHT_B[pi] : NIGHT_A[pi]];
        }
      }
      buf[y * w + x] = out;
    }
  }
}

export { LIGHT as LIGHT_GROUND, WARM as WARM_MAP, NIGHT_A, NIGHT_B, NIGHT_W };
