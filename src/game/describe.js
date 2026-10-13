/**
 * Plain-language descriptions of POI conditions. Pure JS, no DOM.
 * The poetic hints stay in the level files; these are the instructions revealed progressively.
 */

export const TYPE_LABEL = Object.freeze({
  trig: 'TRIG PILLAR', cairn: 'CAIRN', lochan: 'LOCHAN', waterfall: 'WATERFALL',
  bothy: 'BOTHY', stone: 'STANDING STONE', crag: 'CRAG', summit: 'SUMMIT',
});

export const TYPE_ROLE = Object.freeze({
  trig: 'survey pillar · a bright, held chord',
  cairn: 'stacked stones · accreting arpeggio',
  lochan: 'still water · a glassy reflection',
  waterfall: 'falling water · a cascade of notes',
  bothy: 'shelter · field notes and guidance',
  stone: 'standing stone · a deep monolith drone',
  crag: 'rock face · a hard, fractured strike',
  summit: 'the high point · an open apex',
});

/** Lowercase noun for a type, used in sentences ("Wake a trig pillar first"). */
export const TYPE_NOUN = Object.freeze({
  trig: 'trig pillar', cairn: 'cairn', lochan: 'lochan', waterfall: 'waterfall',
  bothy: 'bothy', stone: 'standing stone', crag: 'crag', summit: 'summit',
});

/**
 * Plain English, imperative, one short sentence, naming the control.
 * @param {string} key  condition key (approach|speed|dwell|climb|time|requires)
 * @param {object} cond the POI's condition object
 * @param {object} [level] unused for now; reserved for level-specific wording
 */
export function describeCondition(key, cond, level) { // eslint-disable-line no-unused-vars
  cond = cond || {};
  switch (key) {
    case 'approach':
      return cond.approach === 'ascending' ? 'Climb up to it from below.' : 'Come down to it from higher ground.';
    case 'speed':
      return cond.speed === 'fast' ? 'Arrive at a run: hold SHIFT, downhill helps.' : 'Approach slowly: hold SPACE as you walk.';
    case 'dwell': {
      const n = cond.dwell > 0 ? cond.dwell : 3;
      return `Stand still beside it for ${n} seconds.`;
    }
    case 'climb': {
      const n = cond.climb > 0 ? cond.climb : 1;
      return `Climb ${n} thick contour line${n === 1 ? '' : 's'} without stepping down, then arrive.`;
    }
    case 'time': {
      const ph = cond.time || 'day';
      return `Return at ${ph}. Stand still holding SPACE to pass time.`;
    }
    case 'requires': {
      const noun = TYPE_NOUN[cond.requires] || String(cond.requires || 'artefact');
      return `Wake a ${noun} first; it must still be sounding.`;
    }
    default:
      return 'Something about the way you arrive is not yet right.';
  }
}

/** Short ASCII tag for the map. Pass `cond` to resolve approach/speed/time variants. */
export function conditionGlyph(key, cond) {
  cond = cond || {};
  switch (key) {
    case 'approach': return cond.approach === 'ascending' ? 'ASC' : 'DESC';
    case 'speed': return cond.speed === 'fast' ? 'RUN' : 'SLOW';
    case 'dwell': return 'WAIT';
    case 'climb': return 'CLIMB';
    case 'time':
      return cond.time === 'dusk' ? 'DUSK' : cond.time === 'night' ? 'NIGHT' : cond.time === 'dawn' ? 'DAWN' : cond.time === 'day' ? 'DAY' : 'DAY';
    case 'requires': return 'AFTER';
    default: return '?';
  }
}
