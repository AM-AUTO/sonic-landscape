/** Seeded PRNG + hashing. Deterministic across node and browser. */

/** mulberry32 — returns a function producing floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of 2 ints + seed → uint32. */
export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash → float [0,1). */
export function hash2f(x, y, seed = 0) {
  return hash2(x, y, seed) / 4294967296;
}

/** Convenience wrapper with helpers. */
export class Rng {
  constructor(seed) { this.next = mulberry32(seed); }
  float() { return this.next(); }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor((b - a + 1) * this.next()); } // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** weights: number[] → index */
  weighted(weights) {
    let s = 0; for (const w of weights) s += w;
    let r = this.next() * s;
    for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
    return weights.length - 1;
  }
  gauss() { const u = 1 - this.next(), v = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
}
