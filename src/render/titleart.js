/**
 * The cover paintings. Three full-bleed variants, all in the language of the Ordnance Survey sheet (hypsometric layer tints in the
 * reds, fine and index contours, the blue 1 km grid, tiny spot heights, hill-shaded dither gradients) with ONE hero: a standing
 * stone (stone.js) with real detail. The terrain is each track's own heightfield (setTerrain / the stand-in noise field).
 *
 *   A 'Survey'  a huge tilted contour map under a red-gold sky, the stone at the skyline, its long shadow across the contours
 *   B 'Summit'  straight down on one great hill drawn as banded contour rings, the stone on the summit, its shadow down the slope
 *   C 'Close'   the stone close up, big and fully detailed, against banded sky and receding contour ridges
 *
 * paintTitleArt paints the cached base; animTitleArt is the cheap per-frame pass (mist, glints, the ember in the incisions).
 */
import { PAL_U32 as C } from './palette.js';
import { hash2f } from '../core/rng.js';
import { FONTS } from './font.js';
import { Raster, bay, clamp, smooth, mix, vnoise, fbm, lift, sink, rampAt, stampSmall, smallWidth, mistBand, drawMistBand } from './artkit.js';
import { paintStandingStone } from './stone.js';

export const TITLE_VARIANTS = Object.freeze(['A', 'B', 'C']);
/** Which tracks' fields / skylines each variant draws on (the panel cache re-paints when one of them arrives). */
export const TITLE_LEVELS = Object.freeze({ A: [3], B: [6], C: [5, 4] });
export const TITLE_DEFAULT = 'A';

/** Where the screen's own text goes over each cover (screens.js reads this). */
export const TITLE_LAYOUT = Object.freeze({
  A: { subtitle: { x: 150, y: 66, align: 'center' }, prompt: { x: 192, y: 172 }, controls: 191, strapline: 201 },
  B: { subtitle: { x: 192, y: 66, align: 'center' }, prompt: { x: 192, y: 172 }, controls: 191, strapline: 201 },
  C: { subtitle: { x: 262, y: 66, align: 'center', maxW: 170, lh: 11 }, prompt: { x: 262, y: 156 }, controls: 191, strapline: 201 },
});

// ================================================================================= terrain store
const terrains = new Map();
/**
 * Keep a track's heightfield (size*size heights in metres, row-major) for the cover. The soft blur the cover wants (the shape of the
 * land, not the crag) is done on first use, so keeping a field for a track nobody draws costs only the copy.
 */
export function setTerrain(levelIndex, heights, size = 256) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < heights.length; i++) { const v = heights[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  const raw = new Float32Array(heights.length), sp = Math.max(1, hi - lo);
  for (let i = 0; i < heights.length; i++) raw[i] = (heights[i] - lo) / sp;
  let soft = null;
  const t = { size, lo, hi };
  Object.defineProperty(t, 'h', {
    get() {
      if (soft) return soft;
      let n = raw;
      for (let pass = 0; pass < 2; pass++) {
        const m = new Float32Array(n.length);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          let a = 0, c = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, yy = y + j; if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue; const w = (i === 0 ? 2 : 1) * (j === 0 ? 2 : 1); a += n[yy * size + xx] * w; c += w; }
          m[y * size + x] = a / c;
        }
        n = m;
      }
      return (soft = n);
    },
  });
  terrains.set(levelIndex, t);
}
export const hasTerrain = (levelIndex) => terrains.has(levelIndex);
const standIns = new Map();
function terrainOf(i, hint) {
  const t = terrains.get(i);
  if (t) return t;
  let s = standIns.get(i);
  if (!s) {
    const size = 128, n = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) n[y * size + x] = clamp(fbm(x * 0.045, y * 0.045, 900 + i * 7, 4) * 1.5 - 0.35, 0, 1);
    s = { size, h: n, lo: 0, hi: (hint && hint.hi) || 900, stand: true };
    standIns.set(i, s);
  }
  return s;
}
/** The field and progressively blurrier copies of it (for the distance); copy k is built only when something asks for it. */
function mipLevel(T, k) {
  const mips = T.mips || (T.mips = [T]);
  while (mips.length <= k) {
    const cur = mips[mips.length - 1], S = T.size, h = new Float32Array(S * S), rad = 2 << (mips.length - 1), st = Math.max(1, rad >> 1);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let a = 0, c = 0;
      for (let j = -rad; j <= rad; j += st) for (let i = -rad; i <= rad; i += st) { const xx = clamp(x + i, 0, S - 1), yy = clamp(y + j, 0, S - 1); a += cur.h[yy * S + xx]; c++; }
      h[y * S + x] = a / c;
    }
    mips.push({ size: S, h });
  }
  return mips[k];
}
/** Bilinear height 0..1 at field coordinates (mirrored at the edges so the map goes on for ever). */
function hAt(T, x, y) {
  const S = T.size, P = 2 * (S - 1);
  let xm = ((x % P) + P) % P; if (xm > S - 1) xm = P - xm;
  let ym = ((y % P) + P) % P; if (ym > S - 1) ym = P - ym;
  const x0 = Math.floor(xm), y0 = Math.floor(ym), fx = xm - x0, fy = ym - y0;
  const x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1);
  const h = T.h;
  const a = h[y0 * S + x0], b = h[y0 * S + x1], c = h[y1 * S + x0], d = h[y1 * S + x1];
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
}

// ================================================================================= the logo
function textMask(text, scale, spacing) {
  const f = FONTS.main;
  const chars = [...text];
  const adv = (g) => (g.w + 1 + spacing) * scale;
  let w = 0;
  for (const ch of chars) w += adv(f.glyphs[ch] || f.glyphs['?']);
  w -= spacing * scale;
  const h = 7 * scale;
  const m = new Uint8Array(w * h);
  let x0 = 0;
  for (const ch of chars) {
    const g = f.glyphs[ch] || f.glyphs['?'];
    g.rows.slice(0, 7).forEach((bits, row) => {
      for (let b = 0; b < g.w; b++) if (bits & (1 << (f.bits - 1 - b))) for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) { const X = x0 + b * scale + i, Y = row * scale + j; if (X < w) m[Y * w + X] = 1; }
    });
    x0 += adv(g);
  }
  return { m, w, h };
}

/**
 * The logo, painted on the art: a cast shadow, a block of extrusion, a hard outline, and a face that runs
 * flame -> ember -> rust with a lit edge and a shaded one, grained like carved stone. Returns the face pixels.
 */
export function paintLogo(r, text, cx, top, scale, spacing) {
  const base = textMask(text, scale, spacing);
  // fatten the strokes: every lit block grows by two pixels, so the letters are carved slabs rather than outlines
  const w = base.w + 3, h = base.h + 3, m = new Uint8Array(w * h);
  for (let y = 0; y < base.h; y++) for (let x = 0; x < base.w; x++) if (base.m[y * base.w + x]) for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) m[(y + j) * w + x + i] = 1;
  const x0 = Math.round(cx - w / 2), y0 = top;
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const EX = Math.max(3, Math.round(scale * 0.8));
  for (let y = -2; y < h + EX + 8; y++) for (let x = -2; x < w + EX + 8; x++) {            // cast shadow, dithered
    if (at(x - EX - 4, y - EX - 5) && bay(x0 + x, y0 + y) < 0.6) { const X = x0 + x, Y = y0 + y; r.px(X, Y, sink(sink(r.get(X, Y))), 6); }
  }
  for (let k = EX; k >= 1; k--) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) r.px(x0 + x + k, y0 + y + k, k >= EX - 1 ? C.ink : k > EX / 2 ? C.blood : C.rust, 6);   // extrusion
  const near = (x, y) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (at(x + i, y + j)) return true; return false; };
  for (let y = -2; y < h + 2; y++) for (let x = -2; x < w + 2; x++) if (!at(x, y) && near(x, y)) r.px(x0 + x, y0 + y, C.ink, 6);   // outline
  const face = [];
  const stops = [C.paper, C.flame, C.lamp, C.ember, C.rust];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    const X = x0 + x, Y = y0 + y;
    let c = rampAt(stops.slice().reverse(), 1 - Math.pow(y / (h - 1), 0.9), X, Y);
    if (hash2f(X, Y, 1234) < 0.07) c = sink(c);                                                    // carved grain
    if (!at(x - 1, y) || !at(x, y - 1)) c = bay(X, Y) < 0.8 ? C.paper : C.flame;                  // lit edge
    else if (!at(x + 1, y) || !at(x, y + 1)) c = bay(X, Y) < 0.7 ? C.blood : C.rust;              // shaded edge
    r.px(X, Y, c, 6);
    face.push(Y * r.w + X);
  }
  return { face, x0, y0, w, h };
}

// ================================================================================= shared scenery
const SKY = [C.ink, C.blood, C.heather, C.rust, C.ember, C.lamp, C.flame];
/** A banded sky: mostly flat tints with a narrow dithered seam between them, like the layer tints of a sheet. */
function paintBandedSky(r, W, y0, y1, stops, bias, flat = 0.55) {
  for (let y = y0; y < y1; y++) {
    const t = Math.pow(clamp((y - y0) / (y1 - y0 - 1), 0, 1), bias);
    const pos = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(pos));
    const f = smooth(flat, 1, pos - i);
    for (let x = 0; x < W; x++) r.px(x, y, bay(x, y) < f ? stops[i + 1] : stops[i], 0);
  }
}
function paintStreaks(r, W, y0, y1, seed, amount) {
  for (let y = y0; y < y1; y++) {
    const w = 0.25 + 0.75 * ((y - y0) / (y1 - y0));
    for (let x = 0; x < W; x++) {
      const v = vnoise(x * 0.006, (y + x * 0.035) * 0.19, seed) * 0.65 + vnoise(x * 0.02, y * 0.45, seed + 4) * 0.35;
      const hi = clamp((v - 0.56) * 4, 0, 1) * w * amount;
      const lo = clamp((0.36 - v) * 4, 0, 1) * (1.1 - w) * amount;
      if (hi > 0 && bay(x + 3, y + 1) < hi * 0.85) r.px(x, y, lift(r.get(x, y)));
      else if (lo > 0 && bay(x + 1, y + 5) < lo * 0.8) r.px(x, y, sink(r.get(x, y)));
    }
  }
}
/** A low sun: bone core, flame body, and a wide glow that lifts whatever is under it a step or two by dither. */
function paintSun(r, sx, sy, rad, glow, layerMax = 255) {
  const halo = Math.round(rad * glow);
  for (let y = -halo; y <= halo; y++) for (let x = -halo; x <= halo; x++) {
    const d = Math.hypot(x, y);
    if (d > halo) continue;
    const X = sx + x, Y = sy + y;
    if (X < 0 || Y < 0 || X >= r.w || Y >= r.h || r.lay[Y * r.w + X] > layerMax) continue;
    if (d <= rad) r.px(X, Y, d < rad * 0.45 ? C.paper : d < rad * 0.8 ? C.flame : (bay(X, Y) < 0.5 ? C.flame : C.lamp));
    else {
      const k = Math.pow(1 - (d - rad) / (halo - rad), 1.7);
      if (bay(X, Y) < k * 0.95) r.px(X, Y, lift(r.get(X, Y)));
      if (k > 0.45 && bay(X + 5, Y + 3) < (k - 0.4) * 1.1) r.px(X, Y, lift(r.get(X, Y)));
    }
  }
}
/** Lift terrain by one or two steps near (sx, sy): the sunset bleeding into the map. */
function bleed(r, sx, sy, R, k, layerMax) {
  for (let y = Math.max(0, sy - R); y < Math.min(r.h, sy + R); y++) for (let x = Math.max(0, sx - R); x < Math.min(r.w, sx + R); x++) {
    if (r.lay[y * r.w + x] > layerMax) continue;
    const d = Math.hypot(x - sx, (y - sy) * 1.6) / R;
    if (d >= 1) continue;
    const a = Math.pow(1 - d, 1.6) * k;
    if (bay(x + 2, y + 7) < a) r.px(x, y, lift(r.get(x, y)));
    if (a > 0.5 && bay(x + 6, y + 1) < a - 0.45) r.px(x, y, lift(r.get(x, y)));
  }
}
/** Ink fades up from the foot of the screen (dithered), so the small lines of text sit on quiet ground. */
function footPlate(r, W, H, y0) {
  for (let y = y0; y < H; y++) {
    const k = Math.pow((y - y0) / (H - y0), 1.3) * 0.95;
    for (let x = 0; x < W; x++) {
      const b = bay(x, y);
      if (b < k) r.px(x, y, sink(sink(r.get(x, y))), 5);
      else if (b < k * 1.5) r.px(x, y, sink(r.get(x, y)), 5);
    }
  }
}
function stars(r, W, seed, y1, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor(hash2f(i, 1, seed) * W), y = Math.floor(Math.pow(hash2f(i, 2, seed), 1.4) * y1);
    if (r.lay[y * W + x] === 0 && r.get(x, y) === C.ink) out.push({ x, y, ph: hash2f(i, 3, seed) * 6.28 });
  }
  return out;
}

/**
 * The sky in the language of the sheet: a banded gradient (flat tints, narrow dithered seams) under a low sun that is drawn
 * as a summit seen from above: rings of layer tint round it, a thin contour at each ring edge and a heavier one at every fourth.
 */
function paintRingSky(r, W, y0, y1, sun, o) {
  const stops = SKY, N = W * (y1 - y0);
  const K = new Int16Array(N), ringed = new Uint8Array(N);
  for (let y = y0; y < y1; y++) {
    const tBase = Math.pow(clamp((y - y0) / (y1 - y0 - 1), 0, 1), o.bias);
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x - sun.x) * o.ax, (y - sun.y) * o.ay);
      const q = Math.pow(d, o.pow) / o.q, k = Math.floor(q), f = q - k;
      const ringPos = o.peak - (k + smooth(0.7, 1, f)) * o.step;
      const basePos = tBase * (stops.length - 1);
      const pos = Math.max(basePos, ringPos);
      const sp = clamp(pos, 0, stops.length - 1.001), i = Math.floor(sp), ff = smooth(0.55, 1, sp - i);
      r.px(x, y, bay(x, y) < ff ? stops[i + 1] : stops[i], 0);
      const j = (y - y0) * W + x;
      K[j] = k; ringed[j] = ringPos > basePos + 0.15 ? 1 : 0;
    }
  }
  for (let y = y0; y < y1 - 1; y++) for (let x = 0; x < W - 1; x++) {            // the contours of the glow: pixel iso-lines, of each pair the farther ring carries the line
    const j = (y - y0) * W + x;
    if (!ringed[j]) continue;
    const kk = Math.max(K[j] !== K[j + 1] ? Math.max(K[j], K[j + 1]) : -1, K[j] !== K[j + W] ? Math.max(K[j], K[j + W]) : -1);
    if (kk < 0 || (K[j] < Math.max(K[j + 1], K[j + W]) && K[j] === Math.min(K[j], K[j + 1], K[j + W]) && false)) continue;
    if (K[j] !== kk) continue;
    const c = r.get(x, y);
    r.px(x, y, kk % 4 === 0 ? sink(sink(c)) : sink(c), 0);
  }
}

// ================================================================================= the hypsometric map
const HYPSO = [C.blood, C.heather, C.rust, C.ember, C.lamp, C.flame, C.paper2];

/**
 * Colour and lines of a heightfield sample: layer tints stepped in bands (a dithered seam at the top of each band), hill-shaded
 * by the slope towards the sun, fine contours at every band edge and a heavier one at every fifth. Returns a palette colour.
 */
function mapColour(x, y, hn, shade, o) {
  const nb = o.bands;
  const k = Math.floor(hn * nb), f = hn * nb - k;
  const stepped = (k + smooth(o.seam, 1, f)) / nb;
  const top = HYPSO.length - 1;
  let pos = stepped * top * o.span + o.base + (shade - 0.5) * o.shadeK;
  pos = mix(pos, o.hazeTo, o.haze);
  return rampAt(HYPSO, pos / top, x, y);
}

/**
 * The map draped over its own relief and seen from a low camera, Comanche-style: every screen column marches a ray over the
 * heightfield and fills the rows it newly reveals. Per pixel it keeps the map coordinates, elevation (0..1) and slope shade, so
 * contours and the grid come out of the buffers as pixel iso-lines (the method of mapbake.js), not as projected polylines.
 * Far ground is read from blurred copies of the field, so the distance is calm.
 */
function voxelMap(r, T, cam, o) {
  const W = r.w, H = r.h, N = W * H;
  const D = new Float32Array(N), MH = new Float32Array(N), MX = new Float32Array(N), MY = new Float32Array(N), SH = new Float32Array(N), HR = new Float32Array(N);
  const has = new Uint8Array(N);
  const top = new Int16Array(W).fill(H);
  const vx = Math.cos(cam.ang), vy = Math.sin(cam.ang), rx = -vy, ry = vx;
  const tanH = o.tanH, F = (W / 2) / tanH, hz = o.horizon;
  const L = o.light;
  const fixed = o.mip != null ? mipLevel(T, o.mip) : null;
  for (let x = 0; x < W; x++) {
    const xn = ((x + 0.5) / W) * 2 - 1;
    let d = o.near;
    while (d < o.far && top[x] > 0) {
      const px = cam.x + vx * d + rx * xn * tanH * d, py = cam.y + vy * d + ry * xn * tanH * d;
      const M = fixed || mipLevel(T, clamp(Math.floor(Math.log2(Math.max(1, d / o.lod))), 0, 3));
      const hraw = o.win ? (hAt(M, px, py) - o.win[0]) / (o.win[1] - o.win[0]) : hAt(M, px, py);
      const hn = clamp(hraw, 0, 1);                                      // tints and contours read the window, the relief reads the whole field
      const dz = cam.h - hraw * o.vscale;
      const ytop = hz + (dz * F) / d;
      if (ytop < top[x]) {
        const y0 = Math.max(0, Math.ceil(ytop));
        if (y0 < top[x]) {
          const e = Math.max(1.5, d / 60), Ms = M === T ? mipLevel(T, 1) : M;      // the shading reads a softer copy than the tints do
          const wk = o.win ? 1 / (o.win[1] - o.win[0]) : 1;
          const gx = (hAt(Ms, px + e, py) - hAt(Ms, px - e, py)) / (2 * e) * o.vscale * wk, gy = (hAt(Ms, px, py + e) - hAt(Ms, px, py - e)) / (2 * e) * o.vscale * wk;
          const nl = Math.hypot(gx, gy, 1);
          const lam = (-gx * L[0] - gy * L[1] + L[2]) / nl;
          const sh = clamp(0.5 + (lam - L[2]) * 1.5, 0, 1);
          for (let y = y0; y < top[x]; y++) { const i = y * W + x; D[i] = d; MH[i] = hn; HR[i] = hAt(M, px, py); MX[i] = px; MY[i] = py; SH[i] = sh; has[i] = 1; }
          top[x] = y0;
        }
      }
      d += clamp((d * d) / (Math.max(2, Math.abs(dz)) * F) * 0.9, 0.12, 6);
    }
  }
  return { D, MH, HR, MX, MY, SH, has, top };
}

/**
 * A flat sheet seen at a low angle: every row below the horizon is one depth of the sheet, so tints, shading, contours and grid
 * foreshorten together toward the skyline.
 */
function sheetMap(r, T, cam, o) {
  const W = r.w, H = r.h, N = W * H;
  const D = new Float32Array(N), MH = new Float32Array(N), MX = new Float32Array(N), MY = new Float32Array(N), SH = new Float32Array(N);
  const has = new Uint8Array(N);
  const top = new Int16Array(W).fill(H);
  const vx = Math.cos(cam.ang), vy = Math.sin(cam.ang), rx = -vy, ry = vx;
  const F = (W / 2) / o.tanH, L = o.light;
  const fixed = o.mip != null ? mipLevel(T, o.mip) : null;
  for (let y = o.horizon + 1; y < H; y++) {
    const d = (F * cam.h) / (y - o.horizon);
    if (d > o.far) continue;
    const M = fixed || mipLevel(T, clamp(Math.floor(Math.log2(Math.max(1, d / o.lod))), 0, 3));
    const e = Math.max(1, d / 60);
    for (let x = 0; x < W; x++) {
      const u = ((x + 0.5 - W / 2) / F) * d;
      const px = cam.x + vx * d + rx * u, py = cam.y + vy * d + ry * u;
      const hn = hAt(M, px, py);
      const gx = (hAt(M, px + e, py) - hAt(M, px - e, py)) / (2 * e) * o.vscale, gy = (hAt(M, px, py + e) - hAt(M, px, py - e)) / (2 * e) * o.vscale;
      const nl = Math.hypot(gx, gy, 1);
      const lam = (-gx * L[0] - gy * L[1] + L[2]) / nl;
      const i = y * W + x;
      D[i] = d; MH[i] = hn; MX[i] = px; MY[i] = py; SH[i] = clamp(0.5 + (lam - L[2]) * 1.5, 0, 1); has[i] = 1;
      if (y < top[x]) top[x] = y;
    }
  }
  return { D, MH, MX, MY, SH, has, top };
}

/** Colour the voxel buffers: tints, shading, haze, contours, the grid. */
function colourMap(r, B, o, layer) {
  const W = r.w, H = r.h;
  const { D, MH, MX, MY, SH, has } = B;
  const col = new Uint32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!has[i]) continue;
    const haze = smooth(o.hazeA, o.hazeB, D[i]);
    col[i] = mapColour(x, y, MH[i], SH[i], { bands: o.bands, span: o.span, base: o.base, shadeK: o.shadeK * (1 - haze * 0.8), seam: o.seam, hazeTo: o.hazeTo, haze: haze * 0.9 });
  }
  // contours and grid as pixel iso-lines: of every pair of neighbours the higher band carries the line
  const nb = o.bands;
  const bandOf = new Int16Array(W * H);
  for (let i = 0; i < W * H; i++) bandOf[i] = Math.floor(MH[i] * nb);
  const line = new Uint8Array(W * H), grid = new Uint8Array(W * H);
  B.gridLab = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const i = y * W + x;
    if (!has[i]) continue;
    for (const j of [i + 1, i + W]) {
      if (!has[j] || Math.abs(D[j] - D[i]) > 0.06 * D[i] + 0.6) continue;
      const a = bandOf[i], b = bandOf[j];
      if (a !== b) { const hi = a > b ? i : j, bb = Math.max(a, b); line[hi] = Math.max(line[hi], bb % 5 === 0 ? 2 : 1); }
      if (o.grid) {
        const G = o.grid;
        const gxa = Math.floor(MX[i] / G), gxb = Math.floor(MX[j] / G), gya = Math.floor(MY[i] / G), gyb = Math.floor(MY[j] / G);
        if (gxa !== gxb) { grid[i] = 1; B.gridLab[i] = Math.max(gxa, gxb) & 255; }
        else if (gya !== gyb) { grid[i] = 1; B.gridLab[i] = 256 + (Math.max(gya, gyb) & 255); }
      }
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!has[i]) continue;
    const haze = smooth(o.hazeA, o.hazeB, D[i]);
    const c = col[i], ln = line[i];
    if (ln && (ln === 2 || haze < 0.85)) {
      const dark = c === C.blood || c === C.ink || c === C.heather;
      let lc = ln === 2 ? (dark ? C.lamp : C.ink) : (dark ? C.rust : sink(sink(c)));
      if (ln === 1 && haze > 0.4 && bay(x, y) < haze) lc = c;
      col[i] = lc;
    }
    if (grid[i] && haze < 0.8 && bay(x * 3 + 1, y * 5 + 2) < o.gridDens * (1 - haze)) col[i] = C.grid;
  }
  for (let i = 0; i < W * H; i++) if (has[i]) r.px(i % W, (i / W) | 0, col[i], layer);
  // beyond the far limit the map dissolves into the glow of the horizon
  for (let x = 0; x < W; x++) for (let y = Math.max(o.horizon + 1, 0); y < B.top[x] && o.fill; y++) {
    const t = (y - o.horizon) / Math.max(1, B.top[x] - o.horizon);
    r.px(x, y, rampAt([C.ember, C.lamp, C.flame], 1 - t * 0.9, x, y), layer);
  }
  return col;
}

// ================================================================================= map furniture
const BRIGHT = new Set([C.flame, C.paper2, C.lamp, C.paper, C.ember, C.snow, C.rock]);
/** A small label on the map: ink on a light ground, bone on a dark one, always haloed. Returns its box. */
function mapLabel(r, text, x, y, layer) {
  const w = smallWidth(text);
  let lum = 0, n = 0;
  for (let j = 0; j < 5; j++) for (let i = 0; i < w; i += 2) { lum += BRIGHT.has(r.get(x + i, y + j)) ? 1 : 0; n++; }
  const light = lum / n > 0.45;
  stampSmall(r, text, x, y, light ? C.ink : C.paper2, light ? C.paper2 : C.ink, layer);
  return { x, y, w, h: 5 };
}
/** Spot heights: a dot and the height in metres at the highest ground of a few cells of the picture. */
function spotHeights(r, B, T, n, avoid, layer) {
  const W = r.w, H = r.h, cand = [];
  for (let cy = 4; cy < H - 36; cy += 22) for (let cx = 6; cx < W - 30; cx += 34) {
    let best = -1, bx = 0, by = 0;
    for (let y = cy; y < cy + 22; y++) for (let x = cx; x < cx + 34; x++) { const i = y * W + x; if (B.has[i] && B.MH[i] > best) { best = B.MH[i]; bx = x; by = y; } }
    if (best < 0.3) continue;
    let ok = true;                                                      // a real local top: nothing higher within 7 px
    for (let y = by - 7; y <= by + 7 && ok; y++) for (let x = bx - 7; x <= bx + 7; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x; if (B.has[i] && B.MH[i] > best + 0.001) { ok = false; break; } }
    if (ok) cand.push({ x: bx, y: by, h: best, raw: B.HR ? B.HR[by * W + bx] : best });
  }
  cand.sort((a, b) => b.h - a.h);
  const out = [];
  for (const c of cand) {
    if (out.length >= n) break;
    const m = Math.round(T.lo + c.raw * (T.hi - T.lo));
    const w = smallWidth(String(m));
    const box = { x: c.x + 3, y: c.y - 2, w, h: 5 };
    if (box.x + w > W - 4 || avoid.some((a) => box.x < a.x + a.w + 3 && box.x + w + 3 > a.x && box.y < a.y + a.h + 3 && box.y + 8 > a.y)) continue;
    if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 40)) continue;
    r.rect(c.x - 1, c.y - 1, 2, 2, BRIGHT.has(r.get(c.x, c.y)) ? C.ink : C.paper, layer);
    mapLabel(r, String(m), box.x, box.y, layer);
    out.push({ x: c.x, y: c.y });
    avoid.push(box);
  }
  return out;
}
/** Grid numbers where the blue lines run off the left and right edges, as on a sheet's margin. */
function gridLabels(r, B, avoid, layer) {
  const W = r.w, H = r.h;
  for (const x0 of [2, W - 12]) {
    let last = -99;
    for (let y = 6; y < H - 40; y++) {
      const lab = B.gridLab[y * W + x0 + (x0 > 100 ? 8 : 0)];
      if (lab < 0 || y - last < 28) continue;
      const num = String(20 + (lab & 255) % 80).padStart(2, '0');
      const box = { x: x0 > 100 ? x0 : 3, y: y - 7, w: smallWidth(num), h: 5 };
      if (avoid.some((a) => box.x < a.x + a.w + 2 && box.x + box.w + 2 > a.x && box.y < a.y + a.h + 2 && box.y + 7 > a.y)) continue;
      mapLabel(r, num, box.x, box.y, layer);
      last = y;
    }
  }
}

// ================================================================================= A: Survey
function paintA(r, spec, S) {
  const W = r.w, H = r.h, seed = 4242 + (spec.seed | 0);
  const cfg = { level: 3, cx: 130, cy: 210, ang: 0, camH: 60, tanH: 0.55, vscale: 16, hz: -60, near: 60, far: 150, skyH: 88, bands: 30, seam: 0.8, shadeK: 3.2, mip: 0, grid: 25, win: [0.5, 1.0], base: -0.6, span: 1.05, ...(spec.cfg || {}) };
  const T = terrainOf(cfg.level, { hi: 1309 });
  const sky = cfg.skyH;
  S.seed = seed;
  paintBandedSky(r, W, 0, sky + 1, SKY, 1.1, 0.5);
  for (let y = sky + 1; y < 150; y++) for (let x = 0; x < W; x++) r.px(x, y, bay(x, y) < 0.35 ? C.lamp : C.flame, 0);       // the haze bank where the map's far edge falls away
  paintStreaks(r, W, 0, sky, seed + 3, 1.1);
  const sunX = 352, sunY = sky - 4;
  paintSun(r, sunX, sunY, 16, 4.6);
  S.stars = stars(r, W, seed, 30, 38);
  const cam = { x: cfg.cx, y: cfg.cy, ang: -Math.PI / 2 + cfg.ang, h: cfg.camH };
  const sun = { x: 1, y: -0.25, z: 0.45 };
  const sl = Math.hypot(sun.x, sun.y, sun.z);
  const o = { tanH: cfg.tanH, horizon: cfg.hz, near: cfg.near, far: cfg.far, lod: 60, mip: cfg.mip, vscale: cfg.vscale, light: [sun.x / sl, sun.y / sl, sun.z / sl], bands: cfg.bands, span: cfg.span || 0.9, base: cfg.base != null ? cfg.base : 0.1, seam: cfg.seam, hazeTo: 4.6, shadeK: cfg.shadeK, hazeA: cfg.far * 0.78, hazeB: cfg.far * 1.02, hazeLift: 3.2, gridDens: 0.8, grid: cfg.grid, win: cfg.win };
  const B = voxelMap(r, T, cam, o);
  S.map = colourMap(r, B, o, 1);
  bleed(r, sunX, sky + 6, 150, 0.9, 2);
  const logo = S.logo = paintLogo(r, 'CONTOURS', 150, 18, 5, 1);
  const avoid = [{ x: logo.x0, y: logo.y0, w: logo.w + 8, h: logo.h + 8 }, { x: 14, y: 64, w: 276, h: 14 }, { x: 0, y: 166, w: W, h: 50 }, { x: 316, y: 16, w: 44, h: 94 }];
  gridLabels(r, B, avoid, 4);
  spotHeights(r, B, T, 6, avoid, 4);
  S.stone = paintStandingStone(r, 336, 106, 88, { seed: 21, light: [0.85, -0.3], elev: 0.4, glow: 0.2, symbol: 'discs', tone: -0.02, width: 0.46, layer: 3, shadow: { sx: -1.7, sy: 0.75, dens: 0.95, layerMax: 3 } });
  footPlate(r, W, H, 150);
  S.bands = [mistBand(W, 14, seed + 1, { y: sky + 6, layerMax: 1, speed: 4, dens: 0.8, phase: 1 }), mistBand(W, 12, seed + 2, { y: sky + 40, layerMax: 3, speed: 7, dens: 0.55, phase: 2 })];
}

// ================================================================================= B: Summit
/** Straight down on the field: map coordinates by pixel, rotated about the summit; D is constant (no haze). */
function planMap(r, T, o) {
  const W = r.w, H = r.h, N = W * H;
  const D = new Float32Array(N).fill(1), MH = new Float32Array(N), MX = new Float32Array(N), MY = new Float32Array(N), SH = new Float32Array(N);
  const has = new Uint8Array(N).fill(1);
  const ca = Math.cos(o.rot), sa = Math.sin(o.rot), L = o.light;
  const M = mipLevel(T, o.mip || 0), M1 = mipLevel(T, 1);                  // tints and contours read the field, the shading the softer copy
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5 - o.sx) / o.scale, v = (y + 0.5 - o.sy) / o.scale;
    const px = o.cx + u * ca - v * sa, py = o.cy + u * sa + v * ca;
    const hn = hAt(M, px, py);
    const e = 1.5;
    const gx = (hAt(M1, px + e, py) - hAt(M1, px - e, py)) / (2 * e) * o.vscale, gy = (hAt(M1, px, py + e) - hAt(M1, px, py - e)) / (2 * e) * o.vscale;
    const nl = Math.hypot(gx, gy, 1);
    const lam = (-gx * L[0] - gy * L[1] + L[2]) / nl;
    const i = y * W + x;
    MH[i] = hn; MX[i] = px; MY[i] = py; SH[i] = clamp(0.5 + (lam - L[2]) * 1.5, 0, 1);
  }
  return { D, MH, MX, MY, SH, has, top: new Int16Array(W) };
}

function paintB(r, spec, S) {
  const W = r.w, H = r.h, seed = 5151 + (spec.seed | 0);
  const T = terrainOf(6, { hi: 849 });
  S.seed = seed;
  // the paper beyond the hill: peat-black at the corners, brightening towards the hill's foot
  const cfg = { rot: -0.55, scale: 3.5, sx: 194, sy: 148, cx: 164, cy: 214, vscale: 40, mip: 0, ...(spec.cfg || {}) };
  const sun = { x: -0.7, y: -0.6, z: 0.45 };
  const sl = Math.hypot(sun.x, sun.y, sun.z);
  const o = { ...cfg, light: [sun.x / sl, sun.y / sl, sun.z / sl], horizon: 0, bands: 22, span: 0.92, base: 0.0, seam: 0.78, hazeTo: 4.6, shadeK: 2.2, hazeA: 1e9, hazeB: 2e9, gridDens: 0.75, grid: 25 };
  const B = planMap(r, T, o);
  S.map = colourMap(r, B, o, 1);
  S.stars = [];
  const logo = paintLogo(r, 'CONTOURS', 192, 18, 5, 1);
  const avoid = [{ x: logo.x0, y: logo.y0, w: logo.w + 8, h: logo.h + 8 }, { x: 56, y: 64, w: 280, h: 14 }, { x: 0, y: 166, w: W, h: 50 }];
  gridLabels(r, B, avoid, 4);
  const stoneX = 196, stoneY = 160, stoneH = 80;
  avoid.push({ x: stoneX - 30, y: stoneY - stoneH - 8, w: 60, h: stoneH + 14 });
  spotHeights(r, B, T, 5, avoid, 4);
  const st = paintStandingStone(r, stoneX, stoneY, stoneH, { seed: 11, light: [-0.7, -0.55], elev: 0.42, symbol: 'crescent', tilt: 0.5, taper: [0.74, 0.88], tone: -0.04, glow: 0.3, width: 0.5, layer: 3, shadow: { sx: 1.9, sy: 0.42, dens: 0.95, layerMax: 3 } });
  S.stone = st;
  footPlate(r, W, H, 150);
  S.bands = [mistBand(W, 16, seed + 1, { y: 112, layerMax: 1, speed: 3, dens: 0.5, phase: 1 }), mistBand(W, 14, seed + 2, { y: 158, layerMax: 3, speed: 5, dens: 0.4, phase: 2 })];
  S.logo = logo;
}

// ================================================================================= C: Close
/** The highest ground of each column of a slab of the field (north = far .. south = near), 0..1 of its own range. */
function skyline(T, band) {
  const S = T.size, y0 = Math.floor((S * band) / 3), y1 = Math.floor((S * (band + 1)) / 3) - 1;
  const out = new Float32Array(S);
  for (let x = 0; x < S; x++) { let m = -Infinity; for (let y = y0; y <= y1; y += 3) m = Math.max(m, T.h[y * S + x]); out[x] = m; }
  const raw = Float32Array.from(out);
  const sorted = Array.from(out).sort((a, b) => a - b);
  const lo = sorted[Math.floor(S * 0.05)], hi = Math.max(sorted[S - 1], lo + 0.3);
  for (let x = 0; x < S; x++) out[x] = clamp((out[x] - lo) / (hi - lo), 0, 1);
  out.raw = raw;
  return out;
}
/**
 * One range of hills as a stack of layer tints: from the lit crest down, flat bands of the ramp separated by thin contour lines
 * that follow the crest, shaded on the side away from the sun, a bright rim on the crest.
 */
function ridgeRange(r, tops, o, layer) {
  const W = r.w, H = r.h;
  for (let x = 0; x < W; x++) {
    const top = clamp(tops[x], 2, H - 1);
    const s = (tops[Math.min(W - 1, x + 3)] - tops[Math.max(0, x - 3)]) / 6;              // >0 : the crest falls to the right
    const lit = clamp(0.5 + s * o.sunSide * 0.22, 0, 1);
    for (let y = top; y < H; y++) {
      const d = y - top;
      const band = Math.floor(d / o.bandH), f = (d - band * o.bandH) / o.bandH;
      const t = clamp(o.top - band * o.step - smooth(0.7, 1, f) * o.step + (lit - 0.5) * o.shade, 0, 1);
      let c = rampAt(o.ramp, t, x, y);
      if (d === 0) c = bay(x, y) < 0.8 ? o.rim : o.rim2;
      else if (f < 1 / o.bandH && band > 0 && band < o.lines && bay(x + 2, y) < 0.9) c = o.line;                 // the contour
      if (y > top + o.fade) c = rampAt(o.ramp, clamp(t - (y - top - o.fade) * 0.035, 0, 1), x, y);
      r.px(x, y, c, layer);
    }
  }
}
function paintC(r, spec, S) {
  const W = r.w, H = r.h, seed = 6363 + (spec.seed | 0);
  S.seed = seed;
  const hz = 150;
  // sky: banded, dark above (the logo's ground) and glowing at the low sun on the left
  paintRingSky(r, W, 0, hz + 1, { x: 36, y: 126 }, { bias: 1.25, ax: 0.8, ay: 1.3, pow: 0.72, q: 2.4, peak: 7.4, step: 0.34, line: 0.26 });
  paintStreaks(r, W, 0, hz, seed + 3, 0.7);
  paintSun(r, 36, 126, 12, 2.6, 0);
  S.stars = stars(r, W, seed, 60, 46);
  // ranges receding behind the stone, each from a track's own skyline
  const lv = [5, 5, 4, 5], slab = [0, 1, 1, 2];
  const ramps = [[C.rust, C.ember, C.lamp, C.flame], [C.heather, C.rust, C.ember, C.lamp], [C.blood, C.heather, C.rust, C.ember], [C.ink, C.blood, C.heather, C.rust]];
  const cfgs = [
    { base: 0.62, amp: 0.24, top: 0.95, rim: C.flame, rim2: C.lamp, line: C.ember, lines: 10, bandH: 5 },
    { base: 0.7, amp: 0.22, top: 0.9, rim: C.lamp, rim2: C.ember, line: C.heather, lines: 14, bandH: 6 },
    { base: 0.78, amp: 0.17, top: 0.85, rim: C.ember, rim2: C.rust, line: C.blood, lines: 16, bandH: 6 },
    { base: 0.86, amp: 0.1, top: 0.8, rim: C.rust, rim2: C.heather, line: C.ink, lines: 0, bandH: 8 },
  ];
  S.tops = [];
  const crests = [];
  cfgs.forEach((c, i) => {
    const Tt = terrainOf(lv[i], {});
    const band = skyline(Tt, slab[i]);
    const tops = new Int16Array(W);
    for (let x = 0; x < W; x++) {
      const u = (x / W) * Tt.size * ((spec.cfg && spec.cfg.span) || 1.0) + ((spec.cfg && spec.cfg.offs) || [30, 100, 60, 140])[i], i0 = Math.floor(u), f = u - i0, P = 2 * (Tt.size - 1);
      const at = (k) => { const m = ((k % P) + P) % P; return band[m > Tt.size - 1 ? P - m : m]; };           // mirrored, so the skyline never jumps
      const n = at(i0) * (1 - f) + at(i0 + 1) * f;
      tops[x] = Math.round(c.base * H - Math.pow(n, 1.2) * c.amp * H);
    }
    S.tops.push(tops);
    crests.push({ tops, raw: (x) => { const u = (x / W) * Tt.size * ((spec.cfg && spec.cfg.span) || 1.0) + ((spec.cfg && spec.cfg.offs) || [30, 100, 60, 140])[i], P = 2 * (Tt.size - 1), m = ((Math.round(u) % P) + P) % P; return band.raw[m > Tt.size - 1 ? P - m : m]; }, T: Tt });
    ridgeRange(r, tops, { ramp: ramps[i], bandH: c.bandH, step: 0.1, top: c.top, shade: 0.5, sunSide: -1, rim: c.rim, rim2: c.rim2, line: c.line, lines: c.lines, fade: 30 }, i + 1);
  });
  // the near ground: a flat sheet of the moor with its own hypsometric tints and contours, so the stone's shadow lies across them
  {
    const Tm = terrainOf(4, {});
    const cam = { x: 150, y: 200, ang: -Math.PI / 2 + 0.3, h: 9 };
    const sun = { x: -1, y: -0.2, z: 0.4 }, sl = Math.hypot(sun.x, sun.y, sun.z);
    const o = { tanH: 1.1, horizon: 158, near: 4, far: 900, lod: 60, mip: 1, vscale: 60, light: [sun.x / sl, sun.y / sl, sun.z / sl], bands: 36, span: 0.6, base: 0.4, seam: 0.8, hazeTo: 3.2, shadeK: 2.6, hazeA: 36, hazeB: 120, gridDens: 0.95, grid: 25 };
    const B = sheetMap(r, Tm, cam, o);
    const buf = new Raster(W, H);
    colourMap(buf, B, o, 5);
    for (let x = 0; x < W; x++) {
      const g = Math.round(172 + 3 * Math.sin(x * 0.03 + 1) + 4 * vnoise(x * 0.04, 3, seed + 9));
      for (let y = g; y < H; y++) r.px(x, y, y - g < 1 ? C.heather : buf.get(x, y), 5);
    }
  }
  bleed(r, 40, 146, 140, 0.8, 4);
  footPlate(r, W, H, 188);
  // the logo, right, over the dark sky
  const logo = paintLogo(r, 'CONTOURS', 262, 19, 4, 1);
  S.logo = logo;
  // the stone, big, left of centre, lit from the sun
  S.stone = paintStandingStone(r, 90, 184, 168, { seed: 3, light: [-1, -0.2], elev: 0.4, glow: 0.3, symbol: 'crescent', width: 0.46, layer: 6, shadow: { sx: 2.1, sy: 0.2, dens: 0.9, layerMax: 5 } });
  // spot heights on the highest crests of the two far ranges: a dot on the crest, the real height in metres above it
  {
    const avoid = [{ x: logo.x0, y: logo.y0, w: logo.w + 8, h: logo.h + 8 }, { x: 160, y: 62, w: 210, h: 24 }, { x: 36, y: 12, w: 112, h: 180 }, { x: 150, y: 148, w: 230, h: 22 }];
    for (const [ri, n] of [[0, 2], [1, 2]]) {
      const { tops, raw, T: Tt } = crests[ri];
      const cand = [];
      for (let x = 12; x < W - 24; x++) { let best = true; for (let d = -12; d <= 12; d++) if (tops[x + d] < tops[x]) { best = false; break; } if (best) cand.push(x); }
      cand.sort((a, b) => tops[a] - tops[b]);
      const done = [];
      for (const x of cand) {
        if (done.length >= n) break;
        const m = Math.round(Tt.lo + raw(x) * (Tt.hi - Tt.lo)), txt = String(m), w = smallWidth(txt);
        const box = { x: x - (w >> 1), y: tops[x] - 12, w, h: 5 };
        if (box.x < 3 || box.x + w > W - 4 || box.y < 3 || done.some((d) => Math.abs(d - x) < 50)) continue;
        if (avoid.some((a) => box.x < a.x + a.w + 2 && box.x + w + 2 > a.x && box.y < a.y + a.h + 2 && box.y + 7 > a.y)) continue;
        r.rect(x - 1, tops[x] - 3, 2, 2, C.paper, 5);
        mapLabel(r, txt, box.x, box.y, 5);
        avoid.push(box); done.push(x);
      }
    }
  }
  S.bands = [mistBand(W, 14, seed + 1, { y: 126, layerMax: 2, speed: 3, dens: 0.7, phase: 1 }), mistBand(W, 12, seed + 2, { y: 148, layerMax: 3, speed: 5, dens: 0.6, phase: 2 }), mistBand(W, 12, seed + 3, { y: 168, layerMax: 5, speed: 8, dens: 0.4, phase: 3 })];
}

// ================================================================================= registry
const PAINT = { A: paintA, B: paintB, C: paintC };
export function paintTitleArt(r, spec, S) {
  const v = TITLE_VARIANTS.includes(spec.variant) ? spec.variant : TITLE_DEFAULT;
  S.variant = v;
  (PAINT[v] || paintA)(r, spec, S);
}
/** The incisions breathe: each ember pixel of the stone pulses between lamp, ember and rust on its own slow phase. */
function pulseEmbers(r, st, t) {
  if (!st || !st.embers) return;
  const W = r.w, g = st.glow;
  for (const [x, y, ph] of st.embers) {
    const k = 0.5 + 0.5 * Math.sin(t * 1.3 + ph * 0.55 + x * 0.05);
    r.d[y * W + x] = k > 0.88 ? C.flame : k > 0.55 ? C.lamp : k > 0.22 ? C.ember : (g > 0.3 ? C.rust : C.blood);
  }
}
export function animTitleArt(r, spec, S, t) {
  const W = r.w;
  pulseEmbers(r, S.stone, t);
  for (const s of S.stars || []) { const k = Math.sin(t * 1.5 + s.ph); if (k < 0.7 && r.lay[s.y * W + s.x] === 0 && r.d[s.y * W + s.x] === C.ink) r.d[s.y * W + s.x] = k > 0.1 ? C.paper2 : C.rock; }
  for (const b of S.bands || []) drawMistBand(r, b, t);
  const L = S.logo;
  if (L) {
    const u = (t % 5.5) / 5.5;
    if (u < 0.35) {
      const pos = (u / 0.35) * (L.w + L.h * 1.2) - L.h;
      for (const i of L.face) {
        const d = (i % W - L.x0) - (((i / W) | 0) - L.y0) * 0.7 - pos;
        if (d > 0 && d < 5) r.d[i] = C.paper;
        else if (d > -3 && d <= 0) r.d[i] = lift(r.d[i]);
      }
    }
  }
}
