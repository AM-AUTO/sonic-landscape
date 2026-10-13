import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import bake from '../src/render/title/baked/shelter.js';
import { decodeBaked, layerMaskOf } from '../src/render/title/bakedkit.js';
import { freshBase, renderPanel, pixelHash, TITLE_SCENE } from '../src/render/panels.js';
import { PAL_INDEX, PAL_U32 } from '../src/render/palette.js';

const W = TITLE_SCENE.w, H = TITLE_SCENE.h;
const GREY_NAMES = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'];
const GREYS = new Set(GREY_NAMES.map((n) => PAL_INDEX[n]));
const level = (i) => GREY_NAMES.findIndex((n) => PAL_INDEX[n] === i);
const baked = decodeBaked(bake);
const spec = { kind: 'title', levelIndex: 3, variant: 'shelter' };

test('shelter (baked 3D render): 384x216, strict palette (the seven greys + ember), layer hints 0 / 1 / 3 only, a small module', () => {
  assert.equal(baked.w, W); assert.equal(baked.h, H);
  assert.equal(baked.idx.length, W * H);
  for (let i = 0; i < baked.idx.length; i++) assert.ok(GREYS.has(baked.idx[i]) || baked.idx[i] === PAL_INDEX.ember, 'pixel ' + i + ' is on the ramp');
  assert.ok(baked.layer.every((l) => l === 0 || l === 1 || l === 3), 'layer ids');
  const used = new Set(baked.idx);
  for (const n of GREY_NAMES) assert.ok(used.has(PAL_INDEX[n]), n + ' used: a full tonal range');
  const kb = fs.statSync(new URL('../src/render/title/baked/shelter.js', import.meta.url)).size / 1024;
  assert.ok(kb < 70, 'baked module ' + kb.toFixed(1) + ' KB');
  assert.equal(baked.meta.scene, 'shelter');
});

test('shelter: ONE small ember glow, deep inside the black doorway, and no other ember anywhere', () => {
  const e = baked.embers;
  assert.ok(e.length >= 12 && e.length <= 90, 'a small glow: ' + e.length + ' px');
  const xs = e.map((p) => p[0]), ys = e.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  assert.ok(x1 - x0 <= 18 && y1 - y0 <= 14, `one compact cluster ${x1 - x0 + 1}x${y1 - y0 + 1}`);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  assert.ok(cx > 150 && cx < 240 && cy > 125 && cy < 175, `in the doorway region (${cx}, ${cy})`);
  // the doorway is dark round the glow: the ring of pixels about the cluster is ink / char
  let dark = 0, n = 0;
  for (let y = y0 - 7; y <= y1 + 7; y++) for (let x = x0 - 9; x <= x1 + 9; x++) {
    const i = baked.idx[y * W + x];
    if (i === PAL_INDEX.ember) continue;
    n++; if (level(i) <= 1) dark++;
  }
  assert.ok(dark / n > 0.6, 'black doorway round the glow: ' + (dark / n).toFixed(2));
  // every ember pixel lies in that one cluster (the baked list and the picture agree)
  let all = 0;
  for (let i = 0; i < baked.idx.length; i++) if (baked.idx[i] === PAL_INDEX.ember) all++;
  assert.equal(all, e.length);
});

test('shelter: calm sky for the logo (top ~26%), calm dark ground for the text (bottom ~20%), the hut in front (layer 3), hills behind', () => {
  let sky = 0;
  const counts = new Map();
  for (let y = 0; y < 56; y++) for (let x = 0; x < W; x++) counts.set(baked.idx[y * W + x], (counts.get(baked.idx[y * W + x]) || 0) + 1);
  sky = Math.max(...counts.values()) / (56 * W);
  assert.ok(sky > 0.9, 'one tint fills the top: ' + sky.toFixed(2));
  let s = 0;
  for (let y = 176; y < H; y++) for (let x = 0; x < W; x++) s += level(baked.idx[y * W + x]);
  assert.ok(s / (40 * W) < 2.6, 'dark foreground: mean grey step ' + (s / (40 * W)).toFixed(2));
  const near = layerMaskOf(baked, 3, 3), far = layerMaskOf(baked, 0, 0);
  let hutPx = 0;
  for (let y = 100; y < 160; y++) for (let x = 110; x < 280; x++) hutPx += near[y * W + x];
  assert.ok(hutPx > 0.8 * 60 * 170, 'the hut fills the middle: ' + hutPx);
  let hills = 0;
  for (let y = 56; y < 90; y++) for (let x = 0; x < W; x++) hills += far[y * W + x];
  assert.ok(hills > 3000, 'far hills and sky behind: ' + hills);
});

test('shelter screen: the baked picture is what paints, the doorway ember breathes, the logo is on top', () => {
  const d = Uint32Array.from(freshBase(spec, W, H));
  // below the logo the screen equals the baked picture except the mist and the foot plate (most pixels identical)
  let same = 0, tot = 0;
  for (let y = 80; y < 170; y++) for (let x = 0; x < W; x++) { tot++; if (d[y * W + x] === PAL_U32[GREY_NAMES.find((n) => PAL_INDEX[n] === baked.idx[y * W + x]) || 'ember']) same++; }
  assert.ok(same / tot > 0.85, 'the base is the baked render: ' + (same / tot).toFixed(2));
  const xs = baked.embers.map((p) => p[0]), ys = baked.embers.map((p) => p[1]);
  const inBox = (f) => { let c = 0; for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) if (f(y * W + x)) c++; return c; };
  const embersAt = (t) => { const f = Uint32Array.from(renderPanel(spec, W, H, t)); return inBox((i) => f[i] === PAL_U32.ember); };
  const counts = [0.2, 0.9, 1.6, 2.3, 3.0, 3.7, 4.4, 5.1].map(embersAt);
  assert.ok(Math.max(...counts) > Math.min(...counts), 'the glow pulses: ' + counts.join(','));
});
