/**
 * SHELTER: a ruined dry-stone shelter in a glen, rendered as a real 3D scene (tools/render3d) and baked for the 'shelter' start screen.
 * After the photograph: roughly coursed flat slabs in uneven courses, a heavy lintel over a low black doorway, a thick tussock-turf roof,
 * cairns and a lichened standing stone and tussock grass in front, a snow-patched hillshaded glen behind, a pale cloudy sky.
 * The ONE ember is a small glow deep inside the doorway. The ground carries thin OS contour lines (index line every 5th) and a faint 100 m
 * grid, painted on the terrain surface in shade() so they follow the land in perspective.
 *
 *   node tools/bake-title.mjs shelter --preview out/shelter.png                (render at SS2 + write src/render/title/baked/shelter.js)
 *   node tools/bake-title.mjs shelter --no-write --ss 1 --preview out/q.png    (quick look, a few seconds)
 *   node tools/bake-title.mjs shelter --param sunEl=9 --param glowInt=1.4 ...   (any key of TUNE below can be overridden from the CLI)
 *
 * ALL TUNING IS IN `TUNE` (one number each). World: metres, +Y up, the camera looks down +z, +x is screen right.
 */
import {
  M, mreset, mat, smin, smax, Group, slab, roughEllipsoid, faceted, capsule, makeShape, shapeUnion, roughen, ellipsoid,
  terrainHeightfield, stoneAlbedo, makeSky, sunDir, getNoise, clamp, mix, smoothstep, hash3f, sdBox, sdEllipsoid,
} from '../render3d/index.mjs';
import { mulberry32 } from '../../src/core/rng.js';

export const TUNE = {
  // ---- light
  sunAz: 236,          // degrees: 180 = behind the camera, 270 = from the left. 246 = low, from the left and a little in front
  sunEl: 15,           // degrees above the horizon (lower = longer shadows, more raking)
  sunInt: 1.4,        // sun strength
  sunSoft: 0.055,      // penumbra: 0.02 crisp .. 0.15 very soft
  ambSky: 0.24, ambGround: 0.09,
  aoRadius: 0.3,       // metres
  // ---- camera (low and close)
  camDist: 6.2,        // metres from the hut centre
  camH: 0.72,          // eye height
  camTilt: 1.0,        // degrees looking up
  camFov: 38,          // vertical field of view
  camShiftY: 0.13,      // lens shift: + moves the picture DOWN the frame (fraction of half the height), without changing the perspective
  camX: 0.1,           // sideways offset
  camLookX: 0.0,
  // ---- hut
  hutW: 2.9,           // outer width (m, along the front wall)
  hutD: 2.2,           // outer depth
  hutYaw: 9,           // degrees; > 0 shows the right-hand side wall (in shade) beside the lit front
  courses: 5,          // courses of slabs below the roof
  courseH: 0.165,      // average course height
  wallT: 0.5,          // wall thickness
  slabLenMin: 0.28, slabLenMax: 0.85,
  chip: 0.05,          // corner chipping (m)
  slabRough: 0.016,    // surface roughness amplitude
  pinning: 0.55,       // chance of a pinning stone wedged into a joint
  lichen: 0.42,        // lichen coverage on stone, 0..1
  doorW: 0.82, doorX: 0.12, doorCourses: 3,  // doorway width / offset / courses high (door height = those courses)
  lintelH: 0.2, lintelLen: 1.75,
  turfH: 0.42,        // thickness of the turf roof above the capstones
  turfBlades: 80,      // tufts round the fringe and over the crown
  // ---- the ember
  glowU: 0.10, glowY: 0.13, glowW: 0.62,  // position in the hut frame (u across, y up, w depth; +w = towards the back wall)
  glowR: 0.075,        // radius of the glowing coal (m)
  glowInt: 0.55,       // light thrown on the interior stones
  glowHalo: 0.34,      // reach of the sparse ember halo (m)
  // ---- foreground
  tussocks: 9,         // tussock clumps
  tussockH: 0.85,       // tallest clump (m)
  stones: 9,           // loose stones scattered round the hut
  // ---- terrain / glen
  seed: 5,
  datum: 413,          // elevation (m) of the glen floor at the hut, for the contour numbers
  floorSlope: 0.055,   // glen floor rises this much per metre going up the glen
  glenHalf: 70,        // half-width of the flat floor at the hut
  sideH: 112, sideL: 230,    // valley sides: height and run
  headZ: 420, headH: 165, headL: 380,  // the head of the glen across the far end
  relief: 0.55,         // ridged crags / gullies on the hills
  // ---- snow
  snowThr: 0.64,       // noise threshold: lower = more snow
  snowElev: 0.0007,    // snow bias per metre of elevation above the floor
  snowSlope: 0.78,     // only where the surface normal's y is above this (gentle slopes)
  // ---- OS furniture on the ground
  contourInt: 10,      // metres between contours
  contourIndex: 5,     // every Nth contour is a heavy index line
  contourStr: 0.95,   // contour darkness 0..1
  gridInt: 100,        // metres between grid lines
  gridStr: 0.7, 
  // ---- atmosphere
  fog: 0.00065,       // aerial haze per metre
  footY: 150, footDark: 0.42,   // foreground (below pixel row footY) is darkened and quietened for the text
  skyZenith: 0.62, skyHorizon: 0.86, cloudCover: 0.34,
};

export const quantise = { gamma: 1.05, contrast: 1.12, ditherScale: 0.55, sharpen: 0.4 };

const ID_GROUND = 0, ID_WALL = 1, ID_CORE = 2, ID_TURF = 3, ID_BLADE = 4, ID_TUSSOCK = 5, ID_ROCK = 6, ID_EMBER = 7, ID_LINTEL = 8;
const rad = (d) => d * Math.PI / 180;

export function build(params = {}) {
  const T = { ...TUNE, ...params };
  const rngW = mulberry32(T.seed * 7919 + 3), rngT = mulberry32(T.seed * 104729 + 11), rngS = mulberry32(T.seed * 1299709 + 5);
  const nz = getNoise(T.seed), nzb = getNoise(T.seed + 31);
  const sun = sunDir(T.sunAz, T.sunEl);

  // ------------------------------------------------------------------------------------------------ the glen
  // macro: what the contour lines describe (smooth); micro: tussock hummocks, only shaping the surface near the camera
  const macro = (x, z) => {
    const half = T.glenHalf * (1 - 0.45 * smoothstep(0, 900, z));
    const s = Math.max(0, Math.abs(x) - half);
    let rise = T.sideH * (1 - Math.exp(-s / T.sideL));
    const hz = Math.max(0, z - T.headZ);
    rise += T.headH * (1 - Math.exp(-hz / T.headL));
    const broad = 0.55 + 0.45 * (0.5 + 0.5 * nz.fbm2(x * 0.0032 + 3, z * 0.0032 - 7, 4));
    const crag = nzb.fbm2(x * 0.012, z * 0.012, 3);
    const gully = 1 - Math.abs(nzb.fbm2(x * 0.007 + 11, z * 0.007 + 2, 3));
    const e = smoothstep(2, 70, rise);
    return T.floorSlope * Math.max(z, -50) + rise * broad + e * T.relief * (16 * crag - 22 * gully * gully) + (3 + 9 * (1 - e * 0.6)) * nz.fbm2(x * 0.011, z * 0.011, 3) * smoothstep(20, 120, Math.hypot(x, z));
  };
  const padOf = (x, z) => 1 - smoothstep(2.6, 6.5, Math.hypot(x, z * 1.2));
  const micro = (x, z) => 0.085 * nz.fbm2(x * 1.1, z * 1.1, 3) + 0.015 * nz.n2(x * 7.3, z * 7.3);
  const ground = terrainHeightfield({
    seed: T.seed, slopeMax: 1.25,
    height: (x, z) => {
      const pad = padOf(x, z), m = macro(x, z), near = 1 - smoothstep(10, 60, Math.hypot(x, z));
      return (m + micro(x, z) * near) * (1 - pad);
    },
  });
  const gy = (x, z) => ground.h(x, z);

  // ------------------------------------------------------------------------------------------------ the hut
  const yaw = rad(T.hutYaw), cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const L2W = (u, w, out) => { out[0] = u * cyw + w * syw; out[1] = -u * syw + w * cyw; return out; };
  const tmp = [0, 0];
  const W = T.hutW, D = T.hutD, WT = T.wallT;
  const all = new Group();
  const info = [];                                   // per-child data for shade (blade heights etc.), indexed by the order of adding
  const add = (shape, id, data) => { info[all.items.length] = data || null; all.add(shape, id); };

  // course heights and bottoms
  const hs = [], yb = [];
  { let y = 0.0; for (let c = 0; c < T.courses; c++) { const h = c === T.doorCourses ? Math.max(T.lintelH, T.courseH) : T.courseH * (0.8 + 0.45 * rngW()); hs.push(h); yb.push(y); y += h + 0.006; } }
  const wallTop = yb[T.courses - 1] + hs[T.courses - 1];
  const doorH = yb[T.doorCourses - 1] + hs[T.doorCourses - 1];
  const doorL = T.doorX - T.doorW / 2, doorR = T.doorX + T.doorW / 2;
  const lintelL = T.doorX - T.lintelLen / 2, lintelR = T.doorX + T.lintelLen / 2;
  const LC = T.doorCourses;                          // the lintel course

  let slabN = 0;
  const wslab = (u, w, y0, lu, h, lw, o = {}) => {
    // a hut-frame slab: centre (u, y0 + h/2, w), size [lu along x, h, lw along z]
    const seedN = 100 + slabN++;
    L2W(u, w, tmp);
    const j = o.jit == null ? 1 : o.jit;
    const shape = slab({
      c: [tmp[0], y0 + h / 2, tmp[1]], size: [lu, h, lw],
      rot: [(rngW() - 0.5) * 0.05 * j, yaw + (rngW() - 0.5) * 0.06 * j, (rngW() - 0.5) * 0.05 * j + (o.roll || 0)],
      round: o.round || (0.012 + 0.014 * rngW()), taper: o.taper == null ? 0.02 * rngW() : o.taper,
      rough: T.slabRough, freq: 5 + 4 * rngW(), seed: seedN, chip: o.chip == null ? T.chip * (0.4 + rngW()) : o.chip, bulk: o.bulk == null ? 0.018 : o.bulk, bulkFreq: 2.2,
    });
    add(shape, o.id == null ? ID_WALL : o.id);
  };

  // a run of slabs along the wall axis. axis 'x': front/back walls, 'z': side walls. s0..s1 along the axis, wc = wall centre line (across)
  const joints = [];
  const run = (axis, s0, s1, wc, c) => {
    if (s1 - s0 < 0.15) return;
    let s = s0;
    const prev = joints[c - 1] || [];
    const mine = (joints[c] = joints[c] || []);
    while (s < s1 - 0.02) {
      let len = T.slabLenMin + (T.slabLenMax - T.slabLenMin) * rngW() + (rngW() < 0.15 ? 0.3 : 0);
      for (let k = 0; k < 6; k++) { if (prev.every((j) => Math.abs(s + len - j) > 0.12)) break; len = T.slabLenMin + (T.slabLenMax - T.slabLenMin) * rngW(); }
      if (s + len > s1 - 0.28) len = s1 - s;
      const h = hs[c] * (0.62 + 0.4 * rngW()), thick = WT * (0.8 + 0.34 * rngW());
      const off = (rngW() - 0.5) * 0.13;
      const batter = c * 0.006;
      const y0 = yb[c] - 0.012 + (hs[c] - h) * (rngW() * 0.3);
      if (axis === 'x') wslab(s + len / 2, wc + off + (wc < 0 ? batter : -batter), y0, len, h, thick);
      else wslab(wc + off + (wc < 0 ? batter : -batter), s + len / 2, y0, thick, h, len);
      s += len + 0.015 + 0.035 * rngW();
      mine.push(s);
      // a pinning stone wedged into the joint above or beside
      if (rngW() < T.pinning) {
        const pw = 0.07 + 0.09 * rngW();
        const pu = s - 0.01, py = y0 + h - 0.015;
        const sg = wc < 0 ? -1 : 1, pl = 0.16 + 0.1 * rngW(), ph = 0.045 + 0.04 * rngW();
        const po = { jit: 3, round: 0.015, chip: 0.01, taper: 0, bulk: 0.006, id: ID_ROCK };
        if (axis === 'x') wslab(pu, wc + sg * thick * 0.36, py, pw, ph, pl, po);
        else wslab(wc + sg * thick * 0.36, pu, py, pl, ph, pw, po);
      }
    }
  };

  const wF = -D / 2 + WT / 2, wB = D / 2 - WT / 2, uL = -W / 2 + WT / 2, uR = W / 2 - WT / 2;
  for (let c = 0; c < T.courses; c++) {
    const even = c % 2 === 0;
    // front wall (towards the camera) with the doorway
    const fa = even ? -W / 2 : -W / 2 + WT, fb = even ? W / 2 : W / 2 - WT;
    if (c < LC) { run('x', fa, doorL, wF, c); run('x', doorR, fb, wF, c); }
    else if (c === LC) { run('x', fa, lintelL, wF, c); run('x', lintelR, fb, wF, c); }
    else run('x', fa, fb, wF, c);
    run('x', even ? -W / 2 : -W / 2 + WT, even ? W / 2 : W / 2 - WT, wB, c);
    // side walls
    const sa = even ? -D / 2 + WT : -D / 2, sb = even ? D / 2 - WT : D / 2;
    run('z', sa, sb, uL, c);
    run('z', sa, sb, uR, c);
  }
  // the lintel: one heavy flat slab, proud of the wall face
  wslab(T.doorX, wF - 0.035, doorH + 0.004, T.lintelLen, hs[LC], WT + 0.12, { id: ID_LINTEL, round: 0.05, chip: 0.04, bulk: 0.018, taper: 0.04, roll: -0.014, jit: 0.4 });
  // roof: thin capstones laid across the wall tops, front to back; then the turf
  const roofY = wallTop + 0.005;
  for (let u = -W / 2 + 0.05; u < W / 2 - 0.2;) {
    const lu = Math.min(0.7 + 0.3 * rngT(), W / 2 - 0.05 - u);
    wslab(u + lu / 2, 0.01 + (rngT() - 0.5) * 0.04, roofY + (rngT() - 0.5) * 0.012, lu, 0.07 + 0.04 * rngT(), D - 0.2 + 0.06 * rngT(), { jit: 0.7, round: 0.03, taper: 0.03 });
    u += lu + 0.012;
  }
  const roofTop = roofY + 0.1;

  // the dark core: gaps between the slabs show shadow, the doorway leads into a dark room
  const coreHalfU = W / 2 - 0.09, coreHalfW = D / 2 - 0.09, inU = W / 2 - WT + 0.06, inW = D / 2 - WT + 0.06, coreTop = wallTop + 0.02;
  const hx = 0, hz = 0;
  const coreFn = (x, y, z) => {
    const u = (x - hx) * cyw - (z - hz) * syw, w = (x - hx) * syw + (z - hz) * cyw;
    const outer = sdBox(u, y - coreTop / 2, w, coreHalfU, coreTop / 2, coreHalfW);
    const inner = sdBox(u, y - coreTop / 2 + 0.03, w, inU, coreTop / 2, inW);
    const door = sdBox(u - T.doorX, y - doorH / 2, w + D / 2, T.doorW / 2, doorH / 2, WT);
    return Math.max(outer, -inner, -door);
  };
  const R0 = Math.hypot(W, D) / 2 + 0.2;
  add(makeShape(coreFn, [-R0, -0.05, -R0], [R0, coreTop + 0.05, R0]), ID_CORE);

  // the turf roof: a thick roughened mound bulging over the capstones, lumps along the crown, a shaggy fringe
  const mrx = W / 2 + 0.2, mrz = D / 2 + 0.2, tcy = roofTop + 0.0;
  const moundBase = ellipsoid({ c: [0, tcy, 0], radii: [mrx, T.turfH, mrz] });
  let mound = roughen(moundBase, { amp: 0.05, freq: 5, seed: 71, oct: 4, bulk: 0.1, bulkFreq: 1.5 });
  for (let i = 0; i < 5; i++) {
    const lx = -mrx * 0.62 + i * mrx * 0.31 + (rngT() - 0.5) * 0.2, lz = (rngT() - 0.5) * mrz * 0.8;
    const lump = roughen(ellipsoid({ c: [lx, tcy + T.turfH * (0.55 + 0.2 * rngT()), lz], radii: [0.28 + 0.2 * rngT(), T.turfH * (0.45 + 0.2 * rngT()), 0.26 + 0.15 * rngT()] }), { amp: 0.04, freq: 5, seed: 80 + i, oct: 3 });
    mound = shapeUnion(mound, lump, 0.14);
  }
  const mf = mound.d, flatY = wallTop - 0.045;
  add(makeShape((x, y, z) => smax(mf(x, y, z), flatY - y, 0.03), mound.min, mound.max), ID_TURF);

  // blades: one arched stroke = two capsules; data = base height and length so the tips can be paler than the roots
  const addBlade = (bx, by, bz, ex, ey, ez, r, id, data) => {
    const mx = bx + (ex - bx) * 0.32, my = by + (ey - by) * 0.84, mz = bz + (ez - bz) * 0.32;
    const dat = { y0: Math.min(by, ey), h: Math.max(0.06, Math.abs(ey - by)), ...data };
    add(capsule({ a: [bx, by, bz], b: [mx, my, mz], r }), id, dat);
    add(capsule({ a: [mx, my, mz], b: [ex, ey, ez], r: r * 0.7 }), id, dat);
  };
  const turfTop = (x, z) => {                         // height of the (un-roughened) mound surface
    const q = 1 - (x * x) / (mrx * mrx) - (z * z) / (mrz * mrz);
    return q > 0 ? tcy + T.turfH * Math.sqrt(q) : null;
  };
  for (let i = 0; i < T.turfBlades; i++) {
    const front = i % 5 < 3;                                    // most tufts face the camera
    const a = front ? Math.PI + (rngT() - 0.5) * 2.5 : rngT() * Math.PI * 2;   // angle round the roof, pi = front (-z)
    const rim = rngT() < 0.5, rr = rim ? 0.9 + 0.08 * rngT() : 0.15 + 0.7 * Math.sqrt(rngT());
    const x = Math.sin(a) * mrx * rr, z = Math.cos(a) * mrz * rr;
    const top = turfTop(x, z);
    if (top == null) continue;
    const n = 4 + Math.floor(rngT() * 4);
    const ox2 = Math.sin(a), oz2 = Math.cos(a);
    for (let k = 0; k < n; k++) {
      const ox = (rngT() - 0.5) * 0.14, oz = (rngT() - 0.5) * 0.14;
      const len = (rim ? 0.14 : 0.12) + 0.2 * rngT();
      const by = top - (rim ? 0.09 : 0.04);
      const out = rim ? 0.55 + 0.4 * rngT() : 0.15 + 0.3 * rngT();
      const jx = (rngT() - 0.5) * 0.5, jz = (rngT() - 0.5) * 0.5;
      addBlade(x + ox, by, z + oz, x + ox + (ox2 * out + jx) * len, by + len * (rim ? 0.15 + 0.5 * rngT() : 0.8 + 0.2 * rngT()) - (rim ? 0.08 * rngT() : 0), z + oz + (oz2 * out + jz) * len, 0.009 + 0.004 * rngT(), ID_BLADE);
    }
  }

  // ------------------------------------------------------------------------------------------------ the ember
  const gl = (() => { L2W(T.glowU, T.glowW, tmp); return [tmp[0], T.glowY, tmp[1]]; })();
  const ember = ellipsoid({ c: gl, radii: [T.glowR * 1.5, T.glowR, T.glowR * 0.8] });
  add(ember, ID_EMBER);

  // ------------------------------------------------------------------------------------------------ cairns, standing stone, loose stones
  const cairn = (cx, cz, n, w0, seed0) => {
    let y = gy(cx, cz) - 0.03;
    for (let i = 0; i < n; i++) {
      const w = w0 * (1 - i * 0.12) * (0.85 + 0.3 * rngS()), h = 0.09 + 0.07 * rngS(), d = w * (0.7 + 0.25 * rngS());
      const ox = (rngS() - 0.5) * 0.12, oz = (rngS() - 0.5) * 0.12;
      add(slab({ c: [cx + ox, y + h / 2, cz + oz], size: [w, h, d], rot: [(rngS() - 0.5) * 0.12, rngS() * 6.28, (rngS() - 0.5) * 0.12], round: 0.04, taper: 0.1, rough: 0.02, freq: 5, seed: seed0 + i, chip: 0.035, bulk: 0.02 }), ID_ROCK);
      y += h * 0.9;
    }
  };
  cairn(-2.7, -0.8, 6, 0.64, 300);
  cairn(2.8, -0.7, 7, 0.6, 320);
  cairn(-3.6, 0.3, 4, 0.5, 340);
  // the rounded standing stone with a smaller stone balanced on top, in front of the door's right side
  {
    const sx = 1.05, sz = -1.5, sy = gy(sx, sz);
    const c0 = [sx, sy + 0.14, sz];
    add(faceted(roughEllipsoid({ c: c0, radii: [0.36, 0.22, 0.29], rot: [0.03, 0.5, -0.05], rough: 0.03, freq: 4, seed: 61, bulk: 0.05 }), { c: c0, radius: 0.3, count: 10, depth: 0.22, seed: 62 }), ID_ROCK);
    const c1 = [sx + 0.05, sy + 0.38, sz];
    add(faceted(roughEllipsoid({ c: c1, radii: [0.22, 0.09, 0.17], rot: [0.05, 0.4, 0.08], rough: 0.025, freq: 5, seed: 63, bulk: 0.03 }), { c: c1, radius: 0.15, count: 7, depth: 0.25, seed: 64 }), ID_ROCK);
  }
  // loose stones (fixed places: x, z, size)
  const loose = [[-1.2, -1.6, 0.2], [-0.35, -2.1, 0.13], [0.2, -1.7, 0.1], [1.75, -1.9, 0.18], [2.6, -1.6, 0.15], [-2.9, -1.4, 0.24], [3.5, -0.9, 0.2], [-0.9, -0.95, 0.09], [1.3, -0.8, 0.1], [-1.9, 0.6, 0.15]];
  for (let i = 0; i < Math.min(T.stones, loose.length); i++) {
    const [x, z, s] = loose[i];
    const c = [x, gy(x, z) + s * 0.3, z];
    add(faceted(roughEllipsoid({ c, radii: [s * 1.3, s * 0.7, s], rot: [0, i * 1.7, 0], rough: 0.025, freq: 5, seed: 200 + i, bulk: 0.03 }), { c, radius: s, count: 8, depth: 0.2, seed: 240 + i }), ID_ROCK);
  }

  // ------------------------------------------------------------------------------------------------ tussock grass: fountains of blades
  const tussock = (cx, cz, nb, hgt, spread, seedOff) => {
    const r2 = mulberry32(seedOff * 131 + 7);
    const base = gy(cx, cz) - 0.03;
    for (let k = 0; k < nb; k++) {
      const a = r2() * 6.283, rad0 = spread * 0.3 * Math.sqrt(r2()), h = hgt * (0.3 + 0.7 * r2());
      const bx = cx + Math.cos(a) * rad0, bz = cz + Math.sin(a) * rad0;
      const lean = spread * (0.1 + 0.9 * r2() * r2()) * (0.5 + h / hgt * 0.5);
      const ang = a + (r2() - 0.5) * 0.9, droop = 0.95 - 0.5 * r2() * (h / hgt);
      addBlade(bx, base, bz, bx + Math.cos(ang) * lean, base + h * droop, bz + Math.sin(ang) * lean, 0.011 + 0.005 * r2(), ID_TUSSOCK, { y0: base, h });
    }
  };
  const tspots = [[-2.4, -1.5, 0.95], [-3.5, -0.3, 0.8], [2.5, -1.5, 0.85], [3.8, -0.2, 0.7], [-0.6, -2.3, 0.35], [0.5, -2.0, 0.28], [1.6, -2.5, 0.3], [-3.8, -1.7, 0.6], [3.9, -1.5, 0.5], [-2.0, 1.0, 0.7], [2.6, 1.0, 0.6]];
  for (let i = 0; i < Math.min(T.tussocks, tspots.length); i++) {
    const [x, z, s] = tspots[i];
    tussock(x, z, Math.round(46 * (0.5 + s * 0.6)), T.tussockH * s, 0.55 * s + 0.1, 5 + i);
  }
  all.finish();

  // ------------------------------------------------------------------------------------------------ camera, sky
  const hutBase = [0, 0, 0];
  const camPos = [T.camX, T.camH, -T.camDist];
  const tl = rad(T.camTilt);
  const camTarget = [T.camLookX, T.camH + Math.sin(tl) * 10, -T.camDist + Math.cos(tl) * 10];
  const camera = { pos: camPos, target: camTarget, fov: T.camFov, shift: [0, T.camShiftY] };
  // camera basis (as render.mjs builds it) for projecting a world point to the screen row, and for texture derivatives
  const fwd = (() => { const v = [camTarget[0] - camPos[0], camTarget[1] - camPos[1], camTarget[2] - camPos[2]]; const l = Math.hypot(...v); return v.map((a) => a / l); })();
  const rgt = (() => { const v = [fwd[2], 0, -fwd[0]]; const l = Math.hypot(...v); return v.map((a) => a / l); })();   // up x f
  const upv = [fwd[1] * rgt[2] - fwd[2] * rgt[1], fwd[2] * rgt[0] - fwd[0] * rgt[2], fwd[0] * rgt[1] - fwd[1] * rgt[0]];
  const tanH = Math.tan(rad(T.camFov) / 2), HH = 216, pxA = 2 * tanH / HH;      // radians per output pixel (small-angle)
  const screenRow = (x, y, z) => {
    const px = x - camPos[0], py = y - camPos[1], pz = z - camPos[2];
    const f = px * fwd[0] + py * fwd[1] + pz * fwd[2], u = px * upv[0] + py * upv[1] + pz * upv[2];
    return (1 - (u / f / tanH + T.camShiftY)) / 2 * HH;
  };
  const sky = makeSky({ zenith: T.skyZenith, horizon: T.skyHorizon, below: 0.55, sun: { dir: sun, glow: 0.45, size: 0.0 }, clouds: { coverage: T.cloudCover, scale: 0.55, seed: 6, tone: 0.16, contrast: 0.3 } });

  // ------------------------------------------------------------------------------------------------ shading
  const out = { lum: 0, emissive: 0 };
  const gx = gl[0], gyy = gl[1], gz = gl[2];

  // ground: thin contour lines and a faint grid, painted on the surface with screen-space (per pixel) widths so they stay thin in perspective
  const lineCov = (f, dpx, wpx) => {                  // f = coordinate in line units, dpx = change of f per output pixel
    const fr = Math.abs(f - Math.floor(f + 0.5));
    const w = wpx * dpx;
    const cov = clamp(1.7 * (1 - fr / Math.max(w, 1e-9)), 0, 1);
    return cov * (1 - smoothstep(0.3, 0.55, dpx));    // lines closer than ~2 px fade out (no moire)
  };
  function groundAlbedo(h, foot) {
    const x = h.x, y = h.y, z = h.z, ny = h.ny;
    const dist = h.t;
    const patch = 0.5 + 0.5 * nz.fbm2(x * 0.03, z * 0.03, 3);
    const lod = 1 - smoothstep(12, 45, dist);                         // fine texture fades with distance (no shimmer)
    const clump = nz.n2(x * 1.3, z * 1.3) * (1 - foot * 0.6) * lod, tuss = nz.n2(x * 0.28 + 9, z * 0.28) * (1 - foot * 0.5), grain = nz.n2(x * 5.5, z * 5.5) * (1 - foot * 0.9) * lod;
    const far = smoothstep(30, 200, dist), band = nzb.fbm2(x * 0.012 + 4, z * 0.012 + 9, 3), gul = nzb.fbm2(x * 0.045, z * 0.045, 2);
    let a = 0.36 + 0.22 * patch + 0.1 * clump + 0.06 * tuss + 0.04 * grain + far * (0.2 * band + 0.1 * gul);
    if (dist < 25) a += 0.06 * smoothstep(0.7, 0.95, ny) * lod;              // pale dead grass on the flat
    const elev = Math.max(0, h.y);
    // steep: scree and crag
    const steep = smoothstep(0.88, 0.7, ny);
    if (steep > 0) a = mix(a, 0.52 + 0.14 * nzb.n2(x * 0.15, y * 0.4 + z * 0.1), steep * 0.55);
    // snow: noise above a threshold, helped by elevation, only on gentle slopes
    const sn = nz.fbm2(x * 0.0065 + 20, z * 0.0065 - 5, 4) * 0.5 + 0.5 + nzb.n2(x * 0.05, z * 0.05) * 0.06;
    const k = sn + elev * T.snowElev - T.snowThr;
    if (k > 0 && ny > T.snowSlope - 0.12) {
      const gentle = smoothstep(T.snowSlope - 0.12, T.snowSlope + 0.05, ny);
      const cov = smoothstep(0, 0.045, k) * gentle;
      a = mix(a, 0.9 - 0.06 * nz.n2(x * 0.3, z * 0.3), cov);
    }
    return a;
  }

  // stone albedo for walls / rocks, per-stone tone
  const stoneA = (h) => {
    const t = hash3f(h.i, 7, 3, 9);
    const base = (h.id === ID_LINTEL ? 0.6 : h.id === ID_ROCK ? 0.5 : 0.5) + 0.22 * (t - 0.5);
    return stoneAlbedo(h.x, h.y, h.z, 3 + h.i, { base, strata: 0.14, strataFreq: 5 + 3 * t, lichen: T.lichen * (h.id === ID_LINTEL ? 1.4 : 1), lichenScale: 4.5, lichenTone: 0.7, pit: 0.22, tilt: [0.1 * (t - 0.5), 0.04] });
  };

  const sinkHut = (x, y, z) => {                       // hut-frame coordinates of a world point
    return [x * cyw - z * syw, y, x * syw + z * cyw];
  };

  return {
    camera,
    sun: { dir: sun, color: T.sunInt, softness: T.sunSoft },
    ambient: { sky: T.ambSky, ground: T.ambGround },
    rim: 0.18, bounce: 0.1, aoRadius: T.aoRadius, shadowDist: 40,
    sky, fogDensity: T.fog, fogFall: 0.0008,
    layers: [14, 45],
    emissiveMats: [ID_EMBER],
    bounds: { min: [-2500, -60, -60], max: [2500, 600, 2600] },
    far: 2600, maxSteps: 280, minStep: 0.7,
    map(x, y, z) {
      mreset();
      const dg = ground.d(x, y, z);
      const d0 = T.noObjects ? 1e9 : all.d(x, y, z);
      if (d0 < dg) { M.id = all.lastId; M.i = all.lastIdx; } else { M.id = ID_GROUND; M.i = 0; }
      const d = smin(dg, d0, 0.05);
      M.d = d;
      return d;
    },
    shade(h) {
      const id = h.id;
      out.emissive = 0;
      if (id === ID_EMBER) { out.lum = 0.8; out.emissive = 1; return out; }
      const row = screenRow(h.x, h.y, h.z);
      const foot = smoothstep(T.footY, 216, row);
      let a;
      let interiorK = 1;
      if (id === ID_GROUND) {
        a = groundAlbedo(h, foot);
      } else if (id === ID_WALL || id === ID_ROCK || id === ID_LINTEL) {
        a = stoneA(h);
      } else if (id === ID_CORE) {
        a = 0.06;
      } else if (id === ID_TURF) {
        const c = 0.5 + 0.5 * nz.fbm3(h.x * 6, h.y * 6, h.z * 6, 3), c2 = nz.n3(h.x * 20, h.y * 20, h.z * 20);
        a = 0.38 + 0.2 * c + 0.06 * c2 + 0.16 * smoothstep(0.3, 0.9, h.ny);
        if (h.ny < 0.25) a *= 0.55;
      } else {   // blades: dark roots, pale dry tips
        const inf = info[h.i];
        const k = inf ? clamp((h.y - inf.y0) / inf.h, 0, 1) : 0.5;
        const tint = hash3f(h.i >> 1, 3, 1, 5);
        a = id === ID_BLADE ? 0.28 + 0.4 * k + 0.12 * tint : 0.2 + 0.46 * Math.pow(k, 1.2) + 0.16 * (tint - 0.5);
      }
      // the dark doorway: surfaces round the opening fall into black with depth
      const hu = h.x * cyw - h.z * syw, hw = h.x * syw + h.z * cyw;
      const inDoor = Math.abs(hu - T.doorX) < T.doorW / 2 + 0.12 && h.y < doorH + 0.08 && hw > -D / 2 - 0.02 && hw < D / 2;
      const inRoom = Math.abs(hu) < W / 2 - WT * 0.7 && Math.abs(hw) < D / 2 - WT * 0.7 && h.y < wallTop + 0.03;
      if (id === ID_BLADE || id === ID_TUSSOCK) a *= 1.15;
      let lum;
      if (inRoom || inDoor) {
        const depth = inRoom ? 1 : smoothstep(-D / 2 + 0.02, -D / 2 + WT * 0.95, hw);
        interiorK = 1 - 0.93 * depth;
        // the ember lights the stones about it, in greys
        const dx = gx - h.x, dy = gyy - h.y, dz = gz - h.z, dd = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
        const facing = Math.max(0, (dx * h.nx + dy * h.ny + dz * h.nz) / dd) * 0.7 + 0.3;
        const glowL = T.glowInt * 0.9 * Math.exp(-(dd * dd) / (0.55 * 0.55)) * facing;
        lum = a * h.light * interiorK + a * glowL * (inRoom ? 1 : depth);
      } else if (id === ID_BLADE || id === ID_TUSSOCK) {
        lum = a * (0.42 + 0.75 * h.light);        // thin blades catch light from every side
      } else {
        lum = a * h.light;
      }
      // OS furniture on the ground
      if (id === ID_GROUND) {
        // derivatives of the map height / x / z per output pixel: step to the neighbouring rays' hits on the tangent plane
        const t = h.t, e = t * pxA;
        const dvx = -h.vx, dvy = -h.vy, dvz = -h.vz;                        // ray direction
        const dn = dvx * h.nx + dvy * h.ny + dvz * h.nz;
        const sdn = dn < -0.02 ? dn : -0.02;
        const exr = rgt[0] * e, eyr = rgt[1] * e, ezr = rgt[2] * e, exu = upv[0] * e, eyu = upv[1] * e, ezu = upv[2] * e;
        const sr = -(exr * h.nx + eyr * h.ny + ezr * h.nz) / sdn, su = -(exu * h.nx + eyu * h.ny + ezu * h.nz) / sdn;
        const qrx = h.x + exr + dvx * sr, qrz = h.z + ezr + dvz * sr, qux = h.x + exu + dvx * su, quz = h.z + ezu + dvz * su;
        const m0 = macro(h.x, h.z), mr = macro(qrx, qrz), mu = macro(qux, quz);
        const dH = (Math.abs(mr - m0) + Math.abs(mu - m0)) / T.contourInt;
        const f = (m0 + T.datum) / T.contourInt;
        const c1 = lineCov(f, dH, 0.75);
        const idx = lineCov(f / T.contourIndex, dH / T.contourIndex, 1.1);
        const fade = 1 - foot * 0.9;
        // thin ink lines: pushed to a flat dark tone so the dither cannot break them up; index lines are darker and a little heavier
        lum = mix(lum, 0.13, smoothstep(0.25, 0.6, c1) * T.contourStr * fade * 0.8);
        lum = mix(lum, 0.03, smoothstep(0.2, 0.55, idx) * T.contourStr * fade);
        // the 100 m grid: a slate tone, lighter than the dark ground and darker than the lit hills
        const G = T.gridInt;
        const dX = (Math.abs(qrx - h.x) + Math.abs(qux - h.x)) / G, dZ = (Math.abs(qrz - h.z) + Math.abs(quz - h.z)) / G;
        const gcov = Math.max(lineCov(h.x / G + 0.37, dX, 0.7), lineCov(h.z / G + 0.21, dZ, 0.7));
        lum = mix(lum, 0.3, smoothstep(0.2, 0.6, gcov) * T.gridStr * fade);
      }
      // the foreground drops into calm dark ground for the text
      lum *= 1 - T.footDark * foot;
      // the ember's sparse halo on the stone about it
      if (inRoom || inDoor) {
        const dx = gx - h.x, dy = gyy - h.y, dz = gz - h.z, dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dd < T.glowHalo) out.emissive = 0.34 * (1 - dd / T.glowHalo) * (1 - dd / T.glowHalo) * 1.6;
      }
      out.lum = lum;
      return out;
    },
  };
}
