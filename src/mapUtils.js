/**
 * Sonic Landscape – Pure utility functions
 *
 * These are extracted from map.js so they can be unit-tested without a DOM
 * or Leaflet dependency.
 */

/**
 * Escape HTML special characters to prevent XSS.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitize(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Calculate the fill percentage for the sound level bar.
 * Clamped to [0, 100]; assumes max reference of 100 dB.
 *
 * @param {number} decibels
 * @returns {number} 0–100
 */
function soundLevelPercent(decibels) {
  if (typeof decibels !== "number" || isNaN(decibels)) return 0;
  return Math.min(100, Math.max(0, Math.round((decibels / 100) * 100)));
}

/**
 * Derive the CSS hue for the sound bar fill colour.
 * Maps 0 dB → green (hue 120) and 100 dB → red (hue 0).
 *
 * @param {number} decibels
 * @returns {number} hue degrees 0–120
 */
function soundLevelHue(decibels) {
  const pct = soundLevelPercent(decibels);
  return Math.max(0, Math.round(120 - pct * 1.2));
}

/**
 * Return whether markers should be visible at the given zoom level.
 *
 * @param {number} zoom
 * @param {number} [threshold=3]
 * @returns {boolean}
 */
function markersVisibleAtZoom(zoom, threshold = 3) {
  return zoom >= threshold;
}

/**
 * Compute fitBounds padding array that accounts for a side panel.
 *
 * @param {number} panelWidth   Width of the detail panel in pixels
 * @param {number} [base=40]    Base padding on all other sides
 * @returns {[number, number, number, number]} [top, right, bottom, left]
 */
function boundspadding(panelWidth, base = 40) {
  return [base, panelWidth + base / 2, base, base];
}

/**
 * Find a location entry by id from an array.
 * Returns null (not undefined) when not found to make guard-clauses explicit.
 *
 * @param {Object[]} locations
 * @param {string}   id
 * @returns {Object|null}
 */
function findLocationById(locations, id) {
  return locations.find((l) => l.id === id) ?? null;
}

/**
 * Format coordinates as a human-readable string.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
function formatCoords(lat, lng) {
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

// CommonJS export for Jest; safe no-op in browser context
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sanitize,
    soundLevelPercent,
    soundLevelHue,
    markersVisibleAtZoom,
    boundspadding,
    findLocationById,
    formatCoords,
  };
}
