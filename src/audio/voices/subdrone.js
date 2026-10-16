/**
 * SubDrone — the sub and the beating, distorted drone (the sketches' subAndBeat + droneWall's saturated folded layer).
 *
 *   sub    two sines a fifth-free octave apart (root−24, root−12: A1 + A2 on an A track), tape-saturated, mono
 *   beat   five detuned saws on root−12 / fifth−12 / root (A2 −7/+6 c, E3 −5/+8 c, A3 +3 c) through heavy tape
 *          saturation and a slowly moving low-pass: the beating mid drone
 *   wall   the same saws driven harder into a fold, low-passed at 900 + 2600·wall: the forceful layer
 *
 * The root–fifth relationship is constant (the album's A–E drone): setRoot() glides the whole voice to a new tonic
 * (a level change), chord changes never move it. One control, `wall` 0..1, raises saturation, brightness and the
 * folded layer's level together; `dark` 0..1 (night) closes the low-passes.
 *
 *   new SubDrone(engine, {sub: ch, beat: ch}).start(t).setRoot(midi, t, glide).set({sub, beat, wall, dark}, t, tc).stop(t)
 */
import { num, clamp, fclamp, destOf } from '../fx/util.js';
import { midiToHz } from '../theory.js';
import { tape, fold, shaperCurve } from './dsp.js';

const BEAT = [[-12, -7], [-12, 6], [-5, -5], [-5, 8], [0, 3]];     // [semitones from the root, cents]
const R = 4;                                                       // shaper input range

export const SUBDRONE_DEFAULTS = Object.freeze({ sub: 0.5, beat: 0.35, wall: 0.3, dark: 0, fadeIn: 4 });

export class SubDrone {
  constructor(engine, { sub, beat }, patch = {}) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dSub = destOf(sub); this.dBeat = destOf(beat || sub);
    this.p = { ...SUBDRONE_DEFAULTS, ...patch };
    this.root = 57; this.running = false;
  }

  start(t = this.ctx.currentTime) {
    if (this.running) return this;
    const { ctx, engine } = this, p = this.p, root = this.root;
    const G = (v) => new GainNode(ctx, { gain: v });
    const nodes = this.nodes = [];
    const keep = (n) => { nodes.push(n); return n; };
    // ---- sub
    const s1 = keep(new OscillatorNode(ctx, { type: 'sine', frequency: midiToHz(root - 24) }));
    const s2 = keep(new OscillatorNode(ctx, { type: 'sine', frequency: midiToHz(root - 12) }));
    const g1 = keep(G(0.7)), g2 = keep(G(0.4)), sPre = keep(G(1.4 / R));
    const sShape = keep(new WaveShaperNode(ctx, { curve: shaperCurve((x) => tape(x, 1.4, 0.05), R) }));
    const subG = keep(G(0)), subFade = keep(G(0));
    s1.connect(g1); s2.connect(g2); g1.connect(sPre); g2.connect(sPre); sPre.connect(sShape); sShape.connect(subG); subG.connect(subFade); subFade.connect(this.dSub);
    // ---- beating saws
    const sum = keep(G(0.25));
    this.saws = BEAT.map(([semi, cents]) => {
      const o = keep(new OscillatorNode(ctx, { type: 'sawtooth', frequency: midiToHz(root + semi), detune: cents }));
      o.connect(sum);
      return { o, semi };
    });
    const bPre = keep(G(2.5 / R));
    const bShape = keep(new WaveShaperNode(ctx, { curve: shaperCurve((x) => tape(x, 4, 0.25), R), oversample: '2x' }));
    const bLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1100, Q: -1 }));
    const lfo = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 0.21 / (2 * Math.PI) }));
    const lfoG = keep(G(260));                                       // cents of cutoff drift (the sketch's 0.7 + 0.3 sin)
    lfo.connect(lfoG); lfoG.connect(bLp.detune);
    const beatG = keep(G(0));
    sum.connect(bPre); bPre.connect(bShape); bShape.connect(bLp); bLp.connect(beatG);
    // ---- folded wall layer
    const wPre = keep(G(3.5 / R));
    const wShape = keep(new WaveShaperNode(ctx, { curve: shaperCurve((x) => fold(tape(x, 4, 0.2), 1.3), R), oversample: '2x' }));
    const wLp = keep(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1200, Q: -2 }));
    const wallG = keep(G(0));
    sum.connect(wPre); wPre.connect(wShape); wShape.connect(wLp); wLp.connect(wallG);
    const beatFade = keep(G(0));
    beatG.connect(beatFade); wallG.connect(beatFade); beatFade.connect(this.dBeat);
    for (const f of [subFade, beatFade]) { f.gain.setValueAtTime(0, t); f.gain.linearRampToValueAtTime(1, t + Math.max(0.05, num(p.fadeIn, 4))); }
    for (const n of nodes) if (typeof n.start === 'function') n.start(t);
    this.fades = [subFade, beatFade];
    this.n = { s1, s2, subG, bPre, bLp, beatG, wPre, wLp, wallG };
    this.h = {
      sub: engine.param('subdrone.sub', subG.gain),
      beat: engine.param('subdrone.beat', beatG.gain),
      wall: engine.param('subdrone.wall', wallG.gain),
      beatCut: engine.param('subdrone.beatCutoff', bLp.frequency),
      wallCut: engine.param('subdrone.wallCutoff', wLp.frequency),
      drive: engine.param('subdrone.drive', bPre.gain),
    };
    this.running = true;
    this.set({ ...p }, t, 0.5);
    return this;
  }

  /** glide the whole drone (sub, saws) to a new tonic; the fifth comes with it */
  setRoot(midi, t = this.ctx.currentTime, glide = 4) {
    this.root = num(midi, 57, 24, 84);
    this.engine.record('subdrone.root', this.root);
    if (!this.running) return this;
    const tc = Math.max(0.01, glide / 3);
    const go = (param, f) => { param.cancelScheduledValues(t); param.setTargetAtTime(fclamp(f, 15, 4000), t, tc); };
    go(this.n.s1.frequency, midiToHz(this.root - 24));
    go(this.n.s2.frequency, midiToHz(this.root - 12));
    for (const s of this.saws) go(s.o.frequency, midiToHz(this.root + s.semi));
    return this;
  }

  /** sub / beat levels (0..1.5), wall 0..1 (saturation, brightness and the folded layer), dark 0..1 */
  set(patch = {}, t = this.ctx.currentTime, tc = 0.3) {
    Object.assign(this.p, patch);
    if (!this.running) return this;
    const p = this.p, w = clamp(num(p.wall, 0.3), 0, 1), dark = clamp(num(p.dark, 0), 0, 1);
    if (patch.sub !== undefined) this.h.sub.set(clamp(num(p.sub, 0.5), 0, 1.5), t, tc);
    if (patch.beat !== undefined || patch.wall !== undefined) this.h.beat.set(clamp(num(p.beat, 0.35), 0, 1.5) * (0.7 + 0.5 * w), t, tc);
    if (patch.wall !== undefined || patch.dark !== undefined) {
      this.h.drive.set((1.6 + 3.4 * w) / R, t, tc);
      this.h.beatCut.set((700 + 1400 * w) * (1 - 0.45 * dark), t, tc);
      this.h.wallCut.set((900 + 2600 * w) * (1 - 0.5 * dark), t, tc);
      this.h.wall.set(0.55 * w * w * clamp(num(p.beat, 0.35), 0, 1.5) * 1.6, t, tc);
    }
    return this;
  }

  stop(t = this.ctx.currentTime, release = 3) {
    if (!this.running) return this;
    this.running = false;
    for (const f of this.fades) { f.gain.cancelScheduledValues(t); f.gain.setTargetAtTime(0, t, release / 4); }
    const end = t + release * 2;
    for (const n of this.nodes) if (typeof n.stop === 'function') { try { n.stop(end); } catch (e) { /* gone */ } }
    const nodes = this.nodes;
    const src = nodes.find((n) => typeof n.stop === 'function');
    if (src) src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    return this;
  }
}
