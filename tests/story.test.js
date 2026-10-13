/**
 * Story panels, the typewriter and its queue, the seen-flags, and the scroll HUD's geometry.
 * All pure: panels paint into plain rasters, so the painters run (and are hashed) in Node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/world/levels/index.js';
import { PAL, PAL_U32_LIST } from '../src/render/palette.js';
import { measureText } from '../src/render/font.js';
import { STORY, NOTES, HUD, COMPLETE, TEXT, allStrings, fmt } from '../src/text.js';
import {
  CHAR_MS, START_DELAY_MS, FLAGS_KEY, StoryQueue, revealCount, loadFlags, saveFlags, markSeen, hasSeen, flagKey,
  storiesEnabled, introItems, trackItems, completeItems, albumItems,
} from '../src/story.js';
import {
  PANEL, TITLE_SCENE, THUMB, PANEL_KINDS, freshBase, paintBase, renderPanel, pixelHash, warmProfile, hasProfile, getProfile,
} from '../src/render/panels.js';
import { LAYOUT, captionLines, revealLines } from '../src/render/screens.js';
import { CELL_H, CHAIN_W, GATE_W, CHEV, keyBoxLayout, restingBox } from '../src/render/hud.js';

const SW = 384, SH = 216;
const itemOf = (caption, levelIndex = 0) => ({ panel: { kind: 'ridge', levelIndex }, caption });

// ------------------------------------------------------------------ typewriter
test('typewriter: nothing before the start delay, then one character per CHAR_MS, capped at the length', () => {
  assert.equal(CHAR_MS, 28);
  assert.equal(revealCount(10, 0), 0);
  assert.equal(revealCount(10, START_DELAY_MS), 0);
  assert.equal(revealCount(10, START_DELAY_MS + CHAR_MS), 1);
  assert.equal(revealCount(10, START_DELAY_MS + CHAR_MS * 4 + 3), 4);
  assert.equal(revealCount(10, 1e6), 10);
  assert.equal(revealCount(0, 1e6), 0);
  assert.equal(revealCount(10, -5), 0);
});

test('first press completes the caption, the second advances, the last finishes the queue (once)', () => {
  let done = 0;
  const q = new StoryQueue([itemOf('ONE TWO'), itemOf('THREE')], () => { done++; });
  q.update(300);
  assert.ok(q.typed > 0 && q.typed < 7, 'still typing: ' + q.typed);
  assert.equal(q.complete, false);
  assert.equal(q.press(), 'complete');
  assert.equal(q.typed, 7);
  assert.equal(q.complete, true);
  assert.equal(q.index, 0);
  assert.equal(q.press(), 'advance');
  assert.equal(q.index, 1);
  assert.equal(q.typed, 0, 'the next caption starts again');
  assert.equal(done, 0);
  q.update(300);
  assert.equal(q.press(), 'complete');
  assert.equal(q.press(), 'done');
  assert.equal(q.done, true);
  assert.equal(done, 1);
  assert.equal(q.press(), 'done');
  q.skip();
  assert.equal(done, 1, 'onDone fires once');
  assert.equal(q.view(), null);
});

test('a press in the first instant is the keypress that opened the panel and is ignored', () => {
  const q = new StoryQueue([itemOf('HELLO')]);
  assert.equal(q.press(), 'ignored');
  assert.equal(q.index, 0);
  q.update(10);
  assert.equal(q.press(), 'ignored');
  q.update(200);
  assert.equal(q.press(), 'complete');
});

test('a caption that has finished typing advances on the very next press', () => {
  const q = new StoryQueue([itemOf('AB'), itemOf('CD')]);
  q.update(START_DELAY_MS + CHAR_MS * 5);
  assert.equal(q.complete, true);
  assert.equal(q.press(), 'advance');
});

test('queue order is the order given; skip abandons the rest and still calls onDone', () => {
  const seen = [];
  let done = 0;
  const q = new StoryQueue([itemOf('A', 0), itemOf('B', 1), itemOf('C', 2)], () => { done++; });
  for (let i = 0; i < 2; i++) { seen.push(q.view().panel.levelIndex); q.update(300); q.press(); q.press(); }
  seen.push(q.view().panel.levelIndex);
  assert.deepEqual(seen, [0, 1, 2]);
  const q2 = new StoryQueue([itemOf('A'), itemOf('B')], () => { done++; });
  q2.update(1000);
  assert.equal(q2.skip(), 'done');
  assert.equal(q2.done, true);
  assert.equal(done, 1);
  const v = new StoryQueue([itemOf('A')]).view();
  assert.deepEqual(Object.keys(v).sort(), ['caption', 'complete', 'count', 'index', 'panel', 't', 'total', 'typed']);
});

test('an empty queue is done at once and calls onDone', () => {
  let done = 0;
  const q = new StoryQueue([], () => { done++; });
  assert.equal(q.done, true);
  assert.equal(done, 1);
  assert.equal(q.view(), null);
});

test('intro, track, complete and album items: the panels the game shows', () => {
  const intro = introItems(STORY.intro);
  assert.equal(intro.length, 3);
  assert.deepEqual(intro.map((i) => i.panel.kind), ['ridge', 'ridge', 'stone']);
  assert.equal(intro[0].caption, STORY.intro[0]);
  assert.deepEqual(trackItems(2, 'X')[0].panel, { kind: 'ridge', levelIndex: 2 });
  assert.equal(completeItems(1, 'Y')[0].panel.kind, 'stone');
  assert.equal(albumItems('Z')[0].panel.kind, 'dawn');
  assert.equal(albumItems('Z')[0].caption, 'Z');
});

// ------------------------------------------------------------------ flags
function fakeStorage(initial) {
  const m = new Map(initial ? [[FLAGS_KEY, initial]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
}

test('flags: stored under their own key, persisted per story, read back', () => {
  assert.equal(FLAGS_KEY, 'contours.flags.v1');
  const st = fakeStorage();
  const flags = loadFlags(st);
  assert.deepEqual(flags, {});
  assert.equal(hasSeen(flags, flagKey.intro), false);
  markSeen(flags, flagKey.intro, st);
  markSeen(flags, flagKey.track('coe'), st);
  const again = loadFlags(st);
  assert.equal(hasSeen(again, 'intro'), true);
  assert.equal(hasSeen(again, 'track.coe'), true);
  assert.equal(hasSeen(again, 'track.affric'), false);
  assert.ok(st.m.has('contours.flags.v1'));
  assert.ok(![...st.m.keys()].includes('contours.progress.v1'), 'never touches the progress save');
});

test('flags: broken, hostile or unavailable storage degrades to empty and never throws', () => {
  assert.deepEqual(loadFlags(fakeStorage('{not json')), {});
  assert.deepEqual(loadFlags(fakeStorage('[1,2]')), {});
  assert.deepEqual(loadFlags(fakeStorage('7')), {});
  assert.deepEqual(loadFlags(null), {});
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadFlags(throwing), {});
  assert.equal(saveFlags(throwing, { a: 1 }), false);
  const flags = markSeen({}, 'intro', throwing);
  assert.equal(hasSeen(flags, 'intro'), true, 'the flag still holds for this session');
});

test('stories are off for tools (autopilot, mute, nostory) and ?story=1 forces them on', () => {
  const P = (q) => new URLSearchParams(q);
  assert.equal(storiesEnabled(P('')), true);
  assert.equal(storiesEnabled(P('level=3')), true);
  assert.equal(storiesEnabled(P('autopilot=1')), false);
  assert.equal(storiesEnabled(P('mute=1')), false);
  assert.equal(storiesEnabled(P('nostory=1')), false);
  assert.equal(storiesEnabled(P('autopilot=1&mute=1&story=1')), true);
  assert.equal(storiesEnabled(P('story=0&mute=1')), false);
});

// ------------------------------------------------------------------ captions
test('story captions: every track has one, every string fits the caption box in 3 lines', () => {
  const L = LAYOUT.story;
  assert.equal(L.capW, 300);
  assert.equal(STORY.intro.length, 3);
  for (const lv of LEVELS) assert.ok(STORY.track[lv.id], `${lv.id} has a track caption`);
  assert.equal(Object.keys(STORY.track).length, LEVELS.length);
  const texts = [
    ...STORY.intro, ...Object.values(STORY.track), fmt(STORY.complete, { n: 8 }), STORY.album, NOTES.empty,
    ...LEVELS.flatMap((lv) => lv.fieldNotes),
  ];
  const bad = [];
  for (const t of texts) {
    const lines = captionLines(t);
    if (lines.length > L.capLines) bad.push(`${lines.length} lines: ${t.slice(0, 40)}`);
    for (const l of lines) if (measureText(l, { spacing: L.spacing }) > L.capW) bad.push('too wide: ' + l);
  }
  assert.deepEqual(bad, []);
  // the room the caption leaves under the picture
  assert.ok(L.capY >= L.bandY + 4 && L.capY + L.capLines * 10 <= 206, 'caption sits inside the dark band, above the hint line');
  assert.ok(measureText(STORY.skip, { font: 'small', spacing: 1 }) < SW - 40);
  assert.ok(measureText(STORY.notesFooter, { font: 'small', spacing: 1 }) < SW - 40);
  assert.equal(STORY.track.nevis, "BEN NEVIS. A'THING YE'VE HEARD IS ON THIS HILL. WALK IT HAME.");
  assert.equal(fmt(STORY.complete, { n: 3 }), 'THE BEALACH UNSTEEKS. 3/8 SKELFS GAITHERT.');
});

test('story strings are part of the text tree the glyph and placeholder tests walk', () => {
  assert.ok(TEXT.story === STORY);
  const paths = allStrings().map(([p]) => p);
  assert.ok(paths.some((p) => p.startsWith('text.story.track.rannoch')));
  assert.ok(paths.some((p) => p.startsWith('text.story.intro[2]')));
});

test('the reveal is spread across the wrapped lines without moving a word', () => {
  const text = 'THE HIELANDS ARE AN AULD SANG, AN THE SANG WAS SCATTERED ACROSS AUCHT GLENS.';
  const lines = captionLines(text);
  assert.ok(lines.length >= 2);
  assert.deepEqual(revealLines(lines, 0), lines.map(() => ''));
  assert.deepEqual(revealLines(lines, 999), lines);
  const half = revealLines(lines, [...lines[0]].length + 1 + 3);
  assert.equal(half[0], lines[0]);
  assert.equal(half[1], [...lines[1]].slice(0, 3).join(''));
});

// ------------------------------------------------------------------ painters
const PAL_SET = new Set(PAL_U32_LIST);
const SPECS = {
  ridge: { kind: 'ridge', levelIndex: 0 },
  bothy: { kind: 'bothy', levelIndex: 1 },
  stone: { kind: 'stone', levelIndex: 2 },
  dawn: { kind: 'dawn', levelIndex: 7 },
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

test('ridge panels are each track\'s own place: the skyline comes from its heightfield', () => {
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
  // the scenes are red: the reds of the evening are in every kind of panel
  const reds = ['blood', 'rust', 'ember', 'heather'].map((n) => PAL_U32_LIST[Object.keys(PAL).indexOf(n)]);
  for (const [k, spec] of Object.entries(SPECS)) {
    const d = freshBase(spec, PANEL.w, PANEL.h);
    for (const c of reds) assert.ok(d.includes(c), `${k} uses ${c.toString(16)}`);
  }
});

test('the title is full-bleed: the whole 384x216 screen is painted art with the logo on top, nothing is left unpainted', () => {
  assert.deepEqual([PANEL.w, PANEL.h, TITLE_SCENE.w, TITLE_SCENE.h], [384, 216, 384, 216]);
  const d = freshBase(SPECS.title, 384, 216);
  assert.ok(d.every((c) => c !== 0));
  // the logo: bright flame and bone pixels in the upper third, where the lettering is carved
  let bright = 0;
  for (let y = 10; y < 80; y++) for (let x = 20; x < 364; x++) if (d[y * 384 + x] === PAL_U32_LIST[Object.keys(PAL).indexOf('flame')]) bright++;
  assert.ok(bright > 400, 'lettering present: ' + bright);
});

test('every track names its signature hue: a palette colour from the red family where sensible, distinct from the others', () => {
  const names = LEVELS.map((lv) => lv.palette.accent);
  assert.ok(names.every((n) => typeof n === 'string' && PAL[n]), 'accent is a palette name');
  assert.equal(new Set(names).size, 8);
  assert.deepEqual(names, ['ember', 'rust', 'magenta', 'ice', 'lamp', 'heather', 'rock', 'flame']);
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
