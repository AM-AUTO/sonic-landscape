/**
 * DEMO SCENE: proves tools/render3d. A few rough standing stones, boulders and a short dry-stone wall (a Group of 60 slabs) on noise terrain
 * under a low raking sun, one ember groove (a crescent and rod) cut into the tallest stone, haze towards a glen of hills.
 *
 *   node tools/bake-title.mjs demo --preview out/demo.png --no-write
 *   params: sunAz (deg, 0 = from -x), sunEl (deg), seed, groove (0/1), fog
 */
import {
  M, mreset, mat, smin, Group, slab, column, roughen, roughEllipsoid, capsule, shapeSub, shapeUnion,
  terrainHeightfield, stoneAlbedo, faceted, makeSky, getNoise, clamp, mix, smoothstep,
} from '../render3d/index.mjs';
import { mulberry32 } from '../../src/core/rng.js';

const ID_GROUND = 0, ID_STONE = 1, ID_EMBER = 2, ID_WALL = 3;
export const quantise = { gamma: 1.05, contrast: 1.12, ditherScale: 0.55, sharpen: 0.3, coolMix: 0, accent: 'ember' };

export function build(params = {}) {
  const { sunAz = 20, sunEl = 17, seed = 5, groove = 1, fog = 0.0032 } = params;
  const rng = mulberry32(seed * 977);
  const nz = getNoise(seed);

  // --- terrain: a flat, tussocky foreground that climbs into a glen of hills behind the stones
  const ground = terrainHeightfield({
    seed, slopeMax: 1.4,
    height: (x, z) => {
      // a glen: the floor is flat near us, the sides and the far end rise in ridged, eroded hills
      const side = smoothstep(40, 260, Math.abs(x) + Math.max(0, 40 - z) * 0.2), end = smoothstep(70, 330, z);
      const m = Math.max(side, end);
      const hills = 45 * (0.35 + 0.65 * (0.5 + 0.5 * nz.fbm2(x * 0.011 + 3, z * 0.011, 4))) * m * m;
      const gullies = 9 * m * (1 - Math.abs(nz.fbm2(x * 0.03, z * 0.03, 3))) + 5 * m * nz.fbm2(x * 0.09 + 7, z * 0.09, 4);
      const rolling = 0.45 * nz.fbm2(x * 0.09, z * 0.09, 3);
      const tuss = 0.07 * nz.fbm2(x * 1.7, z * 1.7, 3) + 0.018 * nz.n2(x * 9, z * 9);
      return rolling + tuss + hills + gullies;
    },
  });
  const gy = (x, z) => ground.h(x, z);

  // --- stones
  const stones = new Group();
  // the tall menhir with the groove (a slab leaning a few degrees)
  const menX = 0.6, menZ = 1.5;
  const men0 = slab({ c: [menX, gy(menX, menZ) + 1.05, menZ], size: [0.95, 2.3, 0.42], rot: [0, 0, 0.03], round: 0.14, taper: 0.22, rough: 0.03, freq: 3.2, seed: 11, chip: 0.03, bulk: 0.07 });
  // groove: a crescent arc + a rod across it, cut into the face that looks at the camera (-z side of the slab)
  const grooveR = 0.05, fz = menZ - 0.21;
  const gc = [menX - 0.02, gy(menX, menZ) + 1.35];
  const polyline = [];
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.15 + 0.7 * i / 10) + Math.PI; polyline.push([gc[0] + Math.cos(a) * 0.22, gc[1] + 0.12 + Math.sin(a) * 0.2]); }
  const segs = [];
  for (let i = 0; i < polyline.length - 1; i++) segs.push([[polyline[i][0], polyline[i][1], fz], [polyline[i + 1][0], polyline[i + 1][1], fz]]);
  segs.push([[gc[0] - 0.3, gc[1] - 0.12, fz], [gc[0] + 0.3, gc[1] + 0.3, fz]]);     // the rod
  const mk = (z, r) => segs.map(([a, b]) => capsule({ a: [a[0], a[1], z], b: [b[0], b[1], z], r }));
  const carve = mk(fz, grooveR), core = mk(fz + 0.055, grooveR * 0.6);
  const carveG = new Group(); carve.forEach((c) => carveG.add(c, 0)); carveG.finish();
  const coreG = new Group(); core.forEach((c) => coreG.add(c, 0)); coreG.finish();
  const carveShape = { d: (x, y, z) => carveG.d(x, y, z), min: carveG.min, max: carveG.max, id: 0 };
  const coreShape = { d: (x, y, z) => coreG.d(x, y, z), min: coreG.min.map((v) => v - 0.05), max: coreG.max.map((v) => v + 0.05), id: 0 };
  stones.add(groove ? shapeSub(men0, carveShape, 0.012) : men0, ID_STONE);
  if (groove) stones.add(coreShape, ID_EMBER);
  // two lesser stones and boulders
  stones.add(slab({ c: [-2.0, gy(-2, 2.6) + 0.7, 2.6], size: [0.7, 1.45, 0.38], rot: [0.0, -0.4, -0.06], round: 0.12, taper: 0.2, rough: 0.04, freq: 3, seed: 12, bulk: 0.08 }), ID_STONE);
  stones.add(slab({ c: [2.9, gy(2.9, 3.2) + 0.45, 3.2], size: [0.55, 0.95, 0.4], rot: [0.0, 0.5, 0.1], round: 0.12, taper: 0.1, rough: 0.035, freq: 3.4, seed: 13, bulk: 0.07 }), ID_STONE);
  for (let i = 0; i < 7; i++) {
    const x = -4.5 + rng() * 9, z = -1 + rng() * 4, r = 0.18 + rng() * 0.32;
    const bc = [x, gy(x, z) + r * 0.45, z];
    stones.add(faceted(roughEllipsoid({ c: bc, radii: [r * 1.2, r * 0.75, r], rot: [0, rng() * 3, 0], rough: 0.03, freq: 4, seed: 20 + i, bulk: 0.04 }), { c: bc, radius: r * 0.95, count: 9, depth: 0.22, seed: 40 + i }), ID_STONE);
  }
  stones.finish();

  // --- a dry-stone wall, 60 slabs, in courses, running left-right behind the menhir
  const wall = new Group();
  const wz = 7.5;
  for (let course = 0; course < 4; course++) {
    let x = -9 + (course % 2) * 0.4;
    while (x < 9) {
      const w = 0.55 + rng() * 0.6, h = 0.18 + rng() * 0.08, d = 0.45 + rng() * 0.15;
      const cx = x + w / 2, y = gy(cx, wz) + 0.06 + course * 0.24 + h / 2;
      wall.add(slab({ c: [cx, y - 0.02, wz + (rng() - 0.5) * 0.08], size: [w, h, d], rot: [(rng() - 0.5) * 0.06, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.06], round: 0.045, rough: 0.025, freq: 5, seed: 100 + course * 40 + wall.items.length }), ID_WALL);
      x += w + 0.02;
    }
  }
  wall.finish();

  const sa = sunAz * Math.PI / 180, se = sunEl * Math.PI / 180;
  const sunDir = [-Math.cos(se) * Math.cos(sa), Math.sin(se), -Math.cos(se) * Math.sin(sa) * 0.6 - 0.55];
  const sky = makeSky({ zenith: 0.48, horizon: 0.88, below: 0.5, sun: { dir: sunDir, glow: 0.5 }, clouds: { coverage: 0.55, scale: 1.1, seed: 4, tone: 0.3, contrast: 0.7 } });
  const out = { lum: 0, emissive: 0 };

  return {
    camera: { pos: [-1.4, 1.05, -8.5], target: [0.4, 1.3, 2], fov: 36 },
    sun: { dir: sunDir, color: 1.05, softness: 0.05 },
    ambient: { sky: 0.34, ground: 0.12 },
    rim: 0.2, bounce: 0.1, aoRadius: 0.45,
    sky, fogDensity: fog, fogFall: 0.025, shadowDist: 30,
    parts: { ground, stones, wall },
    emissiveMats: [ID_EMBER],
    layers: [14, 45],
    bounds: { min: [-900, -5, -30], max: [900, 120, 900] },
    far: 900, maxSteps: 260,
    map(x, y, z) {
      mreset();
      const dg = ground.d(x, y, z);
      const ds = stones.d(x, y, z), dw = wall.d(x, y, z);
      const dst = ds < dw ? ds : dw;
      const d = smin(dg, dst, 0.06);
      if (dst < dg) { M.id = ds < dw ? stones.lastId : ID_WALL; M.i = ds < dw ? stones.lastIdx : wall.lastIdx; } else M.id = ID_GROUND;
      M.d = d;
      return d;
    },
    shade(h) {
      if (h.id === ID_EMBER) { out.lum = 0.8; out.emissive = 1; return out; }
      let a;
      if (h.id === ID_GROUND) {
        const g = 0.5 + 0.5 * nz.fbm3(h.x * 0.6, h.y * 0.6, h.z * 0.6, 3);
        const t = nz.n3(h.x * 11, h.y * 3, h.z * 11);
        a = 0.26 + 0.2 * g + 0.07 * t + 0.1 * smoothstep(0.55, 0.9, h.ny) * (0.5 + 0.5 * nz.n3(h.x * 2.4, 0, h.z * 2.4));
        if (h.y > 3) {   // the glen sides: heather patches, pale crags where it is steep
          const patch = 0.5 + 0.5 * nz.fbm3(h.x * 0.05, h.y * 0.05, h.z * 0.05, 4);
          a = 0.3 + 0.25 * patch + 0.1 * nz.n3(h.x * 0.8, h.y * 0.8, h.z * 0.8);
          a = mix(a, 0.72 + 0.1 * nz.n3(h.x * 0.3, h.y * 0.9, h.z * 0.3), smoothstep(0.86, 0.6, h.ny));
        }
      } else {
        a = stoneAlbedo(h.x, h.y, h.z, 3 + (h.id === ID_WALL ? 17 : h.i), { base: h.id === ID_WALL ? 0.46 : 0.5 });
      }
      let lum = a * h.light;
      if (groove) {   // the groove lights the stone around it, in greys
        const dd = carveG.d(h.x, h.y, h.z);
        if (dd < 0.18) lum += 0.3 * (1 - dd / 0.18) * (1 - dd / 0.18);
        out.emissive = dd < 0.1 ? 0.34 * (1 - dd / 0.1) : 0;   // a sparse ember halo round the groove (dithered by the quantiser)
      } else out.emissive = 0;
      out.lum = lum;
      return out;
    },
  };
}
