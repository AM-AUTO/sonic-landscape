import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, LEVEL_IDS, patchesFor, VOICE_DEFAULTS, motifFor, tonicTriadPcs, kitGens, channelBase, CHANNEL_NAMES, textureFor, COVER_KEYS } from '../src/audio/levelmusic.js';
import { LEVELS } from '../src/world/levels/index.js';
import { pickChordIndex, chordTones, voiceChord, droneNotes, rootTriad, pc } from '../src/audio/harmony.js';
import { euclid, Conductor, PatternGen, MelodyMarkov } from '../src/audio/conductor.js';
import { Rng } from '../src/core/rng.js';

// corryvreckan / cruachan / lyon borrow the old assynt / affric / torridon profiles verbatim until the sonic round
const ROOT_PC = { corryvreckan: 3, cruachan: 7, lyon: 0, rannoch: 2, cairngorm: 4, coe: 9, cuillin: 6, nevis: 2 };
const BPM = { corryvreckan: 60, cruachan: 72, lyon: 68, rannoch: 64, cairngorm: 56, coe: 76, cuillin: 84, nevis: 70 };

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
  for (const t of trans) assert.ok(t.tApply > t.t && t.lenSec >= 0.4);
});
