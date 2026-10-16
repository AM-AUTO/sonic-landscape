/**
 * The grit palette (docs/SONIC.md, docs/AUDIO-STAGE.md phase 2): the per-track fields the new voices and the arrangement
 * read, with defaults, and the pure arrangement planner for the palette layers. No Web Audio here.
 *
 * Profile fields (all optional; levelmusic.js profiles do not set them yet — the profile rewrite is a later step):
 *   palette      'grit' (default) | 'legacy' (the old pretty palette: supersaw pads, glass bells, kalimba, add9, clean lead)
 *   time         'pibroch' | 'reel' | 'strathspey'      (default per track, from the grounds' rhythm)
 *   axis         0 (Fennesz) … 10 (Floating Points)      more wall and erosion at 0, more groove at 10
 *   ground       the track's ground (ùrlar) in the doc's note syntax ('A4 2 g, …'); default GROUND_NOTES[id]
 *   contra       { A: {period, offsets}, B: {period, offsets} } in 16ths (default by time: 3 & 5 against 4, or the snap)
 *   surge        { every, phase, factor }                contra surges: which swell stanzas, how hard
 *   glimpse      { every, notes, spread }                ground glimpses on stanza downbeats (spread in beats)
 *   arp          boolean                                 the gliding arp lead (reel / strathspey) — pibroch tracks have no lead
 *   arpPlay      [p per stanza (mod length)]             the chance an arp eighth plays (the cell is implied, not spelled out)
 *   erode        { source: 'pluck'|'tine', voicing: [semitones from the drone root], ageStanzas }
 *   wallBase     0..1 multiplier on the wall layer       scrapeBase likewise
 */

export const PALETTES = ['grit', 'legacy'];

/** the grounds (copied from tools/write-grounds.mjs GROUNDS; tests/audio-palette.test.js keeps them equal) */
export const GROUND_NOTES = {
  album: 'A4 2 g, A4 1 D, C#5 1, E5 3, B4 1 \', D5 2, C#5 1, B4 1, A4 4, E5 1, E5 1 \', F#5 1, E5 1, G5 2, E5 1, D5 1, B4 1.5, C#5 0.5, A4 2 c, A4 4',
  corryvreckan: 'A4 2 g, A4 1 D, C#5 1, E5 3, B4 1 \', D5 2, C#5 1, B4 1, A4 4',
  cruachan: 'E5 0.25, B4 0.75, D5 0.25, B4 0.75, E5 2, E5 1 \', D5 0.75, B4 0.25, A4 2, B4 0.25, D5 0.75, E5 1, C#5 1 \', B4 1, E5 4',
  lyon: 'D5 4, E5 2, A4 2 g, B4 3, C#5 1 \', D5 4, D5 8 D',
  rannoch: 'E5 2, D5 1, B4 1, A4 2 \', D5 2, B4 6, r 2',
  cairngorm: 'B4 3, D5 1, G4 4, r 2, D5 2, B4 2, r 2, G5 8',
  coe: 'E5 0.5, B4 0.5, D5 0.5, B4 0.5, E5 0.5, B4 0.5, G5 0.5, E5 0.5, D5 0.5, B4 0.5, A4 0.5, B4 0.5, D5 0.5, E5 0.5, E5 0.5 \', E5 0.5',
  cuillin: 'A4 0.25, C#5 0.75, E5 0.25, D5 0.75, B4 1 \', C#5 1, A4 0.25, E5 0.75, D5 1, B4 1, A4 1 c, E5 1, D5 1, C#5 6',
  nevis: 'A4 2 g, A4 1 D, C#5 1, E5 3, B4 1 \', D5 2, C#5 1, B4 1, A4 4, E5 1, E5 1 \', F#5 1, E5 1, G5 2, E5 1, D5 1, B4 1.5, C#5 0.5, A4 2 c, A4 4',
};

/** each track's time (strathspey: the snap 0.25 / 0.75 in its ground; reel: even eighths; the rest pibroch) */
export const TRACK_TIME = { corryvreckan: 'pibroch', cruachan: 'strathspey', lyon: 'pibroch', rannoch: 'pibroch', cairngorm: 'pibroch', coe: 'reel', cuillin: 'strathspey', nevis: 'pibroch' };
/** each track's place on the Fennesz (0) – Floating Points (10) axis (until the profiles carry their own) */
export const TRACK_AXIS = { corryvreckan: 1, cruachan: 6, lyon: 1, rannoch: 3, cairngorm: 2, coe: 9, cuillin: 7, nevis: 5 };

const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const SCALE = ['G', 'A', 'B', 'C#', 'D', 'E', 'F#'];
const midiOfName = (name) => { const m = /^([A-G]#?)(\d)$/.exec(name); return m ? 12 * (Number(m[2]) + 1) + PC[m[1]] : null; };
const stepAbove = (name) => {
  const m = /^([A-G]#?)(\d)$/.exec(name); const i = SCALE.indexOf(m[1]);
  return SCALE[(i + 1) % SCALE.length] + (Number(m[2]) + (m[1] === 'B' ? 1 : 0));
};

/**
 * Parse a ground into [{iv, beats, grace}] — iv: semitones from A4 (null for a rest), grace: the last grace's semitones
 * from A4 (the ornament as attack articulation) or null.
 */
export function parseGround(text) {
  return String(text || '').split(',').map((s) => s.trim()).filter(Boolean).map((tok) => {
    const [name, len, mark] = tok.split(/\s+/);
    const beats = Number(len) || 1;
    if (name === 'r') return { iv: null, beats, grace: null };
    const m = midiOfName(name);
    if (m === null) return { iv: null, beats, grace: null };
    const graces = mark === 'g' ? ['G5'] : mark === "'" ? [stepAbove(name)] : mark === 'D' ? ['G5', name, stepAbove(name)] : mark === 'c' ? ['E5'] : [];
    const g = graces.length ? midiOfName(graces[graces.length - 1]) : null;
    return { iv: m - 69, beats, grace: g === null ? null : g - 69 };
  });
}

const CONTRA_BY_TIME = {
  // 16ths. A: grain clicks; B: dirty metal. reel: 3 and 5 sixteenths against the 4 of the beat (the coe sketch)
  reel: { A: { period: 3, offsets: [0] }, B: { period: 5, offsets: [0] } },
  // strathspey: the snap (short-long, 0.25 / 0.75) against an even pulse of 5 sixteenths (the album sketch)
  strathspey: { A: { period: 4, offsets: [0, 1] }, B: { period: 5, offsets: [0] } },
  // pibroch: slow — three beats against four, and five (the lyon sketch)
  pibroch: { A: { period: 12, offsets: [0] }, B: { period: 20, offsets: [0] } },
};
const COLD = [0, 7, 14, 17, 19, 24];            // A2 E3 B3 D4 E4 A4 from the drone root (the sketches' cold voicing)

/** the palette settings of a profile: its own fields where present, defaults otherwise. `override` forces the palette. */
export function paletteFor(profile, override = null) {
  const p = profile || {};
  const id = p.id || 'nevis';
  const palette = PALETTES.includes(override) ? override : PALETTES.includes(p.palette) ? p.palette : 'grit';
  const time = ['pibroch', 'reel', 'strathspey'].includes(p.time) ? p.time : (TRACK_TIME[id] || 'pibroch');
  const axis = Number.isFinite(p.axis) ? Math.max(0, Math.min(10, p.axis)) : (TRACK_AXIS[id] ?? 5);
  const groundText = p.ground || GROUND_NOTES[id] || GROUND_NOTES.album;
  const cell = parseGround(groundText);
  const contra = {
    A: { ...CONTRA_BY_TIME[time].A, ...((p.contra && p.contra.A) || {}) },
    B: { ...CONTRA_BY_TIME[time].B, ...((p.contra && p.contra.B) || {}) },
  };
  for (const k of ['A', 'B']) {
    contra[k].period = Math.max(1, Math.round(contra[k].period));
    contra[k].offsets = (contra[k].offsets || [0]).map((o) => ((Math.round(o) % contra[k].period) + contra[k].period) % contra[k].period);
  }
  const arp = typeof p.arp === 'boolean' ? p.arp : time !== 'pibroch';
  const root = Number.isFinite(p.root) ? p.root : 57;
  return {
    palette, grit: palette === 'grit', time, axis, arp,
    root,
    /** the drone's tonic: the track root folded to A2..G#3 (sub at root−24 / −12, beat on root−12, fifth−12, root) */
    droneRoot: 45 + ((((root - 45) % 12) + 12) % 12),
    /** the ground as level midis (A4 → the level's root an octave up) */
    ground: cell.filter((n) => n.iv !== null).map((n) => ({ midi: root + 12 + n.iv, beats: n.beats, grace: n.grace === null ? null : root + 12 + n.grace })),
    groundRaw: cell,
    contra,
    surge: { every: 3, phase: 0, factor: 1.8, ...(p.surge || {}) },
    glimpse: { every: time === 'pibroch' ? 2 : 3, notes: time === 'pibroch' ? 3 : 4, spread: time === 'pibroch' ? 2 : 1, ...(p.glimpse || {}) },
    arpPlay: Array.isArray(p.arpPlay) && p.arpPlay.length ? p.arpPlay : [0.55, 0.8, 0.85, 0.5, 0.75],
    erode: { source: axis >= 4 && time === 'pibroch' ? 'tine' : 'pluck', voicing: COLD, ageStanzas: 2, ...(p.erode || {}) },
    wallBase: Number.isFinite(p.wallBase) ? p.wallBase : 1.15 - 0.03 * axis,
    scrapeBase: Number.isFinite(p.scrapeBase) ? p.scrapeBase : 1,
    grooveBase: 0.7 + 0.05 * axis,
  };
}

/** the palette layers (in addition to Phase 1's drone pad bass lead bell pluck texture kit ghost) */
export const GRIT_LAYERS = ['sub', 'wall', 'res', 'erode', 'grain', 'contraA', 'contraB', 'arp', 'glimpse', 'scrape'];

/** by section: the layer levels before axis / energy / night / form adjustments */
const BASE = {
  ebb: { sub: 1, wall: 0.25, res: 1, erode: 0.55, grain: 0, contraA: 0, contraB: 0, arp: 0, scrape: 0.3 },
  flow: { sub: 0.9, wall: 0.5, res: 0.85, erode: 0.7, grain: 1, contraA: 0.75, contraB: 0, arp: 1, scrape: 0.5 },
  swell: { sub: 0.85, wall: 1, res: 0.8, erode: 0.6, grain: 1, contraA: 1, contraB: 0.85, arp: 1, scrape: 0.8 },
};

/** pibroch form step: 0 ground, 1–3 variations, 4 transformation (gate open), 5 return (walking out) */
export function formStepOf(state, maxResonating = 0) {
  if (!state) return 0;
  if (state.levelComplete) return 5;
  if (state.gateOpen) return 4;
  const cp = state.chainProgress;
  if (!Array.isArray(cp) || !cp.length) return null;
  return Math.max(0, Math.min(3, Math.ceil((maxResonating / cp.length) * 3 - 1e-9))) || 0;
}

const r3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;

/**
 * Plan the palette part of a stanza's arrangement.
 *   ctx: {pal, section, kitSection, drift, energy, kit, night, formStep, stanza, prev (the arrangement before), swellRun
 *         (how many stanzas the swell has lasted, 0 on its first)}
 * Returns {layers: {sub … scrape, and the retired Phase 1 layers}, flags: {contraSurge, glimpse, cut, dark, erodeCapture}}.
 */
export function planGrit(ctx) {
  const { pal, section, kitSection, drift = 0, energy = 0.3, kit = 1, night = false, formStep = 0, stanza = 0, prev = null, swellRun = 0 } = ctx;
  const L = {};
  if (drift >= 0.5) {
    // drift: a hard drop to the sub, the resonators and the eroding loop
    Object.assign(L, { sub: 1, wall: 0, res: 1, erode: 0.8, grain: 0, contraA: 0, contraB: 0, arp: 0, scrape: 0 });
  } else {
    Object.assign(L, BASE[section] || BASE.ebb);
    if (section === 'ebb' && kitSection !== 'ebb' && kit > 0.3) { L.grain = 0.7; L.contraA = 0.5; }      // the pulse wakes with momentum
    const e = Math.max(0, Math.min(1, energy));
    L.wall *= pal.wallBase * (0.8 + 0.4 * e);
    L.erode *= Math.max(0.6, 1.1 - 0.03 * pal.axis);
    for (const k of ['grain', 'contraA', 'contraB']) L[k] *= pal.grooveBase;
    L.scrape *= pal.scrapeBase;
    if (formStep === 4) { L.wall = Math.max(L.wall, 0.85); L.contraB = Math.max(L.contraB, 0.6); L.contraA = Math.max(L.contraA, 0.6); }
    if (formStep === 5) { L.wall *= 0.5; L.contraB = 0; }
    if (!pal.arp) L.arp = 0;
    if (kit < 0.3) { L.grain = Math.min(L.grain, 0.3); L.contraA = 0; L.contraB = 0; }
  }
  if (night) { L.wall *= 0.75; L.scrape *= 0.6; }
  // ground glimpses on chosen stanza downbeats: a form step, every `every` stanzas, every stanza of the return; never in drift
  const formMoved = !!prev && prev.formStep !== undefined && prev.formStep !== formStep;
  const every = Math.max(1, pal.glimpse.every | 0);
  const glimpse = drift < 0.5 && (formMoved || formStep === 5 || ((stanza % every) + every) % every === 1);
  L.glimpse = glimpse ? (night ? 0.8 : 1) : 0;
  // contra surges: the first swell stanza, then every `surge.every`, and the transformation
  const S = pal.surge;
  const contraSurge = drift < 0.5 && (L.contraA > 0.05 || L.contraB > 0.05) && ((section === 'swell' && (swellRun === 0 || (swellRun % Math.max(1, S.every)) === (S.phase % Math.max(1, S.every)))) || (formStep === 4 && formMoved));
  // hard cut: drift arriving, or the swell falling straight back to ebb
  const cut = !!prev && ((drift >= 0.5 && !(prev.drift >= 0.5)) || (prev.section === 'swell' && section === 'ebb'));
  // the eroding loop re-captures on the form steps (and takes its first capture on the first stanza it plays)
  const stale = !!prev && Number.isFinite(prev.capturedStanza) && stanza - prev.capturedStanza >= 2 * Math.max(1, pal.erode.ageStanzas);
  const erodeCapture = L.erode > 0.05 && (formMoved || !prev || !prev.captured || stale);
  for (const k of Object.keys(L)) L[k] = r3(L[k]);
  // the retired pretty layers: no pads, bells, kalimba plucks or clean lead in the grit palette
  Object.assign(L, { pad: 0, bell: 0, pluck: 0, lead: 0 });
  return { layers: L, flags: { contraSurge, glimpse, cut, dark: night ? 1 : 0, erodeCapture } };
}

/** the dirty kit: the profile's kit patch made crushed, saturated and short (multipliers, so each level keeps its own) */
export function dirtyKitPatch(kp) {
  const m = (k, f, lo, hi) => (Number.isFinite(kp[k]) ? Math.max(lo, Math.min(hi, kp[k] * f)) : undefined);
  const o = {
    kickDecay: m('kickDecay', 0.45, 0.12, 0.5), kickClick: m('kickClick', 1.6, 0.2, 0.9), kickSweep: m('kickSweep', 1.15, 1, 6),
    snareNoise: m('snareNoise', 1.7, 0.6, 2), snareDecay: m('snareDecay', 0.65, 0.07, 0.3),
    hatDecay: m('hatDecay', 0.35, 0.008, 0.05), hatOpenDecay: m('hatOpenDecay', 0.35, 0.06, 0.25),
    crashDecay: m('crashDecay', 0.35, 0.8, 3), rideDecay: m('rideDecay', 0.35, 0.4, 1.5), tomDecay: m('tomDecay', 0.5, 0.1, 0.4),
    gongDecay: m('gongDecay', 0.5, 2, 7), timpDecay: m('timpDecay', 0.5, 0.6, 3), hatBright: m('hatBright', 0.8, 0.4, 1.2),
    level: m('level', 1.3, 0.5, 1.6),                     // shorter decays carry less energy: a little more level
  };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/**
 * The broken grit kit: no ride, few claps and open hats, the snare off the backbeat (no rock backbeat by default),
 * toms thinned. Takes and returns kitGens()-style generator specs.
 */
export function gritKitGens(gens) {
  const OFF_BACKBEAT = [3, 6, 11];
  return gens.map((g) => {
    const o = { ...g };
    if (g.h === 'ride') o.favour = 0;
    if (g.h === 'hatO') o.favour = (g.favour ?? 1) * 0.35;
    if (g.h === 'clap') o.favour = (g.favour ?? 1) * 0.3;
    if (g.h === 'tomL' || g.h === 'tomM' || g.h === 'tomH') o.favour = (g.favour ?? 1) * 0.45;
    if (g.h === 'snare' || g.h === 'clap') {
      for (const s of ['flow', 'swell']) if (o[s]) o[s] = { ...o[s], rot: OFF_BACKBEAT, k: (o[s].k || [2]).map((k) => Math.min(k, 3)) };
      if (g.h === 'snare' && o.swell) o.swell = { ...o.swell, p: Math.min(o.swell.p, 0.55) };
    }
    if (g.h === 'grainBurst' || g.h === 'snap' || g.h === 'metal') o.favour = (g.favour ?? 1) * 1.3;
    return o;
  });
}

/** channel colouring of the palette channels (the score modulates them like the others) */
export const GRIT_CH = {
  sub:     { gain: 0.8,  pan: 0,     reverb: 0.02, delay: 0.01, grain: 0.01, cutoff: 400,   resonance: -3, drive: 0.05, crush: 0,    chorus: 0.02, duck: true },
  beat:    { gain: 0.42, pan: 0,     reverb: 0.25, delay: 0.04, grain: 0.15, cutoff: 9000,  resonance: -2, drive: 0.1,  crush: 0,    chorus: 0.15, duck: true },
  noise:   { gain: 1.0,  pan: 0,     reverb: 0.3,  delay: 0.05, grain: 0.2,  cutoff: 12000, resonance: -2, drive: 0.06, crush: 0,    chorus: 0.1, duck: true },
  res:     { gain: 0.55, pan: 0,     reverb: 0.45, delay: 0.1,  grain: 0.25, cutoff: 9000,  resonance: -2, drive: 0.05, crush: 0,    chorus: 0.2, duck: true },
  erode:   { gain: 0.6,  pan: -0.1,  reverb: 0.35, delay: 0.15, grain: 0.55, cutoff: 12000, resonance: -2, drive: 0.08, crush: 0,    chorus: 0.1, duck: true },
  grain:   { gain: 0.7,  pan: 0.05,  reverb: 0.12, delay: 0.1,  grain: 0.1,  cutoff: 14000, resonance: -2, drive: 0.2,  crush: 0.35, chorus: 0.03, duck: true },
  arp:     { gain: 0.55, pan: 0,     reverb: 0.15, delay: 0.25, grain: 0.1,  cutoff: 9000,  resonance: -1, drive: 0.15, crush: 0.2,  chorus: 0.05, duck: true },
  glimpse: { gain: 0.6,  pan: 0.1,   reverb: 0.5,  delay: 0.3,  grain: 0.3,  cutoff: 5200,  resonance: -2, drive: 0.04, crush: 0.15, chorus: 0.15, duck: true },
};
export const GRIT_CH_NAMES = Object.keys(GRIT_CH);
/** the kit channels crushed in the grit palette (dirty kit), and the artefacts' front kit for the crushed entry hit */
export const GRIT_KIT_CH = { kmain: { crush: 0.45, drive: 0.32 }, kcym: { crush: 0.35, drive: 0.12 }, ktex: { crush: 0.3, drive: 0.12 }, fmain: { crush: 0.4, drive: 0.28 }, fcym: { crush: 0.3 }, ftex: { crush: 0.25 } };
