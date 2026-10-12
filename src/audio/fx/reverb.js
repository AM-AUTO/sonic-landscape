/**
 * Procedural stereo convolution reverb. Impulse responses are synthesised in JS (decorrelated
 * exponentially-decaying noise + early reflections, progressively darkened) once, for a fixed
 * bank of sizes; a size change crossfades the bank, so it never clicks and never stalls the
 * main thread.
 *
 * Signal path:  input → highpass → predelay → damping lowpass → [convolvers → xfade gains] → wet → output
 * Output is wet-only (it is used as a send return).
 */
import { mulberry32 } from '../../core/rng.js';
import { clamp, num } from './util.js';

export const REVERB_MIN = 0.8;
export const REVERB_MAX = 16;
/** Convolver bank sizes (s). Sizes between are equal-power crossfades of neighbours. */
export const BANK = [1.5, 3.5, 7, 15];

export function quantizeSize(s) {
  s = clamp(num(s, 4), REVERB_MIN, REVERB_MAX);
  if (s < 4) return Math.round(s * 4) / 4;
  if (s < 8) return Math.round(s * 2) / 2;
  return Math.round(s);
}

/** Generate a stereo impulse response with RT60 ≈ seconds. Deterministic per (seconds, seed). */
export function generateIR(ctx, seconds, seed = 1) {
  const sr = ctx.sampleRate;
  const rt = clamp(seconds, REVERB_MIN, REVERB_MAX);
  const len = Math.ceil(sr * (rt * 1.12 + 0.15));
  const buf = ctx.createBuffer(2, len, sr);
  const decayK = 6.9078 / rt;                       // amplitude -60 dB at rt
  const fc0 = 12000;
  const fc1 = clamp(5200 / Math.sqrt(rt), 1100, 4500); // darker for bigger rooms
  const fadeStart = Math.floor(len * 0.93);
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32((Math.imul(Math.round(rt * 100) + 7, 2654435761) ^ Math.imul(seed + 1, 40503) ^ (ch + 1) * 99991) >>> 0);
    const d = buf.getChannelData(ch);
    let y1 = 0, y2 = 0, a = 1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if ((i & 63) === 0) {
        const fc = fc0 * Math.pow(fc1 / fc0, clamp(t / rt, 0, 1.2));
        a = 1 - Math.exp(-TWO_PI * fc / sr);
      }
      const n = rnd() * 2 - 1;
      y1 += a * (n - y1);
      y2 += a * (y1 - y2);
      // diffuse onset: starts after the early reflections, blooms over ~120 ms
      const onset = smooth((t - 0.008) / 0.12);
      const env = onset * Math.exp(-decayK * t);
      d[i] = y2 * env * 1.7;
    }
    // early reflections (distinct per channel)
    const taps = 16;
    const times = [];
    for (let k = 0; k < taps; k++) times.push(0.003 + rnd() * rnd() * 0.095 + k * 0.0015);
    times.sort((x, y) => x - y);
    for (let k = 0; k < taps; k++) {
      const idx = Math.floor(times[k] * sr);
      if (idx >= len - 2) continue;
      const amp = (0.9 * Math.pow(1 - times[k] / 0.14, 1.3) + 0.08) * (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rnd());
      d[idx] += amp * 0.8;
      d[idx + 1] += amp * 0.4;
    }
    // fade the very end
    for (let i = fadeStart; i < len; i++) {
      const f = (i - fadeStart) / (len - fadeStart);
      d[i] *= 0.5 + 0.5 * Math.cos(Math.PI * f);
    }
    // remove DC
    let mean = 0;
    for (let i = 0; i < len; i++) mean += d[i];
    mean /= len;
    for (let i = 0; i < len; i++) d[i] -= mean;
  }
  return buf;
}
const TWO_PI = Math.PI * 2;
function smooth(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }

export function createReverb(ctx, hooks = {}, { seed = 1 } = {}) {
  const param = hooks.param || ((n, p) => ({ param: p, set() {}, ramp() {} }));
  const record = hooks.record || (() => {});
  const now = () => ctx.currentTime;

  const input = new GainNode(ctx, { gain: 1 });
  const output = new GainNode(ctx, { gain: 1 });
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120, Q: -3 });
  const pre = new DelayNode(ctx, { maxDelayTime: 0.5, delayTime: 0.025 });
  const damp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7500, Q: -3 });
  const wet = new GainNode(ctx, { gain: 0.8 });
  input.connect(hp); hp.connect(pre); pre.connect(damp);
  wet.connect(output);

  // A fixed bank of convolvers, one per size on a log ladder. IRs are generated and assigned
  // exactly once, here. Assigning ConvolverNode.buffer is expensive (Chromium partitions the IR
  // on the main thread), so a size change only crossfades the bank (equal-power, between the two
  // neighbouring sizes) and never touches a buffer. Slots that are faded out are disconnected
  // from the input so they cost no convolution CPU while idle.
  const slots = BANK.map((size) => {
    const conv = new ConvolverNode(ctx, { disableNormalization: false });
    conv.buffer = generateIR(ctx, size, seed);
    const g = new GainNode(ctx, { gain: 0 });
    conv.connect(g); g.connect(wet);
    return { conv, g, size, target: 0, connected: false, offAt: 0 };
  });
  const connect = (s) => { if (!s.connected) { damp.connect(s.conv); s.connected = true; } };
  const disconnect = (s) => { if (s.connected) { try { damp.disconnect(s.conv); } catch { /* already */ } s.connected = false; } };

  const hWet = param('reverb.wet', wet.gain);
  const hDamp = param('reverb.damp', damp.frequency);
  const hPre = param('reverb.preDelay', pre.delayTime);

  let sizeNow = 0;
  let lastT = 0;

  /** Equal-power weights over the bank for a size (log-interpolated between neighbours). */
  function weights(q) {
    const w = BANK.map(() => 0);
    if (q <= BANK[0]) { w[0] = 1; return w; }
    if (q >= BANK[BANK.length - 1]) { w[BANK.length - 1] = 1; return w; }
    let i = 0;
    while (q > BANK[i + 1]) i++;
    const f = Math.log(q / BANK[i]) / Math.log(BANK[i + 1] / BANK[i]);
    w[i] = Math.cos(f * Math.PI / 2);
    w[i + 1] = Math.sin(f * Math.PI / 2);
    return w;
  }

  function setSize(seconds, rampSec = 3, t = now()) {
    const q = clamp(num(seconds, 4), REVERB_MIN, REVERB_MAX);
    record('reverb.size', q);
    const n = now();
    t = Math.max(num(t, n), n, lastT);           // size changes are scheduled in time order
    lastT = t;
    const first = sizeNow === 0;
    const tc = first ? 0.01 : Math.max(0.02, num(rampSec, 3)) / 4;
    const w = weights(q);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      // release slots whose fade-out finished
      if (s.target === 0 && s.connected && s.offAt <= n) disconnect(s);
      if (Math.abs(w[i] - s.target) < 1e-4) continue;
      if (w[i] > 0) { connect(s); s.offAt = Infinity; }
      else s.offAt = t + tc * 8;
      s.g.gain.cancelScheduledValues(t);
      s.g.gain.setTargetAtTime(w[i], t, tc);
      s.target = w[i];
    }
    sizeNow = q;
    return q;
  }

  setSize(4, 0.01, 0);

  return {
    input, output, wet,
    setSize,
    get size() { return sizeNow; },
    setWet(v, t = now()) { v = num(v, 0.8, 0, 2); hWet.set(v, t, 0.15); },
    setDamp(hz, t = now()) { hz = num(hz, 7500, 300, 20000); hDamp.set(hz, t, 0.2); },
    setPreDelay(sec, t = now()) { sec = num(sec, 0.025, 0, 0.45); hPre.set(sec, t, 0.1); },
    /** debug: number of convolvers currently processing */
    get active() { return slots.filter((x) => x.connected).length; },
  };
}
