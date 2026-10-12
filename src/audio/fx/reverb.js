/**
 * Procedural stereo convolution reverb. Impulse responses are synthesised in JS (decorrelated
 * exponentially-decaying noise + early reflections, progressively darkened), cached by quantised
 * size, and played through a pool of three ConvolverNodes that are crossfaded whenever the size
 * changes so a size change never clicks.
 *
 * Signal path:  input → highpass → predelay → damping lowpass → [convolvers → xfade gains] → wet → output
 * Output is wet-only (it is used as a send return).
 */
import { mulberry32 } from '../../core/rng.js';
import { clamp, num } from './util.js';

export const REVERB_MIN = 0.8;
export const REVERB_MAX = 16;

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
  const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 120, Q: 0.6 });
  const pre = new DelayNode(ctx, { maxDelayTime: 0.5, delayTime: 0.025 });
  const damp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 7500, Q: 0.5 });
  const wet = new GainNode(ctx, { gain: 0.8 });
  input.connect(hp); hp.connect(pre); pre.connect(damp);
  wet.connect(output);

  const slots = [0, 1, 2].map(() => {
    const conv = new ConvolverNode(ctx, { disableNormalization: false });
    const g = new GainNode(ctx, { gain: 0 });
    damp.connect(conv); conv.connect(g); g.connect(wet);
    return { conv, g, size: 0, offAt: 0, has: false };
  });

  const cache = new Map();
  function irFor(q) {
    let b = cache.get(q);
    if (!b) { b = generateIR(ctx, q, seed); cache.set(q, b); }
    return b;
  }

  const hWet = param('reverb.wet', wet.gain);
  const hDamp = param('reverb.damp', damp.frequency);
  const hPre = param('reverb.preDelay', pre.delayTime);

  let active = -1;
  let sizeNow = 0;

  function setSize(seconds, rampSec = 3, t = now()) {
    const q = quantizeSize(seconds);
    record('reverb.size', num(seconds, 4));
    if (active >= 0 && slots[active].size === q) { sizeNow = q; return q; }
    ramp(q, rampSec, t);
    return q;
  }
  function ramp(q, rampSec, t) {
    rampSec = Math.max(0.02, num(rampSec, 3));
    // free up slots whose fade-out finished: drop their buffers to save CPU
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (i !== active && s.has && s.offAt <= now()) { s.conv.buffer = null; s.has = false; s.size = 0; }
    }
    // choose the idle slot: not active, no buffer; else the one that went quiet earliest
    let pick = -1;
    for (let i = 0; i < slots.length; i++) if (i !== active && !slots[i].has) { pick = i; break; }
    if (pick < 0) {
      let best = Infinity;
      for (let i = 0; i < slots.length; i++) if (i !== active && slots[i].offAt < best) { best = slots[i].offAt; pick = i; }
    }
    const s = slots[pick];
    const first = active < 0;
    s.g.gain.cancelScheduledValues(0);
    s.g.gain.setValueAtTime(0, Math.max(0, now()));
    s.conv.buffer = irFor(q);
    s.size = q; s.has = true;
    const tc = first ? 0.01 : rampSec / 4;
    s.g.gain.cancelScheduledValues(t);
    s.g.gain.setTargetAtTime(1, t, tc);
    for (let i = 0; i < slots.length; i++) {
      if (i === pick || !slots[i].has) continue;
      const o = slots[i];
      o.g.gain.cancelScheduledValues(t);
      o.g.gain.setTargetAtTime(0, t, tc);
      o.offAt = t + tc * 7;
    }
    active = pick; sizeNow = q;
  }

  setSize(4, 0.01, 0);

  return {
    input, output, wet,
    setSize,
    get size() { return sizeNow; },
    setWet(v, t = now()) { v = num(v, 0.8, 0, 2); hWet.set(v, t, 0.15); },
    setDamp(hz, t = now()) { hz = num(hz, 7500, 300, 20000); hDamp.set(hz, t, 0.2); },
    setPreDelay(sec, t = now()) { sec = num(sec, 0.025, 0, 0.45); hPre.set(sec, t, 0.1); },
    /** debug: number of cached IRs */
    get cached() { return cache.size; },
  };
}
