/**
 * QUANTISER: float luminance -> palette indices, ordered dither only, nothing outside the ramp + ember.
 *
 *   quantise({ lum, emis, depth }, W, H, opts) -> Uint8Array of PAL_INDEX values (W*H)
 *     lum    Float32Array 0..1  display luminance (0 = the ramp's darkest colour, 1 = its lightest)
 *     emis   Float32Array 0..1  (optional) emissive coverage: >= emberHi becomes ember, emberLo..emberHi is a dithered edge
 *     depth  Float32Array       (optional) metres; only used by opts.outline
 *     opts   ramp        names or palette indices, dark -> light. Default ['ink','char','slate','ash','rock','fog','snow'] (artkit GREY)
 *            levels      optional tone position (0..1) of each ramp colour; default = the colours' real luma, normalised ink..snow
 *            gamma=1     v = v^gamma (gamma > 1 darkens the mid tones)
 *            contrast=1  v = (v - pivot) * contrast + pivot       pivot=0.5     exposure=0 (added before contrast)
 *            ditherScale=0.6  1 = full 8x8 Bayer blend between neighbouring ramp steps; < 1 narrows the dither band: flat tints with dithered seams, like the painted covers
 *            bayer       Uint8Array(64) threshold matrix (default BAYER8 from src/render/palette.js)
 *            ember='ember'  emberLo=0.25  emberHi=0.5
 *            outline=0   0..1: darken the nearer side of depth discontinuities (needs depth) -- an ink line round silhouettes
 *            outlineDepth=0.08  relative depth jump that counts as an edge
 *            sharpen=0   0..1.5 unsharp amount (3x3) on lum before dithering: crisper stone detail
 *   rampLevels(names) -> Float64Array     the default tone positions
 */
import { PAL_INDEX, PAL_RGB, BAYER8 } from '../../src/render/palette.js';

export const DEFAULT_RAMP = Object.freeze(['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow']);

const nameOf = (r) => (typeof r === 'number' ? r : PAL_INDEX[r]);
const lumaOf = (name) => { const c = PAL_RGB[name]; return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255; };

export function rampLevels(ramp = DEFAULT_RAMP) {
  const L = ramp.map((r) => lumaOf(typeof r === 'number' ? Object.keys(PAL_INDEX).find((k) => PAL_INDEX[k] === r) : r));
  const lo = L[0], hi = L[L.length - 1];
  return Float64Array.from(L.map((v) => (v - lo) / (hi - lo)));
}

export function quantise({ lum, emis, depth }, W, H, opts = {}) {
  const { ramp = DEFAULT_RAMP, gamma = 1, contrast = 1, pivot = 0.5, exposure = 0, ditherScale = 0.6, bayer = BAYER8, ember = 'ember', emberLo = 0.25, emberHi = 0.5, outline = 0, outlineDepth = 0.08, sharpen = 0 } = opts;
  const idxs = ramp.map((r) => { const i = nameOf(r); if (i == null) throw new Error('quantise: unknown ramp colour ' + r); return i; });
  const levels = opts.levels ? Float64Array.from(opts.levels) : rampLevels(ramp);
  const emberIdx = nameOf(ember);
  const n = W * H, out = new Uint8Array(n), K = idxs.length;
  let v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = lum[i];
  if (sharpen > 0) {
    const s = new Float32Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, c = v[i];
      const l = v[x > 0 ? i - 1 : i], r = v[x < W - 1 ? i + 1 : i], u = v[y > 0 ? i - W : i], d = v[y < H - 1 ? i + W : i];
      s[i] = c + sharpen * (c - 0.25 * (l + r + u + d));
    }
    v = s;
  }
  if (outline > 0 && depth) {
    const o = new Float32Array(v);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, d = depth[i];
      let edge = false;
      if (x > 0 && depth[i - 1] > d * (1 + outlineDepth)) edge = true;
      else if (x < W - 1 && depth[i + 1] > d * (1 + outlineDepth)) edge = true;
      else if (y > 0 && depth[i - W] > d * (1 + outlineDepth)) edge = true;
      else if (y < H - 1 && depth[i + W] > d * (1 + outlineDepth)) edge = true;
      if (edge) o[i] = v[i] * (1 - outline);
    }
    v = o;
  }
  const inv = 1 / Math.max(ditherScale, 1e-3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, thr = (bayer[((y & 7) << 3) | (x & 7)] + 0.5) / 64;
      if (emis) {
        const e = emis[i];
        if (e >= emberHi || (e > emberLo && (e - emberLo) / (emberHi - emberLo) > thr)) { out[i] = emberIdx; continue; }
      }
      let t = v[i] + exposure;
      t = (t - pivot) * contrast + pivot;
      t = t <= 0 ? 0 : t >= 1 ? 1 : t;
      if (gamma !== 1) t = Math.pow(t, gamma);
      let k = 0;
      while (k < K - 2 && t >= levels[k + 1]) k++;
      const span = levels[k + 1] - levels[k];
      let f = span > 0 ? (t - levels[k]) / span : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      if (ditherScale !== 1) { f = (f - 0.5) * inv + 0.5; f = f < 0 ? 0 : f > 1 ? 1 : f; }
      out[i] = idxs[f > thr ? k + 1 : k];
    }
  }
  return out;
}
