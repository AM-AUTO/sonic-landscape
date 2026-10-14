/**
 * Consumer side of the 3D-render pipeline (tools/render3d, tools/bake-title.mjs). A start screen's scene is rendered offline by an SDF ray
 * marcher, quantised to the strict palette with an ordered dither, and baked into src/render/title/baked/<scene>.js. At runtime that data is
 * just decoded and blitted into the screen's Raster; nothing here touches the DOM, Math.random or Date.
 *
 *   decodeBaked(mod) -> { w, h, idx: Uint8Array (PAL_INDEX per pixel), layer: Uint8Array (0 sky/far, 1 mid, 3 near),
 *                         embers: [[x, y, phase, dimIdx], ...], meta }
 *        mod = the baked module's default export (or the module namespace). `embers` is the ACCENT: the emissive pixels of the render (glowing carvings).
 *        dimIdx = what each falls back to when it dims: for a blue accent the next step down the blue ramp (frost -> paleblue, paleblue -> blue);
 *        for an old red ember (shelter) the grey beside it.
 *   blitBaked(r, baked, { x = 0, y = 0, filter })
 *        paints every pixel into Raster `r` (PAL_U32 colour + layer id, so mist / glow helpers' `layerMax` keep working).
 *        filter(px, py, idx, layer) -> false skips a pixel (e.g. keep a hand-painted sky: filter: (x, y, i, l) => l > 0).
 *   pulseBakedEmbers(r, baked, t, o)   the incisions breathe (frost <-> paleblue; old ember <-> grey): call from anim() on the copy. o: { x, y, dim = 0.2 (fraction of the cycle spent dim) }.
 *   layerMaskOf(baked, minLayer, maxLayer) -> Uint8Array(w*h) 1 where layer is in range (build regions for paintMistBands / textClear etc.)
 *
 * Typical screen module:
 *   import bake from './baked/shelter.js';  import { decodeBaked, blitBaked, pulseBakedEmbers } from './bakedkit.js';
 *   export function paint(r, spec, S) { S.baked = decodeBaked(bake); blitBaked(r, S.baked); paintTitleLogo(r, S); S.mist = paintMistBands(r, [...], S.seed); }
 *   export function anim(r, spec, S, t) { animMistBands(r, S.mist, t); pulseBakedEmbers(r, S.baked, t); animLogo(r, S.logo, t); }
 */
import { PAL_U32_LIST, PAL_INDEX } from '../palette.js';

const EMBER = PAL_INDEX.ember;
const BLUE_STEPS = ['deepblue', 'steelD', 'steel', 'blue', 'paleblue', 'frost'].map((n) => PAL_INDEX[n]);

function b64bytes(s) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** inverse of tools/render3d/bakefmt.mjs encodeSymbols; n = number of values */
export function decodeSymbols(str, n) {
  const b = b64bytes(str), mode = b[0], nsym = b[1], table = b.subarray(2, 2 + nsym), out = new Uint8Array(n);
  let p = 2 + nsym;
  if (mode === 0) {
    const bpp = nsym <= 1 ? 0 : Math.ceil(Math.log2(nsym));
    if (!bpp) { out.fill(table[0]); return out; }
    let bit = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < bpp; k++, bit++) s |= ((b[p + (bit >> 3)] >> (bit & 7)) & 1) << k;
      out[i] = table[s];
    }
  } else {
    let i = 0;
    while (i < n && p < b.length) {
      const tok = b[p++], v = table[tok >> 4];
      let run = (tok & 15) + 1;
      if ((tok & 15) === 15) run = 16 + b[p++];
      const e = Math.min(n, i + run);
      out.fill(v, i, e); i = e;
    }
  }
  return out;
}

export function decodeBaked(mod) {
  const m = mod && mod.default ? mod.default : mod;
  const { w, h } = m, n = w * h;
  const idx = decodeSymbols(m.idx, n), layer = decodeSymbols(m.layer, n);
  const embers = (m.embers || []).map(([x, y, ph]) => {
    const at = idx[y * w + x], bi = BLUE_STEPS.indexOf(at);
    if (at !== EMBER && bi > 0) return [x, y, ph, BLUE_STEPS[bi - 1]];                  // blue accent: dims one step down the blue ramp
    let dim = PAL_INDEX.char;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h && idx[Y * w + X] !== EMBER) { dim = idx[Y * w + X]; break; }
    }
    return [x, y, ph, dim];
  });
  return { w, h, idx, layer, embers, meta: m.meta || {} };
}

export function blitBaked(r, baked, o = {}) {
  const { x: ox = 0, y: oy = 0, filter } = o;
  const { w, h, idx, layer } = baked;
  for (let j = 0; j < h; j++) {
    const Y = oy + j;
    if (Y < 0 || Y >= r.h) continue;
    for (let i = 0; i < w; i++) {
      const X = ox + i;
      if (X < 0 || X >= r.w) continue;
      const k = j * w + i;
      if (filter && filter(X, Y, idx[k], layer[k]) === false) continue;
      const q = Y * r.w + X;
      r.d[q] = PAL_U32_LIST[idx[k]];
      r.lay[q] = layer[k];
    }
  }
}

export function pulseBakedEmbers(r, baked, t, o = {}) {
  const { x: ox = 0, y: oy = 0, dim = 0.2 } = o;
  for (const [x, y, ph, d] of baked.embers) {
    const X = x + ox, Y = y + oy;
    if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) continue;
    const k = 0.5 + 0.5 * Math.sin(t * 1.3 + ph * 0.55 + x * 0.05);
    r.d[Y * r.w + X] = PAL_U32_LIST[k < dim ? d : baked.idx[y * baked.w + x]];
  }
}

export function layerMaskOf(baked, minLayer = 0, maxLayer = 255) {
  const out = new Uint8Array(baked.w * baked.h);
  for (let i = 0; i < out.length; i++) out[i] = baked.layer[i] >= minLayer && baked.layer[i] <= maxLayer ? 1 : 0;
  return out;
}
