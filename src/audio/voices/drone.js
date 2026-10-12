/**
 * Drone — Radigue / Tangerine Dream foundation. 4-6 detuned saw/triangle oscillators, each with a
 * slow independent detune LFO, through a 24 dB lowpass whose cutoff is moved by two incommensurate
 * LFOs. A sine sub follows the lowest chord tone. setChord() glides all voices smoothly.
 *
 *   new Drone(engine, channel, patch).start(t).setChord(midis, t, glideSec).set(patch, t).stop(t)
 */
import { Scope, num, clamp, fclamp, destOf, recordPatch } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const DRONE_DEFAULTS = Object.freeze({
  voices: 5,        // 4..6 oscillators
  wave: 'sawtooth', // 'sawtooth' | 'triangle' | 'square' (every 3rd voice is a triangle for body)
  spread: 9,        // cents of static detune spread between voices
  detuneLfo: 7,     // cents of slow per-voice detune drift
  lfoRate: 0.06,    // Hz base rate of the slow LFOs (each voice gets 0.5x-2x)
  cutoff: 820,      // Hz lowpass
  cutoffLfo: 0.45,  // octaves of cutoff movement
  resonance: 2,     // lowpass resonance, dB (Web Audio Q for lowpass: -3 flat, +6 singing)
  level: 0.14,      // output level
  sub: 0.45,        // sub sine level relative to level
  stereo: 0.75,     // 0..1 pan spread
  tune: 0,          // cents, global detune (e.g. -50 = quarter-tone flat)
  fadeIn: 5,        // s
  release: 6,       // s
});

export class Drone {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...DRONE_DEFAULTS, ...patch };
    this.chord = [38, 45, 50];
    this.sc = null;
    this.running = false;
  }

  start(t = this.ctx.currentTime) {
    if (this.running) return this;
    const { ctx, engine } = this;
    const p = this.p;
    recordPatch(engine, 'drone', p);
    const sc = this.sc = new Scope(ctx);
    const N = Math.round(clamp(num(p.voices, 5), 4, 6));

    const mix = sc.gain(1);
    const f1 = sc.biquad('lowpass', p.cutoff, p.resonance);
    const f2 = sc.biquad('lowpass', p.cutoff * 1.1, -3);
    const env = sc.gain(0);
    const lvl = sc.gain(clamp(num(p.level, 0.14), 0, 1));
    mix.connect(f1); f1.connect(f2); f2.connect(env); env.connect(lvl); lvl.connect(this.dest);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(1, t + Math.max(0.05, num(p.fadeIn, 5)));
    this.nodes = { mix, f1, f2, env, lvl };

    // filter LFOs (cents on both filters)
    this.filterLfos = [];
    const depthCents = clamp(num(p.cutoffLfo, 0.45), 0, 3) * 1200 * 0.5;
    [1, 1.618].forEach((mult, i) => {
      const l = sc.osc('sine', p.lfoRate * mult * (0.8 + 0.4 * engine.rng.float()), t);
      const g = sc.gain(depthCents);
      l.connect(g); g.connect(f1.detune); g.connect(f2.detune);
      this.filterLfos.push({ l, g });
    });

    // voices
    this.voices = [];
    const chord = this.chord;
    for (let i = 0; i < N; i++) {
      const type = (i % 3 === 2) ? 'triangle' : p.wave;
      const o = sc.osc(type, midiToHz(this.noteFor(chord, i) + num(p.tune, 0, -1200, 1200) / 100), t);
      const u = N > 1 ? (i / (N - 1)) * 2 - 1 : 0;
      o.detune.value = u * p.spread;
      const lfo = sc.osc('sine', p.lfoRate * (0.5 + 1.5 * engine.rng.float()), t);
      const lg = sc.gain(p.detuneLfo);
      lfo.connect(lg); lg.connect(o.detune);
      const g = sc.gain(1 / Math.sqrt(N));
      const pan = sc.add(new StereoPannerNode(ctx, { pan: clamp(u * p.stereo, -1, 1) }));
      o.connect(g); g.connect(pan); pan.connect(mix);
      this.voices.push({ o, lfo, lg, g, u });
    }
    // sub
    const sub = sc.osc('sine', midiToHz(Math.max(24, chord[0] - 12) + num(p.tune, 0, -1200, 1200) / 100), t);
    const subG = sc.gain(clamp(num(p.sub, 0.45), 0, 1.5));
    sub.connect(subG); subG.connect(mix);
    this.sub = { o: sub, g: subG };

    this.h = {
      level: engine.param('drone.level', lvl.gain),
      cutoff1: engine.param('drone.cutoff', f1.frequency),
      cutoff2: engine.param('drone.cutoff2', f2.frequency),
      q: engine.param('drone.resonance', f1.Q),
      sub: engine.param('drone.sub', subG.gain),
    };
    this.running = true;
    sc.arm();
    return this;
  }

  noteFor(chord, i) {
    const n = chord.length;
    return chord[i % n] + (Math.floor(i / n) % 2 === 1 ? 12 : 0);
  }

  /** glide every voice to the new chord over glideSec (exponential approach, smooth) */
  setChord(midis, t = this.ctx.currentTime, glideSec = 4) {
    const chord = (midis && midis.length ? midis : this.chord).map((m) => num(m, 50, 12, 100)).sort((a, b) => a - b);
    this.chord = chord;
    this.engine.record('drone.glide', num(glideSec, 4));
    this.engine.record('drone.chordRoot', chord[0]);
    if (!this.running) return this;
    const tc = Math.max(0.01, num(glideSec, 4) / 3);
    const tune = num(this.p.tune, 0, -1200, 1200) / 100;
    this.voices.forEach((v, i) => {
      const f = fclamp(midiToHz(this.noteFor(chord, i) + tune), 20, 4000);
      v.o.frequency.cancelScheduledValues(t);
      v.o.frequency.setTargetAtTime(f, t, tc);
    });
    const fs = fclamp(midiToHz(Math.max(24, chord[0] - 12) + tune), 15, 400);
    this.sub.o.frequency.cancelScheduledValues(t);
    this.sub.o.frequency.setTargetAtTime(fs, t, tc);
    return this;
  }

  set(patch = {}, t = this.ctx.currentTime) {
    Object.assign(this.p, patch);
    recordPatch(this.engine, 'drone', patch);
    if (!this.running) return this;
    const p = this.p, tc = 0.8;
    if (patch.tune !== undefined) this.setChord(this.chord, t, 0.3);
    if (patch.level !== undefined) this.h.level.set(clamp(num(p.level, 0.14), 0, 1), t, tc);
    if (patch.cutoff !== undefined) {
      this.h.cutoff1.set(fclamp(p.cutoff, 60, 12000), t, tc);
      this.h.cutoff2.set(fclamp(p.cutoff * 1.1, 60, 12000), t, tc);
    }
    if (patch.resonance !== undefined) this.h.q.set(clamp(num(p.resonance, 2), -6, 24), t, tc);
    if (patch.sub !== undefined) this.h.sub.set(clamp(num(p.sub, 0.45), 0, 1.5), t, tc);
    if (patch.cutoffLfo !== undefined) {
      const d = clamp(num(p.cutoffLfo, 0.45), 0, 3) * 600;
      for (const f of this.filterLfos) { f.g.gain.cancelScheduledValues(t); f.g.gain.setTargetAtTime(d, t, tc); }
    }
    if (patch.spread !== undefined) {
      this.voices.forEach((v) => { v.o.detune.cancelScheduledValues(t); v.o.detune.setTargetAtTime(v.u * p.spread, t, tc); });
    }
    if (patch.detuneLfo !== undefined) {
      this.voices.forEach((v) => { v.lg.gain.cancelScheduledValues(t); v.lg.gain.setTargetAtTime(num(p.detuneLfo, 7, 0, 100), t, tc); });
    }
    if (patch.lfoRate !== undefined) {
      this.voices.forEach((v, i) => v.lfo.frequency.setTargetAtTime(Math.max(0.005, p.lfoRate * (0.5 + 0.25 * (i % 6))), t, tc));
    }
    return this;
  }

  stop(t = this.ctx.currentTime) {
    if (!this.running) return this;
    this.running = false;
    const rel = Math.max(0.05, num(this.p.release, 6));
    const env = this.nodes.env.gain;
    env.cancelScheduledValues(t);
    env.setTargetAtTime(0, t, rel / 4);
    this.sc.stopAll(t + rel * 2);
    this.sc = null;
    return this;
  }
}
