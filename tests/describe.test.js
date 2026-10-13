import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POI_TYPES } from '../src/world/codes.js';
import { describeCondition, conditionGlyph, TYPE_LABEL, TYPE_ROLE } from '../src/game/describe.js';

test('describeCondition: every condition kind (Scots wording)', () => {
  assert.equal(describeCondition('approach', { approach: 'descending' }), 'Come doun tae it fae the heicher grund.');
  assert.equal(describeCondition('approach', { approach: 'ascending' }), 'Speel up tae it fae ablow.');
  assert.equal(describeCondition('speed', { speed: 'slow' }), 'Come at it canny: haud SPACE as ye walk.');
  assert.equal(describeCondition('speed', { speed: 'fast' }), 'Come at it at a rin: haud SHIFT. Dounhill helps.');
  assert.equal(describeCondition('dwell', { dwell: 4 }), 'Staun still aside it for 4 seconds.');
  assert.equal(describeCondition('climb', { climb: 3 }), 'Speel 3 thick contour lines wi nae step doun, syne arrive.');
  assert.equal(describeCondition('climb', { climb: 1 }), 'Speel 1 thick contour line wi nae step doun, syne arrive.');
  const word = { dawn: 'daw', day: 'day', dusk: 'gloamin', night: 'nicht' };
  for (const ph of ['dawn', 'day', 'dusk', 'night']) {
    assert.equal(describeCondition('time', { time: ph }), `Come back at ${word[ph]}. Staun still an haud SPACE tae pass the time.`);
  }
  assert.equal(describeCondition('requires', { requires: 'trig' }), 'Wauken a trig pillar first; it maun still be soondin.');
  assert.equal(describeCondition('requires', { requires: 'lochan' }), 'Wauken a lochan first; it maun still be soondin.');
  assert.equal(describeCondition('requires', { requires: 'stone' }), 'Wauken a staunin stane first; it maun still be soondin.');
  assert.equal(describeCondition('requires', { requires: 'waterfall' }), 'Wauken a linn first; it maun still be soondin.');
  assert.equal(describeCondition('bogus', {}), 'Somethin aboot the wey ye arrive isna richt yet.');
});

test('describeCondition: one short sentence for every key/type, never throws', () => {
  for (const [k, c] of [['approach', { approach: 'descending' }], ['speed', { speed: 'fast' }], ['dwell', { dwell: 2 }],
    ['climb', { climb: 2 }], ['time', { time: 'night' }]]) {
    const s = describeCondition(k, c, {});
    assert.ok(s.endsWith('.') && s.length < 90, s);
  }
  for (const t of POI_TYPES) assert.match(describeCondition('requires', { requires: t }), /^Wauken a .+ first/);
  assert.equal(typeof describeCondition('bogus', {}), 'string');
  assert.equal(typeof describeCondition('dwell', undefined), 'string');
  assert.equal(typeof describeCondition('requires', {}), 'string');
});

test('conditionGlyph: all glyphs', () => {
  assert.equal(conditionGlyph('approach', { approach: 'descending' }), 'DOUN');
  assert.equal(conditionGlyph('approach', { approach: 'ascending' }), 'UP');
  assert.equal(conditionGlyph('approach'), 'DOUN');
  assert.equal(conditionGlyph('speed', { speed: 'slow' }), 'CANNY');
  assert.equal(conditionGlyph('speed', { speed: 'fast' }), 'RIN');
  assert.equal(conditionGlyph('dwell', { dwell: 3 }), 'BIDE');
  assert.equal(conditionGlyph('climb', { climb: 2 }), 'SPEEL');
  assert.equal(conditionGlyph('time', { time: 'dusk' }), 'GLOAMIN');
  assert.equal(conditionGlyph('time', { time: 'night' }), 'NICHT');
  assert.equal(conditionGlyph('time', { time: 'dawn' }), 'DAW');
  assert.equal(conditionGlyph('time', { time: 'day' }), 'DAY');
  assert.equal(conditionGlyph('requires', { requires: 'trig' }), 'EFTER');
  assert.equal(typeof conditionGlyph('nope'), 'string');
});

test('TYPE_LABEL / TYPE_ROLE cover all eight types', () => {
  assert.equal(POI_TYPES.length, 8);
  for (const t of POI_TYPES) {
    assert.ok(TYPE_LABEL[t] && TYPE_LABEL[t] === TYPE_LABEL[t].toUpperCase(), t);
    assert.ok(TYPE_ROLE[t] && !TYPE_ROLE[t].includes('\n'), t);
  }
  assert.equal(TYPE_LABEL.trig, 'TRIG PILLAR');
  assert.equal(TYPE_LABEL.stone, 'STAUNIN STANE');
  assert.equal(TYPE_LABEL.waterfall, 'LINN');
  assert.equal(TYPE_ROLE.bothy, 'stane bield, never lockit · field notes an guidance');
});
