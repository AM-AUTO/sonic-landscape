/**
 * Pluck — Karplus-Strong string. A Web Audio DelayNode inside a feedback cycle has a minimum
 * delay of one render quantum (128 samples ≈ 2.9 ms), which caps a DelayNode-based KS at about
 * 340 Hz — useless for kalimba/harp registers. So the string is synthesised in JS with a
 * fractional-delay (allpass-tuned) KS loop into an AudioBuffer, cached per (kind, pitch, params),
 * and played back through a velocity-controlled lowpass. Identical results online/offline.
 *
 *   new Pluck(engine, channel, patch).note(midi, t, dur, vel)
 * kinds: string | harp | kalimba
 */
import { mulberry32 } from '../../core/rng.js';
import { Scope, num, clamp, fclamp, destOf, recordPatch } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const PLUCK_KINDS = Object.freeze({
  //            damping: loop-lowpass amount 0..1 (higher = darker/faster HF loss); decay: s to -60 dB at the fundamental
  string:  { damping: 0.42, decay: 3.6, pos: 0.18, bright: 0.85, tine: 0 },
  harp:    { damping: 0.30, decay: 5.2, pos: 0.14, bright: 0.7,  tine: 0 },
  kalimba: { damping: 0.62, decay: 2.6, pos: 0.5,  bright: 0.25, tine: 0.32 },
});

export const PLUCK_DEFAULTS = Object.freeze({
  kind: 'string',
  damping: null, decay: null, pos: null, bright: null,     // null = from kind
  cutoff: 7000,       // Hz playback lowpass at full velocity
  level: 0.85,
  damp: 0.2,          // 0 = ring out after dur; 1 = mute at the end of dur
  tune: 0,            // cents, global detune
  drift: 3,           // random cents of detune per note
});

/** the Karplus-Strong render as a generator: it yields every ~50k samples so the Score can spread a pre-warm over several updates */
function* renderKSGen(sr, freq, { damping, decay, pos, bright, tine }, seed) {
  const rnd = mulberry32(seed >>> 0);
  const period = sr / freq;
  const tuneDelay = 0.5 * clamp(damping * 2, 0, 1);       // group delay of the loop averager (~samples)
  let D = period - tuneDelay;
  const N = Math.max(2, Math.floor(D));
  const frac = Math.max(0.0001, D - N);
  const apC = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);
  // excitation: noise, smoothed by `bright`, with pluck-position comb
  let prev = 0;
  const sm = clamp(1 - bright * 0.9, 0.05, 0.98);
  for (let i = 0; i < N; i++) { const w = rnd() * 2 - 1; prev = sm * prev + (1 - sm) * w; line[i] = prev; }
  const pk = Math.max(1, Math.round(pos * N));
  const tmp = Float32Array.from(line);
  for (let i = 0; i < N; i++) line[i] -= tmp[(i - pk + N) % N] * 0.85;
  let mean = 0; for (let i = 0; i < N; i++) mean += line[i]; mean /= N;
  let pkA = 1e-6; for (let i = 0; i < N; i++) { line[i] -= mean; pkA = Math.max(pkA, Math.abs(line[i])); }
  for (let i = 0; i < N; i++) line[i] /= pkA;
  const len = Math.floor(sr * decay * 1.05);
  const out = new Float32Array(len);
  // per-round-trip loss so the fundamental falls 60 dB over `decay`
  const g = Math.pow(10, (-3 * period) / (decay * sr));
  const a = clamp(damping, 0.02, 0.5);                    // loop lowpass: y = (1-a)*x + a*xPrev
  let idx = 0, prevX = 0, apIn1 = 0, apOut1 = 0;
  for (let n = 0; n < len; n++) {
    const x = line[idx];
    const y = ((1 - a) * x + a * prevX) * g;               // lowpass + loss
    prevX = x;
    const z = apC * (y - apOut1) + apIn1;                  // allpass fractional delay
    apIn1 = y; apOut1 = z;
    line[idx] = z;
    idx++; if (idx >= N) idx = 0;
    out[n] = x;
    if ((n & 0xffff) === 0xffff) yield;
  }
  yield;
  if (tine > 0) {
    // kalimba tine: short inharmonic partial
    const tf = freq * 5.4, tl = Math.min(len, Math.floor(sr * 0.18));
    for (let n = 0; n < tl; n++) out[n] += tine * Math.sin((2 * Math.PI * tf * n) / sr) * Math.exp((-n / sr) / 0.035);
  }
  // normalise and fade tail
  let m = 1e-6; for (let n = 0; n < len; n++) m = Math.max(m, Math.abs(out[n]));
  yield;
  const k = 0.9 / m;
  const fade = Math.floor(sr * 0.04);
  for (let n = 0; n < len; n++) {
    let v = out[n] * k;
    if (n > len - fade) v *= (len - n) / fade;
    out[n] = v;
  }
  // gentle DC/LF cleanup: first-order highpass ~25 Hz
  let hx = 0, hy = 0; const hc = Math.exp((-2 * Math.PI * 25) / sr);
  for (let n = 0; n < len; n++) { const x = out[n]; hy = hc * (hy + x - hx); hx = x; out[n] = hy; }
  return out;
}
function renderKS(sr, freq, kp, seed) {
  const g = renderKSGen(sr, freq, kp, seed);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

export class Pluck {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...PLUCK_DEFAULTS, ...patch };
    // one cache for every Pluck on an engine (the album's three pluck voices share a timbre): the Score pre-warms it
    this.cache = engine.pluckCache || (engine.pluckCache = new Map());
  }
  set(patch = {}) { Object.assign(this.p, patch); recordPatch(this.engine, 'pluck', patch); return this; }

  /** cache key + the coarsely quantised timbre parameters for a note (continuous modulation reuses a small set of buffers) */
  _keyed(midi, kp) {
    const q = (v, step) => Math.round(v / step) * step;
    kp = { ...kp, damping: q(kp.damping, 0.05), decay: Math.max(0.5, q(kp.decay, 0.5)), pos: q(kp.pos, 0.05), bright: q(kp.bright, 0.1) };
    const key = [this.p.kind, midi, kp.damping.toFixed(2), kp.decay.toFixed(1), kp.pos.toFixed(2), kp.bright.toFixed(1)].join('|');
    return { key, kp };
  }
  _store(key, data) {
    const sr = this.ctx.sampleRate;
    const b = this.ctx.createBuffer(1, data.length, sr);
    b.getChannelData(0).set(data);
    if (this.cache.size > 240) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, b);
    return b;
  }
  _buffer(midi, kp) {
    // Synthesising a KS buffer costs milliseconds of main thread; the Score pre-warms the level's scale (warm()), so a note
    // normally finds its buffer in the shared cache.
    const k = this._keyed(midi, kp);
    const hit = this.cache.get(k.key);
    if (hit) return hit;
    const sr = this.ctx.sampleRate;
    return this._store(k.key, renderKS(sr, fclamp(midiToHz(midi), 30, 6000), k.kp, (midi * 7919 + 13) ^ Math.round(k.kp.decay * 100)));
  }

  /** timbre parameters for the current patch */
  _kp() {
    const p = this.p;
    const kind = PLUCK_KINDS[p.kind] || PLUCK_KINDS.string;
    return {
      damping: num(p.damping ?? kind.damping, 0.4, 0.02, 0.5 + 0.2),
      decay: num(p.decay ?? kind.decay, 3.5, 0.3, 12),
      pos: num(p.pos ?? kind.pos, 0.2, 0.02, 0.9),
      bright: num(p.bright ?? kind.bright, 0.7, 0, 1),
      tine: kind.tine,
    };
  }

  /**
   * Synthesise (and cache) the buffer for a note ahead of time, a slice per call, so it is never made at trigger time and no one
   * update carries a whole string. Returns true when the note's buffer is in the cache (call again while false).
   */
  warm(midi) {
    midi = Math.round(num(midi, 69, 24, 108) + num(this.p.tune, 0, -1200, 1200) / 100);
    const k = this._keyed(midi, this._kp());
    if (this.cache.has(k.key)) return true;
    if (!this._job || this._job.key !== k.key) {
      const sr = this.ctx.sampleRate;
      this._job = { key: k.key, gen: renderKSGen(sr, fclamp(midiToHz(midi), 30, 6000), k.kp, (midi * 7919 + 13) ^ Math.round(k.kp.decay * 100)) };
    }
    const r = this._job.gen.next();
    if (!r.done) return false;
    this._store(k.key, r.value);
    this._job = null;
    return true;
  }

  note(midi, t = this.ctx.currentTime, dur = 1, vel = 0.8) {
    const { ctx, engine } = this, p = this.p;
    const midiF = num(midi, 69, 24, 108) + num(p.tune, 0, -1200, 1200) / 100;
    midi = Math.round(midiF); dur = Math.max(0.05, num(dur, 1)); vel = clamp(num(vel, 0.8), 0, 1.2);
    const kp = this._kp();
    recordPatch(engine, 'pluck', p);
    engine.record('pluck.vel', vel); engine.record('pluck.dur', dur); engine.record('pluck.midi', midi);
    engine.record('pluck.dampingUsed', kp.damping); engine.record('pluck.decayUsed', kp.decay);
    const buffer = this._buffer(midi, kp);
    const sc = new Scope(ctx);
    const drift = (engine.rng.float() * 2 - 1) * num(p.drift, 3, 0, 50);
    engine.record('pluck.driftUsed', drift);
    const src = sc.buf(buffer, t, t + buffer.duration + 0.05);
    src.detune.value = drift + (midiF - midi) * 100;
    const cut = fclamp(num(p.cutoff, 7000) * (0.18 + 0.82 * vel * vel) * Math.pow(midiToHz(midi) / 261.6, 0.25), 300, 16000);
    const lp = sc.biquad('lowpass', cut, -3);
    const amp = sc.gain(clamp(num(p.level, 0.85), 0, 1.5) * (0.2 + 0.8 * vel));
    src.connect(lp); lp.connect(amp); amp.connect(this.dest);
    const dmp = clamp(num(p.damp, 0.2), 0, 1);
    if (dmp > 0 && dur < buffer.duration * 0.8) {
      const tr = t + dur;
      amp.gain.setTargetAtTime(0, tr, 2.0 * Math.pow(0.02 / 2.0, dmp));   // dmp=0 → 2 s, dmp=1 → 20 ms
    }
    sc.arm();
    return this;
  }
}
