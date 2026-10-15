/**
 * Painted panels (the tracklist ridges and the title), the plain field-notes page, and the floating HUD's geometry.
 * All pure: panels paint into plain rasters, so the painters run (and are hashed) in Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/world/levels/index.js';
import { PAL, PAL_U32_LIST } from '../src/render/palette.js';
import { measureText } from '../src/render/font.js';
import { NOTES, fmt } from '../src/text.js';
import {
  PANEL, TITLE_SCENE, THUMB, PANEL_KINDS, freshBase, paintBase, renderPanel, pixelHash, warmProfile, hasProfile, getProfile,
} from '../src/render/panels.js';
import { LAYOUT, noteLines } from '../src/render/screens.js';
import { CELL_H, CHAIN_W, GATE_W, CHEV, keyBoxLayout, restingBox } from '../src/render/hud.js';

const SW = 384, SH = 216;

// ------------------------------------------------------------------ painters
const PAL_SET = new Set(PAL_U32_LIST);
const SPECS = {
  ridge: { kind: 'ridge', levelIndex: 0 },
  title: { kind: 'title', levelIndex: 3 },
};
const sizeOf = () => [PANEL.w, PANEL.h];

test('painters: every kind paints every pixel in strict palette colours', () => {
  assert.deepEqual([...PANEL_KINDS].sort(), Object.keys(SPECS).sort());
  for (const [k, spec] of Object.entries(SPECS)) {
    const [w, h] = sizeOf(k);
    for (const t of [0, 3.3]) {
      const d = renderPanel(spec, w, h, t);
      assert.equal(d.length, w * h);
      let off = 0;
      for (let i = 0; i < d.length; i++) if (!PAL_SET.has(d[i])) off++;
      assert.equal(off, 0, `${k} t=${t}: ${off} off-palette pixels`);
    }
  }
});

test('painters: deterministic. Two fresh paints of the same spec have the same pixel hash, and so does a frame at the same time', () => {
  for (const [k, spec] of Object.entries(SPECS)) {
    const [w, h] = sizeOf(k);
    assert.equal(pixelHash(freshBase(spec, w, h)), pixelHash(freshBase(spec, w, h)), `${k} base`);
    const a = pixelHash(renderPanel(spec, w, h, 2.5));
    renderPanel(spec, w, h, 9.1);
    assert.equal(pixelHash(renderPanel(spec, w, h, 2.5)), a, `${k} frame`);
  }
});

test('painters: the animation moves (mist, flicker) but never touches the cached base', () => {
  for (const [k, spec] of Object.entries(SPECS)) {
    const [w, h] = sizeOf(k);
    const base = pixelHash(paintBase(spec, w, h));
    const a = pixelHash(renderPanel(spec, w, h, 1.0)), b = pixelHash(renderPanel(spec, w, h, 4.7));
    assert.notEqual(a, b, `${k} is animated`);
    assert.equal(pixelHash(paintBase(spec, w, h)), base, `${k} base untouched`);
  }
});

test('ridge panels are each track\'s own place: the skyline comes from its heightfield, 8 distinct', () => {
  for (let i = 0; i < LEVELS.length; i++) warmProfile(i);
  assert.ok(LEVELS.every((_, i) => hasProfile(i)));
  const hashes = LEVELS.map((_, i) => pixelHash(freshBase({ kind: 'ridge', levelIndex: i }, THUMB.w, THUMB.h)));
  assert.equal(new Set(hashes).size, 8, 'eight different panels');
  const big = LEVELS.map((_, i) => pixelHash(freshBase({ kind: 'ridge', levelIndex: i }, PANEL.w, PANEL.h)));
  assert.equal(new Set(big).size, 8);
  const p = getProfile(5);
  assert.equal(p.bands.length, 3);
  assert.ok(p.bands.every((b) => b.length === 256 && b.every((v) => v >= 0 && v <= 1)));
  // locked tracks are painted in cold greys only: the colour is the reward
  const grey = new Set(['ink', 'night', 'dusk', 'rock'].map((n) => PAL_U32_LIST[Object.keys(PAL).indexOf(n)]));
  const locked = freshBase({ kind: 'ridge', levelIndex: 0, locked: true }, THUMB.w, THUMB.h);
  assert.ok(locked.every((c) => grey.has(c)));
  // the ridges are red: the reds of the evening are in them; the start screen is greys + ember only
  const reds = ['blood', 'rust', 'ember', 'heather'].map((n) => PAL_U32_LIST[Object.keys(PAL).indexOf(n)]);
  const ridge = freshBase(SPECS.ridge, PANEL.w, PANEL.h);
  for (const c of reds) assert.ok(ridge.includes(c), `ridge uses ${c.toString(16)}`);
  const title = freshBase(SPECS.title, PANEL.w, PANEL.h);
  assert.ok([reds[0], reds[1], reds[3]].every((c) => !title.includes(c)), 'the start screen is greys + ember only: no blood, rust or heather');
});

test('the title is full-bleed: the whole 384x216 screen is painted art with the logo on top, nothing is left unpainted', () => {
  assert.deepEqual([PANEL.w, PANEL.h, TITLE_SCENE.w, TITLE_SCENE.h], [384, 216, 384, 216]);
  const d = freshBase(SPECS.title, 384, 216);
  assert.ok(d.every((c) => c !== 0));
  // the logo: bright snow and fog pixels in the upper third, where the lettering is carved
  let bright = 0;
  for (let y = 10; y < 80; y++) for (let x = 20; x < 364; x++) if (d[y * 384 + x] === PAL_U32_LIST[Object.keys(PAL).indexOf('snow')] || d[y * 384 + x] === PAL_U32_LIST[Object.keys(PAL).indexOf('fog')]) bright++;
  assert.ok(bright > 400, 'lettering present: ' + bright);
});

test('every track names its signature hue: a palette colour from the red family where sensible, distinct from the others', () => {
  const names = LEVELS.map((lv) => lv.palette.accent);
  assert.ok(names.every((n) => typeof n === 'string' && PAL[n]), 'accent is a palette name');
  assert.equal(new Set(names).size, 8);
  assert.deepEqual(names, ['ember', 'rust', 'magenta', 'ice', 'lamp', 'heather', 'rock', 'flame']);
});

// ------------------------------------------------------------------ field notes page
test('field notes: every level\'s notes and the empty state fit the plain notes page', () => {
  const L = LAYOUT.notes;
  assert.equal(L.colX * 2 + L.colW, SW, 'the column is centred');
  const room = Math.floor((L.bottom - L.top - 7) / L.lineH) + 1;
  assert.ok(L.maxLines <= room, `${L.maxLines} lines fit between the rules (room for ${room})`);
  const texts = [NOTES.empty, ...LEVELS.flatMap((lv) => lv.fieldNotes)];
  assert.ok(texts.length > 1);
  const bad = [];
  for (const t of texts) {
    const lines = noteLines(t);
    if (lines.length > L.maxLines) bad.push(`${lines.length} lines: ${t.slice(0, 40)}`);
    for (const l of lines) if (measureText(l) > L.colW) bad.push('too wide: ' + l);
  }
  assert.deepEqual(bad, []);
  // header and footer lines share their rows without colliding
  const head = 8 + measureText(NOTES.heading, { font: 'small', spacing: 2 });
  const count = measureText(fmt(NOTES.count, { n: 99 }), { font: 'small', spacing: 1 });
  assert.ok(head + 12 < SW - 8 - count, 'heading and count');
  const pageW = measureText(fmt(NOTES.page, { n: 99, N: 99 }), { font: 'small', spacing: 1 }) + 14 + measureText('↓');
  const footW = measureText(NOTES.footer, { font: 'small', spacing: 1 });
  assert.ok(8 + pageW + 12 < SW - 8 - footW, 'page marks and footer');
  assert.ok(L.headY + 5 < L.top - 6 && L.bottom + 4 < L.footY, 'the rules sit between the header, the note and the footer');
});

// ------------------------------------------------------------------ floating-box HUD
test('HUD box: the key bar fits for chains of 2, 3 and 4, floats bottom-left and overlaps nothing', () => {
  const MINIMAP_LEFT = SW - 48 - 4 - 2;       // frame of the minimap, top right
  for (const n of [2, 3, 4]) {
    const B = keyBoxLayout(n);
    assert.equal(B.cells.length, n);
    assert.equal(B.h, CELL_H);
    assert.ok(B.x >= 3 && B.y + B.h < SH, 'floats inside the screen with a margin');
    let x = B.x;
    for (const c of [...B.cells, B.gate]) {
      assert.ok(c.x >= x, `cell at ${c.x} starts after ${x}`);
      x = c.x + c.w;
    }
    assert.equal(B.gate.x - (B.cells[n - 1].x + CHAIN_W), CHEV, 'a chevron gap before the bealach');
    assert.ok(B.gate.x + GATE_W <= B.x + B.w, 'cells inside the box');
    assert.ok(B.x + B.w < MINIMAP_LEFT, 'clear of the minimap');
    assert.ok(B.y > 13 + 60, 'well below the top strip and banners');
    const rest = restingBox(n);
    assert.ok(rest.x >= B.x + B.w, `${n}-chain: the resting box (x ${rest.x}) clears the key box (ends ${B.x + B.w})`);
    assert.ok(rest.x + rest.w < SW - 3, 'resting box inside the screen');
  }
  assert.ok(GATE_W >= CHAIN_W);
});
