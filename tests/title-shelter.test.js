import test from 'node:test';
import assert from 'node:assert/strict';
import { freshBase, renderPanel, pixelHash, TITLE_SCENE } from '../src/render/panels.js';
import { PAL_U32 } from '../src/render/palette.js';

const W = TITLE_SCENE.w, H = TITLE_SCENE.h;
const GREYS = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'].map((n) => PAL_U32[n]);
const ALLOWED = new Set([...GREYS, PAL_U32.ember, PAL_U32.paper, PAL_U32.paper2]);
const spec = { kind: 'title', levelIndex: 3, variant: 'shelter' };

test('shelter: a black doorway with ONE small ember glow deep inside it, and no other ember below the logo', () => {
  const d = freshBase(spec, W, H);
  assert.ok(d.every((c) => ALLOWED.has(c)));
  // the door: x 166..222, y 124..152 is black but for the glow
  let ink = 0, n = 0, ember = 0, ex = 0, ey = 0;
  for (let y = 124; y < 152; y++) for (let x = 168; x < 220; x++) { n++; const c = d[y * W + x]; if (c === PAL_U32.ink) ink++; else if (c === PAL_U32.ember) { ember++; ex += x; ey += y; } }
  assert.ok(ink / n > 0.93, 'the doorway is black: ' + (ink / n).toFixed(2));
  assert.ok(ember >= 8 && ember < 90, 'one small glow: ' + ember);
  assert.ok(Math.abs(ex / ember - 194) < 6 && ey / ember > 128, 'deep inside, near the middle of the door');
  // no ember anywhere else below the lettering
  let stray = 0;
  for (let y = 64; y < H; y++) for (let x = 0; x < W; x++) if (d[y * W + x] === PAL_U32.ember && !(y >= 124 && y < 152 && x >= 168 && x < 220)) stray++;
  assert.ok(stray < 12, 'the doorway is the only ember: ' + stray);
});

test('shelter: a pale sky over a dark ruin, slabs lit from the upper left; the glow breathes', () => {
  const d = freshBase(spec, W, H);
  const lum = (c) => { const i = GREYS.indexOf(c); return i < 0 ? 3 : i; };
  const mean = (x0, x1, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum(d[y * W + x]); n++; } return s / n; };
  assert.ok(mean(0, W, 60, 76) > mean(0, W, 176, 216) + 1.2, 'sky lighter than the foot');
  // the lintel is the lightest big slab: its top face is paler than the doorway under it
  assert.ok(mean(150, 230, 108, 114) > mean(170, 218, 126, 150) + 1.5, 'lintel over the black door');
  const a = Uint32Array.from(renderPanel(spec, W, H, 0.4)), b = Uint32Array.from(renderPanel(spec, W, H, 3.1));       // renderPanel reuses its frame buffer
  assert.notEqual(pixelHash(a), pixelHash(b), 'moves');
  let diff = 0;
  for (let y = 130; y < 156; y++) for (let x = 180; x < 210; x++) if (a[y * W + x] !== b[y * W + x]) diff++;
  assert.ok(diff > 0, 'the ember pulses');
});
