/**
 * Crisp 1px drawing helpers (fillRect only: never a stroke, never AA).
 */
import { PAL, PAL_U32, BAYER4, quantizeHex, PAL_NAMES } from './palette.js';

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}
export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, 1, 1);
}
/** 1px outline */
export function frame(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y + 1, 1, h - 2);
  ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
}
export function hline(ctx, x, y, w, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, 1); }
export function vline(ctx, x, y, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, h); }

/** Bresenham line, 1px, no AA. */
export function pline(ctx, x0, y0, x1, y1, color) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Pixel circle outline (midpoint). */
export function pcircle(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  let x = r, y = 0, err = 1 - r;
  while (x >= y) {
    for (const [a, b] of [[x, y], [y, x], [-x, y], [-y, x], [x, -y], [y, -x], [-x, -y], [-y, -x]]) ctx.fillRect(cx + a, cy + b, 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
}

/** Filled pixel disc. */
export function pdisc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    const w = Math.floor(Math.sqrt(r * r + r * 0.6 - y * y));
    ctx.fillRect(cx - w, cy + y, w * 2 + 1, 1);
  }
}

/** Dotted pixel circle (every other step), no AA. */
export function pcircleDotted(ctx, cx, cy, r, color, phase = 0) {
  ctx.fillStyle = color;
  const n = Math.max(12, Math.round(r * 6.28 * 1.2));
  let last = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    const k = x + ',' + y;
    if (k === last) continue;
    last = k;
    if (((i + phase) % 4) < 2) ctx.fillRect(x, y, 1, 1);
  }
}

/** Ordered-dither fill: density 0..1 of `color` over the rect (pattern anchored to screen coords). */
export function ditherRect(ctx, x, y, w, h, color, density, ox = 0, oy = 0) {
  if (density <= 0) return;
  ctx.fillStyle = color;
  if (density >= 1) { ctx.fillRect(x, y, w, h); return; }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const t = (BAYER4[(((y + j + oy) & 3) << 2) | ((x + i + ox) & 3)] + 0.5) / 16;
      if (t < density) ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/** OS-legend style panel: fill, 1px ink border, optional hard shadow. */
export function panel(ctx, x, y, w, h, { fill = PAL.paper, border = PAL.ink, shadow = PAL.night, inner = null } = {}) {
  if (shadow) { ctx.fillStyle = shadow; ctx.fillRect(x + 1, y + 1, w, h); }
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  frame(ctx, x, y, w, h, border);
  if (inner) frame(ctx, x + 2, y + 2, w - 4, h - 4, inner);
}

/** Resolve a palette name or #hex into a palette hex string and u32. */
export function resolveColor(c, fallback = 'magenta') {
  if (!c) c = fallback;
  if (PAL[c]) return { name: c, hex: PAL[c], u32: PAL_U32[c] };
  if (typeof c === 'string' && c[0] === '#') { const n = quantizeHex(c); return { name: n, hex: PAL[n], u32: PAL_U32[n] }; }
  return { name: fallback, hex: PAL[fallback], u32: PAL_U32[fallback] };
}

/** Tick ruler along a horizontal edge. */
export function ruler(ctx, x, y, w, step, color, tall = 2, short = 1, majorEvery = 4) {
  ctx.fillStyle = color;
  for (let i = 0, k = 0; i <= w; i += step, k++) ctx.fillRect(x + i, y - (k % majorEvery === 0 ? tall : short) + 1, 1, k % majorEvery === 0 ? tall : short);
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export { PAL_NAMES };
