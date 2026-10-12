/**
 * Map bake: turns a World into an Ordnance-Survey-style pixel map.
 *
 * bakeMap(world) -> HTMLCanvasElement (size*CELL_PX square, 1024 px) carrying
 *   .pixels  Uint32Array  final RGBA (ABGR u32) of the whole sheet
 *   .lvl     Int16Array   per pixel: contour level + LVL_OFF where a contour is drawn, else 0
 *   .lvlKind Uint8Array   1 minor line, 2 index line (0 = none)
 *   .W       sheet width in px
 * Everything is written pixel-exact; there is no anti-aliasing anywhere.
 */
import { COVER, CELL_PX, GRID_CELLS } from '../world/codes.js';
import { PAL, PAL_U32 as U } from './palette.js';
import { hash2, hash2f } from '../core/rng.js';
import { drawText, measureText } from './font.js';
import { artCanvas, symbolArt, MAP_SYMBOLS, TREE_ART, TUFT_ART } from './sprites.js';

export const LVL_OFF = 200;

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------ interpolation
/** Catmull-Rom bicubic upsample of an N x N field by integer factor P (sample i sits at pixel i*P). */
export function upsampleCubic(src, N, P) {
  const W = N * P;
  const i0 = new Int16Array(W);
  const w = new Float32Array(W * 4);
  for (let X = 0; X < W; X++) {
    const s = X / P, i = Math.floor(s), f = s - i, f2 = f * f, f3 = f2 * f;
    i0[X] = i;
    w[X * 4] = -0.5 * f3 + f2 - 0.5 * f;
    w[X * 4 + 1] = 1.5 * f3 - 2.5 * f2 + 1;
    w[X * 4 + 2] = -1.5 * f3 + 2 * f2 + 0.5 * f;
    w[X * 4 + 3] = 0.5 * f3 - 0.5 * f2;
  }
  const cl = (v) => (v < 0 ? 0 : v > N - 1 ? N - 1 : v);
  const tmp = new Float32Array(N * W);
  for (let r = 0; r < N; r++) {
    const ro = r * N;
    for (let X = 0; X < W; X++) {
      const b = i0[X], k = X * 4;
      tmp[r * W + X] = w[k] * src[ro + cl(b - 1)] + w[k + 1] * src[ro + cl(b)] + w[k + 2] * src[ro + cl(b + 1)] + w[k + 3] * src[ro + cl(b + 2)];
    }
  }
  const out = new Float32Array(W * W);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < src.length; i++) { if (src[i] < lo) lo = src[i]; if (src[i] > hi) hi = src[i]; }
  for (let Y = 0; Y < W; Y++) {
    const b = i0[Y], k = Y * 4;
    const r0 = cl(b - 1) * W, r1 = cl(b) * W, r2 = cl(b + 1) * W, r3 = cl(b + 2) * W;
    const a0 = w[k], a1 = w[k + 1], a2 = w[k + 2], a3 = w[k + 3];
    const o = Y * W;
    for (let X = 0; X < W; X++) {
      let v = a0 * tmp[r0 + X] + a1 * tmp[r1 + X] + a2 * tmp[r2 + X] + a3 * tmp[r3 + X];
      out[o + X] = v < lo ? lo : v > hi ? hi : v;
    }
  }
  return out;
}

// smooth lattice noise used to wobble region edges
function makeWarp(W, seed) {
  const S = 7;                                     // lattice spacing in px
  const L = Math.ceil(W / S) + 3;
  const lx = new Float32Array(L * L), ly = new Float32Array(L * L);
  for (let j = 0; j < L; j++) for (let i = 0; i < L; i++) {
    lx[j * L + i] = hash2f(i, j, seed ^ 0x51) * 2 - 1;
    ly[j * L + i] = hash2f(i, j, seed ^ 0xa7) * 2 - 1;
  }
  const AMP = 2.4;
  return function warp(X, Y, out) {
    const gx = X / S, gy = Y / S;
    const i = gx | 0, j = gy | 0;
    let fx = gx - i, fy = gy - j;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = j * L + i, b = a + 1, c = a + L, d = c + 1;
    out[0] = ((lx[a] * (1 - fx) + lx[b] * fx) * (1 - fy) + (lx[c] * (1 - fx) + lx[d] * fx) * fy) * AMP;
    out[1] = ((ly[a] * (1 - fx) + ly[b] * fx) * (1 - fy) + (ly[c] * (1 - fx) + ly[d] * fx) * fy) * AMP;
  };
}

const isWaterCode = (c) => c === COVER.SHALLOW || c === COVER.DEEP;

/** Per-pixel cover class with rounded + wobbled region edges. */
function classify(world, W, warp) {
  const N = world.size, P = CELL_PX;
  const base = new Uint8Array(N * N);
  for (let i = 0; i < base.length; i++) base[i] = world.cover[i] === COVER.PATH ? COVER.MOOR : world.cover[i];
  const cls = new Uint8Array(W * W);
  const wv = [0, 0];
  const cl = (v) => (v < 0 ? 0 : v > N - 1 ? N - 1 : v);
  // cells whose whole 3x3 neighbourhood shares one class never need the wobble
  const uni = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = base[j * N + i];
    let same = 1;
    for (let dj = -1; dj <= 1 && same; dj++) for (let di = -1; di <= 1; di++) {
      if (base[cl(j + dj) * N + cl(i + di)] !== c) { same = 0; break; }
    }
    uni[j * N + i] = same;
  }
  for (let Y = 0; Y < W; Y++) {
    const cj = (Y / P) | 0;
    for (let X = 0; X < W; X++) {
      const ci = (X / P) | 0;
      if (uni[cj * N + ci]) { cls[Y * W + X] = base[cj * N + ci]; continue; }
      warp(X, Y, wv);
      const u = (X + wv[0]) / P - 0.5, v = (Y + wv[1]) / P - 0.5;
      const iu = Math.floor(u), iv = Math.floor(v);
      const fx = u - iu, fy = v - iv;
      const xa = cl(iu), xb = cl(iu + 1), ya = cl(iv) * N, yb = cl(iv + 1) * N;
      const c00 = base[ya + xa], c10 = base[ya + xb], c01 = base[yb + xa], c11 = base[yb + xb];
      if (c00 === c10 && c00 === c01 && c00 === c11) { cls[Y * W + X] = c00; continue; }
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      let s00 = w00 + (c10 === c00 ? w10 : 0) + (c01 === c00 ? w01 : 0) + (c11 === c00 ? w11 : 0);
      let s10 = c10 !== c00 ? w10 + (c01 === c10 ? w01 : 0) + (c11 === c10 ? w11 : 0) : 0;
      let s01 = c01 !== c00 && c01 !== c10 ? w01 + (c11 === c01 ? w11 : 0) : 0;
      let s11 = c11 !== c00 && c11 !== c10 && c11 !== c01 ? w11 : 0;
      // water and snow win ties so shores stay continuous
      let best = c00, bs = s00;
      if (s10 > bs) { best = c10; bs = s10; }
      if (s01 > bs) { best = c01; bs = s01; }
      if (s11 > bs) { best = c11; bs = s11; }
      cls[Y * W + X] = best;
    }
  }
  return cls;
}

// -------------------------------------------------------------- pixel tools
function line(buf, W, x0, y0, x1, y1, col, step = null) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && y0 >= 0 && x0 < W && y0 < W) {
      if (step) step(x0, y0); else buf[y0 * W + x0] = col;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function stamp(buf, W, art, ox, oy, col, ok) {
  for (let y = 0; y < art.length; y++) {
    const row = art[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') {
        const X = ox + x, Y = oy + y;
        if (X >= 0 && Y >= 0 && X < W && Y < W && (!ok || ok(X, Y))) buf[Y * W + X] = col;
      }
    }
  }
}

/** Sample a quadratic-smoothed polyline of pixel points -> dense integer pixel list. */
function smoothPath(pts) {
  const out = [];
  const push = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    const l = out[out.length - 1];
    if (!l || l[0] !== x || l[1] !== y) {
      if (l && (Math.abs(l[0] - x) > 1 || Math.abs(l[1] - y) > 1)) {
        // fill gaps
        line(null, 1e9, l[0], l[1], x, y, 0, (px, py) => { const ll = out[out.length - 1]; if (ll[0] !== px || ll[1] !== py) out.push([px, py]); });
      } else out.push([x, y]);
    }
  };
  if (pts.length < 2) return out;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  push(pts[0][0], pts[0][1]);
  let prev = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const m0 = i === 1 ? pts[0] : mid(pts[i - 1], pts[i]);
    const m1 = mid(pts[i], pts[i + 1]);
    const len = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]);
    const n = Math.max(2, Math.ceil(len * 1.2));
    for (let s = 1; s <= n; s++) {
      const t = s / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      push(a * m0[0] + b * pts[i][0] + c * m1[0], a * m0[1] + b * pts[i][1] + c * m1[1]);
    }
    prev = m1;
  }
  const last = pts[pts.length - 1];
  const m0 = pts.length > 2 ? mid(pts[pts.length - 2], last) : pts[0];
  line(null, 1e9, Math.round(prev[0]), Math.round(prev[1]), Math.round(last[0]), Math.round(last[1]), 0, (px, py) => push(px, py));
  return out;
}

// ----------------------------------------------------------------- the bake
export function bakeMap(world, opts = {}) {
  const t0 = nowMs();
  const prof = []; let tl = t0; const mark = (n) => { const t = nowMs(); prof.push(n + ':' + Math.round(t - tl)); tl = t; };
  const N = world.size, P = CELL_PX, W = N * P;
  const interval = world.contourInterval || 10;
  const seed = (world.level && world.level.seed) | 0;
  const level = world.level || {};

  const H = upsampleCubic(world.height, N, P); mark('cubic');
  const warp = makeWarp(W, seed);
  const cls = classify(world, W, warp); mark('classify');
  const buf = new Uint32Array(W * W);

  const C = {
    paper: U.paper, paper2: U.paper2, contour: U.contour, contourIdx: U.contourIdx, water: U.water, waterDeep: U.waterDeep,
    waterInk: U.waterInk, wood: U.wood, woodDark: U.woodDark, ink: U.ink, magenta: U.magenta, grid: U.grid, snow: U.snow,
    rock: U.rock, bog: U.bog, night: U.night,
  };
  const BY = new Float32Array(16);                   // 4x4 bayer thresholds
  for (let i = 0; i < 16; i++) BY[i] = ([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][i] + 0.5) / 16;

  const span = Math.max(1, world.maxH - world.minH);
  const gAt = (idx, X, Y) => {
    const l = X > 0 ? H[idx - 1] : H[idx], r = X < W - 1 ? H[idx + 1] : H[idx];
    const u = Y > 0 ? H[idx - W] : H[idx], d = Y < W - 1 ? H[idx + W] : H[idx];
    return [(r - l) * 0.5, (d - u) * 0.5];
  };

  // ---- pass 1: base fills + relief --------------------------------------
  const grad = new Float32Array(W * W);              // metres per pixel magnitude
  const invSpan = 1 / span;
  for (let Y = 0; Y < W; Y++) {
    const yu = Y > 0 ? -W : 0, yd = Y < W - 1 ? W : 0;
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X;
      const gx = ((X < W - 1 ? H[idx + 1] : H[idx]) - (X > 0 ? H[idx - 1] : H[idx])) * 0.5;
      const gy = (H[idx + yd] - H[idx + yu]) * 0.5;
      grad[idx] = Math.sqrt(gx * gx + gy * gy);
      const th = BY[((Y & 3) << 2) | (X & 3)];
      const c = cls[idx];
      let col;
      if (c === COVER.MOOR || c === COVER.PATH || c === COVER.SCREE) {
        const sdir = (gx + gy) * 0.7071;
        const shade = sdir < 0 ? Math.min(1, -sdir / 4.5) : 0;
        const lit = sdir > 0 ? Math.min(1, sdir / 6) : 0;
        const en = (H[idx] - world.minH) * invSpan;
        const d = 0.05 + 0.2 * en + 0.5 * shade - 0.12 * lit;
        col = th < d ? C.paper2 : C.paper;
      } else {
        const sdir = (gx + gy) * 0.7071;
        const shade = sdir < 0 ? Math.min(1, -sdir / 4.5) : 0;
        switch (c) {
          case COVER.SHALLOW:
          case COVER.DEEP: col = C.water; break;
          case COVER.WOOD: col = (shade > 0.55 && th < shade * 0.28) ? C.woodDark : C.wood; break;
          case COVER.SNOW: col = (shade > 0.5 && th < (shade - 0.35) * 0.3) ? C.paper2 : C.snow; break;
          case COVER.BOG: col = th < 0.30 ? C.bog : (th < 0.42 + ((H[idx] - world.minH) * invSpan) * 0.1 ? C.paper2 : C.paper); break;
          case COVER.ROCK: col = ((X + Y) & 1) === 0 && th < 0.8 ? C.rock : C.paper2; break;
          case COVER.CRAG: col = th < 0.34 ? C.rock : C.paper2; break;
          default: col = C.paper;
        }
      }
      buf[idx] = col;
    }
  }

  mark('prev');
  // ---- pass 2: shorelines, wood edges, snow edges ------------------------
  const nb = (idx, X, Y, fn) => {
    if (X > 0 && fn(cls[idx - 1])) return true;
    if (X < W - 1 && fn(cls[idx + 1])) return true;
    if (Y > 0 && fn(cls[idx - W])) return true;
    if (Y < W - 1 && fn(cls[idx + W])) return true;
    return false;
  };
  const notWater = (c) => !isWaterCode(c);
  const notWood = (c) => c !== COVER.WOOD;
  const notSnow = (c) => c !== COVER.SNOW;
  const notBog = (c) => c !== COVER.BOG;
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (isWaterCode(c)) {
        if (nb(idx, X, Y, notWater)) buf[idx] = C.waterDeep;
        else if (c === COVER.DEEP && ((X * 3 + Y * 5) & 15) === 0 && ((Y & 1) === 0)) buf[idx] = C.waterDeep;
      } else if (c === COVER.WOOD) {
        if (nb(idx, X, Y, notWood) && ((X + Y) & 1) === 0) buf[idx] = C.woodDark;
      } else if (c === COVER.SNOW) {
        if (nb(idx, X, Y, notSnow) && ((X + Y) & 1) === 0) buf[idx] = C.grid;
      }
    }
  }

  mark('prev');
  // ---- pass 3: ground detail (trees, tufts, scree, rock) -----------------
  // conifers on a jittered 6px lattice
  for (let ty = 0; ty < W; ty += 6) {
    for (let tx = 0; tx < W; tx += 6) {
      const h1 = hash2(tx, ty, seed + 3);
      if ((h1 & 15) < 2) continue;
      const cx = tx + (h1 >>> 4) % 5, cy = ty + (h1 >>> 9) % 5;
      if (cx < 3 || cy < 6 || cx > W - 4 || cy > W - 2) continue;
      if (cls[cy * W + cx] !== COVER.WOOD || cls[(cy - 4) * W + cx] !== COVER.WOOD || cls[cy * W + cx - 3] !== COVER.WOOD || cls[cy * W + cx + 3] !== COVER.WOOD) continue;
      stamp(buf, W, TREE_ART, cx - 2, cy - 5, C.woodDark, (X, Y) => cls[Y * W + X] === COVER.WOOD);
    }
  }
  // marsh tufts on a 9px lattice
  for (let ty = 0; ty < W; ty += 9) {
    for (let tx = 0; tx < W; tx += 9) {
      const h1 = hash2(tx, ty, seed + 5);
      if ((h1 & 7) < 4) continue;
      const cx = tx + (h1 >>> 4) % 6, cy = ty + (h1 >>> 9) % 6;
      if (cx < 3 || cy < 3 || cx > W - 4 || cy > W - 3) continue;
      if (cls[cy * W + cx] !== COVER.BOG || cls[cy * W + cx + 4] !== COVER.BOG || cls[(cy + 2) * W + cx] !== COVER.BOG) continue;
      stamp(buf, W, TUFT_ART, cx - 2, cy - 1, C.waterInk, (X, Y) => cls[Y * W + X] === COVER.BOG);
    }
  }
  // scree stipple + rock cracks
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, c = cls[idx];
      if (c === COVER.SCREE) {
        const r = hash2(X, Y, seed + 9) % 100;
        if (r < 11) { buf[idx] = C.rock; if (r < 3 && X < W - 1 && cls[idx + 1] === COVER.SCREE) buf[idx + 1] = C.rock; }
        else if (r < 14) buf[idx] = C.ink;
      } else if (c === COVER.ROCK) {
        const r = hash2(X, Y, seed + 11) % 70;
        if (r === 0) {                              // short diagonal crack
          const dir = (hash2(X, Y, seed + 12) & 1) ? 1 : -1, len = 3 + (hash2(X, Y, seed + 13) % 3);
          for (let k = 0; k < len; k++) {
            const xx = X + k, yy = Y + (k >> 1) * dir;
            if (xx < W && yy >= 0 && yy < W && cls[yy * W + xx] === COVER.ROCK) buf[yy * W + xx] = C.ink;
          }
        }
      }
    }
  }

  mark('prev');
  // ---- pass 4: contours --------------------------------------------------
  const B = new Int16Array(W * W);
  for (let i = 0; i < B.length; i++) B[i] = Math.floor(H[i] / interval);
  const lvl = new Int16Array(W * W);
  const lvlKind = new Uint8Array(W * W);
  const thin = interval / 2.2;                       // metres/px above which minor lines would fuse
  for (let Y = 0; Y < W; Y++) {
    for (let X = 0; X < W; X++) {
      const idx = Y * W + X, b = B[idx];
      let hi = b, lo = b;
      if (X < W - 1) { const v = B[idx + 1]; if (v > hi) hi = v; if (v < lo) lo = v; }
      if (X > 0) { const v = B[idx - 1]; if (v > hi) hi = v; if (v < lo) lo = v; }
      if (Y < W - 1) { const v = B[idx + W]; if (v > hi) hi = v; if (v < lo) lo = v; }
      if (Y > 0) { const v = B[idx - W]; if (v > hi) hi = v; if (v < lo) lo = v; }
      let k = 0, level_ = 0;
      if (hi > b) { level_ = hi; k = Math.floor(hi / 5) > Math.floor(b / 5) ? 2 : 1; }
      else if (lo < b && Math.floor(b / 5) > Math.floor(lo / 5)) { level_ = b; k = 2; }
      if (!k) continue;
      const c = cls[idx];
      if (isWaterCode(c)) continue;
      if (k === 1 && (c === COVER.CRAG || grad[idx] > thin)) continue;
      const snow = c === COVER.SNOW;
      buf[idx] = k === 2 ? (snow ? C.waterDeep : C.contourIdx) : (snow ? C.grid : C.contour);
      lvl[idx] = level_ + LVL_OFF;
      lvlKind[idx] = k;
    }
  }

  mark('prev');
  // ---- pass 5: crag hatching ---------------------------------------------
  for (let ty = 0; ty < W; ty += 3) {
    for (let tx = 0; tx < W; tx += 3) {
      const h1 = hash2(tx, ty, seed + 21);
      const X = tx + (h1 % 3), Y = ty + ((h1 >>> 5) % 3);
      if (X < 1 || Y < 1 || X >= W - 1 || Y >= W - 1) continue;
      const idx = Y * W + X;
      if (cls[idx] !== COVER.CRAG) continue;
      const [gx, gy] = gAt(idx, X, Y);
      const m = Math.hypot(gx, gy);
      let dx = 0, dy = 1;
      if (m > 0.05) { dx = -gx / m; dy = -gy / m; }
      const len = 2 + ((h1 >>> 11) % 4);
      line(buf, W, X, Y, Math.round(X + dx * len), Math.round(Y + dy * len), C.ink, (px, py) => {
        const cc = cls[py * W + px];
        if (cc === COVER.CRAG || cc === COVER.SCREE) buf[py * W + px] = C.ink;
      });
    }
  }
  // crag top edge: solid line where the neighbour outside the cliff is higher
  for (let Y = 1; Y < W - 1; Y++) {
    for (let X = 1; X < W - 1; X++) {
      const idx = Y * W + X;
      if (cls[idx] !== COVER.CRAG) continue;
      const hh = H[idx];
      if ((cls[idx - 1] !== COVER.CRAG && H[idx - 1] > hh) || (cls[idx + 1] !== COVER.CRAG && H[idx + 1] > hh) ||
          (cls[idx - W] !== COVER.CRAG && H[idx - W] > hh) || (cls[idx + W] !== COVER.CRAG && H[idx + W] > hh)) buf[idx] = C.ink;
    }
  }

  mark('prev');
  // ---- pass 6: streams ---------------------------------------------------
  drawStreams(world, buf, cls, W, warp, C);

  mark('prev');
  // ---- pass 7: footpaths (dashed magenta / black) -------------------------
  const wv = [0, 0];
  for (const path of (world.features && world.features.paths) || []) {
    const pts = path.map((p) => {
      const X = p.x * P + P / 2, Y = p.y * P + P / 2;
      warp(X, Y, wv);
      return [X - wv[0], Y - wv[1]];
    });
    const dense = smoothPath(pts);
    let i = 0;
    for (const [x, y] of dense) {
      const ph = i % 6; i++;
      if (x < 0 || y < 0 || x >= W || y >= W) continue;
      if (isWaterCode(cls[y * W + x])) continue;
      if (ph < 3) buf[y * W + x] = C.magenta;
      else if (ph === 4) buf[y * W + x] = C.ink;
    }
  }

  mark('prev');
  // ---- pass 8: 1 km grid + sheet border -----------------------------------
  const step = GRID_CELLS * P;
  for (let g = 0; g * step < W; g++) {
    const p = g * step;
    for (let t = 0; t < W; t++) {
      if (p < W) { buf[t * W + p] = C.grid; buf[p * W + t] = C.grid; }
    }
  }
  for (let t = 0; t < W; t++) {
    for (let e = 0; e < 2; e++) {
      buf[t * W + e] = C.ink; buf[t * W + (W - 1 - e)] = C.ink; buf[e * W + t] = C.ink; buf[(W - 1 - e) * W + t] = C.ink;
    }
  }
  for (let i = 0; i < buf.length; i++) {
    // keep flash map honest where later passes (grid/border) overwrote contours
    if (lvl[i] && buf[i] !== C.contour && buf[i] !== C.contourIdx && buf[i] !== C.grid && buf[i] !== C.waterDeep) { lvl[i] = 0; lvlKind[i] = 0; }
  }

  mark('prev');
  // ---- canvas layer: symbols & text ----------------------------------------
  const canvas = makeCanvas(W, W);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), W, W), 0, 0);
  const occ = [];
  const free = (r) => !occ.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) && r.x >= 4 && r.y >= 4 && r.x + r.w <= W - 4 && r.y + r.h <= W - 4;
  const reserve = (r) => { occ.push(r); return r; };

  drawGate(ctx, world, W, occ, free);
  drawPois(ctx, world, W, occ, free, cls);
  drawFeatureLabels(ctx, world, W, occ, free, cls);
  drawSpotHeights(ctx, world, W, occ, free);
  drawContourLabels(ctx, world, W, lvl, lvlKind, cls, occ, free, interval, seed);
  drawGridLabels(ctx, world, W, level);

  const img = ctx.getImageData(0, 0, W, W);
  canvas.pixels = new Uint32Array(img.data.buffer);
  canvas.lvl = lvl;
  canvas.lvlKind = lvlKind;
  canvas.W = W;
  canvas.cls = cls;
  mark('text');
  canvas.bakeMs = nowMs() - t0;
  canvas.bakeProfile = prof.join(' ');
  return canvas;
}

// ------------------------------------------------------------------ streams
function drawStreams(world, buf, cls, W, warp, C) {
  const N = world.size, P = CELL_PX;
  const st = world.stream;
  const cells = [];
  for (let i = 0; i < N * N; i++) if (st[i]) cells.push(i);
  if (!cells.length) return;
  const h = world.height;
  const down = new Int32Array(N * N).fill(-1);
  for (const i of cells) {
    const x = i % N, y = (i / N) | 0;
    let best = -1, bh = h[i];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      const hj = h[j] - (st[j] ? 0.01 : 0);       // prefer staying in the stream
      if (hj < bh) { bh = hj; best = j; }
    }
    down[i] = best;
  }
  const acc = new Float32Array(N * N);
  const sorted = cells.slice().sort((a, b) => h[b] - h[a]);
  for (const i of sorted) acc[i] += 1;
  for (const i of sorted) { const d = down[i]; if (d >= 0 && st[d]) acc[d] += acc[i]; }
  const ups = new Map();
  for (const i of cells) { const d = down[i]; if (d >= 0 && st[d]) { if (!ups.has(d)) ups.set(d, []); ups.get(d).push(i); } }
  // drop stubs: keep only cells on chains of >= 7 stream cells (kills fish-bone noise on flat ground)
  const upLen = new Int16Array(N * N), dnLen = new Int16Array(N * N);
  for (const i of sorted) upLen[i] = Math.max(upLen[i], 1);
  for (const i of sorted) { const d = down[i]; if (d >= 0 && st[d]) upLen[d] = Math.max(upLen[d], upLen[i] + 1); }
  for (let k = sorted.length - 1; k >= 0; k--) {
    const i = sorted[k], d = down[i];
    dnLen[i] = 1 + (d >= 0 && st[d] ? dnLen[d] : 0);
  }
  const wv = [0, 0];
  const centre = (i) => {
    const X = (i % N) * P + P / 2, Y = ((i / N) | 0) * P + P / 2;
    warp(X, Y, wv);
    return [X - wv[0], Y - wv[1]];
  };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const plot = (x, y, a, horizontal) => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    if (isWaterCode(cls[y * W + x])) return;
    buf[y * W + x] = C.waterInk;
    if (a > 60) { if (horizontal) { if (y + 1 < W) buf[(y + 1) * W + x] = C.waterInk; } else if (x + 1 < W) buf[y * W + x + 1] = C.waterInk; }
    if (a > 200) { if (horizontal) { if (y > 0) buf[(y - 1) * W + x] = C.waterInk; } else if (x > 0) buf[y * W + x - 1] = C.waterInk; }
  };
  const curve = (p0, c, p1, a) => {
    const len = Math.hypot(c[0] - p0[0], c[1] - p0[1]) + Math.hypot(p1[0] - c[0], p1[1] - c[1]);
    const n = Math.max(2, Math.ceil(len * 1.3));
    let px = Math.round(p0[0]), py = Math.round(p0[1]);
    for (let s = 1; s <= n; s++) {
      const t = s / n, q0 = (1 - t) * (1 - t), q1 = 2 * (1 - t) * t, q2 = t * t;
      const x = Math.round(q0 * p0[0] + q1 * c[0] + q2 * p1[0]), y = Math.round(q0 * p0[1] + q1 * c[1] + q2 * p1[1]);
      const hor = Math.abs(x - px) >= Math.abs(y - py);
      line(null, 1e9, px, py, x, y, 0, (lx, ly) => plot(lx, ly, a, hor));
      px = x; py = y;
    }
  };
  for (const i of cells) {
    if (upLen[i] + dnLen[i] - 1 < 7) continue;
    const d = down[i];
    const c = centre(i);
    const outP = d >= 0 ? (st[d] ? mid(c, centre(d)) : centre(d)) : [c[0], c[1] + P * 2];
    const a = acc[i];
    const us = ups.get(i);
    if (!us) curve(c, mid(c, outP), outP, a);
    else for (const u of us) curve(mid(centre(u), c), c, outP, a);
  }
}

// -------------------------------------------------------------- text/symbols
function symHalo(ctx, type, x, y, flip = false) {
  const art = symbolArt(type);
  const halo = artCanvas('sym-halo-' + type, art, { mono: PAL.paper });
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) ctx.drawImage(halo, x + dx, y + dy);
  ctx.drawImage(artCanvas('sym-' + type, art), x, y);
}

const TYPE_COLOR = { trig: PAL.waterInk, cairn: PAL.ink, bothy: PAL.ink, stone: PAL.ink, summit: PAL.ink, crag: PAL.ink, lochan: PAL.waterInk, waterfall: PAL.waterInk };

function placeLabel(ctx, text, anchor, symW, symH, color, occ, free, opts = {}) {
  const font = opts.font || 'small';
  const tw = measureText(text, { font, italic: opts.italic, spacing: opts.spacing });
  const th = font === 'small' ? 5 : 7;
  const gap = 2;
  const cx = anchor.x, cy = anchor.y;
  const cands = [
    { x: cx + symW / 2 + gap, y: cy - th / 2 },
    { x: cx - symW / 2 - gap - tw, y: cy - th / 2 },
    { x: cx - tw / 2, y: cy + symH / 2 + gap },
    { x: cx - tw / 2, y: cy - symH / 2 - gap - th },
    { x: cx + symW / 2 + gap, y: cy + symH / 2 },
    { x: cx - symW / 2 - gap - tw, y: cy + symH / 2 },
  ];
  for (const c of cands) {
    const r = { x: Math.round(c.x) - 1, y: Math.round(c.y) - 1, w: tw + 2, h: th + 2 };
    if (free(r)) {
      occ.push(r);
      drawText(ctx, text, Math.round(c.x), Math.round(c.y), color, { font, halo: PAL.paper, italic: opts.italic, spacing: opts.spacing });
      return r;
    }
  }
  const c = cands[0];
  drawText(ctx, text, Math.round(c.x), Math.round(c.y), color, { font, halo: PAL.paper, italic: opts.italic });
  return null;
}

/** Where the gate arch sits on the sheet: {x,y,w,h} in sheet px (inside the border). */
export function gatePlacement(world) {
  const g = world.gate;
  if (!g) return null;
  const P = CELL_PX, W = world.size * P;
  const art = symbolArt('gate');
  const sw = art[0].length, sh = art.length;
  const x = Math.round(g.x * P + P / 2), y = Math.round(g.y * P + P / 2);
  let gx = x - (sw >> 1), gy = y - sh;
  if (g.side === 'N') gy = 4;
  else if (g.side === 'S') gy = W - 4 - sh;
  else if (g.side === 'W') { gx = 4; gy = y - (sh >> 1); }
  else if (g.side === 'E') { gx = W - 4 - sw; gy = y - (sh >> 1); }
  gx = Math.max(4, Math.min(W - 4 - sw, gx)); gy = Math.max(4, Math.min(W - 4 - sh, gy));
  return { x: gx, y: gy, w: sw, h: sh };
}

function drawGate(ctx, world, W, occ, free) {
  const g = world.gate;
  if (!g) return;
  const { x: gx, y: gy, w: sw, h: sh } = gatePlacement(world);
  symHalo(ctx, 'gate', gx, gy);
  occ.push({ x: gx - 2, y: gy - 2, w: sw + 4, h: sh + 4 });
  const name = g.name || 'Bealach';
  const tw = measureText(name, { font: 'small', italic: true });
  let lx, ly;
  if (g.side === 'S') { lx = gx + sw / 2 - tw / 2; ly = gy - 9; }
  else if (g.side === 'N') { lx = gx + sw / 2 - tw / 2; ly = gy + sh + 4; }
  else if (g.side === 'W') { lx = gx + sw + 4; ly = gy + sh / 2 - 3; }
  else { lx = gx - tw - 4; ly = gy + sh / 2 - 3; }
  lx = Math.max(6, Math.min(W - 6 - tw, lx));
  occ.push({ x: lx - 1, y: ly - 1, w: tw + 2, h: 7 });
  drawText(ctx, name, Math.round(lx), Math.round(ly), PAL.magenta, { font: 'small', italic: true, halo: PAL.paper });
}

function drawPois(ctx, world, W, occ, free, cls) {
  const P = CELL_PX;
  const pois = world.pois || [];
  // waterfalls from features first (skip ones near a waterfall POI)
  for (const wf of (world.features && world.features.waterfalls) || []) {
    if (pois.some((p) => p.type === 'waterfall' && Math.hypot(p.x - wf.x, p.y - wf.y) < 4)) continue;
    const art = symbolArt('waterfall');
    const x = Math.round(wf.x * P + P / 2 - art[0].length / 2), y = Math.round(wf.y * P + P / 2 - art.length / 2);
    symHalo(ctx, 'waterfall', x, y);
    occ.push({ x: x - 1, y: y - 1, w: art[0].length + 2, h: art.length + 2 });
  }
  for (const p of pois) {
    const art = symbolArt(p.type);
    const sw = art[0].length, sh = art.length;
    const cx = Math.round(p.x * P + P / 2), cy = Math.round(p.y * P + P / 2);
    const x = cx - (sw >> 1), y = cy - (sh >> 1);
    symHalo(ctx, p.type, x, y);
    occ.push({ x: x - 1, y: y - 1, w: sw + 2, h: sh + 2 });
  }
  for (const p of pois) {
    const art = symbolArt(p.type);
    const cx = p.x * P + P / 2, cy = p.y * P + P / 2;
    const col = TYPE_COLOR[p.type] || PAL.ink;
    placeLabel(ctx, p.name || p.id, { x: cx, y: cy }, art[0].length, art.length, col, occ, free, { font: 'small', italic: p.type === 'lochan' || p.type === 'waterfall' });
    if ((p.type === 'trig' || p.type === 'summit') && p.elevation != null) {
      placeLabel(ctx, String(Math.round(p.elevation)), { x: cx, y: cy + 7 }, art[0].length, 3, col, occ, free, { font: 'small' });
    }
  }
}

function drawFeatureLabels(ctx, world, W, occ, free, cls) {
  const P = CELL_PX;
  const labels = (world.features && world.features.labels) || [];
  for (const l of labels) {
    const cx = Math.round(l.x * P + P / 2), cy = Math.round(l.y * P + P / 2);
    let font = 'main', color = PAL.ink, italic = false, spacing = 0, text = l.text;
    if (l.kind === 'water') { color = PAL.waterInk; italic = true; spacing = 1; }
    else if (l.kind === 'glen') { spacing = 3; text = String(l.text).toUpperCase(); color = PAL.contourIdx; }
    else if (l.kind === 'feature') { font = 'small'; color = PAL.ink; spacing = 1; text = String(l.text).toUpperCase(); }
    const tw = measureText(text, { font, italic, spacing });
    const th = font === 'small' ? 5 : 7;
    let x = cx - Math.round(tw / 2), y = cy - (th >> 1);
    let r = { x: x - 1, y: y - 1, w: tw + 2, h: th + 2 };
    for (let k = 0; k < 4 && !free(r); k++) {
      y += k % 2 === 0 ? th + 5 : -(th + 5) * (k + 1);
      r = { x: x - 1, y: y - 1, w: tw + 2, h: th + 2 };
    }
    x = Math.max(6, Math.min(W - 6 - tw, x)); y = Math.max(6, Math.min(W - 6 - th, y));
    occ.push({ x: x - 1, y: y - 1, w: tw + 2, h: th + 2 });
    drawText(ctx, text, x, y, color, { font, italic, spacing, halo: PAL.paper });
  }
}

function drawSpotHeights(ctx, world, W, occ, free) {
  const P = CELL_PX;
  const spots = (world.features && world.features.spotHeights) || [];
  for (const s of spots) {
    const cx = Math.round(s.x * P + P / 2), cy = Math.round(s.y * P + P / 2);
    const txt = String(Math.round(s.h));
    const tw = measureText(txt, { font: 'small' });
    const r = { x: cx - 2, y: cy - 4, w: tw + 6, h: 8 };
    if (!free(r)) continue;
    occ.push(r);
    ctx.fillStyle = PAL.paper; ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.fillStyle = PAL.ink; ctx.fillRect(cx - 1, cy - 1, 2, 2);
    drawText(ctx, txt, cx + 3, cy - 3, PAL.ink, { font: 'small', halo: PAL.paper });
  }
}

function drawContourLabels(ctx, world, W, lvl, lvlKind, cls, occ, free, interval, seed) {
  const BLOCK = 120;
  const placed = [];
  for (let by = 12; by < W - 12; by += BLOCK) {
    for (let bx = 12; bx < W - 12; bx += BLOCK) {
      if ((hash2(bx, by, seed + 77) & 7) < 3) continue;
      let best = null, bestScore = -1;
      for (let Y = by; Y < Math.min(W - 14, by + BLOCK); Y += 2) {
        for (let X = bx; X < Math.min(W - 40, bx + BLOCK); X++) {
          const i = Y * W + X;
          if (lvlKind[i] !== 2) continue;
          const lv = lvl[i];
          // near-horizontal run of 12px?
          let run = 0;
          for (let d = 0; d < 14; d++) {
            const j = i + d;
            if (lvl[j] === lv || lvl[j - W] === lv || lvl[j + W] === lv) run++;
          }
          if (run < 14) continue;
          const score = hash2(X, Y, seed + 5) & 0xffff;
          if (score > bestScore) {
            const txt = String((lv - LVL_OFF) * interval);
            const tw = measureText(txt, { font: 'small' });
            const r = { x: X + 7 - (tw >> 1) - 2, y: Y - 4, w: tw + 4, h: 9 };
            if (!free(r)) continue;
            if (placed.some((p) => p.lv === lv && Math.hypot(p.x - X, p.y - Y) < 150)) continue;
            if (cls[Y * W + X + 7] === COVER.CRAG) continue;
            best = { X, Y, lv, txt, tw, r }; bestScore = score;
          }
        }
      }
      if (!best) continue;
      const { X, Y, txt, tw, r, lv } = best;
      placed.push({ lv, x: X, y: Y });
      occ.push(r);
      const cc = cls[Y * W + X + 7];
      ctx.fillStyle = cc === COVER.SNOW ? PAL.snow : cc === COVER.WOOD ? PAL.wood : PAL.paper;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      drawText(ctx, txt, r.x + 2, r.y + 2, cc === COVER.SNOW ? PAL.waterInk : PAL.contourIdx, { font: 'small' });
    }
  }
}

function drawGridLabels(ctx, world, W, level) {
  const [e0, n0] = level.gridOrigin || [0, 0];
  const P = CELL_PX, step = GRID_CELLS * P;
  const two = (v) => String(((v % 100) + 100) % 100).padStart(2, '0');
  // OS style: corner letters
  const letters = level.gridLetters || '';
  ctx.fillStyle = PAL.paper; ctx.fillRect(2, 2, 16, 11);
  drawText(ctx, letters, 4, 4, PAL.ink, {});
  for (let g = 1; g * step < W; g++) {
    const p = g * step;
    const e = two(e0 + g), n = two(n0 - g);
    // top & bottom edges
    drawText(ctx, e, p + 2, 3, PAL.grid, { font: 'small', halo: PAL.paper });
    drawText(ctx, e, p + 2, W - 9, PAL.grid, { font: 'small', halo: PAL.paper });
    // left & right edges
    drawText(ctx, n, 4, p - 3, PAL.grid, { font: 'small', halo: PAL.paper });
    drawText(ctx, n, W - 4, p - 3, PAL.grid, { font: 'small', halo: PAL.paper, align: 'right' });
  }
}

// ------------------------------------------------------------------ overview
/**
 * Compact whole-sheet raster (minimap / map screen). n px square, crisp 1px index contours.
 * opts: {contourEvery: metres between drawn contours (default interval*5), grid: bool}
 */
export function bakeOverview(world, n, opts = {}) {
  const N = world.size;
  const s = (N) / n;
  const interval = opts.contourEvery || (world.contourInterval || 10) * 5;
  const cl = (v) => (v < 0 ? 0 : v > N - 1 ? N - 1 : v);
  const buf = new Uint32Array(n * n);
  const hs = new Float32Array(n * n);
  const cs = new Uint8Array(n * n);
  const sg = new Uint8Array(n * n);
  for (let Y = 0; Y < n; Y++) {
    for (let X = 0; X < n; X++) {
      const fx = cl((X + 0.5) * s - 0.5), fy = cl((Y + 0.5) * s - 0.5);
      const x0 = Math.min(N - 2, fx | 0), y0 = Math.min(N - 2, fy | 0), ax = fx - x0, ay = fy - y0;
      const hh = world.height;
      hs[Y * n + X] = (hh[y0 * N + x0] * (1 - ax) + hh[y0 * N + x0 + 1] * ax) * (1 - ay) + (hh[(y0 + 1) * N + x0] * (1 - ax) + hh[(y0 + 1) * N + x0 + 1] * ax) * ay;
      cs[Y * n + X] = world.cover[Math.round(fy) * N + Math.round(fx)];
      sg[Y * n + X] = world.stream[Math.round(fy) * N + Math.round(fx)];
    }
  }
  const span = Math.max(1, world.maxH - world.minH);
  for (let Y = 0; Y < n; Y++) {
    for (let X = 0; X < n; X++) {
      const i = Y * n + X, c = cs[i];
      const en = (hs[i] - world.minH) / span;
      const th = ([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][((Y & 3) << 2) | (X & 3)] + 0.5) / 16;
      let col = th < 0.1 + en * 0.45 ? U.paper2 : U.paper;
      if (c === COVER.SHALLOW || c === COVER.DEEP) col = U.water;
      else if (c === COVER.WOOD) col = U.wood;
      else if (c === COVER.SNOW) col = U.snow;
      else if (c === COVER.BOG) col = th < 0.4 ? U.bog : col;
      else if (c === COVER.CRAG) col = th < 0.6 ? U.ink : U.rock;
      else if (c === COVER.SCREE || c === COVER.ROCK) col = th < 0.5 ? U.rock : col;
      buf[i] = col;
    }
  }
  const bd = new Int16Array(n * n);
  for (let i = 0; i < bd.length; i++) bd[i] = Math.floor(hs[i] / interval);
  for (let Y = 0; Y < n; Y++) {
    for (let X = 0; X < n; X++) {
      const i = Y * n + X, b = bd[i];
      if ((X < n - 1 && bd[i + 1] > b) || (Y < n - 1 && bd[i + n] > b)) {
        const c = cs[i];
        // skip where lines would fuse (spacing under ~3 px)
        const gx = X < n - 1 ? hs[i + 1] - hs[i] : 0, gy = Y < n - 1 ? hs[i + n] - hs[i] : 0;
        if (Math.max(Math.abs(gx), Math.abs(gy)) > interval / 2.2) { continue; }
        if (c !== COVER.SHALLOW && c !== COVER.DEEP && c !== COVER.CRAG) buf[i] = U.contourIdx;
      }
    }
  }
  for (let i = 0; i < buf.length; i++) if (sg[i] && cs[i] !== COVER.SHALLOW && cs[i] !== COVER.DEEP) buf[i] = U.waterInk;
  if (opts.grid) {
    const stepPx = (GRID_CELLS / s);
    for (let g = 1; g * stepPx < n - 1; g++) {
      const p = Math.round(g * stepPx);
      for (let t = 0; t < n; t++) {
        if (t % 2 === 0) { buf[t * n + p] = U.grid; buf[p * n + t] = U.grid; }
      }
    }
  }
  const canvas = makeCanvas(n, n);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), n, n), 0, 0);
  canvas.N = n;
  return canvas;
}
