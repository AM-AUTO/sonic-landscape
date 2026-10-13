/**
 * STUB (foundation): shelter. The real painting replaces paint() / anim(); keep the exports.
 * Placeholder: flat grey wall of strata + lichen under a pale sky, the logo.
 */
import { paintGreyGradient, paintStrata, paintLichen, paintTitleLogo, animLogo, makeMistBands, animMistBands, paintFootPlate } from './kit.js';

export const layout = {};
export const levels = [];

export function paint(r, spec, S) {
  paintGreyGradient(r, { x: 0, y: 0, w: r.w, h: 216 }, 0.85, 0.2, { bias: 0.9, flat: 0.6, streak: 0.5, seed: S.seed });
  const wall = { x: 40, y: 90, w: 300, h: 126 };
  paintGreyGradient(r, wall, 0.55, 0.25, { layer: 2 });
  paintStrata(r, wall, S.seed + 1, { spacing: [6, 12], cracks: 5 });
  paintLichen(r, wall, S.seed + 2, { density: 0.8 });
  paintFootPlate(r, 150);
  S.bands = makeMistBands(r.w, [{ y: 80, layerMax: 1, speed: 3, dens: 0.6 }], S.seed);
  paintTitleLogo(r, S);
}
export function anim(r, spec, S, t) {
  animMistBands(r, S.bands, t);
  animLogo(r, S.logo, t);
}
