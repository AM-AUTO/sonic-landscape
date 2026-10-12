/**
 * Bell — 2-operator FM with inharmonic carrier:modulator ratios, a decaying modulation index
 * (bright strike → pure ring) and long exponential decays. Kinds: glass, bowl, tine.
 * `bowl` adds a second, slightly detuned carrier for the slow beating of a singing bowl.
 *
 *   new Bell(engine, channel, patch).note(midi, t, dur, vel)
 */
import { Scope, num, clamp, fclamp, destOf, recordPatch } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const BELL_KINDS = Object.freeze({
  //            mod:carrier ratio, index start→end, decay (s, ~-60 dB), beat (Hz), partial (inharmonic 2nd carrier ratio, level)
  glass: { ratio: 3.5,   index: 3.6, indexEnd: 0.35, decay: 6.5, beat: 0.0, partial: 0, partialLevel: 0 },
  bowl:  { ratio: 2.003, index: 1.4, indexEnd: 0.15, decay: 9.0, beat: 1.6, partial: 2.71, partialLevel: 0.12 },
  tine:  { ratio: 5.43,  index: 4.6, indexEnd: 0.2,  decay: 2.8, beat: 0.0, partial: 0, partialLevel: 0 },
});

export const BELL_DEFAULTS = Object.freeze({
  kind: 'glass',
  ratio: null, index: null, indexEnd: null, decay: null, beat: null,   // null = take from kind
  indexDecay: 0.45,   // fraction of the amp decay over which the index falls
  attack: 0.002,
  level: 0.3,
  brightness: 1,      // scales index with velocity response
  dampDur: 0,         // 0 = ring freely; >0 = fade quickly when dur is shorter (damped bell)
});

export class Bell {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...BELL_DEFAULTS, ...patch };
  }
  set(patch = {}) { Object.assign(this.p, patch); recordPatch(this.engine, 'bell', patch); return this; }

  note(midi, t = this.ctx.currentTime, dur = 1, vel = 0.8) {
    const { ctx, engine } = this, p = this.p;
    midi = num(midi, 72, 24, 120); dur = Math.max(0.05, num(dur, 1)); vel = clamp(num(vel, 0.8), 0, 1.2);
    const k = BELL_KINDS[p.kind] || BELL_KINDS.glass;
    const ratio = num(p.ratio ?? k.ratio, 3.5, 0.1, 20);
    const idx0 = num(p.index ?? k.index, 3, 0, 20) * (0.45 + 0.75 * vel) * num(p.brightness, 1, 0, 3);
    const idx1 = num(p.indexEnd ?? k.indexEnd, 0.3, 0, 10);
    const decay = clamp(num(p.decay ?? k.decay, 6, 0.2, 20), 0.2, 20);
    const beat = num(p.beat ?? k.beat, 0, 0, 12);
    const level = clamp(num(p.level, 0.3), 0, 1.5) * (0.25 + 0.75 * vel);
    recordPatch(engine, 'bell', p);
    engine.record('bell.vel', vel); engine.record('bell.dur', dur); engine.record('bell.midi', midi);
    engine.record('bell.ratioUsed', ratio); engine.record('bell.indexUsed', idx0); engine.record('bell.decayUsed', decay);

    const f = fclamp(midiToHz(midi), 30, 5000);
    const sc = new Scope(ctx);
    const A = Math.max(0.0005, num(p.attack, 0.002));
    const tEnd = t + decay * 1.5 + 0.2;
    const amp = sc.gain(0);
    const lvl = sc.gain(level);
    amp.connect(lvl); lvl.connect(this.dest);
    // amplitude: fast attack, exponential decay (-60 dB at `decay`)
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + A);
    amp.gain.setTargetAtTime(0, t + A, decay / 6.9);
    if (num(p.dampDur, 0) > 0 && dur < decay) {
      const tr = t + dur;
      amp.gain.setTargetAtTime(0, tr, 0.02 + 0.3 / num(p.dampDur, 1));
    }
    const nCar = beat > 0 ? 2 : 1;
    const mod = sc.osc('sine', f * ratio, t, tEnd);
    const modG = sc.gain(0);          // depth in Hz
    const d0 = idx0 * f * ratio, d1 = idx1 * f * ratio;
    modG.gain.setValueAtTime(d0, t);
    modG.gain.setTargetAtTime(d1, t + A, (decay * clamp(num(p.indexDecay, 0.45), 0.02, 1)) / 6.9);
    mod.connect(modG);
    for (let c = 0; c < nCar; c++) {
      const car = sc.osc('sine', c === 0 ? f : f + beat, t, tEnd);
      modG.connect(car.frequency);
      const cg = sc.gain(nCar > 1 ? 0.6 : 1);
      car.connect(cg); cg.connect(amp);
    }
    if (k.partial && k.partialLevel) {
      const pf = fclamp(f * k.partial, 40, 12000);
      const pr = sc.osc('sine', pf, t, tEnd);
      const pg = sc.gain(0);
      pg.gain.setValueAtTime(k.partialLevel, t);
      pg.gain.setTargetAtTime(0, t, decay / 14);
      pr.connect(pg); pg.connect(amp);
    }
    sc.arm();
    return this;
  }
}
