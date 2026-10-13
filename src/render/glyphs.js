/**
 * Labels and condition glyphs for the discovery layer (HUD chain bar, sheet map).
 * Thin seam over src/game/describe.js and src/text.js (pure, no DOM).
 */
import { conditionGlyph } from '../game/describe.js';
import { TYPE_LABEL, SHORT_LABEL } from '../text.js';

export { SHORT_LABEL };

export function typeLabel(type) { return TYPE_LABEL[type] || String(type).toUpperCase(); }
export function typeShort(type) { return SHORT_LABEL[type] || typeLabel(type); }
/** Short tag for a learned condition key ('approach', 'speed', ...); pass poi.condition for variants. */
export function glyphFor(key, cond) { return conditionGlyph(key, cond); }
