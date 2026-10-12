import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES, noteName, midiToHz, degreeToMidi, chordFromDegree, voiceLead, quantize,
  CONTOUR_MOTIF, transformMotif,
} from '../src/audio/theory.js';

test('modes have expected lengths and start on 0', () => {
  const need = ['ionian', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian', 'lydianDom',
    'octatonic', 'pentMajor', 'pentMinor', 'wholeTone', 'hirajoshi'];
  for (const k of need) {
    assert.ok(MODES[k], k);
    assert.equal(MODES[k][0], 0);
    for (let i = 1; i < MODES[k].length; i++) assert.ok(MODES[k][i] > MODES[k][i - 1]);
    assert.ok(MODES[k][MODES[k].length - 1] < 12);
  }
  assert.equal(MODES.ionian.length, 7);
  assert.equal(MODES.octatonic.length, 8);
  assert.deepEqual(MODES.octatonic.slice(0, 4), [0, 1, 3, 4]);
  assert.equal(MODES.pentMajor.length, 5);
  assert.equal(MODES.wholeTone.length, 6);
});

test('noteName and midiToHz', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(61), 'C#4');
  assert.equal(noteName(38), 'D2');
  assert.equal(noteName(0), 'C-1');
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToHz(57) - 220) < 1e-9);
  assert.ok(Math.abs(midiToHz(60) - 261.6256) < 1e-3);
});

test('degreeToMidi handles negative and overflow degrees', () => {
  assert.equal(degreeToMidi(60, 'ionian', 0), 60);
  assert.equal(degreeToMidi(60, 'ionian', 2), 64);
  assert.equal(degreeToMidi(60, 'ionian', 7), 72);
  assert.equal(degreeToMidi(60, 'ionian', 9), 76);
  assert.equal(degreeToMidi(60, 'ionian', -1), 59);
  assert.equal(degreeToMidi(60, 'ionian', -7), 48);
  assert.equal(degreeToMidi(60, 'ionian', -8), 47);
  assert.equal(degreeToMidi(60, 'ionian', 1, 1), 74);
  assert.equal(degreeToMidi(60, 'pentMinor', 5), 72);
  assert.equal(degreeToMidi(60, 'pentMinor', -1), 58);
  assert.equal(degreeToMidi(60, MODES.dorian, 2), 63);
  assert.equal(degreeToMidi(62, 'octatonic', 8), 74);
});

test('chordFromDegree stacks thirds in mode', () => {
  assert.deepEqual(chordFromDegree(60, 'ionian', 0), [60, 64, 67]);
  assert.deepEqual(chordFromDegree(60, 'ionian', 1), [62, 65, 69]);
  assert.deepEqual(chordFromDegree(60, 'ionian', 4, { size: 4 }), [67, 71, 74, 77]);
  assert.deepEqual(chordFromDegree(60, 'ionian', 0, { size: 5 }), [60, 64, 67, 71, 74]);
  assert.deepEqual(chordFromDegree(60, 'dorian', 0), [60, 63, 67]);
  // inversions
  assert.deepEqual(chordFromDegree(60, 'ionian', 0, { inversion: 1 }), [64, 67, 72]);
  assert.deepEqual(chordFromDegree(60, 'ionian', 0, { inversion: 2 }), [67, 72, 76]);
  assert.deepEqual(chordFromDegree(60, 'ionian', 0, { inversion: -1 }), [55, 60, 64]);
  // spread opens voicing
  const open = chordFromDegree(60, 'ionian', 0, { spread: 1 });
  assert.deepEqual(open, [60, 67, 76]);
  const open2 = chordFromDegree(60, 'ionian', 0, { spread: 2 });
  assert.deepEqual(open2, [48, 67, 76]);
  // pentatonic: every other scale step
  assert.deepEqual(chordFromDegree(60, 'pentMajor', 0), [60, 64, 69]);
  // negative / overflow degrees
  assert.deepEqual(chordFromDegree(60, 'ionian', -2), [57, 60, 64]);
  assert.deepEqual(chordFromDegree(60, 'ionian', 7), [72, 76, 79]);
  // octatonic alternate steps -> minor thirds
  assert.deepEqual(chordFromDegree(60, 'octatonic', 0), [60, 63, 66]);
});

test('voiceLead minimises motion and preserves pitch classes', () => {
  const c = [60, 64, 67];
  const am = voiceLead(c, [57, 60, 64]);
  assert.deepEqual(am, [60, 64, 69]);
  const f = voiceLead(c, [53, 57, 60]);
  assert.deepEqual(f, [60, 65, 69]);
  const total = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0);
  assert.equal(total(c, f), 0 + 1 + 2);
  // pitch classes preserved
  const pcs = (a) => a.map((x) => ((x % 12) + 12) % 12).sort((x, y) => x - y);
  assert.deepEqual(pcs(f), pcs([53, 57, 60]));
  // far-away next chord is pulled near
  const far = voiceLead([60, 64, 67], [26, 29, 33]);
  for (const n of far) assert.ok(n >= 55 && n <= 75, String(n));
  // different sizes
  const four = voiceLead([60, 64, 67], [55, 59, 62, 65]);
  assert.equal(four.length, 4);
  const two = voiceLead([60, 64, 67], [65, 69]);
  assert.equal(two.length, 2);
  assert.deepEqual(voiceLead([], [5, 9, 12]), [5, 9, 12]);
  // ascending
  for (const arr of [am, f, four, two]) for (let i = 1; i < arr.length; i++) assert.ok(arr[i] >= arr[i - 1]);
});

test('quantize snaps to the mode', () => {
  assert.equal(quantize(61, 60, 'ionian'), 60);       // tie -> down
  assert.equal(quantize(63, 60, 'ionian'), 62);       // tie between 62 and 64 -> down
  assert.equal(quantize(63.6, 60, 'ionian'), 64);
  assert.equal(quantize(66, 60, 'lydian'), 66);
  assert.equal(quantize(70, 60, 'pentMajor'), 69);
  assert.equal(quantize(48.4, 60, 'ionian'), 48);
  assert.equal(quantize(59, 60, 'ionian'), 59);
  assert.equal(quantize(71.9, 60, 'ionian'), 72);
});

test('CONTOUR_MOTIF and transformMotif', () => {
  assert.deepEqual([...CONTOUR_MOTIF], [0, 2, 4, 1, 3]);
  const inv = transformMotif(CONTOUR_MOTIF, 'invert');
  assert.deepEqual(inv.degrees, [0, -2, -4, -1, -3]);
  assert.deepEqual(inv.durations, [1, 1, 1, 1, 1]);
  const ret = transformMotif(CONTOUR_MOTIF, 'retro');
  assert.deepEqual(ret.degrees, [3, 1, 4, 2, 0]);
  const aug = transformMotif(CONTOUR_MOTIF, 'augment');
  assert.deepEqual(aug.degrees, [0, 2, 4, 1, 3]);
  assert.deepEqual(aug.durations, [2, 2, 2, 2, 2]);
  const rot = transformMotif(CONTOUR_MOTIF, 'rotate:2');
  assert.deepEqual(rot.degrees, [4, 1, 3, 0, 2]);
  assert.deepEqual(transformMotif(CONTOUR_MOTIF, 'rotate:-1').degrees, [3, 0, 2, 4, 1]);
  assert.deepEqual(transformMotif(CONTOUR_MOTIF, 'rotate:7').degrees, [4, 1, 3, 0, 2]);
  assert.deepEqual(transformMotif(CONTOUR_MOTIF, 'transpose:2').degrees, [2, 4, 6, 3, 5]);
  assert.deepEqual(transformMotif(CONTOUR_MOTIF, 'transpose:-3').degrees, [-3, -1, 1, -2, 0]);
  // chaining and re-transforming {degrees,durations}
  const chain = transformMotif(CONTOUR_MOTIF, 'retro+augment');
  assert.deepEqual(chain.degrees, [3, 1, 4, 2, 0]);
  assert.deepEqual(chain.durations, [2, 2, 2, 2, 2]);
  const again = transformMotif(aug, 'retro');
  assert.deepEqual(again.durations, [2, 2, 2, 2, 2]);
  // input not mutated
  assert.deepEqual([...CONTOUR_MOTIF], [0, 2, 4, 1, 3]);
  // durations travel with notes in retro/rotate
  const m = { degrees: [0, 1, 2], durations: [1, 2, 3] };
  assert.deepEqual(transformMotif(m, 'retro').durations, [3, 2, 1]);
  assert.deepEqual(transformMotif(m, 'rotate:1').durations, [2, 3, 1]);
  assert.throws(() => transformMotif(m, 'bogus'));
});
