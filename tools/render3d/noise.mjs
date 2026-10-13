/**
 * Deterministic 3D / 2D gradient noise, fbm, worley (cellular) noise. No Math.random, no Date: every table comes from
 * mulberry32(seed) (src/core/rng.js), so a seed gives the same field in every worker and every run.
 *
 *   makeNoise(seed) -> { n3(x,y,z), n2(x,y), fbm3(x,y,z,oct=4,lac=2,gain=0.5), fbm2(x,y,oct,lac,gain), ridge3(x,y,z,oct) }
 *        n3 / n2 : gradient noise, about -1..1 (typical +-0.6).  fbm*: normalised so it stays within about -1..1.
 *        ridge3  : 1 - |n| folded fbm, 0..1 (sharp creases: bedding cracks, joints)
 *   getNoise(seed)            cached makeNoise (cheap to call from shade())
 *   worley3(x,y,z,seed)       cellular noise: returns F1 (distance to nearest feature point, cell size 1, ~0..1) and leaves
 *                             WORLEY.f2 (second nearest), WORLEY.id (uint32 hash of the nearest cell, for per-cell randomness),
 *                             WORLEY.h (that hash as 0..1) in the module-level WORLEY register (no allocation)
 *   hash3(ix,iy,iz,seed) -> uint32 ; hash3f(...) -> 0..1
 */
import { mulberry32 } from '../../src/core/rng.js';

export function hash3(x, y, z, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) + Math.imul(s | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}
export const hash3f = (x, y, z, s = 0) => hash3(x, y, z, s) / 4294967296;

const G3 = new Float64Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
const G2 = new Float64Array([1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071]);

export function makeNoise(seed = 1) {
  const rng = mulberry32((seed * 2654435761 + 12345) >>> 0);
  const p = new Uint8Array(512), g = new Uint8Array(512), g2 = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
  for (let i = 0; i < 512; i++) { p[i] = base[i & 255]; g[i] = (p[i] % 12) * 3; g2[i] = (p[i] & 7) * 2; }

  function n3(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const fx = x - X, fy = y - Y, fz = z - Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi, B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
    let k;
    k = g[p[AA]]; const a000 = G3[k] * fx + G3[k + 1] * fy + G3[k + 2] * fz;
    k = g[p[BA]]; const a100 = G3[k] * (fx - 1) + G3[k + 1] * fy + G3[k + 2] * fz;
    k = g[p[AB]]; const a010 = G3[k] * fx + G3[k + 1] * (fy - 1) + G3[k + 2] * fz;
    k = g[p[BB]]; const a110 = G3[k] * (fx - 1) + G3[k + 1] * (fy - 1) + G3[k + 2] * fz;
    k = g[p[AA + 1]]; const a001 = G3[k] * fx + G3[k + 1] * fy + G3[k + 2] * (fz - 1);
    k = g[p[BA + 1]]; const a101 = G3[k] * (fx - 1) + G3[k + 1] * fy + G3[k + 2] * (fz - 1);
    k = g[p[AB + 1]]; const a011 = G3[k] * fx + G3[k + 1] * (fy - 1) + G3[k + 2] * (fz - 1);
    k = g[p[BB + 1]]; const a111 = G3[k] * (fx - 1) + G3[k + 1] * (fy - 1) + G3[k + 2] * (fz - 1);
    const x00 = a000 + u * (a100 - a000), x10 = a010 + u * (a110 - a010), x01 = a001 + u * (a101 - a001), x11 = a011 + u * (a111 - a011);
    const y0 = x00 + v * (x10 - x00), y1 = x01 + v * (x11 - x01);
    return (y0 + w * (y1 - y0)) * 1.1;
  }

  function n2(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const fx = x - X, fy = y - Y, xi = X & 255, yi = Y & 255;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    let k;
    k = g2[p[p[xi] + yi]]; const a = G2[k] * fx + G2[k + 1] * fy;
    k = g2[p[p[xi + 1] + yi]]; const b = G2[k] * (fx - 1) + G2[k + 1] * fy;
    k = g2[p[p[xi] + yi + 1]]; const c = G2[k] * fx + G2[k + 1] * (fy - 1);
    k = g2[p[p[xi + 1] + yi + 1]]; const d = G2[k] * (fx - 1) + G2[k + 1] * (fy - 1);
    const t0 = a + u * (b - a), t1 = c + u * (d - c);
    return (t0 + v * (t1 - t0)) * 1.4;
  }

  function fbm3(x, y, z, oct = 4, lac = 2, gain = 0.5) {
    let s = 0, a = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * n3(x, y, z); n += a; x = x * lac + 17.13; y = y * lac + 5.71; z = z * lac + 11.37; a *= gain; }
    return s / n;
  }
  function fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let s = 0, a = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * n2(x, y); n += a; x = x * lac + 31.7; y = y * lac + 9.3; a *= gain; }
    return s / n;
  }
  function ridge3(x, y, z, oct = 3) {
    let s = 0, a = 1, n = 0;
    for (let i = 0; i < oct; i++) { const v = 1 - Math.abs(n3(x, y, z)); s += a * v * v; n += a; x = x * 2.03 + 17.13; y = y * 2.03 + 5.71; z = z * 2.03 + 11.37; a *= 0.5; }
    return s / n;
  }
  return { n3, n2, fbm3, fbm2, ridge3 };
}

const CACHE = new Map();
export function getNoise(seed = 1) {
  let n = CACHE.get(seed);
  if (!n) { n = makeNoise(seed); CACHE.set(seed, n); }
  return n;
}

export const WORLEY = { f1: 0, f2: 0, id: 0, h: 0 };
/** cellular noise, cell size 1. Result F1 returned; f2 / id / h in WORLEY. */
export function worley3(x, y, z, seed = 0) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  let f1 = 1e9, f2 = 1e9, bid = 0;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = X + i, cy = Y + j, cz = Z + k;
    const h = hash3(cx, cy, cz, seed);
    const px = cx + (h & 1023) / 1024, py = cy + ((h >>> 10) & 1023) / 1024, pz = cz + ((h >>> 20) & 1023) / 1024;
    const dx = px - x, dy = py - y, dz = pz - z, d = dx * dx + dy * dy + dz * dz;
    if (d < f1) { f2 = f1; f1 = d; bid = h; } else if (d < f2) f2 = d;
  }
  WORLEY.f2 = Math.sqrt(f2); WORLEY.id = bid; WORLEY.h = bid / 4294967296;
  WORLEY.f1 = Math.sqrt(f1);
  return WORLEY.f1;
}
