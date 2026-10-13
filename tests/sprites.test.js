import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, walkerArt, lanternAnchor, WALKER_SIZE, GATE_ART, GATE_OPEN_ART, GATE_SIZE, MAP_SYMBOLS, ICON_ART } from '../src/render/sprites.js';
import { PAL } from '../src/render/palette.js';

const DIRS = ['N', 'E', 'S', 'W'];
const POSES = ['idle', 'walk', 'slide', 'wade', 'mud'];

test('colour legend knows the new palette letters', () => {
  assert.equal(COLORS.L, PAL.lamp); assert.equal(COLORS.f, PAL.flame); assert.equal(COLORS.v, PAL.dusk);
  assert.equal(COLORS.y, PAL.ice); assert.equal(COLORS.z, PAL.bolt);
});

test('every wanderer pose is 12x12, uses only known colour letters, has an ink outline and a lit lantern', () => {
  assert.equal(WALKER_SIZE, 12);
  for (const d of DIRS) for (const p of POSES) for (const f of [0, 1]) {
    const art = walkerArt(d, p, f);
    assert.equal(art.length, 12, `${d}/${p}/${f} rows`);
    let ink = 0, lamp = 0, flame = 0, rock = 0;
    art.forEach((row) => {
      assert.equal(row.length, 12);
      for (const ch of row) {
        if (ch === '.') continue;
        assert.ok(COLORS[ch], `unknown letter ${ch}`);
        if (ch === 'k') ink++; else if (ch === 'L') lamp++; else if (ch === 'f') flame++; else if (ch === 'r') rock++;
      }
    });
    assert.ok(ink >= 20, `${d}/${p}/${f} has a strong dark outline (${ink})`);
    assert.ok(lamp >= 2 && flame >= 1, `${d}/${p}/${f} lantern is lit`);
    assert.ok(rock >= 8, 'torn grey cloak');
  }
});

test('the lantern anchor sits on the flame for every pose and mirrors for W', () => {
  for (const d of DIRS) for (const p of POSES) for (const f of [0, 1]) {
    if (p === 'wade' || p === 'mud') continue;
    const a = lanternAnchor(d, p, f);
    const art = walkerArt(d, p, f);
    assert.equal(art[a.y][a.x], 'f', `${d}/${p}/${f} flame at ${a.x},${a.y}`);
  }
  const e = lanternAnchor('E', 'idle', 0), w = lanternAnchor('W', 'idle', 0);
  assert.equal(e.x + w.x, WALKER_SIZE - 1); assert.equal(e.y, w.y);
  // wade / mud keep the standing lantern
  assert.deepEqual(lanternAnchor('S', 'wade', 1), lanternAnchor('S', 'idle', 0));
});

test('idle flutters (two different frames), walking alternates, W is the mirror of E', () => {
  for (const d of ['N', 'E', 'S']) {
    assert.notDeepEqual(walkerArt(d, 'idle', 0), walkerArt(d, 'idle', 1));
    assert.notDeepEqual(walkerArt(d, 'walk', 0), walkerArt(d, 'walk', 1));
  }
  const e = walkerArt('E', 'walk', 1), w = walkerArt('W', 'walk', 1);
  assert.deepEqual(w, e.map((r) => [...r].reverse().join('')));
  // wading and mud hide the lower body behind ripple / mud rows
  assert.ok(walkerArt('S', 'wade', 0).slice(8).some((r) => r.includes('h')));
  assert.ok(walkerArt('S', 'mud', 0).slice(8).some((r) => r.includes('o')));
});

test('gate is a Pictish symbol stone: keeps its size, closed is cold grey, open glows ember; no crosses', () => {
  assert.deepEqual(GATE_SIZE, [11, 10]);
  for (const art of [GATE_ART, GATE_OPEN_ART]) { assert.equal(art.length, 10); art.forEach((r) => assert.equal(r.length, 11)); }
  const open = GATE_OPEN_ART.join(''), closed = GATE_ART.join('');
  assert.ok(open.includes('E') && open.includes('f') && !open.includes('y') && !open.includes('m'));
  assert.ok(closed.includes('r') && closed.includes('n') && !/[EfLy]/.test(closed));
  assert.equal(COLORS.E, PAL.ember);
  // a tapering slab: wider at the foot than at the head
  const w = (row) => [...row].filter((c) => c !== '.').length;
  assert.ok(w(GATE_ART[1]) < w(GATE_ART[8]));
  // no plus-shaped cross anywhere in the incisions: no cell with all four neighbours incised
  for (const [art, ch] of [[GATE_ART, 'n'], [GATE_OPEN_ART, 'E'], [GATE_OPEN_ART, 'f']]) {
    for (let y = 1; y < 9; y++) for (let x = 1; x < 10; x++) {
      if (art[y][x] === ch && art[y - 1][x] === ch && art[y + 1][x] === ch && (art[y][x - 1] === ch || art[y][x + 1] === ch)) assert.fail('cross-like incision at ' + x + ',' + y);
    }
  }
  const sym = MAP_SYMBOLS.gate;
  assert.equal(sym.length, 8); sym.forEach((r) => assert.equal(r.length, 9));
  assert.ok(MAP_SYMBOLS.bothy.join('').includes('L'), 'bothy windows are lit on the sheet');
  assert.ok(ICON_ART.bothy.join('').includes('L'));
});
