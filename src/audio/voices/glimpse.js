/**
 * Glimpse — a few notes of the ground surfacing on worn tines for about a bar (the round-6 glimpse): an FM tine (body
 * plus bark) rendered per pitch and then worn — wow, fewer bits, a closing low-pass, a little crackle — so it reads as
 * a memory, never a clean bell. Quiet; played as one-shots (a buffer source and a gain per note).
 *
 * Also the voice of the ghost fragments (motifs of completed levels) in the grit palette.
 *
 *   new Glimpse(engine, channel).warmItems(seed, midis) → [fn];  phrase([{midi, grace}], t, spread, vel, dest?)
 */
import { mulberry32 } from '../../core/rng.js';
import { num, clamp, destOf } from '../fx/util.js';
import { midiToHz } from '../theory.js';
import { tineGen, wearGen, runGen, sliced } from './dsp.js';

export class Glimpse {
  constructor(engine, channel) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.cache = new Map();
    this.rng = mulberry32(99);
  }

  _key(midi, grace) { return Math.round(midi) + (grace ? ':' + Math.round(grace) : ''); }

  /** render (or fetch) the worn tine of `midi` (with an optional grace midi blipped at the attack) */
  buffer(midi, grace = null) {
    const b = this.cache.get(this._key(midi, grace));
    return b || this._store(midi, grace, runGen(this._gen(midi, grace)));
  }

  *_gen(midi, grace) {
    const sr = this.ctx.sampleRate;
    const raw = yield* tineGen(sr, midiToHz(Math.round(midi)), { vel: 0.45, level: 0.5, dur: 2.2, grace: grace ? midiToHz(Math.round(grace)) : null });
    return yield* wearGen(sr, this.rng, raw, { bits: 9, hold: 2, fc: 2600 + 1200 * this.rng(), wow: 0.004 });
  }

  _store(midi, grace, w) {
    const b = this.ctx.createBuffer(1, w.length, this.ctx.sampleRate);
    b.getChannelData(0).set(w);
    if (this.cache.size > 80) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(this._key(midi, grace), b);
    return b;
  }

  /** pre-render items for the pitches a level's glimpses use ([{midi, grace}]) */
  warmItems(seed, notes) {
    this.rng = mulberry32((seed * 2246822519) >>> 0);
    const seen = new Set();
    const items = [];
    for (const n of notes) {
      const k = this._key(n.midi, n.grace);
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(sliced(() => (this.cache.has(k) ? (function* () { return null; }()) : this._gen(n.midi, n.grace)), (w) => { if (w) this._store(n.midi, n.grace, w); }));
    }
    return items;
  }

  has(midi, grace = null) { return this.cache.has(this._key(midi, grace)); }

  /**
   * play notes [{midi, grace}] from t, `spread` s apart (with a little human drift), at velocity vel. A pitch not
   * pre-rendered yet is skipped (never rendered at trigger time) unless `render` is set; returns the notes played.
   */
  phrase(notes, t, spread, vel = 0.3, dest = this.dest, rng = this.engine.rng, render = false) {
    let n = 0;
    notes.forEach((x, k) => {
      if (!Number.isFinite(x.midi)) return;
      if (!render && !this.has(x.midi, x.grace)) { this.skipped = (this.skipped || 0) + 1; return; }
      const b = this.buffer(x.midi, x.grace);
      const tt = t + k * spread + (k ? (rng.float() - 0.5) * 0.03 : 0);
      const src = new AudioBufferSourceNode(this.ctx, { buffer: b });
      const g = new GainNode(this.ctx, { gain: clamp(num(vel, 0.3), 0, 1.2) * (0.85 + 0.25 * rng.float()) });
      src.connect(g); g.connect(dest); src.start(Math.max(tt, this.ctx.currentTime));
      src.onended = () => { try { src.disconnect(); g.disconnect(); } catch (e) { /* gone */ } };
      n++;
    });
    this.engine.record('glimpse.notes', n);
    return n;
  }
}
