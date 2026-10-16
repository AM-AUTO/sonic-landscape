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

// ---------------------------------------------------------------------------- the three sketches
const SKETCHES = {
  // Fennesz end (axis 2): the ground buried in a frozen, saturated granular cloud; re-struck soft plucks
  lyon() {
    const g = GROUNDS['3-lyon'], { ev, end } = groundEvents(g, 2, 3), sec = end + 9;
    const mix = droneBed(sec, { drive: 3.5, smear: 0.9, hiss: 0.03, sweep: 30, lo: 400, hi: 1800 });
    const voice = new Float32Array(Math.ceil(sec * SR));
    for (const e of ev) {
      // long notes sustained by a slow, decaying re-strike (no blown tone)
      const step = 60 / g.bpm / 2;
      for (let k = 0, t = e.t; t < e.t + e.dur - 0.05; k++, t += step) {
        const p = lpgPluck(freq(e.pitch), { ratio: 1, index: 1.2, decay: 0.9, grace: k === 0 && e.grace ? freq(e.grace) : null, level: 0.5 * 0.8 ** k });
        const i0 = Math.floor(t * SR); for (let j = 0; j < p.length && i0 + j < voice.length; j++) voice[i0 + j] += p[j];
      }
      // the ornament leaves a glint: a tiny high grain an octave up
      if (e.grace) { const gl = lpgPluck(freq(e.pitch) * 4, { ratio: 1, index: 0.3, decay: 0.08, level: 0.12 }); const i0 = Math.floor(e.t * SR); for (let j = 0; j < gl.length && i0 + j < voice.length; j++) voice[i0 + j] += gl[j]; }
    }
    add(mix, mono2(voice, 0.55, 0.45), 0.8);
    add(mix, granulate(voice, { density: 30, gmin: 0.15, gmax: 0.6, back: 3, cents: 6, oct: 0.2, rev: 0.4 }), 1.1);   // the melody half-buried in its own smear
    add(mix, reverb(mix, 9, 0.5, 0.03), 0.5);
    return mix;
  },

  // Floating Points end (axis 8): the reel cell on interlocking LPG plucks, kick, sub, birl ticks; phase section in the second half
  coe() {
    const g = GROUNDS['6-coe'], spb = 60 / g.bpm, cell = parseGround(g.notes), bars = 16, sec = 2 + bars * 4 * spb + 6;
    const mix = droneBed(sec, { drive: 2, smear: 0.35, hiss: 0.012, sweep: 16, lo: 700, hi: 3200 });
    for (const ch of mix) for (let i = 0; i < ch.length; i++) ch[i] *= 0.6;
    const eighth = spb / 2, t0 = 2, swing = 0.04;
    const notes = cell.map((n) => n.pitch), graces = cell.map((n) => (n.graces.length ? n.graces.at(-1) : null));
    for (let b = 0; b < bars * 8; b++) {
      const t = t0 + b * eighth + (b % 2 ? swing * eighth : 0), i = b % 16, bar = Math.floor(b / 8);
      // voice A: the cell itself, panned right
      const p = lpgPluck(freq(notes[i]), { ratio: 2, index: 3.2, decay: 0.16, grace: graces[i] ? freq(graces[i]) : null, level: 0.42 * (i % 4 === 0 ? 1 : 0.75) });
      mixInto(mix, p, t, 0.35, 0.65);
      // voice B from bar 8: the same cell grouped in threes (3 against 4), an octave up, panned left: the Transformation
      if (bar >= 8 && b % 3 === 0) mixInto(mix, lpgPluck(freq(notes[(b / 3 | 0) % 16]) * 2, { ratio: 3.5, index: 1.6, decay: 0.12, level: 0.22 }), t + 0.01, 0.7, 0.3);
      // kit from bar 4: kick on 1 and 3 (2/2 feel), birl ticks before beats, offbeat hats
      if (bar >= 4) {
        if (b % 4 === 0) mixInto(mix, kick(0.7), t, 0.7);
        if (b % 2 === 1) mixInto(mix, tick(0.28), t, 0.45, 0.55);
        if (b % 8 === 7) for (let k = 0; k < 3; k++) mixInto(mix, tick(0.18, 0.012), t + k * eighth / 3, 0.5);   // the birl as a triplet flutter
        if (b % 4 === 0) mixInto(mix, subBass(freq(notes[i]) / 4, eighth * 1.6, 0.3), t, 0.6);
      }
    }
    // sidechain-ish duck of the drone on kicks
    const dry = [mix[0].slice(), mix[1].slice()];
    add(mix, reverb(dry, 1.8, 0.35, 0.01), 0.18);
    return mix;
  },

  // The album ground in between (axis 4-5): electric-piano-like FM, re-struck sustains, soft granular echo, no beat
  album() {
    const g = GROUNDS.album, { ev, end } = groundEvents(g, 2, 3), sec = end + 8;
    const mix = droneBed(sec, { drive: 2.4, smear: 0.55, hiss: 0.015, sweep: 22, lo: 500, hi: 2400 });
    const voice = new Float32Array(Math.ceil(sec * SR));
    for (const e of ev) {
      const step = 60 / g.bpm / 2;
      for (let k = 0, t = e.t; t < e.t + e.dur - 0.05; k++, t += step) {
        const p = lpgPluck(freq(e.pitch), { ratio: 1, index: 1.8, decay: 1.1, grace: k === 0 && e.grace ? freq(e.grace) : null, level: 0.55 * 0.72 ** k, dur: 1.8 });
        const i0 = Math.floor(t * SR); for (let j = 0; j < p.length && i0 + j < voice.length; j++) voice[i0 + j] += p[j];
      }
    }
    add(mix, mono2(voice, 0.5, 0.5), 1);
    add(mix, granulate(voice, { density: 14, gmin: 0.1, gmax: 0.35, back: 2, cents: 4, oct: 0.15, rev: 0.2 }), 0.6);
    add(mix, reverb(mix, 5, 0.45, 0.02), 0.4);
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
