/**
 * Shared kit for the five start screens (src/render/title/*.js). GREYSCALE + ONE ACCENT:
 *
 *   colours   ink char slate ash rock fog snow (artkit GREY, dark -> light) and ember (the accent). paper / paper2 only as warm light endpoints.
 *   rasters   everything writes strict palette u32 colours (PAL_U32 = `C`) into a Raster (artkit.js): r.px(x, y, colour, layer), r.get(x, y).
 *             `layer` is the depth id of a pixel (0 sky .. 6 logo); mist and glows take a `layerMax` so they only cover what lies behind them.
 *   determinism   no Math.random anywhere: every random choice comes from `seed` (hash2f / vnoise / mulberry32), so a painting is a pure function of its spec.
 *
 * Region arguments ("mask|rect") are either a rect { x, y, w, h } or a mask { x, y, w, h, data } where data[(Y - y) * w + (X - x)] is truthy
 * where painting is allowed. stoneMask(stoneInfo) turns the result of paintStandingStone into such a mask.
 *
 * ---------------------------------------------------------------------------------------------------------------------------------------
 *  ramp(v, x, y, accent = 0)                   colour at v in 0..1 on GREY (ink .. snow), ordered-dithered at pixel (x, y).
 *                                              accent 0..1: density of ember dithered over it (fades in above v ~ 0.1), for a lit/warm patch.
 *  paintGreyGradient(r, rect, v0, v1, o)       banded dithered gradient (flat tints, narrow dithered seams). v0 -> v1 are GREY positions 0..1.
 *                                              o: { axis:'y'|'x', bias=1 (curve), flat=0.5 (0 = smooth dither .. 1 = hard bands), layer=0,
 *                                                   streak=0 (0..1 amount of cloud streaks), seed=1 }
 *  paintFootPlate(r, y0, o)                    darkens the foot of the picture from y0 (dithered sinkG) so small text sits on quiet ground.
 *                                              o: { strength=0.95, layer=5, steps=2 }
 *  paintLichen(r, region, seed, o)             patchwork crust lichen: elliptic ragged patches in fog/ash/bone with dark rims and areoles.
 *                                              o: { density=1.2 (patches per 100 px^2 of region), size=[2,6] (radius px), ramps (array of 4-stop dark->light
 *                                                   ramps, default bone/pale/dark), rim=C.char, light=[-1,-1] (screen dir to the sun; the sunward side
 *                                                   is lifted), strata=0 (radians, patches elongate along it), tone=0.5 (base brightness 0..1), accent=0
 *                                                   (0..1 share of patches that get an ember rim), layer, skip(x,y)->bool }.  Returns painted pixel count.
 *  paintStrata(r, region, seed, o)             horizontal layering of a stone face, painted OVER what is there (sinkG / liftG steps): per-layer tone
 *                                              shifts, dark broken bedding joints with a lit lip, and hairline cracks.
 *                                              o: { spacing=[5,14], slope=0.15 (bedding dip), warp=2.5 (px), tone=0.5, joint=0.7 (0..1 how continuous),
 *                                                   cracks=3, crackLen=[10,40], light=[-1,-1], layer, emberCrack=0 (0..1 share of cracks glowing ember) }
 *  paintContourField(r, heightFn, o)           greyscale hypsometric map: stepped grey tints in bands (dithered seams), hill-shading from `light`,
 *                                              fine + index contours as pixel iso-lines (lines go light on dark ground, dark on light), an optional
 *                                              grid, spot heights with 3x5 labels, and ONE optional ember contour.
 *                                              heightFn(x, y) -> 0..1 in SCREEN px (any function: fbm, a track field via fieldOf, a cone...).
 *                                              o: { rect={0,0,W,H}, bands=14, tints=[0.1,0.85] (GREY positions of the lowest/highest band), seam=0.78,
 *                                                   light=[-1,-1], shade=0.3, relief=40 (slope exaggeration), fine=true, index=5 (every Nth is heavy, 0=off),
 *                                                   grid=0 (spacing px, 0=off), gridColor=C.slate (or C.grid sparingly), gridDens=0.55, gridOrigin=[0,0],
 *                                                   spots=0 (count), metres=[200,900] (label range), avoid=[rects], accent=null (0..1 height whose contour is
 *                                                   ember), layer=1, skip(x,y)->bool, haze(x,y)->0..1 (fades tints to haze colour), hazeV=0.8 }
 *                                              returns { spots:[{x,y,h}], band:Int16Array(rect.w*rect.h, -1 = skipped) }.
 *  makeMistBands(W, specs, seed)               animated mist: specs [{ y, rows=14, speed=4, dens=0.6, layerMax=255, phase }] -> bands.
 *  animMistBands(r, bands, t)                  draws the bands (lifting greys with liftG); call from a variant's anim().
 *  paintMistBands(r, specs, seed)              the same, drawn once into the base (static fog). Returns the bands so the variant may also animate them.
 *  paintDitherGlow(r, cx, cy, rad, col, maxLayer=255, o)
 *                                              radial dithered glow. col = a palette colour (ember: sparse at the rim, dense at the core) or null
 *                                              (lift whatever is there one or two grey steps: a soft sun-bloom in greys).
 *                                              o: { pow=1.7, ay=1 (vertical squash, >1 = flatter), strength=1, core=null (solid colour inside coreR*rad),
 *                                                   coreR=0.25 }
 *  pulseEmbers(r, embers, t)                   the incisions breathe: embers [[x, y, phase, dimColour], ...] (stone info .embers) between ember and dim.
 *  paintTitleLogo(r, S, o)                     the carved-stone logo (titleart.paintLogo) into S.logo; o: { text='CONTOURS', cx=192, top=18, scale=5, spacing=1 }.
 *  animLogo(r, S.logo, t)                      re-exported from titleart: the snow glint that sweeps the carved face every 5.5 s.
 *  monoStone(r, cx, baseY, h, o)               paintStandingStone with { mono: true } defaults ({ outline:1, moss:0.4, lichen:1 }); o overrides.
 *  stoneMask(info)                             stone info -> region mask (screen-oriented).
 *  fieldOf(levelIndex, hint)                   a track's heightfield: { T, size, h(fx, fy) -> 0..1 bilinear, mirrored at the edges } (stand-in until warm).
 *  textClear(r, rect, strength)                dithers a quiet ink/char patch behind a text rect (screens draw their own halo; this keeps busy art calm).
 * ---------------------------------------------------------------------------------------------------------------------------------------
 */
import { PAL_U32 as C } from '../palette.js';
import { hash2f, mulberry32 } from '../../core/rng.js';
import { bay, clamp, smooth, mix, vnoise, fbm, rampAt, stampSmall, smallWidth, mistBand, GREY, liftG, sinkG, Raster } from '../artkit.js';
import { paintLogo, animLogo, terrainOf, hAt } from '../titleart.js';
import { paintStandingStone } from '../stone.js';

export { GREY, liftG, sinkG, bay, clamp, smooth, mix, vnoise, fbm, rampAt, stampSmall, smallWidth, hash2f, mulberry32, Raster, paintLogo, animLogo, paintStandingStone, C };

const GREY_IDX = new Map(GREY.map((c, i) => [c, i]));
const greyIdx = (c) => (GREY_IDX.has(c) ? GREY_IDX.get(c) : -1);

// ================================================================================= ramp / gradients
/** Colour on the GREY ramp at v (0..1), dithered; `accent` dithers ember over it (not over the darkest tones). */
export function ramp(v, x, y, accent = 0) {
  const c = rampAt(GREY, v, x, y);
  if (accent > 0 && bay(x + 3, y + 5) < accent * smooth(0.05, 0.35, v)) return C.ember;
  return c;
}

export function paintGreyGradient(r, rect, v0, v1, o = {}) {
  const { axis = 'y', bias = 1, flat = 0.5, layer = 0, streak = 0, seed = 1 } = o;
  const { x, y, w, h } = rect;
  const n = GREY.length;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = x + i, Y = y + j;
    const t = Math.pow(clamp(axis === 'y' ? j / Math.max(1, h - 1) : i / Math.max(1, w - 1), 0, 1), bias);
    const pos = clamp(mix(v0, v1, t), 0, 1) * (n - 1), k = Math.min(n - 2, Math.floor(pos)), f = smooth(flat, 1, pos - k);
    let c = bay(X, Y) < f ? GREY[k + 1] : GREY[k];
    if (streak > 0) {
      const q = vnoise(X * 0.006, (Y + X * 0.035) * 0.19, seed) * 0.65 + vnoise(X * 0.02, Y * 0.45, seed + 4) * 0.35;
      const hi = clamp((q - 0.56) * 4, 0, 1) * streak, lo = clamp((0.36 - q) * 4, 0, 1) * streak;
      if (hi > 0 && bay(X + 3, Y + 1) < hi * 0.85) c = liftG(c); else if (lo > 0 && bay(X + 1, Y + 5) < lo * 0.8) c = sinkG(c);
    }
    r.px(X, Y, c, layer);
  }
}

export function paintFootPlate(r, y0, o = {}) {
  const { strength = 0.95, layer = 5, steps = 2 } = o;
  for (let y = y0; y < r.h; y++) {
    const k = Math.pow((y - y0) / Math.max(1, r.h - y0), 1.3) * strength;
    for (let x = 0; x < r.w; x++) {
      const b = bay(x, y);
      let c = r.get(x, y);
      if (b < k) for (let s = 0; s < steps; s++) c = sinkG(c);
      else if (b < k * 1.5) c = sinkG(c);
      else continue;
      r.px(x, y, c, layer);
    }
  }
}

export function textClear(r, rect, strength = 0.6) {
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) if (bay(x, y) < strength) r.px(x, y, sinkG(sinkG(r.get(x, y))));
}

// ================================================================================= regions
function regionOf(r, reg) {
  const g = reg || { x: 0, y: 0, w: r.w, h: r.h };
  const d = g.data;
  return {
    x: g.x, y: g.y, w: g.w, h: g.h,
    has: d ? (X, Y) => { const i = X - g.x, j = Y - g.y; return i >= 0 && j >= 0 && i < g.w && j < g.h && d[j * g.w + i] !== 0 && X >= 0 && Y >= 0 && X < r.w && Y < r.h; }
      : (X, Y) => X >= g.x && Y >= g.y && X < g.x + g.w && Y < g.y + g.h && X >= 0 && Y >= 0 && X < r.w && Y < r.h,
    area() { if (!d) return g.w * g.h; let n = 0; for (let i = 0; i < d.length; i++) if (d[i]) n++; return n; },
  };
}
/** paintStandingStone's result -> a region mask in screen orientation (the stone's own mask runs from the foot up). */
export function stoneMask(st) {
  const data = new Uint8Array(st.w * st.maskH);
  for (let j = 0; j < st.maskH; j++) for (let i = 0; i < st.w; i++) data[j * st.w + i] = st.mask[(st.maskH - 1 - j) * st.w + i];
  return { x: st.x0, y: st.y0, w: st.w, h: st.maskH, data };
}

// ================================================================================= lichen
const LICH_RAMPS = [
  [C.slate, C.ash, C.fog, C.snow],        // bone
  [C.char, C.slate, C.rock, C.fog],       // pale grey crust
  [C.ink, C.char, C.slate, C.ash],        // dark crust
  [C.char, C.ash, C.rock, C.fog],         // map lichen
];
export function paintLichen(r, region, seed, o = {}) {
  const { density = 1.2, size = [2, 6], ramps = LICH_RAMPS, rim = C.char, light = [-1, -1], strata = 0, tone = 0.5, accent = 0, layer, skip } = o;
  const R = regionOf(r, region);
  const ll = Math.hypot(light[0], light[1]) || 1, lx = light[0] / ll, ly = light[1] / ll;
  const n = Math.round(R.area() / 100 * density);
  let painted = 0;
  for (let p = 0; p < n; p++) {
    let px = 0, py = 0, ok = false;
    for (let tries = 0; tries < 6 && !ok; tries++) {
      px = R.x + hash2f(p, tries * 3 + 1, seed + 11) * R.w; py = R.y + hash2f(p, tries * 3 + 2, seed + 11) * R.h;
      ok = R.has(Math.floor(px), Math.floor(py));
    }
    if (!ok) continue;
    const big = hash2f(p, 5, seed + 12) < 0.08;
    const a = (size[0] + (size[1] - size[0]) * Math.pow(hash2f(p, 6, seed + 12), 2)) * (big ? 1.6 : 1);
    const b = a * (0.5 + 0.5 * hash2f(p, 7, seed + 12));
    const rot = strata + (hash2f(p, 8, seed + 12) - 0.5) * 0.7, cr = Math.cos(rot), sr = Math.sin(rot);
    const rp = ramps[Math.floor(hash2f(p, 9, seed + 12) * ramps.length)];
    const ps = Math.floor(hash2f(p, 10, seed + 12) * 1000);
    const glowRim = accent > 0 && hash2f(p, 13, seed + 12) < accent;
    const rr = Math.ceil(a * 1.4) + 2;
    for (let Y = Math.round(py - rr); Y <= py + rr; Y++) for (let X = Math.round(px - rr); X <= px + rr; X++) {
      if (!R.has(X, Y) || (skip && skip(X, Y))) continue;
      const dx = X - px, dy = Y - py;
      const u = (dx * cr + dy * sr) / a, v = (-dx * sr + dy * cr) / b;
      const d = Math.hypot(u, v), ang = Math.atan2(v, u);
      const lim = 1 + (vnoise(Math.cos(ang) * 1.8 + ps, Math.sin(ang) * 1.8, seed + 70) - 0.5) * 0.7;
      if (d > lim) continue;
      const ring = d / lim;
      let col;
      if (ring > 0.8) {
        col = bay(X, Y) < 0.85 ? rim : sinkG(rim);                                                    // the dark rim
        if (glowRim && bay(X + 2, Y + 1) < 0.5) col = C.ember;
      } else {
        const sun = clamp(0.5 + 0.5 * (-(dx * lx + dy * ly) / Math.max(1, a)), 0, 1);               // the sunward side of the patch is paler
        const t = clamp(tone + 0.25 - ring * 0.3 + (sun - 0.5) * 0.35 + (hash2f(X, Y, seed + 14) - 0.5) * 0.22, 0, 1);
        col = rampAt(rp, t, X, Y);
        if (a > 3 && hash2f(X, Y, seed + 15) < 0.05) col = sinkG(sinkG(col));                         // areoles
        else if (ring < 0.4 && hash2f(X, Y, seed + 16) < 0.04) col = rim;
      }
      r.px(X, Y, col, layer);
      painted++;
    }
  }
  return painted;
}

// ================================================================================= strata
export function paintStrata(r, region, seed, o = {}) {
  const { spacing = [5, 14], slope = 0.15, warp = 2.5, tone = 0.5, joint = 0.7, cracks = 3, crackLen = [10, 40], light = [-1, -1], layer, emberCrack = 0 } = o;
  const R = regionOf(r, region);
  const lipDir = light[1] <= 0 ? 1 : -1;                                                              // sun above: the lit lip lies below the joint
  const bounds = [], shift = [], B0 = -Math.abs(slope) * (R.w + 10) - warp - 4, B1 = R.h + Math.abs(slope) * (R.w + 10) + warp + 4;
  { const rng = mulberry32(seed * 7 + 3); let s = B0; while (s < B1) { bounds.push(s); s += spacing[0] + (spacing[1] - spacing[0]) * Math.pow(rng(), 1.3); shift.push(Math.floor(rng() * 3) - 1); } }
  const layerOf = (s) => { let lo = 0, hi = bounds.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bounds[m] <= s) lo = m; else hi = m - 1; } return lo; };
  for (let j = 0; j < R.h; j++) for (let i = 0; i < R.w; i++) {
    const X = R.x + i, Y = R.y + j;
    if (!R.has(X, Y)) continue;
    const s = j + slope * i + (fbm(X * 0.03, Y * 0.05, seed + 40, 2) - 0.5) * 2 * warp;
    const k = layerOf(s), sb = s - bounds[k];
    let c = r.get(X, Y);
    const sh = shift[k];
    if (sh !== 0 && bay(X + 1, Y + 3) < tone * 0.7) c = sh > 0 ? liftG(c) : sinkG(c);
    const brk = vnoise(X * 0.3, Y * 0.3, seed + 63);
    if (sb < 0.9 && brk > 1 - joint) c = sinkG(sb < 0.4 ? sinkG(c) : c);
    else if (sb >= 0.9 && sb < 1.9 && brk > 1 - joint + 0.1 && bay(X, Y) < 0.6) c = lipDir > 0 ? liftG(c) : c;
    r.px(X, Y, c, layer);
  }
  // hairline cracks: mostly down the face, a lit edge on the sunward side
  const rng = mulberry32(seed * 13 + 5);
  for (let q = 0; q < cracks; q++) {
    let x = R.x + rng() * R.w, y = R.y + rng() * R.h * 0.6, ang = Math.PI / 2 + (rng() - 0.5) * 0.8;
    const len = crackLen[0] + (crackLen[1] - crackLen[0]) * rng(), glow = rng() < emberCrack;
    for (let s = 0; s < len; s++) {
      ang = clamp(ang + (rng() - 0.5) * 0.45, 0.3, Math.PI - 0.3);
      x += Math.cos(ang) * 0.9; y += Math.sin(ang) * 0.9;
      const X = Math.round(x), Y = Math.round(y);
      if (!R.has(X, Y)) { if (s > 2) break; continue; }
      r.px(X, Y, glow && s % 3 !== 0 ? C.ember : sinkG(sinkG(r.get(X, Y))), layer);
      const LX = X - Math.sign(light[0] || -1), LY = Y;
      if (R.has(LX, LY) && bay(LX, LY) < 0.5 && !glow) r.px(LX, LY, liftG(r.get(LX, LY)), layer);
    }
  }
}

// ================================================================================= contour field
export function paintContourField(r, hf, o = {}) {
  const rect = o.rect || { x: 0, y: 0, w: r.w, h: r.h };
  const { bands = 14, tints = [0.1, 0.85], seam = 0.78, light = [-1, -1], shade = 0.3, relief = 40, fine = true, index = 5, grid = 0, gridColor = C.slate,
    gridDens = 0.55, gridOrigin = [0, 0], spots = 0, metres = [200, 900], avoid = [], accent = null, layer = 1, skip, haze, hazeV = 0.8 } = o;
  const { x: X0, y: Y0, w, h } = rect;
  const H = new Float32Array(w * h), band = new Int16Array(w * h).fill(-1);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (skip && skip(X0 + i, Y0 + j)) continue;
    H[j * w + i] = clamp(hf(X0 + i, Y0 + j), 0, 1);
    band[j * w + i] = Math.min(bands - 1, Math.floor(H[j * w + i] * bands));
  }
  const ll = Math.hypot(light[0], light[1]) || 1, Lx = light[0] / ll, Ly = light[1] / ll;
  const col = new Uint32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (band[k] < 0) continue;
    const f = H[k] * bands - Math.floor(H[k] * bands);
    const stepped = (band[k] + smooth(seam, 1, f)) / bands;
    const i0 = Math.max(0, i - 1), i1 = Math.min(w - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(h - 1, j + 1);
    const gx = (H[j * w + i1] - H[j * w + i0]) / (i1 - i0) * relief, gy = (H[j1 * w + i] - H[j0 * w + i]) / (j1 - j0) * relief;
    const lam = (gx * -Lx + gy * -Ly) / Math.hypot(gx, gy, 1);                                       // >0 faces the sun
    let v = mix(tints[0], tints[1], stepped) + lam * shade;
    if (haze) v = mix(v, hazeV, clamp(haze(X0 + i, Y0 + j), 0, 1));
    col[k] = rampAt(GREY, v, X0 + i, Y0 + j);
  }
  // contours: of each pair of neighbours the higher band carries the line
  const lineLvl = new Int16Array(w * h).fill(-1);
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const k = j * w + i;
    if (band[k] < 0) continue;
    for (const n of [k + 1, k + w]) {
      if (band[n] < 0 || band[n] === band[k]) continue;
      const hi = band[n] > band[k] ? n : k, lv = Math.max(band[n], band[k]);
      if (lv > lineLvl[hi]) lineLvl[hi] = lv;
    }
  }
  const accentBand = accent == null ? -1 : Math.min(bands - 1, Math.round(accent * bands));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, lv = lineLvl[k];
    if (lv < 0 || !(fine || (index && lv % index === 0))) continue;
    const isIndex = index > 0 && lv % index === 0;
    const c = col[k], gi = greyIdx(c), dark = gi >= 0 && gi <= 2;
    let lc;
    if (dark) { lc = liftG(liftG(c)); if (isIndex) lc = liftG(lc); } else { lc = sinkG(sinkG(c)); if (isIndex) lc = sinkG(lc); }
    if (!isIndex && bay(X0 + i + 2, Y0 + j) > 0.9) lc = c;                                           // fine lines are not quite continuous
    if (lv === accentBand) lc = C.ember;
    col[k] = lc;
  }
  if (grid > 0) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      if (band[j * w + i] < 0) continue;
      const gx = Math.floor((X0 + i - gridOrigin[0]) / grid), gy = Math.floor((Y0 + j - gridOrigin[1]) / grid);
      const online = Math.floor((X0 + i + 1 - gridOrigin[0]) / grid) !== gx || Math.floor((Y0 + j + 1 - gridOrigin[1]) / grid) !== gy;
      if (online && bay(X0 + i * 3 + 1, Y0 + j * 5 + 2) < gridDens) col[j * w + i] = gridColor;
    }
  }
  for (let k = 0; k < w * h; k++) if (band[k] >= 0) r.px(X0 + (k % w), Y0 + ((k / w) | 0), col[k], layer);
  // spot heights: local tops, a dot and the height in metres
  const out = [];
  if (spots > 0) {
    const cand = [];
    for (let cy = 0; cy < h; cy += 22) for (let cx = 0; cx < w; cx += 34) {
      let best = -1, bx = 0, by = 0;
      for (let j = cy; j < Math.min(h, cy + 22); j++) for (let i = cx; i < Math.min(w, cx + 34); i++) if (band[j * w + i] >= 0 && H[j * w + i] > best) { best = H[j * w + i]; bx = i; by = j; }
      if (best < 0.25) continue;
      let top = true;
      for (let j = Math.max(0, by - 7); j <= Math.min(h - 1, by + 7) && top; j++) for (let i = Math.max(0, bx - 7); i <= Math.min(w - 1, bx + 7); i++) if (H[j * w + i] > best + 0.0005) { top = false; break; }
      if (top) cand.push({ x: X0 + bx, y: Y0 + by, h: best });
    }
    cand.sort((a, b) => b.h - a.h);
    for (const c of cand) {
      if (out.length >= spots) break;
      const txt = String(Math.round(metres[0] + c.h * (metres[1] - metres[0]))), tw = smallWidth(txt);
      const box = { x: c.x + 3, y: c.y - 2, w: tw, h: 5 };
      if (box.x + tw > r.w - 3 || box.y < 2) continue;
      if (avoid.some((a) => box.x < a.x + a.w + 3 && box.x + tw + 3 > a.x && box.y < a.y + a.h + 3 && box.y + 8 > a.y)) continue;
      if (out.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < 40)) continue;
      const lit = greyIdx(r.get(c.x, c.y)) >= 3;
      r.rect(c.x - 1, c.y - 1, 2, 2, lit ? C.ink : C.snow, layer);
      stampSmall(r, txt, box.x, box.y, lit ? C.ink : C.fog, lit ? C.fog : C.ink, layer);
      out.push({ x: c.x, y: c.y, h: c.h });
      avoid.push(box);
    }
  }
  return { spots: out, band };
}

// ================================================================================= mist / glow
export function makeMistBands(W, specs, seed) {
  return specs.map((s, i) => mistBand(W, s.rows || 14, seed + i + 1, { y: s.y, layerMax: s.layerMax == null ? 255 : s.layerMax, speed: s.speed == null ? 4 : s.speed, dens: s.dens == null ? 0.6 : s.dens, phase: s.phase == null ? i * 3 + 1 : s.phase }));
}
export function animMistBands(r, bands, t) {
  const W = r.w;
  for (const B of bands) {
    const { tex, TW, rows, y: y0, layerMax, speed, dens } = B;
    const off = Math.floor(t * speed) + B.phase, bob = Math.round(Math.sin(t * 0.35 + B.phase) * 1.2);
    for (let j = 0; j < rows; j++) {
      const y = y0 + j + bob;
      if (y < 0 || y >= r.h) continue;
      const row = j * TW;
      for (let x = 0; x < W; x++) {
        const v = tex[row + ((x + off) % TW + TW) % TW] * dens;
        if (v <= 0.02) continue;
        const i = y * W + x;
        if (r.lay[i] > layerMax) continue;
        if (bay(x, y) < v) r.d[i] = liftG(r.d[i]);
        if (v > 0.6 && bay(x + 4, y + 2) < v - 0.42) r.d[i] = liftG(r.d[i]);
      }
    }
  }
}
export function paintMistBands(r, specs, seed) {
  const bands = makeMistBands(r.w, specs, seed);
  animMistBands(r, bands, 0);
  return bands;
}

export function paintDitherGlow(r, cx, cy, rad, col, maxLayer = 255, o = {}) {
  const { pow = 1.7, ay = 1, strength = 1, core = null, coreR = 0.25 } = o;
  const ry = rad / ay;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) {
    if (x < 0 || y < 0 || x >= r.w || y >= r.h || r.lay[y * r.w + x] > maxLayer) continue;
    const d = Math.hypot((x - cx) / rad, (y - cy) * ay / rad);
    if (d > 1) continue;
    if (core != null && d < coreR) { r.px(x, y, core); continue; }
    const k = Math.pow(1 - d, pow) * strength;
    if (col == null) {
      if (bay(x, y) < k) r.px(x, y, liftG(r.get(x, y)));
      if (k > 0.45 && bay(x + 5, y + 3) < (k - 0.4) * 1.1) r.px(x, y, liftG(r.get(x, y)));
    } else if (bay(x, y) < k * 0.95) r.px(x, y, col);
  }
}

export function pulseEmbers(r, embers, t) {
  if (!embers) return;
  const W = r.w;
  for (const [x, y, ph, dim] of embers) {
    const k = 0.5 + 0.5 * Math.sin(t * 1.3 + ph * 0.55 + x * 0.05);
    r.d[y * W + x] = k < 0.2 ? (dim == null ? C.char : dim) : C.ember;
  }
}

// ================================================================================= logo / stone / terrain
export function paintTitleLogo(r, S, o = {}) {
  const { text = 'CONTOURS', cx = 192, top = 18, scale = 5, spacing = 1 } = o;
  return (S.logo = paintLogo(r, text, cx, top, scale, spacing));
}
export function monoStone(r, cx, baseY, h, o = {}) {
  return paintStandingStone(r, cx, baseY, h, { outline: 1, moss: 0.4, lichen: 1, ...o, mono: true });
}
export function fieldOf(levelIndex, hint) {
  const T = terrainOf(levelIndex, hint);
  return { T, size: T.size, h: (fx, fy) => hAt(T, fx, fy) };
}
