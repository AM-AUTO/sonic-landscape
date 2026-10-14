import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBase, renderPanel, TITLE_SCENE, TITLE_LAYOUT } from '../src/render/panels.js';
import { PAL_U32 as C } from '../src/render/palette.js';
import { layout } from '../src/render/title/menhir.js';

const W = TITLE_SCENE.w, H = TITLE_SCENE.h;
const spec = { kind: 'title', levelIndex: 3, variant: 'menhir' };
const GREYS = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'].map((n) => C[n]);

const count = (d, pred, x0 = 0, y0 = 0, x1 = W, y1 = H) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (pred(d[y * W + x], x, y)) n++; return n; };

test('menhir: a tall, richly shaded stone off-centre left, not a silhouette', () => {
  const d = freshBase(spec, W, H);
  // the stone's columns (x 84..156): every grey of the ramp appears on its face, and it stands ~180 px tall (rows 8..189 hold stone-dark pixels)
  const seen = new Set();
  for (let y = 40; y < 180; y++) for (let x = 90; x < 150; x++) seen.add(d[y * W + x]);
  for (const g of GREYS.slice(0, 6)) assert.ok(seen.has(g), 'grey on the stone face');
  const rowHasStone = (y) => { let n = 0; for (let x = 84; x < 160; x++) { const c = d[y * W + x]; if (c === C.ink || c === C.char) n++; } return n > 3; };
  assert.ok(rowHasStone(14) && rowHasStone(100) && rowHasStone(185), 'the stone runs from the head to the foot');
  // lit flank brighter than the shaded flank (mean grey index across the face at mid height)
  const idx = new Map(GREYS.map((c, i) => [c, i]));
  const mean = (x0, x1) => { let s = 0, n = 0; for (let y = 60; y < 140; y++) for (let x = x0; x < x1; x++) { const i = idx.get(d[y * W + x]); if (i !== undefined) { s += i; n++; } } return s / n; };
  assert.ok(mean(96, 112) > mean(128, 144) + 0.8, 'sunward flank lit, the other in shade');
});

test('menhir: ember is the accent: lines, an incision, a logo edge, and nothing else; used sparingly', () => {
  const d = freshBase(spec, W, H);
  const ember = count(d, (c) => c === C.ember);
  assert.ok(ember > 400 && ember < W * H * 0.05, 'ember pixels: ' + ember);
  // the dimension line beside the stone: a long vertical ember run
  let best = 0;
  for (let x = 40; x < 90; x++) best = Math.max(best, count(d, (c) => c === C.ember, x, 0, x + 1, H));
  assert.ok(best > 140, 'a dimension line the height of the stone: ' + best);
  // the incised symbol low on the face glows
  assert.ok(count(d, (c) => c === C.ember, 98, 130, 140, 175) > 25, 'the incision glows ember');
  // the survey caption and scale bar on the plate
  assert.ok(count(d, (c) => c === C.ember, 286, 140, 378, 160) > 40, 'a scale bar');
});

test('menhir: the logo sits in the calm sky on the right, and the text layout clears it', () => {
  const d = freshBase(spec, W, H);
  assert.ok(count(d, (c) => c === C.snow || c === C.fog, 170, 18, 380, 60) > 300, 'lettering');
  const L = TITLE_LAYOUT.menhir;
  assert.equal(L.subtitle.x, layout.subtitle.x);
  assert.ok(L.subtitle.x - L.subtitle.maxW / 2 > 160 && L.prompt.x - 105 > 140, 'text sits right of the stone');
  assert.ok(L.prompt.y + 9 < L.controls && L.controls + 7 < L.strapline);
});

test('menhir: the animation breathes (mist, ember) and stays greys + ember', () => {
  const a = Uint32Array.from(renderPanel(spec, W, H, 0.4)), b = Uint32Array.from(renderPanel(spec, W, H, 2.9));
  let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  assert.ok(diff > 300, 'frames differ: ' + diff);
  const ok = new Set([...GREYS, C.ember, C.paleblue, C.frost, C.paper, C.paper2]);
  for (let i = 0; i < b.length; i++) assert.ok(ok.has(b[i]), 'greys + ember only');
});
