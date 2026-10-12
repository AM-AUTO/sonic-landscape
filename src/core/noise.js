/**
 * Seeded 2D simplex noise with fbm / ridged / domain-warp helpers.
 * Pure, deterministic, no globals — safe for Node and browser.
 */
import { mulberry32 } from './rng.js';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

// 12 gradient directions on the unit circle-ish (classic simplex set, 2D part)
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]);

/**
 * @param {number} seed
 * @returns {{noise2:(x:number,y:number)=>number, fbm:Function, ridged:Function, warp:Function}}
 */
export function createNoise(seed) {
  const rnd = mulberry32((seed | 0) ^ 0x5bd1e995);
  const perm = new Uint8Array(512);
  const permMod = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod[i] = perm[i] % 12;
  }

  /** Simplex noise, output roughly in [-1, 1]. */
  function noise2(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let a = 0.5 - x0 * x0 - y0 * y0;
    if (a > 0) {
      const g = permMod[ii + perm[jj]];
      a *= a; n += a * a * (GX[g] * x0 + GY[g] * y0);
    }
    a = 0.5 - x1 * x1 - y1 * y1;
    if (a > 0) {
      const g = permMod[ii + i1 + perm[jj + j1]];
      a *= a; n += a * a * (GX[g] * x1 + GY[g] * y1);
    }
    a = 0.5 - x2 * x2 - y2 * y2;
    if (a > 0) {
      const g = permMod[ii + 1 + perm[jj + 1]];
      a *= a; n += a * a * (GX[g] * x2 + GY[g] * y2);
    }
    return 70 * n;
  }

  /** Fractal Brownian motion, normalised to ~[-1, 1]. */
  function fbm(x, y, oct = 5, lac = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * noise2(x * f + o * 17.3, y * f - o * 9.1);
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** Ridged multifractal, output in [0, 1]; 1 on the ridge lines. */
  function ridged(x, y, oct = 5, lac = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1, w = 1;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(noise2(x * f + o * 31.7, y * f + o * 12.9));
      n *= n;
      n *= w;
      w = Math.min(1, Math.max(0, n * 1.6));
      sum += amp * n;
      norm += amp;
      amp *= gain;
      f *= lac;
    }
    return sum / norm;
  }

  /** Domain warp: displaced coordinates {x, y}, displacement up to ~amt. */
  function warp(x, y, amt) {
    return {
      x: x + amt * noise2(x * 0.011 + 5.2, y * 0.011 + 1.3) * 1.0 + amt * 0.35 * noise2(x * 0.047 + 9.1, y * 0.047),
      y: y + amt * noise2(x * 0.011 - 3.7, y * 0.011 + 8.8) * 1.0 + amt * 0.35 * noise2(x * 0.047 - 2.4, y * 0.047 + 4.4),
    };
  }

  return { noise2, fbm, ridged, warp };
}
