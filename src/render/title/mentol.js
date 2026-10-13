/**
 * MENTOL: after the holed stone of Men-an-Tol. A great granite ring fills the frame (rough, pitted, lichened, lit from the upper left, dark and
 * heavy against the sky); through its round opening a tall tapering menhir stands on a pale hazy moor drawn as an OS sheet (contours and a
 * faint grid following the ground in perspective). The menhir carries an incised Pictish symbol cut as real grooves whose floors glow ember.
 * Greys + the one ember accent (the carving, and the logo's lit edge).
 *
 * The picture is a REAL 3D RENDER: tools/scenes/mentol.mjs (an SDF ray-marched scene) baked to the palette by tools/bake-title.mjs into
 * ./baked/mentol.js; this module only blits it and adds the live parts: the logo and its glint, drifting mist on the far moor, the ember
 * pulse in the carving. Re-bake (one command, about 12 s) to change the sun, the camera, the stone: see the header of the scene file.
 *
 * Layers (from the bake, by distance): 0 sky and far moor, 1 mid moor, 3 the ring, the menhir and the tussocks, 6 the logo. The mist
 * (layerMax 1) therefore never veils the stone.
 */
import bake from './baked/mentol.js';
import { decodeBaked, blitBaked, pulseBakedEmbers } from './bakedkit.js';
import { paintTitleLogo, animLogo, makeMistBands, animMistBands, paintFootPlate, textClear } from './kit.js';

const W = 384;

/** the prompt sits on the dark ground in the foot of the opening; the controls and strapline on the dark foot of the ring */
export const layout = { prompt: { x: 192, y: 177 } };
export const levels = [];

export function paint(r, spec, S) {
  S.baked = decodeBaked(bake);
  blitBaked(r, S.baked);
  paintFootPlate(r, 166, { strength: 0.9, layer: 3 });                                   // calm, dark ground for the three small lines of text
  textClear(r, { x: 70, y: 62, w: 244, h: 16 }, 0.35);                                  // and a quiet patch behind the subtitle
  paintTitleLogo(r, S);
  S.mist = makeMistBands(W, [{ y: 112, rows: 14, speed: 3, dens: 0.5, layerMax: 1 }, { y: 128, rows: 10, speed: -2, dens: 0.35, layerMax: 1 }], S.seed + 40);
}

export function anim(r, spec, S, t) {
  animMistBands(r, S.mist, t);
  pulseBakedEmbers(r, S.baked, t);
  animLogo(r, S.logo, t);
}
