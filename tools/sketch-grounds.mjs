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

// ---------------------------------------------------------------------------- the three sketches
const SKETCHES = {
  // Fennesz end: a cold strummed guitar and a buried tine ground; the guitar itself broken into the wall; hard cut to bare guitar
  lyon() {
    const g = GROUNDS['3-lyon'], { ev, end } = groundEvents(g, 2, 3), sec = end + 9, spb = 60 / g.bpm;
    const cutAt = 42;
    const wall = curve([[0, 0], [16, 0.05], [24, 0.45], [34, 0.9], [cutAt - 0.05, 1], [cutAt, 0], [55, 0], [61, 0.35], [sec, 0.1]]);
    const gtr = stereo(sec), tn = stereo(sec);
    for (let t = 2, k = 0; t < sec - 4; t += 2 * 4 * spb * (0.97 + rnd() * 0.06), k++) strum(gtr, VOICING.cold, t + jit(20), { up: k % 3 === 2, level: 0.32, dur: 7, bright: 0.45, pan: 0.45 });
    for (const e of ev) {
      tn[0].fill(0, 0, 0);
      const s = tine(freq(e.pitch), { vel: 0.5 + rnd() * 0.3, level: 0.45, grace: e.grace ? freq(e.grace) : null, dur: Math.min(5, e.dur + 1.5) });
      mixInto(tn, s, e.t + jit(25), 0.55, 0.45);
      if (e.dur >= 4 * spb) mixInto(tn, tine(freq(e.pitch), { vel: 0.35, level: 0.25, dur: 3 }), e.t + e.dur / 2 + jit(30), 0.45, 0.55);
    }
    const src = stereo(sec); add(src, gtr); add(src, tn, 0.8);
    const lap = laptop(src, wall, { bits: 6, grains: 30 });
    for (const t of [26.5, 31.2, 36.8, 40.1]) stutter(lap, t, 0.09 + rnd() * 0.1, 3 + (rnd() * 4 | 0), 0.85);
    const drone = droneBed(sec, { drive: 2.5, smear: 0.4, hiss: 0, sweep: 30, lo: 300, hi: 1400 });
    applyCurve(drone, curve([[0, 0.25], [30, 0.4], [cutAt - 0.05, 0.4], [cutAt, 0.1], [sec, 0.2]]));
    const bed = dust(sec, 7, 0.06);
    const mix = stereo(sec); add(mix, drone); add(mix, gtr, 1); add(mix, tn, 0.9); add(mix, lap, 1.25); add(mix, mono2(bed, 0.5, 0.5));
    add(mix, reverb(mix, 6, 0.55, 0.02), 0.25);
    monoLow(mix); compress(mix, -24, 3, 0.003, 0.2, 1.7);
    guardrails('lyon', mix, bed, monoOf(src));
    return mix;
  },

  // Floating Points end: bass-led reel, dark tines, cold guitar stabs, broken close drums, a hard-cut break, stutter edits
  coe() {
    const g = GROUNDS['6-coe'], spb = 60 / g.bpm, cell = parseGround(g.notes), bars = 20, t0 = 1.5, sec = t0 + bars * 4 * spb + 4, s16 = spb / 4;
    const barT = (b) => t0 + b * 4 * spb, cut = barT(10), back = barT(12);
    const wall = curve([[0, 0.05], [barT(2), 0.1], [barT(4), 0.35], [cut - 0.05, 0.9], [cut, 0.25], [back - 0.05, 0.3], [back, 0.6], [barT(18), 0.85], [sec - 3, 0.6], [sec, 0]]);
    const notes = cell.map((n) => n.pitch), graces = cell.map((n) => (n.graces.length ? n.graces.at(-1) : null));
    const bass = new Float32Array(Math.ceil(sec * SR)), keys = stereo(sec), gtr = stereo(sec), kit = stereo(sec), kicks = [];
    // broken patterns (16 steps): kick, clap, rim; velocities; varied per bar
    const KICK = [1, 0, 0, 0, 0, 0, 0.7, 0, 0, 0, 1, 0, 0, 0, 0, 0.5], CLAP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], RIM = [0, 0, 0.5, 0, 0, 0, 0, 0.4, 0, 0.6, 0, 0, 0, 0.5, 0, 0];
    for (let b = 0; b < bars * 8; b++) {
      const t = t0 + b * 2 * s16, i = b % 16, bar = Math.floor(b / 8), inBreak = bar >= 10 && bar < 12;
      { const f = freq(notes[i]) / 4, n = Math.floor(2 * s16 * 0.8 * SR), i0 = Math.floor((t + jit(6)) * SR); let ph = 0, s = 0;
        const cutoff = inBreak ? 300 : 260 + 1200;
        for (let j = 0; j < n && i0 + j < bass.length; j++) { ph += f / SR; let saw = 0; for (let k = 1; k <= 10; k++) saw += Math.sin(2 * Math.PI * k * ph) / k; const tt = j / SR, fc = 200 + cutoff * Math.exp(-tt / 0.07), a = 1 - Math.exp(-2 * Math.PI * fc / SR); s += a * (saw - s); bass[i0 + j] += tape(s * 1.3, 2.5, 0.15) * 0.5 * (0.85 + rnd() * 0.15) * Math.min(1, j / 60, (n - j) / 200); } }
      if (bar >= 2 && !inBreak && b % 2 === 0) mixInto(keys, tine(freq(notes[i]) / 2, { vel: 0.35 + rnd() * 0.25, level: 0.3, dur: 1.2, grace: graces[i] ? freq(graces[i]) / 2 : null }), t + jit(10), 0.6, 0.4);
    }
    for (let bar = 0; bar < bars; bar++) {
      const t = barT(bar);
      if (bar % 2 === 0 && bar >= 1) strum(gtr, ['E3', 'B3', 'D4', 'E4', 'B4'], t + 3 * s16 + jit(12), { level: 0.28, dur: 2.5, bright: 0.4, pan: 0.35, up: bar % 4 === 2 });
      if (bar < 2 || (bar >= 10 && bar < 12)) continue;   // intro and the hard-cut break: no drums
      const busy = bar >= 12;
      for (let s = 0; s < 16; s++) {
        const ts = t + s * s16 + jit(7), vary = (bar % 4 === 3 && s >= 12);
        if (KICK[s] && !(vary && s === 15)) { mixInto(kit, kickTight(KICK[s] * (busy ? 1 : 0.9)), ts, 0.85); kicks.push(ts); }
        if (vary && s === 14) { mixInto(kit, kickTight(0.6), ts, 0.85); kicks.push(ts); }
        if (CLAP[s]) mixInto(kit, clap(0.7 * (0.9 + rnd() * 0.15)), ts + 0.006, 0.5, 0.5);
        if (RIM[s] && rnd() < 0.85) mixInto(kit, rim(RIM[s] * 0.5), ts, 0.62, 0.38);
        mixInto(kit, shaker((s % 4 === 2 ? 0.55 : s % 2 ? 0.25 : 0.38) * (busy ? 1.1 : 0.9) * (0.8 + rnd() * 0.3)), ts, 0.4, 0.6);
      }
    }
    const src = stereo(sec); add(src, mono2(bass, 0.8, 0.8)); add(src, keys); add(src, gtr);
    const lap = laptop(src, wall, { bits: 7, grains: 24 });
    duck(lap, kicks, 0.5, 0.2);
    const mix = stereo(sec);
    add(mix, mono2(bass, 1, 1)); add(mix, keys, 1); add(mix, gtr, 1); add(mix, lap, 1.1);
    add(kit, reverb(kit, 0.6, 0.3, 0.004), 0.12);
    add(mix, kit, 1.05);
    for (const b of [9, 11, 15, 19]) stutter(mix, barT(b) + 12 * s16, s16 * (b % 2 ? 1 : 2), 3, 0.9);   // stutter edits into section changes
    const bed = dust(sec, 5, 0.05); add(mix, mono2(bed, 0.5, 0.5));
    add(mix, reverb(mix, 1.4, 0.4, 0.01), 0.08);
    monoLow(mix); compress(mix, -18, 3, 0.004, 0.12, 1.5);
    applyCurve(mix, curve([[0, 0.3], [barT(2) - 0.05, 0.35], [barT(2), 1], [cut - 0.05, 1], [cut, 0.22], [back - 0.05, 0.28], [back, 1], [sec - 4, 1], [sec, 0.03]]));   // the arc after the bus compressor, so the drops stay drops
    guardrails('coe', mix, bed, monoOf(src));
    return mix;
  },

  // In between: the album ground on tines (Promises-like patience), warm strummed washes, a broken kit in the middle, the wall from the instruments, a hard cut to bare tines
  album() {
    const g = GROUNDS.album, { ev, end } = groundEvents(g, 2, 3), sec = end + 8, spb = 60 / g.bpm, bar = 4 * spb, s16 = spb / 4;
    const cutAt = 50;
    const wall = curve([[0, 0], [14, 0.05], [22, 0.4], [40, 0.85], [cutAt - 0.05, 1], [cutAt, 0], [sec, 0]]);
    const tn = stereo(sec), gtr = stereo(sec), kit = stereo(sec), kicks = [];
    for (const e of ev) {
      for (let k = 0, t = e.t; t < e.t + e.dur - 0.05; k++, t += spb) mixInto(tn, tine(freq(e.pitch), { vel: (k ? 0.35 : 0.7) * (0.85 + rnd() * 0.3), level: 0.45 * 0.78 ** k, grace: k === 0 && e.grace ? freq(e.grace) : null, dur: 2.4 }), t + jit(18), 0.5 + (rnd() - 0.5) * 0.2, 0.5 - (rnd() - 0.5) * 0.2);
    }
    for (let t = 6, k = 0; t < sec - 6; t += 2 * bar * (0.97 + rnd() * 0.06), k++) strum(gtr, k % 4 === 3 ? VOICING.sus : VOICING.light, t + jit(25), { up: k % 2 === 1, level: 0.26, dur: 7, bright: 0.5, pan: 0.55 });
    const KICK = [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.8, 0, 0, 0, 0, 0], RIM = [0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.35, 0];
    for (let t = 3 + Math.ceil((20 - 3) / bar) * bar; t < cutAt - 0.1; t += bar) {
      for (let s = 0; s < 16; s++) {
        const ts = t + s * s16 + jit(8);
        if (KICK[s]) { mixInto(kit, kickTight(KICK[s]), ts, 0.85); kicks.push(ts); }
        if (s === 8) mixInto(kit, clap(0.65), ts + 0.008, 0.5, 0.5);
        if (RIM[s] && rnd() < 0.8) mixInto(kit, rim(RIM[s] * 0.5), ts, 0.6, 0.4);
        if (s % 2 === 0) mixInto(kit, shaker((s % 4 ? 0.3 : 0.42) * (0.8 + rnd() * 0.3)), ts, 0.42, 0.58);
      }
    }
    const src = stereo(sec); add(src, tn); add(src, gtr);
    const lap = laptop(src, wall, { bits: 7, grains: 26 });
    duck(lap, kicks, 0.45, 0.25);
    for (const t of [33.3, 41.7, 47.9]) stutter(lap, t, 0.11, 4, 0.85);
    const drone = droneBed(sec, { drive: 2.2, smear: 0.35, hiss: 0, sweep: 22, lo: 350, hi: 1600 });
    applyCurve(drone, curve([[0, 0.2], [cutAt - 0.05, 0.35], [cutAt, 0.08], [sec, 0.12]]));
    const bed = dust(sec, 6, 0.05);
    const mix = stereo(sec); add(mix, drone); add(mix, tn, 1); add(mix, gtr, 0.9); add(mix, lap, 1.15); add(mix, mono2(bed, 0.5, 0.5));
    add(kit, reverb(kit, 0.7, 0.3, 0.005), 0.12); add(mix, kit, 1);
    add(mix, reverb(mix, 4.5, 0.5, 0.02), 0.22);
    monoLow(mix); compress(mix, -18, 2.5, 0.006, 0.18, 1.4);
    guardrails('album', mix, bed, monoOf(src));
    return mix;
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
