/**
 * Harmony helpers for the score layer. Pure functions (no Web Audio) — run in Node.
 *
 *   pickChord(vocab, gx, gy, seed)            seeded weighted choice from a chord vocabulary
 *   chordTones(root, mode, entry)             chord as ascending midis (unfolded)
 *   voiceChord(prev, tones, lo, hi, opts)     fold into a register, voice-led from prev, optional inversion
 *   rootTriad(root, mode)                     pitch classes of the tonic triad (root, 3rd, 5th of the mode)
 *   chordPcs, nearestTone, droneNotes, combinedSet, relativeMajorRoot
 *
 * A vocabulary entry: { d: scale degree of the chord root, steps: [scale-step offsets stacked on d], w: weight,
 * name, spread?: 0|1|2 }. steps [0,2,4] is a triad, [0,2,4,6] a seventh, [0,2,4,8] an add9, [0,1,4] sus2,
 * [0,3,4] sus4, [0,4,7] open fifths + octave.
 */
import { degreeToMidi, voiceLead } from './theory.js';
import { hash2f } from '../core/rng.js';

export const pc = (m) => ((Math.round(m) % 12) + 12) % 12;

/** Seeded weighted pick of a vocabulary index for a 1 km grid square. */
export function pickChordIndex(vocab, gx, gy, seed = 0) {
  let total = 0;
  for (const e of vocab) total += e.w ?? 1;
  let r = hash2f(gx, gy, seed) * total;
  for (let i = 0; i < vocab.length; i++) {
    r -= vocab[i].w ?? 1;
    if (r <= 0) return i;
  }
  return vocab.length - 1;
}

/** Chord tones for a vocabulary entry as ascending midis starting near `root`. */
export function chordTones(root, mode, entry) {
  const steps = entry.steps || [0, 2, 4];
  const out = steps.map((s) => degreeToMidi(root, mode, entry.d + s));
  out.sort((a, b) => a - b);
  // open voicing (spread): lift every second tone an octave
  if ((entry.spread || 0) >= 1) for (let i = 1; i < out.length; i += 2) out[i] += 12;
  return out.sort((a, b) => a - b);
}

/** Pitch classes (sorted, unique) of an entry. */
export function chordPcs(root, mode, entry) {
  return [...new Set(chordTones(root, mode, entry).map(pc))].sort((a, b) => a - b);
}

/** Root midi of the chord (unfolded, near `root`). */
export function chordRoot(root, mode, entry) {
  return degreeToMidi(root, mode, entry.d);
}

function fold(m, lo, hi) {
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

/**
 * Fold chord tones into [lo,hi], optionally voice-lead from `prev`, then apply an inversion
 * (inv > 0 lifts the lowest tone up an octave, inv < 0 drops the highest). Always returns >= 3 tones
 * when the source has >= 3 pitch classes, ascending, no duplicate pitches.
 */
export function voiceChord(prev, tones, lo, hi, { inversion = 0, maxTones = 6 } = {}) {
  let pcsIn = [...new Set(tones.map(pc))];
  if (pcsIn.length > maxTones) pcsIn = pcsIn.slice(0, maxTones);
  let out;
  if (prev && prev.length) {
    out = voiceLead(prev, pcsIn.map((p) => p + 60)).map((m) => fold(m, lo, hi));
  } else {
    // first chord: stack upward from lo
    out = pcsIn.map((p) => fold(p + 12 * Math.ceil((lo - p) / 12), lo, hi));
  }
  out = [...new Set(out)].sort((a, b) => a - b);
  let inv = Math.round(inversion);
  while (inv > 0 && out.length > 2) { out.push(out.shift() + 12); inv--; }
  while (inv < 0 && out.length > 2) { out.unshift(out.pop() - 12); inv++; }
  return out.map((m) => fold(m, lo - 7, hi + 7)).sort((a, b) => a - b);
}

/** Pitch classes of the tonic triad of a mode (degrees 0, 2, 4). */
export function rootTriad(root, mode) {
  return [0, 2, 4].map((d) => pc(degreeToMidi(root, mode, d)));
}

/** Nearest chord tone (any octave) to `midi` among pitch classes `pcs`. */
export function nearestTone(midi, pcs) {
  let best = midi, bd = 99;
  for (const p of pcs) {
    for (let o = -1; o <= 1; o++) {
      const c = p + 12 * (Math.floor(midi / 12) + o);
      const d = Math.abs(c - midi);
      if (d < bd) { bd = d; best = c; }
    }
  }
  return best;
}

/**
 * Drone pedal notes: the tonic stays; the chord's root and fifth are added a register apart, so the
 * foundation always carries the key while the harmony breathes above. Returns ascending midis.
 */
export function droneNotes(root, mode, entry, low = -24) {
  const tonic = root + low;
  const cr = degreeToMidi(root, mode, entry.d) + low;
  const cf = degreeToMidi(root, mode, entry.d + 4) + low;
  const set = new Map();
  const add = (m) => {
    while (m < tonic) m += 12;
    while (m > tonic + 14) m -= 12;
    set.set(pc(m), m);
  };
  add(tonic); add(tonic + 7); add(cr); add(cf);
  const arr = [...set.values()].sort((a, b) => a - b);
  return arr.length > 3 ? [arr[0], arr[Math.floor(arr.length / 2)], arr[arr.length - 1]] : arr;
}

/** Union of degree-derived pitch classes (for the concord pad and the granular scale). */
export function combinedSet(root, mode, degrees) {
  return [...new Set(degrees.map((d) => pc(degreeToMidi(root, mode, d))))].sort((a, b) => a - b);
}

/** Root of the relative major of a (minor-ish) mode, else a warm neighbour (the vi of a major mode). */
export function relativeMajorRoot(root, mode) {
  const third = mode[2] ?? 4;
  return third === 3 ? root + 3 : root + 9 - 12;
}

/** Major-scale-ish mode array used for the Hearth's relative-major pad. */
export const WARM_MODE = Object.freeze([0, 2, 4, 5, 7, 9, 11]);

export function semitoneSet(mode) { return mode.slice(); }
