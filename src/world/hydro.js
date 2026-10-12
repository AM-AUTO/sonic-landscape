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

function sampleH(h, x, y) {
  x = x < 0 ? 0 : x > S - 1 ? S - 1 : x; y = y < 0 ? 0 : y > S - 1 ? S - 1 : y;
  const x0 = x | 0, y0 = y | 0, x1 = x0 < S - 1 ? x0 + 1 : x0, y1 = y0 < S - 1 ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = h[y0 * S + x0], b = h[y0 * S + x1], c = h[y1 * S + x0], d = h[y1 * S + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
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
  // Route on a lightly jittered copy of the terrain: a small domain warp (~1.5 cells, ~11-cell wavelength)
  // plus a little relief noise make burns meander instead of running in straight D8 lines.
  for (let i = 0; i < N; i++) {
    const x = i % S, y = (i / S) | 0;
    let v = h[i];
    if (noise) {
      const wx = x + 1.6 * noise.noise2(x * 0.09 + 3.3, y * 0.09 - 8.1) + 0.6 * noise.noise2(x * 0.27 + 1.1, y * 0.27 + 7.7);
      const wy = y + 1.6 * noise.noise2(x * 0.09 - 5.5, y * 0.09 + 2.2) + 0.6 * noise.noise2(x * 0.27 - 4.1, y * 0.27 + 0.3);
      v = sampleH(h, wx, wy) + 2.2 * noise.fbm(x * 0.06 + 13.3, y * 0.06 - 2.1, 2);
    }
    fill[i] = v + 0.9 * (hash2f(x, y, 77) + 0.5 * hash2f(x, y, 78));
  }
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

/**
 * Give burns a natural course. D8 routing yields dead-straight runs on planar slopes; here every
 * stream is traced into chains (headwater/confluence -> next confluence/outlet), smoothed, pushed
 * sideways by a slowly varying noise offset (larger on flat ground) and re-rasterised.
 * Offsets taper to zero at junctions (tributaries end on the already-offset trunk) and around
 * waterfalls. Returns { stream, river } where river marks cells whose flow >= riverThreshold.
 */
export function meanderStreams({ stream, flowTo, acc, water, cover, slope, falls, noise, riverThreshold, crag }) {
  const N = S * S;
  const up = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (stream[i]) { const t = flowTo[i]; if (t >= 0 && stream[t]) up[t]++; }
  const chains = [];
  for (let i = 0; i < N; i++) {
    if (!stream[i] || up[i] === 1) continue;
    const cells = [i];
    let c = i, join = -1;
    for (let k = 0; k < 2000; k++) {
      const t = flowTo[c];
      if (t < 0 || !stream[t]) break;
      if (up[t] !== 1) { join = t; break; }
      cells.push(t); c = t;
    }
    chains.push({ cells, join, a: acc[i] });
  }
  chains.sort((p, q) => q.a - p.a || p.cells[0] - q.cells[0]);
  const px = new Float32Array(N).fill(NaN), py = new Float32Array(N);
  const out = new Uint8Array(N), river = new Uint8Array(N);
  const mark = (x, y, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = y * S + x;
    if (water[i] || cover[i] === crag) return;
    out[i] = 1;
    if (a >= riverThreshold) river[i] = 1;
  };
  const line = (x0, y0, x1, y1, a) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      mark(x0, y0, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  let seedN = 0;
  for (const ch of chains) {
    seedN++;
    const n = ch.cells.length;
    const X = new Float64Array(n + 1), Y = new Float64Array(n + 1), A = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) { const c = ch.cells[k]; X[k] = c % S; Y[k] = (c / S) | 0; A[k] = acc[c]; }
    let m = n;
    if (ch.join >= 0) {
      const j = ch.join;
      X[n] = Number.isNaN(px[j]) ? j % S : px[j]; Y[n] = Number.isNaN(px[j]) ? ((j / S) | 0) : py[j]; A[n] = acc[j]; m = n + 1;
    }
    // smooth (moving average, window 5) keeping the ends anchored
    const sx = new Float64Array(m), sy = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      let ax = 0, ay = 0, w = 0;
      for (let d = -2; d <= 2; d++) { const q = k + d; if (q < 0 || q >= m) continue; ax += X[q]; ay += Y[q]; w++; }
      sx[k] = ax / w; sy[k] = ay / w;
    }
    if (ch.join >= 0) { sx[m - 1] = X[m - 1]; sy[m - 1] = Y[m - 1]; }
    let u = 0;
    const fx = new Float64Array(m), fy = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const k0 = Math.max(0, k - 2), k1 = Math.min(m - 1, k + 2);
      let tx = sx[k1] - sx[k0], ty = sy[k1] - sy[k0];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      if (k > 0) u += Math.hypot(sx[k] - sx[k - 1], sy[k] - sy[k - 1]);
      const ci = Math.round(Y[Math.min(k, n - 1)]) * S + Math.round(X[Math.min(k, n - 1)]);
      const flat = Math.max(0, 1 - slope[ci] / 0.5);
      let amp = 0.7 + 1.9 * flat;
      let taper = 1;
      if (ch.join >= 0) taper = Math.min(taper, (m - 1 - k) / 5);
      for (const f of falls) { const d = Math.hypot(f.x - X[Math.min(k, n - 1)], f.y - Y[Math.min(k, n - 1)]) / 5; if (d < taper) taper = d; }
      taper = Math.max(0, Math.min(1, taper));
      const off = amp * taper * noise.noise2(u * 0.12 + seedN * 7.3, seedN * 3.1);
      fx[k] = sx[k] - ty * off; fy[k] = sy[k] + tx * off;
    }
    for (let k = 0; k < n; k++) { const c = ch.cells[k]; px[c] = fx[k]; py[c] = fy[k]; }
    for (let k = 0; k + 1 < m; k++) line(fx[k], fy[k], fx[k + 1], fy[k + 1], Math.max(A[k], A[k + 1]));
    if (m === 1) mark(Math.round(fx[0]), Math.round(fy[0]), A[0]);
  }
  for (const f of falls) out[f.y * S + f.x] = 1;
  return { stream: out, river };
}
