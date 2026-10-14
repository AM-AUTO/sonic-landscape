# render3d: real 3D start screens, baked to the palette

A dependency-free CPU **signed-distance-field ray marcher** (Node 22, worker_threads, deterministic) renders a scene,
a **quantiser** turns it into palette indices (two tonal ramps, the greys ink char slate ash rock fog snow and the blues deepblue steelD steel blue paleblue frost, chosen per pixel from a **coolness** channel, plus the frost accent; 8x8 ordered dither, nothing else),
`tools/bake-title.mjs` writes it as a small JS module, and `src/render/title/bakedkit.js` blits it into a screen's Raster.
Changing the sun, the camera or a stone is a parameter and a few seconds (demo, 384x216 at SS2: about 9 s on 4 cores), not a repaint.

```
node tools/bake-title.mjs demo --preview out/demo.png            # render + quantise + write src/render/title/baked/demo.js + 3x preview
node tools/bake-title.mjs demo --no-write --ss 1 --preview out/q.png      # quick look (2 s)
node tools/bake-title.mjs demo --param sunEl=8 --param groove=0 --no-write --preview out/low-sun.png
node tools/bake-title.mjs demo --no-write --preview out/c.png --crop 140,60,130,100 --preview-scale 8   # inspect detail
```
Flags: `--ss 2` supersampling (box downsample) `--w 384 --h 216` `--out file` `--preview png` `--preview-scale 3` `--crop x,y,w,h` `--lum png` (unquantised grey render)
`--param k=v` (JSON-parsed, repeatable) `--params '{json}'` `--workers N` `--no-write`, and quantiser tuning `--gamma --contrast --dither --sharpen --outline --exposure`.
The same `hash` is printed for the same scene+params on any machine and any worker count.

## Writing a scene: `tools/scenes/<name>.mjs`

```js
import { M, mreset, mat, smin, Group, slab, faceted, roughEllipsoid, terrainHeightfield, stoneAlbedo, makeSky, sunDir } from '../render3d/index.mjs';

export const quantise = { gamma: 1.05, contrast: 1.1, ditherScale: 0.55 };      // optional: this scene's quantiser defaults (CLI flags override)

export function build(params = {}) {
  const { sunAz = 250, sunEl = 17, seed = 5 } = params;
  const ground = terrainHeightfield({ seed, amp: 0.6, freq: 0.15, slopeMax: 1 });      // ground.h(x,z) = height, ground.d = distance
  const stones = new Group();
  stones.add(slab({ c: [0, ground.h(0, 2) + 0.9, 2], size: [0.9, 1.8, 0.4], taper: 0.2, bulk: 0.06 }), 1);   // material id 1
  stones.finish();
  const sun = sunDir(sunAz, sunEl), out = { lum: 0, emissive: 0 };
  return {
    camera: { pos: [0, 1.1, -8], target: [0, 1.2, 2], fov: 36 },
    sun: { dir: sun, softness: 0.05 },
    sky: makeSky({ zenith: 0.5, horizon: 0.88, sun: { dir: sun }, clouds: { coverage: 0.5 } }),
    fogDensity: 0.004, layers: [14, 45],
    map(x, y, z) {
      mreset();
      mat(ground.d(x, y, z), 0);
      mat(stones.d(x, y, z), stones.lastId, stones.lastIdx);   // or stones.mat(x, y, z): same thing
      return M.d;
    },
    shade(h) { out.lum = (h.id === 0 ? 0.3 : stoneAlbedo(h.x, h.y, h.z, h.i)) * h.light; out.emissive = 0; return out; },
  };
}
```
Rules: **`map` must not allocate and must be a lower bound** (never larger than the true distance; multiply by ~0.8 if you bend or warp space).
**Everything random comes from a seed** (`makeNoise(seed)`, `mulberry32`); no `Math.random`, no `Date`. Each worker rebuilds the scene by calling `build(params)`,
so `build` must be pure and `params` JSON-serialisable. Keep `shade` allocation-free (return one reused object). World: metres, +Y up; looking down +z, +x is screen right.
The full contract (camera, sun, sky, map, shade/hit fields, fog, emissive, layers, bounds, lighting knobs) is the header of `tools/render3d/index.mjs`.

### Material ids and per-stone variation
`mat(d, id, i)` keeps the id of the nearest element in `M.id` (and a free index in `M.i`). `Group.d()` leaves `lastId`/`lastIdx` (the child's adding order): feed `h.i` to
`stoneAlbedo(x,y,z, seed)` so every stone gets its own strata and lichen. For a smooth union of ground and stones, compute the distances yourself, `smin` them,
and set `M.id`/`M.i` by hand (see `tools/scenes/demo.mjs`).

### Coolness (blue as a second tonal ramp)
`render()` returns `cool` (0..1) beside `lum`. The quantiser picks the step from `lum`, then the grey or the blue colour of that step from `cool` by an ordered dither (cool 0 all grey, 1 all blue, between a Bayer mix, `coolDither` narrows the band), so blue defines contrast: cold shadow, distance, ice against neutral sunlit stone and snow.
Per sample: `cool = coolBase + coolShadow * (1 - sunlit) + coolAO * (1 - ao) + coolSnow * shade.snow + shade.cool`, then aerial perspective pulls it to 1 by `coolHaze * fog`. Scene knobs: `coolBase 0, coolShadow .45, coolAO .25, coolSnow .3, coolHaze .8, coolLit .15`; `shade()` may return `cool` (additive), `snow` (0..1) or `coolSet` (replaces the automatic part). Sky: `scene.skyShade(dir, out)` fills `out.lum` and `out.cool` (else `sky(dir)` plus `skyCool: {horizon, zenith}`). A scene that wants the old greys-only bake sets `export const quantise = { coolMix: 0 }` (demo, shelter do, with `accent: 'ember'`). `--cool png` writes the coolness buffer.

### Emission (the accent)
The accent is now cold light: frost (`emissive >= 0.5`) with a dithered paleblue edge (`0.25..0.5`); `accent: 'ember'` in the scene's `quantise` export brings back the red ember. Two ways. (1) A material id listed in `scene.emissiveMats`: no lighting is computed, `shade` returns `emissive: 1` (carved groove cores, a doorway glow). (2) Any material:
`shade` returns `emissive` 0..1 as coverage; `>= 0.5` is ember, `0.25..0.5` becomes a dithered ember edge, so a soft `emissive` falloff makes a sparse ember halo.
Ember glow lighting the surrounding stone in greys: add to `lum` from a distance field to the groove inside `shade` (the demo does).
Carving: `shapeSub(stone, grooveShape, 0.01)`, then put a thinner `capsule` core (emissive material) just behind the face so it shows in the groove.

## Helpers (all in `render3d/index.mjs`)
| group | what |
|---|---|
| primitives (sdf.mjs) | `sdSphere sdEllipsoid sdBox sdRoundBox sdCapsule sdTorus sdCylinder sdRoundCone sdPlane`; `smin smax smoothSub smoothInter`; `twistY bendX rotY`; `Xf` rigid transform |
| shapes (shapes.mjs) | `sphere ellipsoid box cylinder capsule torus column({base,h,r0,r1,scale})` all with `{c, rot:[rx,ry,rz], ...}`; `roughen(shape,{amp,freq,seed,oct,bulk})`, `roughBox`, `roughEllipsoid`, `slab({c,size,rot,round,taper,rough,freq,seed,chip,bulk})`, `faceted(shape,{c,radius,count,depth,k,seed})` (angular rock), `shapeUnion/shapeSub/shapeInter(a,b,k)`, `makeShape(fn,min,max)`, `place(localFn,lmin,lmax,{pos,rot,scale})` |
| Group | `new Group().add(shape, id)...finish()`; `d(x,y,z)` exact min of children, bounding-volume tree above 12 children (3000 grass blades + 260 slabs render in about 14 s); `lastId`, `lastIdx`, `mat(x,y,z)`; groups nest |
| terrain / sky / albedo | `terrainHeightfield({height?,base,amp,freq,oct,seed,ridge,warp,slopeMax,flatten})` -> `{d,h}`; `gridHeight(data,nx,nz,x0,z0,cell)`; `makeSky({zenith,horizon,below,sun,clouds})`; `sunDir(az,el)`; `stoneAlbedo(x,y,z,seed,{strata,lichen,pit,...})` |
| noise | `makeNoise(seed)` -> `n3 n2 fbm3 fbm2 ridge3`; `getNoise(seed)` (cached); `worley3(x,y,z,seed)` + `WORLEY`; `hash3 hash3f` |

## Quantiser (`quantise.mjs`)
`quantise({lum, cool, emis, depth}, W, H, opts) -> Uint8Array` of PAL_INDEX (`quantiseFull` also returns the accent mask, which the baked file lists as its `embers`). `ramp` / `blueRamp` (names/indices dark->light; default the 7 greys / the 7 blues, snow shared), `coolMix` (0 ignores cool), `coolGain`, `coolDither` (0.6), `accent`/`accentEdge` ('frost'/'paleblue'), `gamma`, `contrast`/`pivot`/`exposure`,
`ditherScale` (default 0.6: **flat tints with narrow dithered seams**, like the painted covers; 1 = full Bayer blend, noisy), `sharpen` (unsharp, 0..1.5),
`outline` (ink line at depth discontinuities), `emberLo/Hi` (0.25/0.5: accent coverage thresholds). Tune per scene with `export const quantise = {...}`.

## Consuming a baked scene in a screen module
```js
import bake from './baked/shelter.js';
import { decodeBaked, blitBaked, pulseBakedEmbers, layerMaskOf } from './bakedkit.js';
import { paintTitleLogo, animLogo, paintMistBands, animMistBands, paintFootPlate } from './kit.js';

export function paint(r, spec, S) {
  S.baked = decodeBaked(bake);                  // idx (palette indices), layer (0 far, 1 mid, 3 near), embers [[x,y,phase,dimIdx]]
  blitBaked(r, S.baked);                        // writes PAL_U32 colours + layer ids into the Raster
  paintTitleLogo(r, S);
  S.mist = paintMistBands(r, [{ y: 120, rows: 22, dens: 0.5, layerMax: 1 }], S.seed);   // layerMax 1: the mist stays behind the near layer
}
export function anim(r, spec, S, t) { animMistBands(r, S.mist, t); pulseBakedEmbers(r, S.baked, t); animLogo(r, S.logo, t); }
```
`blitBaked(r, baked, {x, y, filter})` can overlay a baked scene on a hand-painted base (`filter: (x, y, idx, layer) => layer > 0` keeps your sky).
Baked modules are about 35-70 KB (bit-packed or RLE, whichever is smaller; the accent pixels are listed explicitly, and `pulseBakedEmbers` breathes them frost <-> paleblue, or the old ember <-> grey for red data).

## Tests
`tests/render3d.test.js`: multi-worker determinism, quantiser palette strictness, bake -> decode round trip, Group vs brute force, primitives, noise.
