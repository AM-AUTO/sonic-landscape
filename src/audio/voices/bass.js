/**
 * Bass — sub sine + filtered saw (+ a touch of triangle for small-speaker presence), mono with
 * glide. A note that arrives while the previous graph is still alive reuses it (legato glide).
 *
 *   new Bass(engine, channel, patch).note(midi, t, dur, vel).glideTo(midi, t)
 */
import { Scope, num, clamp, fclamp, destOf, recordPatch, adsr, makeDriveCurve } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const BASS_DEFAULTS = Object.freeze({
  wave: 'sawtooth',
  sub: 0.9,         // sub sine level
  saw: 0.55,        // saw level
  tri: 0.25,        // triangle (octave up) for presence
  cutoff: 380,      // Hz base
  envAmt: 2.0,      // octaves filter opens on the attack
  filterDecay: 0.35,
  resonance: 3.2,
  attack: 0.012, decay: 0.4, sustain: 0.7, release: 0.28,
  glide: 0.07,      // portamento seconds
  drive: 0.35,      // soft saturation 0..1
  level: 0.19,
});

export class Bass {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...BASS_DEFAULTS, ...patch };
    this.cur = null;
    this.curve = makeDriveCurve(4, 1024);
  }
  set(patch = {}) { Object.assign(this.p, patch); recordPatch(this.engine, 'bass', patch); return this; }

  _build(t, f) {
    const { ctx } = this, p = this.p;
    const sc = new Scope(ctx);
    const sub = sc.osc('sine', f, t);
    const saw = sc.osc(p.wave, f, t);
    const tri = sc.osc('triangle', f * 2, t);
    saw.detune.value = 4;
    const gSub = sc.gain(num(p.sub, 0.9, 0, 2)), gSaw = sc.gain(num(p.saw, 0.55, 0, 2)), gTri = sc.gain(num(p.tri, 0.25, 0, 2));
    const lp = sc.biquad('lowpass', p.cutoff, p.resonance);
    const lp2 = sc.biquad('lowpass', p.cutoff * 1.3, 0.5);
    const sat = sc.add(new WaveShaperNode(ctx, { curve: this.curve }));
    const pre = sc.gain(1 + num(p.drive, 0.35, 0, 1) * 2.5);
    const post = sc.gain(1 / (1 + num(p.drive, 0.35, 0, 1) * 1.2));
    const amp = sc.gain(0);
    const lvl = sc.gain(clamp(num(p.level, 0.19), 0, 1.5));
    sub.connect(gSub); saw.connect(gSaw); tri.connect(gTri);
    gSaw.connect(lp); gTri.connect(lp); lp.connect(lp2);
    lp2.connect(pre); pre.connect(sat); sat.connect(post); post.connect(amp);
    gSub.connect(amp);
    amp.connect(lvl); lvl.connect(this.dest);
    return { sc, sub, saw, tri, lp, lp2, amp, startAt: t, endAt: t + 1, f };
  }

  note(midi, t = this.ctx.currentTime, dur = 0.5, vel = 0.8) {
    const { ctx, engine } = this, p = this.p;
    midi = num(midi, 36, 12, 84); dur = Math.max(0.05, num(dur, 0.5)); vel = clamp(num(vel, 0.8), 0, 1.2);
    recordPatch(engine, 'bass', p);
    engine.record('bass.vel', vel); engine.record('bass.dur', dur); engine.record('bass.midi', midi);
    const f = fclamp(midiToHz(midi), 20, 600);
    let g = this.cur;
    const legato = !!g && t < g.endAt - 0.05 && ctx.currentTime < g.endAt - 0.05 && t >= g.startAt;
    if (!legato) g = this.cur = this._build(t, f);
    const gl = Math.max(0.001, num(p.glide, 0.07));
    if (legato) {
      for (const [o, mul] of [[g.sub, 1], [g.saw, 1], [g.tri, 2]]) {
        o.frequency.cancelScheduledValues(t);
        o.frequency.setTargetAtTime(f * mul, t, gl / 3);
      }
    }
    const peak = 0.35 + 0.65 * vel;
    const tEnd = adsr(g.amp.gain, t, dur, { a: p.attack, d: p.decay, s: p.sustain, r: p.release }, peak, { legato });
    // filter envelope
    const base = fclamp(p.cutoff * (0.7 + 0.5 * vel) * Math.pow(f / 55, 0.35), 60, 8000);
    const top = fclamp(base * Math.pow(2, num(p.envAmt, 2)), 80, 12000);
    for (const lp of [g.lp, g.lp2]) {
      const mult = lp === g.lp2 ? 1.3 : 1;
      lp.frequency.cancelScheduledValues(t);
      if (legato) lp.frequency.setTargetAtTime(top * mult, t, 0.01); else lp.frequency.setValueAtTime(top * mult, t);
      lp.frequency.setTargetAtTime(base * mult, t + 0.01, Math.max(0.02, num(p.filterDecay, 0.35)) / 3);
    }
    g.endAt = tEnd; g.f = f;
    g.sc.stopAll(tEnd);
    return this;
  }

  /** glide the current voice to a new pitch (no retrigger). No-op if nothing is sounding. */
  glideTo(midi, t = this.ctx.currentTime) {
    midi = num(midi, 36, 12, 84);
    this.engine.record('bass.glideTo', midi);
    const g = this.cur;
    if (!g || t >= g.endAt) return this;
    const f = fclamp(midiToHz(midi), 20, 600);
    const tc = Math.max(0.01, num(this.p.glide, 0.07) * 2) / 3;
    for (const [o, mul] of [[g.sub, 1], [g.saw, 1], [g.tri, 2]]) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setTargetAtTime(f * mul, t, tc);
    }
    g.f = f;
    return this;
  }
}
