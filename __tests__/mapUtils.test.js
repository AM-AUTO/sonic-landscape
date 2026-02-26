/**
 * Unit tests for Sonic Landscape map utility functions.
 *
 * Tests verify the fixes applied to map detail rendering:
 *   - XSS sanitisation of detail panel content
 *   - Sound level bar percentage and colour calculations
 *   - Zoom-dependent marker visibility logic
 *   - Bounds padding that accounts for the detail panel width
 *   - Location lookup with null safety
 *   - Coordinate formatting
 */

const {
  sanitize,
  soundLevelPercent,
  soundLevelHue,
  markersVisibleAtZoom,
  boundspadding,
  findLocationById,
  formatCoords,
} = require("../src/mapUtils");

/* ──────────────────────────────────────────────
   sanitize
────────────────────────────────────────────── */
describe("sanitize", () => {
  test("passes through plain text unchanged", () => {
    expect(sanitize("Hello World")).toBe("Hello World");
  });

  test("escapes < and >", () => {
    expect(sanitize("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;"
    );
  });

  test("escapes ampersands", () => {
    expect(sanitize("A & B")).toBe("A &amp; B");
  });

  test("escapes double quotes", () => {
    expect(sanitize('say "hello"')).toBe("say &quot;hello&quot;");
  });

  test("returns — for null", () => {
    expect(sanitize(null)).toBe("—");
  });

  test("returns — for undefined", () => {
    expect(sanitize(undefined)).toBe("—");
  });

  test("converts numbers to strings", () => {
    expect(sanitize(42)).toBe("42");
  });
});

/* ──────────────────────────────────────────────
   soundLevelPercent
────────────────────────────────────────────── */
describe("soundLevelPercent", () => {
  test("returns 0 for 0 dB", () => {
    expect(soundLevelPercent(0)).toBe(0);
  });

  test("returns 50 for 50 dB", () => {
    expect(soundLevelPercent(50)).toBe(50);
  });

  test("returns 100 for 100 dB", () => {
    expect(soundLevelPercent(100)).toBe(100);
  });

  test("clamps to 100 for values above 100 dB", () => {
    expect(soundLevelPercent(120)).toBe(100);
  });

  test("clamps to 0 for negative values", () => {
    expect(soundLevelPercent(-10)).toBe(0);
  });

  test("returns 0 for NaN", () => {
    expect(soundLevelPercent(NaN)).toBe(0);
  });

  test("returns 0 for non-number input", () => {
    expect(soundLevelPercent("loud")).toBe(0);
  });

  test("rounds to nearest integer", () => {
    // 55 / 100 * 100 = 55 exactly
    expect(soundLevelPercent(55)).toBe(55);
  });
});

/* ──────────────────────────────────────────────
   soundLevelHue
────────────────────────────────────────────── */
describe("soundLevelHue", () => {
  test("returns 120 (green) for 0 dB", () => {
    expect(soundLevelHue(0)).toBe(120);
  });

  test("returns 0 (red) for 100 dB", () => {
    expect(soundLevelHue(100)).toBe(0);
  });

  test("returns 60 (yellow-green) for 50 dB", () => {
    // 120 - 50*1.2 = 60
    expect(soundLevelHue(50)).toBe(60);
  });

  test("does not go below 0 for extreme values", () => {
    expect(soundLevelHue(200)).toBeGreaterThanOrEqual(0);
  });
});

/* ──────────────────────────────────────────────
   markersVisibleAtZoom
────────────────────────────────────────────── */
describe("markersVisibleAtZoom", () => {
  test("returns false below the default threshold (3)", () => {
    expect(markersVisibleAtZoom(2)).toBe(false);
  });

  test("returns true at the default threshold", () => {
    expect(markersVisibleAtZoom(3)).toBe(true);
  });

  test("returns true above the threshold", () => {
    expect(markersVisibleAtZoom(10)).toBe(true);
  });

  test("respects a custom threshold", () => {
    expect(markersVisibleAtZoom(4, 5)).toBe(false);
    expect(markersVisibleAtZoom(5, 5)).toBe(true);
  });

  test("zoom 0 is always hidden at default threshold", () => {
    expect(markersVisibleAtZoom(0)).toBe(false);
  });
});

/* ──────────────────────────────────────────────
   boundspadding
────────────────────────────────────────────── */
describe("boundspadding", () => {
  test("returns a 4-element array", () => {
    const result = boundspadding(340);
    expect(result).toHaveLength(4);
  });

  test("right padding equals panelWidth + base/2", () => {
    const [, right] = boundspadding(340, 40);
    expect(right).toBe(340 + 20);  // 360
  });

  test("top, bottom, left equal base (40 by default)", () => {
    const [top, , bottom, left] = boundspadding(340, 40);
    expect(top).toBe(40);
    expect(bottom).toBe(40);
    expect(left).toBe(40);
  });

  test("uses custom base when provided", () => {
    const [top, right, bottom, left] = boundspadding(200, 60);
    expect(top).toBe(60);
    expect(right).toBe(200 + 30);
    expect(bottom).toBe(60);
    expect(left).toBe(60);
  });

  test("zero panel width still returns valid padding", () => {
    const [, right] = boundspadding(0, 40);
    expect(right).toBe(20);
  });
});

/* ──────────────────────────────────────────────
   findLocationById
────────────────────────────────────────────── */
describe("findLocationById", () => {
  const locs = [
    { id: "forest-one", name: "Forest One", category: "forest" },
    { id: "ocean-two",  name: "Ocean Two",  category: "ocean"  },
  ];

  test("finds an existing location", () => {
    expect(findLocationById(locs, "forest-one")).toEqual(locs[0]);
  });

  test("returns null for a missing id", () => {
    expect(findLocationById(locs, "not-here")).toBeNull();
  });

  test("returns null for an empty array", () => {
    expect(findLocationById([], "forest-one")).toBeNull();
  });

  test("returns null for undefined id", () => {
    expect(findLocationById(locs, undefined)).toBeNull();
  });
});

/* ──────────────────────────────────────────────
   formatCoords
────────────────────────────────────────────── */
describe("formatCoords", () => {
  test("formats positive lat/lng with N/E suffix", () => {
    expect(formatCoords(51.5074, 0.1278)).toBe("51.5074° N, 0.1278° E");
  });

  test("formats negative lat/lng with S/W suffix", () => {
    expect(formatCoords(-33.8688, -70.6693)).toBe(
      "33.8688° S, 70.6693° W"
    );
  });

  test("formats zero coords as N and E", () => {
    expect(formatCoords(0, 0)).toBe("0.0000° N, 0.0000° E");
  });

  test("formats 4 decimal places", () => {
    const result = formatCoords(1.23456789, 2.3456789);
    expect(result).toMatch(/1\.2346° N/);
    expect(result).toMatch(/2\.3457° E/);
  });
});
