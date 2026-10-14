import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeBaked } from '../src/render/title/bakedkit.js';
import bake from '../src/render/title/baked/mentol.js';
import * as mentol from '../src/render/title/mentol.js';
import { Raster } from '../src/render/artkit.js';
import { PAL_INDEX, PAL_U32 } from '../src/render/palette.js';

// The Men-an-Tol start screen is a baked 3D render (tools/scenes/mentol.mjs -> src/render/title/baked/mentol.js). These tests check the BAKED DATA
// (the render itself is covered by tests/render3d.test.js): strict palette (greys + the blue ramp, NO ember), the blue accent only in the carving, the value
// structure, the size budget.
const GREYS = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'];
const BLUES = ['deepblue', 'steelD', 'steel', 'blue', 'paleblue', 'frost'];
const ALLOWED = new Set([...GREYS, ...BLUES].map((n) => PAL_INDEX[n]));
const BLUE_IDX = new Set(BLUES.map((n) => PAL_INDEX[n]));
const NAME = (i) => Object.keys(PAL_INDEX).find((nm) => PAL_INDEX[nm] === i);
const B = decodeBaked(bake);
const { w: W, h: H, idx, layer } = B;
const mean = (x0, x1, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const nm = NAME(idx[y * W + x]), k = GREYS.indexOf(nm) >= 0 ? GREYS.indexOf(nm) : BLUES.indexOf(nm) >= 0 ? (BLUES.indexOf(nm) === 5 ? 5 : BLUES.indexOf(nm)) : -1; if (k >= 0) { s += k; n++; } } return s / n; };

test('mentol 3D bake: 384x216, palette indices only (greys + the blue ramp, no ember), layers 0 / 1 / 3', () => {
  assert.equal(W, 384); assert.equal(H, 216);
  assert.equal(idx.length, W * H); assert.equal(layer.length, W * H);
  for (let i = 0; i < idx.length; i++) assert.ok(ALLOWED.has(idx[i]), 'pixel ' + i + ' index ' + idx[i]);
  for (let i = 0; i < layer.length; i++) assert.ok(layer[i] === 0 || layer[i] === 1 || layer[i] === 3, 'layer ' + layer[i]);
  assert.equal(bake.meta.scene, 'mentol');
  const used = new Set(idx);
  for (const n of GREYS) assert.ok(used.has(PAL_INDEX[n]), n + ' is used');
  for (const n of BLUES) assert.ok(used.has(PAL_INDEX[n]), n + ' is used');
  assert.ok(!used.has(PAL_INDEX.ember), 'no ember in this picture');
  // blue is a second tonal ramp, not a tint: a large share of the picture, in every region (sky and mountains, ground, ring), beside neutral grey
  let blue = 0; for (let i = 0; i < idx.length; i++) if (BLUE_IDX.has(idx[i])) blue++;
  assert.ok(blue / idx.length > 0.25 && blue / idx.length < 0.8, 'blue share ' + (blue / idx.length).toFixed(2));
  const share = (x0, x1, y0, y1) => { let b = 0, g = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = idx[y * W + x]; if (BLUE_IDX.has(v) && v !== PAL_INDEX.snow) b++; else if (v !== PAL_INDEX.snow) g++; } return b / (b + g); };
  assert.ok(share(130, 260, 100, 138) > 0.25, 'the mountains carry blue: ' + share(130, 260, 100, 138).toFixed(2));
  assert.ok(share(0, 90, 70, 190) > 0.25, 'the shadowed ring carries blue: ' + share(0, 90, 70, 190).toFixed(2));
  // contrast by temperature: the far ridges are bluer than the near ground (distance reads as blue), the sunlit right side of the ring is more neutral than the shaded left
  assert.ok(share(100, 280, 104, 134) > share(100, 280, 150, 175) + 0.1, 'distance is bluer than the near moor');
  assert.ok(share(330, 384, 100, 190) < share(0, 60, 100, 190), 'sunlit granite is more neutral than shaded granite');
});

test('mentol 3D bake: the accent is the carving only: a compact cluster of frost / paleblue on the menhir, small and far off', () => {
  const emb = B.embers.map(([x, y]) => [x, y]);
  assert.ok(emb.length >= 25 && emb.length <= 500, 'accent pixels: ' + emb.length);
  const xs = emb.map((p) => p[0]), ys = emb.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  assert.ok(x1 - x0 < 30 && y1 - y0 < 40, `one small symbol, not scattered: ${x1 - x0} x ${y1 - y0}`);
  // inside the opening (the ring is dark and calm round it), on the stone's own pixels (near layer, in front of the far moor), at low-mid height
  assert.ok(x0 > 130 && x1 < 260 && y0 > 90 && y1 < 150, `inside the opening: ${x0},${y0}..${x1},${y1}`);
  assert.deepEqual(new Set(emb.map(([x, y]) => layer[y * W + x])), new Set([3]), 'accent pixels are the stone (layer 3)');
  for (const [x, y] of emb) assert.ok(idx[y * W + x] === PAL_INDEX.frost || idx[y * W + x] === PAL_INDEX.paleblue, 'accent pixel colour ' + NAME(idx[y * W + x]));
  assert.ok(B.embers.filter(([x, y]) => idx[y * W + x] === PAL_INDEX.frost).length > 10, 'a frost core');
  // each accent pixel dims one step down the blue ramp (what the pulse falls back to)
  assert.ok(B.embers.every((e) => BLUE_IDX.has(e[3]) && e[3] !== idx[e[1] * W + e[0]]));
  // the stone itself stands 40-70 px tall (it is far off): the near-layer pixels of its column span that height above the moor
  let top = H, bot = 0;
  for (let y = 0; y < H; y++) for (let x = Math.floor((x0 + x1) / 2) - 3; x <= Math.floor((x0 + x1) / 2) + 3; x++) if (layer[y * W + x] === 3 && y > 70 && y < 160) { if (y < top) top = y; if (y > bot) bot = y; }
  assert.ok(bot - top >= 38 && bot - top <= 80, 'the stone is ' + (bot - top) + ' px tall');
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

test('mentol 3D bake: size budget (a baked module is well under 100 KB) and the 3D scene file is the source of it', () => {
  const kb = fs.statSync(new URL('../src/render/title/baked/mentol.js', import.meta.url)).size / 1024;
  assert.ok(kb < 100, 'baked module: ' + kb.toFixed(1) + ' KB');
  assert.ok(fs.existsSync(new URL('../tools/scenes/mentol.mjs', import.meta.url)));
});

test('mentol screen module: blits the bake, adds the logo, animates mist / glint / ember pulse deterministically, base untouched by anim', () => {
  const mk = () => { const r = new Raster(384, 216); r.lay.fill(0); const S = { seed: 9000 }; mentol.paint(r, {}, S); return { r, S }; };
  const a = mk(), b = mk();
  assert.deepEqual(a.r.d, b.r.d, 'deterministic base');
  assert.ok(a.S.logo && a.S.logo.face.length > 1500, 'logo present');
  assert.ok(Array.isArray(mentol.levels) && mentol.layout.prompt.y > 170, 'layout: prompt on the dark ground');
  assert.ok(a.S.logo.w > 250 && a.S.logo.w < 352 && a.S.logo.y0 < 30, 'the logo is auto-fitted across the upper ring: ' + a.S.logo.w + ' wide at y ' + a.S.logo.y0);
  const base = Uint32Array.from(a.r.d);
  const f1 = new Raster(384, 216); f1.d.set(base); f1.lay.set(a.r.lay); mentol.anim(f1, {}, a.S, 1.3);
  const f2 = new Raster(384, 216); f2.d.set(base); f2.lay.set(a.r.lay); mentol.anim(f2, {}, a.S, 4.7);
  assert.notDeepEqual(f1.d, f2.d, 'moves');
  let n = 0; for (let i = 0; i < base.length; i++) if (f1.d[i] !== base[i]) n++;
  assert.ok(n > 100 && n < 20000, 'changed pixels per frame: ' + n);
  // the pulse only ever swaps ember for the grey beside it
  const ok = new Set([...GREYS, ...BLUES].map((nm) => PAL_U32[nm]));
  assert.ok(f2.d.every((c) => ok.has(c)), 'greys + blues only, frame after frame');
  assert.ok(!f2.d.includes(PAL_U32.ember));
  // the stone is never veiled by the mist (layer 3 is outside layerMax 1)
  let veil = 0;
  for (let i = 0; i < base.length; i++) if (a.r.lay[i] === 3 && f1.d[i] !== base[i] && base[i] !== PAL_U32.ember && f1.d[i] !== PAL_U32.ember && i / 384 > 120) veil++;
  assert.ok(veil < 40, 'near layer left alone by the mist: ' + veil);
});
