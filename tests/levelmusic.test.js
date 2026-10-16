import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, LEVEL_IDS, patchesFor, VOICE_DEFAULTS, motifFor, tonicTriadPcs, kitGens, channelBase, CHANNEL_NAMES, textureFor, COVER_KEYS } from '../src/audio/levelmusic.js';
import { LEVELS } from '../src/world/levels/index.js';
import { pickChordIndex, chordTones, voiceChord, droneNotes, rootTriad, pc } from '../src/audio/harmony.js';
import { euclid, Conductor, PatternGen, MelodyMarkov, sectionFor } from '../src/audio/conductor.js';
import { Rng } from '../src/core/rng.js';

// corryvreckan / cruachan / lyon borrow the old assynt / affric / torridon profiles verbatim until the sonic round
const ROOT_PC = { corryvreckan: 3, cruachan: 7, lyon: 0, rannoch: 2, cairngorm: 4, coe: 9, cuillin: 6, nevis: 2 };
const BPM = { corryvreckan: 60, cruachan: 72, lyon: 68, rannoch: 64, cairngorm: 56, coe: 76, cuillin: 84, nevis: 70 };
// stanza length in bars: the pibroch-leaning tracks move in two-bar stanzas, the rest in four
const STANZA = { corryvreckan: 4, cruachan: 4, lyon: 2, rannoch: 2, cairngorm: 2, coe: 4, cuillin: 4, nevis: 4 };

test('one profile per level, roots and tempi follow the design (Eb G C D E A F# D)', () => {
  assert.deepEqual(LEVEL_IDS, LEVELS.map((l) => l.id));
  for (const l of LEVELS) {
    const p = PROFILES[l.id];
    assert.ok(p, l.id);
    assert.equal(p.root % 12, ROOT_PC[l.id], l.id + ' root');
    assert.equal(p.bpm, BPM[l.id], l.id + ' bpm');
    assert.ok(p.chords.length >= 6, 'chord vocabulary');
    for (const c of p.chords) { assert.ok(c.w > 0); assert.ok(c.steps.length >= 2); }
    assert.ok(p.mode.length >= 5 && p.dawn.length >= 5 && p.night.length >= 5);
    assert.equal(tonicTriadPcs(p)[0], ROOT_PC[l.id]);
    assert.equal(p.stanzaBars, STANZA[l.id], l.id + ' stanzaBars');
  }
});

test('the eight levels are genuinely different', () => {
  const sig = (p) => JSON.stringify([p.root, p.mode, p.bpm, p.lead.patch.wave1, p.kit.favour]);
  assert.equal(new Set(LEVEL_IDS.map((id) => sig(PROFILES[id]))).size, 8);
  const ops = new Set(LEVEL_IDS.map((id) => PROFILES[id].motifOp));
  assert.ok(ops.size >= 7);
});

test('motif transforms: nevis plays the motif whole', () => {
  assert.deepEqual(motifFor('nevis').degrees, [0, 2, 4, 1, 3]);
  assert.deepEqual(motifFor('rannoch').degrees, [0, -2, -4, -1, -3]);
  assert.deepEqual(motifFor('cairngorm').durations, [2, 2, 2, 2, 2]);
});

test('every numeric voice default varies across the eight profiles (audit needs something to see)', () => {
  // keys that gameplay modulates inside a level, or the artefacts drive, are exempt from the static check
  const dynamic = new Set(['lead.cutoff', 'pad.cutoff', 'pad.attack', 'pad.release', 'pad.tune', 'drone.cutoff', 'drone.level', 'drone.sub', 'drone.resonance', 'drone.cutoffLfo', 'drone.release', 'drone.tune',
    'bell.brightness', 'pluck.cutoff', 'texture.level', 'texture.tone', 'bell.decay', 'bell.beat', 'bell.ratio', 'bell.index', 'bell.indexEnd', 'bell.tune', 'pluck.tune', 'lead.tune', 'pluck.damping', 'pluck.decay', 'pluck.pos', 'pluck.bright']);
  const missing = [];
  for (const [voice, defs] of Object.entries(VOICE_DEFAULTS)) {
    for (const [k, def] of Object.entries(defs)) {
      if (typeof def !== 'number' || dynamic.has(voice + '.' + k)) continue;
      const vals = new Set(LEVEL_IDS.map((id) => patchesFor(PROFILES[id])[voice][k]));
      if (vals.size < 2) missing.push(voice + '.' + k);
    }
  }
  assert.deepEqual(missing, []);
});

test('channel baselines and textures cover everything', () => {
  for (const id of LEVEL_IDS) {
    const b = channelBase(PROFILES[id]);
    for (const n of CHANNEL_NAMES) for (const k of ['gain', 'pan', 'reverb', 'delay', 'grain', 'cutoff', 'resonance', 'drive', 'crush', 'chorus']) assert.ok(Number.isFinite(b[n][k]), `${id}.${n}.${k}`);
    for (const c of COVER_KEYS) assert.ok(textureFor(PROFILES[id], c).kind);
    assert.ok(kitGens(PROFILES[id]).length > 10);
  }
});

test('chord choice is a pure seeded hash of the grid square', () => {
  const v = PROFILES.rannoch.chords;
  assert.equal(pickChordIndex(v, 3, 4, 1101), pickChordIndex(v, 3, 4, 1101));
  const seen = new Set();
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) seen.add(pickChordIndex(v, x, y, 1101));
  assert.ok(seen.size >= 5, 'vocabulary is used');
  // tonic is the most frequent
  const counts = new Array(v.length).fill(0);
  for (let x = 0; x < 40; x++) for (let y = 0; y < 40; y++) counts[pickChordIndex(v, x, y, 7)]++;
  assert.equal(counts.indexOf(Math.max(...counts)), 0);
});

test('voice leading keeps the chord inside the register and moves little', () => {
  const p = PROFILES.coe;
  let prev = null;
  for (const e of p.chords) {
    const tones = chordTones(p.root, p.mode, e);
    const v = voiceChord(prev, tones, 48, 68);
    assert.ok(v.length >= 3, e.name);
    assert.ok(v[0] >= 41 && v[v.length - 1] <= 75, e.name + ' ' + v);
    if (prev) { const move = v.reduce((a, m, i) => a + Math.abs(m - (prev[i] ?? m)), 0); assert.ok(move <= 24, e.name + ' ' + move); }
    prev = v;
  }
  assert.deepEqual(droneNotes(50, PROFILES.rannoch.mode, PROFILES.rannoch.chords[0], -12).map(pc).includes(2), true);
});

test('euclid', () => {
  assert.deepEqual(euclid(2, 16).map((x, i) => (x ? i : -1)).filter((x) => x >= 0), [0, 8]);
  assert.equal(euclid(5, 16).filter(Boolean).length, 5);
  assert.equal(euclid(3, 8, 2).filter(Boolean).length, 3);
  assert.equal(euclid(0, 8).some(Boolean), false);
  assert.equal(euclid(16, 16).every(Boolean), true);
});

test('pattern generators mutate and stay valid', () => {
  const rng = new Rng(5);
  const g = new PatternGen({ h: 'kick', flow: { p: 0.5, k: [2, 3, 4], rot: [0, 2] }, swell: { p: 0.8, k: [4, 5] } }, rng);
  const seen = new Set();
  for (let i = 0; i < 40; i++) { g.mutate(1); const c = g.cur.flow; assert.ok([2, 3, 4].includes(c.k)); seen.add(c.k + ':' + c.rot); }
  assert.ok(seen.size > 3);
  assert.equal(g.gate('ebb', 0), false);
});

test('markov melody stays near its register and follows direction bias', () => {
  const rng = new Rng(9);
  const m = new MelodyMarkov(rng, { center: 4, span: 9 });
  let up = 0, n = 0;
  for (let i = 0; i < 400; i++) { const before = m.pos; const to = m.next({ dir: 0.9 }); assert.ok(to >= -2 && to <= 11); if (to > before) up++; n++; if (m.pos > 8) m.reset(2); }
  assert.ok(up / n > 0.45);
});

test('conductor: lookahead scheduling, bar structure, gap skip, section hysteresis', () => {
  const rng = new Rng(3);
  const steps = [], trans = [], secs = [];
  const c = new Conductor({ rng, bpm: 120, swing: 0, hooks: { onStep: (s) => steps.push(s), onTransition: (x) => trans.push(x), onSection: (x) => secs.push(x) } });
  assert.equal(c.stanzaBars, 4, 'default stanza: four bars');
  let now = 0;
  const run = (secsTotal, e) => { const end = now + secsTotal; while (now < end) { c.setEnergy(e); c.update(now); now += 0.05; } };
  run(4, 0.1);
  // 120 bpm → 16th = 0.125 s: 4 s ≈ 32 steps, never scheduled further than 0.15 s ahead
  assert.ok(steps.length >= 28 && steps.length <= 36, 'steps ' + steps.length);
  assert.equal(steps[0].i16, 0, 'starts on a bar line');
  for (const s of steps) assert.ok(s.t >= 0);
  const dts = steps.slice(1).map((s, i) => s.t - steps[i].t);
  for (const d of dts) assert.ok(Math.abs(d - 0.125) < 1e-6);
  // gap: no update for 10 s must not burst
  const before = steps.length;
  now += 10; c.update(now);
  assert.ok(steps.length - before <= 4, 'burst ' + (steps.length - before));
  assert.ok(steps[steps.length - 1].t >= now - 0.01, 'skipped ahead');
  // sections: rising energy goes flow then swell, falling comes back, no flapping
  run(20, 0.5);
  assert.equal(c.section, 'flow');
  run(20, 0.9);
  assert.equal(c.section, 'swell');
  const nSec = secs.length;
  run(10, 0.62);       // inside the hysteresis band: stays
  assert.equal(c.section, 'swell');
  run(25, 0.05);
  assert.equal(c.section, 'ebb');
  assert.ok(secs.length >= nSec + 2);
  // (was: a change lands on the next bar line, ebb → flow on the next half bar) — now every change lands on a stanza
  // downbeat, and its transition is announced at the start of the stanza's last bar: a whole bar to fill
  for (const t of trans) assert.ok(t.tApply > t.t && Math.abs(t.lenSec - c.barDur) < 1e-6, 'a bar of pickup ' + t.lenSec);
  for (const x of secs) assert.ok(c.isStanzaStart(x.step), 'section change on a stanza downbeat, step ' + x.step);
});

// ------------------------------------------------------------------------------------------------
// stanza form
// ------------------------------------------------------------------------------------------------
function stanzaRig({ bpm = 120, stanzaBars = 4, phraseBars = 4, seed = 11, energy = () => 0.1 } = {}) {
  const rec = { steps: [], plans: [], stanzas: [], sections: [], trans: [] };
  const c = new Conductor({
    rng: new Rng(seed), bpm, swing: 0, phraseBars, stanzaBars,
    hooks: { onStep: (s) => rec.steps.push(s), onStanzaPlan: (x) => rec.plans.push(x), onStanza: (x) => rec.stanzas.push(x), onSection: (x) => rec.sections.push(x), onTransition: (x) => rec.trans.push(x) },
  });
  const r = { c, rec, now: 0 };
  r.run = (secs) => { const end = r.now + secs; while (r.now < end) { c.setEnergy(energy(r.now)); c.update(r.now); r.now += 0.05; } };
  /** advance in small steps until pred() holds */
  r.until = (pred) => { for (let i = 0; i < 20000 && !pred(); i++) { c.setEnergy(energy(r.now)); r.now += 0.005; c.update(r.now); } assert.ok(pred(), 'condition reached'); };
  return r;
}

test('stanza math: index and bar-in-stanza follow the bar count from a stanza-and-phrase line', () => {
  for (const n of [1, 2, 3, 4]) {
    const r = stanzaRig({ stanzaBars: n });
    r.run(2); r.c.snapTempo(120, 0, 4, n);
    r.run(40);
    const { steps } = r.rec;
    const bar0 = steps[0].bar;
    assert.equal(steps[0].isStanzaStart, true, 'the grid starts on a stanza downbeat');
    assert.equal(steps[0].isPhraseStart, true, 'which is also a phrase start');
    for (const s of steps) {
      assert.equal(s.stanza, Math.floor((s.bar - bar0) / n), `stanza of bar ${s.bar} (N=${n})`);
      assert.equal(s.barInStanza, (s.bar - bar0) % n);
      assert.equal(s.isStanzaStart, s.i16 === 0 && s.barInStanza === 0);
      assert.equal(s.stanzaBars, n);
    }
    assert.ok(Math.abs(r.c.stanzaDur - n * 2) < 1e-9, 'stanza duration = N bars (2 s bars at 120 bpm)');
    const g = r.c.nextGrid(r.now + 0.5, 'stanza');
    assert.ok(r.c.isStanzaStart(g.step) && g.step >= r.c.step);
    assert.equal(r.c.nextGrid(r.now + 0.5, 'bar').step % 16, 0);
    assert.equal(r.c.nextGrid(r.now + 0.5, 'beat').step % 4, 0);
  }
  // a later grid start (new level) still lands on a line where phrase and stanza both begin
  const r = stanzaRig({ stanzaBars: 2, phraseBars: 4 });
  r.run(7.3); r.c.reset(); r.c.snapTempo(100, 0, 4, 2); r.rec.steps.length = 0; r.run(10);
  const s0 = r.rec.steps[0];
  assert.ok(s0.isStanzaStart && s0.isPhraseStart && s0.stanza === 0, 'restart on a common line');
});

test('onStanzaPlan fires exactly once per stanza, at the first step of the last bar of the stanza before', () => {
  for (const n of [2, 4]) {
    const r = stanzaRig({ stanzaBars: n, energy: (t) => 0.1 + 0.8 * (Math.floor(t / 3.1) % 2) });
    r.run(90);
    const { plans, stanzas, steps } = r.rec;
    const byStanza = new Map();
    for (const p of plans) byStanza.set(p.stanza, (byStanza.get(p.stanza) || 0) + 1);
    for (const [k, v] of byStanza) assert.equal(v, 1, `stanza ${k} planned ${v} times`);
    assert.ok(stanzas.length >= 10);
    for (const x of stanzas.slice(1)) assert.ok(byStanza.has(x.stanza), 'every downbeat after the first was planned');
    const stepAt = new Map(steps.map((s) => [s.step, s]));
    for (const p of plans) {
      const s = stepAt.get(p.step);
      assert.equal(s.barInStanza, n - 1, 'planned in the last bar');
      assert.equal(s.i16, 0, 'at its first step');
      assert.equal(s.isStanzaPlan, true);
      assert.equal(p.applyStep, p.step + 16, 'a bar before the downbeat');
      const down = stanzas.find((x) => x.stanza === p.stanza);
      if (down) { assert.equal(down.step, p.applyStep); assert.ok(Math.abs(down.t - p.at) < 1e-9, 'at = the downbeat time'); assert.equal(down.planned, true); }
    }
  }
});

test('section changes only ever apply on stanza downbeats, however the energy jumps mid-stanza', () => {
  for (const n of [2, 4]) {
    // energy jumps at awkward, non-bar-aligned times (every 2.3 / 3.7 s), across all three sections
    const lv = [0.05, 0.95, 0.95, 0.5, 0.92, 0.02, 0.02, 0.6];
    const r = stanzaRig({ stanzaBars: n, seed: 5, energy: (t) => lv[Math.floor(t / 2.3) % lv.length] });
    r.run(240);
    const { sections, trans, stanzas } = r.rec;
    assert.ok(sections.length >= 5, `${sections.length} changes at N=${n}`);
    const downT = new Map(stanzas.map((x) => [x.step, x.t]));
    for (const x of sections) {
      assert.ok(r.c.isStanzaStart(x.step), `change at step ${x.step} is a downbeat`);
      assert.ok(Math.abs(downT.get(x.step) - x.t) < 1e-9, 'applied at the downbeat time');
    }
    for (const t of trans) assert.equal(t.applyStep - t.step, 16, 'decided a bar ahead');
    // hysteresis is kept: the order of sections is always a legal neighbour move
    const legal = { ebb: ['flow'], flow: ['ebb', 'swell'], swell: ['flow'] };
    for (const x of sections) assert.ok(legal[x.from].includes(x.to), `${x.from} → ${x.to}`);
  }
  assert.equal(sectionFor(0.31, 'ebb'), 'flow'); assert.equal(sectionFor(0.62, 'swell'), 'swell'); assert.equal(sectionFor(0.62, 'flow'), 'flow');
});

test('requestCut lands on the next stanza downbeat (replanning the coming one while a beat remains), never off it', () => {
  const N = 4;
  // (a) mid-stanza: the next downbeat
  let r = stanzaRig({ stanzaBars: N });
  r.run(3);
  r.until(() => r.c.barInStanza === 1 && r.c.step % 16 === 6);
  let target = r.c.requestCut('swell');
  assert.equal(target, r.c.stanza + 1);
  r.run(12);
  let x = r.rec.sections.find((s) => s.to === 'swell');
  assert.ok(x && x.step === r.c.stanzaStep(target), 'lands on the next downbeat');
  // (b) in the last bar, after the plan, with more than a beat left: the plan is redone for the same downbeat
  r = stanzaRig({ stanzaBars: N });
  r.run(3);
  r.until(() => r.c.planned && r.c.planned.applyStep - r.c.step === 9);
  const planned = r.c.planned.stanza;
  target = r.c.requestCut('swell');
  assert.equal(target, planned);
  assert.ok(r.rec.plans.some((p) => p.replan && p.stanza === planned && p.to === 'swell'), 'replanned');
  assert.ok(r.rec.trans.some((t) => t.to === 'swell' && t.applyStep === r.c.stanzaStep(planned) && t.lenSec >= r.c.beatDur - 1e-9), 'a shorter fill, at least a beat');
  r.run(6);
  x = r.rec.sections.find((s) => s.to === 'swell');
  assert.equal(x.step, r.c.stanzaStep(planned));
  // (c) less than a beat before the downbeat: the stanza after
  r = stanzaRig({ stanzaBars: N });
  r.run(3);
  r.until(() => r.c.planned && r.c.planned.applyStep - r.c.step === 2);
  const after = r.c.planned.stanza + 1;
  target = r.c.requestCut('flow');
  assert.equal(target, after);
  r.run(20);
  x = r.rec.sections.find((s) => s.to === 'flow');
  assert.equal(x.step, r.c.stanzaStep(after), 'not squeezed in off the grid');
  for (const s of r.rec.sections) assert.ok(r.c.isStanzaStart(s.step));
  // forceSection is the same explicit cut now (no immediate switch)
  const before = r.c.section;
  r.c.forceSection(before === 'ebb' ? 'swell' : 'ebb');
  assert.equal(r.c.section, before, 'not applied at once');
});
