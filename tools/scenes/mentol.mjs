/**
 * MENTOL (Men-an-Tol) in WINTER: a great frosted granite slab with a round hole fills the frame; through the hole a lone tall menhir stands far off
 * (~40 m beyond the ring) on a barren, snow-patched peat moor drawn as an OS sheet (contours + grid in the terrain shader), and beyond the moor the
 * Cairngorm massifs go back in layers (rounded plateaus, steep corries, snow flanks), each ridge paler and bluer than the last, under a thin, cold,
 * overcast sky. BLUE is a second tonal ramp (palette indices 29..34) used for contrast: cold sky-lit shadows, ice, distance and the pale cold glow
 * of the carved grooves (the accent); neutral grey is the sunlit stone and snow. See the `cool` channel in tools/render3d/render.mjs.
 *
 *   node tools/bake-title.mjs mentol --preview out/mentol.png                (final: SS2 + write src/render/title/baked/mentol.js)
 *   node tools/bake-title.mjs mentol --ss 1 --no-write --preview out/m.png   (quick look)
 *   node tools/bake-title.mjs mentol --param sunAz=250 --param snowCover=0.5 ...   (any constant below is a param)
 *
 * Debug params: noRing=true (see the moor and the menhir unobstructed), dbg=1 (contour coverage) / dbg=2 (terrain slope per pixel) as luminance.
 * Every number you may want to tweak is a named constant in DEFAULTS (override from the CLI with --param name=value).
 * World: metres, +Y up, looking down +z. The ring lies in the plane z = 0 (front face) .. z = ringT (back face), the hole axis is the z axis
 * through (0, 0). The camera is derived from the SCREEN position you want the hole to have (holePx/holePy/holePr), so the framing is one
 * set of numbers in pixels: hole centre, the radius of the narrowest bore as seen, and the horizon row. The menhir's size is a PIXEL height (menhirPx).
 */
import {
  M, mreset, Group, slab, capsule, roughEllipsoid, faceted, shapeSub, terrainHeightfield, stoneAlbedo, makeSky,
  getNoise, hash3, worley3, WORLEY, clamp, mix, smoothstep, sdRoundBox, smax, sunDir,
} from '../render3d/index.mjs';
import { SYMBOL_STROKES } from '../../src/render/stone.js';
import { mulberry32 } from '../../src/core/rng.js';

export const DEFAULTS = {
  seed: 7,
  // ---- light: a low, weak, cold sun from the left (az 270 = from the left, 180 = behind the camera), grazing the ring: long soft shadows run right and into the picture
  sunAz: 262, sunEl: 14, sunSoft: 0.1, sunColor: 1.5,
  // ---- framing (pixels of the 384x216 frame) and lens
  fov: 31,
  holePx: 186, holePy: 148, holePr: 98,        // screen centre + radius of the NARROWEST bore (the visible opening)
  horizonY: 136,                               // screen row of the horizon (lens shift)
  // ---- the holed stone
  holeR: 1.2,                                  // hole radius (m) at its narrowest
  holeFlare: 0.16,                             // how much the hole widens towards the faces (m)
  holeWobble: 0.045,                            // irregularity of the hole outline (m)
  ringT: 1.7,                                 // thickness of the slab (m)
  ringHW: 4.8, ringTop: 4.2, ringBottom: -3.2,   // slab half width, top / bottom (m, relative to the hole centre)
  ringLip: 0.3,                                // rounding of the lips (m, smooth subtraction)
  ringBig: 0.34, ringBigFreq: 0.42,            // large undulations (amp m, cycles per m)
  ringMid: 0.035, ringMidFreq: 1.6,             // lumps
  ringFine: 0.014, ringFineFreq: 11,            // fine pitting
  ringCrack: 0.036, crackFreq: 0.75,                              // depth of the crevices (m)
  ringBase: 0.56,                               // granite albedo
  lichen: 0.3, lichenScale: 9, lichenTone: 0.7, pit: 0.8, pitScale: 30, grain: 0.1, // lichen speckle coverage, patches per m, tone; pitting; grain
  ringStrata: 0.0,                             // bedding bands on the ring (granite has none; 0.03 gives faint ones)
  crevice: 0.32,                                // strength of the dark blotches and stains
  calmTop: 1.0,                               // 0..1 how much the top of the ring is smoothed / simplified (the logo sits there)
  calmY: 0.2,                                  // height (x holeR) above which it starts to calm
  calmRange: 0.9,                              // (x holeR) how far above calmY the calm is complete
  calmBottom: 0.9,                            // how much the foot of the ring darkens (calm ground for the text lines)
  calmBottomY: -0.1,                           // height (m, rel. to the hole centre) where that starts
  ringTopDark: 0.6,                          // how much the calm top of the ring is held down (the logo reads against it)
  rime: 1.0, rimeFrom: 0.3, rimeTo: 0.85,    // frost on the ring: strength, normal.y range over which it builds (upward-facing ledges, the lip)
  rimeWind: 0.5,                              // extra rime on the windward (sun / left) faces
  // ---- the menhir: far off on the moor
  menhirPx: 56,                               // on-screen height (pixels) -> its height in metres follows from its distance
  menhirDist: 42,                             // metres beyond the ring's back face
  knoll: 1.1, knollR: 7,                      // the stone stands on a low knoll (m high, radius m), so its foot is seen above the moor in front
  menhirDx: 10,                               // pixels right of the hole centre
  menhirW: 0.36, menhirT: 0.2, menhirTaper: 0.55, // width and thickness as fractions of its height; taper (0 = parallel sides)
  menhirRough: 0.01, menhirLean: 0.03,        // roughness (fraction of height) and lean (radians)
  menhirBase: 0.3,
  menhirRime: 0.45,                            // frost on its windward and upper faces
  // ---- the carving (scaled to the stone: small, real grooves)
  symbol: 'crescent',                          // 'crescent' | 'discs'
  symbolFrac: 0.42,                            // height of the symbol as a fraction of the stone's height
  symbolY: 0.5,                               // height of the symbol centre as a fraction of the menhir height
  symbolX: 0.0,                                // metres off the face centre
  groovePx: 0.6, corePx: 0.5, coreDepthPx: 0.7,// groove radius, glowing core radius and depth of the core behind the face, in PIXELS at the stone's distance
  glow: 0.3, glowPx: 2,                      // pale light the groove throws on the stone, and its reach in pixels
  // ---- the moor: barren peat hag moorland
  groundY: -1.15,                              // height of the ground at the ring (m)
  moorAmp: 2.4, moorFreq: 0.02, moorDetail: 0.28, moorSlope: 1.0, moorTilt: 0.03,
  moorRise: 0.02,                              // very gentle rise of the far moor (m per m beyond 40 m)
  hagDepth: 0.55, hagFreq: 0.06, hagThr: 0.18, hagSoft: 0.12, // peat hags: eroded gullies cut into the moor (depth m, noise freq, threshold, wall softness)
  tussockCell: 1.1, tussockCover: 0.55, tussockH: 0.22, tussockFade0: 30, tussockFade1: 110, // grass tussock domes: cell (m), coverage, height (m), distance at which they fade out (px aliasing)
  hummockCell: 4.5, hummockCover: 0.5, hummockH: 0.5, hummockFade0: 60, hummockFade1: 300, // larger grassy hummocks seen at mid distance
  pools: [[-8, 30, 6], [14, 52, 9], [-26, 85, 13]],  // explicit frozen pools: [x offset from the stone (m), z (m), radius (m)]
  poolCover: 0.6, poolR0: 7, poolR1: 9, poolDepth: 0.14, // frozen pools: probability per 75 m cell, radius range (m), depth
  // ---- ground colour: coverage and tones
  snowCover: 0.4,                             // patchy snow lying in hollows and on lee slopes (0 none .. 1 blanket)
  heatherCover: 0.5, bareCover: 0.25,         // dark heather clumps, wind-scoured bare patches
  moorSnow: 0.92, moorGrass: 0.74, moorPeat: 0.3, moorHeather: 0.24,   // tones: snow, bleached grass, bare peat, heather
  moorNear: 0.42,            // how dark the ground right behind the ring is (0..1 of the full tone): calm ground for the prompt
  contourI: 0.5, contourIndex: 4, contourLW: 0.9, contourInk: 0.5, contourIndexInk: 0.7, // metres, every Nth heavy, px width, how dark
  gridSize: 5, gridLW: 0.8, gridInk: 0.28,    // metres, px width, darkening
  contourCool: 0.7,                            // contour lines and grid are steel blue (cool offset)
  boulders: 14, erratics: 2, boulderMin: 0.3, boulderMax: 1.0, // scattered boulders on the moor and a few big erratics
  tufts: 12, tuftH: 0.55,                      // bleached tussock grass at the foot of the menhir (clumps, blade height m)
  fogDensity: 0.0045, fogFall: 0.0, hazeLum: 0.8, // aerial perspective (clear cold air); the horizon haze tone
  // ---- sky and the Cairngorm skyline
  skyZenith: 0.46, skyHorizon: 0.9, skyDrop: 0.3, cloud: 0.5, // thin high cloud
  skyCoolZenith: 0.9, skyCoolHorizon: 0.25,   // coolness of the sky: steel at the zenith, pale at the horizon
  ridgeSlope: 2.2, ridgeSnow: 0.65,              // how strongly a slope's tilt lights it, overall snow cover of the high ground
  // ---- render
  aoRadius: 0.4, aoStrength: 0.7, ambSky: 0.7, ambGround: 0.45,
  coolShadow: 0.5, coolAO: 0.3, coolSnow: 0.2, coolHaze: 0.8, coolLit: 0.12,
};

// the mountain layers, nearest first: dist (m: haze), base / amp (elevation angle in radians of the crest = base + amp * massif), freq (lobes per radian of azimuth),
// plateau (0 sharp peaks .. 1 flat tops), corrie (depth of the corrie bites, 0..1), cfreq (corries per radian), tone (rock albedo), snow (snowline height fraction)
export const RIDGES = [
  { dist: 7500, base: 0.004, amp: 0.12, freq: 1.9, seed: 11, plateau: 0.95, corrie: 0.7, cfreq: 5.5, tone: 0.22, snow: 0.66, lo: 0.34 },
  { dist: 11500, base: 0.006, amp: 0.115, freq: 2.6, seed: 23, plateau: 0.9, corrie: 0.45, cfreq: 8, tone: 0.27, snow: 0.68, lo: 0.3 },
  { dist: 17000, base: 0.008, amp: 0.085, freq: 3.6, seed: 37, plateau: 0.85, corrie: 0.4, cfreq: 10, tone: 0.32, snow: 0.7, lo: 0.28 },
  { dist: 26000, base: 0.009, amp: 0.062, freq: 5, seed: 51, plateau: 0.8, corrie: 0.35, cfreq: 13, tone: 0.37, snow: 0.72, lo: 0.26 },
  { dist: 40000, base: 0.01, amp: 0.04, freq: 7, seed: 67, plateau: 0.75, corrie: 0.3, cfreq: 17, tone: 0.43, snow: 0.74, lo: 0.24 },
];

export const quantise = { gamma: 1.0, contrast: 1.12, ditherScale: 0.5, sharpen: 0.3, outline: 0.0, coolDither: 0.3, accent: 'frost', accentEdge: 'paleblue' };

const ID_GROUND = 0, ID_RING = 1, ID_MENHIR = 2, ID_EMBER = 3, ID_TUFT = 4, ID_BOULDER = 5;

export function build(params = {}) {
  const P = { ...DEFAULTS, ...params };
  const nz = getNoise(P.seed), nz2 = getNoise(P.seed + 11), nzs = getNoise(P.seed + 5);
  const tanH = Math.tan(P.fov * Math.PI / 360), W = 384, H = 216, aspect = W / H;
  const sun = sunDir(P.sunAz, P.sunEl);

  // ------------------------------------------------------------------ camera from the hole's screen position
  const shift = P.horizonY / (H / 2) - 1;
  const D = P.holeR * (H / 2) / (tanH * P.holePr) - P.ringT / 2;                         // distance to the front face (the narrowest bore is at mid thickness)
  const cam = {
    x: -(P.holePx / (W / 2) - 1) * (D + P.ringT / 2) * tanH * aspect,
    y: -(D + P.ringT / 2) * tanH * (1 - 2 * P.holePy / H + shift),
    z: -D,
  };
  const camera = { pos: [cam.x, cam.y, cam.z], target: [cam.x, cam.y, 0], fov: P.fov, shift: [0, shift] };
  const pxf = 2 * tanH / H;                                                             // one final pixel at 1 m

  // ------------------------------------------------------------------ the moor
  const mz = P.ringT + P.menhirDist, Dm = D + mz;
  const pxPerM = (H / 2) / (tanH * Dm);                                                  // pixels per metre at the menhir
  const mH = P.menhirPx / pxPerM;                                                        // its height in metres follows from the pixel height
  const sc = mH / 2.45;                                                                  // scale relative to the old 2.45 m stone (for the absolute constants)
  const sx = cam.x + ((P.holePx + P.menhirDx) / (W / 2) - 1) * tanH * aspect * (Dm + 0.0);
  const flatD = (x, z) => 1 - smoothstep(2, 14, Math.hypot(x - sx, (z - mz) * 1.3));    // the clearing round the stone
  function moorBase(x, z) {
    let v = P.moorAmp * nz.fbm2(x * P.moorFreq, z * P.moorFreq, 4) + 0.5 * P.moorAmp * nz.fbm2(x * P.moorFreq * 3.1 + 7, z * P.moorFreq * 3.1, 3);
    v *= 1 - 0.5 * flatD(x, z);
    const rise = P.moorTilt * smoothstep(0, 30, z) * 30 + P.moorRise * Math.max(0, z - 40);
    return P.groundY + v + rise + P.knoll * Math.exp(-((x - sx) * (x - sx) + (z - mz) * (z - mz) * 0.5) / (2 * P.knollR * P.knollR));
  }
  let TT = 0;                                                                              // the clump's kind (0..1) of the last tussock found: heather or bleached grass
  function tussockH(x, z, TC = P.tussockCell, cover = P.tussockCover, hgt = P.tussockH, salt = 77) {   // sparse grass tussock domes (jittered 3x3 cell lookup)
    const cx0 = Math.floor(x / TC), cz0 = Math.floor(z / TC);
    let best = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = cx0 + i, cz = cz0 + j, h = hash3(cx, 0, cz, salt);
      if ((h & 255) / 256 > cover) continue;
      const px = (cx + 0.3 + 0.4 * ((h >>> 8) & 255) / 256) * TC, pz = (cz + 0.3 + 0.4 * ((h >>> 16) & 255) / 256) * TC;
      const R = TC * (0.2 + 0.2 * ((h >>> 24) / 256)), dx = x - px, dz = z - pz;
      const ang = nzs.n2(dx * 2.2 + cx * 7.3, dz * 2.2 + cz * 3.1);                      // ragged outline
      const r2 = (dx * dx + dz * dz) / (R * R * (1 + 0.55 * ang) * (1 + 0.55 * ang));
      if (r2 < 1) { const v = Math.pow(1 - r2, 1.1) * (0.4 + 0.6 * ((h >>> 3) & 255) / 256) * (0.75 + 0.5 * nzs.n2(x * 7, z * 7)); if (v > best) { best = v; TT = ((h >>> 5) & 255) / 256; } }
    }
    return best * hgt;
  }
  const PC = 75, PI = { w: 0, ice: 0, level: 0, R: 0, d: 0 };
  function poolInfo(x, z) {                                                              // frozen pools: shallow dishes in cells of PC metres
    PI.w = 0; PI.ice = 0;
    for (let q = 0; q < P.pools.length; q++) {                                           // the pools meant to be seen from the portal
      const pl = P.pools, px = sx + pl[q][0], pz = pl[q][1], R = pl[q][2];
      const dx = x - px, dz = (z - pz) * 1.4, d = Math.hypot(dx, dz) * (1 + 0.22 * nzs.n2(x * 0.35, z * 0.35));
      if (d > R * 2.7) continue;
      const w = smoothstep(R * 2.7, R * 1.3, d);
      if (w > PI.w) { PI.w = w; PI.R = R; PI.d = d; PI.level = moorBase(px, pz) - P.poolDepth; PI.ice = smoothstep(R * 1.04, R * 0.92, d); }
    }
    const ci = Math.floor(x / PC), cj = Math.floor(z / PC);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ci + i, cz = cj + j, h = hash3(cx, 0, cz, 91);
      if ((h & 255) / 256 > P.poolCover) continue;
      const px = (cx + 0.2 + 0.6 * ((h >>> 8) & 255) / 256) * PC, pz = (cz + 0.2 + 0.6 * ((h >>> 16) & 255) / 256) * PC;
      if (pz < 18 || pz > 300) continue;
      const R = P.poolR0 + P.poolR1 * ((h >>> 24) / 256);
      const dx = x - px, dz = (z - pz) * 1.4, d = Math.hypot(dx, dz) * (1 + 0.22 * nzs.n2(x * 0.35, z * 0.35));
      if (d > R * 2.7) continue;
      const w = smoothstep(R * 2.7, R * 1.3, d);
      if (w > PI.w) {
        PI.w = w; PI.R = R; PI.d = d;
        PI.level = moorBase(px, pz) - P.poolDepth;
        PI.ice = smoothstep(R * 1.04, R * 0.92, d);
      }
    }
    return PI.w;
  }
  function groundH(x, z) {
    let h = moorBase(x, z);
    h += P.moorDetail * (0.55 * nz.fbm2(x * 0.14 + 3, z * 0.07, 3) + 0.12 * nz.fbm2(x * 0.5, z * 0.25, 2));    // rolling hummocky ground at the scale the eye meets it (wavelengths of a few metres)
    const hn = nz2.fbm2(x * P.hagFreq * 1.7 + 3, z * P.hagFreq * 0.8, 3);                              // peat hags
    h -= P.hagDepth * smoothstep(P.hagThr, P.hagThr + P.hagSoft, hn) * (1 - 0.8 * flatD(x, z)) * smoothstep(3, 10, z);
    const fade = (1 - smoothstep(P.tussockFade0, P.tussockFade1, z - cam.z)) * smoothstep(10, 24, z);
    if (fade > 0) h += tussockH(x, z) * fade * (0.55 + 0.9 * (0.5 + 0.5 * nz.n2(x * 0.07, z * 0.07)));
    const fade2 = (1 - smoothstep(P.hummockFade0, P.hummockFade1, z - cam.z)) * smoothstep(14, 40, z);
    if (fade2 > 0) h += tussockH(x, z, P.hummockCell, P.hummockCover, P.hummockH, 133) * fade2;
    if (z > 14 && poolInfo(x, z) > 0) {
      const bank = 0.18 * smoothstep(PI.R, PI.R * 1.9, PI.d);
      h = mix(h, PI.level + bank + (h - PI.level) * 0.12 * smoothstep(PI.R, PI.R * 2.2, PI.d), PI.w);
    }
    return h;
  }
  const ground = terrainHeightfield({ seed: P.seed, slopeMax: P.moorSlope + 0.35, height: groundH });
  const gh = (x, z) => ground.h(x, z);

  // ------------------------------------------------------------------ the holed stone (one SDF, local frame = world)
  const T = P.ringT, R0 = P.holeR, HW = P.ringHW, top = P.ringTop, bot = P.ringBottom;
  const ocy = (top + bot) / 2, ohh = (top - bot) / 2;
  const bbMin = [-HW, bot, 0], bbMax = [HW, top, T];
  const ringA = P.ringBig + P.ringMid + P.ringFine + P.ringCrack + P.holeWobble + 0.05;
  const calmFrom = P.calmY * R0;
  const ringD = (x, y, z) => {
    // bounding box lower bound first
    let dx = bbMin[0] - x; const ex = x - bbMax[0]; if (ex > dx) dx = ex; if (dx < 0) dx = 0;
    let dy = bbMin[1] - y; const ey = y - bbMax[1]; if (ey > dy) dy = ey; if (dy < 0) dy = 0;
    let dz = bbMin[2] - z; const ez = z - bbMax[2]; if (ez > dz) dz = ez; if (dz < 0) dz = 0;
    const db = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (db > ringA + 0.3) return db - ringA;
    const zc = (z - T / 2) * 2 / T;                                                       // -1 front .. +1 back
    const rho = Math.sqrt(x * x + y * y);
    const rr = R0 + P.holeFlare * zc * zc * zc * zc + P.holeWobble * nz.n3(x * 0.7 + 3, y * 0.7, z * 0.4);
    const dOut = sdRoundBox(x, y - ocy, z - T / 2, HW, ohh, T / 2, 0.4);
    let d = smax(dOut, (rr - rho) * 0.85, P.ringLip);
    if (d > 0.9) return d - ringA;
    const calm = Math.max(P.calmTop * smoothstep(calmFrom, calmFrom + P.calmRange * R0, y), 0.8 * P.calmBottom * smoothstep(P.calmBottomY, P.calmBottomY - 0.7, y));  // the upper mass and the foot are quieter
    const big = nz.fbm3(x * P.ringBigFreq, y * P.ringBigFreq, z * P.ringBigFreq, 2);
    const mid = nz2.fbm3(x * P.ringMidFreq, y * P.ringMidFreq, z * P.ringMidFreq, 3);
    const fine = nz.n3(x * P.ringFineFreq + 9, y * P.ringFineFreq, z * P.ringFineFreq);
    const wq = nz.n3(x * 1.9 + 5, y * 1.9, z * 1.9) * 0.35;                                // joints: the cell edges of a warped Worley field, a network of cracks
    const f1 = worley3(x * P.crackFreq + wq + 11, y * P.crackFreq + wq, z * P.crackFreq + wq + 3, 5), f2 = WORLEY.f2;
    const crack = (1 - smoothstep(0, 0.09, f2 - f1)) * P.ringCrack * (1 - calm);
    const away = smoothstep(R0 + 0.05, R0 + 1.1, rho);                                    // the hole stays round, the mass beyond it is lumpy
    d -= (P.ringBig * big * (1 - 0.35 * calm) + (P.ringMid * mid) * (1 - 0.8 * calm)) * (0.25 + 0.75 * away) + P.ringFine * fine * (1 - 0.8 * calm) - crack * away;
    return d * 0.6;
  };


  // ------------------------------------------------------------------ the menhir (far off: its size follows menhirPx)
  const mBaseY = gh(sx, mz) - 0.2 * sc, mcy = mBaseY + mH / 2;
  const mW = mH * P.menhirW, mT = mH * P.menhirT;
  const men0 = slab({ c: [sx, mcy, mz], size: [mW, mH, mT], rot: [0, 0.0, P.menhirLean], round: 0.4 * mW, taper: P.menhirTaper, rough: P.menhirRough * mH, freq: 6.5 / sc, seed: 31, chip: 0.025 * mH, bulk: 0.07 * mH, bulkFreq: 0.9 / sc });
  // surface z of the face at (x, y): march along z from the camera side
  const faceZ = (x, y) => {
    let z = mz - 1.2 * sc;
    for (let i = 0; i < 400 && men0.d(x, y, z) > 0.0005; i++) { z += Math.max(0.002, men0.d(x, y, z) * 0.7); if (z > mz + 0.2 * sc) break; }
    return z;
  };
  // the symbol as polylines in metres on the face (centre of its bounding box at the origin)
  const sym = SYMBOL_STROKES[P.symbol] || SYMBOL_STROKES.crescent;
  const polys = [];
  for (const [cx, cy, Rr, a0, a1] of sym.arcs) { const pts = [], n = Math.max(8, Math.ceil((a1 - a0) * Rr * 6)); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Rr * Math.cos(a), cy + Rr * Math.sin(a)]); } polys.push(pts); }
  for (const [cx, cy, Rr] of sym.circles) { const pts = [], n = Math.ceil(Rr * 40); for (let i = 0; i <= n; i++) { const a = Math.PI * 2 * i / n; pts.push([cx + Rr * Math.cos(a), cy + Rr * Math.sin(a)]); } polys.push(pts); }
  for (const [ax, ay, bx, by] of sym.segs) { const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) * 7)); const pts = []; for (let i = 0; i <= n; i++) pts.push([ax + (bx - ax) * i / n, ay + (by - ay) * i / n]); polys.push(pts); }
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
  for (const p of polys) for (const [x, y] of p) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  const ux = (bx0 + bx1) / 2, uy = (by0 + by1) / 2, S = P.symbolFrac * mH / (by1 - by0);   // metres per symbol unit
  const symX = sx + P.symbolX, symY = mBaseY + P.symbolY * mH;
  const grooveR = P.groovePx / pxPerM, coreR = P.corePx / pxPerM, coreDepth = P.coreDepthPx / pxPerM, glowReach = P.glowPx / pxPerM;
  const carve = [], core = [];
  for (const p of polys) {
    const pts = p.map(([x, y]) => { const wx = symX + (x - ux) * S, wy = symY - (y - uy) * S; return [wx, wy, faceZ(wx, wy)]; });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      carve.push(capsule({ a, b, r: grooveR }));
      core.push(capsule({ a: [a[0], a[1], a[2] + coreDepth], b: [b[0], b[1], b[2] + coreDepth], r: coreR }));
    }
  }
  const carveG = new Group(), coreG = new Group();
  carve.forEach((c) => carveG.add(c, 0)); carveG.finish();
  core.forEach((c) => coreG.add(c, 0)); coreG.finish();
  const carveShape = { d: (x, y, z) => carveG.d(x, y, z), min: carveG.min, max: carveG.max, id: 0 };
  const coreShape = { d: (x, y, z) => coreG.d(x, y, z), min: coreG.min.map((v) => v - 0.05), max: coreG.max.map((v) => v + 0.05), id: 0 };

  const props = new Group();
  props.add(shapeSub(men0, carveShape, 0.25 * grooveR), ID_MENHIR);
  props.add(coreShape, ID_EMBER);
  // bleached tussock grass at the foot of the menhir: clusters of leaning blades; boulders and erratics scattered on the moor
  const rng = mulberry32(P.seed * 911 + 5);
  for (let k = 0; k < P.tufts; k++) {
    const a = rng() * Math.PI * 2, rad = (0.5 + rng() * 1.1) * sc * 1.4, x = sx + Math.cos(a) * rad * 1.2, z = mz - 0.15 + Math.sin(a) * rad * 0.8;
    const g0 = gh(x, z), nb = 7 + Math.floor(rng() * 5), h0 = P.tuftH * (0.5 + rng() * 0.7);
    for (let b = 0; b < nb; b++) {
      const ba = rng() * Math.PI * 2, lean = (0.12 + rng() * 0.3) * h0 * 1.2, hh = h0 * (0.5 + rng() * 0.7);
      props.add(capsule({ a: [x + (rng() - 0.5) * 0.08, g0 - 0.03, z + (rng() - 0.5) * 0.08], b: [x + Math.cos(ba) * lean, g0 + hh, z + Math.sin(ba) * lean], r: 0.035 + rng() * 0.02 }), ID_TUFT);
    }
  }
  for (let k = 0; k < P.boulders + P.erratics; k++) {
    const big = k >= P.boulders, zz = rng(), z = big ? 30 + rng() * 60 : 24 + zz * zz * 170;
    let x = cam.x + (rng() - 0.5) * (6 + z * 0.62);
    if (big) x = cam.x + (rng() < 0.5 ? -1 : 1) * (4 + z * 0.3 + rng() * 6);
    if (Math.abs(x - sx) < 3 && Math.abs(z - mz) < 5) x += 6;
    const r = big ? 1.1 + rng() * 0.9 : P.boulderMin + rng() * (P.boulderMax - P.boulderMin);
    const c = [x, gh(x, z) + r * 0.3, z];
    props.add(faceted(roughEllipsoid({ c, radii: [r * 1.25, r * 0.72, r], rot: [0, rng() * 3, 0], rough: 0.04 * r, freq: 3 / r, seed: 70 + k, bulk: 0.05 * r }), { c, radius: r * 0.95, count: 9, depth: 0.25, seed: 90 + k }), ID_BOULDER);
  }
  props.finish();

  // ------------------------------------------------------------------ sky and the Cairngorm skyline
  const sky0 = makeSky({ zenith: P.skyZenith, horizon: P.skyHorizon, below: 0.7, clouds: { coverage: P.cloud, scale: 1.0, seed: 4, tone: 0.2, contrast: 0.5 } });
  const L = RIDGES.map((r) => ({ ...r, dens: 1 / 22000 }));
  const sd = sun;                                                                         // sun direction (x, y, z)
  const sunAzimuth = Math.atan2(sd[0], sd[2]);
  const hazeLum = P.hazeLum;
  // crest elevation (radians) of ridge layer k at azimuth a; also leaves the corrie-bite weight in CB for the shader
  let CB = 0, MS = 0;
  function crest(k, a) {
    const r = L[k], u = a * r.freq + r.seed + 0.35 * nz2.n2(a * r.freq * 0.6 + 9, r.seed);
    const v = nz.fbm2(u, r.seed * 0.37, 3) * 0.5 + 0.5;
    let t = (v - r.lo) / 0.42; t = t < 0 ? 0 : t > 1 ? 1 : t;
    let m = t * t * (3 - 2 * t);
    m = mix(t * 0.9 + 0.05, m, r.plateau);
    m += 0.1 * nz2.n2(u * 2.3, r.seed) * m + 0.06 * nz2.fbm2(u * 6 + 3, r.seed * 0.7, 2) * m + 0.016 * nzs.fbm2(u * 13, r.seed, 2) * (0.3 + m);   // a rolling, lumpy plateau top with tors
    const c = nz2.fbm2(a * r.cfreq + r.seed * 1.7, r.seed * 0.9 + 3, 2) * 0.5 + 0.5;
    CB = smoothstep(0.44, 0.58, c) * smoothstep(0.3, 0.65, m);                               // corries: bites in the rim of the high ground, with a dark headwall under it
    m *= 1 - r.corrie * CB * 0.45;
    MS = m;
    return r.base + r.amp * m;
  }
  const SO = { lum: 0, cool: 0 };
  function skyShade(dir, out) {
    const y = dir[1];
    let lum = sky0(dir) - P.skyDrop * smoothstep(0.01, 0.2, y);
    let cool = P.skyCoolHorizon + (P.skyCoolZenith - P.skyCoolHorizon) * Math.pow(smoothstep(0.0, 0.95, y), 0.8);
    if (y > -0.05 && y < 0.15) {
      const el = Math.asin(y < 1 ? y : 1), az = Math.atan2(dir[0], dir[2]);
      for (let k = 0; k < L.length; k++) {
        const r = L[k];
        const e = crest(k, az);
        if (el >= e) continue;
        const cb = CB, ms = MS;
        const dw = 0.03, ew1 = crest(k, az + dw), ew0 = crest(k, az - dw), tilt = (ew1 - ew0) / (2 * dw);   // the broad facet's tilt: slopes tilted towards the sun are lit
        const lit = clamp(0.55 + tilt * P.ridgeSlope, 0.1, 1);
        const s = clamp(el / e, 0, 1);                                                    // 0 at the horizon, 1 at the crest
        const crestD = (e - el) / (r.amp + 1e-4);                                         // depth below the crest in units of the layer's height
        const gu = nzs.fbm2(az * (r.freq * 9 + 40) + el * 200 * (tilt > 0 ? 1 : -1), el * 16 + r.seed, 2) * 0.5 + 0.5;   // gullies: sheared streaks running down the flank
        const gu2 = nzs.n2(az * (r.freq * 3 + 12) + 7, el * 6) * 0.5 + 0.5;
        const stri = nzs.n2(az * (r.freq * 70 + 200), el * 2.5 + r.seed) * 0.5 + 0.5;       // vertical striations of a crag face
        // corrie headwall: a dark, striated cliff just under the rim of the high ground, in shade (cold)
        const cliff = cb * smoothstep(0.75, 0.35, crestD) * smoothstep(0.0, 0.05, crestD);
        // snow: long smooth flanks above the snowline, broken by gullies; the headwall stays bare
        let snow = smoothstep(r.snow - 0.22, r.snow - 0.04, s * (0.9 + 0.2 * ms) + (gu - 0.5) * 0.38 + (gu2 - 0.5) * 0.3) * P.ridgeSnow;
        snow *= 1 - 0.92 * smoothstep(0.15, 0.55, cliff);
        const cornice = smoothstep(0.05, 0.0, crestD) * (1 - 0.7 * cb);                    // thin bright rim on the crest
        const rock = r.tone * (0.7 + 0.6 * gu2) * (0.78 + 0.4 * smoothstep(0.1, 0.7, s));    // heath below, grey scree and crag above
        let l = mix(rock, 0.9, snow);
        l = mix(l, 0.12 + 0.2 * stri, cliff * 0.95);
        l = l * (0.5 + 0.7 * lit) + cornice * 0.15;
        let c = mix(0.3 + 0.4 * (1 - lit), 0.08 + 0.78 * (1 - lit), snow);                 // rock is cool-ish; shaded snow is blue, lit snow neutral
        c = mix(c, 0.85, cliff);                                                           // the headwall is in the cold shade of the corrie
        // aerial perspective: pale and blue with distance, and every layer's foot dissolves into valley mist
        const haze = 1 - Math.exp(-r.dist * r.dens * 0.62);
        const mist = smoothstep(0.3, 0.0, s) * 0.85;
        const hz = Math.max(haze, mist);
        lum = mix(l, hazeLum + 0.04 * (1 - k * 0.15), hz);
        cool = mix(c, 0.8 + 0.2 * haze, Math.min(1, hz * 1.1));
        break;
      }
    }
    out.lum = lum; out.cool = cool < 0 ? 0 : cool > 1 ? 1 : cool;
  }
  const sky = (dir) => { skyShade(dir, SO); return SO.lum; };
  const out = { lum: 0, emissive: 0, cool: 0, snow: 0, coolSet: null };
  const ci = P.contourI;
  const rv = new Float64Array(3);                                                         // reflection vector for the ice

  // ------------------------------------------------------------------ shading
  function moor(h) {
    const x = h.x, z = h.z, t = h.t;
    out.snow = 0; out.cool = 0;
    // ---- snow lies in hollows, on flat ground and on the lee side; the windward side is scoured bare
    const sn = nz.fbm2(x * 0.13 + 20, z * 0.09, 4) * 0.5 + 0.5;
    const hol = smoothstep(0.1, -0.3, nz.fbm2(x * 0.1 + 1, z * 0.07, 3));
    const lee = smoothstep(-0.5, 0.6, h.nx);
    const sc2 = (sn - 0.5) * 1.3 + 0.3 * hol + 0.22 * (lee - 0.5) + 0.12 * (smoothstep(0.78, 0.97, h.ny) - 0.5) + 0.14 * nz2.n2(x * 0.7, z * 0.3);
    const thr = 0.32 - 0.6 * P.snowCover;
    const snow = smoothstep(thr - 0.04, thr + 0.07, sc2) * smoothstep(0.55, 0.85, h.ny);
    // ---- peat, bleached grass, heather, tussocks
    const gr = smoothstep(-0.15, 0.3, nz.fbm2(x * 0.17 + 5, z * 0.12, 3));
    const heath = smoothstep(1 - P.heatherCover - 0.1, 1 - P.heatherCover + 0.1, nz2.fbm2(x * 0.26, z * 0.16 + 2, 3) * 0.5 + 0.5 + 0.2 * (nz.n2(x * 1.3, z * 0.6)));
    const bare = smoothstep(1 - P.bareCover - 0.1, 1 - P.bareCover + 0.1, nz.fbm2(x * 0.15 + 40, z * 0.1, 3) * 0.5 + 0.5);
    const speck = nz2.n2(x * 2.6, z * 1.2) * 0.5 + nz2.n2(x * 9, z * 4) * 0.3;
    // clumps: the tussock domes are dark heather or bleached grass (they poke through the snow)
    const c1 = tussockH(x, z) / P.tussockH, k1 = TT, c2 = tussockH(x, z, P.hummockCell, P.hummockCover, P.hummockH, 133) / P.hummockH, k2 = TT;
    const cm = Math.max(c1, c2), kind = c1 >= c2 ? k1 : k2;
    const clumpMask = smoothstep(0.03, 0.22, cm);
    const clumpTone = kind < P.heatherCover ? P.moorHeather * (0.8 + 0.6 * speck) : P.moorGrass * (0.8 + 0.5 * cm) + 0.1;
    let a = mix(P.moorPeat, P.moorGrass, gr * (1 - bare * 0.7));
    a = mix(a, P.moorHeather, heath * (1 - bare) * 0.85);
    a += 0.09 * speck;
    a *= 1 - 0.5 * smoothstep(0.7, 0.2, h.ny);                                              // steep banks (hag walls) darker
    a = mix(a, P.moorSnow * (0.93 + 0.1 * speck), snow);
    a = mix(a, clumpTone, clumpMask * (1 - 0.35 * snow));
    const blade = nz2.n2(x * 4.5 + 9, z * 2.2) * 0.5 + 0.5;                                  // grass blades and pebbles: fine texture that matters near the camera
    a *= 0.8 + 0.4 * smoothstep(0.4, 0.8, blade) * (1 - 0.6 * snow);
    // near ground (just behind the ring) is darker: peat, heather, the ring's shade
    const nearK = P.moorNear + (1 - P.moorNear) * smoothstep(8, 30, t);
    a *= nearK;
    out.snow = snow;
    // ---- a frozen pool: flat ice reflecting the sky and the ridges, pale and cold
    let ice = 0;
    if (z > 14 && poolInfo(x, z) > 0) ice = PI.ice;
    if (ice > 0.02) {
      const nv = h.nx * h.vx + h.ny * h.vy + h.nz * h.vz;
      rv[0] = -h.vx + 2 * nv * h.nx; rv[1] = -h.vy + 2 * nv * h.ny; rv[2] = -h.vz + 2 * nv * h.nz;
      skyShade(rv, SO);
      const fr = 0.3 + 0.7 * Math.pow(1 - clamp(nv, 0, 1), 3);
      const il = mix(0.5 * h.light + 0.04, SO.lum * 0.95, fr);
      a = mix(a, 0, 0);                                                                        // (keep a for the blend below)
      const lumIce = il * (0.9 + 0.1 * speck);
      out.snow = mix(out.snow, 0.4, ice);
      out.cool = ice * (0.45 + 0.4 * SO.cool);
      out.lumIce = lumIce; out.ice = ice;
    } else { out.ice = 0; }
    // ---- OS sheet: contour lines and a grid, in screen-constant widths
    // screen-space derivatives of the terrain, exact for slopes: metres of z (and of height) per final pixel going up the screen, metres of x per pixel across it
    const zc = z - cam.z, fpx = zc * pxf, dz0 = 0.25;
    const h0 = moorBase(x, z), h1 = moorBase(x, z + dz0), hx = moorBase(x + fpx, z);
    const rowpx = Math.abs((h1 - cam.y) / (zc + dz0) - (h0 - cam.y) / zc) / pxf;
    const dzp = rowpx > 1e-3 ? Math.min(dz0 / rowpx, 60) : 60;
    const dhx = hx - h0, dhz = (h1 - h0) * dzp / dz0, fp = fpx;
    const G = Math.sqrt(dhx * dhx + dhz * dhz);                                           // height change per pixel on screen
    const k = h0 / ci, kr = Math.round(k), dist = Math.abs(k - kr) * ci;                  // distance (m of height) to the nearest contour
    const idx = ((kr % P.contourIndex) + P.contourIndex) % P.contourIndex === 0;
    const lw = idx ? P.contourLW * 1.7 : P.contourLW;
    const dpx = dist / (G + 1e-5);
    let line = clamp(lw * 0.5 + 0.5 - dpx, 0, 1);
    line *= 1 - smoothstep(0.3 * ci, 0.6 * ci, G);                                       // lines closer than ~2 px vanish (no moire)
    if (P.dbg === 1) return line;
    if (P.dbg === 2) return Math.min(1, G * 4);
    const lineInk = line * (idx ? P.contourIndexInk : P.contourInk);
    const gs = P.gridSize;
    const fx = x / gs, fz = z / gs;
    const dgx = Math.abs(fx - Math.round(fx)) * gs / (fp + 1e-5), dgz = Math.abs(fz - Math.round(fz)) * gs / (dzp + 1e-5);
    let gl = Math.max(clamp(P.gridLW * 0.5 + 0.5 - dgx, 0, 1), clamp(P.gridLW * 0.5 + 0.5 - dgz, 0, 1));
    const spacing = Math.min(gs / (fp + 1e-5), gs / (dzp + 1e-5));
    gl *= smoothstep(2.5, 6, spacing);
    const gridInk = gl * P.gridInk;
    const ink = Math.max(lineInk, gridInk);
    a *= 1 - ink;
    out.lineK = ink;
    return a;
  }

  function ringAlbedo(h) {
    const top = P.calmTop * smoothstep(calmFrom, calmFrom + P.calmRange * R0, h.y), foot = smoothstep(P.calmBottomY, P.calmBottomY - 0.7, h.y), calm = Math.max(top, 0.8 * P.calmBottom * foot);
    let a = stoneAlbedo(h.x, h.y, h.z, 17, { base: P.ringBase, strata: P.ringStrata * (1 - calm), strataFreq: 1.3, lichen: P.lichen * (1 - 0.92 * calm), lichenScale: P.lichenScale, lichenTone: P.lichenTone, lichenDark: 0.2, pit: P.pit * (1 - 0.75 * calm), pitScale: P.pitScale, grain: P.grain, warp: 0.6 });
    // dark blotches / stains: the crevices of the photo
    const st = 0.5 + 0.5 * nz.fbm3(h.x * 0.8 + 4, h.y * 0.8, h.z * 0.8, 4);
    a *= 1 - P.crevice * smoothstep(0.52, 0.8, st) * (0.7 + 0.3 * (1 - calm));
    a *= (1 - 0.45 * top) * (1 - 0.5 * P.calmBottom * foot);
    const rho = Math.sqrt(h.x * h.x + h.y * h.y);
    a *= 1 - 0.28 * smoothstep(R0 + 0.5, R0, rho);                                         // the bore and the lip are stained darker
    return a;
  }


  return {
    camera,
    sun: { dir: sun, color: P.sunColor, softness: P.sunSoft },
    ambient: { sky: P.ambSky, ground: P.ambGround }, rim: 0.12, bounce: 0.1, aoRadius: P.aoRadius, aoStrength: P.aoStrength, shadowDist: 90, shadowSteps: 64,
    sky, skyShade, fogDensity: P.fogDensity, fogFall: P.fogFall, fogLum: P.hazeLum,
    coolShadow: P.coolShadow, coolAO: P.coolAO, coolSnow: P.coolSnow, coolHaze: P.coolHaze, coolLit: P.coolLit,
    skyCool: { horizon: P.skyCoolHorizon, zenith: P.skyCoolZenith },
    emissiveMats: [ID_EMBER],
    layers: [Dm + 6, Dm + 90],
    bounds: { min: [-900, -30, -D - 1], max: [900, 160, 700] }, far: 700, maxSteps: 240,
    map(x, y, z) {
      mreset();
      const dg = ground.d(x, y, z), dr = P.noRing ? 1e9 : ringD(x, y, z), dp = props.d(x, y, z);
      let d = dg, id = ID_GROUND, i = 0;
      if (dr < d) { d = dr; id = ID_RING; }
      if (dp < d) { d = dp; id = props.lastId; i = props.lastIdx; }
      M.d = d; M.id = id; M.i = i;
      return d;
    },
    shade(h) {
      const id = h.id;
      out.emissive = 0; out.cool = 0; out.snow = 0; out.coolSet = null;
      if (id === ID_EMBER) { out.lum = 0.9; out.emissive = 1; return out; }
      let a;
      if (id === ID_GROUND) {
        a = moor(h);
        if (P.dbg) { out.lum = a; return out; }
        if (P.dbgAlb) { out.lum = a * 0.9; return out; }
        if (out.ice > 0.02) {
          const lg = a * h.light;
          out.lum = mix(lg, out.lumIce, out.ice);
          out.cool += out.lineK * P.contourCool * (1 - out.ice * 0.5);
          return out;
        }
        out.cool += out.lineK * P.contourCool;
        out.lum = a * h.light;
        return out;
      }
      if (id === ID_RING) { a = ringAlbedo(h); }
      else if (id === ID_MENHIR) {
        const yy = (h.y - mBaseY) / mH;
        a = stoneAlbedo(h.x * 1 / sc, h.y / sc, h.z / sc, 29, { base: P.menhirBase, strata: 0.05, strataFreq: 2.4, lichen: 0.32, lichenScale: 4, lichenTone: 0.62, lichenDark: 0.2, pit: 0, pitScale: 14, grain: 0 });
        const st = 0.5 + 0.5 * nz.fbm3(h.x * 0.9 / sc, h.y * 0.5 / sc, h.z * 0.9 / sc, 3);
        a *= 1 - 0.35 * smoothstep(0.52, 0.8, st);
        a *= 1 - 0.3 * smoothstep(0.2, -0.02, yy);                                           // darker towards the foot
        // frost on the windward (sun / left) and the upper faces
        const wind = smoothstep(-0.2, -0.85, h.nx), up = smoothstep(0.25, 0.8, h.ny);
        const rn = 0.5 + 0.5 * nz2.fbm3(h.x * 3 / sc, h.y * 3 / sc, h.z * 3 / sc, 3);
        const rime = clamp((wind * 0.55 + up * 0.9 + 0.35 * smoothstep(0.7, 1.0, yy)) * (0.45 + 0.8 * rn) * P.menhirRime, 0, 1) * smoothstep(0.1, 0.35, yy);
        a = mix(a, 0.95, rime * smoothstep(0.35, 0.65, rn + rime * 0.5));
        out.snow = rime;
        out.coolSet = 0.2 + 0.6 * smoothstep(0.15, -0.3, h.ndl) + 0.15 * (1 - h.ao);       // sunward and front faces neutral, the lee side cold (steady, not a dither of self-shadow)
      } else if (id === ID_TUFT) {
        const k = clamp((h.y - gh(h.x, h.z)) / (P.tuftH * 1.1), 0, 1);
        a = 0.3 + 0.35 * k * (0.5 + 0.5 * nz.n3(h.x * 8, h.y * 8, h.z * 8));                 // bleached grass
      } else {
        const rr = 0.5 + 0.5 * nz.n3(h.x * 3, h.y * 3, h.z * 3);
        a = 0.3 + 0.18 * rr + 0.1 * (0.5 + 0.5 * nz.n3(h.x * 14, h.y * 14, h.z * 14));       // boulders: dark lichened granite
        const rime = smoothstep(0.35, 0.8, h.ny) * (0.5 + 0.7 * rr) + smoothstep(-0.2, -0.8, h.nx) * 0.25;
        a = mix(a, 0.93, clamp(rime * P.rime, 0, 1));
        out.snow = clamp(rime, 0, 1);
      }
      let lum = a * h.light;
      if (id === ID_RING) {
        const tp = P.calmTop * smoothstep(calmFrom, calmFrom + P.calmRange * R0, h.y), ft = smoothstep(P.calmBottomY, P.calmBottomY - 0.7, h.y);
        lum *= (1 - P.ringTopDark * tp) * (1 - 0.3 * P.calmBottom * ft);                  // sunlit bumps in the calm zones are held down too
        // rime: frost on the upward-facing ledges, the lip, and a little on the windward faces; thin over the calm top
        const rn = 0.5 + 0.5 * nz.fbm3(h.x * 2.2, h.y * 2.2, h.z * 2.2, 3);
        const rm = clamp((smoothstep(P.rimeFrom, P.rimeTo, h.ny) + P.rimeWind * smoothstep(-0.1, -0.8, h.nx)) * (0.4 + 0.9 * rn) * P.rime, 0, 1);
        lum = mix(lum, 0.55 + 0.35 * h.light, rm * 0.9);
        out.snow = rm;
      }
      if (id === ID_MENHIR) {                                                                // the groove lights the stone around it, pale and cold
        const dd = carveG.d(h.x, h.y, h.z);
        if (dd < glowReach) { const q = 1 - dd / glowReach; lum += P.glow * q * q; out.cool -= 0.3 * q; }
      }
      out.lum = lum;
      return out;
    },
  };
}
