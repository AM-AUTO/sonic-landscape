// Demo sequence + per-voice clips. `clips[name].play(rig, t)` schedules one voice/hit; `dur` is the
// time window (s) the clip needs. Used by the render tool (solo renders + full sequence) and the lab.
import { KIT_NAMES } from '../../src/audio/voices/kit.js';
import { MODES, degreeToMidi, chordFromDegree, CONTOUR_MOTIF } from '../../src/audio/theory.js';

const ROOT = 62; // D4
const dor = MODES.dorian;

export const clips = {
  drone: {
    dur: 8, kind: 'voice',
    play(r, t) {
      r.drone.start(t); r.drone.setChord([38, 45, 50, 57], t);
      r.drone.setChord([43, 50, 55, 62], t + 3.5, 3);
      r.drone.set({ cutoff: 1300, cutoffLfo: 0.6, level: 0.2 }, t + 2.5);
      r.drone.stop(t + 6);
    },
  },
  pad: {
    dur: 7, kind: 'voice',
    play(r, t) {
      r.pad.chord(chordFromDegree(ROOT - 12, dor, 0, { size: 4 }), t, 2.8, 0.8);
      r.pad.chord(chordFromDegree(ROOT - 12, dor, 3, { size: 4, spread: 1 }), t + 3.0, 2.8, 0.65);
    },
  },
  bass: {
    dur: 5, kind: 'voice',
    play(r, t) {
      r.bass.note(38, t, 0.6, 0.9); r.bass.note(38, t + 0.75, 0.3, 0.6); r.bass.note(45, t + 1.1, 0.8, 0.8);
      r.bass.glideTo(43, t + 1.6); r.bass.note(36, t + 2.6, 1.0, 1.0); r.bass.note(41, t + 3.8, 0.5, 0.7);
    },
  },
  lead: {
    dur: 8, kind: 'voice',
    play(r, t) {
      const m = CONTOUR_MOTIF;
      const lens = [1.0, 0.5, 1.2, 0.5, 1.8];
      let x = t;
      lens.forEach((len, i) => { r.lead.note(degreeToMidi(ROOT, dor, m[i] + 7), x, len * 0.97, 0.55 + 0.1 * i); x += len; });
      r.lead.note(degreeToMidi(ROOT, dor, 14), x + 0.4, 1.2, 0.9);       // after a gap
    },
  },
  bell: {
    dur: 10, kind: 'voice',
    play(r, t) {
      r.bell.set({ kind: 'glass' }); r.bell.note(86, t, 3, 0.8); r.bell.note(91, t + 0.9, 3, 0.55);
      r.bell.set({ kind: 'bowl' }); r.bell.note(62, t + 3.4, 4, 0.8);
      r.bell.set({ kind: 'tine' }); r.bell.note(88, t + 7, 2, 0.8); r.bell.note(93, t + 7.7, 2, 0.5);
      r.bell.set({ kind: 'glass' });
    },
  },
  pluck: {
    dur: 8, kind: 'voice',
    play(r, t) {
      r.pluck.set({ kind: 'string' }); [62, 65, 69, 74].forEach((n, i) => r.pluck.note(n, t + i * 0.28, 1.5, 0.75));
      r.pluck.set({ kind: 'harp' }); [57, 64, 69, 76].forEach((n, i) => r.pluck.note(n, t + 2.4 + i * 0.22, 2, 0.7));
      r.pluck.set({ kind: 'kalimba' }); [74, 77, 81, 86].forEach((n, i) => r.pluck.note(n, t + 4.6 + i * 0.3, 1.2, 0.8));
      r.pluck.set({ kind: 'string' });
    },
  },
};

for (const kind of ['wind', 'water', 'rustle', 'crackle', 'hiss']) {
  clips['texture.' + kind] = {
    dur: 4, kind: 'voice',
    play(r, t) {
      r.texture.set({ kind, level: 0.7, tone: 0.3 }, t);
      r.texture.start(t);
      r.texture.set({ tone: 0.8 }, t + 1.8);
      r.texture.stop(t + 3.2);
    },
  };
}

const KIT_DEMO = {
  kick: [0.9, 1.4], snare: [0.8, 1.4], rim: [0.8, 1.0], clap: [0.8, 1.4], hatC: [0.8, 0.9], hatO: [0.8, 1.6], ride: [0.7, 3.5],
  crash: [0.9, 6.5], tomL: [0.8, 1.6], tomM: [0.8, 1.4], tomH: [0.8, 1.2], timp: [0.9, 6.5], gong: [0.8, 11], click: [0.9, 0.8],
  snap: [0.9, 0.8], grainBurst: [0.8, 1.6], breath: [0.7, 3], reverseSwell: [0.9, 3.8], metal: [0.8, 2.4], shaker: [0.8, 0.9],
};
for (const name of KIT_NAMES) {
  const [vel, dur] = KIT_DEMO[name];
  clips['kit.' + name] = {
    dur, kind: 'kit',
    play(r, t) {
      const o = name === 'reverseSwell' ? { length: 2.4 } : name === 'breath' ? { length: 1.8 } : name === 'grainBurst' ? { length: 0.4 } : {};
      r.kit.hit(name, t, vel, o);
      if (name === 'timp') { r.kit.hit('timp', t + 0.12, 0.5, {}); r.kit.hit('timp', t + 0.24, 0.6, {}); r.kit.hit('timp', t + 0.34, 0.7, {}); r.kit.hit('timp', t + 0.42, 0.9, {}); }
      if (name === 'reverseSwell') r.kit.hit('crash', t + 2.4, 0.8);
    },
  };
}

/** Dense mix: drone, wind, pad chords, full kit groove, bass, pluck arpeggio, lead, bells, swell + crash + timpani. */
export function playTutti(r, tt) {
  r.drone.start(tt); r.drone.setChord([38, 45, 50, 57], tt);
  r.texture.set({ kind: 'wind', level: 0.5, tone: 0.5 }, tt); r.texture.start(tt);
  [0, 3, 4, 0].forEach((deg, i) => {
    const ct = tt + i * 2.5;
    r.pad.chord(chordFromDegree(ROOT - 12, dor, deg, { size: 4 }), ct, 2.4, 0.8);
    if (i) r.drone.setChord(chordFromDegree(ROOT - 24, dor, deg, { size: 3 }), ct, 1.5);
  });
  for (let b = 0; b < 40; b++) {            // 4 steps/s, 10 s
    const bt = tt + b * 0.25;
    const step = b % 16;
    if (step % 4 === 0) r.kit.hit('kick', bt, step === 0 ? 1 : 0.85);
    if (step === 4 || step === 12) r.kit.hit('snare', bt, 0.85);
    if (step === 12) r.kit.hit('clap', bt + 0.005, 0.5);
    r.kit.hit(step % 2 ? 'hatC' : (step % 8 === 6 ? 'hatO' : 'hatC'), bt, 0.5 + 0.4 * ((step % 4) === 2));
    if (step % 8 === 3) r.kit.hit(['tomH', 'tomM', 'tomL'][(step >> 3) % 3], bt, 0.8);
    if (step === 0 && b % 32 === 0) { r.kit.hit('crash', bt, 0.95); r.kit.hit('gong', bt, 0.7); }
    if (step === 10) r.kit.hit('shaker', bt, 0.6);
    if (step === 6) r.kit.hit('snap', bt, 0.7);
    if (step === 14) r.kit.hit('click', bt, 0.7);
    if (step === 8) r.kit.hit('ride', bt, 0.6);
    if (step % 8 === 0) r.bass.note([38, 38, 43, 41][(b >> 3) % 4], bt, 0.4, 0.9);
    if (step % 4 === 2) r.bass.note([45, 45, 50, 48][(b >> 3) % 4], bt, 0.2, 0.6);
    if (step % 2 === 0) r.pluck.note(degreeToMidi(ROOT + 12, dor, CONTOUR_MOTIF[(b >> 1) % 5] + (b >> 4)), bt, 0.4, 0.55);
  }
  const mel = [[0, 0, 1.5], [2, 1.5, 1], [4, 2.5, 2], [3, 4.5, 1], [1, 5.5, 2.5], [4, 8, 1.8]];
  for (const [d, o, l] of mel) r.lead.note(degreeToMidi(ROOT, dor, d + 7), tt + o, l, 0.9);
  r.bell.note(93, tt + 2.5, 3, 0.7); r.bell.note(88, tt + 6.5, 3, 0.7);
  r.kit.hit('grainBurst', tt + 5, 0.7, { length: 0.5 }); r.kit.hit('metal', tt + 6, 0.6); r.kit.hit('breath', tt + 4, 0.6, { length: 2 });
  r.kit.hit('reverseSwell', tt + 7.0, 0.9, { length: 2.0 }); r.kit.hit('crash', tt + 9.0, 0.9);
  r.kit.hit('timp', tt + 9.0, 1.0); r.kit.hit('rim', tt + 7.5, 0.7);
  r.drone.stop(tt + 9.5);
  r.texture.stop(tt + 9.5);
}

clips.tutti = { dur: 11, kind: 'tutti', play: (r, t) => playTutti(r, t) };

/**
 * Full demo sequence. Nothing is scheduled here: each segment has a `run()` closure the driver calls when
 * the context reaches (t0 - lead) via ctx.suspend() — exactly how the conductor will drive the engine.
 * Returns {segments:[{name,t0,t1,kind,run}], duration, tuttiStart}.
 */
export function scheduleDemo(r, t0 = 0.2) {
  const E = r.engine;
  const segs = [];
  let t = t0;
  const add = (name, dur, kind, fn) => { const at = t; segs.push({ name, t0: at, t1: at + dur, kind, run: () => fn(at) }); t += dur; };
  const act = (at, fn) => segs.push({ name: '(action)', t0: at, t1: at, kind: 'action', run: () => fn(at) });
  for (const n of ['drone', 'pad', 'bass', 'lead', 'bell', 'pluck']) add(n, clips[n].dur, 'voice', (tt) => clips[n].play(r, tt));
  ['wind', 'water', 'rustle', 'crackle', 'hiss'].forEach((k, i) => add('texture.' + k, 2.2, 'voice', (tt) => {
    r.texture.set({ kind: k, level: 0.7, tone: 0.45 }, tt); if (i === 0) r.texture.start(tt);
  }));
  act(t, (tt) => r.texture.stop(tt));
  t += 1.0;
  const kitDur = { ride: 2.2, crash: 3.4, timp: 3.2, gong: 5, breath: 2.4, reverseSwell: 3.4, metal: 1.4, grainBurst: 1.2, hatO: 1.1, kick: 1.0, snare: 1.0, clap: 1.0 };
  for (const name of KIT_NAMES) {
    const c = clips['kit.' + name];
    add('kit.' + name, kitDur[name] ?? 0.8, 'kit', (tt) => c.play(r, tt));
  }
  t += 0.5;
  // FX: reverb size changes (every change sounds a new bell), delay changes, granular freeze
  add('fx.reverb', 8.5, 'fx', (tt) => {
    const rv = E.fx.reverb;
    rv.setSize(1.2, 0.1, tt);
    r.pad.chord([62, 66, 69], tt, 1.2, 0.8);
    r.bell.note(86, tt + 0.1, 1, 0.8);
    rv.setSize(6, 2, tt + 2.3); r.bell.note(81, tt + 2.4, 1, 0.8);
    rv.setSize(15, 3, tt + 4.6); r.bell.note(88, tt + 4.7, 1, 0.8);
    rv.setSize(3, 1.5, tt + 7.2); r.bell.note(76, tt + 7.3, 1, 0.8);
    rv.setPreDelay(0.08, tt + 3); rv.setDamp(3000, tt + 6); rv.setWet(1.1, tt + 6);
    rv.setPreDelay(0.025, tt + 8); rv.setDamp(7500, tt + 8); rv.setWet(0.9, tt + 8);
  });
  add('fx.delay', 8, 'fx', (tt) => {
    const d = E.fx.delay;
    d.setPingPong(true); d.setTime(0.375, tt); d.setFeedback(0.55, tt);
    [74, 77, 81].forEach((n, i) => r.pluck.note(n, tt + i * 0.25, 0.5, 0.8));
    d.setFeedback(0.8, tt + 2); d.setTone(1800, tt + 2); d.setModDepth(0.7, tt + 2); d.setTime(0.5, tt + 2.5); d.setWet(0.8, tt + 2);
    [69, 72, 76].forEach((n, i) => r.pluck.note(n, tt + 2.8 + i * 0.25, 0.5, 0.8));
    d.setPingPong(false, tt + 5); d.setFeedback(0.5, tt + 5); d.setModDepth(0.1, tt + 5); d.setTone(4200, tt + 5); d.setWet(0.55, tt + 5);
    [67, 71, 74].forEach((n, i) => r.pluck.note(n, tt + 5.3 + i * 0.25, 0.5, 0.8));
    d.setFeedback(0.45, tt + 7); d.setTime(0.375, tt + 7);
  });
  add('fx.granular', 11, 'fx', (tt) => {
    const g = E.fx.granular;
    g.set({ density: 28, size: 0.12, pitch: 0, pitchSpread: 0, spray: 1.5, reverse: 0.1, mix: 1, feedback: 0.25 }, tt);
    g.setScale(MODES.dorian);
    r.ch.pad.set({ grain: 1.0 }, tt);
    r.pad.chord([50, 57, 62, 66], tt, 4.5, 0.8);
    g.set({ pitch: 7, pitchSpread: 12, density: 45 }, tt + 3.2);
    g.freeze(true, tt + 4.4);
    g.set({ density: 60, size: 0.3, spray: 4, reverse: 0.7, pitch: -5, pitchSpread: 14 }, tt + 4.6);
    g.freeze(false, tt + 8.5);
    g.set({ density: 20, size: 0.08, pitch: 12, pitchSpread: 5, spray: 2, reverse: 0.2, feedback: 0.5 }, tt + 9);
    r.ch.pad.set({ grain: 0.18 }, tt + 10);
    g.set({ density: 14, size: 0.18, pitch: 0, pitchSpread: 0, spray: 1.5, reverse: 0.1, mix: 0.7, feedback: 0.2 }, tt + 10);
  });
  // channel strip: sweep each local-FX control audibly on the kit + a pad
  add('fx.channels', 9, 'fx', (tt) => {
    const sweep = [
      ['kmain', { drive: 0.9 }, { drive: 0.0 }], ['kmain', { crush: 0.8 }, { crush: 0 }],
      ['pad', { cutoff: 500, resonance: 6 }, { cutoff: 12000, resonance: 0.7 }], ['pad', { chorus: 1 }, { chorus: 0.35 }],
      ['kcym', { pan: -0.8 }, { pan: 0.8 }], ['pad', { gain: 0.3 }, { gain: 0.7 }],
      ['bell', { reverb: 1.2, delay: 0.9 }, { reverb: 0.6, delay: 0.45 }], ['lead', { pan: -0.5, drive: 0.4 }, { pan: 0.5, drive: 0 }],
      ['ktex', { crush: 0.5 }, { crush: 0 }], ['drone', { cutoff: 700 }, { cutoff: 9000 }],
      ['bass', { drive: 0.8 }, { drive: 0.1 }], ['pluck', { grain: 0.8 }, { grain: 0.1 }], ['texture', { pan: -0.7 }, { pan: 0.7 }],
    ];
    // remember each channel's settings so the segment can hand back an unchanged mixer
    const names = Object.keys(r.ch);
    const orig = {};
    names.forEach((c) => { orig[c] = { cutoff: 18000, resonance: -3, crush: 0, chorus: 0, ...r.ch[c].state }; });
    r.pad.chord([50, 57, 62], tt, 8, 0.6);
    sweep.forEach(([c, a, b], i) => { r.ch[c].set(a, tt + 0.2, 0.05); r.ch[c].set(b, tt + 3.4, 0.2); });
    // every control on every channel moves at least once (audit coverage), then returns to a neutral value
    names.forEach((c, i) => {
      const f = (i + 1) / (names.length + 1);
      r.ch[c].set({ gain: 0.6 + 0.2 * f, pan: (f - 0.5) * 0.6, reverb: 0.2 + 0.4 * f, delay: 0.1 + 0.3 * f, grain: 0.05 + 0.2 * f, cutoff: 3000 + 9000 * f, resonance: 0.6 + 1.5 * f, drive: 0.1 + 0.3 * f, crush: 0.1 + 0.04 * i, chorus: 0.1 + 0.3 * f }, tt + 6.0, 0.3);
      r.ch[c].set(orig[c], tt + 8.4, 0.2);
    });
    for (let b = 0; b < 16; b++) {
      const bt = tt + 0.3 + b * 0.5;
      if (b % 2 === 0) r.kit.hit('kick', bt, 0.9);
      if (b % 4 === 2) r.kit.hit('snare', bt, 0.8);
      r.kit.hit('hatC', bt + 0.25, 0.6);
      if (b % 3 === 0) r.kit.hit('click', bt, 0.7);
    }
    r.lead.note(74, tt + 1, 2.5, 0.8); r.bell.note(86, tt + 4, 2, 0.8); r.pluck.note(69, tt + 5, 1, 0.8); r.bass.note(38, tt + 2, 1.5, 0.8);
    const M = E.fx.master;
    M.setDrive(0.8, tt); M.setLowCut(120, tt); M.setHighCut(9000, tt); M.setGain(0.9, tt);
    M.setDrive(0, tt + 7.5); M.setLowCut(28, tt + 7.5); M.setHighCut(17500, tt + 7.5); M.setGain(0.95, tt + 7.5);
    M.duck(0.5, 0.05, 0.5, 1.5, tt + 4); M.duck(0.3, 0.1, 0.2, 1, tt + 6.5);
  });
    t += 0.2;
  // dense tutti
  const tut = t;
  add('tutti', 10, 'tutti', (tt) => playTutti(r, tt));
  t += 14; // tail: lets every long decay finish so the leak check is meaningful
  return { segments: segs, duration: t, tuttiStart: tut };
}
