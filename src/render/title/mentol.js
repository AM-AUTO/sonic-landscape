/**
 * MENTOL: after the holed stone of Men-an-Tol, in winter. A great granite ring, frosted and dark, fills the frame; through its round opening a lone,
 * tall menhir stands far off on a barren, snow-patched peat moor drawn as an OS sheet (contours and a faint grid following the ground in perspective),
 * and beyond the moor the Cairngorm massifs recede in layers, each ridge paler and bluer than the last, under a thin cold overcast sky.
 * BLUE is a second tonal ramp (deepblue steelD steel blue paleblue frost, paired step for step with ink char slate ash rock fog): cold sky-lit shadow,
 * ice and distance are blue, sunlit stone and snow stay neutral grey, so the blue defines contrast. The incised Pictish symbol on the stone is the accent:
 * its grooves glow pale cold blue (frost, with a paleblue edge). No ember here: the screen is greys + blues only.
 *
 * The picture is a REAL 3D RENDER: tools/scenes/mentol.mjs (an SDF ray-marched scene) baked to the palette by tools/bake-title.mjs into
 * ./baked/mentol.js; this module only blits it and adds the live parts: the logo and its glint, drifting mist on the far moor, the groove glow
 * pulsing. Re-bake (`node tools/bake-title.mjs mentol`, about 20 s) to change the sun, the camera, the stone: see the header of the scene file.
 *
 * Layers (from the bake, by distance): 0 sky, mountains and far moor, 1 mid moor, 3 the ring, the menhir and the near moor, 6 the logo. The mist
 * (layerMax 1) therefore never veils the stone.
 *
 * Text on this screen: the logo (the game's name, painted by paintTitleLogo and auto-fitted across the upper ring), the blinking prompt and one small
 * controls line; the foot of the picture is a calm dark ground for them.
 */
import bake from './baked/mentol.js';
import { decodeBaked, blitBaked, pulseBakedEmbers } from './bakedkit.js';
import { paintTitleLogo, animLogo, makeMistBands, animMistBands, paintFootPlate } from './kit.js';

const W = 384;

/** the prompt sits on the dark ground in the foot of the opening; the controls line on the dark foot of the ring */
export const layout = { prompt: { x: 192, y: 177 } };
export const levels = [];

export function paint(r, spec, S) {
  S.baked = decodeBaked(bake);
  blitBaked(r, S.baked);
  paintFootPlate(r, 164, { strength: 0.9, layer: 3 });                                   // calm, dark ground for the two small lines of text
  paintTitleLogo(r, S, { cx: 192, top: 16 });                                           // the game's name, auto-fitted, across the calm upper ring
  S.mist = makeMistBands(W, [{ y: 118, rows: 14, speed: 3, dens: 0.45, layerMax: 1 }, { y: 132, rows: 8, speed: -2, dens: 0.3, layerMax: 1 }], S.seed + 40);
}

export function anim(r, spec, S, t) {
  animMistBands(r, S.mist, t);
  pulseBakedEmbers(r, S.baked, t);
  animLogo(r, S.logo, t);
}
