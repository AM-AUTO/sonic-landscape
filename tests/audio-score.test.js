import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeAudio } from './helpers/fake-audio.js';
import { Game } from '../src/game/sim.js';
import { Autopilot, planChainRoute } from '../src/game/autopilot.js';
import { LEVELS } from '../src/world/levels/index.js';

const ctx = installFakeAudio();
const { createAudio, withEvents } = await import('../src/audio/index.js');

async function play(li, maxSeconds) {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 5 + li });
  const progress = { unlocked: LEVELS.slice(0, li + 1).map((l) => l.id), completed: LEVELS.slice(0, li).map((l) => l.id), fragments: LEVELS.slice(0, li).map((l) => l.id), notes: [] };
  const g = new Game({ levels: LEVELS, progress });
  g.loadLevel(li);
  const ap = new Autopilot(g.world, planChainRoute(g.world, g.level));
  audio.setLevel(g.level);
  let t = 0, merged = [], n = 0;
  const seen = new Set();
  while (t < maxSeconds) {
    g.step(ap.input(g.state), 1 / 60); t += 1 / 60; n++;
    for (const e of g.state.events) seen.add(e.type);
    merged.push(...g.state.events);
    if (n % 3 === 0) { ctx.currentTime = t; audio.update(withEvents(g.state, merged)); merged = []; }
    if (g.state.levelComplete) break;
  }
  for (let k = 0; k < 360; k++) {      // 6 s standing still: drift
    g.step({ x: 0, y: 0, run: false, rest: false }, 1 / 60); t += 1 / 60;
    if (k % 3 === 0) { ctx.currentTime = t; audio.update(withEvents(g.state, g.state.events)); }
  }
  return { audio, g, t, seen };
}

test('score plays every level through the walk without throwing, and uses the whole kit and every layer', async () => {
  for (let li = 0; li < LEVELS.length; li++) {
    const { audio, t } = await play(li, 120);
    const ins = audio.inspect();
    assert.deepEqual(audio.errors, [], LEVELS[li].id + ' update() raised');
    assert.ok(t > 30, 'walk lasted');
    const hits = ins.stats.hits, notes = ins.stats.notes;
    assert.ok(Object.keys(hits).length >= 8, LEVELS[li].id + ' kit variety ' + Object.keys(hits).join());
    for (const k of ['pad', 'bass', 'bell']) assert.ok(notes[k] > 0, LEVELS[li].id + ' ' + k);
    assert.ok((notes.lead || 0) + (notes.aLead || 0) > 0, LEVELS[li].id + ' lead voice is heard');
    assert.ok(ins.stats.chords >= 5, 'chords change with the grid');
    
    assert.ok(ins.timeline.some((e) => e.kind === 'artefact'), 'an artefact played');
    assert.equal(audio.audit().params['ch.lead.crush'] !== undefined, true);
  }
});

test('events are consumed once: an empty events array makes no contour notes', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 1 });
  const g = new Game({ levels: LEVELS, progress: { unlocked: ['rannoch'], completed: [], fragments: [], notes: [] } });
  g.loadLevel(0);
  audio.setLevel(g.level);
  for (let i = 0; i < 40; i++) { ctx.currentTime = i * 0.05; audio.update(withEvents(g.state, [])); }
  const a = audio.inspect().stats;
  assert.equal(a.ticks + a.leads, 0);
  ctx.currentTime = 2.1;
  audio.update(withEvents(g.state, [{ type: 'contour', dir: 1, index: 40, major: true, elevation: 400, speed: 5 }]));
  assert.equal(audio.inspect().stats.leads, 1);
});

test('setLevel is safe to call repeatedly and switches level cleanly', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 2 });
  audio.setLevel(LEVELS[0]); audio.setLevel(LEVELS[0]); audio.setLevel(LEVELS[3]); audio.setLevel(LEVELS[3]);
  const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: ['rannoch'], notes: [] } });
  g.loadLevel(3);
  for (let i = 0; i < 100; i++) { ctx.currentTime = i * 0.05; audio.update(withEvents(g.state, [])); }
  assert.equal(audio.score.levelId, 'cairngorm');
  audio.setMasterVolume(0.5);
  audio.dispose();
});

test('a long gap in update() skips ahead instead of bursting', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 3 });
  const g = new Game({ levels: LEVELS, progress: { unlocked: ['rannoch'], completed: [], fragments: [], notes: [] } });
  g.loadLevel(0); audio.setLevel(g.level);
  for (let i = 0; i < 40; i++) { ctx.currentTime = i * 0.05; audio.update(withEvents(g.state, [])); }
  const steps0 = audio.score.cond.stats.steps;
  ctx.currentTime = 60; audio.update(withEvents(g.state, []));
  assert.ok(audio.score.cond.stats.steps - steps0 <= 4);
  assert.equal(audio.score.cond.stats.skips, 1);
});

test('every artefact lasts 20–45 s in every level, partials ~4 s; a cut-short Apex hands the key back', async () => {
  const types = ['trig', 'cairn', 'lochan', 'waterfall', 'bothy', 'stone', 'crag', 'summit'];
  for (let li = 0; li < LEVELS.length; li++) {
    ctx.currentTime = 0;
    const audio = await createAudio(ctx, { seed: 9 });
    const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: [], notes: [] } });
    g.loadLevel(li); audio.setLevel(g.level);
    for (const ty of types) {
      ctx.currentTime += 1; audio.update(withEvents(g.state, []));
      const P = audio.score.art.play(ty, { t: ctx.currentTime });
      assert.ok(P.dur >= 20 && P.dur <= 45, `${LEVELS[li].id} ${ty} ${P.dur}`);
    }
    ctx.currentTime += 1; audio.update(withEvents(g.state, []));
    audio.score.art.pieces.length = 0;
    const Q = audio.score.art.playPartial('trig', { t: ctx.currentTime, missing: ['speed'] });
    assert.ok(Q.dur >= 3.5 && Q.dur <= 5);
  }
  // Apex lifts the key a whole tone; being interrupted must give it back
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 4 });
  const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: [], notes: [] } });
  g.loadLevel(7); audio.setLevel(g.level);
  audio.score.art.play('summit', { t: 0.1 });
  for (let i = 1; i <= 80; i++) { ctx.currentTime = i * 0.05; audio.update(withEvents(g.state, [])); }
  assert.equal(audio.score.keyShift, 2);
  assert.equal(audio.score.modeNow().join(), [0, 2, 4, 6, 7, 9, 11].join(), 'lydian at the Ben Nevis summit');
  audio.score.art.play('crag', { t: ctx.currentTime });
  assert.equal(audio.score.keyShift, 0);
  assert.equal(audio.score.modeOverride, null);
});
