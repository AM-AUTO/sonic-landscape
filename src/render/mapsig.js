/**
 * Signature cartography: the one or two drawing features only one sheet has (docs/LEVELS.md §5).
 * Each is opt-in by name in level.look.signature and draws in OS style with palette colours only,
 * pixel-exact into the bake buffer (labels go through the bitmap font on the canvas layer).
 *
 * mapbake.js builds a context S once per bake and calls the passes at fixed points:
 *   sigFills(S)        after the base fills + edges     iceLochans, pineRibbon, gullySnow
 *   sigGround(S)       after trees / tufts / scree       shingle, bracken, boulders, redScree, gabbro rock, fieldWalls
 *   sigLines(S)        after streams, before paths       tidalRace, dam, railway, shieling, castle
 *   sigLabels(S, ctx)  canvas layer                      Overfalls, soundings, castle name, Dam, halts, Shielings
 *   sigVeil(S, ...)    after the canvas layer            hiddenValley (returns the reveal record)
 * All coordinates in look.* are map cells.
 */
import { COVER } from '../world/codes.js';
import { PAL, PAL_U32 as U } from './palette.js';
import { hash2, hash2f } from '../core/rng.js';
import { drawText, measureText } from './font.js';

const isWater = (c) => c === COVER.SHALLOW || c === COVER.DEEP;

// ------------------------------------------------------------------------------------------ art
export const SIG_ART = Object.freeze({
  pine: ['..#..', '.###.', '..#..', '.###.', '#####', '..#..'],
  wave: ['.#...', '#.#.#', '...#.'],
  boulderA: ['.#.', '#.#', '.#.'],
  boulderB: ['##', '##'],
  boulderC: ['.##', '#.#', '##.'],
  ruin: ['##.#', '#..#', '#...', '##.#'],
  castle: ['#.#..#.', '###.###', '#.....#', '#..#..#', '#######'],
  halt: ['.###.', '#...#', '#...#', '#...#', '.###.'],
});

function inRegion(reg, x, y) {
  if (!reg || !Number.isFinite(reg.x) || !Number.isFinite(reg.y) || !Number.isFinite(reg.r)) return true;
  const dx = x - reg.x, dy = y - reg.y;
  return dx * dx + dy * dy <= reg.r * reg.r;
}
function smooth01(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** smooth value noise on a lattice of lx x ly px, 0..1 */
function vnoise(X, Y, lx, ly, seed) {
  const gx = X / lx, gy = Y / ly, i = Math.floor(gx), j = Math.floor(gy);
  let fx = gx - i, fy = gy - j;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2f(i, j, seed), b = hash2f(i + 1, j, seed), c = hash2f(i, j + 1, seed), d = hash2f(i + 1, j + 1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

// ---------------------------------------------------------------------------------- shared data
/** water components per cell: { comp: Int32Array, size: [], sea: Uint8Array(per comp) } (cached on S) */
function waterComps(S) {
  if (S._wc) return S._wc;
  const { world } = S, N = world.size, cov = world.cover;
  const comp = new Int32Array(N * N).fill(-1);
  const size = [], edge = [];
  const q = new Int32Array(N * N);
  for (let s = 0; s < N * N; s++) {
    if (comp[s] >= 0 || !isWater(cov[s])) continue;
    const id = size.length;
    let h = 0, t = 0, n = 0, e = 0;
    q[t++] = s; comp[s] = id;
    while (h < t) {
      const i = q[h++]; n++;
      const x = i % N, y = (i / N) | 0;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) e = 1;
      if (x > 0 && comp[i - 1] < 0 && isWater(cov[i - 1])) { comp[i - 1] = id; q[t++] = i - 1; }
      if (x < N - 1 && comp[i + 1] < 0 && isWater(cov[i + 1])) { comp[i + 1] = id; q[t++] = i + 1; }
      if (y > 0 && comp[i - N] < 0 && isWater(cov[i - N])) { comp[i - N] = id; q[t++] = i - N; }
      if (y < N - 1 && comp[i + N] < 0 && isWater(cov[i + N])) { comp[i + N] = id; q[t++] = i + N; }
    }
    size.push(n); edge.push(e);
  }
  const sea = new Uint8Array(size.length);
  for (let k = 0; k < size.length; k++) sea[k] = (edge[k] && size[k] > N * 2) || size[k] > N * N * 0.04 ? 1 : 0;
  S._wc = { comp, size, sea };
  return S._wc;
}
/** BFS distance (cells, capped) from sea cells (or from all water when there is no sea) */
function seaDistance(S, cap = 8) {
  if (S._sd) return S._sd;
  const { world } = S, N = world.size;
  const { comp, sea } = waterComps(S);
  const anySea = sea.some((v) => v);
  const d = new Uint8Array(N * N).fill(255);
  const q = new Int32Array(N * N);
  let h = 0, t = 0;
  for (let i = 0; i < N * N; i++) if (comp[i] >= 0 && (!anySea || sea[comp[i]])) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % N, y = (i / N) | 0, nd = d[i] + 1;
    if (nd > cap) continue;
    if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[t++] = i - 1; }
    if (x < N - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[t++] = i + 1; }
    if (y > 0 && d[i - N] > nd) { d[i - N] = nd; q[t++] = i - N; }
    if (y < N - 1 && d[i + N] > nd) { d[i + N] = nd; q[t++] = i + N; }
  }
  S._sd = d;
  return d;
}

function put(S, X, Y, col) { if (X >= 0 && Y >= 0 && X < S.W && Y < S.W) S.buf[Y * S.W + X] = col; }
function stampArt(S, art, ox, oy, col, ok, halo) {
  const { W, buf } = S;
  if (halo) {
    for (let y = -1; y <= art.length; y++) for (let x = -1; x <= art[0].length; x++) {
      const inArt = y >= 0 && y < art.length && x >= 0 && x < art[0].length && art[y][x] === '#';
      if (inArt) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < art.length && xx >= 0 && xx < art[0].length && art[yy][xx] === '#') { near = true; break; }
      }
      if (near) { const X = ox + x, Y = oy + y; if (X >= 0 && Y >= 0 && X < W && Y < W) buf[Y * W + X] = halo; }
    }
  }
  for (let y = 0; y < art.length; y++) for (let x = 0; x < art[y].length; x++) {
    if (art[y][x] !== '#') continue;
    const X = ox + x, Y = oy + y;
    if (X >= 0 && Y >= 0 && X < W && Y < W && (!ok || ok(X, Y))) buf[Y * W + X] = col;
  }
}
function artFits(S, art, ox, oy, ok) {
  for (let y = 0; y < art.length; y++) for (let x = 0; x < art[y].length; x++) {
    if (art[y][x] !== '#') continue;
    const X = ox + x, Y = oy + y;
    if (X < 2 || Y < 2 || X >= S.W - 2 || Y >= S.W - 2 || !ok(X, Y)) return false;
  }
  return true;
}
function bres(x0, y0, x1, y1, fn) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, k = 0;
  for (;;) {
    fn(x0, y0, k++);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
const cellPx = (S, v) => v * S.P + S.P / 2;

// ------------------------------------------------------------------------------- pass: fills
export function sigFills(S) {
  const { sig } = S.look;
  if (sig.has('iceLochans')) iceLochans(S);
  if (sig.has('pineRibbon')) pineFill(S);
  if (sig.has('gullySnow')) gullySnow(S);
}

function iceLochans(S) {
  const { world, W, P, buf, cls, seed } = S, N = world.size;
  const { comp, size, sea } = waterComps(S);
  const max = Number.isFinite(S.raw.iceMax) ? S.raw.iceMax : Math.round(N * N * 0.012);
  const ice = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { const c = comp[i]; if (c >= 0 && !sea[c] && size[c] <= max) ice[i] = 1; }
  // dilate one cell so wobbled shore pixels follow their lochan
  const dil = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < N && yy < N && ice[yy * N + xx]) { v = 1; break; }
    }
    dil[y * N + x] = v;
  }
  const fill = U[S.look.print.ice], crack = U.ice, shore = U.waterDeep;
  for (let Y = 0; Y < W; Y++) {
    const cy = (Y / P) | 0;
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X;
      if (!isWater(cls[idx]) || !dil[cy * N + ((X / P) | 0)]) continue;
      if (buf[idx] === shore && ((X > 0 && !isWater(cls[idx - 1])) || (X < W - 1 && !isWater(cls[idx + 1])) || (Y > 0 && !isWater(cls[idx - W])) || (Y < W - 1 && !isWater(cls[idx + W])))) continue;
      // hairline cracks: short diagonal runs on a sparse lattice
      const k = (X + 2 * Y) % 13, row = ((X + 2 * Y) / 13) | 0;
      const h = hash2(row, (Y / 5) | 0, seed + 301);
      buf[idx] = (k === 0 && (h & 3) !== 0) ? crack : fill;
    }
  }
  S.iceCells = dil;
}

function pineFill(S) {
  const { world, W, P, buf, cls, BY } = S, N = world.size;
  const reg = S.raw.pineRibbon;
  const pine = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (world.cover[y * N + x] === COVER.WOOD && inRegion(reg, x, y)) pine[y * N + x] = 1;
  const base = S.C.paper, tint = U.wood;
  for (let Y = 0; Y < W; Y++) {
    const cy = (Y / P) | 0;
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X;
      if (cls[idx] !== COVER.WOOD) continue;
      const cx = (X / P) | 0;
      if (!pine[cy * N + cx]) continue;
      buf[idx] = BY[((Y & 3) << 2) | (X & 3)] < 0.19 ? tint : base;
    }
  }
  S.pineCells = pine;
}

function gullySnow(S) {
  const { world, W, P, buf, cls, H, seed } = S;
  const raw = S.raw.gullySnow || {};
  const sl = world.level && world.level.season && world.level.season.snowline;
  const above = Number.isFinite(raw.above) ? raw.above : Number.isFinite(sl) ? sl * 0.9 : world.minH + (world.maxH - world.minH) * 0.62;
  const mask = S.snowMask || (S.snowMask = new Uint8Array(W * W));
  for (let Y = 1; Y < W - 1; Y++) {
    for (let X = 1; X < W - 1; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (isWater(c) || c === COVER.WOOD || c === COVER.SNOW) continue;
      const h = H[idx];
      if (h < above - 40) continue;
      const gx = (H[idx + 1] - H[idx - 1]) * 0.5, gy = (H[idx + W] - H[idx - W]) * 0.5;
      const g = Math.sqrt(gx * gx + gy * gy);
      if (g < 1.4) continue;
      const north = gy / g;                                  // 1 = faces due north
      if (north < 0.35) continue;
      const k = smooth01(above - 40, above + 60, h) * smooth01(0.35, 0.7, north) * smooth01(1.4, 3.2, g);
      const n = vnoise(X, Y, 3, 16, seed + 77) * 0.7 + vnoise(X, Y, 7, 30, seed + 78) * 0.3;
      if (n * k > 0.32) mask[idx] = 1;
    }
  }
  const edge = U.grid, snow = U.snow;
  for (let Y = 1; Y < W - 1; Y++) for (let X = 1; X < W - 1; X++) {
    const idx = Y * W + X;
    if (!mask[idx]) continue;
    const e = !mask[idx - 1] || !mask[idx + 1] || !mask[idx - W] || !mask[idx + W];
    buf[idx] = e && ((X + Y) & 1) === 0 ? edge : snow;
  }
}

// ------------------------------------------------------------------------------ pass: ground
export function sigGround(S) {
  const { sig } = S.look;
  if (sig.has('shingle')) shingle(S);
  if (sig.has('bracken')) bracken(S);
  if (sig.has('redScree')) redScree(S);
  if (sig.has('gabbro')) gabbroRock(S);
  if (sig.has('boulders')) boulders(S);
  if (sig.has('fieldWalls')) fieldWalls(S);
  if (sig.has('pineRibbon')) pineGlyphs(S);
}

function shingle(S) {
  const { world, W, P, buf, cls, H, seed } = S, N = world.size;
  const d = seaDistance(S, 4);
  const low = world.minH + Math.max(22, (world.maxH - world.minH) * 0.05);
  const ink = U.ink, stone = U[S.look.print.rock];
  for (let Y = 0; Y < W; Y++) {
    const cy = (Y / P) | 0;
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (isWater(c) || c === COVER.CRAG || c === COVER.WOOD) continue;
      const dd = d[cy * N + ((X / P) | 0)];
      if (dd > 3 || H[idx] > low) continue;
      const dens = (dd <= 1 ? 30 : dd === 2 ? 20 : 11) * (1 - Math.max(0, (H[idx] - low * 0.6) / (low * 0.4 + 1)) * 0.6);
      const r = hash2(X, Y, seed + 71) % 100;
      if (r < dens * 0.3) buf[idx] = ink;
      else if (r < dens) buf[idx] = stone;
    }
  }
}

function bracken(S) {
  const { world, W, buf, cls, grad, H, seed } = S;
  const span = Math.max(1, world.maxH - world.minH);
  const rust = U.rust;
  const reg = S.raw.bracken;
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (c !== COVER.MOOR) continue;
      const g = grad[idx];
      if (g < 1.0 || g > 8) continue;
      const en = (H[idx] - world.minH) / span;
      if (en < 0.03 || en > 0.62) continue;
      if (reg && !inRegion(reg, X / S.P, Y / S.P)) continue;
      const patch = vnoise(X, Y, 34, 26, seed + 91) * 0.75 + vnoise(X, Y, 9, 7, seed + 92) * 0.25;
      const k = smooth01(0.58, 0.68, patch) * smooth01(1.0, 2.2, g) * (1 - smooth01(0.5, 0.62, en));   // sparse patches
      if (k <= 0) continue;
      const r = hash2(X, Y, seed + 93) % 100;
      if (r < 22 * k) { buf[idx] = rust; if (r < 8 * k && X < W - 1 && cls[idx + 1] === COVER.MOOR) buf[idx + 1] = rust; }
    }
  }
}

function redScree(S) {
  const { W, P, buf, cls, grad, seed } = S;
  const reg = S.raw.redScree;
  const rust = U.rust, ash = U.ash, rock = S.C.rock, ink = U.ink;
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (c !== COVER.SCREE && c !== COVER.ROCK && c !== COVER.MOOR) continue;
      if (!inRegion(reg, X / P, Y / P)) continue;
      const r = hash2(X, Y, seed + 111) % 100;
      if (c === COVER.SCREE) {
        if (buf[idx] === rock || buf[idx] === ink) buf[idx] = r < 62 ? rust : ash;
        else if (r < 9) buf[idx] = rust;
        else if (r < 13) buf[idx] = ash;
      } else if (c === COVER.ROCK) {
        if (buf[idx] === ink) buf[idx] = rust;
        else if (r < 7) buf[idx] = rust;
      } else if (grad[idx] > 2.4) {
        const k = smooth01(2.4, 5, grad[idx]);
        if (r < 8 * k) buf[idx] = rust; else if (r < 12 * k) buf[idx] = ash;
      }
    }
  }
}

/** is pixel X,Y inside the gabbro (heavy rock drawing) region? */
export function gabbroAt(S, X, Y) {
  if (!S.look.sig.has('gabbro')) return false;
  return inRegion(S.raw.gabbro, X / S.P, Y / S.P);
}

function gabbroRock(S) {
  const { W, P, buf, cls, seed } = S;
  const reg = S.raw.gabbro;
  const ink = U.ink, charc = U.char;
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (c !== COVER.ROCK && c !== COVER.SCREE) continue;
      if (!inRegion(reg, X / P, Y / P)) continue;
      const r = hash2(X, Y, seed + 131) % 100;
      if (c === COVER.SCREE) { if (r < 9) buf[idx] = ink; continue; }
      if (r < 7) buf[idx] = charc;
      if (hash2(X, Y, seed + 132) % 16 === 0) {                     // dense dark fractures
        const dir = (hash2(X, Y, seed + 133) & 1) ? 1 : -1, len = 3 + (hash2(X, Y, seed + 134) % 4);
        for (let k = 0; k < len; k++) {
          const xx = X + k, yy = Y + (k >> 1) * dir;
          if (xx < W && yy >= 0 && yy < W && cls[yy * W + xx] === COVER.ROCK) buf[yy * W + xx] = ink;
        }
      }
    }
  }
}

function boulders(S) {
  const { W, P, cls, grad, seed } = S;
  const reg = S.raw.boulders;
  const regional = !!(reg && Number.isFinite(reg.r));
  const arts = [SIG_ART.boulderA, SIG_ART.boulderB, SIG_ART.boulderC];
  const ink = U.ink;
  const okAt = (X, Y) => {
    const c = cls[Y * W + X];
    if (isWater(c) || c === COVER.WOOD || c === COVER.CRAG || c === COVER.SNOW && !regional) return false;
    if (regional) return inRegion(reg, X / P, Y / P);
    return (c === COVER.ROCK || c === COVER.SCREE) && grad[Y * W + X] < 3;
  };
  // a regional field thins out towards its rim instead of stopping at a circle
  const keep = (X, Y, h) => {
    if (!regional) return true;
    const d = Math.hypot(X / P - reg.x, Y / P - reg.y) / reg.r;
    return ((h >>> 20) & 255) / 256 < 1 - d * d * d;
  };
  const step = regional ? 6 : 7;
  for (let ty = 0; ty < W; ty += step) {
    for (let tx = 0; tx < W; tx += step) {
      const h = hash2(tx, ty, seed + 151);
      if ((h & 7) < (regional ? 3 : 4)) continue;
      const cx = tx + ((h >>> 4) % (step - 2)), cy = ty + ((h >>> 9) % (step - 2));
      if (cx < 3 || cy < 3 || cx > W - 4 || cy > W - 4 || !okAt(cx, cy) || !keep(cx, cy, h)) continue;
      const art = arts[(h >>> 14) % 3];
      if (!artFits(S, art, cx, cy, okAt)) continue;
      stampArt(S, art, cx, cy, ink);
    }
  }
}

function fieldWalls(S) {
  const { world, W, P, cls, seed } = S, N = world.size;
  const reg = S.raw.fieldWalls;
  const h = world.height;
  // glen floor: gentle, and lower than the ground round about (box-blurred height, radius 8 cells)
  const R = 8, tmp = new Float32Array(N * N), blur = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    let acc = 0;
    for (let k = -R; k <= R; k++) acc += h[y * N + Math.min(N - 1, Math.max(0, k))];
    for (let x = 0; x < N; x++) {
      tmp[y * N + x] = acc / (2 * R + 1);
      acc += h[y * N + Math.min(N - 1, x + R + 1)] - h[y * N + Math.max(0, x - R)];
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let k = -R; k <= R; k++) acc += tmp[Math.min(N - 1, Math.max(0, k)) * N + x];
    for (let y = 0; y < N; y++) {
      blur[y * N + x] = acc / (2 * R + 1);
      acc += tmp[Math.min(N - 1, y + R + 1) * N + x] - tmp[Math.max(0, y - R) * N + x];
    }
  }
  const span = Math.max(1, world.maxH - world.minH);
  const raw = new Uint8Array(N * N);
  for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
    const i = y * N + x, c = world.cover[i];
    if (c !== COVER.MOOR && c !== COVER.PATH) continue;
    const sl = Math.max(Math.abs(h[i + 1] - h[i - 1]), Math.abs(h[i + N] - h[i - N])) * 0.5;
    if (sl > 4) continue;
    const en = (h[i] - world.minH) / span;
    if (en > 0.45 || (blur[i] - h[i] < 4 && en > 0.25)) continue;
    if (reg && !inRegion(reg, x, y)) continue;
    raw[i] = 1;
  }
  // open then close the mask (3x3) so the enclosures form solid blocks, not speckle
  const morph = (src, keep) => {
    const out = new Uint8Array(N * N);
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += src[(y + dy) * N + x + dx];
      out[y * N + x] = keep ? (n >= 9 ? 1 : 0) : (n > 0 ? 1 : 0);
    }
    return out;
  };
  const ok = morph(morph(morph(raw, true), false), false);
  const pxOk = (X, Y) => {
    if (X < 2 || Y < 2 || X >= W - 2 || Y >= W - 2) return false;
    const c = cls[Y * W + X];
    if (c !== COVER.MOOR) return false;
    return ok[((Y / P) | 0) * N + ((X / P) | 0)] === 1;
  };
  // strip fields: long dykes down the glen at a jittered spacing, cross dykes at random heights in each strip
  const wall = U.char;
  const draw = (x0, y0, x1, y1) => {
    let n = 0, m = 0;
    bres(x0, y0, x1, y1, (x, y) => { m++; if (pxOk(x, y)) n++; });
    if (n < m * 0.7) return;
    bres(x0, y0, x1, y1, (x, y) => { if (pxOk(x, y)) S.buf[y * W + x] = wall; });
  };
  const COLW = 30;
  const cols = [];
  for (let x = 0, k = 0; x < W + COLW; k++) { cols.push(x + (hash2(k, 0, seed + 171) % 9) - 4); x += COLW - 6 + (hash2(k, 1, seed + 171) % 13); }
  for (let k = 0; k < cols.length - 1; k++) {
    const xa = cols[k], xb = cols[k + 1];
    let y = (hash2(k, 2, seed + 171) % 20);
    let prevA = y;
    while (y < W) {
      const step = 14 + (hash2(k, y, seed + 172) % 22);
      const ya = y + step + (hash2(k, y, seed + 173) % 5) - 2, yb = y + step + (hash2(k, y, seed + 174) % 5) - 2;
      draw(xa, prevA, xa, ya);                                  // the long dyke on the strip's west side
      if ((hash2(k, y, seed + 175) & 7) !== 0) draw(xa, ya, xb, yb);   // a cross dyke (now and then a gap)
      prevA = ya; y += step;
    }
  }
}

function pineGlyphs(S) {
  const { world, W, P, cls, seed } = S, N = world.size;
  const pine = S.pineCells;
  if (!pine) return;
  const art = SIG_ART.pine;
  const okAt = (X, Y) => cls[Y * W + X] === COVER.WOOD && pine[((Y / P) | 0) * N + ((X / P) | 0)] === 1;
  for (let ty = 0; ty < W; ty += 8) {
    for (let tx = 0; tx < W; tx += 8) {
      const h = hash2(tx, ty, seed + 191);
      if ((h & 7) < 3) continue;
      const cx = tx + ((h >>> 4) % 4), cy = ty + ((h >>> 9) % 3);
      if (!okAt(cx + 2, cy + 5) || !artFits(S, art, cx, cy, okAt)) continue;
      stampArt(S, art, cx, cy, U.woodDark);
      put(S, cx + 2, cy + 5, U.contourIdx);
    }
  }
}

// ------------------------------------------------------------------------------- pass: lines
export function sigLines(S) {
  const { sig } = S.look;
  if (sig.has('tidalRace')) tidalRace(S);
  if (sig.has('dam')) dam(S);
  if (sig.has('railway')) railway(S);
  if (sig.has('shieling')) shielings(S);
  if (sig.has('castle')) castle(S);
}

function tidalRace(S) {
  const t = S.raw.tidalRace;
  if (!t) return;
  const { W, P, cls, seed } = S;
  const cx = cellPx(S, t.x), cy = cellPx(S, t.y), R = Math.max(8, (t.r || 10) * P);
  const art = SIG_ART.wave;
  const okAt = (X, Y) => isWater(cls[Y * W + X]);
  for (let ty = Math.max(0, Math.floor(cy - R)); ty < Math.min(W, cy + R); ty += 5) {
    const off = (((ty / 5) | 0) & 1) * 4;
    for (let tx = Math.max(0, Math.floor(cx - R)) + off; tx < Math.min(W, cx + R); tx += 8) {
      const h = hash2(tx, ty, seed + 211);
      const X = tx + (h % 3), Y = ty + ((h >>> 3) % 2);
      const d = Math.hypot(X - cx, Y - cy) / R;
      if (d >= 1 || (h >>> 8) / 16777216 > (1 - d * d) * 0.95) continue;
      if (!artFits(S, art, X, Y, okAt)) continue;
      stampArt(S, art, X, Y, U.waterInk);
    }
  }
}

function dam(S) {
  const d = S.raw.dam;
  if (!d) return;
  const { W, H } = S;
  const x0 = Math.round(cellPx(S, d.x0)), y0 = Math.round(cellPx(S, d.y0)), x1 = Math.round(cellPx(S, d.x1)), y1 = Math.round(cellPx(S, d.y1));
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  let nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const hAt = (x, y) => { const X = Math.max(0, Math.min(W - 1, Math.round(x))), Y = Math.max(0, Math.min(W - 1, Math.round(y))); return H[Y * W + X]; };
  if (hAt(mx + nx * 16, my + ny * 16) > hAt(mx - nx * 16, my - ny * 16)) { nx = -nx; ny = -ny; }   // n points downstream
  S.damInfo = { mx, my, nx, ny, len };
  const ink = U.ink, halo = S.C.paper;
  // halo, then a 3 px wall with teeth on the downstream face
  bres(x0, y0, x1, y1, (x, y) => { for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (Math.abs(a) + Math.abs(b) <= 4) { const X = x + a, Y = y + b; if (X >= 0 && Y >= 0 && X < W && Y < W && S.buf[Y * W + X] !== ink) S.buf[Y * W + X] = halo; } });
  bres(x0, y0, x1, y1, (x, y, k) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) put(S, x + a, y + b, ink);
    if (k % 3 === 0) for (let s = 2; s <= 4; s++) put(S, Math.round(x + nx * s), Math.round(y + ny * s), ink);
  });
}

function railPoints(S) {
  const r = S.raw.railway;
  if (!r) return { pts: [], halts: [] };
  const pts = Array.isArray(r) ? r : r.points || [];
  const halts = (!Array.isArray(r) && r.halts) || S.raw.halts || [];
  return { pts: pts.map((p) => (Array.isArray(p) ? p : [p.x, p.y])), halts: halts.map((h) => (Array.isArray(h) ? { x: h[0], y: h[1], name: h[2] } : h)) };
}

function railway(S) {
  const { pts, halts } = railPoints(S);
  if (pts.length < 2) return;
  const dense = S.smoothPath(pts.map(([x, y]) => [cellPx(S, x), cellPx(S, y)]));
  const ink = U.ink, halo = S.C.paper;
  // a paper casing keeps the line clean over contours and woods
  for (let i = 0; i < dense.length; i++) {
    const [x, y] = dense[i];
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (Math.abs(a) + Math.abs(b) <= 2) put(S, x + a, y + b, halo);
  }
  for (let i = 0; i < dense.length; i++) {
    const [x, y] = dense[i];
    const p = dense[Math.max(0, i - 4)], q = dense[Math.min(dense.length - 1, i + 4)];
    let tx = q[0] - p[0], ty = q[1] - p[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    // a 2 px track: the second pixel always on the same side across the dominant axis, so the width is even
    const horiz = Math.abs(tx) >= Math.abs(ty);
    put(S, x, y, ink);
    put(S, x + (horiz ? 0 : 1), y + (horiz ? 1 : 0), ink);
    if (i % 6 === 3) {                                                  // OS single track: cross ticks
      for (let s = -3; s <= 3; s++) put(S, Math.round(x + 0.5 * (horiz ? 0 : 1) - ty * s), Math.round(y + 0.5 * (horiz ? 1 : 0) + tx * s), ink);
    }
  }
  for (const h of halts) {
    const X = Math.round(cellPx(S, h.x)) - 2, Y = Math.round(cellPx(S, h.y)) - 2;
    stampArt(S, SIG_ART.halt, X, Y, ink, null, halo);
    for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) put(S, X + a, Y + b, U.ember);
  }
}

function shielings(S) {
  const list = S.raw.shielings || [];
  for (const p of list) {
    const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
    stampArt(S, SIG_ART.ruin, Math.round(cellPx(S, x)) - 2, Math.round(cellPx(S, y)) - 2, U.ink, null, S.C.paper);
  }
}

function castle(S) {
  const c = S.raw.castle;
  if (!c) return;
  const art = SIG_ART.castle;
  stampArt(S, art, Math.round(cellPx(S, c.x)) - 3, Math.round(cellPx(S, c.y)) - 2, U.ink, null, S.C.paper);
}

// ---------------------------------------------------------------------------- pass: labels
function labelAt(S, ctx, text, x, y, color, opts, halo) {
  const font = opts.font || 'small';
  const tw = measureText(text, { font, italic: opts.italic, spacing: opts.spacing });
  const th = font === 'small' ? 5 : 7;
  const cands = opts.cands || [[0, 0]];
  for (const [ox, oy] of cands) {
    const X = Math.round(x + ox - (opts.center ? tw / 2 : 0)), Y = Math.round(y + oy - th / 2);
    const r = { x: X - 1, y: Y - 1, w: tw + 2, h: th + 2 };
    if (!S.free(r)) continue;
    S.occ.push(r);
    drawText(ctx, text, X, Y, color, { font, italic: opts.italic, spacing: opts.spacing, halo });
    return true;
  }
  return false;
}

export function sigLabels(S, ctx) {
  const { sig } = S.look;
  const raw = S.raw, P = S.P, paper = PAL[S.look.print.base];
  const near = (sym, w, h) => [[w / 2 + 3, 0], [-(w / 2 + 3), 0], [0, h / 2 + 5], [0, -(h / 2 + 5)]];
  // symbols reserve their own box first
  const reserve = (x, y, w, h) => S.occ.push({ x: x - 1, y: y - 1, w: w + 2, h: h + 2 });
  if (sig.has('castle') && raw.castle) {
    const cx = cellPx(S, raw.castle.x), cy = cellPx(S, raw.castle.y);
    reserve(cx - 3, cy - 2, 7, 5);
    const name = raw.castle.name || 'Castle';
    const tw = measureText(name, { font: 'main', italic: true });
    labelAt(S, ctx, name, cx, cy, PAL.ink, { font: 'main', italic: true, cands: [[6, 0], [-tw - 6, 0], [-tw / 2, 9], [-tw / 2, -9]] }, paper);
  }
  if (sig.has('dam') && S.damInfo) {
    const d = S.damInfo;
    labelAt(S, ctx, 'Dam', d.mx + d.nx * 10, d.my + d.ny * 10, PAL.ink, { center: true, cands: [[0, 0], [0, 7], [0, -7], [10, 0], [-10, 0]] }, paper);
  }
  if (sig.has('railway')) {
    const { halts } = railPoints(S);
    for (const h of halts) {
      const x = cellPx(S, h.x), y = cellPx(S, h.y);
      reserve(x - 2, y - 2, 5, 5);
      if (h.name) {
        const tw = measureText(h.name, { font: 'small' });
        labelAt(S, ctx, h.name, x, y, PAL.ink, { cands: [[5, 0], [-tw - 5, 0], [-tw / 2, 7], [-tw / 2, -7]] }, paper);
      }
    }
  }
  if (sig.has('shieling') && (raw.shielings || []).length) {
    const list = raw.shielings.map((p) => (Array.isArray(p) ? p : [p.x, p.y]));
    for (const [x, y] of list) reserve(cellPx(S, x) - 2, cellPx(S, y) - 2, 4, 4);
    const [x, y] = list[0];
    const label = raw.shielingLabel || 'Shielings';
    const tw = measureText(label, { font: 'small' });
    labelAt(S, ctx, label, cellPx(S, x), cellPx(S, y), PAL.ink, { cands: near(null, 4, 4).map(([a, b]) => [a < 0 ? -tw - 3 : a > 0 ? a : -tw / 2, b]) }, paper);
  }
  if (sig.has('tidalRace') && raw.tidalRace) {
    const t = raw.tidalRace, x = cellPx(S, t.x), y = cellPx(S, t.y), R = (t.r || 10) * P;
    const tw = measureText('Overfalls', { font: 'main', italic: true });
    labelAt(S, ctx, 'Overfalls', x, y, PAL.waterInk, { font: 'main', italic: true, cands: [[-tw / 2, R + 6], [-tw / 2, -R - 6], [R + 4, 0], [-R - tw - 4, 0], [-tw / 2, 0]] }, PAL.water);
  }
  if (sig.has('soundings')) soundings(S, ctx);
}

function soundings(S, ctx) {
  const { world, W, P, cls, seed } = S, N = world.size;
  const { comp, sea } = waterComps(S);
  const anySea = sea.some((v) => v);
  if (!anySea) return;
  // distance from land inside the sea (cells)
  const d = new Uint8Array(N * N).fill(255), q = new Int32Array(N * N);
  let h = 0, t = 0;
  for (let i = 0; i < N * N; i++) if (comp[i] < 0) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % N, y = (i / N) | 0, nd = d[i] + 1;
    if (nd > 60) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) if (j >= 0 && d[j] > nd) { d[j] = nd; q[t++] = j; }
  }
  const STEP = 44;
  const avoid = S.raw.tidalRace;
  for (let ty = 8; ty < W - 8; ty += STEP) {
    for (let tx = 8; tx < W - 8; tx += STEP) {
      const r = hash2(tx, ty, seed + 231);
      if ((r & 3) === 0) continue;
      const X = tx + (r >>> 4) % (STEP - 14), Y = ty + (r >>> 12) % (STEP - 10);
      const cx = (X / P) | 0, cy = (Y / P) | 0;
      if (cx < 0 || cy < 0 || cx >= N || cy >= N) continue;
      const i = cy * N + cx;
      if (comp[i] < 0 || !sea[comp[i]] || d[i] < 3 || !isWater(cls[Y * W + X])) continue;
      if (avoid && Math.hypot(cx - avoid.x, cy - avoid.y) < (avoid.r || 10) + 3) continue;
      const depth = Math.round(3 + d[i] * 2.6 + ((r >>> 20) % 9));
      const txt = String(depth);
      const tw = measureText(txt, { font: 'small' });
      const rr = { x: X - 1, y: Y - 1, w: tw + 2, h: 7 };
      if (!S.free(rr)) continue;
      // every sample under the digits must be water
      let wet = true;
      for (let yy = Y; yy < Y + 5 && wet; yy++) for (let xx = X; xx < X + tw; xx++) if (!isWater(cls[yy * W + xx])) { wet = false; break; }
      if (!wet) continue;
      S.occ.push(rr);
      drawText(ctx, txt, X, Y, PAL.waterInk, { font: 'small' });
    }
  }
}

// ------------------------------------------------------------------------------- hidden valley
/**
 * Omit the hidden valley from the sheet: blank paper (the 1 km grid kept) inside look.hidden, a dithered rim.
 * Mutates pixels / lvl / lvlKind in place and returns the reveal record the renderer restores on entry:
 *   { key, x, y, r (cells), x0, y0, w, h (px box), pixels, lvl, lvlKind (the true contents of the box) }
 */
export function sigVeil(S, pixels, lvl, lvlKind) {
  const hd = S.raw.hidden;
  if (!S.look.sig.has('hiddenValley') || !hd || !Number.isFinite(hd.r)) return null;
  const { W, P } = S;
  const cx = cellPx(S, hd.x), cy = cellPx(S, hd.y), R = hd.r * P;
  const x0 = Math.max(2, Math.floor(cx - R - 4)), y0 = Math.max(2, Math.floor(cy - R - 4));
  const x1 = Math.min(W - 3, Math.ceil(cx + R + 4)), y1 = Math.min(W - 3, Math.ceil(cy + R + 4));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const keep = { pixels: new Uint32Array(w * h), lvl: new Int16Array(w * h), lvlKind: new Uint8Array(w * h) };
  const blank = S.C.paper, grid = U.grid, step = S.gridStep;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x0 + x, Y = y0 + y, i = Y * W + X, k = y * w + x;
      keep.pixels[k] = pixels[i]; keep.lvl[k] = lvl[i]; keep.lvlKind[k] = lvlKind[i];
      const d = Math.hypot(X - cx, Y - cy);
      const f = smooth01(R + 4, R - 6, d);                                // 1 inside, 0 beyond the rim
      if (f <= 0) continue;
      if (S.BY[((Y & 3) << 2) | (X & 3)] >= f) continue;
      pixels[i] = (X % step === 0 || Y % step === 0) ? grid : blank;
      lvl[i] = 0; lvlKind[i] = 0;
    }
  }
  return { key: hd.key || 'hidden', name: hd.name || null, x: hd.x, y: hd.y, r: hd.r, x0, y0, w, h, ...keep };
}

/** Is cell (x, y) inside the (unrevealed) hidden region of a look? (overview veil) */
export function hiddenAt(look, x, y) {
  const hd = look.raw.hidden;
  if (!look.sig.has('hiddenValley') || !hd || !Number.isFinite(hd.r)) return false;
  return (x - hd.x) ** 2 + (y - hd.y) ** 2 <= hd.r * hd.r;
}

export { inRegion };
