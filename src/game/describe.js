/**
 * Plain-language descriptions of POI conditions. Pure JS, no DOM.
 * The poetic hints stay in the level files; these are the instructions revealed progressively.
 * All wording comes from src/text.js.
 */
import { HINT, PHASE_WORD, CONDITION_TAG, TYPE_LABEL, TYPE_ROLE, TYPE_NOUN, fmt } from '../text.js';

// Display text lives in src/text.js; re-exported here so existing imports keep working.
export { TYPE_LABEL, TYPE_ROLE, TYPE_NOUN };

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
      return cond.approach === 'ascending' ? HINT.ascending : HINT.descending;
    case 'speed':
      return cond.speed === 'fast' ? HINT.fast : HINT.slow;
    case 'dwell': {
      const n = cond.dwell > 0 ? cond.dwell : 3;
      return fmt(HINT.dwell, { n });
    }
    case 'climb': {
      const n = cond.climb > 0 ? cond.climb : 1;
      return fmt(n === 1 ? HINT.climbOne : HINT.climbMany, { n });
    }
    case 'time': {
      const ph = cond.time || 'day';
      return fmt(HINT.time, { phase: PHASE_WORD[ph] || ph });
    }
    case 'requires': {
      const noun = TYPE_NOUN[cond.requires] || String(cond.requires || 'artefact');
      return fmt(HINT.requires, { type: noun });
    }
    default:
      return HINT.fallback;
  }
}

/** Short tag for the map. Pass `cond` to resolve approach/speed/time variants. */
export function conditionGlyph(key, cond) {
  cond = cond || {};
  const T = CONDITION_TAG;
  switch (key) {
    case 'approach': return cond.approach === 'ascending' ? T.ascending : T.descending;
    case 'speed': return cond.speed === 'fast' ? T.fast : T.slow;
    case 'dwell': return T.dwell;
    case 'climb': return T.climb;
    case 'time': return T.time[cond.time] || T.time.day;
    case 'requires': return T.requires;
    default: return T.unknown;
  }
}
