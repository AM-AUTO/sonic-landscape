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
  paintMistBands, makeMistBands, animMistBands, paintTitleLogo, animLogo, pulseEmbers, paintFootPlate, textClear, paintContourField, paintLichen, paintStrata,
  monoStone, paintDitherGlow, GREY, liftG, sinkG, bay, clamp, smooth, mix, vnoise, fbm, rampAt, hash2f, mulberry32, C,
} from './kit.js';

export const layout = { prompt: { x: 192, y: 177 }, colors: { subtitle: 'snow' } };
export const levels = [];

const ROCK_LICHEN = [[C.slate, C.ash, C.fog, C.snow], [C.char, C.slate, C.ash, C.rock], [C.slate, C.ash, C.rock, C.fog]];
// ===================================================================================== shaded rock
const POOL = { u8: [], f32: [] };
/** Reusable zeroed work buffers (a rock needs five grids; painting a hundred of them should not make garbage). */
function scratchU8(i, n) { let b = POOL.u8[i]; if (!b || b.length < n) b = POOL.u8[i] = new Uint8Array(Math.max(n, 4096)); b.fill(0, 0, n); return b; }
function scratchF32(i, n) { let b = POOL.f32[i]; if (!b || b.length < n) b = POOL.f32[i] = new Float32Array(Math.max(n, 4096)); b.fill(0, 0, n); return b; }
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
    lichen = 0, cracks = 0, base = 0.2, layer, shadow, haze = 0, lichenTone = 0.5, lichenSize = [1.6, 4.5], clip, flat = 0, taper = 1, shear = 0, streaks = 0,
  } = o;
  const ll = Math.hypot(light[0], light[1]) || 1, lx = light[0] / ll, ly = light[1] / ll;
  const cosE = Math.sqrt(1 - elev * elev), Lx = lx * cosE, Ly = ly * cosE, Lz = elev;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const ex = rx * (1 + Math.abs(shear)) * 1.12 + 6, ey = ry * 1.12 + 6;
  const hx = Math.abs(ex * cr) + Math.abs(ey * sr), hy = Math.abs(ex * sr) + Math.abs(ey * cr);
  const x0 = Math.floor(cx - hx), y0 = Math.floor(cy - hy), Wd = Math.ceil(hx * 2) + 1, Hd = Math.ceil(hy * 2) + 1;
  const rng = mulberry32(seed * 977 + 13);
  const cuts = [];
  for (let k = 0; k < planes; k++) cuts.push({ a: rng() * Math.PI * 2, d: 0.8 + rng() * 0.2 });
  for (const [a, d] of o.cuts || []) cuts.push({ a, d });
  const inside = scratchU8(0, Wd * Hd), sdfIn = scratchF32(0, Wd * Hd);
  const sFreq = 0.07 + rng() * 0.03;
  for (let j = 0; j < Hd; j++) for (let i = 0; i < Wd; i++) {
    const X = x0 + i, Y = y0 + j, dx = X - cx, dy = Y - cy;
    let u = (dx * cr + dy * sr) / rx, v = (-dx * sr + dy * cr) / ry;                    // rock-local, normalised
    u += shear * v;                                                                      // slanted ends: a parallelogram
    if (v > 0) v /= 1 - 0.3 * flat;                                                     // a flatter foot: it sits on the ground
    if (taper !== 1) u /= taper + (1 - taper) * clamp((v + 1) / 2, 0, 1);               // head narrower than the foot
    let f = 1 - Math.pow(Math.pow(Math.abs(u), p) + Math.pow(Math.abs(v), p), 1 / p);
    for (const c of cuts) f = Math.min(f, (c.d - (u * Math.cos(c.a) + v * Math.sin(c.a))) * 0.8);
    f += (fbm(X * sFreq * 0.55, Y * sFreq * 0.55, seed + 3, 2) - 0.5) * rough * 0.7;
    if (f > 0 && (!clip || clip(X, Y))) inside[j * Wd + i] = 1;
  }
  // distance to the outline (chamfer, 2 passes)
  for (let k = 0; k < sdfIn.length; k++) sdfIn[k] = inside[k] ? 1e4 : 0;
  for (let j = 1; j < Hd - 1; j++) for (let i = 1; i < Wd - 1; i++) { const k = j * Wd + i; if (!inside[k]) continue; sdfIn[k] = Math.min(sdfIn[k], sdfIn[k - 1] + 1, sdfIn[k - Wd] + 1, sdfIn[k - Wd - 1] + 1.414, sdfIn[k - Wd + 1] + 1.414); }
  for (let j = Hd - 2; j > 0; j--) for (let i = Wd - 2; i > 0; i--) { const k = j * Wd + i; if (!inside[k]) continue; sdfIn[k] = Math.min(sdfIn[k], sdfIn[k + 1] + 1, sdfIn[k + Wd] + 1, sdfIn[k + Wd + 1] + 1.414, sdfIn[k + Wd - 1] + 1.414); }
  let minX = Wd, maxX = -1, minY = Hd, maxY = -1;
  for (let j = 0; j < Hd; j++) for (let i = 0; i < Wd; i++) if (inside[j * Wd + i]) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (j < minY) minY = j; if (j > maxY) maxY = j; }
  if (maxX < 0) return null;
  // cast shadow first
  if (shadow) {
    const { sx = -1.5, sy = 0.4, dens = 0.85, layerMax = 255, baseY = y0 + maxY } = shadow;
    const hMax = baseY - (y0 + minY);
    for (let hh = 0; hh <= hMax; hh += 0.5) {
      const j = Math.round(baseY - hh - y0);
      if (j < 0 || j >= Hd) continue;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < Wd; i++) if (inside[j * Wd + i]) { if (i < lo) lo = i; if (i > hi) hi = i; }
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
  const Z = scratchF32(1, Wd * Hd);
  const sc = Math.cos(sang + rot), ss = Math.sin(sang + rot);
  for (let j = 0; j < Hd; j++) for (let i = 0; i < Wd; i++) {
    const k = j * Wd + i;
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
  const region = scratchU8(1, Wd * Hd);
  for (let j = 1; j < Hd - 1; j++) for (let i = 1; i < Wd - 1; i++) {
    const k = j * Wd + i;
    if (!inside[k]) continue;
    const X = x0 + i, Y = y0 + j;
    if (clip && !clip(X, Y)) continue;
    const zl = inside[k - 1] ? Z[k - 1] : 0, zr = inside[k + 1] ? Z[k + 1] : 0, zu = inside[k - Wd] ? Z[k - Wd] : 0, zd = inside[k + Wd] ? Z[k + Wd] : 0;
    const gx = (zr - zl) * 0.5, gy = (zd - zu) * 0.5;
    const nl = Math.hypot(gx, gy, 1), lam = (-gx * Lx - gy * Ly + Lz) / nl;
    const dl = lam - Lz;
    let v = tone + contrast * (dl > 0 ? dl * 0.95 : dl * 0.44);
    v += (hash2f(X, Y, seed + 31) - 0.5) * grain;
    if (streaks > 0) v += (vnoise(X * 0.28, Y * 0.035, seed + 33) - 0.5) * streaks;              // rain-washed streaks down the face
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
    r.px(X, Y, c, layer);
    region[k] = 1;
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1, data = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) data[j * bw + i] = region[(minY + j) * Wd + minX + i];
  const mask = { x: x0 + minX, y: y0 + minY, w: bw, h: bh, data };
  if (cracks > 0) paintStrata(r, mask, seed + 5, { spacing: [9999, 9999], slope: 0, warp: 0, tone: 0, joint: 0, cracks, crackLen: [8, Math.max(12, rx * 0.8)], light: [lx, ly], layer });
  if (lichen > 0) paintLichen(r, mask, seed + 7, { ramps: ROCK_LICHEN, rim: C.slate, density: lichen, size: lichenSize, tone: lichenTone, light: [lx, ly], strata: sang + rot, layer, skip: (X, Y) => { const i = X - x0, j = Y - y0; return i < 0 || j < 0 || i >= Wd || j >= Hd || sdfIn[j * Wd + i] < 1.5; } });
  if (haze > 0) for (let j = minY; j <= maxY; j++) for (let i = minX; i <= maxX; i++) if (region[j * Wd + i]) {
    const X = x0 + i, Y = y0 + j;
    if (bay(X + 1, Y + 3) < haze) r.px(X, Y, liftG(r.get(X, Y)), layer);
    if (haze > 0.5 && bay(X + 5, Y + 1) < haze - 0.5) r.px(X, Y, liftG(r.get(X, Y)), layer);
  }
  return { x: mask.x, y: mask.y, w: bw, h: bh, data, mask, embers, top: y0 + minY };
}

// ===================================================================================== sky, ridges, ground, grass
const W = 384, H = 216;
const HZ = 134;                                             // where the near moor meets the grass of the ring
const SUN = { x: 302, y: 113 };
const L_DIR = [0.9, -0.2];                                   // towards the sun (right, a little up: it is low behind the ridge)

/** The dusk sky: a grey gradient from deep at the top to luminous at the horizon `hz`, with soft cloud streaks and one glow (the sun, or a bright cloud). */
export function paintSky(r, seed, o = {}) {
  const { hz = HZ, glow = { x: SUN.x, y: SUN.y, amp: 0.24, sx: 80, sy: 34 }, v: [v0, v1, pw] = [0.27, 0.97, 1.45], cloud = 1, streakAng = 0.4 } = o;
  const q = (x, y) => { const u = (x + y * streakAng) * 0.0072, v = y * 0.05 + x * 0.0007; return fbm(u, v, seed + 1, 4) * 0.72 + vnoise(u * 3.3, v * 2.4, seed + 2) * 0.28; };
  for (let y = 0; y < hz + 10; y++) {
    const t = Math.min(1, y / hz), base = mix(v0, v1, Math.pow(t, pw));
    for (let x = 0; x < W; x++) {
      const qq = q(x, y), dq = q(x, y + 3) - q(x, y - 3);
      let v = base + cloud * ((qq - 0.5) * (0.28 + 0.5 * t) * (1 - 0.3 * t) + smooth(0.5, 0.64, qq) * 0.1 + clamp(-dq * 5, 0, 1) * 0.2 * (1 - 0.4 * t) - clamp(dq * 4, 0, 1) * 0.06);
      const dx = (x - glow.x) / glow.sx, dy = (y - glow.y) / glow.sy;
      v += glow.amp * Math.exp(-(dx * dx + dy * dy));
      v -= 0.2 * smooth(0.6, 1.25, Math.hypot((x - 192) / 215, (y - 30) / 120));
      r.px(x, y, rampAt(GREY, v, x, y), 0);
    }
  }
}

/** A ridge line: crest y for every x, from peaks (ridged noise). */
export function crestOf(seed, base, amp, freq, sharp = 1.1, extra) {
  const c = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const n = vnoise(x * freq, 3.7, seed), m = vnoise(x * freq * 2.7, 9.1, seed + 5);
    const pk = Math.pow(1 - Math.abs(2 * (n * 0.8 + m * 0.2) - 1), sharp);
    let y = base - amp * pk + (vnoise(x * 0.09, 1.3, seed + 8) - 0.5) * 3;
    if (extra) y = extra(x, y);
    c[x] = y;
  }
  return c;
}

export function paintRidge(r, crest, next, o) {
  const { tints, hz = 0, foot = 0.8, hazeV = 0.9, layer, seed, light = L_DIR, bottomY = HZ + 8, snow, grid = 0, spots = 0, index = 5, fine = true, shade = 0.3, relief = 30, avoid = [], metres = [380, 1080] } = o;
  const bot = new Float32Array(W);
  let top = H, bottom = 0;
  for (let x = 0; x < W; x++) {
    bot[x] = next ? Math.min(bottomY, Math.max(crest[x] + 3, next[x] + 7)) : bottomY;
    top = Math.min(top, crest[x]); bottom = Math.max(bottom, bot[x]);
  }
  top = Math.floor(top) - 1; bottom = Math.ceil(bottom);
  const depth = (x) => Math.max(5, bot[x] - crest[x]);
  const maxD = bottom - top;
  const nb = o.bands || Math.max(4, Math.round(maxD / (o.step || 5)));
  const hf = (x, y) => {
    const xi = clamp(x | 0, 0, W - 1), d = depth(xi), nrm = clamp((bot[xi] - y) / d, 0, 1.2), sc = (bottom - y) / maxD;
    const warp = (fbm(x * 0.03, y * 0.09, seed + 40, 3) - 0.5) * 0.35 + (vnoise(x * 0.07 + y * 0.03, y * 0.012, seed + 41) - 0.5) * 0.4;
    return clamp(mix(sc * 1.1, nrm * (d / maxD) * 1.1, 0.6) + warp * (d / maxD) * 0.9 + 0.05, 0, 1);
  };
  const rect = { x: 0, y: top, w: W, h: bottom - top };
  const res = paintContourField(r, hf, {
    rect, bands: nb, tints, seam: 0.7, light, shade, relief, fine: o.soft ? false : fine, index: o.soft ? 0 : index, grid, gridColor: C.slate, gridDens: 0.5, accent: o.accent == null ? null : o.accent,
    spots, metres, avoid, layer, skip: (x, y) => y < crest[x] || y > bot[x],
    haze: (x, y) => {
      const xi = clamp(x | 0, 0, W - 1), k = clamp((y - crest[xi]) / depth(xi), 0, 1);
      const m = clamp(hz + foot * Math.pow(k, 1.4) * (1 - hz), 0, 1);
      return snow ? Math.max(m, snow(x, y) * 0.9) : m;
    }, hazeV,
  });
  if (o.soft) softContours(r, res, rect, o.soft, layer);
  if (o.edge) for (let x = 0; x < W; x++) {                                    // a darker rim along the crest: the silhouette reads against the sky
    const y0 = Math.ceil(crest[x]);
    if (y0 >= bot[x]) continue;
    for (let k = 0; k < o.edge; k++) if (bay(x + k, y0 + k) < 0.85 - k * 0.3) r.px(x, y0 + k, sinkG(r.get(x, y0 + k)), layer);
  }
  return res;
}

/** Faint cartographic lines over a hazy ridge: dotted one-step lines at the band edges, a firmer one at every `every`th. */
export function softContours(r, res, rect, every, layer) {
  const { x: X0, y: Y0, w, h } = rect, B = res.band;
  for (let j = 1; j < h; j++) for (let i = 1; i < w; i++) {
    const k = j * w + i, b = B[k];
    if (b < 0) continue;
    const hi = Math.max(B[k - 1], B[k - w]);
    if (hi < 0 || b <= Math.min(B[k - 1] < 0 ? 99 : B[k - 1], B[k - w] < 0 ? 99 : B[k - w]) - 0) { /* keep: only the higher band carries the line */ }
    if (!(B[k - 1] >= 0 && B[k - 1] > b) && !(B[k - w] >= 0 && B[k - w] > b)) continue;
    const lv = Math.max(B[k - 1] >= 0 ? B[k - 1] : -1, B[k - w] >= 0 ? B[k - w] : -1), X = X0 + i, Y = Y0 + j, c = r.get(X, Y);
    if (lv % every === 0) r.px(X, Y, bay(X + 1, Y) < 0.85 ? sinkG(sinkG(c)) : sinkG(c), layer);
    else if (bay(X, Y + 1) < 0.5) r.px(X, Y, sinkG(c), layer);
  }
}

function paintGrass(r, seed) {
  // the sward: dark banded tints with the contours of its own gentle rise, brightest where the low sun skims it
  const hf = (x, y) => clamp(0.35 + (fbm(x * 0.012, y * 0.03, seed + 60, 3) - 0.5) * 0.9 - (y - HZ) * 0.0016, 0, 1);
  paintContourField(r, hf, {
    rect: { x: 0, y: HZ - 6, w: W, h: H - HZ + 6 }, bands: 11, tints: [0.03, 0.42], seam: 0.65, light: L_DIR, shade: 0.22, relief: 55, fine: true, index: 4,
    layer: 4, haze: (x, y) => 0.65 * (1 - smooth(HZ - 6, HZ + 40, y)) + 0.15 * smooth(HZ + 30, HZ + 90, y) * 0, hazeV: 0.62,
  });
}

/** Compress the contrast of a painted region towards mid grey (a stone far away): the form stays, the extremes go. */
export function flattenMask(r, m, k, layer) {
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    if (!m.data[j * m.w + i]) continue;
    const X = m.x + i, Y = m.y + j, c = r.get(X, Y), gi = GREY.indexOf(c);
    if (gi < 0) continue;
    r.px(X, Y, rampAt(GREY, mix(gi / 6, 0.34, k), X, Y), layer);
  }
}
/** Pale blade tips of a region, remembered so anim() can run a slow wave of wind glints through them (a pixel one step lighter as the wave passes). */
export function collectGlints(r, rect, seed, density, minGrey = 4) {
  const out = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const c = r.get(x, y), gi = GREY.indexOf(c);
    if (gi >= minGrey && gi < 6 && hash2f(x, y, seed) < density) out.push([y * r.w + x, x, y, liftG(c)]);
  }
  return out;
}
export function animGlints(r, list, t, speed = 1.3) {
  for (const [i, x, y, c1] of list) if (Math.sin(t * speed - x * 0.045 - y * 0.03) > 0.78) r.d[i] = c1;
}

/** A tuft of blades fanning from (x, y): dark at the root, lit at the tip, the tips on the sunward side glinting. */
export function tuft(r, x, y, hgt, seed, layer, o = {}) {
  const { lean = 0, tipTone = 0.7 } = o;
  const n = 4 + Math.round(hgt * 0.7);
  for (let b = 0; b < n; b++) {
    const h1 = hash2f(b, 1, seed), h2 = hash2f(b, 2, seed), h3 = hash2f(b, 3, seed);
    const len = hgt * (0.45 + 0.55 * h1), bx = x + (b - n / 2) * 0.7 + (h3 - 0.5), ang = (h2 - 0.5) * 1.5 + lean;
    for (let s = 0; s < len; s++) {
      const u = s / len, px = Math.round(bx + Math.sin(ang) * s * 0.6 + ang * s * s * 0.05), py = Math.round(y - s);
      const v = clamp(0.1 + u * tipTone + (ang > 0.2 ? 0.12 : 0) + (h1 - 0.5) * 0.2, 0, 1);
      const prev = r.get(px, py);
      if (!prev) continue;
      r.px(px, py, rampAt(GREY, v, px, py), layer);
    }
  }
}

// ===================================================================================== the screen
export function paint(r, spec, S) {
  const seed = S.seed;
  paintSky(r, seed);

  // the sun, low in the haze, half behind the right-hand ridge
  for (let y = SUN.y - 18; y <= SUN.y + 18; y++) for (let x = SUN.x - 18; x <= SUN.x + 18; x++) {
    const d = Math.hypot(x - SUN.x, (y - SUN.y) * 1.05);
    if (d < 4.2) r.px(x, y, C.ember, 9);
    else if (d < 22 && bay(x, y) < Math.pow(1 - (d - 4.2) / 17.8, 2.2) * 1.1) r.px(x, y, C.ember, 0);
  }

  // receding ridges, far to near, each one paler and hazier at its foot, where the mist lies; a glen opens towards the sun
  const gap = (x, k) => k * Math.exp(-Math.pow((x - SUN.x) / 46, 2));
  const behind = (c, prev, m) => { for (let x = 0; x < W; x++) c[x] = Math.max(c[x], prev[x] + m); return c; };
  const c0 = crestOf(seed + 11, 108, 24, 0.0105, 1.2, (x, y) => y + gap(x, 28));
  const c1 = behind(crestOf(seed + 21, 116, 13, 0.017, 1.1, (x, y) => y + gap(x, 20)), c0, 5);
  const c2 = behind(crestOf(seed + 31, 122, 8, 0.024, 1.0, (x, y) => y + gap(x, 12)), c1, 4);
  const c3 = behind(crestOf(seed + 41, 126, 9, 0.03, 1.0), c2, 3);
  for (let x = 0; x < W; x++) c3[x] = Math.min(c3[x], 124 - 34 * smooth(316, 384, x) - (vnoise(x * 0.05, 2, seed + 32) - 0.5) * 4 + (x > 330 ? 0 : 99 * 0));
  for (let x = 0; x < W; x++) c3[x] = x > 262 ? Math.min(c3[x], 126 - 34 * smooth(300, 384, x) + gap(x, 0)) : c3[x];
  const c4 = behind(crestOf(seed + 51, 131, 3, 0.04, 0.8), c3, 0);
  for (let x = 0; x < W; x++) c4[x] = Math.max(c4[x], Math.min(c3[x] + 3, 132));
  const noText = [{ x: 50, y: 4, w: 290, h: 62 }];
  paintRidge(r, c0, c1, { tints: [0.84, 0.64], hazeV: 0.92, layer: 1, step: 6, soft: 3, seed: seed + 100, grid: 48, spots: 1, shade: 0.2, avoid: noText, metres: [700, 1150] });
  paintRidge(r, c1, c2, { tints: [0.74, 0.52], hazeV: 0.88, layer: 2, step: 5, soft: 3, seed: seed + 200, grid: 48, spots: 1, shade: 0.28, avoid: noText, metres: [520, 900] });
  paintRidge(r, c2, c3, { tints: [0.62, 0.42], hazeV: 0.8, layer: 2, step: 4.5, soft: 3, seed: seed + 300, grid: 48, shade: 0.3 });
  paintRidge(r, c3, c4, { tints: [0.5, 0.26], hazeV: 0.68, layer: 3, step: 4.5, fine: true, index: 4, accent: 0.55, seed: seed + 400, grid: 48, shade: 0.35 });
  paintRidge(r, c4, null, { tints: [0.34, 0.16], hazeV: 0.5, foot: 0.5, layer: 3, step: 5, soft: 4, seed: seed + 500, grid: 48, shade: 0.35 });
  paintGrass(r, seed);

  // the sun's haze lifts the greys behind the ground; the faintest ember in the mist right round it
  paintDitherGlow(r, SUN.x, SUN.y, 60, null, 3, { ay: 1.7, pow: 1.8, strength: 0.6 });
  paintDitherGlow(r, SUN.x, SUN.y, 30, C.ember, 3, { ay: 1.3, pow: 3.2, strength: 0.35 });

  // ground cover (tussocks, bigger and brighter-tipped towards the viewer), then the ring
  for (let y = HZ + 3; y < 196; y += 3) {
    const k = (y - HZ) / (H - HZ), n = 2 + Math.round(k * 7);
    for (let i = 0; i < n; i++) {
      const x = Math.round(hash2f(i, y, seed + 70) * W), hgt = 3 + k * 9 * (0.5 + hash2f(i, y, seed + 71));
      tuft(r, x, y, hgt, seed + x * 3 + y, 4, { lean: (x - SUN.x) * 0.0007, tipTone: 0.3 + 0.45 * (1 - smooth(0.55, 0.85, k)) });
    }
  }
  S.embers = [];
  const rockBase = { light: L_DIR, elev: 0.28, layer: 5, rim: 1, contrast: 0.95, lichenSize: [0.9, 2.5], shadow: { sx: -1.4, sy: 0.3, dens: 0.85, layerMax: 5 } };
  const place = (st) => {
    const info = shadedRock(r, { ...rockBase, planes: 3, rough: 0.45, facet: 3.2, streaks: 0.3, bevel: st.rx * 0.85, H: st.rx * 0.9, strata: 1.0, spacing: 5.5, tone: 0.36, lichen: 0.65, cracks: 2, glow: st.far ? 0 : 0.55,
      ...st, cy: st.cy == null ? st.foot - st.ry : st.cy, layer: st.far ? 4 : 5 });
    if (info) { if (st.far) flattenMask(r, info, 0.55, 4); S.embers.push(...info.embers); }
  };
  // the ring, far to near: angular weathered slabs of different height, lean and width; the hero (with the glowing incision) a little right of centre
  const ring = [
    { cx: 26, foot: 147, rx: 13, ry: 19, rot: 0.04, p: 2.8, taper: 0.7, seed: 31, far: 1 },
    { cx: 178, foot: 151, rx: 16, ry: 15, rot: 0, p: 2.8, taper: 0.7, seed: 32, far: 1 },
    { cx: 274, foot: 159, rx: 24, ry: 22, rot: 0.05, p: 4, taper: 0.9, planes: 1, cuts: [[-1.8, 0.82]], seed: 35, tone: 0.3 },
    { cx: 136, foot: 160, rx: 21, ry: 32, rot: -0.05, p: 2.6, taper: 0.62, planes: 1, seed: 34, tone: 0.34 },
    { cx: 78, foot: 168, rx: 28, ry: 38, rot: 0.05, p: 4, taper: 0.82, planes: 2, cuts: [[-1.25, 0.84]], seed: 33, strata: 1.2, tone: 0.32 },
  ];
  ring.filter((q) => q.far).forEach(place);
  ring.filter((q) => !q.far && q.foot < 164).forEach(place);
  {
    const info = monoStone(r, 240, 170, 94, { seed: 36, light: L_DIR, elev: 0.28, glow: 0.9, symbol: 'crescent', width: 0.36, taper: [0.46, 0.56], tone: -0.05, layer: 5, lichen: 1.3, moss: 0.4, shadow: { sx: -1.4, sy: 0.3, dens: 0.85, layerMax: 5 } });
    S.embers.push(...info.embers);
  }
  ring.filter((q) => !q.far && q.foot >= 164).forEach(place);
  place({ cx: 192, cy: 166, rx: 28, ry: 9, rot: 0.05, p: 3.8, planes: 3, flat: 1, rough: 0.6, bevel: 9, H: 8, strata: 0.5, spacing: 5, sang: 0.05, tone: 0.4, contrast: 0.9, lichen: 1.0, cracks: 1, seed: 52 });
  place({ cx: 326, cy: 156, rx: 60, ry: 27, rot: -0.34, p: 2.9, planes: 3, flat: 1, rough: 0.6, facet: 4.5, bevel: 28, H: 30, strata: 1.5, spacing: 6, tone: 0.42, contrast: 0.9, glow: 0.7, lichen: 0.8, cracks: 3, seed: 61 });
  place({ cx: 14, cy: 178, rx: 32, ry: 15, rot: 0.06, p: 2.3, planes: 3, flat: 1, rough: 0.6, bevel: 12, H: 13, strata: 0.7, spacing: 6, tone: 0.3, contrast: 0.9, lichen: 0.9, cracks: 1, seed: 71 });
  // tussocks round the feet of the stones, so each one stands in the grass
  for (const f of [{ x: 78, y: 168, w: 56 }, { x: 136, y: 160, w: 44 }, { x: 240, y: 170, w: 40 }, { x: 274, y: 159, w: 44 }, { x: 192, y: 167, w: 60 }, { x: 14, y: 178, w: 60 }]) {
    for (let i = 0; i < f.w / 7; i++) {
      const x = Math.round(f.x - f.w / 2 + hash2f(i, f.x, seed + 90) * f.w), y = f.y + Math.round(hash2f(i, f.y, seed + 91) * 3);
      tuft(r, x, y, 3 + hash2f(i, f.x, seed + 92) * 4, seed + x * 5 + y, 5, { lean: (x - SUN.x) * 0.0007, tipTone: 0.55 });
    }
  }
  paintFootPlate(r, 170);
  textClear(r, { x: 0, y: 186, w: W, h: 30 }, 0.5);
  S.glints = collectGlints(r, { x: 0, y: HZ + 2, w: W, h: 50 }, seed + 97, 0.5, 3).filter((g) => r.layer(g[1], g[2]) === 4);
  // the sun's halo breathes: its outer dither is remembered so anim() can dim a few pixels at a time
  S.halo = [];
  for (let y = SUN.y - 22; y <= SUN.y + 22; y++) for (let x = SUN.x - 22; x <= SUN.x + 22; x++) {
    if (r.get(x, y) !== C.ember || Math.hypot(x - SUN.x, y - SUN.y) < 6.5 || r.layer(x, y) > 3) continue;
    let dim = 0;
    for (let k = 1; k < 4 && !dim; k++) for (const [dx, dy] of [[k, 0], [-k, 0], [0, k], [0, -k]]) { const c = r.get(x + dx, y + dy); if (c && c !== C.ember) { dim = c; break; } }
    S.halo.push([x, y, hash2f(x, y, seed + 95) * 6.28, dim || C.fog]);
  }
  paintTitleLogo(r, S);
  paintMistBands(r, [{ y: 96, rows: 22, layerMax: 2, dens: 1.0, phase: 40 }, { y: 110, rows: 22, layerMax: 3, dens: 1.0, phase: 90 }, { y: 124, rows: 20, layerMax: 4, dens: 1.0, phase: 150 }], seed + 900);
  S.bands = makeMistBands(r.w, [{ y: 104, rows: 20, layerMax: 3, speed: 3, dens: 0.6 }, { y: 130, rows: 16, layerMax: 4, speed: -5, dens: 0.7 }], seed);
}
export function anim(r, spec, S, t) {
  pulseEmbers(r, S.embers, t);
  animGlints(r, S.glints, t);
  for (const [x, y, ph, dim] of S.halo) if (Math.sin(t * 0.7 + ph) < -0.35) r.d[y * r.w + x] = dim;
  animMistBands(r, S.bands, t);
  animLogo(r, S.logo, t);
}
