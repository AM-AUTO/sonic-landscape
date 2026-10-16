/**
 * ErodeLoop — a played source heard only as eroded material. One bar of the level's played source (a strummed string
 * in a cold voicing, or the ground's first notes on tines) is captured on a chosen stanza downbeat and then loops bar by
 * bar, ageing: wow and flutter, dropouts, fewer bits, a closing filter, crackle. It is re-captured on the pibroch form
 * steps.
 *
 * With the engine's `erode` worklet (engine.erode, phase 2A) the fresh source is fed straight into the erode recorder
 * (never heard dry) and captureAt() does the rest. Without it the voice uses its own fallback: the source and its
 * `passes` eroded versions are rendered in JS (one pass per pre-warm item) and the loop plays pass k on bar k after
 * the capture, reaching the most worn pass after `ageStanzas` stanzas and staying there until the next capture.
 *
 *   new ErodeLoop(engine, channel).warmItems(seed, {source, midis, sr}) → [fn];  capture(t, barDur, stanzaBars);  onBar(t, barDur)
 */
import { mulberry32 } from '../../core/rng.js';
import { num, clamp, destOf } from '../fx/util.js';
import { midiToHz } from '../theory.js';
import { strumGen, tineGen, erodePassGen, sliced } from './dsp.js';
import { hasErode, erodeInput, erodeCapture, erodeLevel } from './io.js';

export const ERODE_PASSES = 8;

export class ErodeLoop {
  constructor(engine, channel) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.frag = null; this.passes = []; this.capturedAt = null; this.bars = 0; this.ageBars = 16;
    this.captures = 0; this.native = false;
  }

  /** the raw material (a Float32Array) once rendered — also the grain voice's slices and the stutters' source */
  get material() { return this.frag; }

  /**
   * Per-level pre-render. source 'pluck': a strum of `midis` (cold voicing); 'tine': the ground's first notes on tines
   * (`notes` [{midi, beats}], `beat` s). `barSec`: the loop length (one bar at the level's tempo).
   */
  warmItems(seed, { source = 'pluck', midis = [45, 52, 59, 62, 64, 69], notes = [], beat = 0.9, barSec = 3.6 } = {}) {
    const sr = this.ctx.sampleRate, rng = mulberry32((seed * 69069 + 5) >>> 0);
    this.frag = null; this.passes = []; this.capturedAt = null; this.source = source;
    const len = Math.max(0.5, Math.min(6, barSec));
    this.native = hasErode(this.engine);
    function* tines() {
      const f = new Float32Array(Math.ceil(len * sr));
      let at = 0.01;
      for (const n of notes.slice(0, 4)) {
        const s = yield* tineGen(sr, midiToHz(n.midi), { vel: 0.6, level: 0.45, dur: Math.min(2.5, len - at + 0.3) });
        const i0 = Math.floor(at * sr);
        for (let j = 0; j < s.length && i0 + j < f.length; j++) f[i0 + j] += s[j];
        at += Math.max(0.25, n.beats * beat);
        if (at >= len) break;
      }
      return f;
    }
    const items = [sliced(() => (source === 'tine' ? tines() : strumGen(sr, rng, midis, { dur: len, level: 0.42, bright: 0.45 })), (f) => {
      const fd = Math.floor(0.006 * sr); for (let j = 0; j < fd; j++) f[f.length - 1 - j] *= j / fd;
      this.frag = f;
      this.fragBuf = this._buf(f);
    })];
    if (!this.native) {
      for (let k = 0; k < ERODE_PASSES; k++) {
        const deg = 0.12 + 0.68 * (k / (ERODE_PASSES - 1));            // the most worn pass ~0.8 (age 1 is mostly dropouts)
        items.push(sliced(() => (this.frag ? erodePassGen(sr, rng, this.frag, deg, { maxWow: 0.015, pass: k }) : null), (out) => { this.passes[k] = this._buf(out); }));
      }
    }
    return items;
  }

  _buf(data) {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.getChannelData(0).set(data);
    return b;
  }

  get ready() { return this.native ? !!this.fragBuf : this.passes.length === ERODE_PASSES && this.passes.every(Boolean); }

  /** capture one bar at t (a stanza downbeat); the loop then ages over `ageStanzas` stanzas */
  capture(t, barDur, stanzaBars = 4, ageStanzas = 4) {
    if (!this.fragBuf) return false;
    this.capturedAt = t; this.bars = 0; this.captures++;
    this.ageBars = Math.max(2, Math.round(stanzaBars * ageStanzas));
    this.engine.record('erode.capture', this.captures);
    if (this.native) {
      const inp = erodeInput(this.engine);
      if (inp) {
        const src = new AudioBufferSourceNode(this.ctx, { buffer: this.fragBuf });
        const g = new GainNode(this.ctx, { gain: 3 });                   // the strum is quiet: record it hot (the recorder hears it, no one else)
        src.connect(g); g.connect(inp); src.start(t, 0, Math.min(this.fragBuf.duration, barDur));
        src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* gone */ } };
      }
      // one pass per bar; fully aged (age 1) is mostly dropouts, so the age reaches ~0.8 only after twice the ageing span
      // (by then the score has re-captured: palette.planGrit forces a capture every 2·ageStanzas stanzas)
      erodeCapture(this.engine, t, barDur, { age: 0.12, passes: Math.round(this.ageBars * 2.6) });
    }
    return true;
  }

  /** at each bar line while captured (fallback only): the next, older pass, one bar long */
  onBar(t, barDur, level = 1) {
    if (this.native || this.capturedAt === null || t < this.capturedAt - 1e-6 || !this.ready) return false;
    const k = Math.min(ERODE_PASSES - 1, Math.floor(this.bars * (ERODE_PASSES - 1) / this.ageBars));
    this.bars++;
    if (!(level > 0.02)) return false;
    const b = this.passes[k];
    const src = new AudioBufferSourceNode(this.ctx, { buffer: b });
    const g = new GainNode(this.ctx, { gain: 1 });
    src.connect(g); g.connect(this.dest);
    const dur = Math.min(b.duration, barDur + 0.004);
    src.start(t, 0, dur);
    if (dur < b.duration) { g.gain.setValueAtTime(1, t + dur - 0.006); g.gain.linearRampToValueAtTime(0, t + dur); }
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* gone */ } };
    this.engine.record('erode.pass', k);
    return true;
  }

  /** the layer level of the engine's erode return (native path only; the fallback is levelled by its channel) */
  setLevel(v, t, tc = 0.1) {
    if (!this.native) return false;
    if (this._lv !== undefined && Math.abs(this._lv - v) < 0.004) return true;
    this._lv = v;
    return erodeLevel(this.engine, clamp(num(v, 0), 0, 2), t, tc);
  }

  /** the age of the loop 0..1 (fallback: bars since the capture over the ageing span) */
  get age() { return this.capturedAt === null ? 0 : clamp(this.bars / this.ageBars, 0, 1); }
}
