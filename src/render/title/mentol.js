/**
 * MENTOL: after the holed stone of Men-an-Tol. A great granite ring fills the frame (rough, pitted, lichened, lit from the upper left, a deep
 * reveal on the inner rim); through its round opening lies a pale hazy moor drawn as a greyscale contour sheet and one tall tapering menhir
 * carrying a glowing incised symbol. Greys + the one ember accent (the incisions, a thin survey ring round the opening).
 *
 * Layers: 0 sky, 1 hills / moor (contour field), 2 mist (animated, 0..2 only), 3 the menhir, 4 tussock, 5 the ring, 6 the logo.
 */
import {
  paintContourField, paintGreyGradient, paintDitherGlow, paintLichen, paintStrata, paintFootPlate, paintTitleLogo, makeMistBands, animMistBands,
  animLogo, monoStone, pulseEmbers, fbm, vnoise, clamp, smooth, mix, bay, hash2f, mulberry32, liftG, sinkG, GREY, C, stampSmall,
} from './kit.js';

const W = 384, H = 216;
const OC = { x: 198, y: 158 }, R1 = 76;                       // the front opening
const C2 = { x: 190, y: 151, r: 68 };                         // the far end of the bore (shifted up-left: the lower right wall shows)
const HZ = 150;                                              // the horizon inside the opening
const LIGHT = (() => { const l = Math.hypot(-0.62, -0.5, 0.6); return [-0.62 / l, -0.5 / l, 0.6 / l]; })();

export const layout = { prompt: { x: 192, y: 180 } };
export const levels = [];

const rampG = (v, x, y) => {
  const pos = clamp(v, 0, 1) * 6, k = Math.min(5, Math.floor(pos));
  return bay(x, y) < pos - k ? GREY[k + 1] : GREY[k];
};

// ------------------------------------------------------------------------------------------------ the view through the hole
function ridgeA(x, sd) { return 126 + 16 * fbm(x * 0.016, 3.3, sd + 5, 3) - 10 * smooth(150, 300, x) + 4 * smooth(290, 120, x); }
function ridgeB(x, sd) { return 143 + 7 * fbm(x * 0.028 + 9, 5.1, sd + 6, 3); }

/** One hypsometric strip: band tone steps, dithered seams, a fine line at each band edge, a heavier index line, optional ember line. */
function strip(r, x, y, q, v0, dv, o = {}) {
  const k = Math.floor(q), f = q - k;
  let v = v0 - dv * k + (o.mottle || 0);
  const seam = smooth(0.82, 1, f);
  if (bay(x, y) < seam) v -= dv;
  let c = rampG(v, x, y);
  const line = f < o.lw && !(bay(x + 2, y + 1) > (o.dens == null ? 0.88 : o.dens));
  if (line) { c = sinkG(c); if (k % 4 === 0) c = sinkG(c); if (o.ember === k) c = C.ember; }
  r.px(x, y, c, 1);
}

function paintSceneInOpening(r, S, sd) {
  const x0 = OC.x - R1 - 2, x1 = OC.x + R1 + 2, y0 = OC.y - R1 - 2;
  // sky: fog to snow, soft streaks of cloud
  paintGreyGradient(r, { x: x0, y: y0, w: x1 - x0, h: HZ + 20 - y0 }, 0.82, 0.99, { bias: 0.8, flat: 0.5, streak: 0.5, seed: sd + 3, layer: 0 });
  paintDitherGlow(r, 150, 104, 74, null, 0, { pow: 1.2, ay: 1.2, strength: 0.7 });
  const rA = new Float32Array(W), rB = new Float32Array(W);
  for (let x = 0; x < W; x++) { rA[x] = ridgeA(x, sd); rB[x] = ridgeB(x, sd); }
  const GZ = 142;
  for (let y = y0; y < H; y++) for (let x = x0; x <= x1; x++) {
    if (y < rA[x]) continue;
    if (y < rB[x]) {                                                    // the far moorland ridge: pale, hazy
      const s = y - rA[x], mott = (fbm(x * 0.04, y * 0.12, sd + 31, 2) - 0.5) * 0.08;
      strip(r, x, y, s / 6, 0.8, 0.028, { lw: 0.2, mottle: mott, dens: 0.7 });
    } else {                                                            // the moor, in perspective: bands crowd towards the horizon
      const t = clamp((y - GZ) / (H - GZ), 0, 1);
      const warp = (fbm(x * 0.014 + 4, y * 0.05, sd + 12, 3) - 0.5) * 2 * (3 + 18 * t) + (fbm(x * 0.004, 3, sd + 14, 2) - 0.5) * 10 * t;
      const sg = Math.max(0, y - GZ + warp), q = Math.log(1 + sg / 18) / Math.log(1 + 74 / 18) * 11;
      const mott = (fbm(x * 0.035, sg * 0.1, sd + 17, 3) - 0.5) * 0.16;
      strip(r, x, y, q, 0.72, 0.034, { lw: 0.17 + 0.1 * t, mottle: mott, ember: 4 });
    }
  }
  // gorse on the far ridge
  bush(r, 252, Math.round(rB[252]) + 1, 5, sd + 1); bush(r, 262, Math.round(rB[262]) + 1, 3, sd + 2); bush(r, 238, Math.round(rB[238]) + 1, 2, sd + 3);
  // a faint survey grid across sky and moor alike
  for (let y = y0; y < H; y++) for (let x = x0; x <= x1; x++) {
    const gx = (x - 14) % 22 === 0, gy = (y - 8) % 22 === 0;
    if (!gx && !gy) continue;
    if (bay(x * 3 + 1, y * 5 + 2) > (gx && gy ? 1 : 0.4)) continue;
    r.px(x, y, sinkG(r.get(x, y)), r.layer(x, y));
  }
  // spot heights
  for (const [x, txt] of [[146, '412'], [234, '387']]) {
    const y = Math.round(rA[x]) + 3;
    r.rect(x - 1, y - 1, 2, 2, C.ink, 1);
    stampSmall(r, txt, x + 3, y - 3, C.ink, C.fog, 1);
  }
}

// tussocks: fans of curved blades, dark at the root, pale tips on the sunward side
function tussock(r, cx, by, h, seed, layer = 4) {
  const n = Math.max(6, Math.round(h * 1.3));
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    const hh = h * (0.5 + 0.5 * hash2f(i, 3, seed));
    const lean = u * 2.2 + (hash2f(i, 5, seed) - 0.5) * 0.6;
    for (let s = 0; s <= hh; s += 0.5) {
      const k = s / hh;
      const x = cx + u * 2.5 + lean * s * 0.55 + lean * Math.abs(lean) * s * s * 0.035;
      const y = by - s * (1 - 0.12 * Math.abs(lean)) + lean * lean * s * s * 0.01;
      const lit = lean < 0.15;
      let c;
      if (k < 0.25) c = C.ink; else if (k < 0.55) c = (hash2f(i, Math.round(s), seed) < 0.6) ? C.char : C.ink;
      else c = lit ? (k > 0.8 ? C.rock : C.ash) : (k > 0.8 ? C.ash : C.slate);
      r.px(Math.round(x), Math.round(y), c, layer);
    }
  }
}
function paintTussocks(r, sd) {
  const rng = mulberry32(sd * 3 + 1);
  const rows = [[152, 2.5, 16], [158, 3.5, 14], [166, 5, 13], [176, 7, 11], [188, 10, 9], [202, 14, 7]];
  for (const [y, h, n] of rows) for (let i = 0; i < n; i++) {
    const x = OC.x - R1 + 4 + rng() * (R1 * 2 - 8);
    tussock(r, x, y + rng() * 6, h * (0.7 + rng() * 0.7), Math.floor(rng() * 9999));
  }
}
// gorse on the far ridge: a dark dithered bush
function bush(r, cx, cy, rad, seed) {
  for (let y = -rad; y <= 1; y++) for (let x = -rad * 1.6; x <= rad * 1.6; x++) {
    const d = Math.hypot(x / 1.6, y * 1.25) + (hash2f(Math.round(x), y, seed) - 0.5) * 1.6;
    if (d > rad) continue;
    const X = Math.round(cx + x), Y = Math.round(cy + y);
    r.px(X, Y, d < rad * 0.55 ? C.ink : bay(X, Y) < 0.55 ? C.char : C.slate, 2);
  }
}

// ------------------------------------------------------------------------------------------------ the granite ring
function paintRing(r, S, sd) {
  const Hm = new Float32Array(W * H), V = new Float32Array(W * H), kind = new Uint8Array(W * H), groove = new Float32Array(W * H);          // kind 0 ring, 1 opening, 2 bore wall
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d1 = Math.hypot(x - OC.x, y - OC.y), d2 = Math.hypot(x - C2.x, y - C2.y);
    kind[y * W + x] = d1 > R1 ? 0 : d2 <= C2.r ? 1 : 2;
  }
  const rng = mulberry32(sd * 5 + 7);
  // big soft tors
  const tors = [];
  for (let p = 0; p < 12; p++) tors.push([rng() * W, rng() * H, 26 + rng() * 40, (rng() - 0.35) * 40]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = x + 40 * (fbm(x * 0.007, y * 0.007, sd + 1, 2) - 0.5), wy = y + 40 * (fbm(x * 0.007 + 5, y * 0.007, sd + 2, 2) - 0.5);
    let h = 46 * fbm(wx * 0.012, wy * 0.012, sd + 3, 3);
    for (const [tx, ty, tr, ta] of tors) { const q = ((x - tx) * (x - tx) + (y - ty) * (y - ty)) / (tr * tr); if (q < 4) h += ta * Math.exp(-q * 1.2); }
    h += 1.7 * fbm(x * 0.07, y * 0.07, sd + 4, 3);
    h += 0.8 * fbm(x * 0.33, y * 0.33, sd + 5, 2);
    const dx = x - OC.x, dy = y - OC.y, d = Math.hypot(dx, dy), q = d - R1;
    if (q < 40) h -= 24 * Math.exp(-Math.max(0, q) / 7);
    // a crevice running round the top of the hole (the dark swath of the photograph), broken and warped
    const ang = Math.atan2(dy, dx), rr = R1 + 25 + 11 * (fbm(Math.cos(ang) * 1.6 + 2, Math.sin(ang) * 1.6, sd + 8, 3) - 0.5) * 2;
    const arc = smooth(0.15, -0.9, Math.sin(ang)) * (0.55 + 0.45 * fbm(ang * 2.2 + 9, 1.5, sd + 9, 2));
    const gv = Math.exp(-Math.pow((d - rr) / (5 + 4 * arc), 2)) * arc;
    groove[y * W + x] = gv;
    h -= 26 * gv;
    Hm[y * W + x] = h;
  }
  const stamp = (px, py, rad, depth, ex = 1, rot = 0) => {                                                // a bowl in the surface
    const cr = Math.cos(rot), sr = Math.sin(rot), m = Math.ceil(rad * 1.6);
    for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) {
      const X = Math.round(px) + i, Y = Math.round(py) + j;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const u = (i * cr + j * sr) / (rad * ex), v = (-i * sr + j * cr) / rad, q = u * u + v * v;
      if (q < 1) Hm[Y * W + X] -= depth * Math.pow(1 - q, 1.4);
    }
  };
  for (let p = 0; p < 70; p++) {                                                                          // weathering pits
    const px = rng() * W, py = rng() * H, big = rng() < 0.14;
    stamp(px, py, big ? 5 + rng() * 6 : 1.3 + rng() * 2.6, big ? 5 + rng() * 5 : 2 + rng() * 2.5, 1 + rng() * 0.8, rng() * 3);
  }
  const crackDepth = new Float32Array(W * H);
  for (let q = 0; q < 12; q++) {                                                                          // cracks
    let x = rng() * W, y = rng() * H, ang = (rng() < 0.6 ? 0.9 : 2.2) + (rng() - 0.5) * 0.7;
    const len = 40 + rng() * 100;
    for (let s = 0; s < len; s++) {
      ang += (rng() - 0.5) * 0.5; x += Math.cos(ang) * 0.9; y += Math.sin(ang) * 0.9;
      const X = Math.round(x), Y = Math.round(y);
      if (X < 1 || Y < 1 || X >= W - 1 || Y >= H - 1) break;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) crackDepth[(Y + j) * W + X + i] = Math.max(crackDepth[(Y + j) * W + X + i], (i === 0 && j === 0) ? 1 : 0.45);
    }
  }
  for (let i = 0; i < W * H; i++) Hm[i] -= crackDepth[i] * 3.4;
  const get = (x, y) => Hm[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)];
  const bore = (x, y) => {                                                                                // the wall of the bore: 0 at the front lip .. 1 at the far end
    const dx = x - OC.x, dy = y - OC.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    const ox = OC.x - C2.x, oy = OC.y - C2.y, b = ox * ux + oy * uy, disc = b * b - (ox * ox + oy * oy) + C2.r * C2.r;
    const s = -b + Math.sqrt(Math.max(0, disc)), th = R1 - s;
    return { u: th > 0 ? clamp((R1 - d) / th, 0, 1) : 1, ux, uy };
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, k = kind[i];
    if (k === 1) continue;
    const gx = (get(x + 1, y) - get(x - 1, y)) * 0.5, gy = (get(x, y + 1) - get(x, y - 1)) * 0.5;
    const lam = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / Math.hypot(gx, gy, 1);
    let v = 1.08 * Math.pow(clamp(lam, 0, 1.1), 1.45);
    v -= crackDepth[i] * 0.18;
    const sp = vnoise(x * 0.45, y * 0.45, sd + 61);
    v += (hash2f(x, y, sd + 77) - 0.5) * 0.1 + (sp - 0.5) * 0.12;
    if (k === 2) {
      const b = bore(x, y), face = clamp(-(b.ux * LIGHT[0] + b.uy * LIGHT[1]) * 1.5 + 0.15, 0, 1);
      v = mix(0.56 + 0.3 * face, 0.06, Math.pow(b.u, 1.4)) + (v - 0.45) * 0.3;
    } else {
      v *= (1.22 - 0.42 * x / W) * (1 - 0.6 * groove[i]);
      v *= (1 - 0.5 * smooth(110, 60, y)) * (1 - 0.7 * smooth(140, 200, y));                               // calm dark ground for the logo and the subtitle, and for the foot lines
    }
    V[i] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (kind[i] === 1) continue;
    r.px(x, y, rampG(V[i], x, y), 5);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {                                               // the lip and the far rim as thin dark lines
    if (kind[y * W + x] !== 1) continue;
    const d2 = Math.hypot(x - C2.x, y - C2.y), d1 = Math.hypot(x - OC.x, y - OC.y);
    if (d1 > R1 - 1.3) r.px(x, y, C.ink, 5); else if (d2 > C2.r - 1.3) r.px(x, y, C.char, 5);
  }
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) mask[i] = kind[i] === 0 ? 1 : 0;
  paintStrata(r, { x: 0, y: 0, w: W, h: H, data: mask }, sd + 33, { spacing: [9, 26], slope: 0.12, warp: 7, tone: 0.4, joint: 0.55, cracks: 0, light: [-0.7, -0.5], layer: 5 });
  for (const [lo, hi, tone, dens] of [[0.18, 0.36, 0.3, 1.4], [0.36, 0.58, 0.5, 2.4], [0.58, 2, 0.7, 3.2]]) {                // lichen: crusts take the tone of the stone they sit on
    paintLichen(r, { x: 0, y: 0, w: W, h: H, data: mask }, sd + 21 + Math.round(lo * 10), { density: dens, size: [1.2, 4.2], tone, light: [-0.7, -0.5], layer: 5, skip: (x, y) => V[y * W + x] < lo || V[y * W + x] >= hi });
  }
  for (let a = 0; a < 6.2832; a += 0.0185) {                                                                // a thin survey ring round the opening, in ember
    const rr = R1 + 8 + 1.2 * Math.sin(a * 5), X = Math.round(OC.x + Math.cos(a) * rr), Y = Math.round(OC.y + Math.sin(a) * rr);
    if (X >= 0 && Y >= 0 && X < W && Y < H && kind[Y * W + X] === 0) r.px(X, Y, C.ember, 5);
  }
  S.kind = kind;
}

// ------------------------------------------------------------------------------------------------ paint / anim
export function paint(r, spec, S) {
  const sd = S.seed;
  r.d.fill(C.char); r.lay.fill(0);
  paintSceneInOpening(r, S, sd);
  S.stone = monoStone(r, 202, 176, 84, { seed: 12 + (sd % 7), symbol: 'crescent', glow: 0.7, layer: 3, width: 0.44, taper: [0.42, 0.58], light: [-0.8, -0.45], elev: 0.45, shadow: { sx: 0.9, sy: 0.12, dens: 0.7, layerMax: 2 } });
  paintTussocks(r, sd);
  paintRing(r, S, sd);
  paintFootPlate(r, 168, { strength: 0.8, layer: 5 });
  paintTitleLogo(r, S);
  S.mist = makeMistBands(W, [{ y: 138, rows: 16, speed: 3, dens: 0.55, layerMax: 2 }, { y: 160, rows: 12, speed: -2, dens: 0.4, layerMax: 2 }], sd + 40);
}

export function anim(r, spec, S, t) {
  animMistBands(r, S.mist, t);
  pulseEmbers(r, S.stone && S.stone.embers, t);
  animLogo(r, S.logo, t);
}
