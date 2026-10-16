// The grit palette (phase 2B): palette fields and defaults, the arrangement planner, the new voices under fake audio,
// palette layers changing only on stanza downbeats, and the contra layers' two periods.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeAudio, nonFinite } from './helpers/fake-audio.js';
import { Game } from '../src/game/sim.js';
import { Autopilot, planChainRoute } from '../src/game/autopilot.js';
import { LEVELS } from '../src/world/levels/index.js';
import { GROUNDS } from '../tools/write-grounds.mjs';
import { paletteFor, planGrit, parseGround, GROUND_NOTES, GRIT_LAYERS, dirtyKitPatch, gritKitGens, formStepOf } from '../src/audio/palette.js';
import { PROFILES, kitGens, patchesFor } from '../src/audio/levelmusic.js';

const ctx = installFakeAudio();
const { createAudio, withEvents } = await import('../src/audio/index.js');
const { createEngine } = await import('../src/audio/engine.js');
const { SubDrone } = await import('../src/audio/voices/subdrone.js');
const { NoiseWall } = await import('../src/audio/voices/noisewall.js');
const { ResPad } = await import('../src/audio/voices/respad.js');
const { ErodeLoop } = await import('../src/audio/voices/erode.js');
const { Grain } = await import('../src/audio/voices/grain.js');
const { Arp } = await import('../src/audio/voices/arp.js');
const { Glimpse } = await import('../src/audio/voices/glimpse.js');
const { LAYERS } = await import('../src/audio/score.js');

// a pre-warm item returns false until it is done (sliced work, or its input does not exist yet): run each to completion
const drain = (items) => { for (const f of items) { let k = 0; while (f() === false && k++ < 20000) { /* sliced: call again */ } } };

test('palette fields: defaults per track, the grounds equal tools/write-grounds.mjs, the legacy switch', () => {
  const ids = { corryvreckan: '1-corryvreckan', cruachan: '2-cruachan', lyon: '3-lyon', rannoch: '4-rannoch', cairngorm: '5-cairngorm', coe: '6-coe', cuillin: '7-cuillin', nevis: '8-nevis' };
  for (const [id, gk] of Object.entries(ids)) assert.equal(GROUND_NOTES[id], GROUNDS[gk].notes, id + ' ground');
  assert.equal(GROUND_NOTES.album, GROUNDS.album.notes);
  const coe = paletteFor(PROFILES.coe), lyon = paletteFor(PROFILES.lyon), cru = paletteFor(PROFILES.cruachan);
  assert.equal(coe.palette, 'grit'); assert.equal(coe.time, 'reel'); assert.equal(coe.arp, true);
  assert.deepEqual([coe.contra.A.period, coe.contra.B.period], [3, 5], 'reel: 3 and 5 sixteenths against 4');
  assert.equal(lyon.time, 'pibroch'); assert.equal(lyon.arp, false, 'pibroch tracks have no lead');
  assert.deepEqual([lyon.contra.A.period, lyon.contra.B.period], [12, 20], 'pibroch: 3 and 5 beats against 4');
  assert.equal(cru.time, 'strathspey'); assert.deepEqual(cru.contra.A.offsets, [0, 1], 'strathspey: the snap (0.25 / 0.75)');
  assert.equal(paletteFor(PROFILES.coe, 'legacy').palette, 'legacy');
  assert.equal(paletteFor({ ...PROFILES.coe, palette: 'legacy' }).grit, false, 'profile field');
  assert.equal(paletteFor({ ...PROFILES.coe, contra: { A: { period: 7 } } }).contra.A.period, 7, 'profile override of a field');
  // the ground follows the level root (A4 → root + 12); the drone root keeps the root–fifth (A–E) relationship
  assert.equal(coe.ground[0].midi, PROFILES.coe.root + 12 + 7, 'coe opens on E5 over an A root');
  assert.equal(((coe.droneRoot - PROFILES.coe.root) % 12 + 12) % 12, 0);
  for (const id of Object.keys(PROFILES)) { const p = paletteFor(PROFILES[id]); assert.ok(p.ground.length >= 4 && p.ground.every((n) => Number.isFinite(n.midi)), id); }
  const g = parseGround("A4 2 g, r 1, C#5 1 '");
  assert.deepEqual(g.map((n) => n.iv), [0, null, 4]); assert.equal(g[0].grace, 10, 'G5 grace'); assert.equal(g[2].grace, 5, 'cut: D5');
  assert.equal(formStepOf({ chainProgress: [{}, {}, {}] }, 0), 0);
  assert.equal(formStepOf({ chainProgress: [{}, {}, {}] }, 2), 2);
  assert.equal(formStepOf({ chainProgress: [{}, {}, {}], gateOpen: true }, 3), 4);
  assert.equal(formStepOf({ chainProgress: [], levelComplete: true }, 0), 5);
});

test('arrangement planner: ebb sparse, flow grooves, swell walls and surges, drift drops hard, night darkens, pibroch has no arp', () => {
  const coe = paletteFor(PROFILES.coe), lyon = paletteFor(PROFILES.lyon);
  const P = (o) => planGrit({ pal: coe, section: 'ebb', kitSection: 'ebb', drift: 0, energy: 0.4, kit: 1, stanza: 2, prev: { formStep: 0, captured: true, drift: 0, section: 'ebb' }, ...o });
  const ebb = P({}), flow = P({ section: 'flow', kitSection: 'flow' }), swell = P({ section: 'swell', kitSection: 'swell', swellRun: 0 });
  for (const k of GRIT_LAYERS) for (const r of [ebb, flow, swell]) assert.ok(r.layers[k] >= 0 && r.layers[k] <= 1, k);
  assert.ok(ebb.layers.sub > 0.9 && ebb.layers.res > 0.9 && ebb.layers.erode > 0 && ebb.layers.erode < 0.7, 'ebb: drone + sub + res + a sparse loop');
  for (const k of ['grain', 'contraA', 'contraB', 'arp']) assert.equal(ebb.layers[k], 0, 'ebb: no ' + k);
  for (const k of ['grain', 'contraA', 'arp']) assert.ok(flow.layers[k] > 0.5, 'flow: ' + k);
  assert.equal(flow.layers.contraB, 0);
  assert.ok(swell.layers.wall > flow.layers.wall && swell.layers.contraB > 0.5, 'swell: the wall up, contra B');
  assert.ok(swell.flags.contraSurge, 'the first swell stanza surges');
  assert.ok(!P({ section: 'swell', kitSection: 'swell', swellRun: 1 }).flags.contraSurge, 'not every swell stanza');
  const drift = P({ section: 'flow', kitSection: 'flow', drift: 0.8, prev: { formStep: 0, captured: true, drift: 0, section: 'flow' } });
  assert.deepEqual(['sub', 'res', 'erode'].filter((k) => drift.layers[k] > 0.5), ['sub', 'res', 'erode']);
  for (const k of ['wall', 'grain', 'contraA', 'contraB', 'arp', 'scrape', 'glimpse']) assert.equal(drift.layers[k], 0, 'drift drops ' + k);
  assert.ok(drift.flags.cut, 'drift arriving is a hard cut');
  const night = P({ section: 'swell', kitSection: 'swell', night: true });
  assert.ok(night.layers.wall < swell.layers.wall && night.flags.dark === 1, 'night: a darker, lower wall');
  assert.equal(planGrit({ pal: lyon, section: 'swell', kitSection: 'swell', energy: 0.8, stanza: 1, prev: null }).layers.arp, 0, 'pibroch: no arp');
  for (const k of ['pad', 'bell', 'pluck', 'lead']) assert.equal(ebb.layers[k], 0, 'retired: ' + k);
  // glimpses on chosen stanzas; the eroding loop re-captures on a form step
  assert.ok(P({ stanza: 1 }).flags.glimpse && !P({ stanza: 2 }).flags.glimpse);
  const step = P({ formStep: 1 });
  assert.ok(step.flags.glimpse && step.flags.erodeCapture, 'a form step: glimpse + re-capture');
  assert.ok(!P({}).flags.erodeCapture, 'no re-capture without one');
  assert.ok(P({ section: 'ebb', prev: { formStep: 0, captured: true, drift: 0, section: 'swell' } }).flags.cut, 'swell straight to ebb is a hard cut');
  // the dirty kit keeps each level's own values (multipliers), the broken kit has no ride and no backbeat snare
  const kp = patchesFor(PROFILES.coe).kit, d = dirtyKitPatch(kp);
  assert.ok(d.kickDecay < kp.kickDecay && d.snareNoise > kp.snareNoise && d.hatDecay < kp.hatDecay);
  const gens = gritKitGens(kitGens(PROFILES.coe));
  assert.equal(gens.find((g) => g.h === 'ride').favour, 0);
  for (const g of gens.filter((x) => x.h === 'snare')) for (const s of ['flow', 'swell']) if (g[s] && g[s].rot) assert.ok(!g[s].rot.includes(4), 'snare off the backbeat');
});

test('the palette voices construct and schedule under fake audio without a non-finite value', async () => {
  nonFinite.length = 0;
  ctx.currentTime = 0;
  const engine = await createEngine(ctx, { seed: 3 });
  for (const native of [false, true]) {
    if (!native) { engine.erode = null; engine.res = null; }
    else { engine.erode = { captured: [], input: new GainNode(ctx), captureAt(t, s, o) { this.captured.push([t, s, o]); }, set() {} }; engine.res = { calls: [], setTargets(x, g, t) { this.calls.push([x, g, t]); } }; }
    const ch = (n) => engine.channel('pal-' + n + native, { gain: 0.5 });
    const sub = new SubDrone(engine, { sub: ch('sub'), beat: ch('beat') }).start(0.1);
    sub.setRoot(45, 0.2, 3); sub.set({ sub: 0.6, beat: 0.4, wall: 0.9, dark: 1 }, 0.3); sub.set({ wall: NaN }, 0.4);
    const wall = new NoiseWall(engine, ch('noise')).start(0.1);
    drain(wall.warmItems(7)); wall.set({ wall: 0.7, scrape: 0.5, dark: 0.5 }, 0.5);
    let fired = 0; for (let i = 0; i < 40; i++) fired += wall.scrapeStep(1 + i * 0.25, 0.9, engine.rng) ? 1 : 0;
    assert.ok(fired > 0, 'scrapes fire');
    const res = new ResPad(engine, ch('res')).start(0.1);
    assert.equal(res.native, native);
    res.setTargets([{ f: 220, g: 0.97, gain: 0.4 }, { f: 330, g: 0.93, gain: 0.2 }, { f: NaN, g: 0.9, gain: 1 }], 0.5, 0.6);
    assert.equal(res.targets.length, 2, 'a non-finite target is dropped');
    res.setLevel(0.8, 0.7, 0.5); res.bloom(1, 2.5, 4);
    if (native) assert.ok(engine.res.calls.length >= 2 && engine.res.calls.every(([x]) => x.every((y) => Number.isFinite(y.gain) && y.gain <= 4)), 'drives engine.res');
    const er = new ErodeLoop(engine, ch('erode'));
    drain(er.warmItems(5, { source: 'pluck', barSec: 2.6 }));
    assert.ok(er.material && er.material.length > 0 && er.ready);
    assert.ok(er.capture(2, 2.6, 4, 2));
    if (native) assert.equal(engine.erode.captured.length, 1, 'captured by engine.erode');
    else { let n = 0; for (let b = 0; b < 12; b++) n += er.onBar(2 + b * 2.6, 2.6, 1) ? 1 : 0; assert.equal(n, 12); assert.ok(er.age === 1, 'fully worn after ageStanzas'); }
    const er2 = new ErodeLoop(engine, ch('erode2'));
    drain(er2.warmItems(5, { source: 'tine', notes: [{ midi: 69, beats: 2 }, { midi: 73, beats: 1 }], beat: 0.9, barSec: 3.6 }));
    assert.ok(er2.material.some((v) => v !== 0), 'tine source rendered');
    const gr = new Grain(engine, ch('grain'));
    drain(gr.warmItems(9, { metalMidi: 76, material: () => er.material }));
    assert.ok(gr.click(3, 0.5, 0.3) && gr.metal(3.1, 0.4) && gr.stutter(5, 0.12, 4, 0.5) && gr.swell(6, 1.5, 0.5));
    assert.equal(gr.stutter(5, 0.12, 4, 0.5, gr.dest, null) && true, true);
    const arp = new Arp(engine, ch('arp')).start(0.1);
    for (let i = 0; i < 16; i++) arp.note(40 + (i % 5), 1 + i * 0.16, 0.12, i % 5 === 0 ? 1 : 0.55, i / 16);
    arp.note(NaN, 4, NaN, NaN, NaN);
    const gl = new Glimpse(engine, ch('glimpse'));
    drain(gl.warmItems(4, [{ midi: 57, grace: 67 }, { midi: 64, grace: null }]));
    assert.ok(gl.has(57, 67) && gl.has(64));
    assert.equal(gl.phrase([{ midi: 57, grace: 67 }, { midi: 64, grace: null }, { midi: NaN }], 5, 0.5, 0.3), 2);
    for (const v of [sub, wall, res, arp]) v.stop(8);
  }
  assert.deepEqual(nonFinite, [], 'no NaN reached an AudioParam');
});

/** play a level with the autopilot, then stand still (drift); record every scheduled step and the arrangement at each */
async function playLevel(id, seconds, opts = {}) {
  const li = LEVELS.findIndex((l) => l.id === id);
  ctx.currentTime = 0;
  const audio = await createAudio(ctx, { seed: 5 + li });
  if (opts.noWorklets) { audio.engine.erode = null; audio.engine.res = null; }
  const progress = { unlocked: LEVELS.slice(0, li + 1).map((l) => l.id), completed: LEVELS.slice(0, li).map((l) => l.id), fragments: LEVELS.slice(0, li).map((l) => l.id), notes: [] };
  const g = new Game({ levels: LEVELS, progress }); g.loadLevel(li);
  const ap = new Autopilot(g.world, planChainRoute(g.world, g.level));
  audio.setLevel(g.level);
  const sc = audio.score, c = sc.cond;
  const steps = [], offGrid = [];
  let lastKey = null;
  const onStep = c.hooks.onStep;
  c.hooks.onStep = (s) => {
    const key = JSON.stringify(sc.arr.layers) + sc.arr.contraSurge + sc.arr.dark;
    if (lastKey !== null && key !== lastKey && !s.isStanzaStart) offGrid.push({ t: s.t, step: s.step });
    lastKey = key;
    steps.push(s);
    onStep(s);
  };
  let t = 0, merged = [], n = 0;
  while (t < seconds) {
    g.step(ap.input(g.state), 1 / 60); t += 1 / 60; n++;
    merged.push(...g.state.events);
    if (n % 3 === 0) { ctx.currentTime = t; audio.update(withEvents(g.state, merged)); merged = []; }
    if (g.state.levelComplete) break;
  }
  for (let k = 0; k < 900; k++) {
    g.step({ x: 0, y: 0, run: false, rest: false }, 1 / 60); t += 1 / 60;
    if (k % 3 === 0) { ctx.currentTime = t; audio.update(withEvents(g.state, g.state.events)); }
  }
  return { audio, sc, c, steps, offGrid };
}

test('palette layers change only on stanza downbeats (ramped over a beat, cut in 50 ms), and every palette change is logged on one', async () => {
  for (const [id, noWorklets] of [['coe', false], ['lyon', true]]) {
    const { audio, sc, c, steps, offGrid } = await playLevel(id, 150, { noWorklets });
    assert.deepEqual(audio.errors, []);
    assert.deepEqual(offGrid, [], `${id}: the arrangement changed off a stanza downbeat`);
    const down = steps.filter((s) => s.isStanzaStart).map((s) => s.t);
    const changes = sc.form.changes.filter((x) => x.what.some((w) => GRIT_LAYERS.some((k) => w.startsWith(k)) || ['surge', 'capture', 'cut', 'glimpse'].includes(w)));
    assert.ok(changes.length >= 3, id + ' palette changes happened: ' + changes.length);
    for (const ch of changes) assert.ok(down.some((d) => Math.abs(d - ch.at) < 1e-3), `${id} ${ch.what} at ${ch.at}`);
    for (const k of GRIT_LAYERS) assert.ok(LAYERS.includes(k), 'score LAYERS carries ' + k);
    // the layer ramp: between a beat after the downbeat and the next downbeat, the layers are the committed arrangement
    const R = sc.layerRamp;
    const mid = sc._layersAt(R.t0 + R.dur + 0.01);
    for (const k of GRIT_LAYERS) assert.ok(Math.abs(mid[k] - sc.arr.layers[k]) < 1e-9, k);
    // a hard cut: what falls is down 50 ms after the downbeat, what rises still ramps over the beat
    sc.layerRamp = { from: { ...sc.arr.layers, wall: 1, res: 0 }, to: { ...sc.arr.layers, wall: 0, res: 1 }, t0: 100, dur: 0.8, cut: true };
    assert.equal(sc._layersAt(99.99).wall, 1); assert.equal(sc._layersAt(100.06).wall, 0);
    assert.ok(Math.abs(sc._layersAt(100.4).res - 0.5) < 1e-9);
    assert.ok(sc.stats.glimpses >= 2 && sc.stats.captures >= 1, id + ' glimpses and captures');
    assert.ok(sc.timeline.filter((e) => e.kind === 'glimpse').every((e) => down.some((d) => Math.abs(d - e.at) < 1e-3)), id + ' glimpses on stanza downbeats');
    assert.ok(sc.timeline.filter((e) => e.kind === 'capture').every((e) => down.some((d) => Math.abs(d - e.at) < 1e-3)), id + ' captures on stanza downbeats');
    assert.ok(c.stats.stanzas > 6);
  }
});

test('contra layers: two periods against the beat in score.contraLog (reel 3 / 5 sixteenths; strathspey snap / 5; pibroch 3 / 5 beats), surging on chosen stanzas', async () => {
  const want = { coe: [0.75, 1.25], cruachan: [1, 1.25], lyon: [3, 5] };
  for (const id of Object.keys(want)) {
    const { audio, sc } = await playLevel(id, 200);
    assert.deepEqual(audio.errors, []);
    const log = sc.contraLog;
    assert.ok(log.length > 10, id + ' contra hits');
    assert.ok(log.every((e) => (e.layer === 'A' || e.layer === 'B') && Number.isFinite(e.t) && Number.isFinite(e.period)));
    const periods = [...new Set(log.map((e) => e.period))].sort((a, b) => a - b);
    assert.deepEqual(periods, want[id], id + ' two periods ' + periods.join(' / '));
    // the hits really sit on those periods: within each layer, every step distance is a whole number of cycles (offsets included)
    for (const L of ['A', 'B']) {
      const c = sc.pal.contra[L], st = log.filter((e) => e.layer === L).map((e) => e.step);
      if (st.length < 3) continue;
      const span = c.offsets.length > 1 ? c.period : 0;
      for (let i = 1; i < st.length; i++) {
        const d = st[i] - st[i - 1];
        if (d > 4 * c.period) continue;                     // a gap (the layer was off): the cycle restarts on its downbeat
        if (span) assert.ok(d % c.period === 1 || d % c.period === c.period - 1 || d % c.period === 0, `${id} ${L} snap distance ${d}`);
        else assert.equal(d % c.period, 0, `${id} ${L} distance ${d} on a ${c.period}-sixteenth cycle`);
      }
    }
    assert.ok(sc.stats.surges >= 1, id + ' a contra surge happened');
    const surged = sc.form.changes.filter((x) => x.what.includes('surge'));
    assert.ok(surged.length >= 1);
  }
});
