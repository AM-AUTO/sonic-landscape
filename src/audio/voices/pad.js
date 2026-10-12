/**
 * Pad — supersaw / triangle stack with slow ADSR and a lowpass filter envelope, slow cutoff
 * drift and per-tone stereo spread. One scope per chord; everything is released and disconnected
 * after the release tail.
 *
 *   new Pad(engine, channel, patch).chord(midis, t, dur, vel).set(patch)
 */
import { Scope, num, clamp, fclamp, destOf, recordPatch, adsr } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const PAD_DEFAULTS = Object.freeze({
  wave: 'sawtooth',
  saws: 3,          // detuned saws per tone (1..4)
  detune: 13,       // cents spread of the saw stack
  triMix: 0.55,     // triangle (one octave down) relative level
  attack: 1.8, decay: 2.5, sustain: 0.75, release: 3.8,   // seconds / level
  cutoff: 1000,     // Hz base lowpass
  envAmt: 1.9,      // octaves the filter opens at the attack peak
  resonance: 1.5,       // lowpass resonance, dB
  keytrack: 0.4,    // 0..1 cutoff follows tone pitch
  lfoRate: 0.11, lfoDepth: 0.25,   // cutoff drift (octaves)
  tune: 0,          // cents, global detune (e.g. -50 = quarter-tone flat)
  width: 0.8,       // stereo spread of chord tones
  level: 0.17,
});

export class Pad {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...PAD_DEFAULTS, ...patch };
  }

  set(patch = {}) {
    Object.assign(this.p, patch);
    recordPatch(this.engine, 'pad', patch);
    return this;
  }

  /** midis: array of MIDI notes; dur: seconds held before release; vel 0..1 */
  chord(midis, t = this.ctx.currentTime, dur = 4, vel = 0.8) {
    const { ctx, engine } = this;
    const p = this.p;
    const v = clamp(num(vel, 0.8), 0, 1.2);
    dur = Math.max(0.1, num(dur, 4));
    recordPatch(engine, 'pad', p);
    engine.record('pad.vel', v);
    engine.record('pad.dur', dur);
    const tones = (midis || []).map((m) => num(m, 60, 12, 110)).slice(0, 8);
    if (!tones.length) return this;
    const sc = new Scope(ctx);
    const A = Math.max(0.01, num(p.attack, 1.8)), D = num(p.decay, 2.5), S = num(p.sustain, 0.75), R = Math.max(0.05, num(p.release, 3.8));

    // shared: highpass → amp env → level → dest
    const hp = sc.biquad('highpass', 70, -3);
    const amp = sc.gain(0);
    const lvl = sc.gain(clamp(num(p.level, 0.17), 0, 1) * (0.35 + 0.65 * v) / Math.sqrt(tones.length / 3));
    hp.connect(amp); amp.connect(lvl); lvl.connect(this.dest);
    const tEnd = adsr(amp.gain, t, dur, { a: A, d: D, s: S, r: R }, 1);
    const tRel = t + Math.max(dur, A + 0.01);

    // shared slow cutoff drift
    const lfo = sc.osc('sine', Math.max(0.01, num(p.lfoRate, 0.11)) * (0.8 + 0.4 * engine.rng.float()), t);
    const lfoG = sc.gain(clamp(num(p.lfoDepth, 0.25), 0, 2) * 1200 * 0.5);
    lfo.connect(lfoG);

    const nSaw = Math.round(clamp(num(p.saws, 3), 1, 4));
    tones.forEach((m, k) => {
      const f = fclamp(midiToHz(m + num(p.tune, 0, -1200, 1200) / 100), 20, 5000);
      // per-tone filter with envelope (keytracked)
      const base = clamp(num(p.cutoff, 1000) * Math.pow(f / 261.6, clamp(num(p.keytrack, 0.4), 0, 1)) * (0.5 + 0.5 * v), 80, 14000);
      const lp = sc.biquad('lowpass', base, num(p.resonance, 1.5));
      const peak = fclamp(base * Math.pow(2, num(p.envAmt, 1.9)), 100, 16000);
      const sus = fclamp(base * Math.pow(2, num(p.envAmt, 1.9) * 0.35), 100, 16000);
      const fp = lp.frequency;
      fp.setValueAtTime(base, t);
      fp.linearRampToValueAtTime(peak, t + A);
      fp.setTargetAtTime(sus, t + A, Math.max(0.01, D) / 3);
      fp.setTargetAtTime(base * 0.6, tRel, R / 3);
      lfoG.connect(lp.detune);
      const u = tones.length > 1 ? (k / (tones.length - 1)) * 2 - 1 : 0;
      const pan = sc.add(new StereoPannerNode(ctx, { pan: clamp(u * num(p.width, 0.8), -1, 1) }));
      lp.connect(pan); pan.connect(hp);
      const toneG = sc.gain(1 / Math.sqrt(nSaw + p.triMix));
      toneG.connect(lp);
      for (let i = 0; i < nSaw; i++) {
        const uu = nSaw > 1 ? (i / (nSaw - 1)) * 2 - 1 : 0;
        const o = sc.osc(p.wave, f, t, tEnd);
        o.detune.value = uu * num(p.detune, 13) + (engine.rng.float() - 0.5) * 3;
        o.connect(toneG);
      }
      const tri = sc.osc('triangle', f * 0.5, t, tEnd);
      const tg = sc.gain(clamp(num(p.triMix, 0.55), 0, 2));
      tri.connect(tg); tg.connect(toneG);
    });
    lfo.stop(tEnd);
    sc.arm();
    return this;
  }
}
