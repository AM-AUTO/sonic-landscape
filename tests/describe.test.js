import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POI_TYPES } from '../src/world/codes.js';
import { describeCondition, conditionGlyph, TYPE_LABEL, TYPE_ROLE } from '../src/game/describe.js';

test('describeCondition: every condition kind', () => {
  assert.equal(describeCondition('approach', { approach: 'descending' }), 'Come down to it from higher ground.');
  assert.equal(describeCondition('approach', { approach: 'ascending' }), 'Climb up to it from below.');
  assert.equal(describeCondition('speed', { speed: 'slow' }), 'Approach slowly: hold SPACE as you walk.');
  assert.equal(describeCondition('speed', { speed: 'fast' }), 'Arrive at a run: hold SHIFT, downhill helps.');
  assert.equal(describeCondition('dwell', { dwell: 4 }), 'Stand still beside it for 4 seconds.');
  assert.equal(describeCondition('climb', { climb: 3 }), 'Climb 3 thick contour lines without stepping down, then arrive.');
  assert.equal(describeCondition('climb', { climb: 1 }), 'Climb 1 thick contour line without stepping down, then arrive.');
  for (const ph of ['dawn', 'day', 'dusk', 'night']) {
    assert.equal(describeCondition('time', { time: ph }), `Return at ${ph}. Stand still holding SPACE to pass time.`);
  }
  assert.equal(describeCondition('requires', { requires: 'trig' }), 'Wake a trig pillar first; it must still be sounding.');
  assert.equal(describeCondition('requires', { requires: 'lochan' }), 'Wake a lochan first; it must still be sounding.');
});

test('describeCondition: one short sentence for every key/type, never throws', () => {
  for (const [k, c] of [['approach', { approach: 'descending' }], ['speed', { speed: 'fast' }], ['dwell', { dwell: 2 }],
    ['climb', { climb: 2 }], ['time', { time: 'night' }]]) {
    const s = describeCondition(k, c, {});
    assert.ok(s.endsWith('.') && s.length < 90, s);
  }
  for (const t of POI_TYPES) assert.match(describeCondition('requires', { requires: t }), /^Wake a .+ first/);
  assert.equal(typeof describeCondition('bogus', {}), 'string');
  assert.equal(typeof describeCondition('dwell', undefined), 'string');
  assert.equal(typeof describeCondition('requires', {}), 'string');
});

test('conditionGlyph: all glyphs', () => {
  assert.equal(conditionGlyph('approach', { approach: 'descending' }), 'DESC');
  assert.equal(conditionGlyph('approach', { approach: 'ascending' }), 'ASC');
  assert.equal(conditionGlyph('approach'), 'DESC');
  assert.equal(conditionGlyph('speed', { speed: 'slow' }), 'SLOW');
  assert.equal(conditionGlyph('speed', { speed: 'fast' }), 'RUN');
  assert.equal(conditionGlyph('dwell', { dwell: 3 }), 'WAIT');
  assert.equal(conditionGlyph('climb', { climb: 2 }), 'CLIMB');
  assert.equal(conditionGlyph('time', { time: 'dusk' }), 'DUSK');
  assert.equal(conditionGlyph('time', { time: 'night' }), 'NIGHT');
  assert.equal(conditionGlyph('time', { time: 'dawn' }), 'DAWN');
  assert.equal(conditionGlyph('time', { time: 'day' }), 'DAY');
  assert.equal(conditionGlyph('requires', { requires: 'trig' }), 'AFTER');
  assert.equal(typeof conditionGlyph('nope'), 'string');
});

test('TYPE_LABEL / TYPE_ROLE cover all eight types', () => {
  assert.equal(POI_TYPES.length, 8);
  for (const t of POI_TYPES) {
    assert.ok(TYPE_LABEL[t] && TYPE_LABEL[t] === TYPE_LABEL[t].toUpperCase(), t);
    assert.ok(TYPE_ROLE[t] && !TYPE_ROLE[t].includes('\n'), t);
  }
  assert.equal(TYPE_LABEL.trig, 'TRIG PILLAR');
  assert.equal(TYPE_LABEL.stone, 'STANDING STONE');
  assert.equal(TYPE_ROLE.bothy, 'shelter · field notes and guidance');
});
