/**
 * Eroding loop — the DSP core of the 'erode' worklet (./erode.js), kept free of AudioWorklet globals so Node tests import it.
 * A port of `erodeLoop` in tools/sketch-grounds.mjs (round 5/6), made real-time:
 *
 *   record the input for N seconds (sample-accurate start at an audio time) → loop it, every pass older:
 *   wow and flutter (modulated read offset), random dropouts, fewer bits and a longer sample-hold, a one-pole low-pass
 *   closing, more crackle, a little level loss. Age 0 = nearly clean (13 bits, 9 kHz), age 1 = worn out (4 bits, hold 7, 400 Hz).
 *
 * Ageing: `passesToFull` > 0 adds ageRate / passesToFull to the age at every pass boundary (the loop ages bar by bar, or stanza
 * by stanza, with the loop length); {age} sets it outright. Output is wet only (the loop), scaled by `mix`; while recording,
 * `monitor` lets the input through at the current age (0 by default: the loop enters after the capture).
 *
 * No allocation in processErode: all buffers are made by createErodeState. Commands with a `startAt` (audio seconds) apply on
 * the exact sample; commands without one apply at the start of the next block.
 */

export const ERODE_MAX_SECONDS = 20;
const FADE = 256;                       // splice fade at the loop seam (samples)
const MAX_PENDING = 16;

/** age → the degradation of one pass (the sketch's per-pass numbers) */
export function erodeStage(age, sr, out = {}) {
  const a = age < 0 ? 0 : age > 1 ? 1 : age;
  const bits = Math.round(13 - 9 * a);
  const fc = 400 + 8600 * Math.pow(1 - a, 1.6);
  out.q = Math.pow(2, bits - 1); out.bits = bits;
  out.hold = 1 + Math.round(6 * a);
  out.lpA = 1 - Math.exp((-2 * Math.PI * fc) / sr); out.fc = fc;
  out.dropP = 0.00004 * (1 + 60 * a);
  out.crackP = 0.002 * a;
  out.loss = 1 - 0.35 * a;
  return out;
}

export function createErodeState(sr, { maxSeconds = ERODE_MAX_SECONDS, seed = 0x2545f491, maxWow = 0.012 } = {}) {
  const sec = Number.isFinite(maxSeconds) ? Math.min(ERODE_MAX_SECONDS, Math.max(0.1, maxSeconds)) : ERODE_MAX_SECONDS;
  const max = Math.max(4096, Math.floor(sec * sr));
  const st = {
    sr, max, maxWow,
    bufL: new Float32Array(max), bufR: new Float32Array(max),
    mode: 0,               // 0 idle, 1 recording, 2 looping
    recLen: 0, w: 0,       // capture length / write index while recording
    n: 0, j: 0,            // loop length / sample index inside the current pass
    pass: 0, cycle: 0,     // passes looped since the last capture; captures made
    age: 0, passesToFull: 0, ageRate: 1,
    wowW: (2 * Math.PI * 0.45) / sr, flutW: (2 * Math.PI * 7.3) / sr,
    wc: 1, ws: 0, fc: 1, fs: 0,
    wC: Math.cos((2 * Math.PI * 0.45) / sr), wS: Math.sin((2 * Math.PI * 0.45) / sr),
    fC: Math.cos((2 * Math.PI * 7.3) / sr), fS: Math.sin((2 * Math.PI * 7.3) / sr),
    lpL: 0, lpR: 0, hL: 0, hR: 0, hc: 0, drop: 1,
    env: 0,                // output gate (fades the loop in / out: no clicks on reset or capture)
    seed: (seed >>> 0) || 1,
    // per-pass measurement for the decay log: total and high-band energy of the output (mono)
    eTot: 0, eHi: 0, hpS: 0, hpS2: 0, hpA: 1 - Math.exp((-2 * Math.PI * 1500) / sr),
    stage: erodeStage(0, sr),
    lpAs: erodeStage(0, sr).lpA,  // smoothed filter coefficient
    pending: [], onPass: null, onEvent: null,
  };
  return st;
}

function rand(st) {
  let x = st.seed;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  st.seed = x;
  return x / 4294967296;
}

function setAge(st, a) {
  st.age = a < 0 ? 0 : a > 1 ? 1 : (Number.isFinite(a) ? a : 0);
  erodeStage(st.age, st.sr, st.stage);
}

/** apply one command now */
function apply(st, m) {
  if (m.reset) { st.mode = 0; st.pass = 0; return; }
  if (typeof m.passesToFull === 'number' && Number.isFinite(m.passesToFull)) st.passesToFull = Math.max(0, m.passesToFull);
  if (typeof m.record === 'number' && Number.isFinite(m.record) && m.record > 0) {
    st.recLen = Math.max(2048, Math.min(st.max, Math.round(m.record * st.sr)));
    st.mode = 1; st.w = 0; st.pass = 0; st.cycle++;
    setAge(st, typeof m.age === 'number' ? m.age : 0);
    if (st.onEvent) st.onEvent('record', st);
  } else if (typeof m.age === 'number') setAge(st, m.age);
}

/** queue a message ({record:s}, {age:x}, {passesToFull:n}, {reset:true}, {seed:n}; optional startAt in audio seconds) */
export function erodeMessage(st, m) {
  if (!m || typeof m !== 'object') return;
  if (typeof m.seed === 'number') st.seed = (m.seed >>> 0) || 1;
  if (typeof m.maxWow === 'number' && Number.isFinite(m.maxWow)) st.maxWow = Math.max(0, Math.min(0.05, m.maxWow));
  const at = typeof m.startAt === 'number' && Number.isFinite(m.startAt) ? m.startAt : -Infinity;
  if (st.pending.length >= MAX_PENDING) st.pending.shift();
  st.pending.push({ m, at });
  if (st.pending.length > 1) st.pending.sort((a, b) => a.at - b.at);
}

function finishCapture(st) {
  // splice: fade the seam so the loop has no click where its end meets its start
  const n = st.recLen, f = Math.min(FADE, n >> 2);
  for (let i = 0; i < f; i++) {
    const g = i / f;
    st.bufL[i] *= g; st.bufR[i] *= g;
    st.bufL[n - 1 - i] *= g; st.bufR[n - 1 - i] *= g;
  }
  st.n = n; st.j = 0; st.mode = 2;
  st.eTot = 0; st.eHi = 0;
  if (st.onEvent) st.onEvent('loop', st);
}

function passDone(st) {
  if (st.onPass) st.onPass(st.pass, st.age, st.eTot / Math.max(1, st.n), st.eTot > 0 ? st.eHi / st.eTot : 0, st);
  st.pass++;
  st.eTot = 0; st.eHi = 0;
  if (st.passesToFull > 0 && st.ageRate > 0) setAge(st, st.age + st.ageRate / st.passesToFull);
}

/** render samples [i0, i1) */
function render(st, inL, inR, outL, outR, i0, i1, mix, monitor) {
  const bufL = st.bufL, bufR = st.bufR;
  let S = st.stage;
  let wowA = st.maxWow * st.age / st.wowW, flutA = 0.3 * st.maxWow * st.age / st.flutW;
  // wow and flutter as rotating phasors (no Math.sin per sample); the wow's phase is offset by the pass number, as in the sketch
  let wc = st.wc, ws = st.ws, fc = st.fc, fs = st.fs;
  const wC = st.wC, wS = st.wS, fC = st.fC, fS = st.fS;
  let pc = Math.cos(st.pass), ps = Math.sin(st.pass);
  let env = st.env, lpL = st.lpL, lpR = st.lpR, hL = st.hL, hR = st.hR, hc = st.hc, drop = st.drop, lpAs = st.lpAs;
  const target = st.mode === 2 ? 1 : (st.mode === 1 && monitor > 0 ? 1 : 0);
  for (let i = i0; i < i1; i++) {
    env += (target - env) * 0.004;
    lpAs += (S.lpA - lpAs) * 0.002;
    let xl = 0, xr = 0;
    if (st.mode === 1) {
      let a = inL ? inL[i] : 0, b = inR ? inR[i] : a;
      // a NaN or an infinity captured would loop for ever
      if (a !== a) a = 0; else if (a > 4) a = 4; else if (a < -4) a = -4;
      if (b !== b) b = 0; else if (b > 4) b = 4; else if (b < -4) b = -4;
      bufL[st.w] = a; bufR[st.w] = b; st.w++;
      xl = a * monitor; xr = b * monitor;
      if (st.w >= st.recLen) finishCapture(st);
    } else if (st.mode === 2) {
      // the read point wanders round the clock-locked pass position (passes stay on the bar grid): the offset is the integral
      // of the sketch's rate modulation 1 + w·sin(0.45 Hz) + 0.3w·sin(7.3 Hz), i.e. -cos terms scaled by 1/ω (in samples)
      let t = wc * wC - ws * wS; ws = ws * wC + wc * wS; wc = t;
      t = fc * fC - fs * fS; fs = fs * fC + fc * fS; fc = t;
      const off = -wowA * (wc * pc - ws * ps) - flutA * fc;
      const n = st.n;
      let r = st.j + off;
      if (r >= n) r -= n; else if (r < 0) r += n;
      const k = r | 0, fr = r - k, k1 = k + 1 >= n ? 0 : k + 1;
      xl = bufL[k] + (bufL[k1] - bufL[k]) * fr;
      xr = bufR[k] + (bufR[k1] - bufR[k]) * fr;
    }
    if (env > 1e-5) {
      if (rand(st) < S.dropP) drop = 0.03;
      drop += (1 - drop) * 0.0006;
      if (hc <= 0) { hL = Math.round(xl * S.q) / S.q; hR = Math.round(xr * S.q) / S.q; hc = S.hold; }
      hc--;
      lpL += lpAs * (hL - lpL); lpR += lpAs * (hR - lpR);
      const g = drop * S.loss * env * mix;
      let yl = lpL * g, yr = lpR * g;
      if (st.mode === 2) {
        // per-pass measurement (before the crackle: the wear of the loop itself, not the dust on it)
        const m = 0.5 * (yl + yr);
        st.hpS += st.hpA * (m - st.hpS);
        const h1 = m - st.hpS;
        st.hpS2 += st.hpA * (h1 - st.hpS2);
        const h = h1 - st.hpS2;                         // two one-pole high-passes at 1.5 kHz
        st.eTot += m * m; st.eHi += h * h;
      }
      if (S.crackP > 0 && rand(st) < S.crackP) { const c = (rand(st) - 0.5) * 0.4 * st.age * env * mix; yl += c; yr += c; }
      outL[i] = yl; outR[i] = yr;
    } else { outL[i] = 0; outR[i] = 0; }
    if (st.mode === 2) {
      st.j++;
      if (st.j >= st.n) {
        st.j = 0; passDone(st);
        S = st.stage; pc = Math.cos(st.pass); ps = Math.sin(st.pass);
        wowA = st.maxWow * st.age / st.wowW; flutA = 0.3 * st.maxWow * st.age / st.flutW;
      }
    }
  }
  // keep the phasors on the unit circle
  const nw = 1 / Math.sqrt(wc * wc + ws * ws), nf = 1 / Math.sqrt(fc * fc + fs * fs);
  st.wc = wc * nw; st.ws = ws * nw; st.fc = fc * nf; st.fs = fs * nf;
  st.env = env; st.lpL = lpL; st.lpR = lpR; st.hL = hL; st.hR = hR; st.hc = hc; st.drop = drop; st.lpAs = lpAs;
}

/**
 * Process one block. inL/inR may be null (silence); outL/outR are written in full.
 * p: { mix, ageRate, monitor } (k-rate numbers); t0 = the audio time of the block's first sample.
 */
export function processErode(st, inL, inR, outL, outR, p, t0 = 0) {
  const N = outL.length, sr = st.sr;
  const mix = Number.isFinite(p.mix) ? Math.max(0, Math.min(2, p.mix)) : 1;
  const monitor = Number.isFinite(p.monitor) ? Math.max(0, Math.min(1, p.monitor)) : 0;
  st.ageRate = Number.isFinite(p.ageRate) ? Math.max(0, Math.min(8, p.ageRate)) : 1;
  let i = 0;
  while (i < N) {
    let end = N;
    const q = st.pending.length ? st.pending[0] : null;
    if (q) {
      const due = q.at === -Infinity ? 0 : Math.ceil((q.at - t0) * sr);
      if (due <= i) { st.pending.shift(); apply(st, q.m); continue; }
      if (due < N) end = due;
    }
    render(st, inL, inR, outL, outR, i, end, mix, monitor);
    i = end;
  }
}
