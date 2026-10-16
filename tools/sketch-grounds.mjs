#!/usr/bin/env node
/**
 * Sound sketches of the grounds, in the album's contemporary language rather than any folk timbre:
 * the Highland grammar (drone, ground, ornament-as-articulation, snap / reel / pibroch time) carried by
 * saturated, granular, guitar-like drones (the Fennesz side) and low-pass-gate FM plucks, re-struck
 * sustains, kick and bass (the Floating Points side). No reeds, no pipes, no folk instruments.
 * Offline DSP in plain Node: stereo 44.1 kHz WAV. A sketch of direction, not the game's final sound.
 *
 *   node tools/sketch-grounds.mjs [--out out/midi] [--only lyon,coe,album] [--just]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GROUNDS, parseGround } from './write-grounds.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'out/midi');
const ONLY = (opt('only', 'lyon,coe,album')).split(',');
const JUST = args.includes('--just');
const SR = 44100, PPQ = 480;

// ---------------------------------------------------------------------------- pitch
const PC = { C: 0, 'C#': 1, D: 2, E: 4, F: 5, 'F#': 6, G: 7, A: 9, B: 11 };
const RATIO = { A: 1, B: 9 / 8, 'C#': 5 / 4, D: 4 / 3, E: 3 / 2, 'F#': 5 / 3, G: 7 / 4 };
function freq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name), oct = Number(m[2]);
  if (!JUST) return 440 * 2 ** ((12 * (oct + 1) + PC[m[1]] - 69) / 12);
  const aOct = PC[m[1]] < PC.A ? oct - 1 : oct;
  return 440 * 2 ** (aOct - 4) * RATIO[m[1]];
}

// ---------------------------------------------------------------------------- tiny DSP kit
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const stereo = (sec) => [new Float32Array(Math.ceil(sec * SR)), new Float32Array(Math.ceil(sec * SR))];
const sat = (x, d) => Math.tanh(d * x) / Math.tanh(d);
function mixInto(dst, src, at, gl, gr = gl) {
  const i0 = Math.floor(at * SR);
  for (let j = 0; j < src.length && i0 + j < dst[0].length; j++) { if (i0 + j < 0) continue; dst[0][i0 + j] += src[j] * gl; dst[1][i0 + j] += src[j] * gr; }
}

/** E-bowed string: Karplus-Strong with a low, continuous noise excitation, slightly detuned pair. */
function bowedString(f, sec, { bright = 0.5, swell = 8 } = {}) {
  const out = new Float32Array(Math.ceil(sec * SR));
  for (const det of [-0.0025, 0.0025]) {
    const N = Math.max(2, Math.round(SR / (f * (1 + det)))), line = new Float32Array(N);
    let p = 0, lp = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR, exc = (rnd() * 2 - 1) * 0.012 * (0.6 + 0.4 * Math.sin(2 * Math.PI * t / swell));
      const y = line[p];
      lp = lp + bright * (y - lp);
      line[p] = 0.997 * lp + exc;
      p = (p + 1) % N;
      out[i] += y * 0.5;
    }
  }
  return out;
}

/** One-pole low-pass with a cutoff function of time (Hz). */
function lowpass(x, cutoffAt) {
  const y = new Float32Array(x.length); let s = 0;
  for (let i = 0; i < x.length; i++) { const fc = cutoffAt(i / SR), a = 1 - Math.exp(-2 * Math.PI * fc / SR); s += a * (x[i] - s); y[i] = s; }
  return y;
}

/** Granular smear: overlapping Hann grains read from `src`, random positions near the read head, pitch jitter, reverse, octave. */
function granulate(src, { density = 24, gmin = 0.12, gmax = 0.5, back = 1.5, cents = 10, oct = 0.12, rev = 0.25, width = 0.9 } = {}) {
  const dst = [new Float32Array(src.length), new Float32Array(src.length)];
  const n = Math.floor(src.length / SR * density);
  for (let k = 0; k < n; k++) {
    const at = rnd() * src.length, len = Math.floor((gmin + rnd() * (gmax - gmin)) * SR);
    const from = Math.max(0, at - rnd() * back * SR);
    const rate = 2 ** (((rnd() * 2 - 1) * cents) / 1200) * (rnd() < oct ? 2 : 1), dir = rnd() < rev ? -1 : 1;
    const pan = 0.5 + (rnd() - 0.5) * width, gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    for (let j = 0; j < len; j++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / len);
      const ri = from + (dir > 0 ? j * rate : (len - j) * rate), i0 = Math.floor(ri), fr = ri - i0;
      if (i0 + 1 >= src.length || at + j >= src.length) break;
      const v = (src[i0] * (1 - fr) + src[i0 + 1] * fr) * w;
      dst[0][Math.floor(at) + j] += v * gl; dst[1][Math.floor(at) + j] += v * gr;
    }
  }
  const norm = 1 / Math.sqrt(Math.max(1, density * (gmin + gmax) / 2));
  for (const ch of dst) for (let i = 0; i < ch.length; i++) ch[i] *= norm;
  return dst;
}

/**
 * Low-pass-gate FM pluck: brightness and loudness fall together (the "bongo" of a Buchla LPG).
 * `grace` = a pitch blipped for ~8 ms at the attack: the ornament as articulation, not a separate note.
 */
function lpgPluck(f, { dur = 1.2, ratio = 2, index = 3, decay = 0.35, grace = null, level = 1 } = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n); let ph = 0, pm = 0, s = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.exp(-t / decay);
    const fc = (grace && t < 0.008) ? grace : f;
    const ix = index * env * (grace && t < 0.012 ? 2.2 : 1);
    pm += 2 * Math.PI * fc * ratio / SR; ph += 2 * Math.PI * fc / SR;
    const raw = Math.sin(ph + ix * Math.sin(pm)) * env;
    const a = 1 - Math.exp(-2 * Math.PI * (120 + 9000 * env * env) / SR);
    s += a * (raw - s);
    out[i] = s * level * Math.min(1, i / 40);
  }
  return out;
}

function kick(level = 1) {
  const n = Math.ceil(0.5 * SR), out = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 45 + 80 * Math.exp(-t / 0.035); ph += 2 * Math.PI * f / SR; out[i] = Math.sin(ph) * Math.exp(-t / 0.28) * level + (i < 60 ? (rnd() - 0.5) * 0.3 : 0); }
  return out;
}
function tick(level = 1, len = 0.025) {   // high-passed noise transient
  const n = Math.ceil(len * SR), out = new Float32Array(n); let prev = 0;
  for (let i = 0; i < n; i++) { const x = rnd() * 2 - 1; out[i] = (x - prev) * Math.exp(-i / (n / 4)) * level; prev = x; }
  return out;
}
function subBass(f, dur, level = 1) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { ph += 2 * Math.PI * f / SR; const e = Math.min(1, i / 200, (n - i) / 400); out[i] = sat(Math.sin(ph) + 0.25 * Math.sin(2 * ph), 1.6) * e * level; }
  return out;
}

/** 8-line feedback delay network reverb, stereo out. */
function reverb(inp, rt = 4, damp = 0.4, pre = 0.02) {
  const L = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((x) => Math.round(x * (0.6 + rt / 10)));
  const lines = L.map((n) => new Float32Array(n)), pos = L.map(() => 0), lp = L.map(() => 0);
  const g = L.map((n) => 10 ** (-3 * n / (SR * rt)));
  const out = [new Float32Array(inp[0].length), new Float32Array(inp[0].length)], P = Math.floor(pre * SR);
  for (let i = 0; i < inp[0].length; i++) {
    const x = ((inp[0][i - P] || 0) + (inp[1][i - P] || 0)) * 0.5;
    const o = lines.map((ln, k) => ln[pos[k]]);
    const sum = o.reduce((a, b) => a + b, 0) * (2 / 8);
    for (let k = 0; k < 8; k++) {
      lp[k] += (1 - damp) * ((o[k] - sum) - lp[k]);
      lines[k][pos[k]] = x + lp[k] * g[k];
      pos[k] = (pos[k] + 1) % L[k];
    }
    out[0][i] = o[0] + o[2] + o[4] + o[6]; out[1][i] = o[1] + o[3] + o[5] + o[7];
  }
  return out;
}

function master(mix, file) {
  // DC blocker (the asymmetric saturation leaves an offset) and a gentle high shelf for edge
  for (const ch of mix) {
    let x1 = 0, y1 = 0; for (let i = 0; i < ch.length; i++) { const y = ch[i] - x1 + 0.9995 * y1; x1 = ch[i]; y1 = y; ch[i] = y; }
    let lp = 0; const a = 1 - Math.exp(-2 * Math.PI * 2800 / SR); for (let i = 0; i < ch.length; i++) { lp += a * (ch[i] - lp); ch[i] += 0.55 * (ch[i] - lp); }
  }
  let peak = 0; for (const ch of mix) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const g = 0.89 / (peak || 1), n = mix[0].length, pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(sat(mix[c][i] * g, 1.1) * 32000), i * 4 + c * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([h, pcm]));
}
const add = (dst, src, gain = 1) => { for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(dst[c].length, src[c].length); i++) dst[c][i] += src[c][i] * gain; };
const mono2 = (x, gl = 1, gr = gl) => [x.map((v) => v * gl), x.map((v) => v * gr)];

/** The drone bed: bowed-string A2/E3/A3, saturated, filtered by a slow sweep, plus its own granular smear and hiss. */
function droneBed(sec, { drive = 3, smear = 0.6, hiss = 0.02, sweep = 24, lo = 500, hi = 2600 } = {}) {
  const raw = new Float32Array(Math.ceil(sec * SR));
  for (const [n, a] of [['A2', 1], ['E3', 0.7], ['A3', 0.35]]) { const s = bowedString(freq(n), sec, { swell: 7 + rnd() * 5 }); for (let i = 0; i < raw.length; i++) raw[i] += s[i] * a; }
  for (let i = 0; i < raw.length; i++) raw[i] = sat(raw[i] * 2.5, drive);
  const filt = lowpass(raw, (t) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin(2 * Math.PI * t / sweep)));
  for (let i = 0; i < filt.length; i++) { const t = i / SR; filt[i] *= Math.min(1, t / 4, (sec - t) / 3); }
  const bed = mono2(filt, 0.8, 0.75);
  add(bed, granulate(filt, { density: 18, gmin: 0.2, gmax: 0.7, cents: 8, oct: 0.1, rev: 0.3 }), smear);
  if (hiss) { const nz = lowpass(Float32Array.from({ length: filt.length }, () => rnd() * 2 - 1), () => 5000); for (let i = 0; i < nz.length; i++) nz[i] *= hiss * (0.6 + 0.4 * Math.sin(i / SR * 0.7)); add(bed, mono2(nz, 1, 0.9)); }
  return bed;
}

/** Ground events with absolute times: [{t, dur, pitch, grace}] — graces become attack articulation. */
function groundEvents(g, loops = 2, t0 = 2) {
  const seq = parseGround(g.notes), spb = 60 / g.bpm, ev = []; let t = t0;
  for (let l = 0; l < loops; l++) for (const n of seq) {
    const dur = n.ticks / PPQ * spb;
    if (n.pitch) ev.push({ t, dur, pitch: n.pitch, grace: n.graces.length ? n.graces.at(-1) : null, loop: l });
    t += dur;
  }
  return { ev, end: t };
}

// ---------------------------------------------------------------------------- edge and texture (round 3)
/** Asymmetric tape-style saturation: even harmonics from the bias, soft ceiling. */
const tape = (x, d = 2, bias = 0.15) => (Math.tanh(d * (x + bias)) - Math.tanh(d * bias)) / Math.tanh(d);
/** Wavefolder: folds peaks back, adds bright grit as the input rises. */
const fold = (x, amt = 1.5) => Math.sin(x * amt * Math.PI / 2);
function shape(x, fn) { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = fn(x[i], i); return y; }
/** Bitcrush and sample-and-hold: dirt, used sparingly. */
function crush(x, bits = 8, hold = 3) { const q = 2 ** (bits - 1), y = new Float32Array(x.length); let h = 0; for (let i = 0; i < x.length; i++) { if (i % hold === 0) h = Math.round(x[i] * q) / q; y[i] = h; } return y; }
/** Band-limited moving noise (wind, surf): a band-pass from two one-poles, its centre and level breathing. */
function windNoise(sec, { lo = 300, hi = 3000, rate = 0.07, depth = 0.7 } = {}) {
  const n = Math.ceil(sec * SR), y = new Float32Array(n); let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, m = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t + Math.sin(t * 0.31) * 2);
    const fc = lo + (hi - lo) * m, x = rnd() * 2 - 1;
    const ka = 1 - Math.exp(-2 * Math.PI * fc / SR), kb = 1 - Math.exp(-2 * Math.PI * fc * 0.35 / SR);
    a += ka * (x - a); b += kb * (x - b);
    y[i] = (a - b) * (1 - depth + depth * m) * 2.2;
  }
  return y;
}
/** Dust and crackle: sparse clicks with tiny rings, density per second. */
function dust(sec, density = 12, level = 0.3) {
  const y = new Float32Array(Math.ceil(sec * SR)), n = Math.floor(sec * density);
  for (let k = 0; k < n; k++) { const i0 = Math.floor(rnd() * y.length), amp = level * rnd() ** 2 * (rnd() < 0.5 ? -1 : 1), len = 30 + Math.floor(rnd() * 200); for (let j = 0; j < len && i0 + j < y.length; j++) y[i0 + j] += amp * Math.exp(-j / (len / 5)) * (j % 2 ? -1 : 1); }
  return y;
}
/** Granular noise bursts: short shaped noise grains, filtered, scattered. */
function noiseBursts(sec, { density = 3, gmin = 0.03, gmax = 0.25, fc = 2500, level = 0.4 } = {}) {
  const y = new Float32Array(Math.ceil(sec * SR)), n = Math.floor(sec * density);
  for (let k = 0; k < n; k++) {
    const i0 = Math.floor(rnd() * y.length), len = Math.floor((gmin + rnd() * (gmax - gmin)) * SR), f = fc * (0.5 + rnd()), a = 1 - Math.exp(-2 * Math.PI * f / SR); let s = 0;
    for (let j = 0; j < len && i0 + j < y.length; j++) { s += a * ((rnd() * 2 - 1) - s); y[i0 + j] += s * level * Math.sin(Math.PI * j / len) ** 2; }
  }
  return y;
}
/** Piecewise-linear curve over time: [[t, v], ...]. */
const curve = (pts) => (t) => { if (t <= pts[0][0]) return pts[0][1]; for (let k = 1; k < pts.length; k++) if (t <= pts[k][0]) { const [t0, v0] = pts[k - 1], [t1, v1] = pts[k]; return v0 + (v1 - v0) * (t - t0) / (t1 - t0); } return pts.at(-1)[1]; };
function applyCurve(st, fn) { for (const ch of st) for (let i = 0; i < ch.length; i++) ch[i] *= fn(i / SR); return st; }
/** Sidechain: duck a stereo buffer after each trigger time. */
function duck(st, times, depth = 0.6, rel = 0.22) {
  const sorted = times.slice().sort((a, b) => a - b); let k = 0;
  for (let i = 0; i < st[0].length; i++) { const t = i / SR; while (k + 1 < sorted.length && sorted[k + 1] <= t) k++; const d = sorted.length && t >= sorted[k] ? depth * Math.exp(-(t - sorted[k]) / rel) : 0; st[0][i] *= 1 - d; st[1][i] *= 1 - d; }
  return st;
}
/** Bus compressor (peak follower, feed-forward), then make-up. */
function compress(st, threshDb = -18, ratio = 3, att = 0.005, rel = 0.12, makeup = 1.6) {
  const th = 10 ** (threshDb / 20), ka = 1 - Math.exp(-1 / (att * SR)), kr = 1 - Math.exp(-1 / (rel * SR)); let env = 0;
  for (let i = 0; i < st[0].length; i++) { const x = Math.max(Math.abs(st[0][i]), Math.abs(st[1][i])); env += (x > env ? ka : kr) * (x - env); const g = env > th ? (th * (env / th) ** (1 / ratio)) / env : 1; st[0][i] *= g * makeup; st[1][i] *= g * makeup; }
  return st;
}

// percussion voices
function kickHard(level = 1, drive = 3) {
  const n = Math.ceil(0.55 * SR), out = new Float32Array(n); let ph = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, f = 42 + 110 * Math.exp(-t / 0.03); ph += 2 * Math.PI * f / SR; const click = i < 90 ? (rnd() * 2 - 1) * 0.5 * (1 - i / 90) : 0; out[i] = tape((Math.sin(ph) * Math.exp(-t / 0.32) + click) * 1.2, drive, 0.1) * level; }
  return out;
}
function snareNoise(level = 1, len = 0.22) {
  const n = Math.ceil(len * SR), out = new Float32Array(n); let ph = 0, lp = 0, hp = 0;
  for (let i = 0; i < n; i++) { const t = i / SR, x = rnd() * 2 - 1; lp += 0.55 * (x - lp); hp += 0.08 * (lp - hp); ph += 2 * Math.PI * 185 / SR; out[i] = tape((lp - hp) * Math.exp(-t / 0.07) * 1.4 + Math.sin(ph) * 0.6 * Math.exp(-t / 0.04), 2.2, 0.05) * level; }
  return out;
}
function hatMetal(level = 1, decay = 0.03) {
  const fs = [263, 400, 421, 474, 587, 845].map((f) => f * 4.3), n = Math.ceil((decay * 6 + 0.01) * SR), out = new Float32Array(n); let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) { const t = i / SR; let s = 0; for (const f of fs) s += Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1; s = s / 6 + (rnd() * 2 - 1) * 0.6; const d1 = s - p1; p1 = s; const d2 = d1 - p2; p2 = d1; out[i] = d2 * 0.5 * Math.exp(-t / decay) * level; }
  return out;
}
function tom(f, level = 1) { const n = Math.ceil(0.5 * SR), out = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * f * (1 + 0.6 * Math.exp(-t / 0.05)) / SR; out[i] = tape(Math.sin(ph) * Math.exp(-t / 0.28) + (i < 120 ? (rnd() - 0.5) * 0.4 : 0), 2, 0.05) * level; } return out; }
/** Bowed or struck metal: inharmonic modes (bar ratios), slow or sharp onset, long decay. */
function metalHit(f, { level = 0.4, attack = 0.25, decay = 2.8, len = 4 } = {}) {
  const R = [1, 2.756, 5.404, 8.933, 13.34, 18.64], n = Math.ceil(len * SR), out = new Float32Array(n);
  for (let k = 0; k < R.length; k++) { const fk = f * R[k]; if (fk > 16000) break; const a = level / (k + 1) ** 0.8, dk = decay / (1 + k * 0.45), w = 2 * Math.PI * fk / SR, ph = rnd() * 6; for (let i = 0; i < n; i++) { const t = i / SR; out[i] += a * Math.sin(w * i + ph) * Math.min(1, t / attack) * Math.exp(-t / dk); } }
  return out;
}
function thud(level = 0.6) { const n = Math.ceil(0.4 * SR), out = new Float32Array(n); let s = 0, ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; s += 0.02 * ((rnd() * 2 - 1) - s); ph += 2 * Math.PI * (52 + 30 * Math.exp(-t / 0.02)) / SR; out[i] = (Math.sin(ph) * 0.8 + s * 6) * Math.exp(-t / 0.18) * level; } return out; }

/** The forceful version of the drone: the bed plus a saturated, folded wall layer and moving noise, shaped by `wall(t)`. */
function droneWall(sec, wall, opt = {}) {
  const bed = droneBed(sec, opt);
  const raw = new Float32Array(Math.ceil(sec * SR));
  for (const [n, a] of [['A1', 0.6], ['A2', 1], ['E3', 0.8], ['A3', 0.5], ['E4', 0.25]]) { const s = bowedString(freq(n), sec, { bright: 0.7, swell: 5 + rnd() * 4 }); for (let i = 0; i < raw.length; i++) raw[i] += s[i] * a; }
  const hot = lowpass(shape(raw, (x) => fold(tape(x * 3.5, 4, 0.2), 1.3)), (t) => 900 + 2600 * wall(t));
  const nz = windNoise(sec, { lo: 400, hi: 5000, rate: 0.05, depth: 0.5 }), nzl = opt.noise ?? 0.5;
  const wallSt = [new Float32Array(raw.length), new Float32Array(raw.length)];
  for (let i = 0; i < raw.length; i++) { const w = wall(i / SR); wallSt[0][i] = (hot[i] * 0.55 + nz[i] * nzl) * w; wallSt[1][i] = (hot[i] * 0.5 + nz[(i + 911) % nz.length] * nzl) * w; }
  add(bed, granulate(wallSt[0], { density: 22, gmin: 0.05, gmax: 0.3, cents: 20, oct: 0.05, rev: 0.4 }), 0.6);
  add(bed, wallSt, 1);
  return bed;
}

// ---------------------------------------------------------------------------- round 4: played sources, broken from within
const jit = (ms) => (rnd() - 0.5) * 2 * ms / 1000;            // human timing drift
/** Plucked/strummed electric guitar string: Karplus-Strong excited by a short filtered pick burst. */
function gString(f, { dur = 4, bright = 0.55, pick = 0.6, damp = 0.9965, level = 1 } = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n), N = Math.max(2, Math.round(SR / f)), line = new Float32Array(N);
  let s = 0; for (let j = 0; j < N; j++) { s += pick * ((rnd() * 2 - 1) - s); line[j] = s; }
  let p = 0, lp = 0;
  for (let i = 0; i < n; i++) { const y = line[p]; lp += bright * (y - lp); line[p] = damp * lp; p = (p + 1) % N; out[i] = y * level; }
  return out;
}
/** A strummed chord: strings spread 15-40 ms, down or up, each velocity a little different. */
function strum(st, pitches, at, { spread = 0.028, up = false, level = 0.5, dur = 5, bright = 0.5, pan = 0.5 } = {}) {
  const ps = up ? pitches.slice().reverse() : pitches;
  ps.forEach((p, k) => { const s = gString(freq(p), { dur, bright, level: level * (0.75 + rnd() * 0.35) }); mixInto(st, s, at + k * spread * (0.7 + rnd() * 0.6), Math.cos((pan + (k - 2.5) * 0.04) * Math.PI / 2), Math.sin((pan + (k - 2.5) * 0.04) * Math.PI / 2)); });
}
/** Electric-piano tine: FM body plus the short metallic bark, velocity shapes the bark. */
function tine(f, { vel = 0.7, dur = 3, level = 0.5, grace = null } = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n); let ph = 0, pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, fc = (grace && t < 0.007) ? grace : f;
    ph += 2 * Math.PI * fc / SR; pm += 2 * Math.PI * fc / SR;
    const body = Math.sin(ph + vel * 1.4 * Math.exp(-t / 0.5) * Math.sin(pm)) * Math.exp(-t / 1.6);
    const bark = Math.sin(2 * Math.PI * fc * 7.1 * t) * vel * 0.25 * Math.exp(-t / 0.025);
    out[i] = tape((body + bark) * level, 1.3, 0.05) * Math.min(1, i / 30);
  }
  return out;
}
/** Buffer-repeat glitch: the slice at `at` repeated `reps` times, each a little quieter (the laptop stutter). */
function stutter(st, at, slice = 0.12, reps = 4, decay = 0.8) {
  const i0 = Math.floor(at * SR), n = Math.floor(slice * SR);
  for (let c = 0; c < 2; c++) { const src = st[c].slice(i0, i0 + n); for (let r = 1; r <= reps; r++) { const g = decay ** r; for (let j = 0; j < n && i0 + r * n + j < st[c].length; j++) { const w = Math.min(1, j / 40, (n - j) / 40); st[c][i0 + r * n + j] = st[c][i0 + r * n + j] * (1 - w) + src[j] * g * w; } } }
}
/** The laptop chain: saturate, granulate (long grains, octave, reverse), crush in blooms, moving low-pass. */
function laptop(src, wall, { bits = 7, grains = 26 } = {}) {
  const m = new Float32Array(src[0].length); for (let i = 0; i < m.length; i++) m[i] = (src[0][i] + src[1][i]) * 0.5;
  const hot = shape(m, (x, i) => tape(x * (2 + 6 * wall(i / SR)), 3.5, 0.2));
  const sm = granulate(hot, { density: grains, gmin: 0.08, gmax: 0.6, back: 2.5, cents: 14, oct: 0.15, rev: 0.35 });
  const cr = [crush(sm[0], bits, 3), crush(sm[1], bits, 3)];
  const out = [new Float32Array(m.length), new Float32Array(m.length)];
  for (let c = 0; c < 2; c++) { const f = lowpass(cr[c].map((v, i) => { const w = wall(i / SR); return v * w * (0.6 + 0.4 * Math.sin(i / SR * 1.3 + c)); }), (t) => 1200 + 5000 * wall(t)); out[c] = f; }
  return out;
}
// close, dry, detailed percussion
function kickTight(level = 1) { const n = Math.ceil(0.3 * SR), out = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { const t = i / SR; ph += 2 * Math.PI * (48 + 90 * Math.exp(-t / 0.022)) / SR; out[i] = tape(Math.sin(ph) * Math.exp(-t / 0.2) + (i < 50 ? (rnd() - 0.5) * 0.5 : 0), 1.6, 0.05) * level; } return out; }
function rim(level = 1) { const n = Math.ceil(0.05 * SR), out = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / SR; out[i] = (Math.sin(2 * Math.PI * 1750 * t) * 0.7 + (rnd() - 0.5) * 0.6) * Math.exp(-t / 0.008) * level; } return out; }
function clap(level = 1) { const n = Math.ceil(0.25 * SR), out = new Float32Array(n); let s = 0; for (let i = 0; i < n; i++) { const t = i / SR, x = rnd() * 2 - 1; s += 0.5 * (x - s); const burst = [0, 0.011, 0.022].reduce((a, d) => a + (t >= d ? Math.exp(-(t - d) / 0.006) : 0), 0) * 0.6 + Math.exp(-t / 0.09) * 0.5; out[i] = (x - s) * burst * level; } return out; }
function shaker(level = 1) { const n = Math.ceil(0.06 * SR), out = new Float32Array(n); let p = 0; for (let i = 0; i < n; i++) { const t = i / SR, x = rnd() * 2 - 1, d = x - p; p = x; out[i] = d * Math.sin(Math.PI * Math.min(1, t / 0.06)) ** 1.5 * level * 0.5; } return out; }
/** Fold everything under `fc` to mono (a hi-fi bottom). */
function monoLow(st, fc = 150, passes = 3) {
  const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
  for (let p = 0; p < passes; p++) { let l = 0, r = 0; for (let i = 0; i < st[0].length; i++) { l += a * (st[0][i] - l); r += a * (st[1][i] - r); const m = (l + r) * 0.5; st[0][i] += m - l; st[1][i] += m - r; } }
  return st;
}
/** Guardrail report (docs: Aesthetic principles and guardrails). */
function guardrails(name, mix, noiseBed, music) {
  const rmsOf = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
  const m = mix[0].map((v, i) => (v + mix[1][i]) * 0.5), win = 2 * SR, secs = [];
  for (let i = 0; i + win <= m.length; i += win) secs.push(20 * Math.log10(rmsOf(m, i, i + win) + 1e-9));
  secs.sort((a, b) => a - b);
  const arc = secs.at(-1) - secs.at(Math.floor(secs.length * 0.1));
  let peak = 0; for (const v of m) peak = Math.max(peak, Math.abs(v));
  const crest = 20 * Math.log10(peak / rmsOf(m, 0, m.length));
  // the low band measured through a 4-pole low-pass at 150 Hz (a one-pole leaks too much of the stereo middle)
  const a = 1 - Math.exp(-2 * Math.PI * 150 / SR), L = [0, 0, 0, 0], R = [0, 0, 0, 0]; let sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < mix[0].length; i++) { let xl = mix[0][i], xr = mix[1][i]; for (let k = 0; k < 4; k++) { L[k] += a * (xl - L[k]); R[k] += a * (xr - R[k]); xl = L[k]; xr = R[k]; } sl += xl * xl; sr += xr * xr; slr += xl * xr; }
  const corr = slr / Math.sqrt(sl * sr + 1e-12);
  const nz = 20 * Math.log10(rmsOf(noiseBed, 0, noiseBed.length) / (rmsOf(music, 0, music.length) + 1e-9));
  const ok = (b) => (b ? 'PASS' : 'FAIL');
  console.log(`  ${name}: arc ${arc.toFixed(1)} dB ${ok(arc >= 12)} · crest ${crest.toFixed(1)} dB ${ok(crest >= 11 && crest <= 16)} · low-end corr ${corr.toFixed(3)} ${ok(corr > 0.95)} · noise bed ${nz.toFixed(1)} dB ${ok(nz <= -18)}`);
}
const monoOf = (st) => st[0].map((v, i) => (v + st[1][i]) * 0.5);
const VOICING = { light: ['A2', 'E3', 'B3', 'C#4', 'F#4', 'A4'], cold: ['A2', 'E3', 'B3', 'D4', 'E4', 'A4'], sus: ['A2', 'E3', 'A3', 'D4', 'G4', 'A4'] };

// ---------------------------------------------------------------------------- round 5: grit first, Highland grammar as substrate
/** Comb resonator excited by `x`, its pitch following `fAt(t)` (fractional delay, damped loop): pitch heard only as resonance inside noise. */
function resonate(x, fAt, { g = 0.965, damp = 0.35 } = {}) {
  const MAX = 4096, buf = new Float32Array(MAX), y = new Float32Array(x.length); let w = 0, lp = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.min(MAX - 2, SR / fAt(i / SR)), r = w - d, i0 = Math.floor(r), fr = r - i0;
    const a = buf[(i0 + MAX) % MAX], b = buf[(i0 + 1 + MAX) % MAX], fb = a + (b - a) * fr;
    lp += (1 - damp) * (fb - lp);
    const v = x[i] + g * lp; buf[w % MAX] = v; w++; y[i] = v;
  }
  return y;
}
const pinkish = (n) => { const y = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0; for (let i = 0; i < n; i++) { const w = rnd() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; y[i] = b0 + b1 + b2 + w * 0.02; } return y; };
/** A step function of the ground's pitch over time (for resonators): the ground as substrate. */
const groundPitchAt = (ev, mult = 1) => (t) => { let f = freq('A3'); for (const e of ev) { if (e.t > t) break; f = freq(e.pitch) * mult; } return f; };
/**
 * Eroding loop: `frag` repeated `passes` times, each pass older — wow and flutter, dropouts, fewer bits, a closing filter, more crackle.
 * Returns { out, marks } where marks are the pass start indices (for the decay guardrail).
 */
function erodeLoop(frag, passes = 6, { maxWow = 0.012 } = {}) {
  const n = frag.length, out = new Float32Array(n * passes), marks = [];
  for (let p = 0; p < passes; p++) {
    const deg = passes > 1 ? p / (passes - 1) : 1, base = p * n, bits = Math.round(13 - 9 * deg), hold = 1 + Math.round(6 * deg);
    const fc = 400 + 8600 * (1 - deg) ** 1.6, a = 1 - Math.exp(-2 * Math.PI * fc / SR); let s = 0, h = 0, drop = 1, read = 0;
    marks.push(base);
    for (let j = 0; j < n; j++) {
      const t = j / SR, rate = 1 + maxWow * deg * Math.sin(2 * Math.PI * 0.45 * t + p) + 0.3 * maxWow * deg * Math.sin(2 * Math.PI * 7.3 * t);
      read += rate; const i0 = Math.floor(read) % n, v = frag[i0];
      if (rnd() < 0.00004 * (1 + 60 * deg)) drop = 0.03; drop += (1 - drop) * 0.0006;
      if (j % hold === 0) h = Math.round(v * 2 ** (bits - 1)) / 2 ** (bits - 1);
      s += a * (h - s);
      out[base + j] = s * drop * (1 - 0.35 * deg) + (rnd() < 0.002 * deg ? (rnd() - 0.5) * 0.4 * deg : 0);
    }
  }
  return { out, marks, frag };
}
/** Contact-mic scrape: band-limited noise with sharp, irregular amplitude spikes. */
function scrape(sec, { density = 1.5, fc = 1800, level = 0.5 } = {}) {
  const y = new Float32Array(Math.ceil(sec * SR)), n = Math.floor(sec * density);
  for (let k = 0; k < n; k++) {
    const i0 = Math.floor(rnd() * y.length), len = Math.floor((0.08 + rnd() * 0.5) * SR), f = fc * (0.6 + rnd() * 0.8), a = 1 - Math.exp(-2 * Math.PI * f / SR); let s = 0, s2 = 0, amp = 0;
    for (let j = 0; j < len && i0 + j < y.length; j++) { if (rnd() < 0.004) amp = rnd(); amp *= 0.9993; s += a * ((rnd() * 2 - 1) - s); s2 += a * 0.3 * (s - s2); y[i0 + j] += (s - s2) * amp * level * Math.sin(Math.PI * j / len); }
  }
  return y;
}
/** Grain click: a 3-12 ms burst of saturated noise or of `src` at a random spot (rhythm made of grain). */
function grainClick(level = 0.5, src = null) {
  const n = Math.floor((0.003 + rnd() * 0.009) * SR), out = new Float32Array(n), from = src ? Math.floor(rnd() * (src.length - n)) : 0;
  for (let j = 0; j < n; j++) { const w = Math.sin(Math.PI * j / n); out[j] = tape((src ? src[from + j] * 3 : rnd() * 2 - 1) * w, 3, 0.1) * level; }
  return out;
}
/** Reverse-reverb swell: a snippet's reverb tail, reversed, landing on `at`. */
function reverseSwell(st, snippet, at, rt = 3, level = 0.6) {
  const pad = Math.ceil(rt * SR), x = new Float32Array(snippet.length + pad); x.set(snippet);
  const wet = reverb([x, x], rt, 0.45, 0), len = wet[0].length;
  for (let c = 0; c < 2; c++) { const rev = wet[c].slice().reverse(); mixInto([st[c], st[c]], rev, at - len / SR, c === 0 ? level : 0, c === 1 ? level : 0); }
}
const dirty = (x, bits = 6, drive = 3) => shape(crush(x, bits, 2), (v) => tape(v * 1.4, drive, 0.12));
/** Sub (mono A1+A2) and a detuned, beating, distorted mid drone. */
function subAndBeat(sec, { sub = 0.5, beat = 0.5, fc = 1300 } = {}) {
  const n = Math.ceil(sec * SR), s = new Float32Array(n), b = new Float32Array(n);
  let p1 = 0, p2 = 0; for (let i = 0; i < n; i++) { p1 += freq('A1') / SR; p2 += freq('A2') / SR; s[i] = tape(Math.sin(2 * Math.PI * p1) * 0.7 + Math.sin(2 * Math.PI * p2) * 0.4, 1.4, 0.05) * sub; }
  const det = [['A2', -7], ['A2', 6], ['E3', -5], ['E3', 8], ['A3', 3]];
  for (const [nm, c] of det) { const f = freq(nm) * 2 ** (c / 1200); let ph = rnd(); for (let i = 0; i < n; i++) { ph += f / SR; b[i] += ((ph % 1) * 2 - 1) * 0.25; } }
  const bd = lowpass(shape(b, (v) => tape(v * 2.5, 4, 0.25)), (t) => fc * (0.7 + 0.3 * Math.sin(t * 0.21)));
  for (let i = 0; i < n; i++) bd[i] *= beat;
  return { sub: s, beat: bd };
}
/** Soft peak limiter: tames the transient spikes of surging contra layers without flattening the arc. */
function limit(st, drive = 1.8) {
  let peak = 0; for (const ch of st) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const g = 1 / (peak || 1), k = Math.tanh(drive);
  for (const ch of st) for (let i = 0; i < ch.length; i++) ch[i] = Math.tanh(drive * ch[i] * g) / k / g;
  return st;
}
/** Guardrails, round 5: the round-4 checks plus noise share, no clean lead, contra-rhythm and decay. */
function guardrails5(name, mix, { bed, music, lead, texture, layers, eroded }) {
  guardrails(name, mix, bed, music);
  const m = monoOf(mix), N = 4096, rows = [];
  for (let i = 0; i + N <= m.length; i += N / 2) { const fr = new Float64Array(N); for (let j = 0; j < N; j++) fr[j] = m[i + j] * (0.5 - 0.5 * Math.cos(2 * Math.PI * j / N)); rows.push(fr); }
  // spectral flatness 200 Hz - 8 kHz in the louder half of frames (a small DFT over a decimated band is enough for a ratio)
  const bins = []; for (let k = Math.ceil(200 * N / SR); k <= Math.floor(8000 * N / SR); k += 7) bins.push(k);
  const fl = rows.map((fr) => { let e = 0, lg = 0; for (const k of bins) { let re = 0, im = 0; const w = 2 * Math.PI * k / N; for (let j = 0; j < N; j += 4) { re += fr[j] * Math.cos(w * j); im -= fr[j] * Math.sin(w * j); } const p = re * re + im * im + 1e-12; e += p; lg += Math.log(p); } return { e, sf: Math.exp(lg / bins.length) / (e / bins.length) }; });
  const med = fl.map((r) => r.e).sort((a, b) => a - b)[fl.length >> 1], loud = fl.filter((r) => r.e >= med), sf = loud.reduce((a, r) => a + r.sf, 0) / loud.length;
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  const leadDb = 20 * Math.log10(rms(lead) / (rms(texture) + 1e-9) + 1e-9);
  const periods = [...new Set(layers.map((l) => l.toFixed(3)))];
  // decay: distance of each pass's band spectrum from the original fragment (dB, timing-insensitive) must grow pass by pass
  const CUTS = [250, 500, 1000, 2000, 4000, 8000];
  const profile = (seg) => { const e = new Float64Array(CUTS.length + 1), st = CUTS.map(() => [0, 0]), al = CUTS.map((f) => 1 - Math.exp(-2 * Math.PI * f / SR)); let tot = 0;
    for (const v of seg) { tot += v * v; let prev = 0; CUTS.forEach((f, k) => { st[k][0] += al[k] * (v - st[k][0]); st[k][1] += al[k] * (st[k][0] - st[k][1]); const lo = st[k][1]; e[k] += (lo - prev) ** 2; prev = lo; }); e[CUTS.length] += (v - prev) ** 2; }
    return Array.from(e, (x) => 10 * Math.log10(x / (tot + 1e-12) + 1e-9)); };
  const ref = profile(eroded.frag);
  const passHF = eroded.marks.map((s0) => { const pr = profile(eroded.out.subarray(s0, s0 + eroded.frag.length)); return pr.reduce((a, v, k) => a + Math.abs(v - ref[k]), 0) / pr.length; });
  // a trend, not a staircase (dropouts and crackle make single passes wobble): the later half clearly further than the earlier half, and the last pass at least 1 dB beyond the first
  const half = Math.ceil(passHF.length / 2), mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const decaying = passHF.at(-1) >= passHF[0] + 1 && mean(passHF.slice(half)) > mean(passHF.slice(0, half)) + 0.3;
  const ok = (b) => (b ? 'PASS' : 'FAIL');
  console.log(`  ${name}: noise share (flatness) ${sf.toFixed(3)} ${ok(sf >= 0.05)} · lead vs texture ${leadDb.toFixed(1)} dB ${ok(leadDb <= -10)} · rhythm periods ${periods.join(' / ')} beats ${ok(periods.length >= 2)} · spectral distance by pass ${passHF.map((v) => v.toFixed(1)).join(' < ')} dB ${ok(decaying)}`);
}

// ---------------------------------------------------------------------------- the three sketches (round 6: stanza form)
/**
 * Stanza grid: every change in a sketch lands on it (a wall swell, a cut, a glimpse, a contra surge, a stutter),
 * so the piece proceeds as continuous stanzas, the way a recorded track does, instead of an accumulation of events.
 */
function stanzas(t0, bpm, barsPer = 4) {
  const beat = 60 / bpm, bar = 4 * beat, len = barsPer * bar;
  return { beat, bar, len, barT: (b) => t0 + b * bar, st: (i) => t0 + i * len, stEnd: (i) => t0 + (i + 1) * len };
}
/** A glimpse of the ground: its first few notes on tines, lightly worn, surfacing for about a bar. */
function glimpse(st, ev, at, { notes = 4, level = 0.35, spread = 0.5, pitchMul = 1 } = {}) {
  const part = stereo(4.5);
  ev.slice(0, notes).forEach((e, k) => mixInto(part, tine(freq(e.pitch) * pitchMul, { vel: 0.45, level, dur: 2.2, grace: e.grace ? freq(e.grace) * pitchMul : null }), k * spread + jit(15), 0.5));
  const worn = erodeLoop(monoOf(part), 2, { maxWow: 0.006 }).out.subarray(Math.floor(4.5 * SR));   // the second, slightly aged pass
  mixInto(st, worn, at, 0.52, 0.48);
}
const surge = (pts) => curve(pts);   // gain envelopes for the contra layers, built from stanza times

const SKETCHES = {
  // Fennesz end: four-bar stanzas — I sparse, II the wall builds, III hard cut to bare, IV re-swell; glimpses on stanza downbeats
  lyon() {
    const g = GROUNDS['3-lyon'], { ev, end } = groundEvents(g, 2, 3), sec = end + 9, S = stanzas(3, g.bpm, 4), n = Math.ceil(sec * SR);
    const cutAt = S.st(2);
    const wall = curve([[0, 0.15], [S.st(1), 0.3], [S.st(1) + 2 * S.bar, 0.7], [cutAt - S.bar, 1], [cutAt - 0.05, 1], [cutAt, 0.05], [S.st(3), 0.08], [S.st(3) + 2 * S.bar, 0.45], [sec, 0.15]]);
    const frag = stereo(5); strum(frag, VOICING.cold, 0.05, { level: 0.4, dur: 5, bright: 0.45 });
    const er = erodeLoop(monoOf(frag).subarray(0, Math.floor(S.bar * SR)), 12, { maxWow: 0.015 });   // the loop is one bar long: it ages bar by bar
    const loop = new Float32Array(n); loop.set(er.out.subarray(0, Math.min(er.out.length, n - Math.floor(S.st(0) * SR))), Math.floor(S.st(0) * SR));
    const nz = pinkish(n), pad = new Float32Array(n);
    for (const [fn, gn] of [[groundPitchAt(ev, 0.5), 0.5], [groundPitchAt(ev, 0.75), 0.25], [() => freq('A2'), 0.35]]) { const r = resonate(nz, fn, { g: 0.93, damp: 0.45 }); for (let i = 0; i < n; i++) pad[i] += r[i] * gn; }
    for (let i = 0; i < n; i++) pad[i] = tape(pad[i] * 0.5, 2.5, 0.1) * (0.4 + 0.6 * wall(i / SR));
    const mix = droneWall(sec, wall, { drive: 4, smear: 0.8, hiss: 0.025, sweep: 30, lo: 300, hi: 1500, noise: 0.42 });
    applyCurve(mix, curve([[0, 0.45], [S.st(1) + 2 * S.bar, 0.8], [cutAt - 0.05, 0.8], [cutAt, 0.12], [sec, 0.3]]));
    const { sub, beat } = subAndBeat(sec, { sub: 0.35, beat: 0.3, fc: 900 });
    add(mix, applyCurve(mono2(beat, 0.5, 0.5), wall)); add(mix, mono2(sub, 0.6, 0.6));
    add(mix, mono2(pad, 0.55, 0.5), 0.9);
    add(mix, applyCurve(mono2(windNoise(sec, { lo: 600, hi: 6000, rate: 0.04, depth: 0.5 }), 0.45, 0.4), wall), 0.72);
    add(mix, mono2(loop, 0.5, 0.42), 0.8);
    add(mix, granulate(loop, { density: 40, gmin: 0.03, gmax: 0.25, back: 4, cents: 25, oct: 0.15, rev: 0.5 }), 0.7);
    // glimpses of the ground on the downbeats of stanzas II and IV
    glimpse(mix, ev, S.st(1), { notes: 3, level: 0.32, spread: S.beat * 2 });
    glimpse(mix, ev.slice(4), S.st(3), { notes: 3, level: 0.3, spread: S.beat * 2 });
    // contra-rhythm: 3 against 4 on the beat grid, surging in the last two bars of stanza II (into the cut)
    const perc = stereo(sec), layers = [3, 4], up = surge([[0, 0.8], [cutAt - 2 * S.bar, 0.8], [cutAt - 2 * S.bar + 0.01, 1.9], [cutAt - 0.05, 1.9], [cutAt, 0.6], [sec, 0.8]]);
    for (let t = S.st(0); t < sec - 2; t += 3 * S.beat) mixInto(perc, grainClick(0.5 * up(t), loop), t + jit(12), 0.65, 0.35);
    for (let t = S.st(0) + S.beat / 2; t < sec - 2; t += 4 * S.beat) mixInto(perc, dirty(dust(0.15, 120, 0.6 * up(t)), 5, 3), t + jit(12), 0.35, 0.65);
    for (const e of ev) mixInto(perc, dirty(thud(0.9), 7, 2.5), e.t + jit(15), 0.55);
    add(perc, mono2(scrape(sec, { density: 0.6, fc: 2200, level: 0.32 }), 0.45, 0.55));
    for (let b = 4; b < 12; b += 2) stutter(perc, S.barT(b) - S.beat / 2, S.beat / 4, 3, 0.85);   // stutters land on bar ends
    applyCurve(perc, curve([[0, 0.7], [cutAt - 0.05, 1], [cutAt, 0.35], [sec, 0.5]]));
    add(mix, perc, 1);
    const bed = dust(sec, 6, 0.04); add(mix, mono2(bed, 0.5, 0.5));
    add(mix, reverb(mix, 7, 0.55, 0.02), 0.28);
    monoLow(mix); compress(mix, -22, 3, 0.004, 0.2, 1.6);
    applyCurve(mix, curve([[0, 0.45], [S.st(1), 0.55], [cutAt - S.bar, 1], [cutAt - 0.05, 1], [cutAt, 0.16], [S.st(3), 0.18], [S.st(3) + 2 * S.bar, 0.55], [sec, 0.2]]));
    const texture = new Float32Array(n); for (let i = 0; i < n; i++) texture[i] = pad[i] + (mix[0][i] + mix[1][i]) * 0.25;
    limit(mix);
    guardrails5('lyon', mix, { bed, music: monoOf(mix), lead: new Float32Array(n), texture, layers, eroded: er });
    return mix;
  },

  // Floating Points end, five four-bar stanzas: I intro, II groove, III full + contra surge, IV hard-cut break, V return and fade.
  // The lead is no longer a bouncing reel line: an evolving modular arpeggio that skips, glides, shifts register by stanza and accents in fives.
  coe() {
    const g = GROUNDS['6-coe'], cell = parseGround(g.notes), S = stanzas(1.5, g.bpm, 4), bars = 20, sec = S.barT(bars) + 4, s16 = S.beat / 4, n = Math.ceil(sec * SR);
    const cut = S.st(3), back = S.st(4);
    const wall = curve([[0, 0.15], [S.st(1), 0.35], [S.st(2), 0.8], [cut - 0.05, 1], [cut, 0.4], [back - 0.05, 0.45], [back, 0.85], [sec - 3, 0.7], [sec, 0]]);
    const notes = cell.map((x) => x.pitch);
    const lead = new Float32Array(n);
    let glideF = freq(notes[0]) / 4, ph = 0, s1 = 0, s2 = 0;
    for (let b = 0; b < bars * 8; b++) {
      const t = S.st(0) + b * 2 * s16, stz = Math.floor(b / 32), i = b % 16;
      if (rnd() > [0.55, 0.8, 0.85, 0.5, 0.75][stz]) continue;                                    // the cell is implied, never spelled out
      const oct = (stz === 2 && b % 5 === 0) ? 2 : 1, target = freq(notes[i]) / 4 * oct, accent = b % 5 === 0 ? 1 : 0.55;   // accents every 5 eighths across the 8-step bar: a contra line inside the lead
      const len = Math.floor(2 * s16 * (0.6 + rnd() * 0.7) * SR), i0 = Math.floor((t + jit(6)) * SR);
      for (let j = 0; j < len && i0 + j < n; j++) {
        glideF += (target - glideF) * 0.0025;                                                     // portamento: notes slide, nothing hops
        ph += glideF / SR;
        const tt = (i0 + j) / SR, saw = ((ph % 1) * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * ph * 1.5) * 0.3 * Math.sin(tt * 0.31);
        const fc = 160 + (380 + 900 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.06 * tt))) * accent * Math.exp(-j / SR / 0.09), a = 1 - Math.exp(-2 * Math.PI * fc / SR);
        s1 += a * (saw - s1); s2 += a * (s1 - s2);
        lead[i0 + j] += fold(tape(s2 * 2, 3.5, 0.2), 1.15) * 0.5 * Math.min(1, j / 120, (len - j) / 400);
      }
    }
    const leadD = crush(lead, 8, 2);
    const frag = stereo(3); strum(frag, ['E2', 'B2', 'E3', 'G3', 'D4'], 0.02, { level: 0.5, dur: 3, bright: 0.5 });
    const er = erodeLoop(monoOf(frag).subarray(0, Math.floor(1.3 * SR)), 8, { maxWow: 0.02 });
    const frags = stereo(sec);
    for (let bar = 4; bar < bars; bar += 2) { const p = (bar / 2) % 8, seg = er.out.subarray(er.marks[p], er.marks[p] + Math.floor(0.6 * SR)); mixInto(frags, seg, S.barT(bar) + 3 * s16 + jit(8), 0.35, 0.65); stutter(frags, S.barT(bar) + 3 * s16, s16, 3 + (bar % 3), 0.85); }
    // glimpse of the ground (the album cell, not the reel) at the start of the break, low and worn
    glimpse(frags, groundEvents(GROUNDS.album, 1, 0).ev, cut, { notes: 4, level: 0.3, spread: S.beat, pitchMul: 0.5 });
    const KICK = [1, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, 0, 0, 0.5], SN = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
    const kit = stereo(sec), kicks = [];
    for (let bar = 4; bar < bars; bar++) {
      if (bar >= 12 && bar < 16) continue;
      for (let s = 0; s < 16; s++) {
        const ts = S.barT(bar) + s * s16 + jit(7);
        if (KICK[s]) { mixInto(kit, dirty(kickTight(KICK[s]), 6, 3), ts, 0.95); kicks.push(ts); }
        if (SN[s] && bar >= 6) mixInto(kit, dirty(snareNoise(0.8, 0.16), 5, 3), ts + 0.006, 0.5);
        if (s % 2 === 1 && rnd() < 0.7) mixInto(kit, dirty(hatMetal(0.35, 0.015), 5, 2), ts, 0.45, 0.55);
      }
    }
    // contra: 3:4 grain pulse and 5:4 metal, surging through stanza III and the first bars back from the break
    const contra = stereo(sec), layers = [0.75, 1.25];
    const up = surge([[0, 0.7], [S.st(2) - 0.01, 0.7], [S.st(2), 1.8], [cut - 0.05, 1.8], [cut, 0.2], [back - 0.01, 0.2], [back, 1.6], [back + 2 * S.bar, 1.6], [back + 2 * S.bar + 0.01, 0.9], [sec, 0.9]]);
    for (let t = S.st(1); t < sec - 3; t += 3 * s16) mixInto(contra, grainClick(0.45 * up(t), lead), t + jit(4), 0.7, 0.3);
    for (let t = S.st(1) + 2 * S.bar; t < sec - 3; t += 5 * s16) mixInto(contra, dirty(metalHit(freq('E4'), { level: 0.18 * up(t), attack: 0.002, decay: 0.35, len: 0.6 }), 6, 2), t + jit(4), 0.3, 0.7);
    const mix = droneWall(sec, wall, { drive: 4.5, smear: 0.5, hiss: 0.04, sweep: 12, lo: 250, hi: 2000, noise: 0.42 });
    const { sub, beat } = subAndBeat(sec, { sub: 0.25, beat: 0.4, fc: 1100 });
    add(mix, applyCurve(mono2(beat, 0.5, 0.5), wall));
    add(mix, mono2(scrape(sec, { density: 1.2, fc: 2600, level: 0.36 }), 0.5, 0.5));
    duck(mix, kicks, 0.6, 0.22);
    add(mix, mono2(sub, 0.5, 0.5)); add(mix, mono2(leadD, 0.8, 0.8)); add(mix, frags, 1); add(mix, contra, 1);
    add(kit, reverb(kit, 0.5, 0.3, 0.004), 0.1); add(mix, kit, 1.05);
    for (const b of [7, 11, 15, 19]) stutter(mix, S.barT(b) + 12 * s16, s16 * (b % 2 ? 1 : 2), 3, 0.9);   // into every stanza change
    const bed = dust(sec, 5, 0.04); add(mix, mono2(bed, 0.5, 0.5));
    add(mix, reverb(mix, 1.3, 0.4, 0.01), 0.08);
    monoLow(mix); compress(mix, -20, 3.5, 0.003, 0.12, 1.7);
    applyCurve(mix, curve([[0, 0.3], [S.st(1) - 0.05, 0.35], [S.st(1), 1], [cut - 0.05, 1], [cut, 0.22], [back - 0.05, 0.28], [back, 1], [sec - 4, 1], [sec, 0.03]]));
    limit(mix);
    guardrails5('coe', mix, { bed, music: monoOf(mix), lead: new Float32Array(n), texture: monoOf(mix), layers, eroded: er });
    return mix;
  },

  // In between, four-bar stanzas of 15 s: I worn ground alone, II the beat enters, III-IV the wall, V hard cut, VI-VII bare and worn
  album() {
    const g = GROUNDS.album, { ev, end } = groundEvents(g, 1, 0), S = stanzas(3, g.bpm, 4);
    const one = stereo(end + 2);
    for (const e of ev) mixInto(one, tine(freq(e.pitch), { vel: 0.6, level: 0.45, dur: Math.min(3, e.dur + 1), grace: e.grace ? freq(e.grace) : null }), e.t + jit(15), 0.5);
    const frag = monoOf(one).subarray(0, Math.floor(end * SR));
    const er = erodeLoop(frag, 3, { maxWow: 0.01 }), sec = S.st(6) + 4, n = Math.ceil(sec * SR), cutAt = S.st(4);
    const wall = curve([[0, 0.1], [S.st(1), 0.25], [S.st(2), 0.6], [S.st(3), 1], [cutAt - 0.05, 1], [cutAt, 0.05], [sec, 0.05]]);
    const loop = new Float32Array(n); loop.set(er.out.subarray(0, Math.min(er.out.length, n - Math.floor(S.st(0) * SR))), Math.floor(S.st(0) * SR));
    const nz = pinkish(n), pad = new Float32Array(n);
    for (const [fn, gn] of [[groundPitchAt(ev.map((e) => ({ ...e, t: e.t + S.st(0) })), 0.5), 0.45], [() => freq('E3'), 0.3], [() => freq('A2'), 0.3]]) { const r = resonate(nz, fn, { g: 0.97, damp: 0.4 }); for (let i = 0; i < n; i++) pad[i] += r[i] * gn; }
    for (let i = 0; i < n; i++) pad[i] = tape(pad[i] * 0.5, 2.5, 0.1) * (0.35 + 0.65 * wall(i / SR));
    const mix = droneWall(sec, wall, { drive: 3.6, smear: 0.6, hiss: 0.025, sweep: 22, lo: 350, hi: 1800, noise: 0.42 });
    applyCurve(mix, curve([[0, 0.45], [S.st(2), 0.75], [cutAt - 0.05, 0.75], [cutAt, 0.1], [sec, 0.15]]));
    const { sub, beat } = subAndBeat(sec, { sub: 0.3, beat: 0.35, fc: 1000 });
    add(mix, applyCurve(mono2(beat, 0.5, 0.5), wall)); add(mix, mono2(sub, 0.55, 0.55));
    add(mix, mono2(pad, 0.5, 0.55), 0.9);
    add(mix, mono2(loop, 0.48, 0.42), 0.6);
    add(mix, granulate(loop, { density: 34, gmin: 0.03, gmax: 0.3, back: 3, cents: 20, oct: 0.2, rev: 0.45 }), 0.6);
    for (const k of [1, 3, 5]) glimpse(mix, ev.slice((k - 1) * 2), S.st(k), { notes: 4, level: 0.3, spread: S.beat });   // glimpses on stanza downbeats
    const kit = stereo(sec), kicks = [], KICK = [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.8, 0, 0, 0, 0, 0], s16 = S.beat / 4;
    for (let t = S.st(1); t < cutAt - 0.1; t += S.bar) for (let s = 0; s < 16; s++) {
      const ts = t + s * s16 + jit(7);
      if (KICK[s]) { mixInto(kit, dirty(kickTight(KICK[s]), 6, 3), ts, 0.95); kicks.push(ts); }
      if (s === 8 && t >= S.st(2)) mixInto(kit, dirty(snareNoise(0.8, 0.2), 5, 3), ts + 0.006, 0.5);
      if (s % 2 === 0) mixInto(kit, dirty(shaker(0.5 * (0.8 + rnd() * 0.3)), 6, 2), ts, 0.42, 0.58);
    }
    const contra = stereo(sec), layers = [1, 1.25];
    const up = surge([[0, 0.7], [S.st(3) - 0.01, 0.7], [S.st(3), 1.7], [cutAt - 0.05, 1.7], [cutAt, 0.4], [sec, 0.4]]);
    for (let t = S.st(1); t < cutAt - 0.1; t += S.beat) { mixInto(contra, grainClick(0.4 * up(t), loop), t + jit(5), 0.7, 0.3); mixInto(contra, grainClick(0.3 * up(t), loop), t + 0.25 * S.beat + jit(3), 0.7, 0.3); }
    for (let t = S.st(2); t < cutAt - 0.1; t += 5 * s16) mixInto(contra, dirty(metalHit(freq('A3'), { level: 0.16 * up(t), attack: 0.002, decay: 0.5, len: 0.8 }), 6, 2), t + jit(4), 0.3, 0.7);
    duck(mix, kicks, 0.5, 0.25);
    add(mix, mono2(scrape(sec, { density: 0.8, fc: 2000, level: 0.28 }), 0.5, 0.5));
    add(kit, reverb(kit, 0.6, 0.3, 0.004), 0.1); add(mix, kit, 1); add(mix, contra, 1);
    for (const b of [7, 11, 15]) stutter(mix, S.barT(b) + 3 * S.beat, S.beat / 4, 4, 0.85);   // into stanza changes
    reverseSwell(mix, frag.subarray(0, Math.floor(1.2 * SR)), cutAt, 3, 0.5);                   // lands exactly on the cut
    const bed = dust(sec, 6, 0.04); add(mix, mono2(bed, 0.5, 0.5));
    add(mix, reverb(mix, 5, 0.5, 0.02), 0.22);
    monoLow(mix); compress(mix, -21, 3, 0.005, 0.18, 1.6);
    applyCurve(mix, curve([[0, 0.4], [S.st(1), 0.6], [S.st(3), 1], [cutAt - 0.05, 1], [cutAt, 0.14], [sec, 0.14]]));
    const texture = new Float32Array(n); for (let i = 0; i < n; i++) texture[i] = pad[i] + (mix[0][i] + mix[1][i]) * 0.25;
    const leadStem = new Float32Array(n); for (let i = 0; i < n; i++) leadStem[i] = loop[i] * 0.48;
    limit(mix);
    guardrails5('album', mix, { bed, music: monoOf(mix), lead: leadStem, texture, layers, eroded: er });
    return mix;
  },
};

export { SR, freq, rnd, stereo, mixInto, add, mono2, monoOf, lowpass, granulate, reverb, master, curve, applyCurve, duck, compress, limit, monoLow,
  tape, fold, shape, crush, windNoise, dust, noiseBursts, pinkish, resonate, erodeLoop, scrape, grainClick, reverseSwell, stutter, dirty,
  subAndBeat, droneBed, droneWall, bowedString, kickTight, snareNoise, hatMetal, metalHit, thud, jit, groundEvents };
export const reseed = (v = 12345) => { seed = v; };

if (import.meta.url === `file://${process.argv[1]}`) {
mkdirSync(OUT, { recursive: true });
for (const name of ONLY) {
  if (!SKETCHES[name]) continue;
  seed = 12345;
  const t = Date.now(), mix = SKETCHES[name]();
  const file = `${OUT}/sketch-${name}${JUST ? '-just' : ''}.wav`;
  master(mix, file);
  console.log(`${file}  ${(mix[0].length / SR).toFixed(1)} s  (${((Date.now() - t) / 1000).toFixed(1)} s to render)`);
}
}
