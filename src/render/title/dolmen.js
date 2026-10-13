/**
 * STUB (foundation): dolmen. The real painting replaces paint() / anim(); keep the exports.
 * Placeholder: grey sky with an ember sun glow low on the right, two mono stones, the logo.
 */
import { paintGreyGradient, paintDitherGlow, paintTitleLogo, animLogo, monoStone, paintFootPlate, pulseEmbers } from './kit.js';
import { PAL_U32 as C } from '../palette.js';

export const layout = {};
export const levels = [];

export function paint(r, spec, S) {
  paintGreyGradient(r, { x: 0, y: 0, w: r.w, h: 180 }, 0.05, 0.9, { bias: 1.4, flat: 0.45, seed: S.seed });
  paintGreyGradient(r, { x: 0, y: 180, w: r.w, h: 36 }, 0.2, 0.05, { layer: 1 });
  paintDitherGlow(r, 290, 140, 110, C.ember, 1, { pow: 2.2, strength: 0.8, core: C.snow, coreR: 0.08 });
  S.stone = monoStone(r, 90, 190, 110, { seed: 5, glow: 0.7, layer: 3, light: [1, -0.2], shadow: { sx: -1.2, sy: 0.2, dens: 0.9, layerMax: 2 } });
  paintFootPlate(r, 160);
  paintTitleLogo(r, S);
}
export function anim(r, spec, S, t) {
  pulseEmbers(r, S.stone && S.stone.embers, t);
  animLogo(r, S.logo, t);
}
