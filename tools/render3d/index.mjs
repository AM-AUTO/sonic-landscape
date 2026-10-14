/**
 * tools/render3d: a CPU signed-distance-field ray marcher that renders a 3D scene and quantises it to the CONTOURS palette
 * (two tonal ramps, greys and blues picked per pixel from a coolness channel, plus a frost accent, ordered dither only), for the start screens. One import for scene authors:
 *     import { mreset, mat, M, Group, slab, ... } from '../render3d/index.mjs';
 *
 * SCENE CONTRACT -- tools/scenes/<name>.mjs exports  build(params) -> scene   (and optionally  export const quantise = {...})
 *
 *   scene = {
 *     camera: { pos:[x,y,z], target:[x,y,z], fov (vertical degrees), roll? (radians), shift?:[sx,sy] (lens shift, fractions of the frame) },
 *             // world: +Y up, metres. Looking down +z, +x is screen RIGHT.
 *     sun:    { dir:[x,y,z] (direction TO the sun, any length; see sunDir(az,el)), color? (intensity multiplier, default 1), softness (penumbra size ~ tan of the
 *               sun's angular radius: 0.02 crisp .. 0.15 very soft; default 0.06) },
 *     COOLNESS (0..1, which tonal ramp the quantiser uses; render() returns `cool`): scene knobs coolBase 0, coolShadow .45, coolAO .25, coolSnow .3, coolHaze .8, coolLit .15;
 *             shade() may return cool (additive), snow 0..1, coolSet (replaces the automatic part); skyShade(dir, out) -> out.lum, out.cool (see render.mjs).
 *     sky(dir) -> lum 0..1(+)     dir = Float64Array(3) unit view vector (reused: read dir[0], dir[1], dir[2], never keep it). makeSky() builds one.
 *     map(x,y,z) -> signed distance (a lower bound: never larger than the true distance). Call mreset() first, then mat(d, id[, i]) for each element so
 *               the nearest element's material id lands in M.id (M.i = element index, M.a/b/c = free hints). It must not allocate. See sdf.mjs.
 *     shade(hit) -> { lum, emissive } (a reused object) or just a number (lum). hit holds, all numbers:
 *               x,y,z (position)  nx,ny,nz (unit normal)  vx,vy,vz (unit vector to the eye)  t (distance from the eye)  id,i,a,b,c (from M)
 *               ndl (normal . sun)  shadow 0..1 (soft sun visibility)  ao 0..1  sun (sun*shadow*ndl term)  hemi (sky/ground ambient * ao)  rim  light (the sum:
 *               what a plain grey surface of albedo 1 would reflect)  lit (false for emissive materials: no lighting was computed).
 *               Typical: lum = albedo * hit.light.  lum is DISPLAY luminance 0..1 (it goes straight to the quantiser ramp, ink 0 .. snow 1).
 *               emissive 0..1 = accent coverage: >= 0.5 becomes the accent (frost; ember if the scene's quantise says accent:'ember'), 0.25..0.5 a dithered paleblue edge / halo, the tone underneath comes from lum.
 *     fogDensity (1/m; aerial perspective: lum -> fogLum with 1 - exp(-d t)), fogLum? (default: the sky at the horizon), fogFall? (height falloff 1/m), fogY0?,
 *     emissiveMats?: [ids] (materials that skip lighting entirely: shade() is called with hit.lit === false; use for glowing grooves / doorways),
 *     ambient?: { sky: .3, ground: .1 }, rim?: .15, bounce?: .1, aoRadius?: .5 (m), aoStrength?: 1, shadowDist?: 40, shadowSteps?: 56,
 *     layers?: [nearMax, midMax] metres: depth <= nearMax -> layer 3, <= midMax -> 1, else (and sky) 0   (default [10, 50]),
 *     bounds?: { min:[x,y,z], max:[x,y,z] } rays are clipped to this box (outside = sky); near?, far? (default .05 / 400), maxSteps? (200), omega? (1.3),
 *     minStep? (0.6: steps never shrink below this fraction of a pixel footprint, so grazing rays over far terrain finish)
 *   }
 *
 * FILES
 *   sdf.mjs      scalar primitives, smooth booleans, twist/bend, Xf, the material register M (mreset, mat)
 *   shapes.mjs   placed + bounded Shapes (box, slab, column, roughen, faceted, shapeSub ...) and Group (BVH: hundreds of shapes cost ~log n)
 *   helpers.mjs  terrainHeightfield, stoneAlbedo, makeSky, sunDir, small maths
 *   noise.mjs    makeNoise(seed) gradient noise / fbm / ridge, worley3, hash3
 *   render.mjs   render({scene, params, w, h, ss, workers}) -> { lum, emis, depth, layer }
 *   quantise.mjs quantise({lum, emis, depth}, w, h, opts) -> palette indices
 *   bakefmt.mjs / png.mjs   codec and preview PNG for tools/bake-title.mjs
 */
export * from './sdf.mjs';
export * from './shapes.mjs';
export * from './helpers.mjs';
export * from './noise.mjs';
export { render, renderSync, prepare, renderRows } from './render.mjs';
export { quantise, quantiseFull, rampLevels, DEFAULT_RAMP } from './quantise.mjs';
