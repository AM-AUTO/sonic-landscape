import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeBaked } from '../src/render/title/bakedkit.js';
import bake from '../src/render/title/baked/mentol.js';
import * as mentol from '../src/render/title/mentol.js';
import { Raster } from '../src/render/artkit.js';
import { PAL_INDEX, PAL_U32 } from '../src/render/palette.js';

// The Men-an-Tol start screen is a baked 3D render (tools/scenes/mentol.mjs -> src/render/title/baked/mentol.js). These tests check the BAKED DATA
// (the render itself is covered by tests/render3d.test.js): strict palette, the ember only in the carving, the value structure, the size budget.
const GREYS = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'];
const ALLOWED = new Set([...GREYS.map((n) => PAL_INDEX[n]), PAL_INDEX.ember]);
const B = decodeBaked(bake);
const { w: W, h: H, idx, layer } = B;
const mean = (x0, x1, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = GREYS.indexOf(Object.keys(PAL_INDEX).find((nm) => PAL_INDEX[nm] === idx[y * W + x])); if (k >= 0) { s += k; n++; } } return s / n; };

test('mentol 3D bake: 384x216, palette indices only (greys + ember), layers 0 / 1 / 3', () => {
  assert.equal(W, 384); assert.equal(H, 216);
  assert.equal(idx.length, W * H); assert.equal(layer.length, W * H);
  for (let i = 0; i < idx.length; i++) assert.ok(ALLOWED.has(idx[i]), 'pixel ' + i + ' index ' + idx[i]);
  for (let i = 0; i < layer.length; i++) assert.ok(layer[i] === 0 || layer[i] === 1 || layer[i] === 3, 'layer ' + layer[i]);
  assert.equal(bake.meta.scene, 'mentol');
  const used = new Set(idx);
  for (const n of GREYS) assert.ok(used.has(PAL_INDEX[n]), n + ' is used');
});

test('mentol 3D bake: the ember is the carving only: a compact cluster on the menhir, nowhere else', () => {
  const emb = [];
  for (let i = 0; i < idx.length; i++) if (idx[i] === PAL_INDEX.ember) emb.push([i % W, (i / W) | 0]);
  assert.ok(emb.length >= 80 && emb.length <= 600, 'ember pixels: ' + emb.length);
  const xs = emb.map((p) => p[0]), ys = emb.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  assert.ok(x1 - x0 < 60 && y1 - y0 < 60, `one symbol, not scattered: ${x1 - x0} x ${y1 - y0}`);
  // inside the opening (the ring is dark and calm round it), on the stone's own pixels (near layer, in front of the far moor), at low-mid height
  assert.ok(x0 > 120 && x1 < 270 && y0 > 90 && y1 < 175, `inside the opening: ${x0},${y0}..${x1},${y1}`);
  assert.deepEqual(new Set(emb.map(([x, y]) => layer[y * W + x])), new Set([3]), 'ember pixels are the stone (layer 3)');
  assert.equal(B.embers.length, emb.length, 'the baked ember list is every ember pixel');
  // the grey beside each ember pixel is a real grey (what the pulse dims to)
  assert.ok(B.embers.every((e) => GREYS.some((n) => PAL_INDEX[n] === e[3])));
});

test('mentol 3D bake: value structure: a dark heavy ring round a pale airy opening, calm dark ground for the text, a calm top for the logo', () => {
  const ring = mean(0, 100, 90, 160), top = mean(20, 360, 4, 60), foot = mean(0, W, 178, 216);
  const hole = mean(150, 250, 86, 135);                                   // sky and far moor inside the opening
  assert.ok(hole > ring + 1.6 && hole > top + 2, `opening ${hole.toFixed(2)} vs ring ${ring.toFixed(2)} / top ${top.toFixed(2)}`);
  assert.ok(top < 2.6, 'the top of the ring is a dark, calm mass behind the logo: ' + top.toFixed(2));
  assert.ok(foot < 1.7, 'the foot is dark ground for the three text lines: ' + foot.toFixed(2));
  // calm = few tone changes along rows (the logo and the text sit there)
  const busy = (x0, x1, y0, y1) => { let c = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0 + 1; x < x1; x++) { n++; if (idx[y * W + x] !== idx[y * W + x - 1]) c++; } return c / n; };
  assert.ok(busy(40, 340, 4, 60) < 0.5, 'quiet behind the logo: ' + busy(40, 340, 4, 60).toFixed(2));
  assert.ok(busy(0, W, 186, 216) < 0.5, 'quiet behind the footer lines: ' + busy(0, W, 186, 216).toFixed(2));
});

test('mentol 3D bake: size budget (a baked module is a few tens of KB) and the 3D scene file is the source of it', () => {
  const kb = fs.statSync(new URL('../src/render/title/baked/mentol.js', import.meta.url)).size / 1024;
  assert.ok(kb < 90, 'baked module: ' + kb.toFixed(1) + ' KB');
  assert.ok(fs.existsSync(new URL('../tools/scenes/mentol.mjs', import.meta.url)));
});

test('mentol screen module: blits the bake, adds the logo, animates mist / glint / ember pulse deterministically, base untouched by anim', () => {
  const mk = () => { const r = new Raster(384, 216); r.lay.fill(0); const S = { seed: 9000 }; mentol.paint(r, {}, S); return { r, S }; };
  const a = mk(), b = mk();
  assert.deepEqual(a.r.d, b.r.d, 'deterministic base');
  assert.ok(a.S.logo && a.S.logo.face.length > 1500, 'logo present');
  assert.ok(Array.isArray(mentol.levels) && mentol.layout.prompt.y > 170, 'layout: prompt on the dark ground');
  const base = Uint32Array.from(a.r.d);
  const f1 = new Raster(384, 216); f1.d.set(base); f1.lay.set(a.r.lay); mentol.anim(f1, {}, a.S, 1.3);
  const f2 = new Raster(384, 216); f2.d.set(base); f2.lay.set(a.r.lay); mentol.anim(f2, {}, a.S, 4.7);
  assert.notDeepEqual(f1.d, f2.d, 'moves');
  let n = 0; for (let i = 0; i < base.length; i++) if (f1.d[i] !== base[i]) n++;
  assert.ok(n > 100 && n < 20000, 'changed pixels per frame: ' + n);
  // the pulse only ever swaps ember for the grey beside it
  const ok = new Set([...GREYS.map((nm) => PAL_U32[nm]), PAL_U32.ember, PAL_U32.paper, PAL_U32.paper2]);
  assert.ok(f2.d.every((c) => ok.has(c)));
  // the stone is never veiled by the mist (layer 3 is outside layerMax 1)
  let veil = 0;
  for (let i = 0; i < base.length; i++) if (a.r.lay[i] === 3 && f1.d[i] !== base[i] && base[i] !== PAL_U32.ember && f1.d[i] !== PAL_U32.ember && i / 384 > 120) veil++;
  assert.ok(veil < 40, 'near layer left alone by the mist: ' + veil);
});
