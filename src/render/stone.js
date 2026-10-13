/**
 * The standing stone: a tall slab of weathered gneiss, painted per pixel from a little height-map of its own face.
 *
 *   paintStandingStone(r, cx, baseY, h, opts) -> { x0, y0, w, maskH, mask, top, symbol, embers, ... }
 *     r     a Raster (artkit.js): palette u32 pixels plus a layer id per pixel
 *     cx    screen x of the stone's axis;  baseY  screen y of its foot;  h  its height in px
 *     mask  w x maskH, row 0 = the foot, 1 where the stone is;  x0, y0  screen position of the mask's left edge and top row
 *     embers [[x, y, phase], ...] the screen pixels of the incision that glow (a caller may pulse them between lamp, ember and rust)
 *
 * The stone is deterministic for a seed (no Math.random). Its face is a height-map (a rounded slab, strata that step in and out,
 * cracks, pits, an incised symbol); the normal of that map is lit by a low sun (ordered-dither steps of a cool or brown
 * rock ramp, a warm ember/flame rim on the sunward edge, deep ink shadow on the other, short ledge shadows under every
 * stratum), then lichen, moss and heather are laid on top, following the layering. The symbol is a real groove: a dark inner
 * wall, a lit lower lip, and (glow > 0) a faint ember in its bed.
 *
 *   opts.light   [x, y] screen direction TOWARDS the sun (default [-0.8, -0.5]: up and left)
 *   opts.elev    sin of the sun's altitude (0.2 grazing .. 0.9 high), default 0.5
 *   opts.seed    int; every random choice of the stone comes from it
 *   opts.symbol  'crescent' (crescent and V-rod) | 'discs' (double disc and Z-rod) | 'none'
 *   opts.glow    0..1 warm sunset on the stone: ember rim, ember in the incisions
 *   opts.width   base width / height (default 0.46)
 *   opts.taper   [min, max] head width / foot width (default [0.66, 0.8])
 *   opts.tone    -0.2..0.3 exposure: lifts or lowers the whole stone (a pale stone stands off a bright ground)
 *   opts.tilt    0..1 seen from above: the flat top of the slab is shown as a lit cap (the summit view)
 *   opts.shadow  { sx, sy, dens, layerMax } cast shadow on the ground, in screen px per px of height (dithered, soft)
 *   opts.layer   raster layer id written with every stone pixel
 *   opts.lichen  0..2 amount of lichen (default 1);  opts.moss 0..1 (default 1)
 *   opts.outline 0..1 a thin dark edge where the stone stands against a bright ground, so the sunward rim never dissolves into it
 * No crosses: the symbols are a crescent with an arrow standing in its mouth, and two discs with a Z-rod beside a spear; no stroke
 * crosses another and none meets another at a right angle (SYMBOL_STROKES is the data; tests/title.test.js checks it).
 */
import { PAL_U32 as C } from './palette.js';
import { mulberry32, hash2f } from '../core/rng.js';
import { bay, clamp, vnoise, fbm, smooth, lift, sink } from './artkit.js';

// colour ramps, dark -> light. Rock is grey-brown gneiss; stained patches and bands read off the brown, the purple-grey or (in the last sun) the warm ramp.
const ROCK = [C.ink, C.blood, C.contourIdx, C.rock, C.contour, C.rock, C.paper2];          // grey-brown gneiss, warm in the shadows
const ROCK_COOL = [C.ink, C.blood, C.heather, C.rock, C.rock, C.paper2];
const ROCK_GLOW = [C.ink, C.blood, C.contourIdx, C.contour, C.lamp, C.flame];   // the same stone in the last of the sun
const ROCK_BROWN = [C.ink, C.blood, C.rust, C.contour, C.contour, C.paper2];      // an iron-stained band
const LICHEN = [
  [C.contourIdx, C.rock, C.paper2, C.paper],             // bone
  [C.blood, C.contourIdx, C.contour, C.lamp],            // ochre
  [C.ink, C.woodDark, C.rock, C.bog],                    // pale green-grey
  [C.ink, C.blood, C.rust, C.contour],                   // rust crust
];
const MOSS = [C.ink, C.night, C.woodDark, C.woodDark];

function ramp(r, v, x, y) {
  const pos = clamp(v, 0, 1) * (r.length - 1);
  const i = Math.min(r.length - 2, Math.floor(pos));
  return bay(x, y) < pos - i ? r[i + 1] : r[i];
}

// ---------------------------------------------------------------- symbols (stroke data, distance fields in symbol units)
const dseg = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
};
const darc = (px, py, cx, cy, R, a0, a1) => {       // arc of a circle, angles in screen space (y down), a0 -> a1 clockwise on screen
  const a = Math.atan2(py - cy, px - cx);
  const span = a1 - a0;
  let k = a - a0;
  k = ((k % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (k <= span) return Math.abs(Math.hypot(px - cx, py - cy) - R);
  const e0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)], e1 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
  return Math.min(Math.hypot(px - e0[0], py - e0[1]), Math.hypot(px - e1[0], py - e1[1]));
};
const D2R = Math.PI / 180;
const rot = (vx, vy, deg) => { const c = Math.cos(deg * D2R), s = Math.sin(deg * D2R); return [vx * c - vy * s, vx * s + vy * c]; };
/** Two barbs at b swept back towards a at +-28 degrees: the head of a spear or the feathers of an arrow, never a cross. */
function barbs(a, b, len = 0.55) {
  const dx = a[0] - b[0], dy = a[1] - b[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const p = rot(ux, uy, 28), q = rot(ux, uy, -28);
  return [[b[0], b[1], b[0] + p[0] * len, b[1] + p[1] * len], [b[0], b[1], b[0] + q[0] * len, b[1] + q[1] * len]];
}
const spear = (a, b, len) => [[a[0], a[1], b[0], b[1]], ...barbs(a, b, len)];
// crescent, horns up: outer circle R1 (centre 0,0), inner circle R2 (centre 0,-0.5); they meet at the horns
const TIP = Math.atan2(-0.5275, 0.85);
/**
 * The two Pictish symbols as data. segs [x0,y0,x1,y1], arcs [cx,cy,R,a0,a1], circles [cx,cy,R]; y runs down the face.
 * Strokes meet end to end at acute angles or not at all: nothing crosses, nothing is a T or a plus, so no cross can be read in them.
 */
export const SYMBOL_STROKES = {
  crescent: {
    w: 2.4, h: 3.4, anchor: [-0.53, 0.58], scale: 0.105, cx: 0.3,
    arcs: [[0, 0, 1, TIP, Math.PI - TIP], [0, -0.5, 0.85, -1.9 * D2R, 181.9 * D2R]],
    circles: [],
    // the V-rod: an arrow standing in the mouth of the crescent, its head and two pairs of feathers all V-shaped
    segs: [...spear([1.5, -1.95], [-0.3, -0.05], 0.7), ...barbs([-0.3, -0.05], [1.5 - 1.8 * 0.2, -1.95 + 1.9 * 0.2], 0.5), ...barbs([-0.3, -0.05], [1.5 - 1.8 * 0.38, -1.95 + 1.9 * 0.38], 0.5)],   // leaning, so the pair never reads as an anchor
  },
  discs: {
    w: 2.8, h: 4.2, anchor: [0, 0.42], scale: 0.1, cx: 0,
    arcs: [],
    circles: [[-0.85, 0, 0.6], [0.85, 0, 0.6], [-0.85, 0, 0.3], [0.85, 0, 0.3]],
    // the double disc and its bar; above them the Z-rod: a Z with a spear beside it
    segs: [[-0.25, 0, 0.25, 0], [-0.8, -2.9, 0.5, -2.9], [0.5, -2.9, -0.55, -1.6], [-0.55, -1.6, 0.8, -1.6], ...spear([1.2, -1.2], [1.4, -3.2], 0.5)],
  },
};
const SYMBOLS = Object.fromEntries(Object.entries(SYMBOL_STROKES).map(([k, g]) => [k, {
  w: g.w, h: g.h, anchor: g.anchor, scale: g.scale, cx: g.cx,
  d: (x, y) => {
    let m = 9;
    for (const [cx, cy, R, a0, a1] of g.arcs) m = Math.min(m, darc(x, y, cx, cy, R, a0, a1));
    for (const [cx, cy, R] of g.circles) m = Math.min(m, Math.abs(Math.hypot(x - cx, y - cy) - R));
    for (const [ax, ay, bx, by] of g.segs) m = Math.min(m, dseg(x, y, ax, ay, bx, by));
    return m;
  },
}]));
export const STONE_SYMBOLS = Object.freeze(['crescent', 'discs', 'none']);

// ---------------------------------------------------------------- the stone
export function paintStandingStone(r, cx, baseY, h, opts = {}) {
  const o = { light: [-0.8, -0.5], elev: 0.42, seed: 1, symbol: 'crescent', glow: 0.5, width: 0.46, tilt: 0, lichen: 1, moss: 1, tone: 0, outline: 1, ...opts };
  cx = Math.round(cx); baseY = Math.round(baseY); h = Math.max(24, Math.round(h));
  const rng = mulberry32((o.seed | 0) * 7919 + 12345);
  const seed = (o.seed | 0) * 131 + 7;
  const lay = o.layer;
  const hb = h * o.width * 0.5;                                        // half width at the foot
  const tw = hb * ((o.taper ? o.taper[0] : 0.66) + rng() * (o.taper ? o.taper[1] - o.taper[0] : 0.14));                                // half width near the head
  const lean = (rng() - 0.5) * hb * 0.7;
  // ---- light
  const ll = Math.hypot(o.light[0], o.light[1]) || 1;
  const lx2 = o.light[0] / ll, ly2 = -o.light[1] / ll;                 // 2D unit towards the sun, y up (local)
  const sinE = clamp(o.elev, 0.1, 0.95), cosE = Math.sqrt(1 - sinE * sinE);
  const Lx = lx2 * cosE, Ly = ly2 * cosE, Lz = sinE;
  const tanE = sinE / cosE;
  const glow = clamp(o.glow, 0, 1);

  // ---- outline: per-row edges, chips, a faceted broken head
  const HM = h + 8;
  const eL = new Float32Array(HM + 1), eR = new Float32Array(HM + 1), cc = new Float32Array(HM + 1), hw = new Float32Array(HM + 1);
  const chips = [];
  for (let i = 0; i < 5 + Math.round(h / 45); i++) chips.push({ y0: (0.05 + rng() * 0.92) * h, hh: (0.018 + rng() * 0.045) * h, d: (0.04 + rng() * 0.11) * hb, side: rng() < 0.5 ? 0 : 1, flip: rng() < 0.5 });
  const n1 = (y, sc, s) => vnoise(y / sc, 0.37, seed + s) - 0.5;
  for (let y = 0; y <= HM; y++) {
    const t = Math.min(1, y / h);
    hw[y] = hb + (tw - hb) * Math.pow(t, 0.8);
    cc[y] = lean * Math.pow(t, 1.5) + n1(y, 0.45 * h, 9) * hb * 0.22;
    let a = n1(y, 0.28 * h, 1) * hb * 0.38 + n1(y, 0.09 * h, 2) * hb * 0.2 + n1(y, 3.2, 3) * hb * 0.08;
    let b = n1(y, 0.28 * h, 4) * hb * 0.38 + n1(y, 0.09 * h, 5) * hb * 0.2 + n1(y, 3.2, 6) * hb * 0.08;
    for (const c of chips) {
      const d = (y - c.y0) / c.hh;
      if (d <= -1 || d >= 1) continue;
      const v = (c.flip ? d : -d) < 0 ? 1 + (c.flip ? d : -d) : Math.max(0, 1 - Math.abs(d) * 2.4);
      if (c.side === 0) a += c.d * v; else b += c.d * v;
    }
    eL[y] = a; eR[y] = b;
  }
  // the head: a few facets, tilted, with a broken corner
  const tilt = (rng() - 0.5) * 1.3;
  const knots = [-1.6, -0.8, -0.05, 0.65, 1.6].map((tt) => ({ t: tt, v: -(0.01 + rng() * 0.045) * h - Math.abs(tt) * Math.abs(tt) * 0.028 * h + tilt * tt * 0.05 * h }));
  const topAt = (lx) => {
    const t = (lx - cc[Math.round(h)]) / Math.max(4, tw);
    const k = clamp(t, -1.6, 1.6);
    let i = 0; while (i < 3 && k > knots[i + 1].t) i++;
    const f = (k - knots[i].t) / (knots[i + 1].t - knots[i].t);
    return h + knots[i].v + (knots[i + 1].v - knots[i].v) * f + (vnoise(lx * 0.4, 3.3, seed + 20) - 0.5) * 2.4;
  };
  const capMax = o.tilt > 0 ? Math.round(o.tilt * hb * 0.6) + 5 : 0;
  const GW = Math.ceil(hb * 2.8) + 14, OX = GW >> 1, OY = 5, GH = HM + OY + capMax + 6;
  const idx = (lx, ly) => (ly + OY) * GW + lx + OX;
  const inGrid = (lx, ly) => lx > -OX && lx < OX - 1 && ly > -OY && ly < GH - OY - 1;
  const kind = new Uint8Array(GW * GH);                                // 0 outside, 1 body, 2 cap
  const edgeAt = new Float32Array(GW * GH);                            // u across the face
  let minX = 1e9, maxX = -1e9, maxY = 0;
  for (let ly = -2; ly <= HM; ly++) {
    const y = Math.max(0, ly);
    const Lx0 = cc[y] - hw[y] - eL[y], Rx0 = cc[y] + hw[y] + eR[y];
    for (let lx = Math.floor(Lx0); lx <= Math.ceil(Rx0); lx++) {
      if (lx < Lx0 || lx > Rx0 || !inGrid(lx, ly)) continue;
      if (ly < 0 && (vnoise(lx * 0.3, 1.1, seed + 30) - 0.5) * 3 <= ly) continue;       // ragged buried foot
      if (ly >= topAt(lx)) continue;
      kind[idx(lx, ly)] = 1;
      edgeAt[idx(lx, ly)] = (lx - (Lx0 + Rx0) / 2) / ((Rx0 - Lx0) / 2 || 1);
    }
  }
  // the cap (seen from above): the head's outline swept up and a little sideways, a sheared top face
  if (capMax) {
    const depth = Math.max(3, Math.round(o.tilt * hb * 0.6)), shear = 0.32 * (rng() < 0.5 ? 1 : -1);
    const tops = new Int16Array(GW).fill(-1);
    for (let lx = -OX + 2; lx < OX - 2; lx++) for (let ly = HM; ly >= 0; ly--) if (kind[idx(lx, ly)] === 1) { tops[lx + OX] = ly; break; }
    for (let k = 1; k <= depth; k++) for (let lx = -OX + 2; lx < OX - 2; lx++) {
      const topY = tops[lx + OX];
      if (topY < h * 0.5) continue;
      const nx = lx + Math.round(k * shear), ny = topY + k;
      if (inGrid(nx, ny) && !kind[idx(nx, ny)]) { kind[idx(nx, ny)] = 2; edgeAt[idx(nx, ny)] = clamp((nx - cc[Math.round(h)]) / Math.max(4, tw * 1.3), -1, 1); }
    }
  }
  for (let ly = -OY + 1; ly < GH - OY - 1; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) if (kind[idx(lx, ly)]) { if (lx < minX) minX = lx; if (lx > maxX) maxX = lx; if (ly > maxY) maxY = ly; }

  // ---- layers (strata)
  const layerB = [];                                                    // boundaries in warped-s space
  { let s = -0.2 * h; while (s < h * 1.3 + capMax) { layerB.push(s); s += h * (0.022 + 0.05 * Math.pow(rng(), 1.5)); } }
  const lOff = layerB.map(() => (rng() - 0.5) * 2.0), lSlope = layerB.map(() => (rng() - 0.5) * 0.2);
  const lTone = layerB.map(() => (rng() - 0.5) * 0.09);
  const lType = layerB.map(() => { const q = rng(); return q < 0.7 ? 0 : q < 0.87 ? 1 : 2; });   // plain, iron-stained, bluer hard band
  const lSoft = layerB.map(() => rng() < 0.3 ? 1 : 0);
  const theta = (0.18 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1);                      // the bedding dips across the face: folded gneiss, not courses of brick
  const sOf = (lx, ly) => ly + theta * lx + (fbm(lx * 0.028, ly * 0.024, seed + 40, 2) - 0.5) * 0.24 * h + (vnoise(lx * 0.1, ly * 0.05, seed + 41) - 0.5) * 0.03 * h;
  const layerOf = (s) => { let lo = 0, hi = layerB.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (layerB[m] <= s) lo = m; else hi = m - 1; } return lo; };

  // ---- cracks
  const crack = new Uint8Array(GW * GH);
  const nCracks = 2 + Math.round(h / 70);
  for (let c = 0; c < nCracks; c++) {
    let x, y;
    if (rng() < 0.55) { y = h * (0.72 + rng() * 0.25); const yy = Math.round(clamp(y, 0, HM)); x = cc[yy] + (rng() - 0.5) * hw[yy] * 1.4; }
    else { y = rng() * h * 0.7 + 0.15 * h; const side = rng() < 0.5 ? -1 : 1; const yy = Math.round(clamp(y, 0, HM)); x = cc[yy] + side * hw[yy] * 0.92; }
    let ang = Math.PI / 2 + (rng() - 0.5) * 0.8 + (rng() < 0.3 ? (rng() < 0.5 ? 0.9 : -0.9) : 0);   // mostly down, sometimes along the bedding
    const len = h * (0.08 + rng() * 0.24);
    for (let s = 0; s < len; s++) {
      ang += (rng() - 0.5) * 0.45;
      ang = clamp(ang, 0.3, Math.PI - 0.3);
      x += Math.cos(ang) * 0.9 * (rng() < 0.12 ? 2 : 1); y -= Math.sin(ang) * 0.9;
      const lxp = Math.round(x), lyp = Math.round(y);
      if (inGrid(lxp, lyp) && kind[idx(lxp, lyp)] === 1) crack[idx(lxp, lyp)] = 1;
      if (s > len * 0.5 && rng() < 0.02) break;
    }
  }

  // ---- height map of the face: a slab with rounded arrises, strata stepping in and out, pits, cracks
  const z = new Float32Array(GW * GH);
  const depth = hb * 0.9;
  const u0 = (rng() - 0.5) * 0.4;
  const layerIdx = new Int16Array(GW * GH);
  const shoulder = 0.2 + rng() * 0.12;
  for (let ly = -OY + 1; ly < GH - OY - 1; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) {
    const i = idx(lx, ly);
    if (!kind[i]) continue;
    const u = edgeAt[i];
    let zz;
    if (kind[i] === 2) zz = depth * 0.5 + (vnoise(lx * 0.4, ly * 0.4, seed + 50) - 0.5) * 2.2;
    else {
      const au = Math.abs(u);
      zz = depth * Math.pow(clamp((1 - au) / shoulder, 0, 1), 0.7) * (1 - 0.2 * (u - u0) * (u - u0));
      const s = sOf(lx, ly), k = layerOf(s);
      layerIdx[i] = k;
      zz += lOff[k] * 1.9 + lSlope[k] * (s - layerB[k]) * 0.6 * (1 - lSoft[k] * 0.4);
      zz += (fbm(lx * 0.07, ly * 0.07, seed + 51, 2) - 0.5) * 3.0;
      const cl = vnoise(lx * 0.09, ly * 0.09, seed + 53);
      if (hash2f(lx, ly, seed + 54) < 0.02 * smooth(0.45, 0.85, cl) * (1 + lSoft[k])) zz -= 1.2;          // pits, clustered
      if (crack[i]) zz -= 2.4;
    }
    z[i] = zz;
  }
  const zat = (lx, ly) => (inGrid(lx, ly) ? z[idx(lx, ly)] : 0);

  // ---- symbol on the face
  const sym = SYMBOLS[o.symbol];
  let symInfo = null;
  const G = new Uint8Array(GW * GH), Gd = new Float32Array(GW * GH).fill(9), Gnear = new Uint8Array(GW * GH);
  if (sym) {
    const S = h * sym.scale;                                          // symbol unit in px
    const scx = cc[Math.round(h * sym.anchor[1])] + hb * 0.02 - sym.cx * S, scy = h * sym.anchor[1] + sym.anchor[0] * S;
    const hwG = Math.max(1.2, S * 0.082);
    const ang = (rng() - 0.5) * 0.1 + (o.symbol === 'crescent' ? -0.22 : 0);   // a crescent a little askew is never a smile
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const R = Math.ceil(Math.max(sym.w, sym.h) * S) + 4;
    for (let ly = Math.round(scy - R); ly <= scy + R; ly++) for (let lx = Math.round(scx - R); lx <= scx + R; lx++) {
      if (!inGrid(lx, ly) || kind[idx(lx, ly)] !== 1) continue;
      const dx = (lx - scx) / S, dy = (scy - ly) / S;                  // y down the face
      const wob = (vnoise(lx * 0.25, ly * 0.25, seed + 60) - 0.5) * 0.09;
      const px = dx * ca + dy * sa + wob, py = -dx * sa + dy * ca + wob;
      const d = sym.d(px, py) * S;
      if (d < hwG) { G[idx(lx, ly)] = 1; Gd[idx(lx, ly)] = d / hwG; }
    }
    for (let ly = -OY + 3; ly < GH - OY - 3; ly++) for (let lx = -OX + 3; lx < OX - 3; lx++) {
      if (!G[idx(lx, ly)]) continue;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) Gnear[idx(lx + ox, ly + oy)] = 1;
    }
    symInfo = { x: cx + Math.round(scx), y: baseY - Math.round(scy), S, kind: o.symbol };
  }

  // ---- lichen: small crusts and map-lichen patches that lie along the strata, crowded on the head and the sunward side
  const lich = new Uint8Array(GW * GH), lichT = new Float32Array(GW * GH);
  if (o.lichen > 0) {
    const scale = Math.max(0.7, h / 130);
    const nClusters = Math.round((6 + h / 12) * Math.min(1.6, o.lichen));
    for (let c = 0; c < nClusters; c++) {
      const cy = h * (0.12 + 0.85 * Math.pow(rng(), 0.8)), yy = Math.round(clamp(cy, 0, HM));
      const ccx = cc[yy] + (rng() - 0.5) * hw[yy] * 1.7;
      const q = rng();
      const type = q < 0.45 ? 0 : q < 0.7 ? 1 : q < 0.9 ? 2 : 3;
      const n = 2 + Math.floor(rng() * 8 * o.lichen);
      const spread = (3 + rng() * 8) * scale;
      for (let p = 0; p < n; p++) {
        const px = ccx + (rng() + rng() + rng() - 1.5) * spread * 1.8, py = cy + (rng() + rng() - 1) * spread * 0.8;
        const big = rng() < 0.07;
        const a = (0.7 + rng() * 1.5 + (big ? 1.4 : 0)) * scale, b = a * (0.55 + rng() * 0.45);
        const rot = Math.atan(theta) + (rng() - 0.5) * 0.7;
        const cr = Math.cos(rot), sr = Math.sin(rot);
        const ty = rng() < 0.15 ? (type + 1) % 4 : type;
        const rr = Math.ceil(a) + 2, ps = (rng() * 1000) | 0;
        for (let ly = Math.round(py - rr); ly <= py + rr; ly++) for (let lx = Math.round(px - rr); lx <= px + rr; lx++) {
          if (!inGrid(lx, ly) || kind[idx(lx, ly)] !== 1 || crack[idx(lx, ly)] || Gnear[idx(lx, ly)]) continue;
          const dx = lx - px, dy = ly - py;
          const u = (dx * cr + dy * sr) / a, v = (-dx * sr + dy * cr) / b;
          const d = Math.hypot(u, v);
          const ang = Math.atan2(v, u);
          const lim = 1 + (vnoise(Math.cos(ang) * 1.8 + ps, Math.sin(ang) * 1.8, seed + 70) - 0.5) * 0.7;
          if (d > lim) continue;
          lich[idx(lx, ly)] = ty + 1;
          lichT[idx(lx, ly)] = d / lim;
        }
      }
    }
  }

  // ---- shadow on the ground first (the stone is painted over it)
  if (o.shadow) paintCastShadow(r, cx, baseY, h, { kind, GW, idx, minX, maxX, ...o.shadow }, lay);

  // ---- per pixel
  const shadowOf = (lx, ly, zz) => {                                  // ledges cast short shadows away from the sun
    for (let k = 1; k <= 7; k++) {
      const sx = Math.round(lx + lx2 * k), sy = Math.round(ly + ly2 * k);
      if (!inGrid(sx, sy)) break;
      if (kind[idx(sx, sy)] && z[idx(sx, sy)] > zz + k * tanE * 0.9) return 1 - k / 9;
    }
    return 0;
  };
  const out = (lx, ly, c) => r.px(cx + lx, baseY - ly, c, lay);
  const outside = (lx, ly) => !inGrid(lx, ly) || !kind[idx(lx, ly)];
  const T = new Float32Array(GW * GH);
  const sunSide = lx2 < 0 ? -1 : 1;
  for (let ly = -OY + 1; ly < GH - OY - 1; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) {
    const i = idx(lx, ly);
    if (!kind[i]) continue;
    const X = cx + lx, Y = baseY - ly;
    const zz = z[i];
    // normal from the map; outside the stone the map is 0, so the rim faces outwards
    const dzx = (zat(lx + 1, ly) - zat(lx - 1, ly)) * 0.5, dzy = (zat(lx, ly + 1) - zat(lx, ly - 1)) * 0.5;
    const nl = Math.hypot(dzx, dzy, 1);
    let lam = clamp((-dzx * Lx - dzy * Ly + Lz) / nl, 0, 1);
    if (kind[i] === 2) lam = 0.62 + 0.3 * (vnoise(lx * 0.4, ly * 0.4, seed + 55) - 0.3);
    const amb = 0.19 + 0.05 * glow;                                           // sky and ground bounce keep the shadow side alive
    const k = layerIdx[i];
    let t = amb + (1 - amb) * 0.72 * lam;
    if (kind[i] === 1) {
      t += 0.3 * sunSide * edgeAt[i] * Math.max(0.6, Math.abs(lx2));          // the soft gradient across the face: lit edge to deep shadow
      t += lTone[k] + (fbm(lx * 0.045, ly * 0.045, seed + 56, 2) - 0.5) * 0.22;
      const run = smooth(0.6, 0.85, vnoise(lx * 0.5, ly * 0.035, seed + 61));  // rain runnels
      t *= 1 - 0.28 * run;
    }
    t *= 1 - 0.4 * Math.exp(-Math.max(0, ly) / (0.06 * h));                   // dark at the foot
    t += 0.06 * clamp(ly / h, 0, 1);
    if (kind[i] === 1) t *= 1 - 0.55 * shadowOf(lx, ly, zz);
    if (crack[i]) t *= 0.3;
    if (kind[i] === 1) {                                                      // the bedding plane: a dark joint (broken in places), a lit lip below it
      const sb = sOf(lx, ly) - layerB[k];
      const brk = vnoise(lx * 0.3, ly * 0.3, seed + 63);
      if (sb < 0.9 && brk > 0.3) t *= 0.55;
      else if (sb < 1.9 && brk > 0.4) t += 0.12;
    }
    t = clamp(t + o.tone, 0, 1);
    T[i] = t;
    // iron stain, or a harder purple-grey band: whole patches, not speckle
    const stain = vnoise(lx * 0.06, ly * 0.07, seed + 58);
    const ty = lType[k];
    let rp = ROCK;
    if (ty === 1 && stain > 0.35 || stain > 0.8) rp = ROCK_BROWN; else if (ty === 2 && stain < 0.45) rp = ROCK_COOL;
    // the sunset on the lit face: coherent warm regions along the sunward side
    if (glow > 0 && glow * smooth(0.4, 0.8, t) > 0.3 + 0.25 * vnoise(lx * 0.09, ly * 0.09, seed + 64)) rp = ROCK_GLOW;
    let col = ramp(rp, t, X, Y);
    if (kind[i] === 2) col = ramp(ROCK_BROWN, clamp(t + 0.06, 0, 1), X, Y);
    // glints of mica / quartz in the lit face
    if (t > 0.5 && hash2f(lx, ly, seed + 59) < 0.004) col = C.paper2;
    // lichen
    const lc = lich[i];
    if (lc) {
      const ring = lichT[i];
      const lr = LICHEN[lc - 1];
      const lt = clamp(t * 1.15 + 0.12 - (ring < 0.28 ? 0.1 : 0) + (ring > 0.78 ? -0.12 : 0), 0, 1);
      col = ramp(lr, lt, X, Y);
      if (lc === 3 && ring > 0.8) col = C.ink;                        // map-lichen's black edge
    }
    out(lx, ly, col);
  }

  // ---- symbol: the groove, its wall and lip, the glow
  const embers = [];                                                    // the pixels that glow, for a cheap pulse in the caller's animation
  if (sym) {
    const sx = Math.round(lx2 * 1.4), sy = Math.round(ly2 * 1.4);
    const farWall = (lx, ly) => !inGrid(lx + sx, ly + sy) || !G[idx(lx + sx, ly + sy)];      // groove ends one step towards the sun: this pixel is on the wall that faces away
    const sunWall = (lx, ly) => !inGrid(lx - sx, ly - sy) || !G[idx(lx - sx, ly - sy)];
    for (let ly = -OY + 1; ly < GH - OY - 1; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) {
      const i = idx(lx, ly);
      if (!kind[i]) continue;
      const X = cx + lx, Y = baseY - ly;
      if (G[i]) {
        const darkWall = farWall(lx, ly), litWall = sunWall(lx, ly);
        let c = C.ink;
        if (Gd[i] < 0.4 && glow > 0.1) embers.push([X, Y, (X * 7 + Y * 13) % 17]);
        if (Gd[i] < 0.4) c = glow < 0.15 ? C.blood : hash2f(lx, ly, seed + 65) < glow * 0.25 ? C.lamp : glow > 0.45 ? C.ember : bay(X, Y) < glow * 2 ? C.ember : C.rust;     // the ember in the bed
        else if (litWall && !darkWall) c = C.blood;
        out(lx, ly, c);
      } else if (Gnear[i]) {
        let dmin = 9;
        for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) if (inGrid(lx + ox, ly + oy) && G[idx(lx + ox, ly + oy)]) dmin = Math.min(dmin, Math.hypot(ox, oy));
        // the lip: a lit rim just outside the groove, on the side away from the sun
        const lipSide = inGrid(lx - sx, ly - sy) && G[idx(lx - sx, ly - sy)];
        if (lipSide) out(lx, ly, ramp([C.contourIdx, C.contour, C.rock, C.paper2], clamp(T[i] * 0.9 + 0.22, 0, 1), X, Y));
        else if (glow > 0.05 && dmin < 3.6 && bay(X + 1, Y + 2) < glow * 0.55 * (1 - dmin / 3.6)) out(lx, ly, lift(r.get(X, Y)));
      }
    }
  }

  // ---- edges: sunward rim in bone, flame, lamp, ember; ink on the far side
  const probe = (lx, ly, k) => outside(lx + Math.round(lx2 * k), ly + Math.round(ly2 * k)) || outside(lx + Math.sign(lx2) * Math.min(1, k - 1), ly + Math.sign(ly2) * Math.min(1, k - 1));
  for (let ly = -OY + 1; ly < GH - OY - 1; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) {
    const i = idx(lx, ly);
    if (!kind[i]) continue;
    const X = cx + lx, Y = baseY - ly;
    let rim = 0;
    if (probe(lx, ly, 1)) rim = 1; else if (probe(lx, ly, 2)) rim = 2; else if (probe(lx, ly, 3)) rim = 3;
    const farOut = outside(lx - Math.sign(lx2), ly - Math.sign(ly2)) && outside(lx - Math.round(lx2), ly - Math.round(ly2));
    if (rim && !G[i] && ly > 0) {
      const strength = (rim === 1 ? 0.95 : rim === 2 ? 0.6 : 0.3) * (0.5 + 0.5 * smooth(0.12, 0.6, T[i])) * (0.55 + 0.45 * glow);
      if (bay(X, Y) < strength) out(lx, ly, rim === 1 ? (bay(X + 4, Y + 1) < 0.3 ? C.paper : glow > 0.4 ? C.flame : C.paper2) : rim === 2 ? (glow > 0.25 ? C.lamp : C.contour) : C.ember);
    } else if (farOut && !rim) out(lx, ly, bay(X, Y) < 0.75 ? C.ink : C.blood);
    if (kind[i] === 2 && outside(lx, ly + 1)) out(lx, ly, bay(X, Y) < 0.6 ? C.paper2 : C.contour);
  }

  // ---- moss and turf at the foot, heather and grass spilling over it
  if (o.moss > 0) {
    const footH = 0.075 * h * o.moss;
    for (let ly = -2; ly <= footH + 3; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) {
      if (!inGrid(lx, ly) || kind[idx(lx, ly)] !== 1) continue;
      const lim = footH * (0.4 + 0.9 * vnoise(lx * 0.13, 2.2, seed + 80));
      const prob = clamp((lim - ly) / lim, 0, 1);
      if (prob <= 0 || hash2f(lx, ly, seed + 81) > prob * 1.1 + 0.04) continue;
      const X = cx + lx, Y = baseY - ly;
      const tm = clamp(T[idx(lx, ly)] * 1.2 + 0.08 + (hash2f(lx, ly, seed + 82) - 0.5) * 0.25, 0, 1);
      let col = ramp(MOSS, tm, X, Y);
      if (hash2f(lx, ly, seed + 83) < 0.16) col = ramp([C.ink, C.blood, C.rust, C.ember], tm, X, Y);   // bracken and heather in it
      out(lx, ly, col);
    }
    for (let lx = Math.floor(minX) - 5; lx <= maxX + 5; lx++) {
      const hh = hash2f(lx, 11, seed + 84);
      if (hh > 0.5) continue;
      const bh = 1 + Math.floor(hash2f(lx, 12, seed + 84) * 0.04 * h * (0.4 + o.moss));
      const lean2 = hash2f(lx, 13, seed + 84) < 0.5 ? -1 : 1;
      const q = hash2f(lx, 14, seed + 84);
      const base = q < 0.3 ? [C.ink, C.woodDark, C.woodDark, C.bog] : q < 0.65 ? [C.ink, C.blood, C.rust, C.ember] : [C.ink, C.contourIdx, C.contour];
      for (let k = 0; k < bh; k++) {
        const bx = lx + (k > 2 ? lean2 : 0), by = -1 + k;
        out(bx, by, ramp(base, clamp((k + 1) / bh * 0.8 + 0.1 + (lx2 < 0 ? (bx < 0 ? 0.12 : -0.1) : 0), 0, 1), cx + bx, baseY - by));
      }
    }
  }

  // ---- a thin dark edge round the stone wherever the ground behind it is bright (the sunward rim must not melt into the glow)
  if (o.outline > 0) {
    const BRIGHT_BG = new Set([C.lamp, C.flame, C.paper, C.paper2, C.ember, C.snow, C.rock]);
    for (let ly = -OY + 1; ly < GH - OY - 1; ly++) for (let lx = -OX + 1; lx < OX - 1; lx++) {
      if (kind[idx(lx, ly)] || ly < 0) continue;
      if (!(kind[idx(lx - 1, ly)] || kind[idx(lx + 1, ly)] || kind[idx(lx, ly - 1)] || kind[idx(lx, ly + 1)])) continue;
      const X = cx + lx, Y = baseY - ly, cur = r.get(X, Y);
      if (BRIGHT_BG.has(cur) && bay(X + 1, Y + 2) < 0.9 * o.outline) r.px(X, Y, cur === C.ember ? C.blood : C.rust, lay);
    }
  }

  // ---- bloom: a few dithered steps of the sunset light round the stone, on its sunward side
  if (glow > 0.2) {
    for (let ly = -OY; ly < GH - OY; ly++) for (let lx = -OX; lx < OX; lx++) {
      if (!inGrid(lx, ly) || kind[idx(lx, ly)]) continue;
      let d = 9;
      for (let oy = -3; oy <= 3 && d > 1; oy++) for (let ox = -3; ox <= 3; ox++) if (inGrid(lx + ox, ly + oy) && kind[idx(lx + ox, ly + oy)] && (ox * lx2 + oy * ly2) <= 0.2) d = Math.min(d, Math.hypot(ox, oy));
      if (d < 3.6) {
        const X = cx + lx, Y = baseY - ly;
        if (bay(X, Y) < glow * 0.5 * (1 - d / 3.6)) { const cur = r.get(X, Y); if (cur && cur !== C.lamp && cur !== C.flame && cur !== C.paper && cur !== C.paper2) r.px(X, Y, lift(cur), lay); }
      }
    }
  }

  const w = maxX - minX + 1;
  const mask = new Uint8Array(w * (maxY + 1));
  for (let ly = 0; ly <= maxY; ly++) for (let lx = minX; lx <= maxX; lx++) if (kind[idx(lx, ly)]) mask[ly * w + lx - minX] = 1;
  return { cx, baseY, h, hb, x0: cx + minX, y0: baseY - maxY, w, maskH: maxY + 1, mask, top: { x: cx + Math.round(cc[Math.round(h)]), y: baseY - Math.round(h) }, symbol: symInfo, embers, glow, minX, maxX };
}

/**
 * The shadow of a standing slab on the ground: every height of the stone is thrown to base + height * (sx, sy) in screen px.
 * Dithered in two steps (penumbra, umbra) so contours and grid show through, fading with distance.
 */
function paintCastShadow(r, cx, baseY, h, g, lay) {
  const { sx = 1, sy = 0.4, dens = 0.8, layerMax = 255, reach = 1 } = g;
  const rowLo = new Map(), rowHi = new Map(), rowK = new Map();
  const hMax = Math.round(h);
  for (let ly = 0; ly <= hMax; ly += 0.5) {
    const y = Math.round(baseY + ly * sy * reach);
    let lo = 1e9, hi = -1e9;
    for (let lx = g.minX; lx <= g.maxX; lx++) {
      const gi = g.idx(lx, Math.round(ly));
      if (!g.kind[gi]) continue;
      if (lx < lo) lo = lx; if (lx > hi) hi = lx;
    }
    if (lo > hi) continue;
    const a = Math.round(cx + lo + ly * sx * reach), b = Math.round(cx + hi + ly * sx * reach);
    if (!rowLo.has(y)) { rowLo.set(y, a); rowHi.set(y, b); rowK.set(y, ly / hMax); }
    else { rowLo.set(y, Math.min(rowLo.get(y), a)); rowHi.set(y, Math.max(rowHi.get(y), b)); rowK.set(y, Math.max(rowK.get(y), ly / hMax)); }
  }
  for (const [y, a] of rowLo) {
    const b = rowHi.get(y), kMax = rowK.get(y);
    for (let x = a; x <= b; x++) {
      if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
      if (r.lay[y * r.w + x] > layerMax) continue;
      const edge = Math.min(x - a, b - x) / 5;
      const along = Math.abs(sx) > 0.01 ? clamp((x - a) / Math.max(1, b - a), 0, 1) : 0;
      const s = dens * clamp(edge, 0.2, 1) * (1 - 0.55 * clamp(kMax * 0.55 + along * 0.45, 0, 1));
      const lvl = s * 3.4, whole = Math.floor(lvl);
      const n = whole + (lvl - whole > bay(x, y) ? 1 : 0);
      if (n <= 0) continue;
      let c = r.get(x, y);
      for (let k = 0; k < Math.min(4, n); k++) c = sink(c);
      r.px(x, y, c, undefined);
    }
  }
}
