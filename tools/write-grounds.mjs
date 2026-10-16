#!/usr/bin/env node
/**
 * Writes the album ground and the eight track grounds (docs/SONIC.md, the "Sonic Palette" doc) as
 * Standard MIDI files: track 1 = the chanter line with its grace notes, track 2 = the A2 + E3 drone.
 * No dependencies. Equal temperament (MIDI has no tuning table); the just-intonation question is open.
 *
 *   node tools/write-grounds.mjs [--out out/midi] [--loops 2]
 *
 * Note syntax: 'A4 2' = A4 for 2 beats. Marks after the length:
 *   g  = G grace (high G) before the note      '  = cut (grace a scale step above)
 *   D  = doubling (high G grace, note, step-above grace)   c = E-cadence (E grace before the note)
 *   'r 2' = a rest of 2 beats.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'out/midi');
const LOOPS = Math.max(1, Number(opt('loops', 2)) | 0);

const PPQ = 480;
const GRACE = 40;                       // ticks: ~30 ms at 64 bpm, a pipe-quick grace
const SCALE = ['G', 'A', 'B', 'C#', 'D', 'E', 'F#'];   // chanter collection, for "a step above"
const PC = { C: 0, 'C#': 1, D: 2, E: 4, F: 5, 'F#': 6, G: 7, A: 9, B: 11 };
const midiOf = (name) => { const m = /^([A-G]#?)(\d)$/.exec(name); if (!m) throw new Error('bad note ' + name); return 12 * (Number(m[2]) + 1) + PC[m[1]]; };
const stepAbove = (name) => {
  const m = /^([A-G]#?)(\d)$/.exec(name); const i = SCALE.indexOf(m[1]);
  const nx = SCALE.at((i + 1) % SCALE.length); const oct = Number(m[2]) + (m[1] === 'B' ? 1 : 0);
  return nx + oct;
};

/** The grounds, as written in the doc. */
const GROUNDS = {
  album: { bpm: 64, notes: 'A4 2 g, A4 1 D, C#5 1, E5 3, B4 1 \', D5 2, C#5 1, B4 1, A4 4, E5 1, E5 1 \', F#5 1, E5 1, G5 2, E5 1, D5 1, B4 1.5, C#5 0.5, A4 2 c, A4 4' },
  '1-corryvreckan': { bpm: 64, notes: 'A4 2 g, A4 1 D, C#5 1, E5 3, B4 1 \', D5 2, C#5 1, B4 1, A4 4' },
  '2-cruachan': { bpm: 76, notes: 'E5 0.25, B4 0.75, D5 0.25, B4 0.75, E5 2, E5 1 \', D5 0.75, B4 0.25, A4 2, B4 0.25, D5 0.75, E5 1, C#5 1 \', B4 1, E5 4' },
  '3-lyon': { bpm: 52, notes: 'D5 4, E5 2, A4 2 g, B4 3, C#5 1 \', D5 4, D5 8 D' },
  '4-rannoch': { bpm: 58, notes: 'E5 2, D5 1, B4 1, A4 2 \', D5 2, B4 6, r 2' },
  '5-cairngorm': { bpm: 60, notes: 'B4 3, D5 1, G4 4, r 2, D5 2, B4 2, r 2, G5 8' },
  '6-coe': { bpm: 92, notes: 'E5 0.5, B4 0.5, D5 0.5, B4 0.5, E5 0.5, B4 0.5, G5 0.5, E5 0.5, D5 0.5, B4 0.5, A4 0.5, B4 0.5, D5 0.5, E5 0.5, E5 0.5 \', E5 0.5' },
  '7-cuillin': { bpm: 80, notes: 'A4 0.25, C#5 0.75, E5 0.25, D5 0.75, B4 1 \', C#5 1, A4 0.25, E5 0.75, D5 1, B4 1, A4 1 c, E5 1, D5 1, C#5 6' },
  '8-nevis': { bpm: 70, notes: 'A4 2 g, A4 1 D, C#5 1, E5 3, B4 1 \', D5 2, C#5 1, B4 1, A4 4, E5 1, E5 1 \', F#5 1, E5 1, G5 2, E5 1, D5 1, B4 1.5, C#5 0.5, A4 2 c, A4 4' },
};

/** Parse a ground into [{pitch|null, ticks, graces:[pitch…]}]. */
export function parseGround(text) {
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((tok) => {
    const [name, len, mark] = tok.split(/\s+/);
    const ticks = Math.round(Number(len) * PPQ);
    if (name === 'r') return { pitch: null, ticks, graces: [] };
    const graces = mark === 'g' ? ['G5'] : mark === "'" ? [stepAbove(name)] : mark === 'D' ? ['G5', name, stepAbove(name)] : mark === 'c' ? ['E5'] : [];
    return { pitch: name, ticks, graces };
  });
}

// ---- tiny SMF writer -------------------------------------------------------------------------
const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
const str = (s) => [...Buffer.from(s, 'latin1')];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function chunk(id, bytes) { return [...str(id), ...u32(bytes.length), ...bytes]; }
function trackBytes(events) {   // events: [{t, bytes}] absolute ticks
  events.sort((a, b) => a.t - b.t || a.order - b.order);
  const out = []; let last = 0;
  for (const e of events) { out.push(...vlq(e.t - last), ...e.bytes); last = e.t; }
  out.push(0, 0xff, 0x2f, 0x00);
  return out;
}
const on = (t, ch, n, v, order = 1) => ({ t, order, bytes: [0x90 | ch, n, v] });
const off = (t, ch, n, order = 0) => ({ t, order, bytes: [0x80 | ch, n, 0] });

function buildMidi(name, { bpm, notes }) {
  const seq = parseGround(notes);
  const mel = [{ t: 0, order: -1, bytes: [0xff, 0x03, ...vlq(name.length), ...str(name)] },
    { t: 0, order: -1, bytes: [0xff, 0x51, 0x03, ...u32(Math.round(60e6 / bpm)).slice(1)] },
    { t: 0, order: -1, bytes: [0xc0, 68] }];          // GM oboe: a reedy stand-in for the chanter
  let t = 0;
  for (let loop = 0; loop < LOOPS; loop++) {
    for (const n of seq) {
      if (n.pitch == null) { t += n.ticks; continue; }
      // graces steal their time from the principal note, as on the pipes
      let g = t;
      for (const gp of n.graces) { mel.push(on(g, 0, midiOf(gp), 70), off(g + GRACE - 4, 0, midiOf(gp))); g += GRACE; }
      const p = midiOf(n.pitch);
      mel.push(on(g, 0, p, 96), off(t + n.ticks - 2, 0, p));
      t += n.ticks;
    }
  }
  const end = t;
  const dr = [{ t: 0, order: -1, bytes: [0xff, 0x03, 5, ...str('drone')] }, { t: 0, order: -1, bytes: [0xc1, 89] }];   // GM warm pad: not a bagpipe, per the brief; swap freely
  for (const n of ['A2', 'E3']) dr.push(on(0, 1, midiOf(n), 64), off(end, 1, midiOf(n)));
  const header = chunk('MThd', [0, 1, 0, 2, (PPQ >> 8) & 255, PPQ & 255]);
  return Buffer.from([...header, ...chunk('MTrk', trackBytes(mel)), ...chunk('MTrk', trackBytes(dr))]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, g] of Object.entries(GROUNDS)) {
    const file = `${OUT}/ground-${name}.mid`;
    writeFileSync(file, buildMidi(name, g));
    const beats = parseGround(g.notes).reduce((s, n) => s + n.ticks, 0) / PPQ;
    console.log(`${file}  ${g.bpm} bpm  ${beats} beats × ${LOOPS}`);
  }
}
export { GROUNDS, buildMidi };
