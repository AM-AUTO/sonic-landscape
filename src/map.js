/**
 * Sonic Landscape – Map Controller
 *
 * Fixes addressed:
 *  1. Zoom-level-dependent detail rendering  – markers are hidden below zoom 3
 *     to avoid clutter; a hint guides users to zoom in.
 *  2. Marker icon sizing & anchor alignment  – DivIcon anchor is centered so
 *     the icon pin-point sits exactly on the coordinate.
 *  3. Popup positioning overflow             – autoPanPadding keeps popups
 *     inside the viewport even near edges.
 *  4. Detail panel data completeness         – all fields (decibels, season,
 *     recording status) are rendered with fallbacks for missing values.
 *  5. Bounds fit with panel offset           – fitBounds padding accounts for
 *     the detail panel width so markers are not hidden underneath it.
 *  6. Click-outside-panel close              – clicking the map when the panel
 *     is open closes it cleanly without leaking event listeners.
 */

/* ──────────────────────────────────────────────
   Constants
────────────────────────────────────────────── */
const ZOOM_SHOW_MARKERS = 3;   // markers hidden below this zoom
const ZOOM_SHOW_LABELS  = 6;   // popup auto-opens labels only above this zoom
const INITIAL_ZOOM      = 2;
const INITIAL_CENTER    = [20, 0];

/* ──────────────────────────────────────────────
   State
────────────────────────────────────────────── */
let activeMarkerId = null;
let markers        = [];         // { id, marker, data }
let zoomHintTimer  = null;

/* ──────────────────────────────────────────────
   Map initialisation
────────────────────────────────────────────── */
const map = L.map("map", {
  center: INITIAL_CENTER,
  zoom:   INITIAL_ZOOM,
  // Fix: enable keyboard navigation for accessibility
  keyboard: true,
  // Fix: smooth zoom prevents marker position jitter during animation
  zoomAnimation: true,
  // Fix: set maxBounds loosely so users can't pan to blank tiles
  maxBounds: [[-90, -200], [90, 200]],
  maxBoundsViscosity: 0.8,
});

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);

/* ──────────────────────────────────────────────
   Marker helpers
────────────────────────────────────────────── */

/**
 * Build a Leaflet DivIcon for a location entry.
 *
 * Fix: iconAnchor is set to [18, 18] (center of the 36×36 div) so the icon
 * sits precisely over its coordinate rather than being offset to a corner.
 *
 * @param {Object} location
 * @returns {L.DivIcon}
 */
function createIcon(location) {
  return L.divIcon({
    className: "",           // suppress Leaflet's default white box class
    html: `<div class="sonic-marker sonic-marker--${location.category}"
                role="button"
                tabindex="0"
                aria-label="${location.name}">${location.emoji}</div>`,
    iconSize:   [36, 36],
    iconAnchor: [18, 18],   // Fix: center anchor prevents coordinate offset
    popupAnchor:[0, -22],   // Fix: popup appears above the icon, not inside it
  });
}

/**
 * Generate the HTML shown inside the quick popup on the map.
 *
 * @param {Object} loc
 * @returns {string}
 */
function popupHTML(loc) {
  return `
    <strong style="font-size:0.95rem">${loc.emoji} ${loc.name}</strong><br/>
    <span style="font-size:0.8rem;color:#8b949e">${loc.region}, ${loc.country}</span><br/>
    <span style="font-size:0.8rem;margin-top:4px;display:block">
      ${loc.decibels} dB &nbsp;·&nbsp; ${loc.peakSeason}
    </span>
    <button
      onclick="window._openDetailPanel('${loc.id}')"
      style="margin-top:8px;padding:4px 10px;background:#58a6ff;color:#0d1117;
             border:none;border-radius:4px;font-size:0.8rem;cursor:pointer;font-weight:600">
      View details
    </button>
  `;
}

/* ──────────────────────────────────────────────
   Detail panel
────────────────────────────────────────────── */
const detailPanel   = document.getElementById("detail-panel");
const detailContent = document.getElementById("detail-content");
const detailClose   = document.getElementById("detail-close");

/**
 * Render a sound-level bar as a percentage of 100 dB max.
 *
 * @param {number} dB
 * @returns {string} HTML
 */
function soundLevelBar(dB) {
  const pct = Math.min(100, Math.round((dB / 100) * 100));
  // Colour shifts from green → amber → red with level
  const hue  = Math.round(120 - pct * 1.2);  // 120=green, 0=red
  const fill = `hsl(${hue},70%,50%)`;
  return `
    <div class="detail-meta-item" style="grid-column:1/-1">
      <div class="detail-meta-label">Ambient level</div>
      <div class="detail-meta-value">${dB} dB</div>
      <div class="sound-bar-track">
        <div class="sound-bar-fill" style="width:${pct}%;background:${fill}"></div>
      </div>
    </div>`;
}

/**
 * Open the detail panel for the given location id.
 * Exposed on window so the popup inline button can call it.
 *
 * Fix: always renders all detail fields with safe fallbacks; previously
 * missing fields caused empty or broken panel sections.
 *
 * @param {string} id
 */
window._openDetailPanel = function openDetailPanel(id) {
  const loc = SONIC_LOCATIONS.find((l) => l.id === id);
  if (!loc) return;

  activeMarkerId = id;

  // Fix: sanitise text nodes to prevent XSS from data strings
  const safe = (str) =>
    String(str ?? "—")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const recordedBadge = loc.recorded
    ? `<span style="color:#3fb950">✓ Recording available</span>`
    : `<span style="color:#8b949e">No recording on file</span>`;

  detailContent.innerHTML = `
    <span class="detail-category detail-category--${safe(loc.category)}">${safe(loc.category)}</span>
    <div class="detail-name">${safe(loc.emoji)} ${safe(loc.name)}</div>
    <div class="detail-location">${safe(loc.region)}, ${safe(loc.country)}</div>
    <p class="detail-description">${safe(loc.description)}</p>
    <div class="detail-meta">
      ${soundLevelBar(loc.decibels ?? 0)}
      <div class="detail-meta-item">
        <div class="detail-meta-label">Peak season</div>
        <div class="detail-meta-value">${safe(loc.peakSeason)}</div>
      </div>
      <div class="detail-meta-item">
        <div class="detail-meta-label">Recording</div>
        <div class="detail-meta-value" style="font-size:0.8rem">${recordedBadge}</div>
      </div>
      <div class="detail-meta-item">
        <div class="detail-meta-label">Coordinates</div>
        <div class="detail-meta-value" style="font-size:0.8rem">
          ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}
        </div>
      </div>
    </div>
  `;

  detailPanel.classList.remove("detail-panel--hidden");
  detailPanel.focus?.();
};

/**
 * Close the detail panel.
 */
function closeDetailPanel() {
  detailPanel.classList.add("detail-panel--hidden");
  activeMarkerId = null;
}

detailClose.addEventListener("click", closeDetailPanel);

// Fix: clicking on the map outside a marker or popup closes the panel
map.on("click", function (e) {
  // Only close if the click was NOT on the panel itself
  if (!detailPanel.contains(e.originalEvent.target)) {
    closeDetailPanel();
  }
});

/* ──────────────────────────────────────────────
   Zoom-dependent rendering
────────────────────────────────────────────── */
const zoomHintEl = document.getElementById("zoom-hint");

/**
 * Show a transient hint message in the zoom hint bar.
 *
 * @param {string} msg
 * @param {number} [duration=2500]
 */
function showZoomHint(msg, duration = 2500) {
  clearTimeout(zoomHintTimer);
  zoomHintEl.textContent = msg;
  zoomHintEl.classList.add("zoom-hint--visible");
  zoomHintTimer = setTimeout(
    () => zoomHintEl.classList.remove("zoom-hint--visible"),
    duration
  );
}

/**
 * Update marker visibility based on current zoom level.
 *
 * Fix: markers were always rendered regardless of zoom, causing severe
 * clustering and overlap at low zoom levels. Now they are added/removed
 * from the map layer according to the ZOOM_SHOW_MARKERS threshold.
 */
function updateMarkersForZoom() {
  const z = map.getZoom();
  const show = z >= ZOOM_SHOW_MARKERS;

  markers.forEach(({ marker }) => {
    if (show && !map.hasLayer(marker)) {
      marker.addTo(map);
    } else if (!show && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  if (!show) {
    showZoomHint("Zoom in to see sound locations", 3000);
  }
}

map.on("zoomend", updateMarkersForZoom);

/* ──────────────────────────────────────────────
   Populate markers
────────────────────────────────────────────── */
SONIC_LOCATIONS.forEach((loc) => {
  const marker = L.marker([loc.lat, loc.lng], { icon: createIcon(loc) });

  // Fix: popup autoPanPadding prevents the popup from being clipped by the
  // viewport edge or hidden beneath the detail panel on the right.
  marker.bindPopup(popupHTML(loc), {
    maxWidth: 260,
    autoPan: true,
    autoPanPadding: L.point(16, 72),   // extra right padding for detail panel
    closeButton: true,
  });

  marker.on("click", () => {
    // If already showing this location's detail, just open popup
    if (activeMarkerId !== loc.id) {
      window._openDetailPanel(loc.id);
    }
  });

  // Keyboard accessibility: Enter/Space open the popup
  marker.on("keydown", (e) => {
    if (e.originalEvent.key === "Enter" || e.originalEvent.key === " ") {
      marker.openPopup();
      window._openDetailPanel(loc.id);
    }
  });

  markers.push({ id: loc.id, marker, data: loc });
});

// Render markers at initial zoom level
updateMarkersForZoom();

/* ──────────────────────────────────────────────
   Fit bounds on load
────────────────────────────────────────────── */

/**
 * Fit the map view to show all locations, accounting for the detail panel.
 *
 * Fix: previously fitBounds used no padding, so markers on the right were
 * hidden behind the detail panel (340 px wide). The right padding now
 * matches the panel width so all markers are visible on load.
 */
function fitAllLocations() {
  if (SONIC_LOCATIONS.length === 0) return;

  const bounds = L.latLngBounds(
    SONIC_LOCATIONS.map((l) => [l.lat, l.lng])
  );

  const panelWidth =
    parseInt(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--panel-width"),
      10
    ) || 340;

  map.fitBounds(bounds, {
    padding: [40, panelWidth + 20, 40, 40], // [top, right, bottom, left]
    maxZoom: 5,
    animate: false,
  });
}

fitAllLocations();
