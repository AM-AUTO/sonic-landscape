/**
 * Comb resonators — the DSP core of the 'resonators' worklet (./resonators.js), free of AudioWorklet globals (Node tests import it).
 * A port of `resonate` in tools/sketch-grounds.mjs: up to six fractional-delay combs with a one-pole damping filter in the loop,
 * excited by the input (noise, or any bus), so pitch is heard only as resonance inside noise.
 *
 *   v = x + g · lp(delay(v, sr/f))     lp: one-pole, coefficient (1 - damp)     out = Σ gain_k · pan_k · g·lp_k · √(1 - g²)
 *
 * The output is the resonance only (the excitation is not passed through); √(1 - g²) keeps a white-noise excitation at roughly
 * the same RMS whatever the feedback. Frequency glides exponentially, g / gain / damping linearly, over the glide time set with
 * the targets; a comb whose gain has faded to 0 is cleared and skipped (no cost). No allocation in processResonators.
 */

export const RES_MAX = 6;
const LEN = 4096;                       // delay line per comb (≥ sr / 30 Hz at 96 kHz)
const MAX_PENDING = 16;
const DEFAULT_PANS = [0, -0.35, 0.35, -0.2, 0.2, 0];

export function createResonatorState(sr, { seed = 1 } = {}) {
  const fMin = Math.max(20, sr / (LEN - 8));
  const st = {
    sr, fMin, fMax: sr * 0.45, w: 0, seed,
    buf: new Float32Array(RES_MAX * LEN),
    f: new Float64Array(RES_MAX).fill(220), fMul: new Float64Array(RES_MAX).fill(1), fSteps: new Int32Array(RES_MAX),
    g: new Float64Array(RES_MAX), gStep: new Float64Array(RES_MAX), gT: new Float64Array(RES_MAX),
    gain: new Float64Array(RES_MAX), gainStep: new Float64Array(RES_MAX), gainT: new Float64Array(RES_MAX),
    damp: new Float64Array(RES_MAX).fill(0.35), dampStep: new Float64Array(RES_MAX), dampT: new Float64Array(RES_MAX).fill(0.35),
    steps: new Int32Array(RES_MAX),     // samples left in the g / gain / damp glide
    lp: new Float64Array(RES_MAX),
    x: new Float32Array(4096),          // mono excitation of the current block (blocks are 128 samples; 4096 is headroom)
    panL: new Float64Array(RES_MAX).fill(Math.SQRT1_2), panR: new Float64Array(RES_MAX).fill(Math.SQRT1_2),
    live: new Uint8Array(RES_MAX),
    pending: [],
    targets: [],                        // the last applied targets (for inspection)
  };
  return st;
}

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** phase delay (samples) of the loop's one-pole y += a·(x − y) at frequency f: taken off the comb delay so the peak sits on f */
function lpDelay(f, a, sr) {
  const w = (2 * Math.PI * f) / sr, b = 1 - a;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

/** apply a target set now: [{f, g, gain, damp?, pan?}], glide seconds */
export function applyTargets(st, targets, glide = 0.15) {
  const sr = st.sr, n = Math.max(1, Math.round(clampN(fin(glide, 0.15), 0.001, 10) * sr));
  const list = Array.isArray(targets) ? targets : [];
  st.targets = list;
  for (let k = 0; k < RES_MAX; k++) {
    const t = list[k];
    const on = !!t && fin(t.f, 0) > 0 && fin(t.gain, 1) > 0;
    const fT = on ? clampN(fin(t.f, 220), st.fMin, st.fMax) : st.f[k];
    const gT = on ? clampN(fin(t.g, 0.95), 0, 0.999) : st.g[k];
    const gainT = on ? clampN(fin(t.gain, 1), 0, 4) : 0;
    const dampT = on ? clampN(fin(t.damp, 0.35), 0, 0.95) : st.damp[k];
    if (on && !st.live[k]) {
      // a silent comb starts at its target pitch, feedback and damping: only its gain fades in
      st.f[k] = fT; st.g[k] = gT; st.damp[k] = dampT; st.gain[k] = 0; st.live[k] = 1;
    }
    st.fMul[k] = Math.pow(fT / st.f[k], 1 / n); st.fSteps[k] = n;
    st.gT[k] = gT; st.gainT[k] = gainT; st.dampT[k] = dampT;
    st.gStep[k] = (gT - st.g[k]) / n; st.gainStep[k] = (gainT - st.gain[k]) / n; st.dampStep[k] = (dampT - st.damp[k]) / n;
    st.steps[k] = n;
    if (on) {
      const pan = clampN(fin(t.pan, DEFAULT_PANS[k] * Math.min(1, fT / 250)), -1, 1), th = (pan + 1) * Math.PI * 0.25;
      st.panL[k] = Math.cos(th); st.panR[k] = Math.sin(th);
    }
  }
}

/** queue a message: {targets:[...], glide, startAt?} | {clear:true, startAt?} */
export function resonatorMessage(st, m) {
  if (!m || typeof m !== 'object') return;
  const at = typeof m.startAt === 'number' && Number.isFinite(m.startAt) ? m.startAt : -Infinity;
  if (st.pending.length >= MAX_PENDING) st.pending.shift();
  st.pending.push({ m, at });
  if (st.pending.length > 1) st.pending.sort((a, b) => a.at - b.at);
}

function applyMessage(st, m) {
  if (m.clear) applyTargets(st, [], fin(m.glide, 0.05));
  else if (Array.isArray(m.targets)) applyTargets(st, m.targets, m.glide);
}

function render(st, inL, inR, outL, outR, i0, i1, mix, drive) {
  const sr = st.sr, buf = st.buf, x = st.x;
  for (let i = i0; i < i1; i++) {
    outL[i] = 0; outR[i] = 0;
    let v = inL ? (inR ? 0.5 * (inL[i] + inR[i]) : inL[i]) : 0;
    if (v !== v) v = 0; else if (v > 4) v = 4; else if (v < -4) v = -4;   // a NaN or a blast in the loop would ring for ever
    x[i] = v;
  }
  for (let k = 0; k < RES_MAX; k++) {
    if (!st.live[k]) continue;
    const base = k * LEN;
    let w = st.w, f = st.f[k], g = st.g[k], gain = st.gain[k], damp = st.damp[k], lp = st.lp[k];
    let fSteps = st.fSteps[k], steps = st.steps[k];
    const pL = st.panL[k] * mix, pR = st.panR[k] * mix;
    if (fSteps === 0 && steps === 0) {
      // settled: every coefficient is constant over the block
      const a = 1 - damp;
      let d = sr / f - lpDelay(f, a, sr);
      if (d < 2) d = 2; else if (d > LEN - 3) d = LEN - 3;
      const di = d | 0, fr = d - di;            // read at w - d = (w - di - 1) + (1 - fr)
      const out = gain * Math.sqrt(1 - g * g), oL = out * pL, oR = out * pR;
      for (let i = i0; i < i1; i++) {
        let j1 = w - di; if (j1 < 0) j1 += LEN;
        const j0 = j1 === 0 ? LEN - 1 : j1 - 1;
        const fb = buf[base + j1] + (buf[base + j0] - buf[base + j1]) * fr;
        lp += a * (fb - lp);
        const res = g * lp;
        buf[base + w] = x[i] + res;
        w = w + 1 >= LEN ? 0 : w + 1;
        outL[i] += res * oL; outR[i] += res * oR;
      }
    } else {
      const fMul = st.fMul[k], gS = st.gStep[k], gainS = st.gainStep[k], dS = st.dampStep[k];
      // the one-pole's delay as a fraction of the period, from the block start (it changes slowly over a glide)
      const lpFrac = lpDelay(f, 1 - damp, sr) * f / sr;
      for (let i = i0; i < i1; i++) {
        if (fSteps > 0) { f *= fMul; fSteps--; }
        if (steps > 0) { g += gS; gain += gainS; damp += dS; steps--; }
        const a = 1 - damp;
        let d = (sr / f) * (1 - lpFrac);
        if (d < 2) d = 2; else if (d > LEN - 3) d = LEN - 3;
        let r = w - d; if (r < 0) r += LEN;
        const j0 = r | 0, fr = r - j0, j1 = j0 + 1 >= LEN ? 0 : j0 + 1;
        const fb = buf[base + j0] + (buf[base + j1] - buf[base + j0]) * fr;
        lp += a * (fb - lp);
        const res = g * lp;
        buf[base + w] = x[i] + res;
        w = w + 1 >= LEN ? 0 : w + 1;
        const y = res * gain * Math.sqrt(1 - g * g);
        outL[i] += y * pL; outR[i] += y * pR;
      }
    }
    if (Math.abs(lp) < 1e-20) lp = 0;    // no denormals in a decayed loop
    st.f[k] = f; st.g[k] = g; st.gain[k] = gain; st.damp[k] = damp; st.lp[k] = lp; st.fSteps[k] = fSteps; st.steps[k] = steps;
    if (steps === 0) { st.g[k] = st.gT[k]; st.gain[k] = st.gainT[k]; st.damp[k] = st.dampT[k]; }
    if (steps === 0 && st.gainT[k] === 0) {          // faded out: clear and skip until retargeted
      st.live[k] = 0; st.lp[k] = 0; buf.fill(0, base, base + LEN);
    }
  }
  st.w = (st.w + (i1 - i0)) % LEN;
  if (drive > 0.001) {
    const d = 0.6 + 3 * drive, tb = Math.tanh(d * 0.1), td = Math.tanh(d);
    for (let i = i0; i < i1; i++) {
      outL[i] = (Math.tanh(d * (outL[i] + 0.1)) - tb) / td;
      outR[i] = (Math.tanh(d * (outR[i] + 0.1)) - tb) / td;
    }
  }
}

/** process one block; p: { mix, drive } k-rate numbers; t0 = audio time of the first sample */
export function processResonators(st, inL, inR, outL, outR, p, t0 = 0) {
  const N = outL.length, sr = st.sr;
  const mix = Number.isFinite(p.mix) ? clampN(p.mix, 0, 4) : 1;
  const drive = Number.isFinite(p.drive) ? clampN(p.drive, 0, 1) : 0;
  if (N > st.x.length) st.x = new Float32Array(N);
  let i = 0;
  while (i < N) {
    let end = N;
    const q = st.pending.length ? st.pending[0] : null;
    if (q) {
      const due = q.at === -Infinity ? 0 : Math.ceil((q.at - t0) * sr);
      if (due <= i) { st.pending.shift(); applyMessage(st, q.m); continue; }
      if (due < N) end = due;
    }
    render(st, inL, inR, outL, outR, i, end, mix, drive);
    i = end;
  }
}
