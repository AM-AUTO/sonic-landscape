/**
 * shelter: a ruined dry-stone shelter in a glen, a real 3D render baked to the palette (tools/scenes/shelter.mjs, `node tools/bake-title.mjs shelter`).
 * After the photograph of the bothy ruin: slab walls laid in uneven courses, a heavy flat lintel over a low black doorway, a tussock-turf roof, cairns and
 * a standing stone and long grass in front, snow-patched hills going back under a pale cloudy sky. The hills carry thin OS contour lines and a faint
 * 100 m grid, painted on the terrain in the renderer so they follow the land in perspective.
 * Greys + ONE ember accent, used once: the small glow deep inside the doorway (the same signal as a bothy window on the game's map); apart from that
 * only the carved logo's lit edge is ember.
 *
 * The picture itself is data (baked/shelter.js, about 35 KB); here it is only blitted, and the cheap per-frame life is added on top: drifting mist
 * on the far layers, the glint sweeping the logo, the doorway ember breathing.
 */
import bake from './baked/shelter.js';
import { decodeBaked, blitBaked, pulseBakedEmbers } from './bakedkit.js';
import { paintTitleLogo, animLogo, paintMistBands, animMistBands, paintFootPlate, textClear } from './kit.js';

export const layout = { prompt: { x: 192, y: 177 }, colors: { subtitle: 'snow' } };
export const levels = [];

export function paint(r, spec, S) {
  S.baked = decodeBaked(bake);
  blitBaked(r, S.baked);
  // the foot: calm dark ground under the prompt / controls / strapline; a little clearing behind the subtitle
  paintFootPlate(r, 168, { strength: 0.38 });
  textClear(r, { x: 0, y: 186, w: r.w, h: 30 }, 0.25);
  paintTitleLogo(r, S);
  // mist hangs on the far layers only (layerMax 1): the hut, cairns and grass stay in front of it
  S.mist = paintMistBands(r, [{ y: 88, rows: 24, dens: 0.55, layerMax: 1, speed: 3 }, { y: 112, rows: 14, dens: 0.5, layerMax: 1, speed: -4 }], S.seed);
}

export function anim(r, spec, S, t) {
  animMistBands(r, S.mist, t);
  pulseBakedEmbers(r, S.baked, t);
  animLogo(r, S.logo, t);
}
