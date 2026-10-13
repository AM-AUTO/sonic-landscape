/**
 * STUB (foundation): menhir. The real painting replaces paint() / anim(); keep the exports.
 * Placeholder: a huge mono stone seen from below, covered in extra lichen, against a pale sky, the logo.
 */
import { paintGreyGradient, paintLichen, stoneMask, paintTitleLogo, animLogo, monoStone, paintFootPlate, pulseEmbers } from './kit.js';

export const layout = {};
export const levels = [];

export function paint(r, spec, S) {
  paintGreyGradient(r, { x: 0, y: 0, w: r.w, h: r.h }, 0.9, 0.5, { bias: 0.8, streak: 0.6, seed: S.seed });
  S.stone = monoStone(r, 250, 230, 240, { seed: 9, glow: 0.35, width: 0.5, layer: 3, lichen: 1.4, light: [-1, -0.4], symbol: 'none' });
  paintLichen(r, stoneMask(S.stone), S.seed + 3, { density: 0.7, size: [3, 8], layer: 3 });
  paintFootPlate(r, 170);
  paintTitleLogo(r, S, { cx: 110, top: 24, scale: 4 });
}
export function anim(r, spec, S, t) {
  pulseEmbers(r, S.stone && S.stone.embers, t);
  animLogo(r, S.logo, t);
}
