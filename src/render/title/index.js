/**
 * The five start screens (title covers), greyscale with one ember accent. Registry + dispatch.
 *
 *   TITLE_VARIANTS  ['castlerigg', 'shelter', 'mentol', 'dolmen', 'menhir']  (ui.titleVariant / spec.variant pick one)
 *   TITLE_DEFAULT   'castlerigg'
 *   TITLE_LAYOUT    per variant: where screens.js draws the small lines of text over the art (DEFAULT_LAYOUT merged with that module's `layout`)
 *   TITLE_LEVELS    per variant: the tracks whose real heightfields the art draws on (default none; the panel cache then needs no 'warm' build)
 *   paintTitleArt(r, spec, S) / animTitleArt(r, spec, S, t)   dispatch to the variant's module
 *
 * EACH VARIANT MODULE (castlerigg.js, shelter.js, mentol.js, dolmen.js, menhir.js) EXPORTS EXACTLY:
 *   export const layout = { ... };           // optional: overrides of DEFAULT_LAYOUT below (merged one level deep; `colors` merges key by key)
 *   export const levels = [];                // optional: track indices whose heightfields it needs (fieldOf(i)); the panel cache pre-warms them
 *   export function paint(r, spec, S)        // paint the whole 384x216 Raster `r` once (cached base). Put everything the animation needs into S.
 *   export function anim(r, spec, S, t)      // cheap per-frame pass on a COPY of the base (a few ms at most): mist, ember pulse, glints, twinkle
 * A module imports from './kit.js' (and, if it wants, ../stone.js, ../artkit.js, ../titleart.js), writes only into `r` and `S`, uses no
 * Math.random / Date, and writes only the palette colours: ink char slate ash rock fog snow + ember (paper / paper2 as light endpoints).
 * The registry sets S.variant and S.seed (a per-variant base + spec.seed) before calling paint. The logo is NOT painted for you: call
 * paintTitleLogo(r, S) (kit.js) wherever it belongs, and animLogo(r, S.logo, t) from anim() if you want the glint.
 */
import * as castlerigg from './castlerigg.js';
import * as shelter from './shelter.js';
import * as mentol from './mentol.js';
import * as dolmen from './dolmen.js';
import * as menhir from './menhir.js';

export const TITLE_VARIANTS = Object.freeze(['castlerigg', 'shelter', 'mentol', 'dolmen', 'menhir']);
export const TITLE_DEFAULT = 'castlerigg';
const MODS = { castlerigg, shelter, mentol, dolmen, menhir };

/**
 * Shared defaults for the small lines of text screens.js draws over the art (all positions in framebuffer px, 384x216).
 * The title screen shows only the logo (TAE BE WALKIT, painted by paintTitleLogo), the blinking prompt and one small controls line.
 *   prompt    { x, y }       centred blinking 'PRESS ENTER' with an accent arrow either side
 *   controls  y              small-font controls line, centred on the screen
 *   colors    PAL names: prompt, promptHalo, arrow, controls, halo
 *   hide      names of elements not to draw: 'prompt' 'controls'
 */
export const DEFAULT_LAYOUT = Object.freeze({
  prompt: Object.freeze({ x: 192, y: 177 }),
  controls: 191,
  colors: Object.freeze({ prompt: 'snow', promptHalo: 'ink', arrow: 'paleblue', controls: 'rock', halo: 'ink' }),
  hide: Object.freeze([]),
});

function mergeLayout(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    const b = base[k];
    out[k] = b && v && typeof b === 'object' && typeof v === 'object' && !Array.isArray(b) && !Array.isArray(v) ? { ...b, ...v } : v;
  }
  const freezeDeep = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(freezeDeep); Object.freeze(o); } return o; };
  return freezeDeep(out);
}

export const TITLE_LAYOUT = Object.freeze(Object.fromEntries(TITLE_VARIANTS.map((v) => [v, mergeLayout(DEFAULT_LAYOUT, MODS[v].layout)])));
export const TITLE_LEVELS = Object.freeze(Object.fromEntries(TITLE_VARIANTS.map((v) => [v, Object.freeze([...(MODS[v].levels || [])])])));

const SEED_BASE = Object.freeze(Object.fromEntries(TITLE_VARIANTS.map((v, i) => [v, 7000 + i * 1000])));
const variantOf = (spec) => (TITLE_VARIANTS.includes(spec.variant) ? spec.variant : TITLE_DEFAULT);

export function paintTitleArt(r, spec, S) {
  const v = variantOf(spec);
  S.variant = v;
  S.seed = SEED_BASE[v] + (spec.seed | 0);
  MODS[v].paint(r, spec, S);
}
export function animTitleArt(r, spec, S, t) {
  MODS[S.variant || variantOf(spec)].anim(r, spec, S, t);
}
