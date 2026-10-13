/**
 * Start screen 5: MENHIR, a SURVEY PLATE.
 *
 * After an old black-and-white photograph of a great rounded menhir rising out of long grass, covered in patchwork lichen, hazy
 * fields behind. Ours is greyscale with ONE accent: a very tall bullet-topped stone (own heightfield: a leaning, tapering body of
 * revolution with strata, pits and rain runnels, lit by a low sun from the left: a lit flank, a dark flank), dense patchwork lichen
 * (a threshold-noise patchwork that follows the stone's own light, plus the kit's paintLichen rosettes), a small incised Pictish
 * symbol glowing ember, tussocks at the foot. Behind it a hazy banded sky, receding ridges and a faint hypsometric contour field with a
 * perspective grid. Over it all the stone is annotated like a trig-survey plate in thin ember lines: a dimension line with ticks and
 * a height label, a spot height, a graduated bearing arc with a sight line to a far trig point, a scale bar and a station caption.
 *
 * Layers: 0 sky, 1 ridges, 2 ground, 3 stone and grass, 4 annotation, 5 foot plate, 6 logo.
 * Deterministic (S.seed only). anim(): mist drift, logo glint, the incision and the annotation breathing.
 */
import {
  C, GREY, bay, clamp, smooth, mix, vnoise, fbm, rampAt, liftG, sinkG, hash2f, mulberry32, stampSmall, smallWidth,
  paintGreyGradient, paintLichen, paintContourField, paintFootPlate, paintTitleLogo, animLogo, makeMistBands, animMistBands, pulseEmbers,
} from './kit.js';
import { SYMBOL_STROKES } from '../stone.js';

// where the text of the screen goes (logo, subtitle and prompt sit in the calm sky to the right of the stone)
export const layout = {
  subtitle: { x: 274, y: 58, align: 'center', maxW: 180, lh: 10 },
  prompt: { x: 264, y: 168 },
  controls: 192,
  strapline: 202,
  cornerLeft: { x: 8, y: 4, lh: 7 },
  colors: { subtitle: 'fog', subtitleHalo: 'ink' },
};
export const levels = [];

const W = 384, H = 216;
const L_SKY = 0, L_RIDGE = 1, L_GROUND = 2, L_STONE = 3, L_NOTE = 4, L_PLATE = 5;

// ----------------------------------------------------------------------------- geometry of the stone
const STONE = { cx: 118, baseY: 189, h: 184, hb: 35, lean: 8 };

const GRAD = (v) => clamp(v, 0, 1);

/** the horizon line: where the ground (contour field) begins, a low roll */
const HOR = 112;
const horizonY = (x, seed) => HOR + (fbm(x * 0.012, 3.1, seed + 3, 3) - 0.5) * 9 + Math.sin(x * 0.02) * 1.5;

// ----------------------------------------------------------------------------- sky and country
function paintSky(r, S) {
  paintGreyGradient(r, { x: 0, y: 0, w: W, h: 130 }, 0.4, 0.86, { bias: 0.95, flat: 0.55, streak: 0.26, seed: S.seed + 2, layer: L_SKY });
}

function paintRidges(r, S) {
  const specs = [
    { y: 80, amp: 9, f: 0.008, v: 0.76, haze: 0.84, ph: 1.7 },
    { y: 90, amp: 8, f: 0.011, v: 0.69, haze: 0.8, ph: 5.2 },
    { y: 100, amp: 7, f: 0.015, v: 0.63, haze: 0.76, ph: 9.9 },
    { y: 110, amp: 5, f: 0.02, v: 0.58, haze: 0.73, ph: 14.3 },
  ];
  specs.forEach((s, k) => {
    for (let x = 0; x < W; x++) {
      const ry = s.y + (fbm(x * s.f, s.ph, S.seed + 20 + k, 3) - 0.5) * 2 * s.amp;
      for (let y = Math.max(0, Math.floor(ry)); y < 150; y++) {
        const d = y - ry;
        let v = mix(s.v, s.haze, smooth(0, 15, d));                         // down the far side the land dissolves into the haze
        v -= 0.06 * smooth(0, 3, d) * (1 - smooth(3, 7, d));                // a slightly darker crest edge
        if (k > 0 && d > 3 && d < 14 && (y + k) % 4 === 0 && bay(x, y) < 0.4) v -= 0.07;     // field boundaries, faint
        r.px(x, y, rampAt(GREY, GRAD(v + (bay(x * 3 + 1, y) - 0.5) * 0.03), x, y), L_RIDGE);
      }
    }
  });
}

function paintGround(r, S) {
  const seed = S.seed + 40;
  const hf = (x, y) => {                                                              // the land in perspective: contours bunch towards the horizon
    const dy = Math.max(1, y - HOR + 4), Z = 30 / (dy * 0.55 + 16), X = (x - 190) * Z * 0.013;
    return clamp(0.3 + (fbm(X * 1.15 + 2, Z * 2.2, seed, 4) - 0.5) * 1.35 + (y - HOR) * 0.0012, 0, 1);
  };
  paintContourField(r, hf, {
    rect: { x: 0, y: 96, w: W, h: H - 96 }, bands: 13, tints: [0.16, 0.6], seam: 0.86, light: [-1, -0.2], shade: 0.18, relief: 22,
    fine: true, index: 5, grid: 0, layer: L_GROUND, accent: null, spots: 5, metres: [180, 470], avoid: [{ x: 0, y: 158, w: 384, h: 58 }, { x: 0, y: 0, w: 16, h: 216 }, { x: 368, y: 0, w: 16, h: 216 }, { x: 168, y: 160, w: 210, h: 22 }, { x: 0, y: 150, w: 78, h: 40 }, { x: 286, y: 138, w: 98, h: 28 }, { x: 76, y: 8, w: 90, h: 184 }, { x: 150, y: 100, w: 220, h: 50 }],
    skip: (x, y) => y < horizonY(x, S.seed) + 14, haze: (x, y) => 1 - smooth(horizonY(x, S.seed) + 13, horizonY(x, S.seed) + 64, y) * 0.9, hazeV: 0.73,
  });
  // the OS grid in perspective: horizontals bunch to the horizon, verticals run to a vanishing point; it fades into the haze
  const vp = { x: 190, y: 40 }, hor = HOR;
  const grid = (x, y, d) => { if (bay(x * 3 + 1, y * 5 + 2) < d) r.px(x, y, rampAt([C.slate, C.ash], 0.5, x, y), L_GROUND); };
  for (let k = 0; k < 18; k++) {
    const y = Math.round(hor + 3 + Math.pow(k * 0.78, 1.9) * 2.8);
    if (y >= H) break;
    for (let x = 0; x < W; x++) if (y >= horizonY(x, S.seed) + 1) grid(x, y, 0.12 + 0.5 * smooth(hor, 190, y));
  }
  for (let k = -9; k <= 9; k++) {
    const xb = 205 + k * 54;
    for (let y = hor; y < H; y++) {
      const x = Math.round(vp.x + (xb - vp.x) * (y - vp.y) / (H - vp.y));
      if (y >= horizonY(x, S.seed) + 1) grid(x, y, 0.12 + 0.5 * smooth(hor, 190, y));
    }
  }
}

// ----------------------------------------------------------------------------- the stone
function dseg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}
function darc(px, py, cx, cy, R, a0, a1) {
  const a = Math.atan2(py - cy, px - cx), span = a1 - a0;
  const k = (((a - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (k <= span) return Math.abs(Math.hypot(px - cx, py - cy) - R);
  return Math.min(Math.hypot(px - cx - R * Math.cos(a0), py - cy - R * Math.sin(a0)), Math.hypot(px - cx - R * Math.cos(a1), py - cy - R * Math.sin(a1)));
}
function symbolDist(g, x, y) {
  let m = 9;
  for (const [cx, cy, R, a0, a1] of g.arcs) m = Math.min(m, darc(x, y, cx, cy, R, a0, a1));
  for (const [cx, cy, R] of g.circles) m = Math.min(m, Math.abs(Math.hypot(x - cx, y - cy) - R));
  for (const [ax, ay, bx, by] of g.segs) m = Math.min(m, dseg(x, y, ax, ay, bx, by));
  return m;
}

function paintStone(r, S) {
  const seed = S.seed + 60;
  const { cx, baseY, h, hb, lean } = STONE;
  const X0 = cx - 58, GWd = 128, Y0 = baseY - h - 4, GHt = h + 12;
  const idx = (x, y) => (y - Y0) * GWd + (x - X0);
  const inG = (x, y) => x >= X0 && x < X0 + GWd && y >= Y0 && y < Y0 + GHt;
  const kind = new Uint8Array(GWd * GHt), z = new Float32Array(GWd * GHt), U = new Float32Array(GWd * GHt), LY = new Float32Array(GWd * GHt);

  // ---- outline per row: leaning, tapering, an ogive head
  const t0 = 0.58;
  const hwAt = (ly) => {
    const t = ly / h;
    const body = hb * (1 - 0.15 * smooth(0, t0, t) + 0.05 * (1 - smooth(0, 0.12, t)));
    if (t <= t0) return body;
    const s = (t - t0) / (1 - t0);
    return (hb * (1 - 0.15)) * Math.pow(Math.max(0, 1 - Math.pow(s, 2.15)), 0.52);
  };
  const rows = [];
  for (let ly = -2; ly <= h + 1; ly++) {
    const t = clamp(ly / h, 0, 1), w = hwAt(Math.max(0, ly));
    const calm = 1 - smooth(0.9, 1, t);                                              // the rounded head keeps a clean line
    const eL = ((vnoise(ly / 5.2, 0.3, seed + 1) - 0.5) * 1.5 + (vnoise(ly / 26, 0.8, seed + 2) - 0.5) * 4.5) * calm;
    const eR = ((vnoise(ly / 5.2, 0.9, seed + 3) - 0.5) * 1.5 + (vnoise(ly / 26, 1.7, seed + 4) - 0.5) * 4.5) * calm;
    const ax = cx + lean * Math.pow(t, 1.35) + (vnoise(ly / 40, 0.5, seed + 5) - 0.5) * 3 * calm;
    rows.push({ ly, l: ax - (w + eL), r: ax + (w + eR) });
  }
  let top = 0;
  for (const row of rows) {
    const ly = row.ly, y = baseY - ly;
    if (ly < 0 && (vnoise(row.l * 0.4, ly, seed + 6) * 2.4 - 1.2 < ly + 0.5)) continue;
    for (let x = Math.ceil(row.l); x <= Math.floor(row.r); x++) {
      if (!inG(x, y)) continue;
      const i = idx(x, y), half = (row.r - row.l) / 2, u = (x - (row.l + row.r) / 2) / (half || 1);
      kind[i] = 1; U[i] = u; LY[i] = ly; top = Math.max(top, ly);
      const D = half * 0.9;                                                         // depth of the body: a rounded section
      z[i] = D * Math.sqrt(Math.max(0, 1 - u * u));
    }
  }
  // ---- relief: strata ledges, lumps, grain, pits, cracks
  const theta = -0.13;
  const rng = mulberry32(seed * 3 + 1);
  const bounds = [], offs = [], tones = [];
  { let s = -20; while (s < h + 30) { bounds.push(s); s += 5 + 15 * Math.pow(rng(), 1.4); offs.push((rng() - 0.5) * 2.2); tones.push((rng() - 0.5) * 0.1); } }
  const layerOf = (s) => { let lo = 0, hi = bounds.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bounds[m] <= s) lo = m; else hi = m - 1; } return lo; };
  const sOf = (x, y, ly) => ly + theta * (x - cx) + (fbm(x * 0.03, y * 0.03, seed + 10, 2) - 0.5) * 9;
  const crack = new Uint8Array(GWd * GHt);
  for (let c = 0; c < 5; c++) {
    let x = cx - 18 + rng() * 40 + lean * 0.3, y = baseY - h * (0.1 + rng() * 0.55), ang = Math.PI / 2 + (rng() - 0.5) * 0.7;
    const len = 14 + rng() * 40;
    for (let s = 0; s < len; s++) {
      ang = clamp(ang + (rng() - 0.5) * 0.5, 0.35, Math.PI - 0.35);
      x += Math.cos(ang) * 0.9; y += Math.sin(ang) * 0.9;
      const X = Math.round(x), Y = Math.round(y);
      if (inG(X, Y) && kind[idx(X, Y)] && Math.abs(U[idx(X, Y)]) < 0.9) crack[idx(X, Y)] = 1;
    }
  }
  for (let y = Y0; y < Y0 + GHt; y++) for (let x = X0; x < X0 + GWd; x++) {
    const i = idx(x, y);
    if (!kind[i]) continue;
    const s = sOf(x, y, LY[i]), k = layerOf(s);
    const sb = s - bounds[k];
    let zz = z[i] + offs[k] * 0.9;
    zz += (fbm(x * 0.07, y * 0.06, seed + 11, 3) - 0.5) * 4.6;
    zz += (vnoise(x * 0.33, y * 0.29, seed + 12) - 0.5) * 0.9;
    if (sb < 0.9 && vnoise(x * 0.3, y * 0.3, seed + 13) > 0.38) zz -= 1.0;           // bedding joint
    if (hash2f(x, y, seed + 14) < 0.014 * smooth(0.45, 0.85, vnoise(x * 0.08, y * 0.08, seed + 15))) zz -= 1.3;   // pits
    if (crack[i]) zz -= 2.2;
    z[i] = zz;
  }

  // ---- the incised symbol (crescent and V-rod), low on the face
  const sym = SYMBOL_STROKES.crescent;
  const SC = 8.6, scx = cx - 4, scy = baseY - h * 0.18;
  const G = new Float32Array(GWd * GHt).fill(9);
  {
    const R = Math.ceil(Math.max(sym.w, sym.h) * SC) + 4, ang = -0.2, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = Math.round(scy - R); y <= scy + R; y++) for (let x = Math.round(scx - R); x <= scx + R; x++) {
      if (!inG(x, y) || !kind[idx(x, y)]) continue;
      const dx = (x - scx) / SC, dy = (y - scy) / SC, wob = (vnoise(x * 0.25, y * 0.25, seed + 16) - 0.5) * 0.08;
      const px = dx * ca + dy * sa + wob, py = -dx * sa + dy * ca + wob;
      const d = symbolDist(sym, px, py) * SC;
      if (d < 1.2) G[idx(x, y)] = d;
    }
  }

  // ---- shade: a low sun from the left; the normal comes from the height map
  const Lv = [-0.8, -0.27, 0.54], Ln = Math.hypot(...Lv), lx = Lv[0] / Ln, ly_ = Lv[1] / Ln, lz = Lv[2] / Ln;
  const zat = (x, y) => (inG(x, y) && kind[idx(x, y)] ? z[idx(x, y)] : 0);
  const T = new Float32Array(GWd * GHt);
  for (let y = Y0; y < Y0 + GHt; y++) for (let x = X0; x < X0 + GWd; x++) {
    const i = idx(x, y);
    if (!kind[i]) continue;
    const dzx = (zat(x + 1, y) - zat(x - 1, y)) * 0.5, dzy = (zat(x, y + 1) - zat(x, y - 1)) * 0.5;
    const nl = Math.hypot(dzx, dzy, 1), lam = (-dzx * lx - dzy * ly_ + lz) / nl;
    const ly = LY[i], t = ly / h, u = U[i];
    let v = 0.08 + 0.8 * Math.pow(clamp(lam, 0, 1), 1.1);
    v += tones[layerOf(sOf(x, y, ly))] * 0.7;                                         // each stratum its own tone
    v += (fbm(x * 0.06, y * 0.05, seed + 17, 3) - 0.5) * 0.2;                          // granite mottle
    v += (vnoise(x * 0.5, y * 0.45, seed + 19) - 0.5) * 0.09;                          // grain
    const run = smooth(0.6, 0.85, vnoise(x * 0.5, y * 0.028, seed + 18));              // rain runnels
    v *= 1 - 0.25 * run * smooth(0.1, 0.4, t);
    v *= 1 - 0.4 * Math.exp(-ly / 10);                                                // dark at the foot
    v += 0.05 * smooth(0.65, 1, t) * (1 - smooth(0.2, 1, u));                           // the crown catches the sky
    v += 0.1 * smooth(0.78, 1, u) * smooth(0.02, 0.2, t);                               // light bounced off the ground into the dark edge
    if (crack[i]) v *= 0.3;
    T[i] = clamp(v, 0, 1);
  }

  // ---- patchwork lichen: threshold noise, so patches touch and share edges; dense on the head and the weather side.
  // Every kind works RELATIVE to the light on the stone beneath it, so the crust turns with the form.
  const cluster = (x, y) => vnoise(x * 0.05, y * 0.04, seed + 30);
  const cov = (x, y, ly, u, base) => clamp(base * (0.78 + 0.7 * smooth(0.2, 0.95, ly / h)) * (0.5 + 1.0 * cluster(x, y)) * (0.8 + 0.3 * smooth(0.3, -0.9, u)), 0, 0.66);
  const fld = (x, y, sc, sd) => vnoise(x / sc, y / sc, sd) * 0.8 + vnoise(x / (sc * 0.4), y / (sc * 0.4), sd + 7) * 0.2;
  const KINDS = [
    { sc: 3.6, sd: seed + 40, base: 0.6, f: (T0) => T0 * 0.46, rim: (T0) => T0 * 0.15 },             // dark crust
    { sc: 4.3, sd: seed + 50, low: 1, base: 0.46, f: (T0) => T0 * 0.5 + 0.3, rim: (T0) => T0 * 0.38 },             // pale crust
    { sc: 3.0, sd: seed + 60, base: 0.4, f: (T0) => T0 * 0.78 + 0.08, rim: (T0) => T0 * 0.28 },             // map lichen
  ];
  const patch = (k, x, y, ly, u) => fld(x, y, k.sc, k.sd) > 1 - cov(x, y, ly, u, k.base) * (k.low ? 1.25 - 0.85 * smooth(0.45, 0.95, ly / h) : 0.9);
  const embers = [];
  const stoneAt = (x, y) => inG(x, y) && kind[idx(x, y)];
  for (let y = Y0; y < Y0 + GHt; y++) for (let x = X0; x < X0 + GWd; x++) {
    const i = idx(x, y);
    if (!kind[i]) continue;
    const ly = LY[i], u = U[i], base = T[i];
    let v = base, g = 0;
    for (let ki = 0; ki < 3; ki++) {
      const k = KINDS[ki];
      if (!patch(k, x, y, ly, u)) continue;
      const edge = !patch(k, x - 1, y, ly, u) || !patch(k, x, y - 1, ly, u) || !patch(k, x + 1, y + 1, ly, u);
      v = edge && bay(x, y) < 0.8 ? k.rim(base) : k.f(base);
      if (!edge && ki === 2 && hash2f(x, y, seed + 70) < 0.15) v *= 0.6;                      // areoles
      else if (!edge && ki === 1 && hash2f(x, y, seed + 71) < 0.08) v *= 0.75;
      g = ki + 1;
      break;
    }
    if (!g && hash2f(x, y, seed + 72) < 0.06) v = clamp(v + (hash2f(x, y, seed + 73) < 0.55 ? -0.1 : 0.09), 0, 1);   // grain
    if (base > 0.6 && hash2f(x, y, seed + 74) < 0.0015) v = 1;                                // mica
    // inside a patch the tone is nearly flat (a crust, not a gradient); the bare rock keeps its full dither
    r.px(x, y, g ? GREY[clamp(Math.round(v * 6 + (bay(x, y) - 0.5) * 0.7), 0, 6)] : rampAt(GREY, clamp(v, 0, 1), x, y), L_STONE);
  }
  // ---- a few discrete rosettes of the kit's lichen, tone-matched zones across the face (lit .. shade)
  const zoneMask = (u0, u1) => { const d = new Uint8Array(GWd * GHt); for (let i = 0; i < d.length; i++) if (kind[i] && U[i] >= u0 && U[i] < u1 && G[i] > 1.9) d[i] = 1; return { x: X0, y: Y0, w: GWd, h: GHt, data: d }; };
  const lo = [[C.char, C.slate, C.ash, C.rock], [C.ink, C.char, C.slate, C.ash]];
  const mid = [[C.char, C.slate, C.ash, C.fog], [C.ink, C.char, C.slate, C.rock], [C.slate, C.ash, C.rock, C.fog]];
  const hi = [[C.slate, C.ash, C.rock, C.fog], [C.char, C.slate, C.ash, C.rock], [C.slate, C.ash, C.rock, C.fog]];
  paintLichen(r, zoneMask(-1.01, -0.4), seed + 80, { density: 0.55, size: [1, 2.8], ramps: hi, tone: 0.7, rim: C.char, light: [-1, -0.3], layer: L_STONE });
  paintLichen(r, zoneMask(-0.4, 0.15), seed + 81, { density: 0.5, size: [1, 3], ramps: mid, tone: 0.5, rim: C.char, light: [-1, -0.3], layer: L_STONE });
  paintLichen(r, zoneMask(0.15, 0.6), seed + 82, { density: 0.5, size: [1, 2.8], ramps: lo, tone: 0.25, rim: C.ink, light: [-1, -0.3], layer: L_STONE });
  paintLichen(r, zoneMask(0.6, 1.01), seed + 83, { density: 0.3, size: [1, 2.2], ramps: lo, tone: 0.08, rim: C.ink, light: [-1, -0.3], layer: L_STONE });

  // ---- the groove
  for (let y = Y0; y < Y0 + GHt; y++) for (let x = X0; x < X0 + GWd; x++) {
    const i = idx(x, y);
    if (!kind[i]) continue;
    if (G[i] < 0.8) {
      if (G[i] < 0.62) { r.px(x, y, C.ember, L_STONE); embers.push([x, y, (x * 7 + y * 13) % 17, C.char]); }   // the bed
      else r.px(x, y, C.ink, L_STONE);
    } else if (G[i] < 1.2) {
      const below = G[idx(x, y - 1)] < 0.8, above = G[idx(x, y + 1)] < 0.8;
      if (below) r.px(x, y, liftG(liftG(r.get(x, y))), L_STONE);                                  // the lit lip under each groove
      else if (above || G[idx(x - 1, y)] < 0.8) r.px(x, y, sinkG(sinkG(r.get(x, y))), L_STONE);   // the shadow wall above it
    }
  }
  // ---- the edge against the sky: a solid dark line outside the lit flank so it never melts into the haze, a lit rim just inside it
  const info = { x0: 1e9, x1: -1e9, top: baseY - top };
  for (let y = Y0; y < Y0 + GHt; y++) for (let x = X0; x < X0 + GWd; x++) {
    const i = idx(x, y);
    if (!kind[i]) {
      if (stoneAt(x + 1, y) && bay(x + 1, y + 1) < 0.85) r.px(x, y, C.ink, L_STONE);
      else if (stoneAt(x, y + 1) && bay(x, y) < 0.75 && y < baseY - 2) r.px(x, y, C.char, L_STONE);
      continue;
    }
    if (x < info.x0) info.x0 = x; if (x > info.x1) info.x1 = x;
    if (!stoneAt(x - 1, y) && T[i] > 0.4) r.px(x, y, bay(x + 3, y) < 0.5 ? C.fog : C.rock, L_STONE);             // the lit edge itself
    else if (!stoneAt(x + 1, y) && bay(x, y) < 0.8) r.px(x, y, C.ink, L_STONE);
  }
  S.stone = { cx, baseY, h, top: baseY - top, x0: info.x0, x1: info.x1, kind, idx, X0, Y0, GWd, GHt, embers, symbol: { x: Math.round(scx), y: Math.round(scy), S: SC } };
  return S.stone;
}

/** The stone's shadow thrown across the ground (the sun is low, in front-left: it falls to the right and away), and a contact shadow at the foot. */
function paintCastShadow(r, S) {
  const st = S.stone, { cx, baseY, h } = STONE;
  const sx = 0.62, sy = -0.2;
  const sh = new Float32Array(W * H);
  for (let ly = 0; ly <= h; ly += 0.5) {
    const yy = baseY - Math.round(ly);
    if (yy < st.Y0 || yy >= st.Y0 + st.GHt) continue;
    const y = Math.round(baseY + 1 + ly * sy), fade = 1 - 0.75 * Math.pow(ly / h, 0.8);
    for (let x = st.X0; x < st.X0 + st.GWd; x++) {
      if (!st.kind[st.idx(x, yy)]) continue;
      const X = Math.round(x + ly * sx);
      if (X >= 0 && X < W && y >= 0 && y < H) { const i = y * W + X; if (fade > sh[i]) sh[i] = fade; }
    }
  }
  // contact shadow: an ellipse hugging the foot
  for (let y = baseY - 6; y < baseY + 9; y++) for (let x = cx - 60; x < cx + 70; x++) {
    const d = Math.hypot((x - (cx + 6)) / 56, (y - (baseY + 1)) / 7);
    if (d < 1) sh[y * W + x] = Math.max(sh[y * W + x], 1 - d);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let k = sh[y * W + x];
    if (k <= 0 || r.lay[y * W + x] > L_GROUND) continue;
    let m = 0, n = 0;                                                               // a soft edge: average over the neighbours
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = x + i, yy = y + j; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { m += sh[yy * W + xx]; n++; } }
    k = (k + m / n) * 0.5 * 0.95;
    let c = r.get(x, y);
    if (bay(x, y) < k) c = sinkG(c);
    if (bay(x + 3, y + 1) < k - 0.4) c = sinkG(c);
    r.px(x, y, c, L_GROUND);
  }
}

/** Tussocks and long grass: curved blades fanning from each root, dark at the root, pale at the lit tips. */
function paintGrass(r, S) {
  const { cx, baseY } = STONE;
  const seed = S.seed + 90;
  const tussock = (x, y, n, len, spread, sd) => {
    for (let q = 0; q < n; q++) {
      const ang = -Math.PI / 2 + (hash2f(q, 1, sd) - 0.5) * spread, L = Math.max(3, len * (0.45 + 0.55 * hash2f(q, 2, sd)));
      const bend = (hash2f(q, 3, sd) - 0.5) * 1.3, ca = Math.cos(ang), sa = Math.sin(ang);
      for (let k = 0; k < L; k++) {
        const tt = k / L;
        const bx = Math.round(x + ca * k + bend * tt * tt * L * 0.55), by = Math.round(y + sa * k + tt * tt * L * 0.12);
        const lit = (ca < 0 ? 0.12 : -0.05) + (bend < 0 ? 0.08 : 0);
        const c = rampAt([C.ink, C.char, C.slate, C.ash, C.rock, C.fog], clamp(0.05 + tt * 0.8 + lit + (hash2f(bx, by, sd + 5) - 0.5) * 0.2, 0, 1), bx, by);
        r.px(bx, by, c, L_STONE);
      }
    }
  };
  // the stone stands in a skirt of tussocks
  for (let x = cx - 58; x <= cx + 74; x += 5 + Math.floor(hash2f(x, 7, seed) * 4)) {
    const d = clamp(Math.abs(x - (cx + 8)) / 64, 0, 1);
    tussock(x, baseY + 1 + Math.floor(hash2f(x, 8, seed) * 3), 7 + Math.floor(hash2f(x, 9, seed) * 6), 8 + 12 * hash2f(x, 10, seed) * (1 - 0.4 * d), 1.5 + hash2f(x, 11, seed), seed + x);
  }
  for (let x = cx - 62; x <= cx + 80; x += 7 + Math.floor(hash2f(x, 17, seed) * 5)) {
    tussock(x, baseY + 6 + Math.floor(hash2f(x, 18, seed) * 4), 6 + Math.floor(hash2f(x, 19, seed) * 5), 6 + 8 * hash2f(x, 20, seed), 1.8, seed + 300 + x);
  }
  // scattered clumps over the rest of the ground, small and sparse
  const rng = mulberry32(seed + 5);
  for (let c = 0; c < 46; c++) {
    const x = Math.floor(rng() * W), y = baseY + 3 + Math.floor(rng() * 26);
    if (x > cx - 62 && x < cx + 82 && y < baseY + 12) continue;
    tussock(x, y, 4 + Math.floor(rng() * 5), 3 + rng() * 6, 1.8, seed + 500 + c);
  }
}

// ----------------------------------------------------------------------------- the plate: survey annotation
function paintPlate(r, S) {
  const st = S.stone, notes = [];
  const px = (x, y, c = C.ember, pulse = true) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const under = r.get(x, y);
    r.px(x, y, c, L_NOTE);
    if (pulse && c === C.ember) notes.push([x, y, notes.length % 31, under]);
  };
  const line = (x0, y0, x1, y1, o = {}) => {
    const { dash = 0, gap = 0, c = C.ember, pulse = true } = o;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)), per = dash + gap;
    for (let k = 0; k <= n; k++) {
      if (per && k % per >= dash) continue;
      px(x0 + (x1 - x0) * k / (n || 1), y0 + (y1 - y0) * k / (n || 1), c, pulse);
    }
  };
  const label = (txt, x, y, col, halo = C.ink) => { stampSmall(r, txt, Math.round(x), Math.round(y), col, halo, L_NOTE); };
  const edgeL = (y) => { for (let x = st.X0; x < st.X0 + st.GWd; x++) if (st.kind[st.idx(x, y)]) return x; return st.cx; };
  const edgeR = (y) => { for (let x = st.X0 + st.GWd - 1; x >= st.X0; x--) if (st.kind[st.idx(x, y)]) return x; return st.cx; };

  // ---- 1. the dimension line: summit to foot, with extension lines, arrow heads, a ruler of metre ticks and the height
  const DX = 72, yT = st.top, yB = STONE.baseY;
  line(DX + 3, yT, edgeL(yT + 2) - 6, yT, { dash: 2, gap: 3 });                          // extension line to the summit
  line(DX + 3, yB, edgeL(yB - 2) - 6, yB, { dash: 2, gap: 3 });                          // and to the foot
  line(DX - 6, yT, DX + 6, yT); line(DX - 6, yB, DX + 6, yB);                           // end ticks
  const midY = Math.round((yT + yB) / 2) - 3;
  line(DX, yT + 4, DX, midY - 5); line(DX, midY + 9, DX, yB - 4);
  for (let k = 0; k <= 2; k++) { px(DX - k, yT + 1 + k); px(DX + k, yT + 1 + k); px(DX - k, yB - 1 - k); px(DX + k, yB - 1 - k); }   // arrow heads
  const per = (yB - yT) / 5.8;
  for (let m = 1; m <= 5; m++) { const y = yB - m * per; line(DX, y, DX + (m === 5 ? 4 : 2), y); if (m % 2 === 1) line(DX, y, DX - 2, y); }
  label('5.8 M', DX - 5 - smallWidth('5.8 M'), midY + 1, C.ember, C.ink);

  // ---- 2. a spot height and the station caption, low on the left
  const sx = 30, sy = 160;
  for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) px(sx + dx, sy + dy, C.ember, false);
  r.px(sx, sy, C.snow, L_NOTE);
  label('212.4', sx + 6, sy - 2, C.fog, C.ink);
  label('SURVEY STATION', 8, 170, C.ember, C.ink);
  label('NO 07  OBS 1923', 8, 177, C.ash, C.ink);

  // ---- 3. a sight line from the stone to a far trig point, with the graduated bearing arc about the instrument
  const py = 133, ex = edgeR(py), P = [ex + 4, py], T = [338, 124];
  const dirA = Math.atan2(T[1] - P[1], T[0] - P[0]);
  const at = (a, rad) => [P[0] + Math.cos(a) * rad, P[1] + Math.sin(a) * rad];
  const R = 54, SPAN = 27 * Math.PI / 180;
  let prev = null;
  for (let q = -SPAN; q <= SPAN + 1e-6; q += 0.004) { const p = at(dirA + q, R); if (prev) line(prev[0], prev[1], p[0], p[1]); prev = p; }
  for (let d = -27; d <= 27; d += 3) {
    const major = d % 15 === 0, a = dirA + d * Math.PI / 180;
    const p0 = at(a, R - (major ? 2 : 0)), p1 = at(a, R + (d === 0 ? 9 : major ? 6 : 3));
    line(p0[0], p0[1], p1[0], p1[1]);
    if (major && d !== 0) { const q = at(a, R + 8); label(String(60 + d).padStart(3, '0'), q[0] - 1, q[1] - 2, C.fog, C.ink); }
  }
  line(P[0] + 3, P[1], T[0] - 6, T[1] + 1, { dash: 3, gap: 4 });
  px(P[0], P[1]); px(P[0] - 1, P[1], C.snow, false); px(P[0] + 1, P[1], C.snow, false);
  // the trig point: a triangle with a dot in it (never a cross)
  const [tx, ty] = T;
  for (let k = 0; k < 7; k++) { px(tx - k / 2, ty - 6 + k); px(tx + k / 2, ty - 6 + k); }
  line(tx - 3, ty + 1, tx + 3, ty + 1); r.px(tx, ty - 1, C.snow, L_NOTE);
  label('TRIG 641', tx - 14, ty - 15, C.fog, C.ink);
  label('BRG 060', tx - 14, ty + 6, C.fog, C.ink);

  // ---- spot heights on the land: a dot and a number, as on the sheet
  for (const [x, y, n] of [[26, 124, '262'], [250, 140, '231']]) {
    px(x, y, C.snow, false); px(x - 1, y, C.ink, false); px(x + 1, y, C.ink, false); px(x, y - 1, C.ink, false); px(x, y + 1, C.ink, false);
    label(n, x + 4, y - 2, C.fog, C.ink);
  }

  // ---- 4. a scale bar
  const bx = 290, by = 148, seg = 20;
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < seg; i++) { px(bx + k * seg + i, by, k % 2 ? C.fog : C.ember, k % 2 === 0); px(bx + k * seg + i, by + 1, k % 2 ? C.fog : C.ember, k % 2 === 0); }
    line(bx + k * seg, by - 3, bx + k * seg, by + 4);
  }
  line(bx + 4 * seg, by - 3, bx + 4 * seg, by + 4);
  [['0', 0], ['200', 2], ['400 M', 4]].forEach(([t, k]) => label(t, bx + k * seg - (k === 4 ? smallWidth(t) - 2 : 1), by + 7, C.ash, C.ink));
  S.notes = notes;
}

// ----------------------------------------------------------------------------- paint / anim
export function paint(r, spec, S) {
  paintSky(r, S);
  paintRidges(r, S);
  paintGround(r, S);
  paintStone(r, S);
  paintCastShadow(r, S);
  paintFootPlate(r, 170, { strength: 0.8, layer: L_PLATE });
  paintGrass(r, S);
  paintPlate(r, S);
  paintTitleLogo(r, S, { cx: 274, top: 22, scale: 4, spacing: 0 });
  S.mist = makeMistBands(r.w, [
    { y: 96, rows: 18, speed: 3, dens: 0.5, layerMax: L_GROUND, phase: 3 },
    { y: 128, rows: 16, speed: 5, dens: 0.5, layerMax: L_GROUND, phase: 11 },
    { y: 40, rows: 20, speed: 2, dens: 0.3, layerMax: L_SKY, phase: 7 },
  ], S.seed + 7);
}

export function anim(r, spec, S, t) {
  animMistBands(r, S.mist, t);
  pulseEmbers(r, S.stone && S.stone.embers, t);
  if (S.notes) {
    // the plate breathes: a slow wave runs along the lines, thinning them to a half-tone (the ground showing through) at its trough
    for (const [x, y, ph, under] of S.notes) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.1 - ph * 0.22);
      if (k < 0.3 && ((x + y) & 1)) r.d[y * r.w + x] = under;
    }
  }
  animLogo(r, S.logo, t);
}
