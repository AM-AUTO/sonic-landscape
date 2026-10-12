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

/** Artefact names, keyed by POI type. */
export const ARTEFACT_NAMES = Object.freeze({
  trig: 'Triangulation', cairn: 'Accretion', lochan: 'Reflection', waterfall: 'Cascade',
  bothy: 'Hearth', stone: 'Monolith', crag: 'Fracture', summit: 'Apex',
});

export const MAP_SIZE = 256;        // cells per side
export const CELL_METERS = 40;      // 256 * 40 m = 10.24 km
export const CELL_PX = 4;           // baked map pixels per cell (map canvas = 1024 px)
export const GRID_CELLS = 25;       // 1 km grid = 25 cells
export const SCREEN_W = 384;        // internal framebuffer
export const SCREEN_H = 216;

export const RESONANCE_SECONDS = 90; // how long a fully-triggered artefact keeps resonating
export const DAY_SECONDS = 360;      // full dawn→day→dusk→night cycle

/** timeOfDay ∈ [0,1): 0 dawn, .25 day, .5 dusk, .75 night. Returns phase name. */
export function dayPhase(tod) {
  const p = ((tod % 1) + 1) % 1;
  return p < 0.25 ? 'dawn' : p < 0.5 ? 'day' : p < 0.75 ? 'dusk' : 'night';
}
