/**
 * MENTOL (Men-an-Tol): a great rough granite slab with a round hole fills the frame; through the hole, ~6 m beyond, one tall tapering menhir
 * carrying an incised Pictish symbol whose grooves glow ember, on a pale rolling moor drawn as an OS sheet (contours + grid in the terrain
 * shader), hazing to a soft horizon under a pale cloudy sky. Greys + ONE accent: ember appears only as emission in the carving.
 *
 *   node tools/bake-title.mjs mentol --preview out/mentol.png                (final: SS2 + write src/render/title/baked/mentol.js)
 *   node tools/bake-title.mjs mentol --ss 1 --no-write --preview out/m.png   (quick look)
 *   node tools/bake-title.mjs mentol --param sunAz=250 --param holeR=1.0 ...   (any constant below is a param)
 *
 * Debug params: noRing=true (see the moor and the menhir unobstructed), dbg=1 (contour coverage) / dbg=2 (terrain slope per pixel) as luminance.
 * Every number you may want to tweak is a named constant in DEFAULTS (override from the CLI with --param name=value).
 * World: metres, +Y up, looking down +z. The ring lies in the plane z = 0 (front face) .. z = ringT (back face), the hole axis is the z axis
 * through (0, 0). The camera is derived from the SCREEN position you want the hole to have (holePx/holePy/holePr), so the framing is one
 * set of numbers in pixels: hole centre + radius, and the horizon row.
 */
import {
  M, mreset, Group, slab, capsule, roughEllipsoid, shapeSub, terrainHeightfield, stoneAlbedo, makeSky, sunDir,
  getNoise, worley3, WORLEY, clamp, smoothstep, sdRoundBox, smax,
} from '../render3d/index.mjs';
import { SYMBOL_STROKES } from '../../src/render/stone.js';
import { mulberry32 } from '../../src/core/rng.js';

export const DEFAULTS = {
  seed: 7,
  // ---- light: a soft low sun from the upper left, a little behind the camera (az 180 = behind, 270 = from the left)
  sunAz: 244, sunEl: 27, sunSoft: 0.09, sunColor: 1.1,
  // ---- framing (pixels of the 384x216 frame) and lens
  fov: 38,
  holePx: 168, holePy: 160, holePr: 94,        // screen centre + radius of the hole at the front face
  horizonY: 138,                               // screen row of the horizon (lens shift)
  // ---- the holed stone
  holeR: 1.2,                                  // hole radius (m) at its narrowest
  holeFlare: 0.16,                             // how much the hole widens towards the faces (m)
  holeWobble: 0.045,                            // irregularity of the hole outline (m)
  ringT: 2.0,                                 // thickness of the slab (m)
  ringHW: 4.4, ringTop: 3.4, ringBottom: -3,   // slab half width, top / bottom (m, relative to the hole centre)
  ringLip: 0.3,                                // rounding of the lips (m, smooth subtraction)
  ringBig: 0.34, ringBigFreq: 0.42,            // large undulations (amp m, cycles per m)
  ringMid: 0.035, ringMidFreq: 1.6,             // lumps
  ringFine: 0.014, ringFineFreq: 11,            // fine pitting
  ringCrack: 0.036, crackFreq: 0.75,                              // depth of the crevices (m)
  ringBase: 0.56,                               // granite albedo
  lichen: 0.5, lichenScale: 9, lichenTone: 0.85, pit: 0.8, pitScale: 30, grain: 0.1, // lichen speckle coverage, patches per m, tone; pitting; grain
  ringStrata: 0.0,                             // bedding bands on the ring (granite has none; 0.03 gives faint ones)
  crevice: 0.32,                                // strength of the dark blotches and stains
  calmTop: 1.0,                               // 0..1 how much the top of the ring is smoothed / simplified (the logo sits there)
  calmY: 0.5,                                  // height (x holeR) above which it starts to calm
  calmRange: 0.9,                              // (x holeR) how far above calmY the calm is complete
  calmBottom: 0.9,                            // how much the foot of the ring darkens (calm ground for the text lines)
  calmBottomY: -0.1,                           // height (m, rel. to the hole centre) where that starts
  // ---- the menhir
  menhirH: 2.45, menhirW: 1.2, menhirT: 0.7, menhirTaper: 0.8, menhirDist: 6.4, menhirDx: 6,                                 // pixels the menhir is right of the hole centre
  menhirRough: 0.042, menhirLean: 0.035,
  menhirBase: 0.6,
  // ---- the carving
  symbol: 'crescent',                          // 'crescent' | 'discs'
  symbolSize: 0.38,                            // metres per symbol unit (crescent is 2.4 x 3.4 units)
  symbolY: 0.42,                               // height of the symbol centre as a fraction of the menhir height
  symbolX: -0.02,                              // metres off the face centre
  grooveR: 0.052, coreR: 0.034, coreDepth: 0.045, // groove radius (m), glowing core radius, how far the core sits behind the face
  glow: 0.22, glowReach: 0.16, halo: 0.0,     // grey light the groove throws on the stone, its reach (m), ember halo strength (0 = none)
  // ---- the moor
  groundY: -1.15,                              // height of the ground at the ring (m)
  moorTilt: 0.04, moorAmp: 3.2, moorFreq: 0.03, moorDetail: 0.35, moorSlope: 0.7,
  hillH: 14, hillX: 45, hillZ: 170, hillW: 90,  // the distant low hill
  moorAlbedo: 0.92, moorNear: 0.3,            // moorNear: how dark the ground right behind the ring is (0..1 of the full tone): calm ground for the prompt
  moorDark: 0.4,            // pale moor, how much the heather patches darken it
  contourI: 0.2, contourIndex: 5, contourLW: 1.0, contourInk: 0.72, contourIndexInk: 0.9, // metres, every Nth heavy, px width, how dark
  gridSize: 5, gridLW: 0.9, gridInk: 0.5,    // metres, px width, darkening (slate)
  fogDensity: 0.02, fogFall: 0.0,            // aerial perspective
  tufts: 34, gorse: 14, tuftH: 0.34,             // tussocks at the foot of the menhir, gorse bushes on the moor
  // ---- sky
  skyZenith: 0.5, skyHorizon: 0.86, skyDrop: 0.3, cloud: 0.5,    // skyDrop: how much darker the sky gets within ~10 degrees of the horizon (a soft gradient inside the hole)
 
  // ---- render
  aoRadius: 0.55, ambSky: 0.58, ambGround: 0.34,
};

export const quantise = { gamma: 1.0, contrast: 1.12, ditherScale: 0.5, sharpen: 0.35, outline: 0.0 };

const ID_GROUND = 0, ID_RING = 1, ID_MENHIR = 2, ID_EMBER = 3, ID_TUFT = 4, ID_GORSE = 5;

export function build(params = {}) {
  const P = { ...DEFAULTS, ...params };
  const nz = getNoise(P.seed), nz2 = getNoise(P.seed + 11);
  const tanH = Math.tan(P.fov * Math.PI / 360), W = 384, H = 216, aspect = W / H;

  // ------------------------------------------------------------------ camera from the hole's screen position
  const shift = P.horizonY / (H / 2) - 1;
  const D = P.holeR * (H / 2) / (tanH * P.holePr);                                       // distance to the front face
  const cam = {
    x: -(P.holePx / (W / 2) - 1) * D * tanH * aspect,
    y: -D * tanH * (1 - 2 * P.holePy / H + shift),
    z: -D,
  };
  const camera = { pos: [cam.x, cam.y, cam.z], target: [cam.x, cam.y, 0], fov: P.fov, shift: [0, shift] };
  const pxf = 2 * tanH / H;                                                             // one final pixel at 1 m

  // ------------------------------------------------------------------ the moor
  const mz = P.ringT + P.menhirDist, Dm = D + mz;
  const sx = cam.x + ((P.holePx + P.menhirDx) / (W / 2) - 1) * tanH * aspect * Dm;                // the menhir stands where the hole's line of sight meets it, nudged by menhirDx px
  const ground = terrainHeightfield({
    seed: P.seed, slopeMax: P.moorSlope + 0.2,
    height: (x, z) => moorBase(x, z) + P.moorDetail * 0.3 * nz.fbm2(x * 0.18, z * 0.18, 2) * 0.35 + 0.05 * nz.fbm2(x * 1.7, z * 1.7, 2) * (0.4 + 0.6 * (1 - smoothstep(2, 12, Math.hypot(x * 0.8, z - 4)))),
  });
  function moorBase(x, z) {
    {
      const flat = 1 - smoothstep(2, 12, Math.hypot(x * 0.8, z - 4));                   // the clearing round the stones
      let v = P.moorAmp * nz.fbm2(x * P.moorFreq, z * P.moorFreq, 4) + 0.55 * P.moorAmp * nz.fbm2(x * P.moorFreq * 3.1 + 7, z * P.moorFreq * 3.1, 3);
      v = v * (1 - 0.55 * flat);
      const hill = P.hillH * Math.exp(-((x - P.hillX) * (x - P.hillX)) / (2 * P.hillW * P.hillW)) * smoothstep(60, 200, z) * (0.75 + 0.25 * nz.fbm2(x * 0.02, z * 0.02, 3));
      const rise = P.moorTilt * smoothstep(0, 30, z) * 30 + 0.012 * Math.max(0, z - 30);                                            // the moor rises very gently towards the hills
      return P.groundY + v + hill + rise;
    }
  }
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

  // ------------------------------------------------------------------ the menhir
  const mH = P.menhirH, mBaseY = gh(sx, mz) - 0.12, mcy = mBaseY + mH / 2;
  const men0 = slab({ c: [sx, mcy, mz], size: [P.menhirW, mH, P.menhirT], rot: [0, 0.0, P.menhirLean], round: 0.28, taper: P.menhirTaper, rough: P.menhirRough, freq: 6.5, seed: 31, chip: 0.08, bulk: 0.12, bulkFreq: 0.9 });
  // surface z of the face at (x, y): march along z from the camera side
  const faceZ = (x, y) => {
    let z = mz - 1.2;
    for (let i = 0; i < 400 && men0.d(x, y, z) > 0.0005; i++) { z += Math.max(0.002, men0.d(x, y, z) * 0.7); if (z > mz + 0.2) break; }
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
  const ux = (bx0 + bx1) / 2, uy = (by0 + by1) / 2, S = P.symbolSize;
  const symX = sx + P.symbolX, symY = mBaseY + P.symbolY * mH;
  const carve = [], core = [];
  for (const p of polys) {
    const pts = p.map(([x, y]) => { const wx = symX + (x - ux) * S, wy = symY - (y - uy) * S; return [wx, wy, faceZ(wx, wy)]; });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      carve.push(capsule({ a, b, r: P.grooveR }));
      core.push(capsule({ a: [a[0], a[1], a[2] + P.coreDepth], b: [b[0], b[1], b[2] + P.coreDepth], r: P.coreR }));
    }
  }
  const carveG = new Group(), coreG = new Group();
  carve.forEach((c) => carveG.add(c, 0)); carveG.finish();
  core.forEach((c) => coreG.add(c, 0)); coreG.finish();
  const carveShape = { d: (x, y, z) => carveG.d(x, y, z), min: carveG.min, max: carveG.max, id: 0 };
  const coreShape = { d: (x, y, z) => coreG.d(x, y, z), min: coreG.min.map((v) => v - 0.05), max: coreG.max.map((v) => v + 0.05), id: 0 };

  const props = new Group();
  props.add(shapeSub(men0, carveShape, 0.012), ID_MENHIR);
  props.add(coreShape, ID_EMBER);
  // tussocks at the foot of the menhir: clusters of leaning blades; gorse bushes further out
  const rng = mulberry32(P.seed * 911 + 5);
  for (let k = 0; k < P.tufts; k++) {
    const a = rng() * Math.PI * 2, rad = 0.6 + rng() * 1.3, x = sx + Math.cos(a) * rad * 1.15, z = mz - 0.15 + Math.sin(a) * rad * 0.8;
    const g0 = gh(x, z), nb = 9 + Math.floor(rng() * 6), h0 = P.tuftH * (0.5 + rng() * 0.7);
    for (let b = 0; b < nb; b++) {
      const ba = rng() * Math.PI * 2, lean = 0.12 + rng() * 0.3, hh = h0 * (0.5 + rng() * 0.7);
      props.add(capsule({ a: [x + (rng() - 0.5) * 0.06, g0 - 0.02, z + (rng() - 0.5) * 0.06], b: [x + Math.cos(ba) * lean, g0 + hh, z + Math.sin(ba) * lean], r: 0.022 + rng() * 0.014 }), ID_TUFT);
    }
  }
  for (let k = 0; k < P.gorse; k++) {
    const zz = rng(), z = P.ringT + 9 + zz * zz * 70, x = (rng() - 0.4) * (14 + z * 0.9), r = (0.35 + rng() * 0.5) * (1 + z * 0.02);
    if (Math.abs(x - sx) < 1.6 && Math.abs(z - mz) < 2) continue;
    const c = [x, gh(x, z) + r * 0.35, z];
    props.add(roughEllipsoid({ c, radii: [r * 1.3, r * 0.75, r], rot: [0, rng() * 3, 0], rough: 0.15, freq: 4.2, seed: 50 + k, bulk: 0.06 }), ID_GORSE);
  }
  props.finish();

  // ------------------------------------------------------------------ sun, sky
  const sun = sunDir(P.sunAz, P.sunEl);
  const sky0 = makeSky({ zenith: P.skyZenith, horizon: P.skyHorizon, below: 0.7, clouds: { coverage: P.cloud, scale: 1.0, seed: 4, tone: 0.14, contrast: 0.45 } });
  const sky = (dir) => sky0(dir) - P.skyDrop * smoothstep(0.01, 0.2, dir[1]);
  const out = { lum: 0, emissive: 0 };
  const ci = P.contourI;

  // ------------------------------------------------------------------ shading
  function moor(h) {
    const x = h.x, z = h.z, t = h.t;
    const g = 0.5 + 0.5 * nz.fbm3(x * 0.09, 0, z * 0.09, 3);
    const speck = nz2.n3(x * 2.6, 0, z * 2.6) * 0.5 + nz2.n3(x * 9, 0, z * 9) * 0.3;
    let a = P.moorAlbedo - P.moorDark * smoothstep(0.55, 0.95, 1 - g) + 0.06 * speck;
    a *= 1 - 0.55 * smoothstep(0.7, 0.2, h.ny);                                           // steep banks darker
    a *= 1 + 0.16 * nz2.fbm3(x * 0.7, 0, z * 0.7, 2);                                      // tussock mottling
    // near ground (just behind the ring) is darker: peat, heather, the ring's shade
    a *= P.moorNear + (1 - P.moorNear) * smoothstep(8, 34, t);
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
    a *= 1 - line * (idx ? P.contourIndexInk : P.contourInk);
    const gs = P.gridSize;
    const fx = x / gs, fz = z / gs;
    const dgx = Math.abs(fx - Math.round(fx)) * gs / (fp + 1e-5), dgz = Math.abs(fz - Math.round(fz)) * gs / (dzp + 1e-5);
    let gl = Math.max(clamp(P.gridLW * 0.5 + 0.5 - dgx, 0, 1), clamp(P.gridLW * 0.5 + 0.5 - dgz, 0, 1));
    const spacing = Math.min(gs / (fp + 1e-5), gs / (dzp + 1e-5));
    gl *= smoothstep(2.5, 6, spacing);
    a *= 1 - gl * P.gridInk;
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
    ambient: { sky: P.ambSky, ground: P.ambGround }, rim: 0.12, bounce: 0.1, aoRadius: P.aoRadius, aoStrength: 0.95, shadowDist: 60, shadowSteps: 64,
    sky, fogDensity: P.fogDensity, fogFall: P.fogFall,
    emissiveMats: [ID_EMBER],
    layers: [16, 70],
    bounds: { min: [-700, -30, -D - 1], max: [700, 160, 600] }, far: 600, maxSteps: 240,
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
      out.emissive = 0;
      if (id === ID_EMBER) { out.lum = 0.85; out.emissive = 1; return out; }
      let a;
      if (id === ID_GROUND) a = moor(h);
      else if (id === ID_RING) { a = ringAlbedo(h); }
      else if (id === ID_MENHIR) {
        a = stoneAlbedo(h.x, h.y, h.z, 29, { base: P.menhirBase, strata: 0.1, strataFreq: 2.4, lichen: 0.55, lichenScale: 8, lichenTone: 0.88, lichenDark: 0.22, pit: 0.6, pitScale: 30, grain: 0.08 });
        const st = 0.5 + 0.5 * nz.fbm3(h.x * 0.9, h.y * 0.5, h.z * 0.9, 3);
        a *= 1 - 0.55 * smoothstep(0.52, 0.8, st);
        a *= 1 - 0.3 * smoothstep(0.9, -0.1, h.y - mBaseY);                                  // darker towards the foot
      } else if (id === ID_TUFT) {
        const k = clamp((h.y - gh(h.x, h.z)) / (P.tuftH * 1.1), 0, 1);
        a = 0.14 + 0.32 * k * (0.5 + 0.5 * nz.n3(h.x * 8, h.y * 8, h.z * 8));
      } else {
        a = 0.17 + 0.2 * (0.5 + 0.5 * nz.n3(h.x * 14, h.y * 14, h.z * 14)) * smoothstep(0.1, 0.9, h.ny);
      }
      let lum = a * h.light;
      if (id === ID_RING) {
        const tp = P.calmTop * smoothstep(calmFrom, calmFrom + P.calmRange * R0, h.y), ft = smoothstep(P.calmBottomY, P.calmBottomY - 0.7, h.y);
        lum *= (1 - 0.3 * tp) * (1 - 0.3 * P.calmBottom * ft);                            // sunlit bumps in the calm zones are held down too
      }
      if (id === ID_MENHIR) {                                                                // the groove lights the stone around it, in greys
        const dd = carveG.d(h.x, h.y, h.z);
        if (dd < P.glowReach) { const q = 1 - dd / P.glowReach; lum += P.glow * q * q; }
        const hr = 0.09;
        if (P.halo > 0 && dd < hr) out.emissive = P.halo * (1 - dd / hr);
      }
      out.lum = lum;
      return out;
    },
  };
}
