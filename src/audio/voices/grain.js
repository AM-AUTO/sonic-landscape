/**
 * Grain — the palette's small percussion: grain clicks (3–12 ms saturated noise bursts, or slices of the level's own
 * played material), dirty metal hits (contra B), buffer-repeat stutters and crushed reverse swells. All pre-rendered
 * per level (warmItems) and played as one-shots: a buffer source, a gain and (for panned hits) a panner.
 *
 *   new Grain(engine, channel).warmItems(seed, {metalMidi, material}) → [fn]   then
 *   click(t, vel, pan) · metal(t, vel, pan) · stutter(tEnd, slice, reps, vel, dest?) · swell(tEnd, len, vel, dest?)
 */
import { mulberry32 } from '../../core/rng.js';
import { num, clamp, destOf } from '../fx/util.js';
import { midiToHz } from '../theory.js';
import { grainClick, metalHitGen, dirty, reverseSwellGen, normalise, sliced } from './dsp.js';

export class Grain {
  constructor(engine, channel) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.clicks = []; this.slices = []; this.metals = []; this.material = null; this.swellBuf = null;
  }

  _buf(data) {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.getChannelData(0).set(data);
    return b;
  }

  /** per-level pre-render. `material()` returns the level's played source (a Float32Array) once it exists, else null. */
  warmItems(seed, { metalMidi = 76, material = () => null } = {}) {
    const sr = this.ctx.sampleRate, rng = mulberry32((seed * 40503 + 17) >>> 0);
    this.clicks = []; this.slices = []; this.metals = []; this.swellBuf = null; this.materialFn = material;
    const items = [() => { for (let k = 0; k < 12; k++) this.clicks.push(this._buf(grainClick(sr, rng, { level: 0.85 }))); }];
    for (let k = 0; k < 2; k++) {
      items.push(sliced(() => metalHitGen(sr, rng, midiToHz(metalMidi + (k ? 12 : 0)) * (1 + (rng() - 0.5) * 0.01), { level: 0.5, decay: k ? 0.25 : 0.35, len: k ? 0.45 : 0.6 }),
        (x) => { this.metals.push(this._buf(normalise(dirty(x, 6, 2), 0.8))); }));
    }
    // slices and the reverse swell need the played material (made by the eroding-loop layer): retried until it exists
    items.push(() => {
      const m = material();
      if (!m) return false;
      for (let k = 0; k < 10; k++) this.slices.push(this._buf(grainClick(sr, rng, { level: 0.9, src: m })));
      this.material = this._buf(m);
      return true;
    });
    items.push(sliced(() => { const m = material(); return m ? reverseSwellGen(sr, m.subarray(0, Math.min(m.length, Math.floor(1.2 * sr))), { sec: 2.6, bits: 6 }) : null; },
      (x) => { this.swellBuf = this._buf(x); }));
    return items;
  }

  _shot(buf, t, gain, pan, { rate = 1, dest = this.dest, offset = 0, dur = null } = {}) {
    const { ctx } = this;
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: rate });
    const g = new GainNode(ctx, { gain });
    src.connect(g);
    let p = null;
    if (Math.abs(pan) > 0.02) { p = new StereoPannerNode(ctx, { pan: clamp(pan, -1, 1) }); g.connect(p); p.connect(dest); } else g.connect(dest);
    if (dur != null) src.start(t, offset, dur); else src.start(t, offset);
    src.onended = () => { try { src.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) { /* gone */ } };
    return g;
  }

  get ready() { return this.clicks.length > 0; }

  /** a grain click: half the time a slice of the played material once it exists */
  click(t, vel = 0.5, pan = 0, rng = this.engine.rng) {
    const pool = this.slices.length && rng.float() < 0.5 ? this.slices : this.clicks;
    if (!pool.length) return false;
    this._shot(pool[rng.int(0, pool.length - 1)], t, clamp(num(vel, 0.5), 0, 1.5), pan, { rate: 0.8 + 0.5 * rng.float() });
    this.engine.record('grain.vel', vel);
    return true;
  }

  /** a dirty struck-metal hit (contra B) */
  metal(t, vel = 0.4, pan = 0.3, rng = this.engine.rng) {
    if (!this.metals.length) return false;
    this._shot(this.metals[rng.chance(0.75) ? 0 : this.metals.length - 1], t, clamp(num(vel, 0.4), 0, 1.5), pan, { rate: 1 + (rng.float() - 0.5) * 0.004 });
    this.engine.record('grain.metal', vel);
    return true;
  }

  /**
   * Buffer-repeat stutter landing on tEnd: one slice of the played material (or `buf`) repeated `reps` times, each a
   * little quieter, the last ending exactly at tEnd. Returns false when there is no material yet.
   */
  stutter(tEnd, slice, reps = 4, vel = 0.5, dest = this.dest, buf = null, rng = this.engine.rng) {
    const b = buf || this.material;
    if (!b) return false;
    slice = clamp(num(slice, 0.1), 0.02, 0.5); reps = Math.max(2, Math.min(8, reps | 0));
    const maxOff = Math.max(0, b.duration - slice - 0.01);
    const off = Math.min(maxOff, 0.015 + rng.float() * Math.min(0.4, maxOff));
    for (let r = 0; r < reps; r++) {
      const t = tEnd - (reps - r) * slice;
      if (t < this.ctx.currentTime) continue;
      const g = this._shot(b, t, 0, 0, { offset: off, dur: slice, dest });
      const peak = vel * 0.85 ** (reps - 1 - r) * (r === reps - 1 ? 1 : 0.9);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.setValueAtTime(peak, t + slice - 0.003); g.gain.linearRampToValueAtTime(0, t + slice);
    }
    this.engine.record('grain.stutter', reps);
    return true;
  }

  /** a crushed reverse swell growing into tEnd (len ≤ its buffer); false when it is not rendered yet */
  swell(tEnd, len, vel = 0.5, dest = this.dest) {
    const b = this.swellBuf;
    if (!b) return false;
    len = Math.min(b.duration - 0.01, Math.max(0.2, num(len, 1.5)));
    const t = tEnd - len;
    if (t < this.ctx.currentTime) return false;
    this._shot(b, t, clamp(num(vel, 0.5), 0, 1.5), 0, { offset: b.duration - len, dest });
    this.engine.record('grain.swell', len);
    return true;
  }
}
