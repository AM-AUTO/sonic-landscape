import test from 'node:test';
import assert from 'node:assert/strict';
import { Raster, freshBase, pixelHash, TITLE_SCENE } from '../src/render/panels.js';
import { PAL_U32 } from '../src/render/palette.js';
import { shadedRock } from '../src/render/title/castlerigg.js';

const W = TITLE_SCENE.w, H = TITLE_SCENE.h;
const GREYS = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'].map((n) => PAL_U32[n]);
const ALLOWED = new Set([...GREYS, PAL_U32.ember, PAL_U32.paper, PAL_U32.paper2]);
const lumOf = (c) => { const i = GREYS.indexOf(c); return i < 0 ? 3 : i; };
const rowMean = (d, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { s += lumOf(d[y * W + x]); n++; } return s / n; };

test('shadedRock: a lit stone, deterministic, greys + ember only, a sunward ember rim only when asked, stays inside its box', () => {
  const draw = (o) => { const r = new Raster(200, 140); r.d.fill(PAL_U32.ash); r.lay.fill(0); const info = shadedRock(r, { cx: 100, cy: 70, rx: 40, ry: 22, rot: -0.2, p: 3, planes: 3, bevel: 18, H: 20, light: [0.9, -0.2], elev: 0.3, lichen: 1, cracks: 2, seed: 4, ...o }); return { r, info }; };
  const a = draw({ glow: 0.7 }), b = draw({ glow: 0.7 }), cold = draw({ glow: 0 }), other = draw({ seed: 5, glow: 0.7 });
  assert.equal(pixelHash(a.r.d), pixelHash(b.r.d), 'deterministic');
  assert.notEqual(pixelHash(a.r.d), pixelHash(other.r.d), 'a seed changes the stone');
  assert.ok(a.r.d.every((c) => ALLOWED.has(c)), 'greys + ember only');
  assert.ok(a.info.embers.length > 15 && a.r.d.includes(PAL_U32.ember), 'ember rim on the sunward edge: ' + a.info.embers.length);
  assert.ok(!cold.r.d.includes(PAL_U32.ember) && cold.info.embers.length === 0, 'no glow, no ember');
  assert.ok(a.info.w > 60 && a.info.h > 25, 'a big stone, not a pebble');
  // the sunward (right) half is lighter than the shaded half
  let lo = 0, hi = 0, nlo = 0, nhi = 0;
  for (let j = 0; j < a.info.h; j++) for (let i = 0; i < a.info.w; i++) if (a.info.data[j * a.info.w + i]) { const l = lumOf(a.r.d[(a.info.y + j) * 200 + a.info.x + i]); if (i < a.info.w / 2) { lo += l; nlo++; } else { hi += l; nhi++; } }
  assert.ok(hi / nhi > lo / nlo + 0.4, 'lit on the sun side');
  for (let y = 0; y < 140; y++) for (let x = 0; x < 200; x++) if (x < 20 || x > 180 || y < 15 || y > 125) assert.equal(a.r.d[y * 200 + x], PAL_U32.ash, 'nothing far outside its box');
});

test('castlerigg: low horizon, luminous sky over dark grass, the ember sun and rims, the hero incision; greys + ember only', () => {
  const d = freshBase({ kind: 'title', levelIndex: 3, variant: 'castlerigg' }, W, H);
  assert.ok(d.every((c) => ALLOWED.has(c)));
  assert.ok(rowMean(d, 66, 100) > rowMean(d, 150, 180) + 0.8, 'sky lighter than the grass');
  assert.ok(rowMean(d, 180, 216) < 1.8, 'the foot is calm and dark under the text');
  let ember = 0, emberLow = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[y * W + x] === PAL_U32.ember) { ember++; if (y > 62) emberLow++; }
  assert.ok(emberLow > 250 && emberLow < 2500, 'ember is sparing: ' + emberLow + ' pixels below the logo');
  // the sun: a solid ember disc in the right third, half behind the ridge
  let disc = 0;
  for (let y = 100; y < 125; y++) for (let x = 285; x < 320; x++) if (d[y * W + x] === PAL_U32.ember) disc++;
  assert.ok(disc > 60, 'ember sun: ' + disc);
});
