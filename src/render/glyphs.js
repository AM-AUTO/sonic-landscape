/**
 * Labels and condition glyphs for the discovery layer (HUD chain bar, sheet map).
 * Single seam to src/game/describe.js: that module wins once it has loaded;
 * the local tables below are a fallback so rendering never depends on it.
 * TODO: drop the fallbacks (and the dynamic import) once describe.js is stable.
 */
export const FALLBACK_LABEL = {
  trig: 'TRIG PILLAR', cairn: 'CAIRN', lochan: 'LOCHAN', waterfall: 'WATERFALL',
  bothy: 'BOTHY', stone: 'STANDING STONE', crag: 'CRAG', summit: 'SUMMIT',
};
/** Very short forms for the HUD chain bar. */
export const SHORT_LABEL = {
  trig: 'TRIG', cairn: 'CAIRN', lochan: 'LOCHAN', waterfall: 'FALLS',
  bothy: 'BOTHY', stone: 'STONE', crag: 'CRAG', summit: 'SUMMIT',
};

let D = null;
try {
  import('../game/describe.js').then((m) => { D = m; }).catch(() => { /* not written yet: fallbacks apply */ });
} catch { /* very old runtime */ }

export function typeLabel(type) {
  return (D && D.TYPE_LABEL && D.TYPE_LABEL[type]) || FALLBACK_LABEL[type] || String(type).toUpperCase();
}
export function typeShort(type) { return SHORT_LABEL[type] || typeLabel(type); }

function fallbackGlyph(key) {
  const [k, v] = String(key).split(':');
  if (k === 'approach') return v === 'ascending' ? 'ASC' : 'DESC';
  if (k === 'speed') return v === 'fast' ? 'RUN' : 'SLOW';
  if (k === 'dwell') return 'WAIT';
  if (k === 'climb') return 'CLIMB';
  if (k === 'time') return { dawn: 'DAWN', day: 'DAY', dusk: 'DUSK', night: 'NIGHT' }[v] || 'DAY';
  if (k === 'requires') return 'AFTER';
  return String(key).slice(0, 5).toUpperCase();
}
/** Short ASCII tag for a learned condition key; cond (poi.condition) is optional. */
export function glyphFor(key, cond) {
  if (D && D.conditionGlyph) { try { const g = D.conditionGlyph(key, cond); if (g) return g; } catch { /* fall through */ } }
  return fallbackGlyph(key);
}
