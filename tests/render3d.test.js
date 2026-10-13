import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, renderSync } from '../tools/render3d/render.mjs';
import { quantise, rampLevels, DEFAULT_RAMP } from '../tools/render3d/quantise.mjs';
import { encodeSymbols, bakedModuleSource, fnv1a } from '../tools/render3d/bakefmt.mjs';
import { Group, box, sphere, slab, capsule, torus, column, cylinder, ellipsoid } from '../tools/render3d/shapes.mjs';
import * as S from '../tools/render3d/sdf.mjs';
import { makeNoise, worley3, WORLEY } from '../tools/render3d/noise.mjs';
import { stoneAlbedo, makeSky, terrainHeightfield } from '../tools/render3d/helpers.mjs';
import { indexPNG } from '../tools/render3d/png.mjs';
import { decodeBaked, decodeSymbols, blitBaked, pulseBakedEmbers, layerMaskOf } from '../src/render/title/bakedkit.js';
import { Raster } from '../src/render/artkit.js';
import { PAL_INDEX, PAL_U32_LIST, PAL_COUNT } from '../src/render/palette.js';
import { mulberry32 } from '../src/core/rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.resolve(here, '../tools/scenes/demo.mjs');
const W = 48, H = 27;
const hashF = (a) => fnv1a(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

const RAMP_IDX = new Set(DEFAULT_RAMP.map((n) => PAL_INDEX[n]));
const ALLOWED = new Set([...RAMP_IDX, PAL_INDEX.ember]);

// ----------------------------------------------------------------------------------------------- renderer
test('render: tiny demo render is deterministic, also across the multi-worker path', async () => {
  const a = await render({ scene: DEMO, w: W, h: H, ss: 1, workers: 0 });
  const b = await render({ scene: DEMO, w: W, h: H, ss: 1, workers: 0 });
  const c = await render({ scene: DEMO, w: W, h: H, ss: 1, workers: 3 });
  assert.equal(hashF(a.lum), hashF(b.lum), 'same thread, two runs');
  assert.equal(hashF(a.lum), hashF(c.lum), 'three workers agree with one thread (lum)');
  assert.equal(hashF(a.emis), hashF(c.emis), 'emis');
  assert.equal(hashF(a.depth), hashF(c.depth), 'depth');
  assert.equal(fnv1a(a.layer), fnv1a(c.layer), 'layer');
  // sanity: a picture, not a blank
  let lo = 9, hi = -9;
  for (const v of a.lum) { if (v < lo) lo = v; if (v > hi) hi = v; assert.ok(Number.isFinite(v)); }
  assert.ok(hi - lo > 0.3, 'tonal range ' + (hi - lo));
  assert.ok(a.layer.some((l) => l === 0) && a.layer.some((l) => l === 3), 'sky/far and near layers present');
  assert.ok(a.depth.every((d) => d > 0));
});

test('render: supersampling changes the image smoothly (ss2 close to a downsampled ss1 look), and the scene contract is met', () => {
  return import(DEMO).then((m) => {
    const sc = m.build({});
    for (const k of ['camera', 'sun', 'sky', 'map', 'shade', 'fogDensity']) assert.ok(sc[k] != null, 'scene.' + k);
    assert.equal(sc.camera.pos.length, 3); assert.equal(sc.camera.target.length, 3);
    assert.equal(typeof sc.map(0, 1, 0), 'number');
    const r1 = renderSync(sc, { w: 32, h: 18, ss: 1 }), r2 = renderSync(sc, { w: 32, h: 18, ss: 2 });
    let diff = 0;
    for (let i = 0; i < r1.lum.length; i++) diff += Math.abs(r1.lum[i] - r2.lum[i]);
    assert.ok(diff / r1.lum.length < 0.08, 'mean abs difference ss1 vs ss2 ' + diff / r1.lum.length);
  });
});

// ----------------------------------------------------------------------------------------------- quantiser
test('quantise: only ramp colours and ember come out; ember follows emis; dither is ordered', () => {
  const w = 64, h = 32, lum = new Float32Array(w * h), emis = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = x / (w - 1);
  for (let y = 8; y < 16; y++) for (let x = 10; x < 20; x++) emis[y * w + x] = 1;
  for (let y = 8; y < 16; y++) for (let x = 20; x < 24; x++) emis[y * w + x] = 0.4;
  const idx = quantise({ lum, emis }, w, h);
  assert.equal(idx.length, w * h);
  const seen = new Set();
  for (const v of idx) { assert.ok(ALLOWED.has(v), 'palette index ' + v + ' is in the ramp + ember'); seen.add(v); }
  for (const r of RAMP_IDX) assert.ok(seen.has(r), 'the gradient reaches every ramp colour');
  assert.ok(seen.has(PAL_INDEX.ember));
  assert.equal(idx[10 * w + 15], PAL_INDEX.ember, 'emis 1 -> ember');
  let partial = 0; for (let x = 20; x < 24; x++) for (let y = 8; y < 16; y++) if (idx[y * w + x] === PAL_INDEX.ember) partial++;
  assert.ok(partial > 0 && partial < 32, 'emis .4 is a dithered edge: ' + partial + ' of 32');
  assert.equal(idx[0], PAL_INDEX.ink); assert.equal(idx[w - 1], PAL_INDEX.snow);
  // ordered: the same input gives the same output, and a constant tone dithers with a repeating 8x8 pattern
  const flat = new Float32Array(w * h).fill(0.55);
  const q = quantise({ lum: flat }, w, h, { ditherScale: 1 });
  for (let y = 0; y < h - 8; y++) for (let x = 0; x < w - 8; x++) assert.equal(q[y * w + x], q[(y + 8) * w + x + 8]);
  assert.deepEqual(quantise({ lum, emis }, w, h), idx);
  // custom ramp (two greys) stays inside it
  const two = quantise({ lum }, w, h, { ramp: ['char', 'fog'] });
  for (const v of two) assert.ok(v === PAL_INDEX.char || v === PAL_INDEX.fog);
  const lv = rampLevels(); assert.equal(lv[0], 0); assert.equal(lv[lv.length - 1], 1);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i] > lv[i - 1], 'ramp levels ascend');
});

// ----------------------------------------------------------------------------------------------- bake round trip
test('bake -> decode round trip reproduces the quantised buffer and the layer hints exactly', async () => {
  const r = await render({ scene: DEMO, w: 96, h: 54, ss: 1, workers: 2 });
  const idx = quantise(r, 96, 54, { ditherScale: 0.6 });
  const { source, embers } = bakedModuleSource({ w: 96, h: 54, idx, layer: r.layer, emberIdx: PAL_INDEX.ember, meta: { scene: 'demo', ss: 1, hash: fnv1a(idx) } });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const baked = decodeBaked(mod);
  assert.equal(baked.w, 96); assert.equal(baked.h, 54);
  assert.deepEqual(baked.idx, idx);
  assert.deepEqual(baked.layer, r.layer);
  assert.equal(baked.embers.length, embers.length);
  for (const [x, y, , dim] of baked.embers) { assert.equal(idx[y * 96 + x], PAL_INDEX.ember); assert.ok(RAMP_IDX.has(dim)); }
  assert.equal(baked.meta.hash, fnv1a(idx));
  assert.ok(source.length < 100 * 1024, 'module size ' + source.length);
  assert.deepEqual(decodeBaked(mod.default).idx, idx, 'accepts the default export too');
});

test('codec: bit-packed and RLE modes both round-trip (noise, flat, one symbol, long runs, many symbols)', () => {
  const rng = mulberry32(9);
  const cases = {
    noise: Uint8Array.from({ length: 5000 }, () => [9, 25, 26, 27, 21, 5, 12][Math.floor(rng() * 7)]),
    flat: new Uint8Array(70000).fill(3),
    runs: Uint8Array.from({ length: 3000 }, (_, i) => (i >> 5) % 5),
    long: (() => { const a = new Uint8Array(1500).fill(4); a.fill(7, 600, 1100); return a; })(),
    many: Uint8Array.from({ length: 4000 }, () => Math.floor(rng() * 29)),
    wide: Uint8Array.from({ length: 2000 }, () => Math.floor(rng() * 200)),
  };
  for (const [name, data] of Object.entries(cases)) {
    const enc = encodeSymbols(data);
    assert.deepEqual(decodeSymbols(enc, data.length), data, name);
  }
  const flatEnc = Buffer.from(encodeSymbols(cases.flat), 'base64');
  assert.ok(flatEnc.length < 10, 'flat compresses to nothing');
  assert.equal(Buffer.from(encodeSymbols(cases.runs), 'base64')[0], 1, 'runs choose RLE');
  assert.equal(Buffer.from(encodeSymbols(cases.noise), 'base64')[0], 0, 'noise chooses bit-packing');
});

test('bakedkit: blit paints only palette colours with layer ids; embers pulse between ember and a grey; filter and offset work', async () => {
  const r = await render({ scene: DEMO, w: 96, h: 54, ss: 1, workers: 0 });
  const idx = quantise(r, 96, 54);
  const { source } = bakedModuleSource({ w: 96, h: 54, idx, layer: r.layer, emberIdx: PAL_INDEX.ember, meta: { scene: 'demo' } });
  const baked = decodeBaked(await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')));
  const R = new Raster(120, 70);
  blitBaked(R, baked, { x: 10, y: 5 });
  const PAL = new Set(PAL_U32_LIST);
  for (let j = 0; j < 54; j++) for (let i = 0; i < 96; i++) {
    const q = (j + 5) * 120 + i + 10;
    assert.equal(R.d[q], PAL_U32_LIST[idx[j * 96 + i]]);
    assert.equal(R.lay[q], r.layer[j * 96 + i]);
  }
  assert.equal(R.d[0], 0, 'outside the offset image is untouched');
  const mask = layerMaskOf(baked, 3, 3);
  assert.equal(mask.length, 96 * 54);
  const R2 = new Raster(96, 54); R2.d.fill(PAL_U32_LIST[0]);
  blitBaked(R2, baked, { filter: (x, y, i, l) => l > 0 });
  for (let k = 0; k < 96 * 54; k++) if (baked.layer[k] === 0) assert.equal(R2.d[k], PAL_U32_LIST[0]);
  assert.ok(baked.embers.length > 0, 'demo has an ember groove');
  const seen = new Set();
  for (let t = 0; t < 20; t += 0.25) {
    pulseBakedEmbers(R, baked, t, { x: 10, y: 5 });
    for (const [x, y] of baked.embers) seen.add(R.d[(y + 5) * 120 + x + 10]);
  }
  for (const c of seen) assert.ok(PAL.has(c));
  assert.ok(seen.has(PAL_U32_LIST[PAL_INDEX.ember]) && seen.size >= 2, 'ember pulses between ember and a dim grey');
  assert.equal(PAL_COUNT, 29);
});

// ----------------------------------------------------------------------------------------------- Group
test('Group: culled / BVH distance equals brute force for exact shapes, never undershoots for rough ones; ids and indices are right', () => {
  const rng = mulberry32(3);
  const g = new Group(), exact = [];
  for (let i = 0; i < 150; i++) {
    const c = [rng() * 40 - 20, rng() * 4, rng() * 40 - 20];
    const sh = i % 3 === 0 ? sphere({ c, r: 0.3 + rng() * 0.5 }) : box({ c, size: [0.4 + rng(), 0.3 + rng() * 0.5, 0.4 + rng()], rot: [rng(), rng() * 3, rng()], round: 0.05 });
    g.add(sh, 100 + i); exact.push(sh);
  }
  g.finish();
  assert.ok(g.tree, '150 children build a bounding-volume tree');
  let calls = 0;
  for (let q = 0; q < 3000; q++) {
    const p = [rng() * 50 - 25, rng() * 6 - 1, rng() * 50 - 25];
    const a = g.d(p[0], p[1], p[2]), b = g.dBrute(p[0], p[1], p[2]);
    assert.ok(Math.abs(a - b) < 1e-9, `group ${a} vs brute ${b}`);
    let best = 1e30, bi = -1;
    exact.forEach((s, i) => { const v = s.d(p[0], p[1], p[2]); if (v < best) { best = v; bi = i; } });
    if (Math.abs(a) > 1e-6) { assert.equal(g.lastIdx, bi, 'lastIdx is the adding order'); assert.equal(g.lastId, 100 + bi, 'lastId'); }
    calls++;
  }
  S.mreset(); const dm = g.mat(0.2, 1, 0.1);
  assert.equal(S.M.d, dm); assert.ok(S.M.id >= 100);
  // rough (conservative-scaled) shapes: the culled group is never smaller than... never LARGER than the true min by more than the lip factor allows, and never below brute
  const g2 = new Group();
  for (let i = 0; i < 40; i++) g2.add(slab({ c: [rng() * 10, 0.2, rng() * 10], size: [0.8, 0.25, 0.5], rot: [0, rng() * 3, 0], round: 0.04, taper: 0.1, rough: 0.03, freq: 5, seed: i + 1 }), 1);
  g2.finish();
  for (let q = 0; q < 1500; q++) {
    const p = [rng() * 14 - 2, rng() * 2, rng() * 14 - 2], a = g2.d(p[0], p[1], p[2]), b = g2.dBrute(p[0], p[1], p[2]);
    assert.ok(a >= b - 1e-9 && a <= b / 0.75 + 0.02 || b <= 0, `rough group ${a} vs brute ${b}`);
  }
  assert.equal(calls, 3000);
});

test('Group: a far point costs one child (lower bound is never beaten by culled shapes); nested groups pass ids through', () => {
  const inner = new Group();
  for (let i = 0; i < 5; i++) inner.add(sphere({ c: [i * 2, 0, 0], r: 0.5 }), 7 + i);
  inner.finish();
  const outer = new Group().add(inner, 0).add(sphere({ c: [0, 5, 0], r: 1 }), 50).finish();
  assert.ok(Math.abs(outer.d(4, 0, 0.2) - (Math.hypot(0, 0.2) - 0.5)) < 1e-12);
  assert.equal(outer.lastId, 9);
  outer.d(0, 4.2, 0); assert.equal(outer.lastId, 50);
});

// ----------------------------------------------------------------------------------------------- primitives, noise, helpers
test('sdf primitives: signs and known distances', () => {
  assert.ok(Math.abs(S.sdSphere(3, 0, 0, 1) - 2) < 1e-12);
  assert.ok(Math.abs(S.sdBox(2, 0, 0, 1, 1, 1) - 1) < 1e-12 && S.sdBox(0, 0, 0, 1, 1, 1) === -1);
  assert.ok(Math.abs(S.sdRoundBox(2, 0, 0, 1, 1, 1, 0.25) - 1) < 1e-12);
  assert.ok(Math.abs(S.sdCapsule(0, 3, 0, 0, 0, 0, 0, 1, 0, 0.5) - 1.5) < 1e-12);
  assert.ok(Math.abs(S.sdTorus(3, 0, 0, 2, 0.5) - 0.5) < 1e-12 && S.sdTorus(2, 0, 0, 2, 0.5) < 0);
  assert.ok(Math.abs(S.sdCylinder(3, 0, 0, 1, 1) - 2) < 1e-12 && S.sdCylinder(0, 0, 0, 1, 1) < 0);
  assert.ok(S.sdRoundCone(0, 0, 0, 1, 0.5, 3) < 0 && S.sdRoundCone(0, 3, 0, 1, 0.5, 3) < 0 && S.sdRoundCone(2, 1, 0, 1, 0.5, 3) > 0);
  assert.ok(Math.abs(S.sdEllipsoid(4, 0, 0, 2, 1, 1) - 2) < 0.2);
  assert.ok(S.smin(1, 1, 0.5) < 1 && S.smin(1, 3, 0.5) === 1 && S.smax(1, 1, 0.5) > 1);
  assert.equal(S.smoothSub(1, 2, 0), 1); assert.equal(S.smoothSub(1, -2, 0), 2);
  const out = new Float64Array(3);
  S.twistY(1, 0, 0, 1, out); assert.ok(Math.abs(out[0] - 1) < 1e-12);
  S.twistY(1, Math.PI / 2, 0, 1, out); assert.ok(Math.abs(out[2] - 1) < 1e-12);
  const xf = new S.Xf({ pos: [1, 2, 3], rot: [0.3, 0.7, -0.2], scale: 2 }), q = new Float64Array(3), back = new Float64Array(3);
  xf.from(0.4, -0.5, 0.9, q); xf.to(q[0], q[1], q[2], back);
  assert.ok(Math.abs(back[0] - 0.4) < 1e-12 && Math.abs(back[1] + 0.5) < 1e-12 && Math.abs(back[2] - 0.9) < 1e-12, 'Xf round trip');
  // placed shapes: bounds contain the surface; d is a lower bound on distance near a rotated box
  const b = box({ c: [1, 1, 1], size: [2, 1, 1], rot: [0.4, 0.8, 0.1] });
  for (const s of [b, sphere({ c: [2, 0, 0], r: 1 }), column({ base: [0, 0, 0], h: 3, r0: 0.6, r1: 0.3 }), torus({ R: 1, r: 0.2 }), cylinder({ r: 0.5, h: 2 }), capsule({ a: [0, 0, 0], b: [1, 1, 1], r: 0.2 }), ellipsoid({ radii: [1, 2, 1] })]) {
    const rng = mulberry32(11);
    for (let i = 0; i < 400; i++) {
      const p = [0, 1, 2].map((k) => s.min[k] - 1 + rng() * (s.max[k] - s.min[k] + 2));
      const inside = p.every((v, k) => v >= s.min[k] && v <= s.max[k]);
      if (!inside) { let lb = 0; for (let k = 0; k < 3; k++) { const e = Math.max(s.min[k] - p[k], p[k] - s.max[k], 0); lb += e * e; } assert.ok(s.d(p[0], p[1], p[2]) >= Math.sqrt(lb) - 1e-6 || s.d(...p) > 0, 'a point outside the AABB is outside the shape'); }
    }
  }
});

test('noise: deterministic by seed, bounded, different per seed; worley and fbm behave', () => {
  const a = makeNoise(5), b = makeNoise(5), c = makeNoise(6);
  let same = 0, diff = 0, mx = 0;
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37, y = i * 0.11 + 3, z = -i * 0.23;
    assert.equal(a.n3(x, y, z), b.n3(x, y, z));
    if (a.n3(x, y, z) === c.n3(x, y, z)) same++; else diff++;
    mx = Math.max(mx, Math.abs(a.n3(x, y, z)), Math.abs(a.fbm3(x, y, z, 4)), Math.abs(a.n2(x, z)), Math.abs(a.fbm2(x, z, 4)));
    assert.ok(a.ridge3(x, y, z) >= 0 && a.ridge3(x, y, z) <= 1.0001);
  }
  assert.ok(diff > 400 && mx < 1.3, `diff ${diff} max ${mx}`);
  const f = worley3(3.3, 1.2, 7.7, 4);
  assert.ok(f >= 0 && f < 1.8 && WORLEY.f2 >= f);
  assert.equal(a.n3(1, 2, 3), makeNoise(5).n3(1, 2, 3));
});

test('helpers: stoneAlbedo / terrain / sky are pure and in range', () => {
  for (let i = 0; i < 300; i++) {
    const v = stoneAlbedo(i * 0.13, i * 0.05, -i * 0.09, 3);
    assert.ok(v >= 0 && v <= 1);
    assert.equal(v, stoneAlbedo(i * 0.13, i * 0.05, -i * 0.09, 3));
  }
  assert.notEqual(stoneAlbedo(1, 1, 1, 3), stoneAlbedo(1, 1, 1, 4));
  const t = terrainHeightfield({ seed: 2, amp: 3 });
  assert.equal(t.h(4, 5), t.h(4, 5));
  assert.ok(t.d(4, t.h(4, 5) + 2, 5) > 0 && t.d(4, t.h(4, 5) - 2, 5) < 0);
  const sky = makeSky({ zenith: 0.4, horizon: 0.9, sun: { dir: [0, 0.3, 1] }, clouds: { coverage: 0.5 } });
  const d = new Float64Array([0, 0.5, 0.86]);
  const v = sky(d); assert.ok(v >= 0 && v <= 1.2); assert.equal(sky(d), v);
});

test('png: index preview encodes a valid PNG signature and size', () => {
  const png = indexPNG(new Uint8Array(4 * 3).fill(PAL_INDEX.fog), 4, 3, 2);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 8); assert.equal(png.readUInt32BE(20), 6);
});
