/**
 * Contract-conformant mock World for the render tools (CONTRACTS.md section 1).
 * buildMockWorld(kind) with kind in 'moor' | 'glen' | 'alpine'. Pure, no DOM.
 */
import { COVER, MAP_SIZE, CELL_METERS } from '../src/world/codes.js';
import { hash2f } from '../src/core/rng.js';

const N = MAP_SIZE;

function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2f(xi, yi, seed), b = hash2f(xi + 1, yi, seed), c = hash2f(xi, yi + 1, seed), d = hash2f(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (vnoise(x * f, y * f, seed + i * 17) - 0.5) * 2; a *= 0.5; f *= 2.03; }
  return s;
}
function ridged(x, y, seed, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f, seed + i * 31) * 2 - 1)); a *= 0.5; f *= 2.1; }
  return s;
}
const gauss = (x, y, cx, cy, r, h) => h * Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r)));

const KINDS = {
  moor: {
    id: 'rannoch', name: 'Rannoch Moor', gaelic: 'Mòinteach Raineach', gridLetters: 'NN', gridOrigin: [32, 51],
    subtitle: 'IV. The Moor', contourInterval: 10, seed: 11, base: 330, amp: 60, snowline: null,
  },
  glen: {
    id: 'cruachan', name: 'Ben Cruachan', gaelic: 'Cruachan Beann', gridLetters: 'NH', gridOrigin: [18, 20],
    subtitle: 'II. The Well', contourInterval: 10, seed: 22, base: 230, amp: 520, snowline: null,
  },
  alpine: {
    id: 'cuillin', name: 'The Cuillin', gaelic: 'A’ Chuiltheann', gridLetters: 'NG', gridOrigin: [44, 20],
    subtitle: 'VII. The Ridge', contourInterval: 20, seed: 33, base: 120, amp: 900, snowline: 780,
  },
};

export function buildMockWorld(kind = 'glen') {
  const K = KINDS[kind] || KINDS.glen;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const nx = x / N, ny = y / N;
      let e;
      if (kind === 'moor') {
        e = K.base + fbm(nx * 5, ny * 5, K.seed, 5) * K.amp * 0.7 + gauss(x, y, 190, 70, 30, 160) + gauss(x, y, 60, 190, 26, 120);
        e += ridged(nx * 3, ny * 3, K.seed + 4, 3) * 25;
      } else if (kind === 'glen') {
        const gl = 128 + Math.sin(ny * 5) * 28;                // winding glen along y
        const dist = Math.abs(x - gl);
        const valley = 1 - Math.exp(-((dist / 38) ** 2));
        e = K.base + valley * (ridged(nx * 4, ny * 4, K.seed, 5) * 520 + 90) + fbm(nx * 9, ny * 9, K.seed + 8, 4) * 30;
        e += gauss(x, y, 60, 70, 30, 220) + gauss(x, y, 200, 170, 34, 260);
      } else {
        const r = ridged(nx * 5, ny * 5, K.seed, 6);
        const spine = Math.exp(-(((x - 128) + Math.sin(y / 30) * 30) ** 2) / (2 * 55 * 55));
        e = K.base + (r * r * 1.1) * 520 * (0.35 + spine) + spine * 380 + fbm(nx * 14, ny * 14, K.seed + 3, 4) * 40;
        e += gauss(x, y, 128, 100, 16, 240) + gauss(x, y, 150, 170, 14, 200);
      }
      h[y * N + x] = e;
    }
  }
  // flatten lochs ------------------------------------------------------
  const lochs = kind === 'moor'
    ? [[110, 130, 14, 9], [60, 70, 8, 6], [200, 190, 10, 7], [150, 40, 6, 4], [30, 140, 6, 5]]
    : kind === 'glen' ? [[128 + Math.sin(110 / N * 5) * 28, 110, 9, 26]] : [[120, 215, 10, 8]];
  const water = new Uint8Array(N * N);
  const lochLevels = [];
  for (const [cx, cy, rx, ry] of lochs) {
    let m = Infinity;
    for (let y = Math.max(0, cy - ry | 0); y < Math.min(N, cy + ry + 1); y++) {
      for (let x = Math.max(0, cx - rx | 0); x < Math.min(N, cx + rx + 1); x++) m = Math.min(m, h[y * N + x]);
    }
    const level = m + 2.5;
    lochLevels.push(level);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + (fbm(x * 0.15, y * 0.15, 77) * 0.2);
        if (d < 1) {
          const dep = (1 - d) * 14;
          h[y * N + x] = Math.min(h[y * N + x], level + 1) - dep * (d < 0.8 ? 1 : 0.2);
          water[y * N + x] = d < 0.55 ? 2 : 1;
          if (d < 1) h[y * N + x] = d < 0.85 ? level - dep * 0.6 : Math.min(h[y * N + x], level + 1);
        }
      }
    }
  }
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < minH) minH = h[i]; if (h[i] > maxH) maxH = h[i]; }

  // slope -----------------------------------------------------------------
  const slope = new Float32Array(N * N);
  const at = (x, y) => h[Math.max(0, Math.min(N - 1, y)) * N + Math.max(0, Math.min(N - 1, x))];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * CELL_METERS), gy = (at(x, y + 1) - at(x, y - 1)) / (2 * CELL_METERS);
      slope[y * N + x] = Math.hypot(gx, gy);
    }
  }

  // streams (D8 accumulation) ------------------------------------------
  const order = Array.from({ length: N * N }, (_, i) => i).sort((a, b) => h[b] - h[a]);
  const acc = new Float32Array(N * N).fill(1);
  const down = new Int32Array(N * N).fill(-1);
  for (const i of order) {
    const x = i % N, y = (i / N) | 0;
    let best = -1, bd = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const d = (h[i] - h[ny * N + nx]) / (dx && dy ? 1.414 : 1);
      if (d > bd) { bd = d; best = ny * N + nx; }
    }
    down[i] = best;
    if (best >= 0) acc[best] += acc[i];
  }
  const stream = new Uint8Array(N * N);
  const thr = kind === 'moor' ? 120 : 90;
  for (let i = 0; i < N * N; i++) if (acc[i] > thr && !water[i]) stream[i] = 1;

  // cover -----------------------------------------------------------------
  const cover = new Uint8Array(N * N);
  const tree = kind === 'alpine' ? 0 : kind === 'glen' ? 620 : 380;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, e = h[i], s = slope[i];
      let c = COVER.MOOR;
      const n = fbm(x * 0.08, y * 0.08, 5);
      if (e < tree && s < 0.55 && n > (kind === 'glen' ? -0.25 : 0.25) && (kind !== 'moor')) c = COVER.WOOD;
      if (kind === 'moor' && s < 0.12 && n < 0.15) c = COVER.BOG;
      if (kind === 'glen' && s < 0.05 && e < 260) c = COVER.BOG;
      if (s > 0.55 && s < 0.85) c = COVER.SCREE;
      if (s >= 0.85 && e > 300) c = COVER.CRAG;
      if (kind === 'alpine' && e > K.snowline && s < 0.9) c = COVER.SNOW;
      if (e > K.base + K.amp * 0.55 && s > 0.35 && n > 0.2 && c === COVER.MOOR) c = COVER.ROCK;
      if (stream[i] && acc[i] > thr * 3) c = COVER.SHALLOW;
      if (water[i] === 1) c = COVER.SHALLOW;
      if (water[i] === 2) c = COVER.DEEP;
      cover[i] = c;
    }
  }
  // paths: polylines between points ----------------------------------------
  const sp = { x: 128, y: 240 };
  const paths = [[{ x: 128, y: 255 }, { x: 120, y: 225 }, { x: 134, y: 190 }, { x: 150, y: 160 }, { x: 142, y: 120 }, { x: 160, y: 85 }],
    [{ x: 40, y: 200 }, { x: 70, y: 185 }, { x: 100, y: 190 }, { x: 128, y: 190 }]];
  for (const p of paths) {
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k], b = p[k + 1];
      const L = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let t = 0; t <= L; t++) {
        const x = Math.round(a.x + (b.x - a.x) * t / L), y = Math.round(a.y + (b.y - a.y) * t / L);
        const i = y * N + x;
        if (cover[i] === COVER.MOOR || cover[i] === COVER.WOOD || cover[i] === COVER.BOG) cover[i] = COVER.PATH;
      }
    }
  }

  const passable = (x, y) => {
    if (x < 0 || y < 0 || x >= N || y >= N) return false;
    const c = cover[(y | 0) * N + (x | 0)];
    return c !== COVER.CRAG && c !== COVER.DEEP;
  };
  const heightAt = (x, y) => {
    x = Math.max(0, Math.min(N - 1, x)); y = Math.max(0, Math.min(N - 1, y));
    const x0 = Math.min(N - 2, x | 0), y0 = Math.min(N - 2, y | 0), fx = x - x0, fy = y - y0;
    return (h[y0 * N + x0] * (1 - fx) + h[y0 * N + x0 + 1] * fx) * (1 - fy) + (h[(y0 + 1) * N + x0] * (1 - fx) + h[(y0 + 1) * N + x0 + 1] * fx) * fy;
  };
  const gradientAt = (x, y) => ({
    gx: (heightAt(x + 0.5, y) - heightAt(x - 0.5, y)) / CELL_METERS,
    gy: (heightAt(x, y + 0.5) - heightAt(x, y - 0.5)) / CELL_METERS,
  });
  const slopeAt = (x, y) => { const g = gradientAt(x, y); return Math.hypot(g.gx, g.gy); };
  const coverAt = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? COVER.CRAG : cover[(y | 0) * N + (x | 0)];

  // find placements ---------------------------------------------------------
  const found = (pred, near, avoid = []) => {
    let best = null, bd = Infinity;
    for (let y = 8; y < N - 8; y++) for (let x = 8; x < N - 8; x++) {
      if (!pred(x, y)) continue;
      if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < 14)) continue;
      const d = Math.hypot(x - near[0], y - near[1]);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    return best || { x: near[0], y: near[1] };
  };
  const ok = (x, y) => passable(x, y) && cover[y * N + x] !== COVER.SHALLOW;
  const used = [];
  const place = (type, id, name, near, pred, cond = {}) => {
    const p = found(pred, near, used);
    used.push(p);
    return { id, type, name, x: p.x, y: p.y, condition: cond, elevation: Math.round(h[p.y * N + p.x]) };
  };
  const localMax = (x, y) => { const e = h[y * N + x]; for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) if (h[(y + dy) * N + x + dx] > e) return false; return ok(x, y); };
  const nearCover = (x, y, code, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (cover[(y + dy) * N + x + dx] === code) return true; return false; };
  const pois = [
    place('summit', 'p-summit', 'Stob Coire an Lochain', [128, 100], (x, y) => localMax(x, y) && h[y * N + x] > minH + (maxH - minH) * 0.55),
    place('trig', 'p-trig', 'Carn Mor', [180, 60], (x, y) => localMax(x, y)),
    place('cairn', 'p-cairn', 'Carn an Tuirc', [90, 150], (x, y) => ok(x, y) && slope[y * N + x] < 0.3 && slope[y * N + x] > 0.1),
    place('lochan', 'p-lochan', 'Lochan na h-Earba', [lochs[0][0], lochs[0][1]], (x, y) => ok(x, y) && nearCover(x, y, COVER.DEEP, 2)),
    place('waterfall', 'p-fall', 'Eas Mor', [150, 130], (x, y) => ok(x, y) && stream[(y) * N + x + 1] && slope[y * N + x] > 0.3),
    place('bothy', 'p-bothy', 'Bothan Dubh', [110, 205], (x, y) => ok(x, y) && cover[y * N + x] !== COVER.BOG && slope[y * N + x] < 0.1 && nearCover(x, y, COVER.PATH, 4)),
    place('stone', 'p-stone', 'Clach Mhor', [60, 100], (x, y) => ok(x, y) && slope[y * N + x] < 0.25),
    place('crag', 'p-crag', 'Creag Dhubh', [180, 140], (x, y) => ok(x, y) && nearCover(x, y, COVER.CRAG, 2)),
  ];
  const wf = [];
  for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
    if (stream[y * N + x] && slope[y * N + x] > 0.38 && !wf.some((q) => Math.hypot(q.x - x, q.y - y) < 10)) wf.push({ x, y });
  }
  const spot = [];
  for (let y = 6; y < N - 6; y += 1) for (let x = 6; x < N - 6; x += 1) {
    if (localMax(x, y) && !spot.some((q) => Math.hypot(q.x - x, q.y - y) < 22)) spot.push({ x, y, h: Math.round(h[y * N + x]) });
  }
  const summit = pois[0];
  const labels = [
    { x: summit.x, y: summit.y - 5, text: summit.name, kind: 'peak' },
    { x: 60, y: 60, text: kind === 'moor' ? 'Loch Laidon' : 'Loch Coire', kind: 'water' },
    { x: 128, y: 150, text: kind === 'moor' ? 'MOINTEACH' : 'GLEANN AFRAIG', kind: 'glen' },
    { x: 200, y: 200, text: 'Allt a’ Bhealaich', kind: 'water' },
    { x: 40, y: 220, text: 'Coire Odhar', kind: 'feature' },
  ];
  const world = {
    level: {
      id: K.id, index: 0, name: K.name, gaelic: K.gaelic, gridLetters: K.gridLetters, gridOrigin: K.gridOrigin,
      subtitle: K.subtitle, contourInterval: K.contourInterval, seed: K.seed, elevation: { min: minH, max: maxH },
      fieldNotes: ['Where the water stands still, listen from above.', 'Stones remember those who wait.'],
    },
    size: N, cellMeters: CELL_METERS, height: h, cover, stream, contourInterval: K.contourInterval, minH, maxH,
    pois, gate: { x: 128, y: 255, chain: ['lochan', 'cairn'], name: 'Bealach na Mòintich', side: 'S' },
    spawn: { x: sp.x, y: sp.y },
    features: { waterfalls: wf, spotHeights: spot, labels, paths },
    heightAt, gradientAt, slopeAt, coverAt, passable,
  };
  return world;
}
