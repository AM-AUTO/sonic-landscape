/**
 * Lead — the foreground solo instrument (Vangelis CS-80 / Eno "An Ending" warmth).
 * Monophonic: a note that arrives while the previous graph is still sounding reuses it, gliding
 * (portamento via setTargetAtTime) and re-articulating legato. Two oscillators (detuned saw +
 * triangle) and a sub, 24 dB lowpass with a brass-like filter envelope, delayed vibrato, a small
 * pitch scoop on attack and slow analogue drift.
 *
 *   new Lead(engine, channel, patch).note(midi, t, dur, vel).set(patch)
 */
import { Scope, num, clamp, fclamp, destOf, recordPatch, adsr } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const LEAD_DEFAULTS = Object.freeze({
  wave1: 'sawtooth', wave2: 'triangle',
  detune: 7,          // cents (osc1 +, osc2 -)
  saw: 0.5, tri: 0.6, sub: 0.3,     // oscillator levels
  glide: 0.09,        // portamento seconds (to 95%)
  vibRate: 5.2, vibDepth: 13, vibDelay: 0.4, vibRamp: 0.7,   // Hz / cents / s / s
  scoop: 22,          // cents the pitch rises from on attack
  drift: 3,           // cents of slow analogue wander
  cutoff: 2300,       // base Hz
  envAmt: 1.3,        // octaves above base at the filter peak
  filterAttack: 0.11, filterDecay: 0.7, filterSustain: 0.35,   // sustain as fraction of envAmt
  resonance: 2.2,
  keytrack: 0.55,
  attack: 0.05, decay: 0.35, sustain: 0.85, release: 0.55,
  level: 0.5,
});

export class Lead {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...LEAD_DEFAULTS, ...patch };
    this.cur = null;
  }

  set(patch = {}) { Object.assign(this.p, patch); recordPatch(this.engine, 'lead', patch); return this; }

  _build(t, f) {
    const { ctx, engine } = this, p = this.p;
    const sc = new Scope(ctx);
    const o1 = sc.osc(p.wave1, f, t), o2 = sc.osc(p.wave2, f, t), os = sc.osc('sine', f * 0.5, t);
    const g1 = sc.gain(num(p.saw, 0.5, 0, 2)), g2 = sc.gain(num(p.tri, 0.6, 0, 2)), gs = sc.gain(num(p.sub, 0.3, 0, 2));
    const hp = sc.biquad('highpass', 80, 0.5);
    const lp = sc.biquad('lowpass', p.cutoff, p.resonance);
    const lp2 = sc.biquad('lowpass', p.cutoff, 0.6);
    const amp = sc.gain(0);
    const lvl = sc.gain(clamp(num(p.level, 0.5), 0, 1.5));
    o1.connect(g1); o2.connect(g2); os.connect(gs);
    g1.connect(hp); g2.connect(hp); gs.connect(hp);
    hp.connect(lp); lp.connect(lp2); lp2.connect(amp); amp.connect(lvl); lvl.connect(this.dest);
    // vibrato (delayed, ramped) + drift
    const vib = sc.osc('sine', num(p.vibRate, 5.2, 0.5, 12) * (0.96 + 0.08 * engine.rng.float()), t);
    const vibG = sc.gain(0);
    vib.connect(vibG);
    vibG.connect(o1.detune); vibG.connect(o2.detune); vibG.connect(os.detune);
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.setValueAtTime(0, t + num(p.vibDelay, 0.4, 0, 5));
    vibG.gain.linearRampToValueAtTime(num(p.vibDepth, 13, 0, 100), t + num(p.vibDelay, 0.4, 0, 5) + Math.max(0.01, num(p.vibRamp, 0.7)));
    const dr = sc.osc('sine', 0.37 + 0.2 * engine.rng.float(), t);
    const drG = sc.gain(num(p.drift, 3, 0, 50));
    dr.connect(drG); drG.connect(o1.detune); drG.connect(o2.detune);
    return { sc, o1, o2, os, lp, lp2, amp, vibG, startAt: t, endAt: t + 1 };
  }

  note(midi, t = this.ctx.currentTime, dur = 0.5, vel = 0.8) {
    const { ctx, engine } = this, p = this.p;
    midi = num(midi, 69, 28, 108); dur = Math.max(0.05, num(dur, 0.5)); vel = clamp(num(vel, 0.8), 0, 1.2);
    recordPatch(engine, 'lead', p);
    engine.record('lead.vel', vel); engine.record('lead.dur', dur); engine.record('lead.midi', midi);
    const f = fclamp(midiToHz(midi), 40, 4200);
    let g = this.cur;
    const legato = !!g && t < g.endAt - 0.05 && ctx.currentTime < g.endAt - 0.05 && t >= g.startAt;
    if (!legato) g = this.cur = this._build(t, f);
    const a = Math.max(0.005, num(p.attack, 0.05));
    if (legato) {
      const tc = Math.max(0.002, num(p.glide, 0.09)) / 3;
      for (const [o, m] of [[g.o1, 1], [g.o2, 1], [g.os, 0.5]]) {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setTargetAtTime(f * m, t, tc);
      }
    } else {
      // pitch scoop on a fresh attack
      const sc = num(p.scoop, 22, 0, 200);
      g.o1.detune.setValueAtTime(num(p.detune, 7) - sc, t);
      g.o1.detune.setTargetAtTime(num(p.detune, 7), t, 0.045);
      g.o2.detune.setValueAtTime(-num(p.detune, 7) - sc, t);
      g.o2.detune.setTargetAtTime(-num(p.detune, 7), t, 0.045);
    }
    const peak = 0.4 + 0.6 * clamp(vel, 0, 1);
    const tEnd = adsr(g.amp.gain, t, dur, { a, d: p.decay, s: p.sustain, r: p.release }, peak, { legato });
    const tRel = t + Math.max(dur, a + 0.01);
    // filter envelope (both stages)
    const kt = Math.pow(f / 261.6, clamp(num(p.keytrack, 0.55), 0, 1));
    const base = fclamp(num(p.cutoff, 2300) * kt * (0.55 + 0.6 * vel), 120, 12000);
    const env = num(p.envAmt, 1.3, 0, 5);
    const peakF = fclamp(base * Math.pow(2, env), 150, 16000);
    const susF = fclamp(base * Math.pow(2, env * clamp(num(p.filterSustain, 0.35), 0, 1)), 150, 16000);
    const fa = Math.max(0.005, num(p.filterAttack, 0.11)), fd = Math.max(0.02, num(p.filterDecay, 0.7));
    for (const lp of [g.lp, g.lp2]) {
      const fq = lp.frequency;
      fq.cancelScheduledValues(t);
      if (!legato) fq.setValueAtTime(base * 0.5, t);
      fq.setTargetAtTime(peakF, t, fa / 3);
      fq.setTargetAtTime(susF, t + fa * 2, fd / 3);
      fq.setTargetAtTime(base * 0.6, tRel, num(p.release, 0.55) / 3);
    }
    g.endAt = tEnd;
    g.sc.stopAll(tEnd);
    return this;
  }
}
