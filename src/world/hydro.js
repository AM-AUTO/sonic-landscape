/**
 * Hydrology: resolve declared water bodies into DEEP/SHALLOW, route flow with a
 * priority-flood (pits are filled so every cell drains to a loch outlet / map
 * edge / sea), accumulate D8 flow into streams, and pick out waterfalls.
 */
import { MAP_SIZE as S, CELL_METERS } from './codes.js';
import { hash2f } from '../core/rng.js';

export const WATER_NONE = 0, WATER_SHALLOW = 1, WATER_DEEP = 2;

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Turn the sculpt-time body mask into a water map (0 none, 1 shallow, 2 deep).
 * Forces water-bed heights below the surface level so the lake is physically consistent.
 * Returns { water, bodyOf } (bodyOf = Uint16 body id per cell, 0 if none).
 */
export function resolveWater(h, bodyMask, bodies) {
  const N = S * S;
  const water = new Uint8Array(N);
  if (!bodies.length) return { water, bodyOf: bodyMask };
  // Distance from shore (4-neighbour BFS inside water)
  const dist = new Uint8Array(N).fill(255);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) {
    const id = bodyMask[i];
    if (id) {
      const b = bodies[id - 1];
      if (h[i] > b.level - 0.25) h[i] = b.level - 0.25;
    }
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (!bodyMask[i]) continue;
    const id = bodyMask[i];
    // shore if a 4-neighbour is land (map edge counts as water for sea bodies only)
    let shore = false;
    if (x > 0 && bodyMask[i - 1] !== id) shore = true;
    else if (x < S - 1 && bodyMask[i + 1] !== id) shore = true;
    else if (y > 0 && bodyMask[i - S] !== id) shore = true;
    else if (y < S - 1 && bodyMask[i + S] !== id) shore = true;
    if (shore) { dist[i] = 1; q[qt++] = i; }
  }
  while (qh < qt) {
    const i = q[qh++];
    const x = i % S, y = (i / S) | 0;
    const id = bodyMask[i];
    const d = dist[i] + 1;
    if (x > 0 && bodyMask[i - 1] === id && dist[i - 1] > d) { dist[i - 1] = d; q[qt++] = i - 1; }
    if (x < S - 1 && bodyMask[i + 1] === id && dist[i + 1] > d) { dist[i + 1] = d; q[qt++] = i + 1; }
    if (y > 0 && bodyMask[i - S] === id && dist[i - S] > d) { dist[i - S] = d; q[qt++] = i - S; }
    if (y < S - 1 && bodyMask[i + S] === id && dist[i + S] > d) { dist[i + S] = d; q[qt++] = i + S; }
  }
  for (let i = 0; i < N; i++) {
    const id = bodyMask[i];
    if (!id) continue;
    const b = bodies[id - 1];
    water[i] = dist[i] <= b.shallow ? WATER_SHALLOW : WATER_DEEP;
  }
  return { water, bodyOf: bodyMask };
}

/** Minimal binary min-heap keyed by float, storing int payloads. */
export class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    let i = this.n++;
    const k = this.k, v = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const n = --this.n;
    if (n > 0) {
      const key = k[n], val = v[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= key) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = key; v[i] = val;
    }
    return top;
  }
}

/**
 * Priority-flood flow routing + accumulation.
 * Seeds (outlets): all map-edge cells and sea bodies. Returns { flowTo, acc }.
 * flowTo[i] = downstream cell index (-1 at outlets).
 */
export function computeFlow(h, water, bodyOf, bodies, noise = null) {
  const N = S * S;
  const fill = new Float64Array(N);
  const closed = new Uint8Array(N);
  const flowTo = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  let on = 0;
  const heap = new Heap(N + 8);
  // micro-relief breaks D8's straight diagonals on planar slopes so burns meander
  for (let i = 0; i < N; i++) { const x = i % S, y = (i / S) | 0; fill[i] = h[i] + 0.9 * (hash2f(x, y, 77) + 0.5 * hash2f(x, y, 78)) + (noise ? 4.5 * noise.fbm(x * 0.1 + 3.3, y * 0.1 - 8.1, 2) : 0); }
  const seed = (i) => { if (!closed[i]) { closed[i] = 1; heap.push(fill[i], i); } };
  for (let x = 0; x < S; x++) { seed(x); seed((S - 1) * S + x); }
  for (let y = 0; y < S; y++) { seed(y * S); seed(y * S + S - 1); }
  for (let i = 0; i < N; i++) { const id = bodyOf[i]; if (id && bodies[id - 1].sea) seed(i); }
  const EPS = 0.002;
  while (heap.n > 0) {
    const c = heap.pop();
    order[on++] = c;
    const cx = c % S, cy = (c / S) | 0;
    const fc = fill[c];
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const ni = ny * S + nx;
      if (closed[ni]) continue;
      closed[ni] = 1;
      const e = fc + EPS * (d & 1 ? 1.41 : 1);
      if (fill[ni] < e) fill[ni] = e;
      flowTo[ni] = c;
      heap.push(fill[ni], ni);
    }
  }
  const acc = new Float32Array(N).fill(1);
  for (let k = on - 1; k >= 0; k--) {
    const c = order[k];
    const t = flowTo[c];
    if (t >= 0) acc[t] += acc[c];
  }
  return { flowTo, acc };
}

/** Stream mask: land cells whose accumulated flow ≥ threshold. */
export function buildStreams(acc, water, threshold) {
  const N = S * S;
  const stream = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (acc[i] >= threshold && !water[i]) stream[i] = 1;
  return stream;
}

/**
 * Find waterfalls: stream cells where the bed drops sharply over the next few
 * cells downstream. Non-maximum-suppressed so each cascade yields one marker.
 */
export function findWaterfalls(h, stream, flowTo, water, acc, { minDrop = 24, spacing = 10, max = 12, minAcc = 0 } = {}) {
  const cands = [];
  for (let i = 0; i < S * S; i++) {
    if (!stream[i] || acc[i] < minAcc) continue;
    let j = i, steps = 0;
    while (steps < 3) {
      const n = flowTo[j];
      if (n < 0) break;
      j = n; steps++;
    }
    if (steps < 3 || water[j]) continue;
    const drop = h[i] - h[j];
    if (drop >= minDrop) cands.push({ i, drop });
  }
  cands.sort((a, b) => b.drop - a.drop || a.i - b.i);
  const out = [];
  for (const c of cands) {
    const x = c.i % S, y = (c.i / S) | 0;
    if (out.every((o) => Math.hypot(o.x - x, o.y - y) >= spacing)) {
      out.push({ x, y, drop: c.drop });
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Drop (m) over 3 cells downstream of a cell, 0 if not computable. */
export function dropAt(h, flowTo, i, steps = 3) {
  let j = i, s = 0;
  while (s < steps) { const n = flowTo[j]; if (n < 0) break; j = n; s++; }
  return s === steps ? h[i] - h[j] : 0;
}

export { CELL_METERS };
