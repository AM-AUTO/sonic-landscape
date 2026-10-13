/**
 * Scene-author helpers: terrain, stone albedo, sky, small maths.
 *
 *   terrainHeightfield({ height?, base=0, amp=2, freq=0.04, oct=5, seed=1, ridge=0, warp=0, slopeMax=0.7, flatten? })
 *        -> { d(x,y,z), h(x,z), lip, min, max, id:0 }.  d is a safe distance bound ((y - h) * lip, lip = 1/sqrt(1+slopeMax^2));
 *        h(x,z) is the ground height (use it to stand stones on the ground). `height(x,z)->y` overrides the default fbm hills;
 *        `ridge` 0..1 blends in creased (ridged) noise; `warp` domain-warps; `flatten(x,z)->0..1` pulls the ground towards `base`
 *        (a clearing). Raise slopeMax if the terrain is steep (otherwise the marcher can overstep a ridge).
 *   gridHeight(data, nx, nz, x0, z0, cell, base=0, scale=1) -> h(x,z) bilinear sample of a Float32Array (a real heightfield)
 *   stoneAlbedo(x,y,z, seed, opts) -> 0..1 albedo from position:  strata (bedding bands + dark joints) + lichen patchwork + pitting
 *        opts { base=0.5, strata=0.16 (band contrast), strataFreq=4 (bands per metre), tilt=[0.12, 0.05] (bedding dip in x, z),
 *               warp=0.35, lichen=0.35 (coverage 0..1), lichenScale=3.2 (patches per metre), lichenTone=0.8, lichenDark=0.3,
 *               pit=0.2 (0..1), pitScale=22, grain=0.03 }
 *        stoneAlbedo is cheap enough to call once per hit (about 1 us).
 *   makeSky({ zenith=0.5, horizon=0.9, below=0.4, sun:{dir, size=0.02, glow=0.35, intensity=1}, clouds:{coverage=0.5, scale=1.2, seed=3, tone=0.25, contrast=0.6, wind:[1,0.2]} })
 *        -> sky(dir) -> lum 0..1  (dir = Float64Array(3) unit vector; dir[1] is up)
 *   sunDir(azDeg, elDeg) -> [x,y,z] direction TO the sun (az 0 = ahead of the camera, 90 = from the right, 180 = behind the camera)
 *   smoothstep(a,b,v) clamp(v,a,b) mix(a,b,t) fract(v) len3(x,y,z) norm3(v) cross3(a,b)
 */
import { getNoise, worley3, WORLEY, hash3f } from './noise.mjs';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const fract = (v) => v - Math.floor(v);
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
export function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
/** direction TO the sun from compass-like angles: azimuth in degrees measured from +z (the way the default camera looks) towards +x, elevation above the horizon.
 *  az 0 = the sun is ahead of the camera (backlit subject), 90 = from the right, 180 = behind the camera (front-lit), 270 = from the left. */
export function sunDir(azDeg, elDeg) {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function terrainHeightfield({ height, base = 0, amp = 2, freq = 0.04, oct = 5, seed = 1, ridge = 0, warp = 0, slopeMax = 0.7, flatten } = {}) {
  const nz = getNoise(seed), nw = getNoise(seed + 77);
  const h = height || ((x, z) => {
    if (warp > 0) { const wx = nw.n2(x * freq * 0.7, z * freq * 0.7) * warp, wz = nw.n2(x * freq * 0.7 + 9.1, z * freq * 0.7 + 3.3) * warp; x += wx; z += wz; }
    let v = nz.fbm2(x * freq, z * freq, oct);
    if (ridge > 0) { const r = 1 - Math.abs(nz.fbm2(x * freq * 0.8 + 40, z * freq * 0.8 + 11, Math.max(2, oct - 1))); v = mix(v, r * r * 2 - 0.7, ridge); }
    return base + amp * v;
  });
  const hh = flatten ? (x, z) => { const w = clamp(flatten(x, z), 0, 1), v = h(x, z); return base + (v - base) * (1 - w); } : h;
  const lip = 1 / Math.sqrt(1 + slopeMax * slopeMax);
  return { d: (x, y, z) => (y - hh(x, z)) * lip, h: hh, lip, min: [-1e9, -1e9, -1e9], max: [1e9, 1e9, 1e9], id: 0 };
}

export function gridHeight(data, nx, nz, x0, z0, cell, base = 0, scale = 1) {
  return (x, z) => {
    let fx = (x - x0) / cell, fz = (z - z0) / cell;
    fx = clamp(fx, 0, nx - 1.001); fz = clamp(fz, 0, nz - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, i = iz * nx + ix;
    const a = data[i], b = data[i + 1], c = data[i + nx], d = data[i + nx + 1];
    return base + scale * ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz);
  };
}

export function stoneAlbedo(x, y, z, seed = 1, o = {}) {
  const { base = 0.5, strata = 0.16, strataFreq = 4, tilt = [0.12, 0.05], warp = 0.35, lichen = 0.35, lichenScale = 3.2, lichenTone = 0.8, lichenDark = 0.3, pit = 0.2, pitScale = 22, grain = 0.03 } = o;
  const nz = getNoise(seed * 7 + 3);
  let v = base;
  // strata: bedding planes dip slightly; each band has its own tone, a dark broken joint at the band edge, a pale lip just under it
  if (strata > 0) {
    const s = (y + tilt[0] * x + tilt[1] * z) * strataFreq + warp * nz.n3(x * 0.9, y * 0.25, z * 0.9);
    const b = Math.floor(s), f = s - b;
    v += (hash3f(b, seed, 11, 5) - 0.5) * 2 * strata;
    const jt = nz.n3(x * 7, y * 3, z * 7);
    if (f < 0.07 && jt > -0.35) v -= strata * 1.4 * (1 - f / 0.07);
    else if (f > 0.07 && f < 0.17) v += strata * 0.35;
  }
  // lichen patchwork: cells with ragged edges, a pale crust with a dark rim line, some patches dark
  if (lichen > 0) {
    const q = lichenScale, e = nz.n3(x * q * 2.1, y * q * 2.1, z * q * 2.1) * 0.18;
    const f1 = worley3(x * q + 31, y * q * 1.3 + 7, z * q + 13, seed) + e;
    const hc = WORLEY.h;
    if (hc < lichen) {
      const r = 0.22 + 0.34 * hash3f(WORLEY.id & 1023, 3, 9, seed);
      if (f1 < r) {
        const tone = hc < lichen * 0.28 ? lichenDark : lichenTone;
        const areole = 0.5 + 0.5 * nz.n3(x * 30, y * 30, z * 30);
        const t = f1 > r - 0.06 ? 0.15 : 1;                    // dark rim, then the crust
        v = mix(v, f1 > r - 0.06 ? v * 0.55 : tone + (areole - 0.5) * 0.12, t === 1 ? 0.85 : 0.8);
      }
    }
  }
  if (pit > 0) {
    const p = nz.n3(x * pitScale, y * pitScale, z * pitScale);
    if (p < -0.25) v -= pit * 0.45 * Math.min(1, (-0.25 - p) * 3);
    else if (p > 0.45) v += pit * 0.12;
  }
  if (grain > 0) v += grain * nz.n3(x * 90, y * 90, z * 90);
  return clamp(v, 0, 1);
}

export function makeSky({ zenith = 0.5, horizon = 0.9, below = 0.4, sun, clouds } = {}) {
  const nz = getNoise((clouds && clouds.seed) || 3);
  const sd = sun && sun.dir ? norm3(sun.dir) : null;
  const sSize = sun ? sun.size ?? 0.02 : 0, sGlow = sun ? sun.glow ?? 0.35 : 0, sInt = sun ? sun.intensity ?? 1 : 0;
  const cov = clouds ? clouds.coverage ?? 0.5 : 0, cs = clouds ? clouds.scale ?? 1.2 : 1, tone = clouds ? clouds.tone ?? 0.25 : 0, con = clouds ? clouds.contrast ?? 0.6 : 0;
  const wind = (clouds && clouds.wind) || [1, 0.2];
  return (dir) => {
    const y = dir[1];
    let v;
    if (y < 0) v = mix(horizon, below, smoothstep(0, -0.25, y));
    else v = mix(horizon, zenith, Math.pow(smoothstep(0, 0.75, y), 0.7));
    if (clouds && y > -0.02) {
      const k = 1 / (Math.max(y, 0) + 0.18);
      const u = dir[0] * k * cs + wind[0] * 3.1, w = dir[2] * k * cs + wind[1] * 1.7;
      const c = nz.fbm2(u * 1.1, w * 2.1, 5) * 0.5 + 0.5 + nz.n2(u * 0.3, w * 0.5) * 0.15;
      const m = smoothstep(1 - cov - 0.12, 1 - cov + 0.2, c) * smoothstep(-0.02, 0.1, y) * (1 - 0.55 * smoothstep(0.55, 1, y));
      const lit = 0.5 + 0.5 * nz.fbm2(u * 2.3 + 5, w * 4.1 + 2, 3);
      const cloud = mix(horizon - tone, 1, lit * con + (1 - con) * 0.7);
      v = mix(v, Math.min(1, cloud), m);
    }
    if (sd) {
      const cs2 = dir[0] * sd[0] + dir[1] * sd[1] + dir[2] * sd[2];
      if (cs2 > 0) {
        v += sGlow * sInt * Math.pow(cs2, 28) * 0.8 + sGlow * sInt * 0.4 * Math.pow(cs2, 6);
        if (sSize > 0 && cs2 > 1 - sSize * sSize * 0.5) v = Math.max(v, 1.1);
      }
    }
    return clamp(v, 0, 1.2);
  };
}
