import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeAudio, nonFinite } from './helpers/fake-audio.js';
import { Game } from '../src/game/sim.js';
import { Autopilot, planChainRoute } from '../src/game/autopilot.js';
import { LEVELS } from '../src/world/levels/index.js';

const ctx = installFakeAudio();
const { createAudio, withEvents } = await import('../src/audio/index.js');

async function play(li, maxSeconds, palette = null) {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 5 + li, palette });
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

// Pins updated for the grit palette (phase 2B): the bed no longer plays pads, bells, kalimba / string plucks or the clean lead
// (was: notes.pad / bass / bell > 0 and lead + aLead > 0 on every level); it plays grain clicks, contra hits, glimpses on worn
// tines and, on the reel / strathspey tracks, the arp. The old pins still hold in the legacy palette (next test).
test('score plays every level through the walk without throwing, and uses the whole kit and every palette layer', async () => {
  nonFinite.length = 0;
  for (let li = 0; li < LEVELS.length; li++) {
    const { audio, t } = await play(li, 120);
    const ins = audio.inspect(), sc = audio.score, id = LEVELS[li].id;
    assert.deepEqual(audio.errors, [], id + ' update() raised');
    assert.equal(sc.pal.palette, 'grit', 'grit is the default palette');
    assert.ok(t > 30, 'walk lasted');
    const hits = ins.stats.hits, notes = ins.stats.notes;
    assert.ok(Object.keys(hits).length >= 8, id + ' kit variety ' + Object.keys(hits).join());
    for (const k of ['pad', 'bell', 'pluck', 'lead']) assert.ok(!notes[k], `${id}: the retired ${k} is not played by the bed (${notes[k]})`);
    assert.ok((notes.grain || 0) + (notes.contraA || 0) > 0, id + ' grain clicks / contra');
    assert.ok(notes.glimpse > 0, id + ' glimpses of the ground');
    if (sc.pal.arp) assert.ok(notes.arp > 0, id + ' the arp lead'); else assert.ok(!notes.arp, id + ' pibroch: no lead at all');
    assert.ok(ins.stats.chords >= 5, 'chords change with the grid');
    assert.ok(ins.stats.captures >= 1, id + ' the eroding loop captured');
    assert.ok(sc.contraLog.length > 0, id + ' contra hits logged');
    assert.ok(ins.timeline.some((e) => e.kind === 'artefact'), 'an artefact played');
    assert.ok(ins.timeline.some((e) => e.kind === 'entry'), id + ' the grit artefact entry (crushed hit, resonator bloom, stutter)');
    assert.equal(audio.audit().params['ch.lead.crush'] !== undefined, true);
    for (const k of ['subdrone.wall', 'noisewall.level']) assert.ok(audio.audit().params[k] && audio.audit().params[k].count > 0, id + ' ' + k + ' moves');
  }
  assert.deepEqual(nonFinite, [], 'no non-finite value was scheduled on any AudioParam');
});

test('the legacy palette switch still plays the old palette (pads, bells, plucks, the clean lead) and no palette layer', async () => {
  for (const li of [0, 2, 5]) {
    const { audio } = await play(li, 90, 'legacy');
    const ins = audio.inspect(), sc = audio.score, notes = ins.stats.notes, id = LEVELS[li].id;
    assert.deepEqual(audio.errors, [], id + ' update() raised');
    assert.equal(sc.pal.palette, 'legacy');
    for (const k of ['pad', 'bass', 'bell']) assert.ok(notes[k] > 0, id + ' ' + k);
    assert.ok((notes.lead || 0) + (notes.aLead || 0) > 0, id + ' lead voice is heard');
    for (const k of ['grain', 'arp', 'glimpse', 'contraA', 'contraB']) assert.ok(!notes[k], id + ' no ' + k);
    assert.equal(sc.contraLog.length, 0);
    assert.equal(sc.stage.g, null, 'the palette voices are never made');
    for (const k of ['sub', 'wall', 'res', 'erode', 'arp', 'contraA']) assert.equal(sc.arr.layers[k], 0, 'layer ' + k + ' off');
  }
});

test('events are consumed once: an empty events array makes no contour notes', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 1 });
  const g = new Game({ levels: LEVELS, progress: { unlocked: ['corryvreckan'], completed: [], fragments: [], notes: [] } });
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
  const CG = LEVELS.findIndex((l) => l.id === 'cairngorm');
  audio.setLevel(LEVELS[0]); audio.setLevel(LEVELS[0]); audio.setLevel(LEVELS[CG]); audio.setLevel(LEVELS[CG]);
  const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: ['rannoch'], notes: [] } });
  g.loadLevel(CG);
  for (let i = 0; i < 100; i++) { ctx.currentTime = i * 0.05; audio.update(withEvents(g.state, [])); }
  assert.equal(audio.score.levelId, 'cairngorm');
  audio.setMasterVolume(0.5);
  audio.dispose();
});

test('a long gap in update() skips ahead instead of bursting', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 3 });
  const g = new Game({ levels: LEVELS, progress: { unlocked: ['corryvreckan'], completed: [], fragments: [], notes: [] } });
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

test('back-to-back artefacts release the previous piece over a few seconds (no hard cut) and never leave a non-finite control', async () => {
  const types = ['trig', 'cairn', 'lochan', 'waterfall', 'bothy', 'stone', 'crag', 'summit'];
  for (const li of [1, 4, 7]) {
    ctx.currentTime = 0;
    const audio = await createAudio(ctx, { seed: 21 });
    const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: [], notes: [] } });
    g.loadLevel(li); audio.setLevel(g.level);
    const art = audio.score.art;
    for (let i = 0; i < types.length; i++) {
      ctx.currentTime += 0.5; audio.update(withEvents(g.state, []));
      const prev = art.pieces.filter((p) => !p.ended && !p.fade && p.kind === 'artefact');
      art.play(types[i], { t: ctx.currentTime });
      if (prev.length) {
        assert.ok(prev.every((p) => p.fade && !p.ended), 'the previous piece is releasing, not cut');
        assert.equal(art.activeCount, 1, 'only the new piece counts as sounding');
      }
      for (let k = 0; k < 140; k++) {                 // 7 s of audio time per piece: the release ends, the new piece plays on
        ctx.currentTime += 0.05; audio.update(withEvents(g.state, []));
        const A = art.cached || {};
        for (const key of ['energy', 'energyFloor', 'energyMax', 'frontGain', 'reverbWet']) if (A[key] !== undefined) assert.ok(Number.isFinite(A[key]), `${key} finite (${types[i]})`);
        assert.ok(Number.isFinite(audio.score.cond.energy), 'energy finite');
      }
      assert.ok(art.pieces.every((p) => !p.fade), 'releases finished');
    }
    assert.deepEqual(audio.errors, []);
  }
});

test('pre-warming makes the expensive buffers ahead of need: the queue drains a few items at a time and nothing is made at trigger time', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 31, palette: 'legacy' });          // the KS pluck pre-warm is the legacy palette's
  const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: [], notes: [] } });
  g.loadLevel(LEVELS.findIndex((l) => l.id === 'cairngorm')); audio.setLevel(g.level);   // cairngorm: harp plucks
  const sc = audio.score;
  audio.update(withEvents(g.state, []));
  const n0 = sc.warmQ.length;
  assert.ok(n0 > 15, 'a queue of buffers to make');
  ctx.currentTime += 0.05; audio.update(withEvents(g.state, []));
  assert.ok(sc.warmQ.length >= n0 - 1, 'at most one item per update');
  for (let i = 0; i < 1200 && sc.warmQ.length; i++) { ctx.currentTime += 0.05; audio.update(withEvents(g.state, [])); }
  assert.equal(sc.warmQ.length, 0, 'the queue drains');
  assert.ok(audio.engine.pluckCache.size >= 10, 'KS buffers are cached for the level');
  const tex = sc.stage.v.texture;
  assert.ok(tex.crackleBufs && tex.crackleBufs[0] && tex.crackleBufs[1], 'crackle buffers made ahead');
  // a note in the level's scale is then served from the cache
  const before = audio.engine.pluckCache.size;
  sc.stage.v.pluck.note(sc.profile.lead.base + sc.profile.mode[2], ctx.currentTime + 0.1, 1, 0.5);
  assert.equal(audio.engine.pluckCache.size, before, 'no buffer synthesised at trigger time');
});

test('grit pre-warming: the eroding loop, grains, metal, scrapes, dust and the glimpse tines are rendered ahead, one item per tick', async () => {
  for (const native of [true, false]) {
    ctx.currentTime = 0;
    const audio = await createAudio(ctx, { seed: 32 });
    if (!native) { audio.engine.erode = null; audio.engine.res = null; }             // no 2A worklets: the JS fallbacks
    const g = new Game({ levels: LEVELS, progress: { unlocked: LEVELS.map((l) => l.id), completed: [], fragments: [], notes: [] } });
    g.loadLevel(LEVELS.findIndex((l) => l.id === 'coe')); audio.setLevel(g.level);
    const sc = audio.score;
    audio.update(withEvents(g.state, []));
    const n0 = sc.warmQ.length;
    assert.ok(n0 > 15, 'a queue of buffers to make');
    for (let i = 0; i < 1500 && sc.warmQ.length; i++) { ctx.currentTime += 0.05; audio.update(withEvents(g.state, [])); }
    assert.equal(sc.warmQ.length, 0, 'the queue drains');
    const G = sc.stage.g;
    assert.ok(G.erode.material && G.erode.ready, 'the played source and its eroded passes');
    assert.equal(G.erode.native, native);
    assert.ok(G.grain.ready && G.grain.metals.length === 2 && G.grain.slices.length > 0 && G.grain.swellBuf, 'grains, metal, slices, the reverse swell');
    assert.ok(G.wall.scrapes.length >= 4 && G.wall.dustBuf, 'scrapes and dust');
    for (const n of sc.pal.ground) assert.ok(G.glimpse.has(n.midi - 12, n.grace === null ? null : n.grace - 12), 'tine ' + n.midi);
    const size = G.glimpse.cache.size;
    sc.band.glimpse(ctx.currentTime + 0.1, 1);
    assert.equal(G.glimpse.cache.size, size, 'no tine rendered at trigger time');
    assert.deepEqual(audio.errors, []);
  }
});

// ------------------------------------------------------------------------------------------------
// stanza form in the score
// ------------------------------------------------------------------------------------------------
/** record every scheduled step (time, bar, stanza) and every full / partial piece the score starts */
function recordForm(audio) {
  const sc = audio.score, c = sc.cond;
  const steps = new Map();
  const onStep = c.hooks.onStep;
  c.hooks.onStep = (s) => { steps.set(s.step, s); onStep(s); };
  const pieces = [];
  for (const m of ['play', 'playPartial']) {
    const orig = sc.art[m].bind(sc.art);
    sc.art[m] = (...a) => { const P = orig(...a); if (P) pieces.push(P); return P; };
  }
  const hits = [];
  const kit = sc.stage.v.kit, origHit = kit.hit.bind(kit);
  kit.hit = (name, t, ...rest) => { hits.push({ name, t }); return origHit(name, t, ...rest); };
  return { steps, pieces, hits };
}
const near = (list, t, tol) => list.some((x) => Math.abs(x - t) <= tol);

test('stanza form in real play: sections, arrangement changes and mode switches on stanza downbeats; pieces on bar lines; acknowledgements within a 16th', async () => {
  for (const id of ['lyon', 'coe']) {                         // a two-bar and a four-bar stanza level
    const li = LEVELS.findIndex((l) => l.id === id);
    ctx.currentTime = 0;
    const audio = await createAudio(ctx, { seed: 5 + li });
    const progress = { unlocked: LEVELS.slice(0, li + 1).map((l) => l.id), completed: LEVELS.slice(0, li).map((l) => l.id), fragments: LEVELS.slice(0, li).map((l) => l.id), notes: [] };
    const g = new Game({ levels: LEVELS, progress });
    g.loadLevel(li);
    const ap = new Autopilot(g.world, planChainRoute(g.world, g.level));
    audio.setLevel(g.level);
    const R = recordForm(audio);
    const sc = audio.score, c = sc.cond;
    let t = 0, merged = [], n = 0, doneT = null;
    while (t < 200) {
      g.step(doneT === null ? ap.input(g.state) : { x: 0, y: 0, run: false, rest: false }, 1 / 60); t += 1 / 60; n++;
      merged.push(...g.state.events);
      if (n % 3 === 0) { ctx.currentTime = t; audio.update(withEvents(g.state, merged)); merged = []; }
      if (g.state.levelComplete && doneT === null) doneT = t;
      if (doneT !== null && t > doneT + 30) break;
    }
    assert.deepEqual(audio.errors, []);
    assert.equal(c.stanzaBars, sc.profile.stanzaBars);
    const all = [...R.steps.values()];
    const downbeats = all.filter((s) => s.isStanzaStart).map((s) => s.t);
    const barLines = all.filter((s) => s.i16 === 0).map((s) => s.t);
    const beats = all.filter((s) => s.i16 % 4 === 0).map((s) => s.t);
    const sd = c.stepDur, eps = 1e-3;
    assert.ok(downbeats.length > 8, id + ' stanzas');
    const tl = sc.timeline;
    const secs = tl.filter((e) => e.kind === 'section');
    assert.ok(secs.length >= 2, id + ' sections change');
    for (const e of secs) assert.ok(near(downbeats, e.at, eps), `${id} section ${e.from}->${e.to} at ${e.at} is on a stanza downbeat`);
    assert.ok(sc.form.changes.length >= secs.length);
    for (const ch of sc.form.changes) assert.ok(near(downbeats, ch.at, eps), `${id} arrangement change ${ch.what} at ${ch.at}`);
    for (const e of tl.filter((x) => x.kind === 'mode')) assert.ok(near(downbeats, e.at, eps), `${id} mode switch at ${e.at}`);
    // the plan comes a bar ahead of the downbeat it plans
    for (const e of tl.filter((x) => x.kind === 'plan' && !x.replan)) assert.ok(Math.abs(e.at - e.t - c.barDur) < c.barDur * 0.6, 'planned in the last bar');
    // ghost fragments on bar 2 of a stanza (the second bar of a two-bar one)
    for (const e of tl.filter((x) => x.kind === 'ghost')) assert.equal(e.bar, Math.min(2, c.stanzaBars - 1));
    // artefact pieces start on bar lines (exactly the step time, after re-anchoring), partials on beats; each was acknowledged within a 16th
    const full = R.pieces.filter((p) => p.kind === 'artefact');
    assert.ok(full.length >= 2, id + ' artefacts played');
    for (const p of full) {
      assert.equal(p.startStep % 16, 0, 'a bar line');
      assert.ok(Math.abs(R.steps.get(p.startStep).t - p.t0) < 1e-9, `${id} ${p.type} t0 ${p.t0} = the bar's step time`);
      assert.ok(p.t0 - p.firedAt <= c.barDur + sd + 0.02 && p.t0 >= p.firedAt, 'within a bar of firing');
    }
    for (const p of R.pieces.filter((x) => x.kind === 'partial')) { assert.equal(p.startStep % 4, 0, 'partial on a beat'); assert.ok(near(beats, p.t0, 1e-9)); }
    const acks = tl.filter((e) => e.kind === 'ack');
    assert.ok(acks.length >= full.length, 'every firing acknowledged');
    for (const a of acks) assert.ok(a.at - a.t <= sd + 0.06 && a.at >= a.t - 1e-6, `${id} ack ${a.type} ${a.at - a.t} s after firing (one 16th = ${sd.toFixed(3)})`);
    // cadence / finale on bar lines (prompt), within a bar of being acknowledged
    const fin = tl.filter((e) => (e.kind === 'finale' || e.kind === 'cadence') && e.at !== undefined);
    assert.ok(fin.some((e) => e.kind === 'finale'), id + ' finale');
    for (const e of fin) {
      assert.ok(near(barLines, e.at, eps), `${id} ${e.kind} at ${e.at} on a bar line`);
      const a = acks.filter((x) => x.type === e.kind && x.at <= e.at + eps).pop();
      if (a) assert.ok(e.at - a.at <= c.barDur + sd + 0.02, `${id} ${e.kind} within a bar of its acknowledgement`);
    }
  }
});

test('splash and slide land on the 16th grid; an arrangement layer ramps over one beat from its downbeat, never before', async () => {
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 12 });
  const g = new Game({ levels: LEVELS, progress: { unlocked: ['corryvreckan'], completed: [], fragments: [], notes: [] } });
  g.loadLevel(0); audio.setLevel(g.level);
  const R = recordForm(audio);
  const sc = audio.score, c = sc.cond;
  for (let i = 0; i < 40; i++) { ctx.currentTime = i * 0.05; audio.update(withEvents(g.state, [])); }
  const fired = [];
  for (let i = 40; i < 200; i++) {
    ctx.currentTime = i * 0.05 + 0.013 * (i % 3);              // events arrive off the grid
    const ev = i % 23 === 0 ? [{ type: 'splash' }] : i % 37 === 0 ? [{ type: 'slide-start' }] : [];
    if (ev.length) fired.push([ev[0].type, ctx.currentTime]);
    audio.update(withEvents(g.state, ev));
  }
  const grid = [...R.steps.values()].map((s) => s.t);
  const logged = sc.timeline.filter((e) => e.kind === 'splash' || e.kind === 'slide');
  assert.ok(logged.length >= 6, 'splashes and slides sounded ' + logged.length);
  for (const e of logged) {
    assert.ok(near(grid, e.at, 2e-3), `${e.kind} at ${e.at} is on a 16th`);
    assert.ok(R.hits.some((h) => (h.name === 'shaker' || h.name === 'breath') && Math.abs(h.t - e.at) < 2e-3), 'and its sound is there');
    assert.ok(e.at >= e.t - 1e-6 && e.at - e.t <= c.stepDur + 0.02, `${e.kind} lands within one 16th of the event`);
  }
  assert.ok(fired.length >= logged.length);
  // layer ramp: from the downbeat, over a beat
  const T = ctx.currentTime + 1, b = sc.beat();
  sc.arr = { ...sc.arr, layers: { ...sc.arr.layers, bass: 0 } }; sc.layerRamp = null;
  sc.arrPlan = { ...sc.arr, stanza: 99, section: 'flow', kitSection: 'flow', layers: { ...sc.arr.layers, bass: 1 } };
  sc._onStanza({ stanza: 99, t: T, step: c.stanzaStep(99), section: 'flow', planned: true });
  assert.equal(sc._layersAt(T - 0.05).bass, 0, 'not before the downbeat');
  assert.ok(Math.abs(sc._layersAt(T + b / 2).bass - 0.5) < 1e-6, 'half way through the beat');
  assert.equal(sc._layersAt(T + b + 0.01).bass, 1);
  assert.ok(sc.form.changes.some((x) => x.stanza === 99 && x.what.includes('bass+')));
});
