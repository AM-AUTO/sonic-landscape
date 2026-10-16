/**
 * Offline (main-thread) renderers for the grit palette: short buffers made once per level, ahead of need, and played
 * back as one-shots (a buffer source and a gain per hit, so the node count stays low). Ported from the round-6 sketches
 * (tools/sketch-grounds.mjs): tape and fold saturation, crush, the plucked string and strum, the FM tine, struck metal,
 * grain clicks, contact-mic scrapes, dust, the eroding-loop pass and the crushed reverse swell.
 *
 * Everything takes the sample rate and an rng () => [0,1) so renders are reproducible per level seed.
 * The heavier renderers are generators (…Gen) that yield every few thousand samples; sliced() turns one into a pre-warm
 * item that does at most ~2.5 ms of work per call (returning false until it is done), so no update ever carries a whole
 * buffer. The plain functions run a generator to completion (tests, small buffers).
 */

const SLICE = 4096;
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
/** run a generator to completion and return its value */
export function runGen(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }
/**
 * A pre-warm item from a generator factory: each call advances it for up to `budgetMs`, false until it finishes, then
 * onDone(value) and true. makeGen() may return null while its input does not exist yet (the item is retried).
 */
export function sliced(makeGen, onDone, budgetMs = 2.5) {
  let it = null;
  return () => {
    if (!it) { it = makeGen(); if (!it) return false; }
    const t0 = nowMs();
    for (;;) {
      const r = it.next();
      if (r.done) { onDone(r.value); return true; }
      if (nowMs() - t0 > budgetMs) return false;
    }
  };
}

/** asymmetric tape-style saturation: even harmonics from the bias, soft ceiling */
export const tape = (x, d = 2, bias = 0.15) => (Math.tanh(d * (x + bias)) - Math.tanh(d * bias)) / Math.tanh(d);
/** wavefolder: folds peaks back, bright grit as the input rises */
export const fold = (x, amt = 1.5) => Math.sin(x * amt * Math.PI / 2);

/**
 * A WaveShaper curve over the input range [-1, 1] standing for x in [-range, range] (drive it with a pre-gain of
 * drive / range): fn(x) sampled, DC at x = 0 removed so a saturating stage adds no offset.
 */
export function shaperCurve(fn, range = 4, n = 2048) {
  const c = new Float32Array(n), z = fn(0);
  for (let i = 0; i < n; i++) c[i] = fn(((i / (n - 1)) * 2 - 1) * range) - z;
  return c;
}

/** bitcrush + sample-and-hold, in place */
export function crush(x, bits = 8, hold = 2) {
  const q = 2 ** (bits - 1); let h = 0;
  for (let i = 0; i < x.length; i++) { if (i % hold === 0) h = Math.round(x[i] * q) / q; x[i] = h; }
  return x;
}
/** one-pole low-pass, in place */
export function lowpass(x, sr, fc) {
  const a = 1 - Math.exp(-2 * Math.PI * fc / sr); let s = 0;
  for (let i = 0; i < x.length; i++) { s += a * (x[i] - s); x[i] = s; }
  return x;
}
/** peak-normalise to `peak`, in place */
export function normalise(x, peak = 0.9) {
  let m = 1e-9; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  const k = peak / m; for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}
/** 'crushed and saturated' (the sketches' dirty()): crush then tape, in place */
export function dirty(x, bits = 6, drive = 3) { crush(x, bits, 2); for (let i = 0; i < x.length; i++) x[i] = tape(x[i] * 1.4, drive, 0.12); return x; }

/** plucked string (Karplus-Strong) excited by a short filtered pick burst */
export function* gStringGen(sr, rng, f, { dur = 3, bright = 0.5, pick = 0.6, damp = 0.9965, level = 1 } = {}) {
  const n = Math.ceil(dur * sr), out = new Float32Array(n), N = Math.max(2, Math.round(sr / f)), line = new Float32Array(N);
  let s = 0; for (let j = 0; j < N; j++) { s += pick * ((rng() * 2 - 1) - s); line[j] = s; }
  let p = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const y = line[p]; lp += bright * (y - lp); line[p] = damp * lp; p = (p + 1) % N; out[i] = y * level;
    if ((i & (SLICE * 4 - 1)) === 0) yield;
  }
  return out;
}
export const gString = (...a) => runGen(gStringGen(...a));
/** a strummed chord (midis low → high), strings 15–40 ms apart, each velocity a little different; mono */
export function* strumGen(sr, rng, midis, { dur = 3, spread = 0.028, level = 0.45, bright = 0.45 } = {}) {
  const out = new Float32Array(Math.ceil(dur * sr));
  let at = 0.01;
  for (const m of midis) {
    const f = 440 * 2 ** ((m - 69) / 12);
    const s = yield* gStringGen(sr, rng, f, { dur: dur - at, bright, level: level * (0.75 + rng() * 0.35) });
    const i0 = Math.floor(at * sr);
    for (let j = 0; j < s.length && i0 + j < out.length; j++) out[i0 + j] += s[j];
    at += spread * (0.7 + rng() * 0.6);
  }
  return out;
}
export const strum = (...a) => runGen(strumGen(...a));
/** electric-piano tine: FM body plus the short metallic bark; `grace` (Hz) blips for ~7 ms at the attack */
export function* tineGen(sr, f, { vel = 0.45, dur = 2.2, level = 0.5, grace = null } = {}) {
  const n = Math.ceil(dur * sr), out = new Float32Array(n); let ph = 0;
  // the three envelopes as running products (one multiply per sample instead of three exps)
  const k1 = Math.exp(-1 / (0.5 * sr)), k2 = Math.exp(-1 / (1.6 * sr)), k3 = Math.exp(-1 / (0.025 * sr));
  let e1 = 1, e2 = 1, e3 = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr, fc = (grace && t < 0.007) ? grace : f;
    ph += 2 * Math.PI * fc / sr;
    const body = Math.sin(ph + vel * 1.4 * e1 * Math.sin(ph)) * e2;
    const bark = e3 > 1e-4 ? Math.sin(7.1 * ph) * vel * 0.25 * e3 : 0;
    out[i] = tape((body + bark) * level, 1.3, 0.05) * Math.min(1, i / 30, (n - i) / 400);
    e1 *= k1; e2 *= k2; e3 *= k3;
    if ((i & (SLICE - 1)) === 0) yield;
  }
  return out;
}
export const tine = (...a) => runGen(tineGen(...a));
/** wear (the glimpse's 'short erode'): wow, fewer bits, a closing low-pass, a little crackle (returns a new buffer) */
export function* wearGen(sr, rng, x, { bits = 9, hold = 2, fc = 3200, wow = 0.004, crackle = 0.0015 } = {}) {
  const y = new Float32Array(x.length); let read = 0, h = 0, s = 0;
  const a = 1 - Math.exp(-2 * Math.PI * fc / sr), q = 2 ** (bits - 1), ph = rng() * 6;
  for (let j = 0; j < x.length; j++) {
    read += 1 + wow * Math.sin(2 * Math.PI * 0.45 * j / sr + ph) + 0.3 * wow * Math.sin(2 * Math.PI * 7.3 * j / sr);
    const i0 = Math.min(x.length - 1, Math.floor(read)), v = x[i0];
    if (j % hold === 0) h = Math.round(v * q) / q;
    s += a * (h - s);
    y[j] = s + (rng() < crackle ? (rng() - 0.5) * 0.25 : 0);
    if ((j & (SLICE * 2 - 1)) === 0) yield;
  }
  return y;
}
export const wear = (...a) => runGen(wearGen(...a));
/** struck metal: inharmonic bar modes, sharp onset, short decay (contra B's voice) */
export function* metalHitGen(sr, rng, f, { level = 0.5, attack = 0.002, decay = 0.35, len = 0.6 } = {}) {
  const R = [1, 2.756, 5.404, 8.933, 13.34, 18.64], n = Math.ceil(len * sr), out = new Float32Array(n);
  for (let k = 0; k < R.length; k++) {
    const fk = f * R[k]; if (fk > sr * 0.4) break;
    const a = level / (k + 1) ** 0.8, dk = decay / (1 + k * 0.45), w = 2 * Math.PI * fk / sr, ph = rng() * 6;
    const kd = Math.exp(-1 / (dk * sr)); let e = 1;
    for (let i = 0; i < n; i++) { const t = i / sr; out[i] += a * Math.sin(w * i + ph) * Math.min(1, t / attack) * e; e *= kd; }
    yield;
  }
  return out;
}
export const metalHit = (...a) => runGen(metalHitGen(...a));
/** grain click: a 3–12 ms burst of saturated noise, or of `src` at a random spot */
export function grainClick(sr, rng, { level = 0.8, src = null } = {}) {
  const n = Math.max(16, Math.floor((0.003 + rng() * 0.009) * sr)), out = new Float32Array(n);
  const from = src && src.length > n ? Math.floor(rng() * (src.length - n)) : 0;
  for (let j = 0; j < n; j++) { const w = Math.sin(Math.PI * j / n); out[j] = tape(((src && src.length > n) ? src[from + j] * 3 : rng() * 2 - 1) * w, 3, 0.1) * level; }
  return out;
}
/** contact-mic scrape: band-limited noise with sharp, irregular amplitude spikes (one gesture, 0.08–0.6 s) */
export function scrape(sr, rng, { fc = 2000, level = 0.6, len = null } = {}) {
  const sec = len ?? (0.08 + rng() * 0.5), n = Math.ceil(sec * sr), y = new Float32Array(n);
  const f = fc * (0.6 + rng() * 0.8), a = 1 - Math.exp(-2 * Math.PI * f / sr); let s = 0, s2 = 0, amp = rng();
  for (let j = 0; j < n; j++) {
    if (rng() < 0.004) amp = rng(); amp *= 0.9993;
    s += a * ((rng() * 2 - 1) - s); s2 += a * 0.3 * (s - s2);
    y[j] = (s - s2) * amp * level * Math.sin(Math.PI * j / n);
  }
  return normalise(y, level);
}
/** dust and crackle: sparse clicks with tiny rings (a loopable bed) */
export function dust(sr, rng, sec = 4, density = 10, level = 0.5) {
  const y = new Float32Array(Math.ceil(sec * sr)), n = Math.floor(sec * density);
  for (let k = 0; k < n; k++) {
    const i0 = Math.floor(rng() * y.length), amp = level * rng() ** 2 * (rng() < 0.5 ? -1 : 1), len = 30 + Math.floor(rng() * 200);
    for (let j = 0; j < len && i0 + j < y.length; j++) y[i0 + j] += amp * Math.exp(-j / (len / 5)) * (j % 2 ? -1 : 1);
  }
  return y;
}
/**
 * One pass of the eroding loop at degradation deg 0..1: wow and flutter, dropouts, fewer bits, a closing filter,
 * crackle (sketch erodeLoop, one pass at a time so a pre-warm item makes one pass).
 */
export const erodePass = (...a) => runGen(erodePassGen(...a));
export function* erodePassGen(sr, rng, frag, deg, { maxWow = 0.015, pass = 0 } = {}) {
  const n = frag.length, out = new Float32Array(n), bits = Math.round(13 - 9 * deg), hold = 1 + Math.round(6 * deg);
  const fc = 400 + 8600 * (1 - deg) ** 1.6, a = 1 - Math.exp(-2 * Math.PI * fc / sr); let s = 0, h = 0, drop = 1, read = 0;
  const q = 2 ** (bits - 1);
  for (let j = 0; j < n; j++) {
    const t = j / sr, rate = 1 + maxWow * deg * Math.sin(2 * Math.PI * 0.45 * t + pass) + 0.3 * maxWow * deg * Math.sin(2 * Math.PI * 7.3 * t);
    read += rate; const v = frag[Math.floor(read) % n];
    if (rng() < 0.00004 * (1 + 60 * deg)) drop = 0.03; drop += (1 - drop) * 0.0006;
    if (j % hold === 0) h = Math.round(v * q) / q;
    s += a * (h - s);
    out[j] = s * drop * (1 - 0.35 * deg) + (rng() < 0.002 * deg ? (rng() - 0.5) * 0.4 * deg : 0);
    if ((j & (SLICE * 2 - 1)) === 0) yield;
  }
  // short fades so a bar-long loop joins without a click
  const f = Math.min(n >> 3, Math.floor(0.006 * sr));
  for (let j = 0; j < f; j++) { const g = j / f; out[j] *= g; out[n - 1 - j] *= g; }
  return out;
}
/**
 * Crushed reverse swell: `snippet` smeared by four damped combs (a cheap tail), reversed so it grows into its end,
 * crushed to `bits`. The buffer's last sample is the landing point.
 */
export const reverseSwell = (...a) => runGen(reverseSwellGen(...a));
export function* reverseSwellGen(sr, snippet, { sec = 2.5, bits = 6 } = {}) {
  const n = Math.ceil(sec * sr), wet = new Float32Array(n);
  const D = [1557, 1617, 1491, 1422].map((d) => Math.round(d * sr / 44100)), lines = D.map((d) => new Float32Array(d)), pos = D.map(() => 0), lp = D.map(() => 0);
  const g = D.map((d) => 10 ** (-3 * d / (sr * sec * 0.8)));
  for (let i = 0; i < n; i++) {
    const x = i < snippet.length ? snippet[i] : 0; let o = 0;
    for (let k = 0; k < 4; k++) { const y = lines[k][pos[k]]; lp[k] += 0.55 * (y - lp[k]); lines[k][pos[k]] = x + lp[k] * g[k]; pos[k] = (pos[k] + 1) % D[k]; o += y; }
    wet[i] = o * 0.25;
    if ((i & (SLICE * 2 - 1)) === 0) yield;
  }
  wet.reverse();
  normalise(wet, 0.8);
  crush(wet, bits, 3);
  const f = Math.floor(0.004 * sr); for (let j = 0; j < f; j++) wet[n - 1 - j] *= j / f;      // land, then stop
  return wet;
}
