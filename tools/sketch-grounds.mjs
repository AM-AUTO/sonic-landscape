#!/usr/bin/env node
/**
 * Plain audio sketches of the grounds (tools/write-grounds.mjs) for listening without a DAW:
 * a reedy chanter line with its grace notes over an A2 + E3 drone, mono WAV, 44.1 kHz.
 * A sketch of the notes and their timing only. It is not the game's sound design.
 *
 *   node tools/sketch-grounds.mjs [--out out/midi] [--loops 2] [--just]
 *     --just   tune against the drone in just intonation (A 1/1, B 9/8, C# 5/4, D 4/3, E 3/2, F# 5/3, G 7/4)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GROUNDS, parseGround } from './write-grounds.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'out/midi');
const LOOPS = Math.max(1, Number(opt('loops', 2)) | 0);
const JUST = args.includes('--just');
const SR = 44100, PPQ = 480, GRACE_S = 0.03;

const PC = { C: 0, 'C#': 1, D: 2, E: 4, F: 5, 'F#': 6, G: 7, A: 9, B: 11 };
const RATIO = { A: 1, B: 9 / 8, 'C#': 5 / 4, D: 4 / 3, E: 3 / 2, 'F#': 5 / 3, G: 7 / 4 };
function freq(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name), oct = Number(m[2]);
  if (!JUST) return 440 * 2 ** ((12 * (oct + 1) + PC[m[1]] - 69) / 12);
  // just: relative to the A of the octave below or equal (A4 = 440); notes below A belong to the lower A's octave
  const aOct = PC[m[1]] < PC.A ? oct - 1 : oct;
  return 440 * 2 ** (aOct - 4) * RATIO[m[1]];
}

function render(name, { bpm, notes }) {
  const seq = parseGround(notes), spb = 60 / bpm;
  const total = seq.reduce((s, n) => s + n.ticks, 0) / PPQ * spb * LOOPS + 2;
  const buf = new Float32Array(Math.ceil(total * SR));
  // drone: two soft saw-ish partial stacks, slow swell in and out
  for (const [f, a] of [[freq('A2'), 0.16], [freq('E3'), 0.1]]) {
    for (let k = 1; k <= 12; k++) {
      const amp = a / k ** 1.3, w = 2 * Math.PI * f * k / SR;
      for (let i = 0; i < buf.length; i++) {
        const tt = i / SR, env = Math.min(1, tt / 2, (total - tt) / 1.5);
        buf[i] += amp * env * Math.sin(w * i + k);
      }
    }
  }
  // chanter: reedy pulse-like tone, graces steal time from the principal note
  const tone = (f, t0, dur, amp) => {
    const i0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
    for (let k = 1; k <= 14; k++) {
      const pa = amp * (k % 2 ? 1 : 0.55) / k * (k > 4 ? 1.4 : 1), w = 2 * Math.PI * f * k / SR;
      for (let j = 0; j < n && i0 + j < buf.length; j++) {
        const env = Math.min(1, j / (0.006 * SR), (n - j) / (0.012 * SR));
        buf[i0 + j] += pa * env * Math.sin(w * j);
      }
    }
  };
  let t = 0.6;
  for (let loop = 0; loop < LOOPS; loop++) {
    for (const nt of seq) {
      const dur = nt.ticks / PPQ * spb;
      if (nt.pitch == null) { t += dur; continue; }
      let g = t;
      for (const gp of nt.graces) { tone(freq(gp), g, GRACE_S, 0.05); g += GRACE_S; }
      tone(freq(nt.pitch), g, t + dur - g - 0.01, 0.07);
      t += dur;
    }
  }
  // normalise to -3 dBFS and write 16-bit WAV
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const g = 0.708 / (peak || 1), pcm = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * g)) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, g] of Object.entries(GROUNDS)) {
  const file = `${OUT}/ground-${name}${JUST ? '-just' : ''}.wav`;
  writeFileSync(file, render(name, g));
  console.log(file);
}
