/**
 * Shared DSP helpers: waveshaper curves, safe-number helpers, envelope scheduling and the
 * Scope class that guarantees per-note node graphs are stopped and disconnected.
 */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Coerce to a finite number within [lo,hi]; NaN/Infinity/undefined fall back to `def`. */
export function num(v, def = 0, lo = -Infinity, hi = Infinity) {
  v = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(v)) v = def;
  return v < lo ? lo : v > hi ? hi : v;
}

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-12, g));
export const lerp = (a, b, t) => a + (b - a) * t;
export const centsToRatio = (c) => Math.pow(2, c / 1200);
/** Safe audible frequency. */
export const fclamp = (hz, lo = 10, hi = 20000) => clamp(num(hz, 440), lo, hi);

/**
 * tanh saturation curve over the input range [-1,1] that represents x in [-range, range]:
 * out = tanh(range * u). Used with a pre-gain of (drive/range) so the effective curve is
 * tanh(drive * x) with no hard clipping for |drive*x| < range.
 */
export function makeDriveCurve(range = 8, n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(range * u);
  }
  return c;
}

/** Asymmetric-free bit-crusher curve: mid-rise quantiser with 2^bits levels. */
export function makeCrushCurve(bits = 6, n = 8192) {
  const levels = Math.pow(2, clamp(bits, 1, 16));
  const half = levels / 2;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    c[i] = clamp((Math.floor(u * half) + 0.5) / half, -1, 1);
  }
  return c;
}

/**
 * Master soft-clip / limiter curve. The WaveShaper input u in [-1,1] represents x = u*range.
 * Linear (unity gain with a pre-gain of 1/range) up to `knee`, then tanh-bends asymptotically
 * toward `ceiling`; the curve endpoint is the hard ceiling, so output can never exceed it.
 */
export function softClipCurve(n = 8192, { ceiling = 0.93, knee = 0.55, range = 2.5 } = {}) {
  const c = new Float32Array(n);
  const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * range;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * Math.min(y, ceiling);
  }
  return c;
}

/**
 * Gentle saturation for feedback loops: tanh with unity slope at the origin and |out| < |in|, so a loop
 * with gain g < 1 can never grow (small-signal loop gain stays <= g), while loud repeats are soft-limited.
 */
export function softSatCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.tanh((i / (n - 1)) * 2 - 1);
  return c;
}

/** Hann window sampled at n points (for setValueCurveAtTime grains). */
export function hannCurve(n = 24) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = 0.5 - 0.5 * Math.cos((TAU * i) / (n - 1));
  return c;
}

/** Record every finite numeric entry of a patch under `prefix.key`. */
export function recordPatch(engine, prefix, patch) {
  if (!engine || !patch) return;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (typeof v === 'number' && Number.isFinite(v)) engine.record(prefix + '.' + k, v);
  }
}

/** Channel | AudioNode → destination AudioNode. */
export function destOf(ch) {
  if (!ch) throw new Error('voice needs a channel');
  return ch.input || ch;
}

/**
 * Schedule an ADSR on a gain-like AudioParam for a note of length `dur` (seconds).
 * Fresh: starts at `floor` and ramps linearly to `peak`. legato: attack is a setTarget from
 * whatever the param currently holds. Release is exponential (setTarget to 0).
 * Never uses exponentialRamp-to-zero. Returns the time at which the sound is inaudible.
 * dur is clamped to attack+10 ms so release never lands inside the attack ramp.
 */
export function adsr(param, t, dur, { a = 0.01, d = 0.2, s = 0.7, r = 0.3 } = {}, peak = 1, { legato = false, floor = 0 } = {}) {
  a = Math.max(0.001, num(a, 0.01)); d = Math.max(0.005, num(d, 0.2)); r = Math.max(0.005, num(r, 0.3));
  s = clamp(num(s, 0.7), 0, 1); peak = Math.max(0, num(peak, 1));
  const tRel = t + Math.max(num(dur, 0.2), a + 0.01);
  param.cancelScheduledValues(t);
  if (legato) {
    param.setTargetAtTime(peak, t, a / 3);
  } else {
    param.setValueAtTime(floor, t);
    param.linearRampToValueAtTime(peak, t + a);
  }
  param.setTargetAtTime(peak * s, t + a, d / 3);
  param.setTargetAtTime(0, tRel, r / 4);
  return tRel + r * 2;
}

/** Cancel + exponential/linear helper for a plain "set a param to v at t" with smoothing. */
export function glide(param, v, t, tc = 0.05) {
  param.cancelScheduledValues(t);
  param.setTargetAtTime(v, t, Math.max(0.001, tc));
}

/**
 * Tracks every node of a per-note graph. Sources created through the helpers are started
 * (and optionally stopped) immediately; `arm()` installs onended handlers so that once the
 * last source ends the whole graph (plus external links) is disconnected and released.
 */
export class Scope {
  static live = 0;
  static debug = false;           // when true, live scopes are tracked in Scope.all with their creation stack
  static all = new Set();
  constructor(ctx) {
    this.ctx = ctx;
    this.nodes = [];
    this.sources = [];
    this.links = [];
    this.alive = 0;
    this.armed = false;
    this.disposed = false;
    Scope.live++;
    if (Scope.debug) { this.stack = new Error().stack; Scope.all.add(this); }
  }
  /** register any node */
  add(node) { this.nodes.push(node); return node; }
  /** register + start a source node at t0 (optionally stop at t1) */
  track(src, t0, t1) {
    this.nodes.push(src); this.sources.push(src);
    src.start(t0);
    if (t1 != null && Number.isFinite(t1)) { src._st = Math.max(t1, t0); src._own = true; src.stop(src._st); }
    return src;
  }
  osc(type, freq, t0, t1) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = fclamp(freq, 0.01, 22000);
    return this.track(o, t0, t1);
  }
  /** buffer source (not looping unless loop given) */
  buf(buffer, t0, t1, { loop = false, offset = 0, rate = 1 } = {}) {
    const b = this.ctx.createBufferSource();
    b.buffer = buffer; b.loop = loop; b.playbackRate.value = rate;
    this.nodes.push(b); this.sources.push(b);
    b.start(t0, Math.max(0, offset));
    if (t1 != null && Number.isFinite(t1)) { b._st = Math.max(t1, t0); b._own = true; b.stop(b._st); }
    return b;
  }
  gain(v = 1) { return this.add(new GainNode(this.ctx, { gain: v })); }
  biquad(type, frequency, Q = 1, gain = 0) {
    // NB: for lowpass/highpass Web Audio's Q is a *resonance in dB* (0 = no peak at the corner, -3 = Butterworth,
    // +6 = clearly resonant); for the band types it is an ordinary Q.
    const lh = type === 'lowpass' || type === 'highpass';
    return this.add(new BiquadFilterNode(this.ctx, { type, frequency: fclamp(frequency, 10, this.ctx.sampleRate * 0.45), Q: lh ? clamp(num(Q, 0), -12, 30) : clamp(num(Q, 1), 0.0001, 60), gain }));
  }
  /** connect from→to and remember the link so an external persistent `from` is released */
  link(from, to) { from.connect(to); this.links.push([from, to]); return to; }
  /** chain nodes a→b→c... returns last */
  chain(...ns) { for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; }
  /** (re)schedule the stop of every source; safe to call repeatedly to extend life */
  stopAll(t) {
    for (const s of this.sources) {
      if (s._own && s._st <= t) continue;     // already scheduled to stop earlier
      try { s.stop(t); s._st = t; } catch (e) { /* already stopped */ }
    }
    this.stopAt = t;
    this.arm();
  }
  arm() {
    if (this.armed) return this;
    this.armed = true;
    this.alive = this.sources.length;
    if (this.alive === 0) { this.dispose(); return this; }
    for (const s of this.sources) {
      s.onended = () => { if (--this.alive <= 0) this.dispose(); };
    }
    return this;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    Scope.live--;
    Scope.all.delete(this);
    if (this.onDispose) { try { this.onDispose(); } catch (e) { /* ignore */ } }
    for (const [from, to] of this.links) { try { from.disconnect(to); } catch (e) { /* gone */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* gone */ } }
    this.nodes.length = 0; this.sources.length = 0; this.links.length = 0;
  }
}
