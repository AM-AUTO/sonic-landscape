/**
 * Arp — the round-6 Coe lead: an evolving modular arpeggio, never a clean line. One persistent mono voice (a saw and a
 * sine a fifth up whose level drifts), a two-pole low-pass opened per note by an accent envelope, tape saturation into a
 * fold, then crushed. Notes glide (portamento: nothing hops); the score decides which eighths play (skip probability
 * per stanza), the 5-step accent cycle across the 8-step bar and the register shift by stanza.
 *
 * No nodes are made per note: a note is automation on the persistent graph.
 *
 *   new Arp(engine, channel).start(t).note(midi, t, dur, accent).set({dark, level}, t).stop(t)
 */
import { num, clamp, fclamp, destOf } from '../fx/util.js';
import { midiToHz } from '../theory.js';
import { tape, fold, shaperCurve } from './dsp.js';

export const ARP_DEFAULTS = Object.freeze({ glide: 0.03, level: 0.5, dark: 0, bits: 8 });

export class Arp {
  constructor(engine, channel, patch = {}) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...ARP_DEFAULTS, ...patch };
    this.running = false; this.busyUntil = 0;
  }

  start(t = this.ctx.currentTime) {
    if (this.running) return this;
    const { ctx, engine } = this;
    const G = (v) => new GainNode(ctx, { gain: v });
    const nodes = this.nodes = [];
    const keep = (n) => { nodes.push(n); return n; };
    const saw = keep(new OscillatorNode(ctx, { type: 'sawtooth', frequency: 110 }));
    const sin = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 165 }));
    const sg = keep(G(0.6)), ng = keep(G(0.15));
    const drift = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 0.31 / (2 * Math.PI) })), dg = keep(G(0.15));
    drift.connect(dg); dg.connect(ng.gain);                      // the fifth's level drifts (sketch: 0.3·sin(0.31 t))
    const lp1 = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 160, Q: -3 }));
    const lp2 = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 160, Q: -3 }));
    const pre = keep(G(2 / 3));
    const shp = keep(new WaveShaperNode(ctx, { curve: shaperCurve((x) => fold(tape(x, 3.5, 0.2), 1.15), 3), oversample: '2x' }));
    const cr = keep(new WaveShaperNode(ctx, { curve: engine.crushCurve(num(this.p.bits, 8, 3, 12) | 0) }));
    const amp = keep(G(0)), lvl = keep(G(clamp(num(this.p.level, 0.5), 0, 1.5)));
    saw.connect(sg); sin.connect(ng); sg.connect(lp1); ng.connect(lp1); lp1.connect(lp2); lp2.connect(pre); pre.connect(shp); shp.connect(cr); cr.connect(amp); amp.connect(lvl); lvl.connect(this.dest);
    for (const o of [saw, sin, drift]) o.start(t);
    this.n = { saw, sin, lp1, lp2, amp };
    this.h = { level: engine.param('arp.level', lvl.gain) };
    this.running = true;
    return this;
  }

  /**
   * One arp note: glide to `midi`, open the filter by `accent` (1 on the 5-cycle, ~0.55 otherwise), `open` 0..1 the slow
   * brightness sweep (the sketch's 0.06 Hz), gate for `dur` s.
   */
  note(midi, t, dur, accent = 0.55, open = 0.5) {
    if (!this.running) return this;
    const p = this.p, n = this.n;
    const f = fclamp(midiToHz(num(midi, 45, 12, 100)), 20, 3000), tc = Math.max(0.002, num(p.glide, 0.03) / 3);
    for (const [o, m] of [[n.saw, 1], [n.sin, 1.5]]) { o.frequency.cancelScheduledValues(t); o.frequency.setTargetAtTime(f * m, t, tc); }
    const dark = clamp(num(p.dark, 0), 0, 1);
    const peak = fclamp((160 + (380 + 900 * clamp(open, 0, 1)) * clamp(accent, 0, 1.5)) * (1 - 0.4 * dark), 80, 6000);
    for (const lp of [n.lp1, n.lp2]) {
      lp.frequency.cancelScheduledValues(t);
      lp.frequency.setValueAtTime(peak, t);
      lp.frequency.setTargetAtTime(160 * (1 - 0.3 * dark), t + 0.002, 0.09);
    }
    dur = clamp(num(dur, 0.2), 0.03, 2);
    const a = n.amp.gain;
    a.cancelScheduledValues(t);
    a.setTargetAtTime(1, t, 0.001);
    a.setTargetAtTime(0, t + dur, 0.004);
    this.busyUntil = t + dur + 0.03;
    this.engine.record('arp.midi', midi); this.engine.record('arp.accent', accent);
    return this;
  }

  set(patch = {}, t = this.ctx.currentTime) {
    Object.assign(this.p, patch);
    if (this.running && patch.level !== undefined) this.h.level.set(clamp(num(this.p.level, 0.5), 0, 1.5), t, 0.2);
    return this;
  }

  stop(t = this.ctx.currentTime) {
    if (!this.running) return this;
    this.running = false;
    this.n.amp.gain.cancelScheduledValues(t); this.n.amp.gain.setTargetAtTime(0, t, 0.05);
    for (const o of [this.n.saw, this.n.sin]) { try { o.stop(t + 1); } catch (e) { /* gone */ } }
    const nodes = this.nodes;
    this.n.saw.onended = () => { for (const x of nodes) { try { x.stop && x.stop(); } catch (e) { /* gone */ } try { x.disconnect(); } catch (e) { /* gone */ } } };
    return this;
  }
}
