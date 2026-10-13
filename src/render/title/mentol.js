/**
 * STUB (foundation): mentol. The real painting replaces paint() / anim(); keep the exports.
 * Placeholder: a greyscale contour sheet (fbm hill) with grid, spot heights and one ember contour, the logo.
 */
import { paintContourField, paintTitleLogo, animLogo, fbm, clamp, paintFootPlate, textClear } from './kit.js';

export const layout = {};
export const levels = [];

export function paint(r, spec, S) {
  const sd = S.seed;
  paintContourField(r, (x, y) => clamp(fbm(x * 0.012, y * 0.014, sd, 4) * 1.5 - 0.3, 0, 1), { bands: 18, grid: 24, gridOrigin: [10, 6], spots: 5, metres: [180, 920], accent: 0.55, avoid: [{ x: 60, y: 14, w: 270, h: 54 }] });
  paintFootPlate(r, 150);
  paintTitleLogo(r, S);
}
export function anim(r, spec, S, t) {
  animLogo(r, S.logo, t);
}
