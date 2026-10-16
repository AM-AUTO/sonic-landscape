/**
 * ResPad — the resonator pad: pitch heard only as resonance inside noise. It holds up to six targets
 * [{f, g, gain}] (Hz, feedback 0..1 — the ring time —, level) built by the score from the ground's current pitch
 * and the drone's root and fifth, and glides them to new targets on bar / stanza lines.
 *
 * With the engine's `resonators` worklet (engine.res, phase 2A) it only drives that: setTargets() scaled by the layer
 * level, the engine's own pink noise as excitation. Without it (2A not merged, the worklet failed, fake audio in the
 * tests) it builds its own fallback: looped pink noise into six narrow band-passes (Q from the feedback), a tape
 * saturator, the layer gain.
 *
 *   new ResPad(engine, channel).start(t).setTargets(targets, glide, t).setLevel(v, t, glide).bloom(t, amount, sec)
 */
import { num, clamp, fclamp, destOf } from '../fx/util.js';
import { hasRes, resTargets, resNoise } from './io.js';
import { tape, shaperCurve } from './dsp.js';

export const RES_MAX = 6;
/** the engine resonators: the pink-noise excitation level, and the gain each target's level is scaled by (gain 0..4) */
const NATIVE_NOISE = 0.8, NATIVE_GAIN = 2;

export class ResPad {
  constructor(engine, channel) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.targets = []; this.level = 0; this.boost = 1;
    this.running = false; this.native = false;
  }

  start(t = this.ctx.currentTime) {
    if (this.running) return this;
    this.running = true;
    this.native = hasRes(this.engine);
    if (this.native) { resNoise(this.engine, NATIVE_NOISE, t, 1); return this; }
    const { ctx, engine } = this;
    const nodes = this.nodes = [];
    const keep = (n) => { nodes.push(n); return n; };
    const buf = engine.noiseBuffer('pink', 12);
    const src = keep(new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }));
    const sum = keep(new GainNode(ctx, { gain: 1 }));
    this.bands = [];
    for (let i = 0; i < RES_MAX; i++) {
      const bp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 220 * (i + 1), Q: 30 }));
      const g = keep(new GainNode(ctx, { gain: 0 }));
      src.connect(bp); bp.connect(g); g.connect(sum);
      this.bands.push({ bp, g });
    }
    const pre = keep(new GainNode(ctx, { gain: 1 / 3 }));
    const sat = keep(new WaveShaperNode(ctx, { curve: shaperCurve((x) => tape(x, 2.5, 0.1), 3) }));
    const out = keep(new GainNode(ctx, { gain: 0 }));
    sum.connect(pre); pre.connect(sat); sat.connect(out); out.connect(this.dest);
    src.start(t, engine.rng.float() * buf.duration * 0.9);
    this.src = src; this.out = out;
    this.hLevel = engine.param('respad.level', out.gain);
    return this;
  }

  /** a target's band-pass Q from its feedback (0.9 → ~12, 0.97 → ~45) and a gain that keeps narrow bands audible */
  _q(g) { return clamp(1 / Math.max(0.005, 1 - clamp(num(g, 0.95), 0, 0.995)) * 1.4, 4, 80); }

  _push(t, glide) {
    const lv = this.level * this.boost;
    const T = this.targets.slice(0, RES_MAX);
    if (this.native) {
      resTargets(this.engine, T.map((x) => ({ f: x.f, g: x.g, gain: Math.min(4, x.gain * lv * NATIVE_GAIN), pan: x.pan })), glide, t);
      return;
    }
    if (!this.bands) return;
    const tc = Math.max(0.01, glide / 3);
    this.bands.forEach((b, i) => {
      const x = T[i];
      b.g.gain.cancelScheduledValues(t);
      if (!x) { b.g.gain.setTargetAtTime(0, t, tc); return; }
      const q = this._q(x.g);
      b.bp.frequency.cancelScheduledValues(t); b.bp.frequency.setTargetAtTime(fclamp(x.f, 30, 6000), t, tc);
      b.bp.Q.cancelScheduledValues(t); b.bp.Q.setTargetAtTime(q, t, tc);
      b.g.gain.setTargetAtTime(clamp(num(x.gain, 0.3), 0, 2) * Math.sqrt(q) * 2.2, t, tc);   // narrow bands pass little energy: make it up
    });
  }

  /** new targets [{f, g, gain}] glided over `glide` s from t */
  setTargets(targets, glide = 1, t = this.ctx.currentTime) {
    this.targets = (targets || []).filter((x) => x && Number.isFinite(x.f) && x.f > 0).slice(0, RES_MAX);
    for (const x of this.targets) this.engine.record('respad.f', x.f);
    if (this.running) this._push(t, glide);
    return this;
  }

  /** the layer level (arrangement), glided */
  setLevel(v, t = this.ctx.currentTime, glide = 0.5) {
    v = clamp(num(v, 0), 0, 2);
    if (Math.abs(v - this.level) < 1e-4) return this;
    this.level = v;
    if (!this.running) return this;
    if (this.native) { this._push(t, glide); resNoise(this.engine, NATIVE_NOISE * (0.6 + 0.4 * Math.min(1, v)), t, Math.max(0.05, glide / 3)); }
    else this.hLevel.set(v, t, Math.max(0.01, glide / 3));
    return this;
  }

  /** a bloom (artefact entry): the resonators swell by `amount` over ~0.3 s and settle back over `sec` */
  bloom(t, amount = 2.5, sec = 4) {
    if (!this.running) return this;
    this.engine.record('respad.bloom', amount);
    if (this.native) {
      this.boost = amount; this._push(t, 0.3);
      this.boost = 1; this._push(t + 0.6, sec);
      return this;
    }
    const p = this.out.gain, v = this.level;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(v * amount, t, 0.1);
    p.setTargetAtTime(v, t + 0.6, sec / 3);
    return this;
  }

  stop(t = this.ctx.currentTime) {
    if (!this.running) return this;
    this.running = false;
    if (this.native) { resTargets(this.engine, [], 2, t); resNoise(this.engine, 0, t, 1); return this; }
    this.out.gain.cancelScheduledValues(t); this.out.gain.setTargetAtTime(0, t, 0.8);
    try { this.src.stop(t + 4); } catch (e) { /* gone */ }
    const nodes = this.nodes;
    this.src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    return this;
  }
}
