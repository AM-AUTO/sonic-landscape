/**
 * Labels and condition glyphs for the discovery layer (HUD chain bar, sheet map).
 * Thin seam over src/game/describe.js (pure, no DOM).
 */
import { TYPE_LABEL, conditionGlyph } from '../game/describe.js';

/** Very short forms for the HUD chain bar and the KEY on the sheet. */
export const SHORT_LABEL = {
  trig: 'TRIG', cairn: 'CAIRN', lochan: 'LOCHAN', waterfall: 'FALLS',
  bothy: 'BOTHY', stone: 'STONE', crag: 'CRAG', summit: 'SUMMIT',
};

export function typeLabel(type) { return TYPE_LABEL[type] || String(type).toUpperCase(); }
export function typeShort(type) { return SHORT_LABEL[type] || typeLabel(type); }
/** Short ASCII tag for a learned condition key ('approach', 'speed', ...); pass poi.condition for variants. */
export function glyphFor(key, cond) { return conditionGlyph(key, cond); }
