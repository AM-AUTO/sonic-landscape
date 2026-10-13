/**
 * castlerigg: a ring of weathered stones at dusk. After the photograph of Castlerigg: a low horizon, big stones of different height and lean
 * in dark grass, the tallest tapering one a little right of centre, layered hills going pale into the mist, a luminous cloudy sky.
 * Greys + ONE ember accent: the sun low in the haze behind the right-hand ridge, a thin ember rim on the sunward edge of each stone, the
 * glowing incision on the hero stone. The hills are drawn as an Ordnance Survey sheet seen edge-on: stepped grey tints, hill-shading, fine
 * and index contours, a thin grid, a spot height or two.
 *
 * Also exports `shadedRock` (a lit, weathered stone of any shape from a rounded boulder to a flat slab) which shelter.js builds on.
 */
import {
  paintGreyGradient, makeMistBands, animMistBands, paintTitleLogo, animLogo, pulseEmbers, paintFootPlate, paintContourField, paintLichen, paintStrata,
  stoneMask, monoStone, GREY, liftG, sinkG, bay, clamp, smooth, mix, vnoise, fbm, rampAt, hash2f, mulberry32, C, fieldOf,
} from './kit.js';

export const layout = {};
export const levels = [];

// ===================================================================================== shaded rock
/**
 * One lit stone, painted per pixel from a little height map of its own.
 *   o.cx o.cy        centre;  o.rx o.ry  half extents (px) before rotation;  o.rot  radians, lean (positive = clockwise on screen)
 *   o.p              superellipse exponent: 2 = ellipse (boulder) .. 6+ = boxy slab
 *   o.planes         number of flat chips cut off the outline (angular, rock-like);  o.rough  boundary noise (0..1)
 *   o.bevel          px over which the edge rises to the face (large = dome, 2-3 = a slab with chamfered edges);  o.H  height of the face (px)
 *   o.bump           roughness of the face;  o.strata  amplitude of the bedding ledges (px), o.spacing their spacing, o.sang their angle
 *   o.light [x,y]    screen direction towards the sun;  o.elev  sin of its altitude;  o.tone  brightness of a face turned to the viewer (0..1 on GREY)
 *   o.contrast       how much the lighting moves the tone;  o.grain  stipple;  o.rim  0..1 pale rim on the sunward edge;  o.glow  0..1 ember rim
 *   o.lichen         density (0 off);  o.cracks  count;  o.base  darkens the foot (ground contact);  o.layer  raster layer
 *   o.shadow         { sx, sy, dens, layerMax, baseY } cast shadow on the ground (px per px of height above baseY)
 *   o.haze           0..1: lifts the finished stone towards fog (distance)
 * Returns { x, y, w, h, data (region mask), embers, top }.
 */
export function shadedRock(r, o) {
  const {
    cx, cy, rx, ry, seed = 1, rot = 0, p = 2.6, planes = 3, rough = 0.5, bevel = Math.min(rx, ry), H = Math.min(rx, ry) * 0.9, bump = 0.5, facet = 2.2,
    strata = 0, spacing = 7, sang = 0, light = [0.8, -0.55], elev = 0.45, tone = 0.45, contrast = 1, grain = 0.1, rim = 1, glow = 0,
    lichen = 0, cracks = 0, base = 0.2, layer, shadow, haze = 0, lichenTone = 0.5, lichenSize = [1.6, 4.5], clip,
  } = o;
  const ll = Math.hypot(light[0], light[1]) || 1, lx = light[0] / ll, ly = light[1] / ll;
  const cosE = Math.sqrt(1 - elev * elev), Lx = lx * cosE, Ly = ly * cosE, Lz = elev;
  const rr = Math.max(rx, ry) * 1.15 + 6;
  const x0 = Math.floor(cx - rr), y0 = Math.floor(cy - rr), W = Math.ceil(rr * 2) + 1, Hh = W;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const rng = mulberry32(seed * 977 + 13);
  const cuts = [];
  for (let k = 0; k < planes; k++) cuts.push({ a: rng() * Math.PI * 2, d: 0.62 + rng() * 0.3 });
  const inside = new Uint8Array(W * Hh), sdfIn = new Float32Array(W * Hh);
  const sFreq = 0.07 + rng() * 0.03;
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const X = x0 + i, Y = y0 + j, dx = X - cx, dy = Y - cy;
    const u = (dx * cr + dy * sr) / rx, v = (-dx * sr + dy * cr) / ry;                  // rock-local, normalised
    let f = 1 - Math.pow(Math.pow(Math.abs(u), p) + Math.pow(Math.abs(v), p), 1 / p);
    for (const c of cuts) f = Math.min(f, (c.d - (u * Math.cos(c.a) + v * Math.sin(c.a))) * 0.8);
    f += (fbm(X * sFreq * 0.55, Y * sFreq * 0.55, seed + 3, 2) - 0.5) * rough * 0.7;
    if (f > 0 && (!clip || clip(X, Y))) inside[j * W + i] = 1;
  }
  // distance to the outline (chamfer, 2 passes)
  for (let k = 0; k < sdfIn.length; k++) sdfIn[k] = inside[k] ? 1e4 : 0;
  for (let j = 1; j < Hh - 1; j++) for (let i = 1; i < W - 1; i++) { const k = j * W + i; if (!inside[k]) continue; sdfIn[k] = Math.min(sdfIn[k], sdfIn[k - 1] + 1, sdfIn[k - W] + 1, sdfIn[k - W - 1] + 1.414, sdfIn[k - W + 1] + 1.414); }
  for (let j = Hh - 2; j > 0; j--) for (let i = W - 2; i > 0; i--) { const k = j * W + i; if (!inside[k]) continue; sdfIn[k] = Math.min(sdfIn[k], sdfIn[k + 1] + 1, sdfIn[k + W] + 1, sdfIn[k + W + 1] + 1.414, sdfIn[k + W - 1] + 1.414); }
  let minX = W, maxX = -1, minY = Hh, maxY = -1;
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) if (inside[j * W + i]) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (j < minY) minY = j; if (j > maxY) maxY = j; }
  if (maxX < 0) return null;
  // cast shadow first
  if (shadow) {
    const { sx = -1.5, sy = 0.4, dens = 0.85, layerMax = 255, baseY = y0 + maxY } = shadow;
    const hMax = baseY - (y0 + minY);
    for (let hh = 0; hh <= hMax; hh += 0.5) {
      const j = Math.round(baseY - hh - y0);
      if (j < 0 || j >= Hh) continue;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < W; i++) if (inside[j * W + i]) { if (i < lo) lo = i; if (i > hi) hi = i; }
      if (lo > hi) continue;
      const Y = Math.round(baseY + hh * sy), a = Math.round(x0 + lo + hh * sx), b = Math.round(x0 + hi + hh * sx);
      for (let X = a; X <= b; X++) {
        if (X < 0 || Y < 0 || X >= r.w || Y >= r.h || r.lay[Y * r.w + X] > layerMax) continue;
        const edge = clamp(Math.min(X - a, b - X) / 5, 0.25, 1);
        const s = dens * edge * (1 - 0.6 * clamp(hh / Math.max(1, hMax), 0, 1));
        const lvl = s * 3.2, whole = Math.floor(lvl);
        const n = whole + (lvl - whole > bay(X, Y) ? 1 : 0);
        let c = r.get(X, Y);
        for (let q = 0; q < Math.min(4, n); q++) c = sinkG(c);
        r.px(X, Y, c);
      }
    }
  }
  // height map
  const Z = new Float32Array(W * Hh);
  const sc = Math.cos(sang + rot), ss = Math.sin(sang + rot);
  for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!inside[k]) continue;
    const X = x0 + i, Y = y0 + j;
    const t = clamp(sdfIn[k] / bevel, 0, 1);
    let z = H * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    const fq = fbm(X * 0.045, Y * 0.045, seed + 8, 2) * 3.2, fl = Math.floor(fq);
    z += (fl + smooth(0.3, 0.7, fq - fl)) * facet * (0.3 + 0.7 * t);                          // broad facets: planes with soft edges
    z += (fbm(X * 0.12, Y * 0.12, seed + 9, 2) - 0.5) * bump * 4 * (0.35 + 0.65 * t);
    if (strata > 0) {
      const s = ((X - cx) * -ss + (Y - cy) * sc) / spacing + vnoise(X * 0.05, Y * 0.05, seed + 21) * 1.5;   // distance across the bedding
      const fr = s - Math.floor(s), lay = Math.floor(s);
      z += strata * (Math.pow(fr, 2.2) + (hash2f(lay, 3, seed + 22) - 0.5) * 0.9);
    }
    Z[k] = z;
  }
  const embers = [];
  const region = new Uint8Array(W * Hh);
  const ox = new Float32Array(W * Hh);
  for (let j = 1; j < Hh - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = j * W + i;
    if (!inside[k]) continue;
    const X = x0 + i, Y = y0 + j;
    if (clip && !clip(X, Y)) continue;
    const zl = inside[k - 1] ? Z[k - 1] : 0, zr = inside[k + 1] ? Z[k + 1] : 0, zu = inside[k - W] ? Z[k - W] : 0, zd = inside[k + W] ? Z[k + W] : 0;
    const gx = (zr - zl) * 0.5, gy = (zd - zu) * 0.5;
    const nl = Math.hypot(gx, gy, 1), lam = (-gx * Lx - gy * Ly + Lz) / nl;
    let v = tone + contrast * (lam - Lz) * 0.95;
    v += (hash2f(X, Y, seed + 31) - 0.5) * grain;
    v -= base * smooth(0.45, 1, (Y - (cy - ry)) / (2 * ry)) * 0.9;                             // the foot sits in its own shadow
    const d = sdfIn[k];
    let c = rampAt(GREY, v, X, Y);
    const face = -gx * Lx - gy * Ly;                                                            // > 0: the edge faces the sun
    if (d < 4 && face > 0.15) {
      const s = clamp(face, 0, 1);
      if (d <= 1.5) { if (rim > 0 && bay(X + 1, Y) < rim * (0.45 + 0.5 * s)) c = bay(X + 4, Y + 2) < 0.4 ? C.snow : C.fog; }
      else if (d <= 2.6 && glow > 0 && bay(X + 2, Y + 3) < glow * (0.4 + 0.55 * s)) { embers.push([X, Y, (X * 7 + Y * 13) % 17, c]); c = C.ember; }
    }
    if (d <= 1.2 && face < 0.15) c = bay(X, Y) < 0.55 ? C.ink : sinkG(c);                       // the shadow edge closes dark
    ox[k] = lam;
    r.px(X, Y, c, layer);
    region[k] = 1;
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1, data = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) data[j * bw + i] = region[(minY + j) * W + minX + i];
  const mask = { x: x0 + minX, y: y0 + minY, w: bw, h: bh, data };
  if (strata > 0.01 && false) paintStrata(r, mask, seed, { layer });
  if (cracks > 0) paintStrata(r, mask, seed + 5, { spacing: [9999, 9999], slope: 0, warp: 0, tone: 0, joint: 0, cracks, crackLen: [8, Math.max(12, rx * 0.8)], light: [lx, ly], layer });
  if (lichen > 0) paintLichen(r, mask, seed + 7, { density: lichen, size: lichenSize, tone: lichenTone, light: [lx, ly], strata: sang + rot, layer, skip: (X, Y) => { const i = X - x0, j = Y - y0; return i < 0 || j < 0 || i >= W || j >= Hh || sdfIn[j * W + i] < 1.5; } });
  if (haze > 0) for (let j = minY; j <= maxY; j++) for (let i = minX; i <= maxX; i++) if (region[j * W + i]) {
    const X = x0 + i, Y = y0 + j;
    if (bay(X + 1, Y + 3) < haze) r.px(X, Y, liftG(r.get(X, Y)), layer);
    if (haze > 0.5 && bay(X + 5, Y + 1) < haze - 0.5) r.px(X, Y, liftG(r.get(X, Y)), layer);
  }
  return { x: mask.x, y: mask.y, w: bw, h: bh, data, mask, embers, top: y0 + minY };
}

// ===================================================================================== the screen (work in progress)
export function paint(r, spec, S) {
  paintGreyGradient(r, { x: 0, y: 0, w: r.w, h: 216 }, 0.9, 0.3, { seed: S.seed });
  paintTitleLogo(r, S);
}
export function anim(r, spec, S, t) {
  animLogo(r, S.logo, t);
}
