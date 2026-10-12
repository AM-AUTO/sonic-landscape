/**
 * Music theory helpers. Pure functions, no Web Audio — runs in Node.
 * Modes are semitone arrays from the root, ascending within one octave.
 */

export const MODES = Object.freeze({
  ionian:      [0, 2, 4, 5, 7, 9, 11],
  dorian:      [0, 2, 3, 5, 7, 9, 10],
  phrygian:    [0, 1, 3, 5, 7, 8, 10],
  lydian:      [0, 2, 4, 6, 7, 9, 11],
  mixolydian:  [0, 2, 4, 5, 7, 9, 10],
  aeolian:     [0, 2, 3, 5, 7, 8, 10],
  locrian:     [0, 1, 3, 5, 6, 8, 10],
  lydianDom:   [0, 2, 4, 6, 7, 9, 10],
  octatonic:   [0, 1, 3, 4, 6, 7, 9, 10],   // half-whole
  octatonicWH: [0, 2, 3, 5, 6, 8, 9, 11],   // whole-half
  pentMajor:   [0, 2, 4, 7, 9],
  pentMinor:   [0, 3, 5, 7, 10],
  pentSus:     [0, 2, 5, 7, 10],             // suspended pentatonic (cairngorm "aeolian sus")
  wholeTone:   [0, 2, 4, 6, 8, 10],
  hirajoshi:   [0, 2, 3, 7, 8],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor:  [0, 2, 3, 5, 7, 9, 11],
});

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number → scientific pitch name (60 → "C4"). */
export function noteName(midi) {
  const m = Math.round(midi);
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

/** MIDI number (may be fractional) → Hz, A4 = 440. */
export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Hz → fractional MIDI. */
export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

function resolveMode(mode) {
  if (Array.isArray(mode)) return mode;
  const m = MODES[mode];
  if (!m) throw new Error('unknown mode: ' + mode);
  return m;
}

/**
 * Scale degree → MIDI note. degree 0 is the root; degrees may be negative or beyond the
 * mode length (they wrap into other octaves). `octave` adds whole octaves.
 */
export function degreeToMidi(rootMidi, mode, degree, octave = 0) {
  const sc = resolveMode(mode);
  const n = sc.length;
  const d = Math.round(degree);
  const oct = Math.floor(d / n);
  const idx = ((d % n) + n) % n;
  return rootMidi + sc[idx] + 12 * (oct + octave);
}

/**
 * Chord built by stacking scale steps (every other scale step = thirds in a 7-note mode;
 * the same rule gives sensible stacks for pentatonic, octatonic and whole-tone scales).
 * opts: size 1..7 (default 3), inversion (n >0 moves the lowest note up an octave n times,
 * n <0 moves the highest down), spread (0 closed; >=1 open voicing: odd-index tones up an
 * octave; >=2 additionally drops the lowest note an octave). Returned ascending.
 */
export function chordFromDegree(rootMidi, mode, degree, { size = 3, spread = 0, inversion = 0 } = {}) {
  const sz = Math.max(1, Math.min(7, Math.round(size)));
  let notes = [];
  for (let i = 0; i < sz; i++) notes.push(degreeToMidi(rootMidi, mode, degree + 2 * i));
  notes.sort((a, b) => a - b);
  let inv = Math.round(inversion);
  while (inv > 0) { notes.push(notes.shift() + 12); inv--; }
  while (inv < 0) { notes.unshift(notes.pop() - 12); inv++; }
  if (spread >= 1) notes = notes.map((n, i) => (i % 2 === 1 ? n + 12 : n));
  notes.sort((a, b) => a - b);
  if (spread >= 2) notes[0] -= 12;
  notes.sort((a, b) => a - b);
  return notes;
}

/** Closest placement of pitch class `pc` (any integer) to `target` midi. */
function nearestOctave(pc, target) {
  const base = ((pc % 12) + 12) % 12;
  let k = Math.round((target - base) / 12);
  return base + 12 * k;
}

/**
 * Re-voice `nextMidis` (keeping its pitch classes) so total movement from `prevMidis` is
 * minimal. Returns an ascending array with the same length as nextMidis.
 */
export function voiceLead(prevMidis, nextMidis) {
  const next = nextMidis.slice();
  if (!prevMidis || prevMidis.length === 0 || next.length === 0) return next.sort((a, b) => a - b);
  const prev = prevMidis.slice().sort((a, b) => a - b);
  const p = prev.length, q = next.length;
  let best = null, bestCost = Infinity;
  const pick = new Array(q);
  const used = new Array(p).fill(false);
  function rec(j, cost, usedCount) {
    if (cost >= bestCost) return;
    if (j === q) { bestCost = cost; best = pick.slice(); return; }
    for (let i = 0; i < p; i++) {
      if (used[i] && usedCount < p) continue;
      const m = nearestOctave(next[j], prev[i]);
      const c = Math.abs(m - prev[i]);
      const wasUsed = used[i];
      used[i] = true;
      pick[j] = m;
      rec(j + 1, cost + c, wasUsed ? usedCount : usedCount + 1);
      used[i] = wasUsed;
    }
  }
  rec(0, 0, 0);
  return best.sort((a, b) => a - b);
}

/** Snap a (possibly fractional) midi note to the nearest tone of rootMidi+mode. Ties go down. */
export function quantize(midi, rootMidi, mode) {
  const sc = resolveMode(mode);
  const rel = midi - rootMidi;
  const oct = Math.floor(rel / 12);
  let best = null, bestD = Infinity;
  for (let o = oct - 1; o <= oct + 1; o++) {
    for (const s of sc) {
      const cand = rootMidi + s + 12 * o;
      const d = Math.abs(cand - midi);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) < 1e-9 && cand < best)) { bestD = d; best = cand; }
    }
  }
  return best;
}

/** The five-note contour cell, as scale degrees. */
export const CONTOUR_MOTIF = Object.freeze([0, 2, 4, 1, 3]);

function normMotif(m) {
  if (Array.isArray(m)) return { degrees: m.slice(), durations: m.map(() => 1) };
  const degrees = (m.degrees || []).slice();
  const durations = (m.durations && m.durations.length === degrees.length) ? m.durations.slice() : degrees.map(() => 1);
  return { degrees, durations };
}

/**
 * Transform a motif (array of degrees, or {degrees,durations}). Ops:
 * 'invert' (mirror about the first note), 'retro', 'augment' (x2 durations), 'diminish' (x0.5),
 * 'rotate:n' (cyclic shift left by n), 'transpose:n' (add n degrees). Several ops can be chained
 * with '+', e.g. 'invert+retro', or passed as an array. Returns {degrees, durations}.
 */
export function transformMotif(motif, op) {
  let m = normMotif(motif);
  const ops = Array.isArray(op) ? op : String(op || '').split('+').filter(Boolean);
  for (const raw of ops) {
    const [name, arg] = raw.trim().split(':');
    const n = arg === undefined ? 0 : parseFloat(arg);
    const len = m.degrees.length;
    switch (name) {
      case 'invert': {
        const d0 = m.degrees[0] ?? 0;
        m = { degrees: m.degrees.map((d) => 2 * d0 - d), durations: m.durations };
        break;
      }
      case 'retro':
        m = { degrees: m.degrees.slice().reverse(), durations: m.durations.slice().reverse() };
        break;
      case 'augment':
        m = { degrees: m.degrees, durations: m.durations.map((d) => d * 2) };
        break;
      case 'diminish':
        m = { degrees: m.degrees, durations: m.durations.map((d) => d * 0.5) };
        break;
      case 'rotate': {
        if (!len) break;
        const k = ((Math.round(n) % len) + len) % len;
        m = { degrees: m.degrees.slice(k).concat(m.degrees.slice(0, k)), durations: m.durations.slice(k).concat(m.durations.slice(0, k)) };
        break;
      }
      case 'transpose':
        m = { degrees: m.degrees.map((d) => d + Math.round(n)), durations: m.durations };
        break;
      case 'identity':
      case '':
        break;
      default:
        throw new Error('unknown motif op: ' + raw);
    }
  }
  return m;
}
