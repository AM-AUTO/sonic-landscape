/** Shared constants. Every module imports from here — do not duplicate. */

/** Land-cover codes stored in World.cover (Uint8Array). */
export const COVER = Object.freeze({
  MOOR: 0,     // open heather / grass
  PATH: 1,     // footpath / track
  BOG: 2,      // peat bog, marsh
  SCREE: 3,    // loose stone below crags
  CRAG: 4,     // cliff — impassable
  SNOW: 5,     // snowfield
  WOOD: 6,     // coniferous woodland (Caledonian pine)
  SHALLOW: 7,  // wadeable water (lochan edges, burns)
  DEEP: 8,     // deep loch — impassable
  ROCK: 9,     // bare rock / slab, passable
});
export const COVER_NAMES = ['moor', 'path', 'bog', 'scree', 'crag', 'snow', 'wood', 'shallow', 'deep', 'rock'];

/** POI / artefact types. */
export const POI_TYPES = Object.freeze(['trig', 'cairn', 'lochan', 'waterfall', 'bothy', 'stone', 'crag', 'summit']);

/** Artefact names, keyed by POI type. Display text lives in src/text.js. */
export { ARTEFACT_NAMES } from '../text.js';

export const MAP_SIZE = 384;        // cells per side
export const CELL_METERS = 40;      // 384 * 40 m = 15.36 km
export const CELL_PX = 4;           // baked map pixels per cell (map canvas = 1536 px)
export const GRID_CELLS = 25;       // 1 km grid = 25 cells
export const SCREEN_W = 384;        // internal framebuffer
export const SCREEN_H = 216;

export const RESONANCE_SECONDS = 90; // how long a fully-triggered artefact keeps resonating
export const DAY_SECONDS = 360;      // full dawn→day→dusk→night cycle

/**
 * Seasons. A level's `season` sets how the day cycle divides: shares of dawn, day, dusk and night
 * (in that order from timeOfDay 0), summing to 1. With no season every phase gets a quarter, as before.
 *   season: { night: 0.66, dawn: 0.08, dusk: 0.08, startTime?, snowline? }   (day = the remainder)
 */
export const DEFAULT_SEASON = Object.freeze({ dawn: 0.25, day: 0.25, dusk: 0.25, night: 0.25 });
const seasonCache = new WeakMap();
/** Normalised { dawn, day, dusk, night } shares for a season object (or a level carrying one). */
export function seasonOf(s) {
  if (s && s.season) s = s.season;
  if (!s || typeof s !== 'object') return DEFAULT_SEASON;
  const hit = seasonCache.get(s);
  if (hit) return hit;
  const num = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
  const night = Math.min(0.9, num(s.night, 0.25));
  const dawn = num(s.dawn, 0.25), dusk = num(s.dusk, 0.25);
  const day = Number.isFinite(s.day) ? s.day : Math.max(0.02, 1 - night - dawn - dusk);
  const sum = dawn + day + dusk + night;
  const out = Object.freeze({ dawn: dawn / sum, day: day / sum, dusk: dusk / sum, night: night / sum });
  seasonCache.set(s, out);
  return out;
}
/** Start timeOfDay for a level: level.season.startTime, else level.startTime, else 0.05 (early dawn). */
export function startTimeOf(level) {
  const st = level && level.season && level.season.startTime;
  if (Number.isFinite(st)) return st;
  return level && Number.isFinite(level.startTime) ? level.startTime : 0.05;
}
/** Phase boundaries [endDawn, endDay, endDusk] in timeOfDay units. */
export function phaseBounds(s) {
  const q = seasonOf(s);
  return [q.dawn, q.dawn + q.day, q.dawn + q.day + q.dusk];
}
/** Centre of each phase in timeOfDay units ({ dawn, day, dusk, night }). */
export function phaseCentres(s) {
  const q = seasonOf(s), [a, b, c] = phaseBounds(s);
  return { dawn: a / 2, day: a + q.day / 2, dusk: b + q.dusk / 2, night: (c + q.night / 2) % 1 };
}
/** timeOfDay ∈ [0,1) → 'dawn' | 'day' | 'dusk' | 'night'. `season` (or a level) is optional: quarters without it. */
export function dayPhase(tod, season) {
  const p = ((tod % 1) + 1) % 1;
  const [a, b, c] = phaseBounds(season);
  return p < a ? 'dawn' : p < b ? 'day' : p < c ? 'dusk' : 'night';
}
