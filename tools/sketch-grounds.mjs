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
  const nz = windNoise(sec, { lo: 400, hi: 5000, rate: 0.05, depth: 0.5 });
  const wallSt = [new Float32Array(raw.length), new Float32Array(raw.length)];
  for (let i = 0; i < raw.length; i++) { const w = wall(i / SR); wallSt[0][i] = (hot[i] * 0.55 + nz[i] * 0.5) * w; wallSt[1][i] = (hot[i] * 0.5 + nz[(i + 911) % nz.length] * 0.5) * w; }
  add(bed, granulate(wallSt[0], { density: 22, gmin: 0.05, gmax: 0.3, cents: 20, oct: 0.05, rev: 0.4 }), 0.6);
  add(bed, wallSt, 1);
  return bed;
}

// ---------------------------------------------------------------------------- the three sketches
const SKETCHES = {
  // Fennesz end (axis 2): forceful drone wall in the middle, near-silence after; textural percussion, no beat
  lyon() {
    const g = GROUNDS['3-lyon'], { ev, end } = groundEvents(g, 2, 3), sec = end + 9;
    const wall = curve([[0, 0.05], [10, 0.15], [24, 0.6], [30, 1], [42, 1], [46, 0.05], [56, 0.05], [62, 0.3], [sec, 0]]);
    const mix = droneWall(sec, wall, { drive: 3.8, smear: 0.9, hiss: 0.05, sweep: 30, lo: 350, hi: 1700 });
    applyCurve(mix, curve([[0, 0.5], [8, 0.8], [30, 1], [44, 1], [47, 0.25], [56, 0.3], [62, 0.7], [sec, 0.4]]));
    const voice = new Float32Array(Math.ceil(sec * SR)), perc = [new Float32Array(voice.length), new Float32Array(voice.length)];
    for (const e of ev) {
      const step = 60 / g.bpm / 2;
      for (let k = 0, t = e.t; t < e.t + e.dur - 0.05; k++, t += step) {
        const p = shape(lpgPluck(freq(e.pitch), { ratio: 1, index: 1.4, decay: 0.9, grace: k === 0 && e.grace ? freq(e.grace) : null, level: 0.5 * 0.8 ** k }), (x) => tape(x * 1.6, 1.8, 0.1));
        const i0 = Math.floor(t * SR); for (let j = 0; j < p.length && i0 + j < voice.length; j++) voice[i0 + j] += p[j];
      }
      mixInto(perc, thud(1.1), e.t, 0.6, 0.55);                                                     // a low thud under every onset
      if (e.dur >= 60 / g.bpm * 4) mixInto(perc, metalHit(freq(e.pitch) / 2, { level: 0.22, attack: 0.4, decay: 3.5, len: 5 }), e.t + e.dur * 0.6, 0.4, 0.6);   // bowed metal at phrase ends
    }
    add(perc, applyCurve(mono2(noiseBursts(sec, { density: 3, fc: 5000, level: 0.45 }), 0.5, 0.6), wall), 1);     // crackle bursts ride the wall
    add(perc, mono2(dust(sec, 9, 0.25), 0.55, 0.5), 1);
    add(mix, mono2(voice, 0.55, 0.45), 0.85);
    add(mix, granulate(voice, { density: 30, gmin: 0.15, gmax: 0.6, back: 3, cents: 6, oct: 0.2, rev: 0.4 }), 1.0);
    add(mix, perc, 1);
    add(mix, reverb(mix, 9, 0.5, 0.03), 0.42);
    return compress(mix, -16, 2.5, 0.01, 0.25, 1.4);
  },

  // Floating Points end (axis 8), rebuilt: low, straight, bass-led reel; heavy kit; forceful pumping drone wall
  coe() {
    const g = GROUNDS['6-coe'], spb = 60 / g.bpm, cell = parseGround(g.notes), bars = 20, t0 = 1.5, sec = t0 + bars * 4 * spb + 5, eighth = spb / 2;
    const barT = (b) => t0 + b * 4 * spb;
    const wall = curve([[0, 0.7], [barT(4), 0.9], [barT(12), 1], [barT(16), 0.8], [barT(18), 1], [sec, 0.3]]);
    const mix = droneWall(sec, wall, { drive: 4, smear: 0.4, hiss: 0.04, sweep: 14, lo: 300, hi: 2200 });
    applyCurve(mix, curve([[0, 0.55], [barT(4), 0.7], [barT(16), 0.7], [sec, 0.5]]));
    const notes = cell.map((n) => n.pitch), graces = cell.map((n) => (n.graces.length ? n.graces.at(-1) : null));
    const bass = new Float32Array(Math.ceil(sec * SR)), plucks = [new Float32Array(bass.length), new Float32Array(bass.length)], kit = [new Float32Array(bass.length), new Float32Array(bass.length)];
    const kicks = [];
    for (let b = 0; b < bars * 8; b++) {
      const t = t0 + b * eighth, i = b % 16, bar = Math.floor(b / 8), full = bar >= 4 && bar < 16, phase = bar >= 12 && bar < 16;
      // bass: the reel cell itself, two octaves down, saw stack through a closing filter and tape
      { const f = freq(notes[i]) / 4, n = Math.floor(eighth * 0.85 * SR), i0 = Math.floor(t * SR); let ph = 0, s = 0;
        for (let j = 0; j < n && i0 + j < bass.length; j++) { ph += f / SR; let saw = 0; for (let k = 1; k <= 12; k++) saw += Math.sin(2 * Math.PI * k * ph) / k; const tt = j / SR, fc = 220 + 1400 * Math.exp(-tt / 0.06) * (graces[i] && tt < 0.01 ? 1.6 : 1), a = 1 - Math.exp(-2 * Math.PI * fc / SR); s += a * (saw - s); bass[i0 + j] += tape(s * 1.4, 3, 0.15) * 0.55 * Math.min(1, j / 60, (n - j) / 200); } }
      // plucks: an octave down from before, darker and gritty; in the phase section a second line in threes
      if (bar >= 2) { const p = shape(lpgPluck(freq(notes[i]) / 2, { ratio: 1, index: 1.6, decay: 0.28, grace: graces[i] ? freq(graces[i]) / 2 : null, level: 0.35 }), (x) => fold(tape(x * 2, 2.5, 0.2), 1.2)); mixInto(plucks, p, t, 0.42, 0.58); }
      if (phase && b % 3 === 0) { const p = shape(lpgPluck(freq(notes[(b / 3 | 0) % 16]) / 2, { ratio: 1.5, index: 2, decay: 0.22, level: 0.28 }), (x) => tape(x * 2, 3, 0.2)); mixInto(plucks, p, t, 0.62, 0.38); }
      // kit: kick 1 and 3, snare 2 and 4, gritty 16th hats, a hat roll for the birl, tom fills into section changes
      if (bar >= 1 && b % 4 === 0) { mixInto(kit, kickHard(full ? 1 : 0.8), t, 0.9); kicks.push(t); }
      if (full && b % 8 === 4) mixInto(kit, snareNoise(0.75), t, 0.52, 0.48);
      if (full && b % 8 === 0 && bar % 2 === 1) mixInto(kit, snareNoise(0.25, 0.1), t - eighth / 2, 0.5);
      if (full) for (let h = 0; h < 2; h++) mixInto(kit, hatMetal(h ? 0.4 : 0.55, b % 2 && h ? 0.09 : 0.025), t + h * eighth / 2, 0.42, 0.58);
      if (full && b % 8 === 7) for (let k = 0; k < 4; k++) mixInto(kit, hatMetal(0.35, 0.02), t + k * eighth / 4, 0.4, 0.6);   // the birl: a gritty roll
      if ((bar === 3 || bar === 11 || bar === 15) && b % 8 >= 5) mixInto(kit, tom([110, 98, 82][b % 8 - 5], 0.6), t, 0.55, 0.45);
    }
    duck(mix, kicks, 0.55, 0.25);                                                                    // the wall pumps against the kick
    add(mix, mono2(crush(bass, 9, 2), 0.95, 0.95), 1);
    add(mix, plucks, 1);
    add(mix, mono2(dust(sec, 6, 0.2), 0.5, 0.55), 1);
    add(kit, reverb(kit, 0.9, 0.3, 0.005), 0.25);                                                   // a short room on the kit
    add(mix, kit, 1);
    add(mix, reverb(mix, 1.6, 0.4, 0.01), 0.12);
    return compress(mix, -18, 3.5, 0.004, 0.12, 1.8);
  },

  // The album ground (axis 4-5): sparse, then a heavy half-time pulse under the drone wall, then sparse again
  album() {
    const g = GROUNDS.album, { ev, end } = groundEvents(g, 2, 3), sec = end + 8, spb = 60 / g.bpm, bar = 4 * spb;
    const wall = curve([[0, 0.05], [12, 0.2], [20, 0.8], [24, 1], [50, 1], [54, 0.15], [sec, 0.05]]);
    const mix = droneWall(sec, wall, { drive: 2.8, smear: 0.55, hiss: 0.03, sweep: 22, lo: 450, hi: 2300 });
    applyCurve(mix, curve([[0, 0.55], [20, 0.8], [52, 0.8], [56, 0.45], [sec, 0.4]]));
    const voice = new Float32Array(Math.ceil(sec * SR)), kit = [new Float32Array(voice.length), new Float32Array(voice.length)], kicks = [];
    for (const e of ev) {
      const step = spb / 2;
      for (let k = 0, t = e.t; t < e.t + e.dur - 0.05; k++, t += step) {
        const p = shape(lpgPluck(freq(e.pitch), { ratio: 1, index: 2, decay: 1.1, grace: k === 0 && e.grace ? freq(e.grace) : null, level: 0.55 * 0.72 ** k, dur: 1.8 }), (x) => tape(x * 1.4, 1.6, 0.1));
        const i0 = Math.floor(t * SR); for (let j = 0; j < p.length && i0 + j < voice.length; j++) voice[i0 + j] += p[j];
      }
      if (e.dur >= 2 * spb) mixInto(kit, metalHit(freq(e.pitch), { level: 0.12, attack: 0.01, decay: 1.6, len: 2.5 }), e.t, 0.45, 0.55);   // struck metal on long notes
    }
    // half-time pulse from 20 s to 52 s: kick on 1, noise snare on 3, a ghost kick, dusty 8th hats
    for (let t = 3 + Math.ceil((20 - 3) / bar) * bar; t < 52; t += bar) {
      mixInto(kit, kickHard(0.95, 3.5), t, 0.9); kicks.push(t);
      mixInto(kit, snareNoise(0.7, 0.3), t + 2 * spb, 0.5);
      if (rnd() < 0.6) { mixInto(kit, kickHard(0.5, 2), t + 2.75 * spb, 0.9); kicks.push(t + 2.75 * spb); }
      for (let h = 0; h < 8; h++) mixInto(kit, hatMetal(h % 2 ? 0.22 : 0.35, 0.02), t + h * spb / 2, 0.45, 0.55);
    }
    duck(mix, kicks, 0.5, 0.3);
    add(mix, mono2(voice, 0.5, 0.5), 1);
    add(mix, granulate(voice, { density: 14, gmin: 0.1, gmax: 0.35, back: 2, cents: 4, oct: 0.15, rev: 0.2 }), 0.6);
    add(mix, mono2(dust(sec, 8, 0.22), 0.5, 0.55), 1);
    add(kit, reverb(kit, 1.4, 0.35, 0.008), 0.3);
    add(mix, kit, 1);
    add(mix, reverb(mix, 5, 0.45, 0.02), 0.32);
    return compress(mix, -17, 3, 0.006, 0.18, 1.6);
  },
};

mkdirSync(OUT, { recursive: true });
for (const name of ONLY) {
  if (!SKETCHES[name]) continue;
  seed = 12345;
  const t = Date.now(), mix = SKETCHES[name]();
  const file = `${OUT}/sketch-${name}${JUST ? '-just' : ''}.wav`;
  master(mix, file);
  console.log(`${file}  ${(mix[0].length / SR).toFixed(1)} s  (${((Date.now() - t) / 1000).toFixed(1)} s to render)`);
}
