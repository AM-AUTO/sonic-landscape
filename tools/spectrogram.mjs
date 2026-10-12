#!/usr/bin/env node
/**
 * Spectrogram sheets for the album renders, so the music can be *seen*.
 * Reads out/audio/<id>.wav (+ .json timeline) and writes out/audio/<id>-spectrum.png:
 *   top    — log-frequency spectrogram 40 Hz–16 kHz (mono sum), dB-mapped
 *   middle — RMS envelope (100 ms windows) with -10/-20/-30/-40 dBFS guides
 *   marks  — artefacts (magenta), partials (amber), section changes (blue), gate/complete (white)
 * Usage: node tools/spectrogram.mjs [id ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeWav } from './lib/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'out/audio');
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(dir).filter((f) => f.endsWith('.wav') && !f.includes('-')).map((f) => f.replace('.wav', ''));

// ---- png
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- fft (in place, radix 2)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// inferno-ish ramp
const RAMP = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
const ramp = (x) => { x = Math.max(0, Math.min(1, x)) * (RAMP.length - 1); const i = Math.floor(x), f = x - i, a = RAMP[i], b = RAMP[Math.min(RAMP.length - 1, i + 1)]; return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f)); };

for (const id of ids) {
  const wavPath = path.join(dir, id + '.wav');
  if (!fs.existsSync(wavPath)) continue;
  const { sampleRate: sr, channels } = decodeWav(fs.readFileSync(wavPath));
  const n = channels[0].length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = channels.reduce((s, c) => s + c[i], 0) / channels.length;
  const meta = fs.existsSync(path.join(dir, id + '.json')) ? JSON.parse(fs.readFileSync(path.join(dir, id + '.json'))) : {};
  const dur = n / sr;
  const W = Math.min(1600, Math.max(600, Math.round(dur * 8)));
  const SH = 260, RH = 90, MH = 14, H = SH + RH + MH;
  const img = Buffer.alloc(W * H * 3);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; };

  const N = 4096, win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const fLo = 40, fHi = 16000;
  for (let x = 0; x < W; x++) {
    const c = Math.floor((x + 0.5) / W * n);
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const j = c - N / 2 + i; re[i] = j >= 0 && j < n ? mono[j] * win[i] : 0; }
    fft(re, im);
    for (let y = 0; y < SH; y++) {
      const f0 = fLo * Math.pow(fHi / fLo, (SH - 1 - y) / SH), f1 = fLo * Math.pow(fHi / fLo, (SH - y) / SH);
      const b0 = Math.max(1, Math.floor(f0 / sr * N)), b1 = Math.max(b0, Math.ceil(f1 / sr * N));
      let m = 0;
      for (let b = b0; b <= b1 && b < N / 2; b++) m = Math.max(m, re[b] * re[b] + im[b] * im[b]);
      const db = 10 * Math.log10(m + 1e-12) - 20 * Math.log10(N / 4);
      put(x, y, ramp((db + 90) / 80));
    }
    // rms strip
    const a = Math.max(0, Math.floor(x / W * n)), bnd = Math.min(n, Math.floor((x + 1) / W * n));
    let s = 0; for (let i = a; i < bnd; i++) s += mono[i] * mono[i];
    const rmsDb = 10 * Math.log10(s / Math.max(1, bnd - a) + 1e-12);
    const hgt = Math.round(Math.max(0, Math.min(1, (rmsDb + 60) / 60)) * (RH - 4));
    for (let y = 0; y < RH; y++) put(x, SH + y, y >= RH - hgt ? [120, 200, 230] : [18, 22, 34]);
  }
  for (const g of [-10, -20, -30, -40]) { const y = SH + RH - Math.round((g + 60) / 60 * (RH - 4)); for (let x = 0; x < W; x += 3) put(x, y, [70, 80, 100]); }
  // octave guides at A notes
  for (let f = 55; f < fHi; f *= 2) { const y = Math.round(SH - 1 - Math.log(f / fLo) / Math.log(fHi / fLo) * SH); for (let x = 0; x < W; x += 6) put(x, y, [60, 60, 60]); }
  // timeline marks
  const COLORS = { artefact: [255, 60, 170], partial: [255, 176, 0], section: [80, 160, 255], 'gate-open': [255, 255, 255], complete: [255, 255, 255], cadence: [255, 255, 255] };
  for (const ev of meta.timeline || []) {
    const col = COLORS[ev.kind]; if (!col) continue;
    const x = Math.round(ev.t / dur * W);
    for (let y = SH + RH; y < H; y++) { put(x, y, col); put(x + 1, y, col); }
    if (ev.kind === 'artefact') for (let y = 0; y < SH; y += 4) put(x, y, col);
  }
  const out = path.join(dir, `${id}-spectrum.png`);
  fs.writeFileSync(out, png(W, H, img));
  console.log('wrote', path.relative(root, out), `${W}x${H}`, `${dur.toFixed(1)} s`);
}
