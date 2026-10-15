import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAL, PAL_NAMES, PAL_INDEX, PAL_RGB, PAL_U32, PAL_U32_LIST, PAL_COUNT, BASE_COUNT, SNAP_COUNT, GREY_RAMP, BLUE_RAMP,
  paletteIndexOf, quantize, quantizeHex, tintFor, tintAt, phaseBlend, applyTint, BAYER8, LIGHT_GROUND, WARM_MAP, NIGHT_A, NIGHT_B, NIGHT_W,
} from '../src/render/palette.js';

const ORIGINAL_16 = ['paper', 'paper2', 'contour', 'contourIdx', 'water', 'waterDeep', 'waterInk', 'wood', 'woodDark', 'ink', 'magenta', 'grid', 'snow', 'rock', 'bog', 'night'];
const NEW_5 = { lamp: '#e8832a', flame: '#f4c43c', bolt: '#f6c8f6', ice: '#8ee6e6', dusk: '#4b4a7a' };
const REDS = { blood: '#5e1f2b', rust: '#a9402a', ember: '#dd5a38', heather: '#7d3a62' };

test('the palette has exactly 35 unique colours', () => {
  assert.equal(PAL_COUNT, 35);
  assert.equal(PAL_NAMES.length, 35);
  assert.equal(new Set(Object.values(PAL).map((h) => h.toLowerCase())).size, 35);
  assert.equal(new Set(PAL_U32_LIST).size, 35);
  for (const h of Object.values(PAL)) assert.match(h, /^#[0-9a-f]{6}$/);
});

test('the original 16 colours keep their names, order and values; five new ones follow', () => {
  assert.deepEqual(PAL_NAMES.slice(0, BASE_COUNT), ORIGINAL_16);
  assert.equal(BASE_COUNT, 16);
  assert.equal(PAL.paper, '#f2ead3');
  assert.equal(PAL.night, '#20263a');
  for (const [n, hex] of Object.entries(NEW_5)) {
    assert.equal(PAL[n], hex, n);
    assert.ok(PAL_INDEX[n] >= 16, n + ' is an addition');
  }
  assert.deepEqual(PAL_NAMES.slice(16, 21).sort(), Object.keys(NEW_5).sort());
  assert.deepEqual(PAL_NAMES.slice(21, 25), ['blood', 'rust', 'ember', 'heather']);
  assert.deepEqual(PAL_NAMES.slice(25, 29), ['char', 'slate', 'ash', 'fog']);
  assert.deepEqual(PAL_NAMES.slice(29), ['deepblue', 'steelD', 'steel', 'blue', 'paleblue', 'frost']);
  assert.deepEqual([PAL.deepblue, PAL.steelD, PAL.steel, PAL.blue, PAL.paleblue, PAL.frost], ['#1b2a47', '#2f4468', '#4a6a94', '#6f90b8', '#a3bcd8', '#cfe0ee']);
  assert.deepEqual([PAL.char, PAL.slate, PAL.ash, PAL.fog], ['#3a3835', '#5f5c58', '#807c77', '#c9c5be']);
  for (const [n, hex] of Object.entries(REDS)) assert.equal(PAL[n], hex, n);
});

test('rgb and u32 tables agree with the hex values', () => {
  for (const n of PAL_NAMES) {
    const [r, g, b] = PAL_RGB[n];
    assert.equal(PAL[n], '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join(''));
    assert.equal(PAL_U32[n], ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
    assert.equal(PAL_U32_LIST[PAL_INDEX[n]], PAL_U32[n]);
  }
});

test('the perfect hash round-trips every colour, whatever the alpha, and rejects non-palette pixels', () => {
  PAL_NAMES.forEach((n, i) => {
    assert.equal(paletteIndexOf(PAL_U32[n]), i, n);
    assert.equal(paletteIndexOf(PAL_U32[n] & 0x00ffffff), i, n + ' (alpha ignored)');
  });
  const known = new Set(PAL_U32_LIST.map((u) => u & 0xffffff));
  let seed = 12345, tested = 0;
  for (let k = 0; k < 20000; k++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const v = (0xff000000 | seed) >>> 0;
    if (known.has(v & 0xffffff)) continue;
    assert.equal(paletteIndexOf(v), 255);
    tested++;
  }
  assert.ok(tested > 19000);
  assert.equal(paletteIndexOf(0xff000000), 255);
  assert.equal(paletteIndexOf(0), 255);
});

test('quantize snaps to the nearest colour; the new colours are reachable, level tints still snap to the original 16', () => {
  for (const n of PAL_NAMES) assert.equal(quantizeHex(PAL[n], PAL_COUNT), n);
  // the default search is the legacy 29: nothing the main game snaps can land on a blue
  assert.equal(SNAP_COUNT, 29);
  for (const n of PAL_NAMES.slice(0, SNAP_COUNT)) assert.equal(quantizeHex(PAL[n]), n);
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) assert.ok(quantize(r, g, b) < SNAP_COUNT);
  assert.equal(quantizeHex('#ec8a30'), 'lamp');
  assert.equal(quantizeHex('#4b4a7a', BASE_COUNT) !== 'dusk', true);
  assert.equal(quantizeHex('#dd5a38'), 'ember');
  for (const n of PAL_NAMES.slice(0, 16)) assert.equal(quantizeHex(PAL[n], BASE_COUNT), n);
  // a violet level tint must not turn into an accent wash of one of the new colours
  const t = tintFor('dusk', '#4b4a7a');
  for (const w of t.wash) assert.ok(PAL_INDEX[w.color] < BASE_COUNT, w.color);
  assert.ok(quantize(0xe8, 0x83, 0x2a) === PAL_INDEX.lamp);
});

test('tint tables cover the whole palette and map only to palette indices', () => {
  assert.equal(LIGHT_GROUND.length, PAL_COUNT);
  assert.equal(WARM_MAP.length, PAL_COUNT);
  assert.equal(NIGHT_A.length, PAL_COUNT);
  for (let i = 0; i < PAL_COUNT; i++) {
    assert.ok(WARM_MAP[i] < PAL_COUNT && NIGHT_A[i] < PAL_COUNT && NIGHT_B[i] < PAL_COUNT, 'index ' + i);
    assert.ok(NIGHT_W[i] >= 0 && NIGHT_W[i] <= 1);
  }
  // the glow colours and the dark blues pass through the night tint untouched
  for (const n of [...Object.keys(NEW_5), ...BLUE_RAMP.slice(0, 4)]) {
    const i = PAL_INDEX[n];
    assert.equal(NIGHT_A[i], i, n); assert.equal(NIGHT_B[i], i, n); assert.equal(WARM_MAP[i], i, n); assert.equal(LIGHT_GROUND[i], 0, n);
  }
  // the season prints (level.look.paper fog / frost) are ground: they warm and darken like paper; paleblue (their shade) darkens
  for (const n of ['fog', 'frost']) {
    const i = PAL_INDEX[n];
    assert.equal(LIGHT_GROUND[i], 1, n); assert.notEqual(WARM_MAP[i], i, n); assert.equal(NIGHT_A[i], PAL_INDEX.night, n);
  }
  assert.equal(NIGHT_A[PAL_INDEX.paleblue], PAL_INDEX.night);
  assert.equal(LIGHT_GROUND[PAL_INDEX.paleblue], 0);
});

test('the grey and blue ramps pair step for step: same order, similar value, snow shared', () => {
  const luma = (n) => { const c = PAL_RGB[n]; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
  assert.equal(GREY_RAMP.length, 7); assert.equal(BLUE_RAMP.length, 7);
  assert.equal(GREY_RAMP[6], 'snow'); assert.equal(BLUE_RAMP[6], 'snow');
  for (let i = 1; i < 7; i++) { assert.ok(luma(GREY_RAMP[i]) > luma(GREY_RAMP[i - 1]), 'grey ascends ' + i); assert.ok(luma(BLUE_RAMP[i]) > luma(BLUE_RAMP[i - 1]), 'blue ascends ' + i); }
  for (let i = 0; i < 6; i++) assert.ok(Math.abs(luma(GREY_RAMP[i]) - luma(BLUE_RAMP[i])) < 40, `step ${i}: ${GREY_RAMP[i]} ~ ${BLUE_RAMP[i]}`);
  for (const n of BLUE_RAMP.slice(0, 6)) { const c = PAL_RGB[n]; assert.ok(c[2] > c[0], n + ' is a blue'); }
});

function randomBuf(w, h, seed = 9, extra = []) {
  const keys = PAL_U32_LIST.concat(extra);
  const b = new Uint32Array(w * h);
  let s = seed;
  for (let i = 0; i < b.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; b[i] = keys[(s >>> 8) % keys.length]; }
  return b;
}

test('tint functions leave pixels that are not palette colours alone, and only emit palette colours', () => {
  const stray = [0xff123456, 0xff00ff00, 0xff0a0a0a, 0x00000000];
  const w = 64, h = 48;
  for (const tod of [0.05, 0.2, 0.375, 0.5, 0.625, 0.75, 0.875, 0.97]) {
    const src = randomBuf(w, h, 3, stray);
    const buf = src.slice();
    applyTint(buf, w, h, tintAt(tod, '#7f8f6a'), 17, 5);
    for (let i = 0; i < buf.length; i++) {
      if (paletteIndexOf(src[i]) === 255) assert.equal(buf[i], src[i], `stray pixel changed at tod ${tod}`);
      else assert.notEqual(paletteIndexOf(buf[i]), 255, `off-palette output at tod ${tod}`);
    }
  }
});

test('full day is a no-op; a light map of 0 holds the night back and 255 is the plain night tint', () => {
  const w = 40, h = 30;
  const src = randomBuf(w, h, 5);
  const day = src.slice();
  applyTint(day, w, h, tintAt(0.375));
  assert.deepEqual(day, src);
  const night = tintAt(0.875);
  assert.ok(night.night > 0.9);
  const lit = src.slice(), unlit = src.slice(), plain = src.slice();
  applyTint(lit, w, h, night, 0, 0, 0, h, new Uint8Array(w * h).fill(0));
  applyTint(unlit, w, h, night, 0, 0, 0, h, new Uint8Array(w * h).fill(255));
  applyTint(plain, w, h, night);
  assert.deepEqual(unlit, plain);
  let same = 0;
  for (let i = 0; i < lit.length; i++) if (lit[i] === src[i]) same++;
  assert.equal(same, lit.length, 'a fully lit pixel gets no night dither');
  assert.notDeepEqual(plain, src);
});

test('the night tint keeps glow colours (lamp, flame, bolt, ice, dusk) as they are', () => {
  const glow = ['lamp', 'flame', 'bolt', 'ice', 'dusk'].map((n) => PAL_U32[n]);
  const buf = Uint32Array.from({ length: 200 }, (_, i) => glow[i % 5]);
  const before = buf.slice();
  applyTint(buf, 20, 10, tintAt(0.875));
  assert.deepEqual(buf, before);
});

test('phaseBlend and tintAt agree: phases hold through their middles and always blend between two neighbours', () => {
  for (let t = 0; t < 1; t += 0.01) {
    const p = phaseBlend(t);
    assert.ok(p.f >= 0 && p.f <= 1);
    assert.ok(['dawn', 'day', 'dusk', 'night'].includes(p.a) && ['dawn', 'day', 'dusk', 'night'].includes(p.b));
    const tint = tintAt(t);
    assert.ok(Number.isFinite(tint.night) && Number.isFinite(tint.warm));
  }
  assert.equal(tintAt(0.375).night, 0);
  assert.ok(tintAt(0.875).night >= 0.96);
});

test('BAYER8 is a permutation of 0..63', () => {
  assert.deepEqual([...BAYER8].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
});
