#!/usr/bin/env node
/**
 * Swatch audition set: about 30 short, isolated sounds (8 s each), grouped by role, for the keep / maybe / kill page.
 * Sources are noise, sine and sub, clicks, resonance, granular and feedback only. The one string drone is labelled so it
 * can be killed. Built on the sketch DSP (tools/sketch-grounds.mjs). Writes out/swatches/<id>.wav, .mp3 (with ffmpeg)
 * and out/swatches/manifest.json.
 *
 *   node tools/swatches.mjs [--only id,id]
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as K from './sketch-grounds.mjs';

const { SR } = K;
const OUT = 'out/swatches';
const args = process.argv.slice(2);
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const SEC = 8;

// ---------------------------------------------------------------------------- small helpers
const N = (sec = SEC) => Math.ceil(sec * SR);
const st = (sec = SEC) => K.stereo(sec);
const fades = (s, fin = 0.3, fout = 0.6) => K.applyCurve(s, K.curve([[0, 0], [fin, 1], [SEC - fout, 1], [SEC, 0]]));
const at = (s, mono, t, gl = 0.5, gr = gl) => K.mixInto(s, mono, t, gl, gr);
const ping = (f, { g = 0.992, damp = 0.25, len = 1.6, level = 0.6 } = {}) => {   // a noise-excited comb ping: pitch without an instrument
  const n = Math.ceil(len * SR), x = new Float32Array(n), burst = Math.floor(0.006 * SR);
  for (let i = 0; i < burst; i++) x[i] = (K.rnd() * 2 - 1) * Math.sin(Math.PI * i / burst);
  const y = K.resonate(x, () => f, { g, damp });
  for (let i = 0; i < n; i++) y[i] *= level * Math.min(1, (n - i) / (0.3 * SR));
  return y;
};
const sineBlip = (f, len = 0.02, level = 0.5) => { const n = Math.floor(len * SR), y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = Math.sin(2 * Math.PI * f * i / SR) * Math.sin(Math.PI * i / n) ** 2 * level; return y; };
const GROUND = ['A3', 'C#4', 'E4', 'B3', 'D4'];   // the album cell (A C# E B D), low
const f = (n) => K.freq(n);

// ---------------------------------------------------------------------------- the swatches
const SW = [
  // drone
  { id: 'd1', role: 'Drone', name: 'Sub and beating drone', desc: 'Mono sub on A, detuned saws beating slowly, heavy tape saturation, moving low-pass.',
    make() { const { sub, beat } = K.subAndBeat(SEC, { sub: 0.5, beat: 0.6, fc: 1100 }); const s = K.mono2(sub, 0.6, 0.6); K.add(s, K.mono2(beat, 0.55, 0.5)); return s; } },
  { id: 'd2', role: 'Drone', name: 'Noise drone on A and E', desc: 'Pink noise through resonators tuned to A and E: a drone made only of noise.',
    make() { const nz = K.pinkish(N()), y = new Float32Array(N()); for (const [n, g] of [['A2', 0.6], ['E3', 0.4], ['A3', 0.25]]) { const r = K.resonate(nz, () => f(n), { g: 0.975, damp: 0.4 }); for (let i = 0; i < y.length; i++) y[i] += r[i] * g; } return K.mono2(K.shape(y, (v) => K.tape(v * 0.6, 2.2, 0.1)), 0.55, 0.5); } },
  { id: 'd3', role: 'Drone', name: 'Frozen noise wall', desc: 'A wall of moving noise granulated with long overlapping grains, frozen in place.',
    make() { const w = K.windNoise(SEC, { lo: 300, hi: 4000, rate: 0.05, depth: 0.5 }); const g = K.granulate(w, { density: 40, gmin: 0.3, gmax: 0.9, back: 2, cents: 15, oct: 0.1, rev: 0.4 }); return [K.lowpass(g[0], () => 3000), K.lowpass(g[1], () => 3000)]; } },
  { id: 'd4', role: 'Drone', name: 'Crackle feedback drone', desc: 'Crackle fed into long comb feedback on A and E: a drone that grows out of dust.',
    make() { const d = K.dust(SEC, 60, 0.5), y = new Float32Array(N()); for (const [n, g] of [['A1', 0.7], ['E2', 0.5], ['A2', 0.3]]) { const r = K.resonate(d, () => f(n), { g: 0.993, damp: 0.25 }); for (let i = 0; i < y.length; i++) y[i] += r[i] * g; } return K.mono2(K.shape(y, (v) => K.tape(v * 0.8, 3, 0.15)), 0.5, 0.55); } },
  { id: 'd5', role: 'Drone', name: 'String drone (labelled option)', desc: 'An e-bowed string drone (Karplus-Strong), saturated. Included so you can kill it if strings are wrong.',
    make() { return K.droneBed(SEC, { drive: 3, smear: 0.6, hiss: 0.02, sweep: 10, lo: 400, hi: 2000 }); } },

  // texture
  { id: 't1', role: 'Texture', name: 'Wind band', desc: 'Band-limited noise whose band and level breathe slowly.', make() { return K.mono2(K.windNoise(SEC, { lo: 400, hi: 5000, rate: 0.08, depth: 0.7 }), 0.5, 0.45); } },
  { id: 't2', role: 'Texture', name: 'Contact scrapes', desc: 'Noise scrapes with sharp, irregular spikes, like a contact mic dragged on stone.', make() { return K.mono2(K.scrape(SEC, { density: 2.5, fc: 2200, level: 0.7 }), 0.5, 0.55); } },
  { id: 't3', role: 'Texture', name: 'Dust and crackle', desc: 'Sparse clicks with tiny rings.', make() { return K.mono2(K.dust(SEC, 18, 0.6), 0.5, 0.5); } },
  { id: 't4', role: 'Texture', name: 'Noise bursts', desc: 'Short filtered noise grains scattered in time.', make() { return K.mono2(K.noiseBursts(SEC, { density: 7, fc: 3000, level: 0.6 }), 0.45, 0.55); } },
  { id: 't5', role: 'Texture', name: 'Eroding tape hiss', desc: 'One second of hiss looped and aged each pass: wow, flutter, dropouts, a closing filter.',
    make() { const h = K.lowpass(K.pinkish(Math.floor(SR)), () => 7000); const e = K.erodeLoop(h, 8, { maxWow: 0.02 }).out; return K.mono2(e, 0.5, 0.48); } },

  // grain and percussion
  { id: 'p1', role: 'Percussion', name: 'Grain clicks', desc: '3–12 ms saturated noise grains, uneven in level.', make() { const s = st(); for (let t = 0.2; t < SEC - 0.2; t += 0.25) at(s, K.grainClick(0.3 + K.rnd() * 0.5), t + K.jit(8), 0.5 + (K.rnd() - 0.5) * 0.4); return s; } },
  { id: 'p2', role: 'Percussion', name: 'Crushed kick', desc: 'A tight kick, bit-crushed and saturated.', make() { const s = st(); for (let t = 0.3; t < SEC - 0.5; t += 0.9) at(s, K.dirty(K.kickTight(1), 6, 3), t, 0.8); return s; } },
  { id: 'p3', role: 'Percussion', name: 'Crushed noise snare', desc: 'A noise snare, bit-crushed and saturated, short.', make() { const s = st(); for (let t = 0.75; t < SEC - 0.5; t += 0.9) at(s, K.dirty(K.snareNoise(0.9, 0.18), 5, 3), t, 0.55); return s; } },
  { id: 'p4', role: 'Percussion', name: 'Dirty metal', desc: 'Inharmonic metal hits, crushed, irregular.', make() { const s = st(); for (let t = 0.3; t < SEC - 1; t += 0.4 + K.rnd() * 0.9) at(s, K.dirty(K.metalHit(f('E4') * (K.rnd() < 0.3 ? 1.5 : 1), { level: 0.3, attack: 0.002, decay: 0.5, len: 0.9 }), 6, 2), t, 0.4 + K.rnd() * 0.3); return s; } },
  { id: 'p5', role: 'Percussion', name: 'Low thuds', desc: 'Low, muffled thuds: weight without a drum kit.', make() { const s = st(); for (let t = 0.3; t < SEC - 0.5; t += 1.2) at(s, K.dirty(K.thud(1), 7, 2.5), t, 0.6); return s; } },
  { id: 'p6', role: 'Percussion', name: 'Crushed hat roll', desc: 'Metallic hat rolls, crushed: the pipe birl as a rhythm.', make() { const s = st(); for (let t = 0.3; t < SEC - 0.6; t += 1.1) for (let k = 0; k < 4; k++) at(s, K.dirty(K.hatMetal(0.5, 0.02), 5, 2), t + k * 0.055, 0.45, 0.55); return s; } },

  // pulse and contra-rhythm (92 bpm sixteenths)
  { id: 'c1', role: 'Pulse', name: '3 against 4', desc: 'A grain pulse every 3 sixteenths against a crushed kick every 4.',
    make() { const s16 = 60 / 92 / 4, s = st(); for (let t = 0.2; t < SEC - 0.3; t += 3 * s16) at(s, K.grainClick(0.55), t, 0.7, 0.3); for (let t = 0.2; t < SEC - 0.3; t += 4 * s16) at(s, K.dirty(K.kickTight(0.8), 6, 3), t, 0.7); return s; } },
  { id: 'c2', role: 'Pulse', name: '5 against 4', desc: 'Dirty metal every 5 sixteenths against clicks every 4.',
    make() { const s16 = 60 / 92 / 4, s = st(); for (let t = 0.2; t < SEC - 0.5; t += 5 * s16) at(s, K.dirty(K.metalHit(f('E4'), { level: 0.25, attack: 0.002, decay: 0.35, len: 0.6 }), 6, 2), t, 0.3, 0.7); for (let t = 0.2; t < SEC - 0.3; t += 4 * s16) at(s, K.grainClick(0.4), t, 0.6, 0.4); return s; } },
  { id: 'c3', role: 'Pulse', name: 'Snap against even', desc: 'Short-then-long grain pairs (the Scotch snap ratio) against an even crushed shaker.',
    make() { const beat = 60 / 76, s = st(); for (let t = 0.2; t < SEC - 0.4; t += beat) { at(s, K.grainClick(0.55), t, 0.7, 0.3); at(s, K.grainClick(0.4), t + 0.25 * beat, 0.7, 0.3); } for (let t = 0.2; t < SEC - 0.3; t += beat / 2) at(s, K.dirty(K.hatMetal(0.3, 0.02), 6, 2), t, 0.35, 0.65); return s; } },
  { id: 'c4', role: 'Pulse', name: 'Phasing (Reich)', desc: 'Two identical 12-pulse noise-blip loops, one running 1.5% faster: they drift apart and back.',
    make() { const s = st(), pat = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0], step = 0.18; for (const [rate, gl, gr] of [[1, 0.8, 0.2], [1.015, 0.2, 0.8]]) { for (let k = 0, t = 0.2; t < SEC - 0.2; k++, t += step / rate) if (pat[k % 12]) at(s, K.grainClick(0.5, null), t, gl, gr); } return s; } },
  { id: 'c5', role: 'Pulse', name: 'Additive cell (Riley)', desc: 'The ground cell A C# E B D as resonated pings, growing a note at a time on an even pulse.',
    make() { const s = st(), step = 60 / 120 / 2; let t = 0.2; for (let len = 1; len <= 5 && t < SEC - 0.4; len++) for (let r = 0; r < 3 && t < SEC - 0.4; r++) for (let k = 0; k < len && t < SEC - 0.4; k++, t += step) at(s, ping(f(GROUND[k]) * 2, { g: 0.985, len: 0.5, level: 0.4 }), t, 0.5); return s; } },

  // pitch carriers: how the ground can surface
  { id: 'q1', role: 'Pitch', name: 'Resonance following the ground', desc: 'Pink noise through resonators that glide through the ground: the tune heard only inside noise.',
    make() { const nz = K.pinkish(N()), step = SEC / GROUND.length, fn = (t) => f(GROUND[Math.min(GROUND.length - 1, Math.floor(t / step))]); const y = K.resonate(nz, fn, { g: 0.975, damp: 0.4 }), y2 = K.resonate(nz, (t) => fn(t) * 1.5, { g: 0.96, damp: 0.45 }); const m = new Float32Array(y.length); for (let i = 0; i < m.length; i++) m[i] = K.tape((y[i] + y2[i] * 0.5) * 0.6, 2, 0.1); return K.mono2(m, 0.5, 0.52); } },
  { id: 'q2', role: 'Pitch', name: 'Eroding resonance loop', desc: 'A one-second fragment of ground resonance looped and worn down each pass. No guitar.',
    make() { const nz = K.pinkish(Math.floor(SR)), frag = K.resonate(nz, (t) => f(GROUND[Math.floor(t * 5) % 5]), { g: 0.98, damp: 0.35 }); return K.mono2(K.erodeLoop(frag, 8, { maxWow: 0.015 }).out, 0.5, 0.45); } },
  { id: 'q3', role: 'Pitch', name: 'Comb-ping glimpse', desc: 'Four ground notes as noise-excited comb pings, worn: a glimpse with no instrument behind it.',
    make() { const s = st(); GROUND.slice(0, 4).forEach((n, k) => at(s, ping(f(n) * 2, { g: 0.993, len: 2.2, level: 0.45 }), 0.4 + k * 0.9, 0.5)); const m = K.monoOf(s); return K.mono2(K.crush(K.lowpass(m, () => 3500), 9, 2), 0.5, 0.5); } },
  { id: 'q4', role: 'Pitch', name: 'Sine-blip ground', desc: 'The ground as 20 ms sine blips, scattered and repeated: cold, digital, exact.',
    make() { const s = st(); for (let t = 0.2, k = 0; t < SEC - 0.2; t += 0.12, k++) { if (K.rnd() < 0.75) at(s, sineBlip(f(GROUND[k % 5]) * (K.rnd() < 0.2 ? 4 : 2), 0.015 + K.rnd() * 0.02, 0.4), t + K.jit(3), K.rnd(), K.rnd()); } return s; } },
  { id: 'q5', role: 'Pitch', name: 'Ground phasing against itself', desc: 'The ground cell as pings in two loops, one slightly faster, so the cell interlocks with itself.',
    make() { const s = st(), step = 0.3; for (const [rate, gl, gr] of [[1, 0.8, 0.25], [1.02, 0.25, 0.8]]) for (let k = 0, t = 0.2; t < SEC - 0.5; k++, t += step / rate) at(s, ping(f(GROUND[k % 5]) * 2, { g: 0.985, len: 0.6, level: 0.35 }), t, gl, gr); return s; } },

  // process and transitions
  { id: 'x1', role: 'Process', name: 'Stutter edit', desc: 'A noise-and-sub bed with buffer-repeat stutters landing on bar ends.',
    make() { const { sub, beat } = K.subAndBeat(SEC, { sub: 0.4, beat: 0.5, fc: 1000 }); const s = K.mono2(beat, 0.5, 0.5); K.add(s, K.mono2(sub, 0.5, 0.5)); K.add(s, K.mono2(K.windNoise(SEC, { lo: 500, hi: 4000 }), 0.3, 0.3)); for (const t of [1.8, 3.8, 5.8]) K.stutter(s, t, 0.08, 4, 0.85); return s; } },
  { id: 'x2', role: 'Process', name: 'Noise reverse swell', desc: 'A reversed noise tail rising into a hit at 6 s.',
    make() { const s = st(), burst = K.noiseBursts(0.6, { density: 20, fc: 3000, level: 0.8 }); K.reverseSwell(s, burst, 6, 3, 0.8); at(s, K.dirty(K.kickTight(0.9), 6, 3), 6, 0.7); return s; } },
  { id: 'x3', role: 'Process', name: 'Bitcrush bloom', desc: 'A drone whose bit depth falls away and recovers, so grit blooms out of it.',
    make() { const { beat } = K.subAndBeat(SEC, { sub: 0, beat: 0.7, fc: 1500 }), y = new Float32Array(beat.length), bitsAt = K.curve([[0, 12], [3, 4], [5, 3], [8, 12]]); let h = 0; for (let i = 0; i < y.length; i++) { const q = 2 ** (bitsAt(i / SR) - 1), hold = Math.round(1 + (12 - bitsAt(i / SR)) / 2); if (i % hold === 0) h = Math.round(beat[i] * q) / q; y[i] = h; } return K.mono2(y, 0.55, 0.5); } },
  { id: 'x4', role: 'Process', name: 'Hard cut', desc: 'A full noise wall cut on a downbeat at 4.5 s to near-nothing: sub and a few clicks.',
    make() { const wall = (t) => (t < 4.5 ? 1 : 0); const s = K.droneWall(SEC, wall, { drive: 4, smear: 0.5, hiss: 0.03, sweep: 8, lo: 300, hi: 2500, noise: 0.45 }); K.applyCurve(s, (t) => (t < 4.5 ? 1 : 0.08)); const { sub } = K.subAndBeat(SEC, { sub: 0.4, beat: 0 }); K.add(s, K.mono2(sub, 0.5, 0.5)); for (let t = 4.6; t < SEC - 0.3; t += 0.45) at(s, K.grainClick(0.35), t, 0.6, 0.4); return s; } },
];

// ---------------------------------------------------------------------------- render
/** Every swatch at the same loudness (RMS -18 dBFS, soft-clipped peaks) so the audition compares sounds, not levels. */
function writeLevelled(mix, file, targetDb = -18) {
  for (const ch of mix) { let x1 = 0, y1 = 0; for (let i = 0; i < ch.length; i++) { const y = ch[i] - x1 + 0.9995 * y1; x1 = ch[i]; y1 = y; ch[i] = y; } }
  let ss = 0; const n = mix[0].length; for (let i = 0; i < n; i++) ss += (mix[0][i] ** 2 + mix[1][i] ** 2) / 2;
  const g = 10 ** (targetDb / 20) / (Math.sqrt(ss / n) || 1), k = Math.tanh(1.3), pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, Math.tanh(1.3 * mix[c][i] * g) / k)) * 32000), i * 4 + c * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([h, pcm]));
}
mkdirSync(OUT, { recursive: true });
const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const manifest = [];
for (const s of SW) {
  if (ONLY && !ONLY.includes(s.id)) continue;
  K.reseed(1000 + manifest.length * 7);
  const mix = fades(s.make());
  const wav = `${OUT}/${s.id}.wav`;
  writeLevelled(mix, wav);
  if (ffmpeg) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', `${OUT}/${s.id}.mp3`]);
  manifest.push({ id: s.id, role: s.role, name: s.name, desc: s.desc, file: `${s.id}.mp3` });
  console.log(`${s.id.padEnd(3)} ${s.role.padEnd(10)} ${s.name}`);
}
if (!ONLY) writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} swatches → ${OUT}${ffmpeg ? ' (mp3 written)' : ' (no ffmpeg: wav only)'}${existsSync(OUT) ? '' : ''}`);
