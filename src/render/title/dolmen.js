/**
 * DOLMEN: a trilithon against a low sun (after the photograph of a capstone on its uprights with the sun in the gap beneath it).
 * Greys + the one ember accent, which belongs to the sun: a snow core, a dithered ember bloom, a starburst of fine survey-like rays,
 * and a thin ember edge on every face that looks at it. The stones are lit only from behind (rim light on the sunward edges and the
 * ledges of the bedding), their faces in char / slate with strata, cracks and lichen; the ground is very dark, with shadow fans thrown
 * towards us from the stone feet, tussock strokes, scattered boulders and a faint contour sheet.
 *
 * Layers: 0 sky, 1 ground / far hills, 2 (free: mist), 3 stones, 4 tussock + ground rocks, 5 foot plate, 6 logo.
 */
import {
  paintGreyGradient, paintLichen, paintStrata, paintFootPlate, paintTitleLogo, makeMistBands, animMistBands, animLogo,
  fbm, vnoise, clamp, smooth, mix, bay, hash2f, mulberry32, liftG, sinkG, GREY, C, stampSmall,
} from './kit.js';

const W = 384, H = 216;
const SX = 142, SY = 163;                                        // the sun, in the gap under the capstone
const GY = 168;                                                  // the horizon (where the ground starts)

export const layout = { prompt: { x: 192, y: 180 }, subtitle: { x: 192, y: 66, align: 'center' } };
export const levels = [];

const rampG = (v, x, y) => {
  const pos = clamp(v, 0, 1) * 6, k = Math.min(5, Math.floor(pos));
  return bay(x, y) < pos - k ? GREY[k + 1] : GREY[k];
};

// ---------------------------------------------------------------------------------------------- the stones
const CAP = [[27, 113], [34, 109], [44, 107], [80, 99], [130, 93], [190, 87], [228, 82], [252, 79], [264, 83], [270, 95], [267, 107], [258, 113], [230, 117], [150, 119], [70, 119], [38, 119], [28, 117]];
const UP_L = [[68, 112], [96, 111], [98, 132], [100, 150], [103, 170], [96, 176], [72, 177], [63, 172], [64, 150], [66, 130]];
const UP_R = [[212, 108], [250, 107], [252, 128], [256, 150], [259, 172], [249, 178], [214, 178], [208, 160], [210, 140], [211, 124]];
const UP_M = [[193, 131], [206, 125], [219, 130], [221, 150], [223, 172], [219, 180], [191, 181], [184, 172], [187, 150]];
const STONES = [
  { poly: UP_R, foot: 177, seed: 3, tilt: 0.02 }, { poly: UP_M, foot: 180, seed: 4, tilt: -0.03 }, { poly: UP_L, foot: 175, seed: 5, tilt: 0.04 },
  { poly: CAP, foot: null, seed: 6, tilt: -0.12 },
];

function inPoly(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** distance (px) of each masked cell to the nearest unmasked cell, chamfer 3-4 */
function distIn(mask, w, h) {
  const D = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = mask[i] ? 999 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!D[i]) continue;
    let d = D[i];
    if (x > 0) d = Math.min(d, D[i - 1] + 1);
    if (y > 0) { d = Math.min(d, D[i - w] + 1); if (x > 0) d = Math.min(d, D[i - w - 1] + 1.414); if (x < w - 1) d = Math.min(d, D[i - w + 1] + 1.414); }
    D[i] = d;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!D[i]) continue;
    let d = D[i];
    if (x < w - 1) d = Math.min(d, D[i + 1] + 1);
    if (y < h - 1) { d = Math.min(d, D[i + w] + 1); if (x < w - 1) d = Math.min(d, D[i + w + 1] + 1.414); if (x > 0) d = Math.min(d, D[i + w - 1] + 1.414); }
    D[i] = d;
  }
  return D;
}
function blur3(a, w, h) {
  const o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s += a[Y * w + X]; n++; }
    o[y * w + x] = s / n;
  }
  return o;
}

/**
 * A back-lit stone: a rounded slab (bevelled height map + bedding ledges + grain + cracks), lit by the sun BEHIND it (rim light on the sunward
 * edges and ledges, a little sky light on the upward ones), dark face, then strata joints, lichen and a thin ember edge.
 */
function paintStone(r, S, st, sd) {
  const { poly, seed } = st, rng = mulberry32(sd * 11 + seed);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 = Math.floor(x0) - 8; y0 = Math.floor(y0) - 8; x1 = Math.ceil(x1) + 8; y1 = Math.ceil(y1) + 8;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = x0 + i, Y = y0 + j;
    const wx = X + (fbm(X * 0.05, Y * 0.05, sd + seed * 7, 3) - 0.5) * 4.5 + (vnoise(X * 0.3, Y * 0.3, sd + seed) - 0.5) * 1.3;
    const wy = Y + (fbm(X * 0.05 + 9, Y * 0.05, sd + seed * 7 + 1, 3) - 0.5) * 4.5 + (vnoise(X * 0.3 + 4, Y * 0.3, sd + seed + 2) - 0.5) * 1.3;
    if (inPoly(poly, wx, wy)) mask[j * w + i] = 1;
  }
  const dep = distIn(mask, w, h), D = 7;
  const hh = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = x0 + i, Y = y0 + j, d = Math.min(dep[j * w + i], D);
    let v = D * (1 - Math.pow(1 - d / D, 2)) * 0.9;
    v += 6.5 * fbm(X * 0.035, Y * 0.04, sd + seed + 50, 3) + 0.8 * fbm(X * 0.2, Y * 0.2, sd + seed + 51, 2);
    hh[j * w + i] = v;
  }
  // a few pits, and cracks that run mostly down the face
  for (let p = 0; p < Math.round(w * h / 1400); p++) {
    const px = rng() * w, py = rng() * h, rad = 1.3 + rng() * 2.2;
    if (!mask[Math.floor(py) * w + Math.floor(px)] || dep[Math.floor(py) * w + Math.floor(px)] < 5) continue;
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const q = (i * i + j * j) / (rad * rad); const X = Math.round(px) + i, Y = Math.round(py) + j; if (q < 1 && X >= 0 && Y >= 0 && X < w && Y < h) hh[Y * w + X] -= 2 * Math.pow(1 - q, 1.4); }
  }
  const crack = new Float32Array(w * h);
  for (let q = 0; q < 2 + Math.round(w / 50); q++) {
    let x = rng() * w, y = rng() * h * 0.5, ang = Math.PI / 2 + (rng() - 0.5) * 0.9;
    const len = 16 + rng() * 44;
    for (let s = 0; s < len; s++) {
      ang = clamp(ang + (rng() - 0.5) * 0.5, 0.35, Math.PI - 0.35); x += Math.cos(ang) * 0.9; y += Math.sin(ang) * 0.9;
      const X = Math.round(x), Y = Math.round(y);
      if (X < 0 || Y < 0 || X >= w || Y >= h || !mask[Y * w + X] || dep[Y * w + X] < 2.5) { if (s > 3) break; continue; }
      crack[Y * w + X] = 1;
      hh[Y * w + X] -= 3;
    }
  }
  for (let q = 0; q < 5 + Math.round(w * h / 500); q++) {                                               // bedding joints: short, broken, a little off level
    let x = rng() * w, y = rng() * h, ang = st.tilt * 2 + (rng() - 0.5) * 0.28;
    const len = 12 + rng() * 46, dir = rng() < 0.5 ? 1 : -1;
    for (let s = 0; s < len; s++) {
      ang += (rng() - 0.5) * 0.14; x += Math.cos(ang) * dir; y += Math.sin(ang) * dir;
      const X = Math.round(x), Y = Math.round(y);
      if (X < 0 || Y < 0 || X >= w || Y >= h || !mask[Y * w + X] || dep[Y * w + X] < 2.5) { if (s > 3) break; continue; }
      hh[Y * w + X] -= 3.2; crack[Y * w + X] = Math.max(crack[Y * w + X], 0.7);
    }
  }
  const hs = blur3(hh, w, h);
  const colTop = new Int16Array(w).fill(h), colBot = new Int16Array(w).fill(-1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) { if (j < colTop[i]) colTop[i] = j; colBot[i] = j; }
  const at = (a, i, j) => a[clamp(j, 0, h - 1) * w + clamp(i, 0, w - 1)];
  const rim = [];                                                                                      // sunward edge pixels, for the ember line
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!mask[j * w + i]) continue;
    const X = x0 + i, Y = y0 + j;
    const gx = (at(hs, i + 1, j) - at(hs, i - 1, j)) * 0.5, gy = (at(hs, i, j + 1) - at(hs, i, j - 1)) * 0.5;
    const nl = Math.hypot(gx, gy, 1), nx = -gx / nl, ny = -gy / nl, nz = 1 / nl;
    const lx = SX - X, ly = SY - Y, lz = -14, ll = Math.hypot(lx, ly, lz);
    const sun = clamp((nx * lx + ny * ly + nz * lz) / ll, 0, 1);                                  // the sun is behind: only rims and ledges catch it
    const sky = clamp(-ny * 0.9 + nz * 0.1, 0, 1);
    const dist = Math.hypot(X - SX, (Y - SY) * 0.8);
    const wrap = clamp((nx * lx + ny * ly) / Math.hypot(lx, ly), 0, 1);
    let v = 0.07 + 0.2 * Math.exp(-dist / 70) * (0.55 + 0.9 * wrap) + 0.09 * sky * sky + 1.9 * Math.pow(sun, 0.8) * (0.14 + 1.0 * Math.exp(-dist / 60));
    v += (hash2f(X, Y, sd + seed + 90) - 0.5) * 0.05 + 0.3 * smooth(0.45, 0.95, sky) * smooth(5, 0.5, dep[j * w + i]);
    v -= crack[j * w + i] * 0.1;
    const tt = (j - colTop[i]) / Math.max(8, colBot[i] - colTop[i] + 1);
    v += 0.16 * Math.pow(1 - clamp(tt, 0, 1), 1.6) * (st.foot == null ? 1.1 : 0.8) - 0.06 * smooth(0.7, 1, tt);   // the sky lights the upper faces; the foot lies in the dark
    const d = dep[j * w + i];
    if (d <= 1.45 && sun > 0.4 && dist < 150) rim.push([X, Y, sun]);
    r.px(X, Y, rampG(v, X, Y), 3);
  }
  const region = { x: x0, y: y0, w, h, data: mask };
  paintLichen(r, region, sd + seed * 5, { density: 0.4, size: [1.2, 3.4], tone: 0.3, ramps: [[C.char, C.slate, C.ash, C.rock], [C.slate, C.ash, C.rock, C.fog], [C.char, C.slate, C.slate, C.ash]], rim: C.slate, light: [SX > (x0 + x1) / 2 ? 1 : -1, 1], layer: 3 });
  // the thin ember edge on the sunward rim
  for (const [X, Y, sun] of rim) {
    const c = bay(X + 1, Y) < 0.35 + 0.5 * sun ? C.ember : bay(X, Y + 2) < 0.6 ? C.snow : C.fog;
    r.px(X, Y, c, 3);
    if (c === C.ember && (X * 7 + Y * 3) % 5 === 0) S.embers.push([X, Y, X * 0.7 + Y * 0.3, C.fog]);
  }
  return { x0, y0, w, h, mask };
}

// ---------------------------------------------------------------------------------------------- sky, sun, rays
function ridge(x, sd) { return GY - 2 - 5 * fbm(x * 0.02 + 3, 1.3, sd + 2, 3) + 14 * smooth(300, 384, x) - 4 * smooth(60, 0, x); }

function paintSky(r, sd) {
  paintGreyGradient(r, { x: 0, y: 0, w: W, h: GY + 4 }, 0.08, 0.92, { bias: 1.3, flat: 0.6, streak: 0.55, seed: sd + 1, layer: 0 });
  // a faint survey grid in the high sky
  for (let y = 0; y < 100; y++) for (let x = 0; x < W; x++) {
    const gx = (x - 6) % 32 === 0, gy = (y - 12) % 32 === 0;
    if (!(gx || gy) || bay(x * 3 + 1, y * 5 + 2) > (gx && gy ? 0.8 : 0.22) * (1 - y / 120)) continue;
    r.px(x, y, liftG(r.get(x, y)), 0);
  }
}

function paintGround(r, sd) {
  // far low hills + the moor going dark; a contour sheet in perspective, lines light on dark
  for (let y = 120; y < H; y++) for (let x = 0; x < W; x++) {
    const rg = ridge(x, sd);
    if (y < rg) continue;
    const t = clamp((y - GY) / (H - GY), 0, 1);
    let v;
    let c;
    if (y < GY + 1) { v = 0.11 + 0.06 * fbm(x * 0.05, y * 0.2, sd + 4, 2); c = rampG(v, x, y); }
    else {
      const warp = (fbm(x * 0.012 + 6, y * 0.05, sd + 12, 3) - 0.5) * 2 * (2 + 14 * t);
      const sg = Math.max(0, y - GY + warp), q = Math.log(1 + sg / 14) / Math.log(1 + 48 / 14) * 9, k = Math.floor(q), f = q - k;
      v = 0.13 - 0.012 * k + (fbm(x * 0.04, sg * 0.1, sd + 17, 3) - 0.5) * 0.06;
      if (bay(x, y) < smooth(0.85, 1, f)) v -= 0.012;
      c = rampG(v, x, y);
      if (f < 0.14 + 0.08 * t && bay(x + 2, y + 1) < 0.62 - 0.1 * k) c = liftG(c);
    }
    r.px(x, y, c, 1);
  }
}

/** the light of the sun on everything behind the stones: grey lift and ember in rays */
function bloom(r, sd, pulse = 0) {
  const R = 150;
  for (let y = Math.max(0, SY - R); y < Math.min(H, SY + R); y++) for (let x = Math.max(0, SX - R); x < Math.min(W, SX + R); x++) {
    if (r.lay[y * W + x] > 2) continue;
    const dx = x - SX, dy = (y - SY) * (y < SY ? 1.55 : 1.12), d = Math.hypot(dx, dy);
    if (d > R || (y > SY + 5 && y < GY + 1 && false)) continue;
    const ang = Math.atan2(dy, dx);
    const ray = 0.55 + 0.9 * Math.pow(vnoise(ang * 4.2 + 20, 1.7, sd + 8), 1.4) * (0.7 + 0.3 * vnoise(ang * 11, 3.1, sd + 9));
    const lowPass = y > GY ? 0.8 : 1;                                                              // the ground catches less of it
    const k1 = Math.pow(1 - d / R, 2.3) * ray * lowPass * 1.25;
    let c = r.get(x, y);
    if (bay(x, y) < k1) c = liftG(c);
    if (k1 > 0.4 && bay(x + 5, y + 3) < k1 - 0.35) c = liftG(c);
    if (k1 > 0.75 && bay(x + 1, y + 6) < k1 - 0.7) c = liftG(c);
    const k2 = Math.pow(1 - d / 66, 1.5) * ray * smooth(6, 20, d) * (0.95 + pulse * 0.1) * lowPass;
    if (d < 66 && bay(x + 3, y + 5) < k2 * (y > GY + 2 ? 0.8 * smooth(40, 12, d) : 0.85)) c = C.ember;
    const k0 = Math.pow(1 - d / 22, 1.3) * (1 + pulse * 0.1);
    if (d < 22 && bay(x + 2, y + 7) < k0) c = bay(x, y + 3) < 0.35 + 0.65 * smooth(14, 4, d) ? C.snow : C.fog;
    if (d < 6.5) c = C.snow;
    r.px(x, y, c);
  }
}

function paintRays(r, sd) {
  const rng = mulberry32(sd * 17 + 9);
  const rays = [], N = 36;
  for (let i = 0; i < N; i++) {
    let a = (i + rng() * 0.8) / N * Math.PI * 2;
    for (let q = 0; q < 4; q++) { const m = a % (Math.PI / 2), off = Math.min(m, Math.PI / 2 - m); if (off < 0.26) a += 0.26 - off + 0.02; }   // keep clear of the axes: no cross
    const up = Math.sin(a) < -0.2;
    rays.push({ a, len: (up ? 40 + Math.pow(rng(), 1.4) * 90 : 36 + Math.pow(rng(), 1.5) * 230), dash: rng() < 0.3, ph: Math.floor(rng() * 9) });
  }
  for (const R of rays) {
    const ca = Math.cos(R.a), sa = Math.sin(R.a);
    let lx = -1, ly = -1;
    for (let s = 8; s < R.len; s += 0.4) {
      const u = s / R.len, X = Math.round(SX + ca * s), Y = Math.round(SY + sa * s * 0.97);
      if (X === lx && Y === ly) continue;
      lx = X; ly = Y;
      if (X < 0 || Y < 0 || X >= W || Y >= H || r.lay[Y * W + X] > 2 || Y > 172 + (X * 7 % 5)) continue;
      if (u > 0.5 && bay(X + R.ph, Y) > (1 - u) * 1.7) continue;                                    // the tail frays away
      if (R.dash && (Math.floor(s / 3) + R.ph) % 3 === 0) continue;
      const base = GREY.indexOf(r.get(X, Y));
      const nEm = (r.get(X - 1, Y) === C.ember) + (r.get(X + 1, Y) === C.ember) + (r.get(X, Y - 1) === C.ember) + (r.get(X, Y + 1) === C.ember) + (r.get(X, Y) === C.ember);
      const c = u < 0.2 ? C.snow : nEm >= 3 ? (u < 0.5 ? C.snow : C.fog) : u < 0.7 ? C.ember : (base >= 4 ? C.ash : C.fog);
      r.px(X, Y, c);
    }
  }
}

/** a wind-bent thorn tree, black against the glow */
function paintTree(r, sd) {
  const rng = mulberry32(sd * 29 + 3);
  const twig = (x, y, ang, len, th, depth) => {
    const steps = Math.round(len);
    for (let s = 0; s < steps; s++) {
      ang += (rng() - 0.5) * 0.28 + 0.012;                                                             // the wind bends it to the right
      x += Math.cos(ang); y += Math.sin(ang);
      const X = Math.round(x), Y = Math.round(y);
      for (let k = 0; k < th; k++) r.px(X + k - (th >> 1), Y, C.ink, 2);
      if (depth > 0 && s > 3 && rng() < 0.07 + 0.03 * depth) twig(x, y, ang + (rng() < 0.5 ? -1 : 1) * (0.45 + rng() * 0.6), len * (0.5 + rng() * 0.25), Math.max(1, th - 1), depth - 1);
    }
    if (depth === 0 || len < 5) return;
    twig(x, y, ang - 0.55 - rng() * 0.3, len * 0.72, Math.max(1, th - 1), depth - 1);
    twig(x, y, ang + 0.5 + rng() * 0.3, len * 0.7, Math.max(1, th - 1), depth - 1);
  };
  twig(111, 170, -1.4, 15, 2, 3);
  twig(116, 170, -1.7, 9, 1, 2);
}

// ---------------------------------------------------------------------------------------------- the ground in front
const FEET = [[62, 99, 175], [210, 257, 177], [188, 222, 180]];
function inShadow(x, y) {
  let a = 0;
  for (const [xa, xb, fy] of FEET) {
    if (y <= fy) continue;
    const xp = SX + (x - SX) * (fy - SY) / (y - SY), s = (xp - xa) / (xb - xa), pw = 0.04 + (y - fy) * 0.002;
    a = Math.max(a, smooth(0, pw, s) * smooth(0, pw, 1 - s) * smooth(30, 8, 0) * (1 - smooth(20, 60, y - fy) * 0.35));
  }
  return a;
}

/** how much of the sun's light reaches the ground at (x, y): a corridor widening towards us, fading with distance, cut by the shadow fans */
function poolAt(x, y) {
  const dy = y - GY, dx = x - SX;
  const k = 1.2 * Math.exp(-Math.max(0, dy) / 34) * Math.exp(-Math.pow(dx / (34 + Math.max(0, dy) * 1.5), 2));
  return k * (1 - inShadow(x, y) * 0.95);
}

function paintLightOnGround(r, sd) {
  for (let y = GY; y < H; y++) for (let x = 0; x < W; x++) {
    const sh = inShadow(x, y), pool = poolAt(x, y);
    let c = r.get(x, y);
    const amb = 0.5 * Math.exp(-(y - GY) / 22) * (1 - sh);                                           // the glowing horizon lights the grazing ground
    if (bay(x, y) < amb * 0.55) c = liftG(c);
    if (bay(x, y) < pool) c = liftG(c);
    if (pool > 0.35 && bay(x + 4, y + 1) < pool - 0.3) c = liftG(c);
    if (pool > 0.75 && bay(x + 1, y + 6) < pool - 0.7) c = liftG(c);
    if (sh > 0.25 && bay(x + 2, y + 3) < sh * 0.9) c = sinkG(c);
    r.px(x, y, c, 1);
  }
}

function tussocks(r, sd) {
  const rng = mulberry32(sd * 7 + 5);
  const list = [];
  for (let i = 0; i < 170; i++) { const t = Math.pow(rng(), 0.8); list.push({ t, y: GY + 2 + t * (H - GY - 12), x: rng() * W, hr: rng(), n: rng() }); }
  list.sort((a, b) => a.y - b.y);
  for (const q of list) {
    const { t, y, x } = q, hgt = 2.5 + t * 10 * (0.5 + q.hr), n = 3 + Math.round(t * 5 * (0.5 + q.n));
    const pool = poolAt(x, y);
    for (let b = 0; b < n; b++) {
      const lean = (b / (n - 1) - 0.5) * 1.5 + (rng() - 0.5) * 0.4, bl = hgt * (0.55 + 0.45 * rng());
      for (let s = 0; s <= bl; s += 0.7) {
        const X = Math.round(x + lean * s * 0.7), Y = Math.round(y - s), k = s / bl;
        let c = C.ink;
        if (pool > 0.2) { if (k > 0.85 && bay(X, Y) < pool * 0.5) c = C.slate; }                         // black blades against the lit ground, a pale edge on the tips
        else if (k > 0.6) c = bay(X + 1, Y) < 0.5 + 6 * Math.exp(-Math.hypot(X - SX, (Y - SY) * 1.5) / 60) ? C.slate : C.char; else c = C.char;
        if (k > 0.8 && pool > 0.45 && (X + Y) % 7 === 0) c = C.ember;
        r.px(X, Y, c, 4);
      }
    }
  }
  // a few boulders on the ground, rim-lit on the side that faces the sun
  const rocks = [[318, 178, 14, 7], [352, 190, 20, 9], [30, 186, 17, 8], [112, 194, 9, 4], [276, 200, 11, 5], [160, 206, 7, 3]];
  for (const [cx, cy, rx, ry] of rocks) {
    for (let y = -ry - 2; y <= 1; y++) for (let x = -rx - 2; x <= rx + 2; x++) {
      const u = x / rx, v = y / ry, wob = (vnoise((cx + x) * 0.3, (cy + y) * 0.3, sd + 3) - 0.5) * 0.35;
      const d = Math.hypot(u, v) + wob;
      if (d > 1 || y > 0) continue;
      const nx = u / Math.max(0.2, d), ny = v / Math.max(0.2, d);
      const lx = SX - (cx + x), ly = SY - (cy + y), ll = Math.hypot(lx, ly) || 1;
      const sun = clamp((nx * lx / ll + ny * ly / ll) * 1.2 - 0.1, 0, 1) * smooth(0.55, 1, d);
      const X = cx + x, Y = cy + y;
      const v2 = 0.07 + 0.08 * (1 - d) + 0.9 * sun * Math.exp(-Math.hypot(lx, ly) / 200) + (hash2f(X, Y, sd + 11) - 0.5) * 0.05;
      let c = rampG(v2, X, Y);
      if (d > 0.84 && sun > 0.4 && bay(X, Y) < 0.5) c = C.ember;
      r.px(X, Y, c, 4);
    }
  }
}

// ---------------------------------------------------------------------------------------------- paint / anim
export function paint(r, spec, S) {
  const sd = S.seed;
  S.embers = [];
  r.d.fill(C.ink); r.lay.fill(0);
  paintSky(r, sd);
  paintGround(r, sd);
  paintLightOnGround(r, sd);
  bloom(r, sd);
  paintRays(r, sd);
  paintTree(r, sd);
  for (const st of STONES) paintStone(r, S, st, sd);
  tussocks(r, sd);
  paintFootPlate(r, 170, { strength: 1, layer: 5 });
  paintTitleLogo(r, S);
  S.mist = makeMistBands(W, [{ y: GY - 12, rows: 18, speed: 3, dens: 0.5, layerMax: 1 }], sd + 40);
  S.sunPx = [];
  for (let y = SY - 22; y <= SY + 22; y++) for (let x = SX - 22; x <= SX + 22; x++) {
    const d = Math.hypot(x - SX, y - SY);
    if (d > 8 && d < 22 && r.lay[y * W + x] <= 2) S.sunPx.push([x, y, d]);
  }
}

export function anim(r, spec, S, t) {
  animMistBands(r, S.mist, t);
  const p = Math.sin(t * 1.1) * 0.5 + 0.5;
  for (const [x, y, d] of S.sunPx) {                                                                   // the ember halo breathes
    const k = (1 - d / 22) * (0.25 + 0.75 * p);
    if (bay(x + 1, y + 2) < k * 0.9) r.px(x, y, C.ember);
  }
  for (const [x, y, ph, dim] of S.embers) r.d[y * W + x] = (Math.sin(t * 1.3 + ph) > -0.5) ? C.ember : dim;
  animLogo(r, S.logo, t);
}
