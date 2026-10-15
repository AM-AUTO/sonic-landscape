/**
 * Per-level look: the data that gives each sheet its own print, light, cartography and atmosphere.
 *
 *   level.look = {
 *     paper: 'paper' | 'paper2' | 'fog' | 'frost' | 'snow'          season print (default 'paper')
 *     light: { az: 315, el: 45, strength: 1 }                       hillshade sun: azimuth in degrees (0 = N,
 *                                                                   clockwise), elevation in degrees, strength 0..1.5
 *     signature: [ ...names ]                                       opt-in cartography (SIGNATURES) and atmosphere
 *                                                                   (ATMOSPHERES) effects, by name
 *     // signature parameters, all in map cells:
 *     tidalRace: { x, y, r }        dam: { x0, y0, x1, y1 }        castle: { x, y, name }
 *     railway: [[x, y], ...] | { points: [[x, y], ...], halts: [{ x, y, name }] }
 *     shielings: [[x, y], ...]      gabbro: { x, y, r }            redScree: { x, y, r }
 *     boulders: { x, y, r }         pineRibbon: { x, y, r }        hidden: { x, y, r, name? }
 *     gullySnow: { above }          (metres; default season.snowline or 62% of the relief)
 *     seaFret: { from: 'W' }        cloudCap: { above: 0.7 }       inversion: { top: 0.32 }
 *   }
 * A level without `look` renders exactly as before (same pixels).
 */
import { PAL, PAL_U32 } from './palette.js';

/** Cartographic signatures drawn into the baked sheet. */
export const SIGNATURES = Object.freeze([
  'tidalRace', 'soundings', 'shingle', 'bracken', 'dam', 'castle', 'railway', 'fieldWalls', 'shieling', 'pineRibbon',
  'iceLochans', 'riverIce', 'boulders', 'blueContoursOnSnow', 'gabbro', 'redScree', 'spate', 'gullySnow', 'hiddenValley',
]);
/** Atmosphere effects drawn live by fx.js (also selectable per level id in fx WEATHER[id].effects). */
export const ATMOSPHERES = Object.freeze([
  'seaFret', 'whirlpool', 'cloudCap', 'inversion', 'frostGlint', 'squalls', 'deer', 'whiteout', 'aurora', 'spindrift',
  'storm', 'clearing', 'thawMist', 'firstSnow',
]);

/**
 * Season prints. base = the sheet's ground, shade / deep = relief tones on it, snowShade / snowDeep = relief on snow
 * cover, rock = the fill of bare rock, ice = the fill of a frozen lochan (palette names); relief scales the shade
 * dither on the darker prints so the sheet stays light; contour / contourIdx (optional) recolour the contour lines.
 */
export const PAPERS = Object.freeze({
  paper: Object.freeze({ base: 'paper', shade: 'paper2', deep: 'fog', snowShade: 'paper2', snowDeep: 'rock', rock: 'rock', ice: 'frost', relief: 1 }),
  paper2: Object.freeze({ base: 'paper2', shade: 'fog', deep: 'rock', snowShade: 'fog', snowDeep: 'rock', rock: 'rock', ice: 'frost', relief: 0.85 }),
  fog: Object.freeze({ base: 'fog', shade: 'rock', deep: 'ash', snowShade: 'frost', snowDeep: 'paleblue', rock: 'slate', ice: 'frost', relief: 0.42,
    contour: 'contourIdx', contourIdx: 'char' }),   // grey paper: darker lines and rock for value separation
  frost: Object.freeze({ base: 'frost', shade: 'paleblue', deep: 'blue', snowShade: 'paleblue', snowDeep: 'blue', rock: 'rock', ice: 'snow', relief: 0.9 }),
  snow: Object.freeze({ base: 'snow', shade: 'frost', deep: 'paleblue', snowShade: 'frost', snowDeep: 'paleblue', rock: 'rock', ice: 'frost', relief: 1 }),
});

export const DEFAULT_LIGHT = Object.freeze({ az: 315, el: 45, strength: 1 });

const lookCache = new WeakMap();
const NO_LOOK = Object.freeze({
  present: false, paper: 'paper', print: PAPERS.paper, light: DEFAULT_LIGHT, legacyRelief: true,
  signature: Object.freeze([]), sig: Object.freeze(new Set()), raw: Object.freeze({}),
});

/** Normalised look for a level (or a world carrying one). Missing look -> NO_LOOK (the legacy sheet). */
export function lookOf(levelOrWorld) {
  let lv = levelOrWorld;
  if (lv && lv.level && !lv.look) lv = lv.level;
  const raw = lv && lv.look;
  if (!raw || typeof raw !== 'object') return NO_LOOK;
  const hit = lookCache.get(raw);
  if (hit) return hit;
  const paper = PAPERS[raw.paper] ? raw.paper : 'paper';
  const L = raw.light || {};
  const num = (v, d, a, b) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
  const light = Object.freeze({
    az: ((num(L.az, DEFAULT_LIGHT.az, -1e9, 1e9) % 360) + 360) % 360,
    el: num(L.el, DEFAULT_LIGHT.el, 1, 89),
    strength: num(L.strength, DEFAULT_LIGHT.strength, 0, 1.5),
  });
  const signature = Object.freeze(Array.isArray(raw.signature) ? raw.signature.filter((s) => typeof s === 'string') : []);
  const out = Object.freeze({
    present: true, paper, print: PAPERS[paper], light,
    legacyRelief: paper === 'paper' && !raw.light,
    signature, sig: Object.freeze(new Set(signature)), raw,
  });
  lookCache.set(raw, out);
  return out;
}

/** Css colour and u32 of the sheet's ground (label haloes, knock-outs). */
export function paperCss(look) { return PAL[look.print.base]; }
export function paperU32(look) { return PAL_U32[look.print.base]; }
