/**
 * STUB (foundation): castlerigg. The real painting replaces paint() / anim(); keep the exports.
 * Placeholder: grey dusk sky, a mono standing stone, static + animated mist, the logo.
 */
import { paintGreyGradient, paintMistBands, animMistBands, makeMistBands, paintTitleLogo, animLogo, monoStone, pulseEmbers, paintFootPlate, paintDitherGlow } from './kit.js';

export const layout = {};
export const levels = [];

export function paint(r, spec, S) {
  paintGreyGradient(r, { x: 0, y: 0, w: r.w, h: 150 }, 0.0, 0.8, { bias: 1.2, streak: 0.8, seed: S.seed });
  paintGreyGradient(r, { x: 0, y: 150, w: r.w, h: 66 }, 0.25, 0.1, { layer: 1 });
  paintDitherGlow(r, 300, 140, 90, null, 1, { ay: 2 });
  S.stone = monoStone(r, 120, 176, 100, { seed: 3, glow: 0.4, layer: 3, shadow: { sx: 1.5, sy: 0.3, dens: 0.9, layerMax: 2 } });
  paintFootPlate(r, 150);
  S.bands = makeMistBands(r.w, [{ y: 128, layerMax: 2, speed: 4, dens: 0.7 }, { y: 160, layerMax: 3, speed: 7, dens: 0.5 }], S.seed);
  paintTitleLogo(r, S);
}
export function anim(r, spec, S, t) {
  pulseEmbers(r, S.stone && S.stone.embers, t);
  animMistBands(r, S.bands, t);
  animLogo(r, S.logo, t);
}
