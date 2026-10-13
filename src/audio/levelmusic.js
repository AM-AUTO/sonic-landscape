/**
 * CONTOURS level music profiles. One entry per level id; everything the score layer needs to make
 * eight landscapes sound like eight landscapes of one record:
 *
 *   binding ethos (shared by all)    drone foundation on the tonic, the 5-note Contour Motif (transformed per level),
 *                                    envelope percussion, granular / reverb / delay space, the same mapping grammar
 *   what varies                      root, mode (+ dawn/night variants), tempo & swing, chord vocabulary,
 *                                    lead register + character, every voice patch, drum palette, FX ranges,
 *                                    texture per ground cover, channel colouring
 *
 * Patch objects are plain overrides of the voice DEFAULTS (resolved with `resolve()` below). Every numeric
 * default is given at least two distinct values across the eight profiles, or is modulated by gameplay,
 * so the parameter audit has something to see (tests/levelmusic.test.js checks the static part).
 */
import { MODES, CONTOUR_MOTIF, transformMotif, midiToHz } from './theory.js';
import { DRONE_DEFAULTS } from './voices/drone.js';
import { PAD_DEFAULTS } from './voices/pad.js';
import { BASS_DEFAULTS } from './voices/bass.js';
import { LEAD_DEFAULTS } from './voices/lead.js';
import { BELL_DEFAULTS } from './voices/bell.js';
import { PLUCK_DEFAULTS } from './voices/pluck.js';
import { TEXTURE_DEFAULTS } from './voices/texture.js';
import { KIT_DEFAULTS } from './voices/kit.js';

export const LEVEL_IDS = ['rannoch', 'affric', 'coe', 'cairngorm', 'torridon', 'cuillin', 'assynt', 'nevis'];
export const VOICE_DEFAULTS = { drone: DRONE_DEFAULTS, pad: PAD_DEFAULTS, bass: BASS_DEFAULTS, lead: LEAD_DEFAULTS, bell: BELL_DEFAULTS, pluck: PLUCK_DEFAULTS, texture: TEXTURE_DEFAULTS, kit: KIT_DEFAULTS };

/** Resolve a voice patch: defaults + level overrides. */
export function resolve(voice, over) { return { ...VOICE_DEFAULTS[voice], ...(over || {}) }; }

const M = MODES;
const hz = midiToHz;
/** frequency of pitch class `root` folded into [lo,hi] Hz */
function fold(rootMidi, lo, hi) { let f = hz(rootMidi); while (f < lo) f *= 2; while (f > hi) f /= 2; return f; }

// ------------------------------------------------------------------------------------------------
// drum template. Each generator: h (kit hit), per-section {p: probability, k: euclid pulse options, n, rot: rotation
// options}, vel [lo,hi], plus weights: slope/speed (more with climb / pace), cover boosts {scree,snow,rock,wood,water}.
// Profiles scale a hit with `favour[h]` and may replace whole sections via `over`.
// ------------------------------------------------------------------------------------------------
export const KIT_STD = [
  { h: 'shaker', ebb: { p: 0.22, k: [3, 5] }, flow: { p: 0.42, k: [5, 7] }, swell: { p: 0.55, k: [7, 9, 11] }, vel: [0.1, 0.26], speed: 0.6 },
  { h: 'click', ebb: { p: 0.2, k: [2, 3], n: 12 }, flow: { p: 0.22, k: [3, 5], n: 12 }, swell: { p: 0.2, k: [5], n: 12 }, vel: [0.12, 0.38], tone: 'rand', wood: 0.4 },
  { h: 'rim', flow: { p: 0.5, k: [2, 3], rot: [4, 6] }, swell: { p: 0.65, k: [3, 5], rot: [2, 4] }, vel: [0.22, 0.5], slope: 0.3 },
  { h: 'kick', flow: { p: 0.6, k: [2, 3] }, swell: { p: 0.85, k: [4, 5] }, vel: [0.4, 0.68], slope: 0.6 },
  { h: 'snare', flow: { p: 0.14, k: [2], rot: [4] }, swell: { p: 0.8, k: [2], rot: [4] }, vel: [0.32, 0.6], tone: 0.5 },
  { h: 'clap', flow: { p: 0.2, k: [2], rot: [4] }, swell: { p: 0.55, k: [2, 3], rot: [4, 8] }, vel: [0.3, 0.55] },
  { h: 'hatC', flow: { p: 0.45, k: [4, 6] }, swell: { p: 0.62, k: [6, 8, 11] }, vel: [0.15, 0.42], speed: 1.2, hats: true },
  { h: 'hatO', flow: { p: 0.12, k: [2], rot: [2] }, swell: { p: 0.42, k: [2, 3], rot: [2, 6] }, vel: [0.2, 0.4], speed: 0.6 },
  { h: 'ride', swell: { p: 0.62, k: [8, 7], rot: [0, 2] }, vel: [0.18, 0.42] },
  { h: 'tomL', flow: { p: 0.16, k: [2], rot: [6] }, swell: { p: 0.55, k: [3, 5], rot: [0, 3] }, vel: [0.35, 0.65], slope: 0.9 },
  { h: 'tomM', swell: { p: 0.5, k: [3, 5], rot: [2, 5] }, vel: [0.35, 0.6], slope: 0.9 },
  { h: 'tomH', swell: { p: 0.45, k: [5, 7], rot: [1, 4] }, vel: [0.3, 0.55], slope: 0.7 },
  { h: 'snap', flow: { p: 0.12, k: [3, 5] }, swell: { p: 0.3, k: [3, 5, 7] }, vel: [0.18, 0.45], scree: 1.8, tone: 'rand' },
  { h: 'grainBurst', ebb: { p: 0.1, k: [1], n: 32 }, flow: { p: 0.16, k: [2, 3] }, swell: { p: 0.32, k: [3, 5] }, vel: [0.2, 0.5], scree: 1.6, water: 0.6, tone: 'rand' },
  { h: 'metal', flow: { p: 0.1, k: [2, 3] }, swell: { p: 0.26, k: [3, 5] }, vel: [0.2, 0.46], rock: 2.0, tone: 'rand' },
  { h: 'breath', ebb: { p: 0.28, k: [1], n: 32 }, flow: { p: 0.14, k: [1], n: 32 }, vel: [0.12, 0.3], snow: 1.5 },
];

const MIX = (o) => ({ shaker: 1, click: 1, rim: 1, kick: 1, snare: 1, clap: 1, hatC: 1, hatO: 1, ride: 1, tomL: 1, tomM: 1, tomH: 1, snap: 1, grainBurst: 1, metal: 1, breath: 1, ...o });

// ------------------------------------------------------------------------------------------------
// channel colouring baseline (every channel exposes all ten channel parameters; the score modulates them)
// ------------------------------------------------------------------------------------------------
export const CHANNEL_NAMES = ['drone', 'pad', 'bass', 'bell', 'pluck', 'texture', 'kmain', 'kcym', 'ktex', 'ghost', 'lead', 'fore', 'foreB', 'forePad', 'foreLow', 'fmain', 'fcym', 'ftex'];
export const FRONT_CHANNELS = ['lead', 'fore', 'foreB', 'forePad', 'foreLow', 'fmain', 'fcym', 'ftex'];   // un-ducked

export const CH_BASE = {
  drone:   { gain: 0.95,  pan: 0,    reverb: 0.35, delay: 0.06, grain: 0.12, cutoff: 9000,  resonance: -1, drive: 0.04, crush: 0, chorus: 0.2 },
  pad:     { gain: 0.28,  pan: 0,    reverb: 0.55, delay: 0.2,  grain: 0.22, cutoff: 12000, resonance: -2, drive: 0.04, crush: 0, chorus: 0.35 },
  bass:    { gain: 0.46, pan: 0,    reverb: 0.06, delay: 0,    grain: 0,    cutoff: 2600,  resonance: 0,  drive: 0.12, crush: 0, chorus: 0 },
  bell:    { gain: 0.5, pan: 0.15, reverb: 0.68, delay: 0.5,  grain: 0.3,  cutoff: 16000, resonance: -2, drive: 0,    crush: 0, chorus: 0.1 },
  pluck:   { gain: 0.55, pan: -0.2, reverb: 0.45, delay: 0.4,  grain: 0.14, cutoff: 14000, resonance: -2, drive: 0,    crush: 0, chorus: 0.15 },
  texture: { gain: 0.42,  pan: 0,    reverb: 0.35, delay: 0.1,  grain: 0.3,  cutoff: 10000, resonance: -1, drive: 0,    crush: 0, chorus: 0.1 },
  kmain:   { gain: 0.78,  pan: 0,    reverb: 0.15, delay: 0.08, grain: 0.04, cutoff: 12000, resonance: -2, drive: 0.15, crush: 0, chorus: 0 },
  kcym:    { gain: 0.5, pan: 0.1,  reverb: 0.5,  delay: 0.15, grain: 0.08, cutoff: 16000, resonance: -2, drive: 0.03, crush: 0, chorus: 0.05 },
  ktex:    { gain: 0.55, pan: -0.1, reverb: 0.45, delay: 0.35, grain: 0.3,  cutoff: 14000, resonance: -2, drive: 0.05, crush: 0, chorus: 0.1 },
  ghost:   { gain: 0.28, pan: 0,    reverb: 0.9,  delay: 0.6,  grain: 0.4,  cutoff: 7000,  resonance: -1, drive: 0,    crush: 0, chorus: 0.4 },
  lead:    { gain: 0.85, pan: 0,    reverb: 0.5,  delay: 0.55, grain: 0.22, cutoff: 14000, resonance: -2, drive: 0.08, crush: 0, chorus: 0.25 },
  fore:    { gain: 0.95, pan: 0,    reverb: 0.62, delay: 0.5,  grain: 0.3,  cutoff: 16000, resonance: -2, drive: 0,    crush: 0, chorus: 0.12 },
  foreB:   { gain: 0.95, pan: 0.2,  reverb: 0.55, delay: 0.45, grain: 0.25, cutoff: 15000, resonance: -2, drive: 0,    crush: 0, chorus: 0.12 },
  forePad: { gain: 0.7, pan: 0,    reverb: 0.62, delay: 0.3,  grain: 0.3,  cutoff: 12000, resonance: -2, drive: 0.04, crush: 0, chorus: 0.4 },
  foreLow: { gain: 0.9,  pan: 0,    reverb: 0.14, delay: 0.04, grain: 0.02, cutoff: 3000,  resonance: 0,  drive: 0.15, crush: 0, chorus: 0 },
  fmain:   { gain: 1.15,  pan: 0,    reverb: 0.2,  delay: 0.1,  grain: 0.06, cutoff: 14000, resonance: -2, drive: 0.12, crush: 0, chorus: 0 },
  fcym:    { gain: 0.9, pan: 0.1,  reverb: 0.55, delay: 0.18, grain: 0.1,  cutoff: 17000, resonance: -2, drive: 0.02, crush: 0, chorus: 0.05 },
  ftex:    { gain: 1.0, pan: -0.1, reverb: 0.5,  delay: 0.4,  grain: 0.35, cutoff: 15000, resonance: -2, drive: 0.04, crush: 0, chorus: 0.1 },
};

// default texture per ground cover (levels override entries)
export const TEXTURE_COVERS = {
  moor:    { kind: 'wind',   level: 0.5,  tone: 0.45 },
  path:    { kind: 'wind',   level: 0.34, tone: 0.58 },
  bog:     { kind: 'wind',   level: 0.46, tone: 0.1 },
  scree:   { kind: 'rustle', level: 0.52, tone: 0.32 },
  crag:    { kind: 'wind',   level: 0.4,  tone: 0.3 },
  snow:    { kind: 'hiss',   level: 0.46, tone: 0.78 },
  wood:    { kind: 'rustle', level: 0.5,  tone: 0.58 },
  shallow: { kind: 'water',  level: 0.62, tone: 0.5 },
  deep:    { kind: 'water',  level: 0.55, tone: 0.4 },
  rock:    { kind: 'hiss',   level: 0.3,  tone: 0.34 },
};
export const COVER_KEYS = ['moor', 'path', 'bog', 'scree', 'crag', 'snow', 'wood', 'shallow', 'deep', 'rock'];

// ------------------------------------------------------------------------------------------------
// the eight profiles
// ------------------------------------------------------------------------------------------------
const mk = (p) => p;

export const PROFILES = {
  // ============================================================================ I. Rannoch Moor
  rannoch: mk({
    id: 'rannoch', loud: 0, kitLift: 4.5, title: 'Vast and sparse. Glass bells, long lochan delays.',
    root: 50, modeName: 'dorian', mode: M.dorian, dawn: [0, 2, 3, 6, 7, 9, 10], night: [0, 1, 3, 5, 7, 9, 10],
    bpm: 64, swing: 0.0, phraseBars: 4, nightTempo: 0.9,
    motifOp: 'invert',
    chords: [
      { d: 0, steps: [0, 2, 4], w: 4, name: 'i' }, { d: 0, steps: [0, 2, 4, 8], w: 2, name: 'i9', spread: 1 },
      { d: 3, steps: [0, 2, 4], w: 2.5, name: 'IV' }, { d: 4, steps: [0, 2, 4], w: 2, name: 'v' },
      { d: 6, steps: [0, 2, 4], w: 2, name: 'bVII' }, { d: 0, steps: [0, 1, 4], w: 2, name: 'isus2' },
      { d: 3, steps: [0, 1, 4], w: 1.4, name: 'IVsus2' }, { d: 1, steps: [0, 2, 4], w: 1, name: 'ii' },
    ],
    lead: { base: 62, span: 9, octaves: 1, pan: 0.55, hold: 2.2,
      patch: { wave1: 'triangle', wave2: 'sine', detune: 5, saw: 0.12, tri: 0.72, sub: 0.15, tune: 0, glide: 0.16, vibRate: 4.6, vibDepth: 9, vibDelay: 0.6, vibRamp: 1.0, scoop: 14, drift: 4, cutoff: 2000, envAmt: 0.9, filterAttack: 0.18, filterDecay: 1.1, filterSustain: 0.5, resonance: 2, keytrack: 0.6, attack: 0.09, decay: 0.5, sustain: 0.9, release: 1.2, level: 0.64 } },
    drone: { low: -12, cut: [430, 1500], patch: { voices: 5, wave: 'sawtooth', spread: 8, detuneLfo: 6, lfoRate: 0.045, cutoff: 560, cutoffLfo: 0.5, resonance: 1.5, level: 0.15, sub: 0.55, stereo: 0.8, tune: 0, fadeIn: 4, release: 5 } },
    pad: { center: 62, cut: [520, 2000], patch: { saws: 3, detune: 11, triMix: 0.7, attack: 2.6, decay: 3, sustain: 0.8, release: 5, cutoff: 760, envAmt: 1.4, resonance: 1, keytrack: 0.35, lfoRate: 0.08, lfoDepth: 0.3, tune: 0, width: 0.9, level: 0.18 } },
    bass: { style: 'long', octave: -24, patch: { sub: 1.0, saw: 0.35, tri: 0.1, cutoff: 260, envAmt: 1.4, filterDecay: 0.5, resonance: 3, attack: 0.03, decay: 0.6, sustain: 0.8, release: 0.6, tune: 0, glide: 0.12, drive: 0.15, level: 0.2 } },
    bell: { kind: 'glass', patch: { kind: 'glass', indexDecay: 0.5, attack: 0.003, tune: 0, level: 0.34, brightness: 0.9, dampDur: 0 } },
    pluck: { patch: { kind: 'kalimba', cutoff: 5200, level: 0.8, damp: 0.1, tune: 0, drift: 4 } },
    ghost: { kind: 'bowl' },
    ticks: { bell: 0.7, pluck: 0.3, density: 0.55 },
    texture: { patch: { kind: 'wind', level: 0.5, tone: 0.4, motion: 0.8, fade: 3.5 }, covers: { moor: { level: 0.44, tone: 0.4 }, shallow: { kind: 'water', level: 0.55 } } },
    kit: {
      patch: { level: 0.9, humanize: 0.035, kickDecay: 0.8, kickClick: 0.2, kickSweep: 2.4, snareNoise: 0.6, snareDecay: 0.26, hatBright: 0.85, hatDecay: 0.06, hatOpenDecay: 0.5, crashDecay: 5.5, crashBright: 0.85, rideDecay: 3, tomDecay: 0.55, timpDecay: 4, gongDecay: 11, grainCount: 10, swellLength: 3.2, breathLength: 2.6 },
      favour: MIX({ shaker: 1.1, click: 1.3, rim: 1.0, kick: 0.9, snare: 0.4, brush: 1.0, clap: 0.3, hatC: 0.5, hatO: 0.4, ride: 0.5, tomL: 0.8, tomM: 0.6, tomH: 0.4, snap: 0.5, grainBurst: 1.2, metal: 0.4, breath: 1.5 }),
      // the moor pulse: a textural, polymetric scatter (n = 16 / 12 / 32 never line up into a loop), soft kick, brushed snare ghosts
      over: {
        shaker: { flow: { p: 0.8, k: [5, 7, 9], n: 16, rot: [0, 2, 3] } },
        click: { flow: { p: 0.6, k: [3, 5], n: 12 } },
        rim: { flow: { p: 0.6, k: [2, 3], rot: [4, 10] } },
        kick: { flow: { p: 0.75, k: [2, 3], rot: [0, 10] }, vel: [0.3, 0.52] },
        grainBurst: { flow: { p: 0.4, k: [1, 2], n: 32 } },
        breath: { flow: { p: 0.45, k: [1, 2], n: 32 } },
        hatC: { flow: { p: 0.3, k: [3, 4], rot: [2] } },
      },
      extra: [
        { id: 'brush', h: 'snare', flow: { p: 0.6, k: [2, 3], n: 16, rot: [5, 7, 12] }, swell: { p: 0.6, k: [3, 4], n: 16, rot: [5, 7, 12] }, vel: [0.1, 0.24], tone: 0.15, opts: { decay: 0.34 } },
      ],
      spacious: true, flowMul: 0.95,
      crash: { phrase: 0.55, ride: false, swellFill: 1, gong: 0.25, timp: 0.12 },
    },
    fx: {
      reverb: { min: 3, max: 14, wet: 0.95, damp: [3600, 8200], pre: [0.05, 0.085] },
      delay: { beats: 1.5, fb: [0.34, 0.74], tone: [2000, 4600], wet: 0.62, mod: [0.12, 0.35], pingPong: true, spread: [1, 1.5] },
      granular: { density: 10, size: 0.28, pitch: 12, pitchSpread: 5, spray: 2.4, reverse: 0.2, mix: 0.75, feedback: 0.28 },
      master: { drive: [0.02, 0.18], lowCut: [26, 48], highCut: [9500, 16500], gain: 1, dark: 0.3 },
    },
    ch: { bell: { reverb: 0.78, delay: 0.62 }, lead: { delay: 0.65, chorus: 0.2 }, kmain: { reverb: 0.22 }, drone: { chorus: 0.28, resonance: 0 }, pad: { crush: 0.01 } },
    glitch: 0,
  }),

  // ============================================================================ II. Glen Affric
  affric: mk({
    id: 'affric', loud: 0, title: 'Bright pinewood. Pluck arpeggios, shimmering water grains.',
    root: 55, modeName: 'lydian', mode: M.lydian, dawn: [0, 2, 4, 6, 8, 9, 11], night: M.lydianDom,
    bpm: 72, swing: 0.12, phraseBars: 4, nightTempo: 0.92,
    motifOp: 'rotate:1',
    chords: [
      { d: 0, steps: [0, 2, 4], w: 4, name: 'I' }, { d: 0, steps: [0, 2, 4, 6], w: 2.5, name: 'Imaj7', spread: 1 },
      { d: 1, steps: [0, 2, 4], w: 2.5, name: 'II' }, { d: 4, steps: [0, 2, 4], w: 2, name: 'V' },
      { d: 5, steps: [0, 2, 4], w: 1.6, name: 'vi' }, { d: 2, steps: [0, 2, 4], w: 1.2, name: 'iii' },
      { d: 0, steps: [0, 2, 4, 8], w: 2, name: 'Iadd9', spread: 1 }, { d: 6, steps: [0, 2, 4], w: 0.8, name: 'vii' },
    ],
    lead: { base: 67, span: 9, octaves: 1, pan: 0.5, hold: 1.4,
      patch: { wave1: 'sawtooth', wave2: 'triangle', detune: 9, saw: 0.34, tri: 0.62, sub: 0.2, tune: 0, glide: 0.07, vibRate: 5.9, vibDepth: 15, vibDelay: 0.3, vibRamp: 0.5, scoop: 18, drift: 2.5, cutoff: 3400, envAmt: 1.2, filterAttack: 0.07, filterDecay: 0.55, filterSustain: 0.4, resonance: 3, keytrack: 0.7, attack: 0.04, decay: 0.3, sustain: 0.82, release: 0.7, level: 0.58 } },
    drone: { low: -12, cut: [620, 2400], patch: { voices: 5, wave: 'triangle', spread: 11, detuneLfo: 9, lfoRate: 0.07, cutoff: 900, cutoffLfo: 0.4, resonance: 2.5, level: 0.13, sub: 0.4, stereo: 0.9, tune: 0, fadeIn: 5, release: 5.5 } },
    pad: { center: 67, cut: [800, 3400], patch: { saws: 3, detune: 17, triMix: 0.4, attack: 1.5, decay: 2.2, sustain: 0.7, release: 3.2, cutoff: 1300, envAmt: 2.1, resonance: 2, keytrack: 0.55, lfoRate: 0.13, lfoDepth: 0.22, tune: 3, width: 0.85, level: 0.16 } },
    bass: { style: 'pulse', octave: -24, patch: { sub: 0.85, saw: 0.5, tri: 0.3, cutoff: 420, envAmt: 2.2, filterDecay: 0.3, resonance: 4, attack: 0.012, decay: 0.35, sustain: 0.6, release: 0.3, tune: 2, glide: 0.05, drive: 0.25, level: 0.19 } },
    bell: { kind: 'tine', patch: { kind: 'tine', indexDecay: 0.4, attack: 0.002, tune: 0, level: 0.3, brightness: 1.1, dampDur: 0 } },
    pluck: { patch: { kind: 'harp', cutoff: 8200, level: 0.9, damp: 0.25, tune: 0, drift: 3 } },
    ghost: { kind: 'glass' },
    ticks: { bell: 0.25, pluck: 0.75, density: 0.75 },
    texture: { patch: { kind: 'rustle', level: 0.46, tone: 0.55, motion: 1.1, fade: 2.8 }, covers: { moor: { kind: 'wind', level: 0.4, tone: 0.5 }, wood: { kind: 'rustle', level: 0.56, tone: 0.6 }, shallow: { level: 0.7, tone: 0.6 } } },
    kit: {
      patch: { level: 1.0, humanize: 0.03, kickFreq: null, kickDecay: 0.5, kickClick: 0.3, kickSweep: 3.1, snareFreq: 205, snareNoise: 0.7, snareDecay: 0.18, hatBright: 1.1, hatDecay: 0.045, hatOpenDecay: 0.38, crashDecay: 4, crashBright: 1.15, rideDecay: 2.4, tomDecay: 0.4, timpDecay: 3.2, gongDecay: 8, grainCount: 12, swellLength: 2.4, breathLength: 1.8 },
      favour: MIX({ shaker: 1.3, click: 1.3, rim: 1.1, kick: 0.7, snare: 0.5, clap: 0.7, hatC: 0.9, hatO: 0.7, ride: 0.8, tomL: 0.5, tomM: 0.6, tomH: 0.8, snap: 0.6, grainBurst: 1.3, metal: 0.3, breath: 0.8 }),
      crash: { phrase: 0.7, ride: true, swellFill: 1, gong: 0.1, timp: 0.1 },
    },
    fx: {
      reverb: { min: 2.5, max: 11, wet: 0.88, damp: [5200, 11000], pre: [0.03, 0.05] },
      delay: { beats: 0.75, fb: [0.3, 0.66], tone: [3200, 7200], wet: 0.55, mod: [0.15, 0.4], pingPong: true, spread: [1, 1.33] },
      granular: { density: 22, size: 0.12, pitch: 12, pitchSpread: 7, spray: 1.6, reverse: 0.15, mix: 0.8, feedback: 0.22 },
      master: { drive: [0.04, 0.2], lowCut: [30, 52], highCut: [11500, 18500], gain: 1, dark: 0.5 },
    },
    ch: { pluck: { gain: 0.62, delay: 0.5, chorus: 0.25 }, texture: { grain: 0.4 }, bell: { reverb: 0.6 }, pad: { chorus: 0.42 } },
    glitch: 0,
  }),

  // ============================================================================ III. Glen Coe
  coe: mk({
    id: 'coe', loud: 2, bedDb: -2.5, title: 'Dark and dramatic. Toms, gong, crashes, low saw drones.',
    root: 57, modeName: 'phrygian', mode: M.phrygian, dawn: M.aeolian, night: M.locrian,
    bpm: 76, swing: 0.0, phraseBars: 4, nightTempo: 0.93,
    motifOp: 'retro',
    chords: [
      { d: 0, steps: [0, 2, 4], w: 5, name: 'i' }, { d: 1, steps: [0, 2, 4], w: 3, name: 'bII' },
      { d: 6, steps: [0, 2, 4], w: 2, name: 'bVII' }, { d: 3, steps: [0, 2, 4], w: 2, name: 'iv' },
      { d: 5, steps: [0, 2, 4], w: 2, name: 'bVI' }, { d: 4, steps: [0, 2, 4], w: 1, name: 'vdim' },
      { d: 0, steps: [0, 3, 4], w: 1.6, name: 'isus4' }, { d: 0, steps: [0, 4, 7], w: 1.6, name: 'i5', spread: 1 },
    ],
    lead: { base: 57, span: 9, octaves: 1, pan: 0.6, hold: 1.6,
      patch: { wave1: 'sawtooth', wave2: 'square', detune: 12, saw: 0.62, tri: 0.28, sub: 0.38, tune: 0, glide: 0.11, vibRate: 4.9, vibDepth: 18, vibDelay: 0.5, vibRamp: 0.9, scoop: 28, drift: 3.5, cutoff: 1500, envAmt: 2.0, filterAttack: 0.15, filterDecay: 0.9, filterSustain: 0.3, resonance: 8, keytrack: 0.5, attack: 0.06, decay: 0.4, sustain: 0.78, release: 0.9, level: 0.54 } },
    drone: { low: -12, cut: [330, 1100], patch: { voices: 6, wave: 'sawtooth', spread: 14, detuneLfo: 9, lfoRate: 0.052, cutoff: 470, cutoffLfo: 0.7, resonance: 5, level: 0.17, sub: 0.62, stereo: 0.7, tune: 0, fadeIn: 3, release: 6 } },
    pad: { center: 57, cut: [420, 1600], patch: { saws: 3, detune: 17, triMix: 0.8, attack: 1.4, decay: 3.1, sustain: 0.68, release: 4.2, cutoff: 620, envAmt: 2.5, resonance: 3.5, keytrack: 0.3, lfoRate: 0.1, lfoDepth: 0.35, tune: -5, width: 0.7, level: 0.19 } },
    bass: { style: 'pulse', octave: -24, patch: { sub: 0.95, saw: 0.7, tri: 0.2, cutoff: 330, envAmt: 2.6, filterDecay: 0.45, resonance: 7, attack: 0.01, decay: 0.45, sustain: 0.65, release: 0.35, tune: -4, glide: 0.06, drive: 0.55, level: 0.21 } },
    bell: { kind: 'bowl', patch: { kind: 'bowl', indexDecay: 0.6, attack: 0.002, tune: 0, level: 0.3, brightness: 0.8, dampDur: 0 } },
    pluck: { patch: { kind: 'string', cutoff: 4200, level: 0.85, damp: 0.35, tune: 0, drift: 5 } },
    ghost: { kind: 'tine' },
    ticks: { bell: 0.4, pluck: 0.6, density: 0.6 },
    texture: { patch: { kind: 'wind', level: 0.55, tone: 0.3, motion: 0.9, fade: 3 }, covers: { moor: { level: 0.5, tone: 0.28 }, scree: { level: 0.6, tone: 0.28 }, bog: { tone: 0.08 } } },
    kit: {
      patch: { level: 1.1, humanize: 0.02, kickDecay: 0.65, kickClick: 0.4, kickSweep: 3.3, snareFreq: 172, snareNoise: 0.9, snareDecay: 0.24, hatBright: 0.8, hatDecay: 0.055, hatOpenDecay: 0.46, crashDecay: 6.5, crashBright: 0.8, rideDecay: 2.8, tomDecay: 0.62, timpDecay: 4.6, gongDecay: 12.5, grainCount: 13, swellLength: 3.0, breathLength: 2.2 },
      favour: MIX({ shaker: 0.4, click: 0.6, rim: 0.6, kick: 0.95, snare: 0.9, clap: 0.4, hatC: 0.5, hatO: 0.5, ride: 0.6, tomL: 1.25, tomM: 1.15, tomH: 0.95, snap: 0.8, grainBurst: 0.9, metal: 0.8, breath: 0.8 }),
      over: { tomL: { flow: { p: 0.3, k: [2, 3], rot: [0, 6] } }, kick: { flow: { p: 0.7, k: [3, 4] } } },
      crash: { phrase: 0.95, ride: false, swellFill: 2, gong: 0.55, timp: 0.4 },
    },
    fx: {
      reverb: { min: 2, max: 9.5, wet: 0.92, damp: [2800, 6500], pre: [0.02, 0.04] },
      delay: { beats: 0.75, fb: [0.28, 0.62], tone: [1700, 3800], wet: 0.5, mod: [0.1, 0.3], pingPong: true, spread: [1, 1.5] },
      granular: { density: 14, size: 0.2, pitch: -12, pitchSpread: 5, spray: 1.8, reverse: 0.3, mix: 0.7, feedback: 0.3 },
      master: { drive: [0.08, 0.3], lowCut: [24, 40], highCut: [8000, 14500], gain: 1, dark: 0.45 },
    },
    ch: { bass: { drive: 0.3, cutoff: 2000 }, kmain: { drive: 0.3, reverb: 0.2 }, kcym: { reverb: 0.62 }, drone: { drive: 0.14 }, ktex: { crush: 0.02 }, ghost: { crush: 0.02, cutoff: 5500 } },
    glitch: 0.02,
  }),

  // ============================================================================ IV. Cairngorm Plateau
  cairngorm: mk({
    id: 'cairngorm', loud: -2, bedDb: -3, title: 'Arctic and glacial. Frozen granular, snow hiss, the slowest pulse.',
    root: 52, modeName: 'aeolian', mode: M.aeolian, dawn: M.dorian, night: M.phrygian,
    bpm: 56, swing: 0.0, phraseBars: 4, nightTempo: 0.9,
    motifOp: 'augment',
    chords: [
      { d: 0, steps: [0, 1, 4], w: 4, name: 'isus2' }, { d: 0, steps: [0, 3, 4], w: 2.5, name: 'isus4' },
      { d: 5, steps: [0, 1, 4], w: 2.5, name: 'VIsus2' }, { d: 6, steps: [0, 1, 4], w: 2.2, name: 'bVIIsus2' },
      { d: 4, steps: [0, 1, 4], w: 1.4, name: 'vsus2' }, { d: 2, steps: [0, 2, 4], w: 1.4, name: 'III' },
      { d: 0, steps: [0, 4, 7], w: 2, name: 'i5', spread: 1 }, { d: 5, steps: [0, 2, 4, 6], w: 1.2, name: 'VImaj7', spread: 1 },
    ],
    lead: { base: 64, span: 8, octaves: 1, pan: 0.4, hold: 3.0,
      patch: { wave1: 'triangle', wave2: 'sine', detune: 3, saw: 0.05, tri: 0.8, sub: 0.05, tune: 0, glide: 0.2, vibRate: 3.9, vibDepth: 5, vibDelay: 1.0, vibRamp: 1.6, scoop: 8, drift: 6, cutoff: 3600, envAmt: 0.5, filterAttack: 0.3, filterDecay: 1.5, filterSustain: 0.6, resonance: 1, keytrack: 0.8, attack: 0.16, decay: 0.7, sustain: 0.95, release: 1.8, level: 0.6 } },
    drone: { low: -12, cut: [380, 2200], patch: { voices: 4, wave: 'triangle', spread: 6, detuneLfo: 5, lfoRate: 0.035, cutoff: 700, cutoffLfo: 0.3, resonance: 0.5, level: 0.18, sub: 0.35, stereo: 1.0, tune: -6, fadeIn: 6, release: 7 } },
    pad: { center: 64, cut: [900, 5200], patch: { saws: 2, detune: 7, triMix: 1.0, attack: 3.4, decay: 3.8, sustain: 0.85, release: 6.5, cutoff: 1500, envAmt: 0.9, resonance: 0.2, keytrack: 0.75, lfoRate: 0.06, lfoDepth: 0.4, tune: -8, width: 1.0, level: 0.16 } },
    bass: { style: 'long', octave: -24, patch: { sub: 0.9, saw: 0.15, tri: 0.05, cutoff: 200, envAmt: 0.8, filterDecay: 0.8, resonance: 1, attack: 0.08, decay: 0.9, sustain: 0.85, release: 0.9, tune: -6, glide: 0.2, drive: 0.04, level: 0.2 } },
    bell: { kind: 'glass', patch: { kind: 'glass', indexDecay: 0.35, attack: 0.002, tune: 0, level: 0.36, brightness: 1.3, dampDur: 0 } },
    pluck: { patch: { kind: 'harp', cutoff: 9800, level: 0.7, damp: 0.05, tune: 0, drift: 2 } },
    ghost: { kind: 'glass' },
    ticks: { bell: 0.85, pluck: 0.15, density: 0.45 },
    texture: { patch: { kind: 'hiss', level: 0.4, tone: 0.7, motion: 0.6, fade: 4 }, covers: { moor: { kind: 'hiss', level: 0.4, tone: 0.65 }, snow: { level: 0.55, tone: 0.85 }, rock: { kind: 'wind', level: 0.4, tone: 0.35 } } },
    kit: {
      patch: { level: 0.8, humanize: 0.04, kickFreq: null, kickDecay: 1.0, kickClick: 0.1, kickSweep: 2.0, snareFreq: 230, snareNoise: 0.5, snareDecay: 0.3, hatBright: 1.3, hatDecay: 0.08, hatOpenDecay: 0.6, crashDecay: 8, crashBright: 1.3, rideDecay: 3.6, tomDecay: 0.7, timpDecay: 5.5, gongDecay: 13, grainCount: 8, swellLength: 4.2, breathLength: 3.4 },
      favour: MIX({ shaker: 0.4, click: 0.9, rim: 0.3, kick: 0.45, snare: 0.15, clap: 0.1, hatC: 0.3, hatO: 0.2, ride: 0.8, tomL: 0.5, tomM: 0.3, tomH: 0.3, snap: 0.9, grainBurst: 1.5, metal: 0.5, breath: 1.8 }),
      crash: { phrase: 0.4, ride: true, swellFill: 1, gong: 0.3, timp: 0.08 },
    },
    fx: {
      reverb: { min: 5, max: 16, wet: 1.0, damp: [4800, 10500], pre: [0.07, 0.1] },
      delay: { beats: 1.5, fb: [0.38, 0.78], tone: [3000, 6800], wet: 0.58, mod: [0.05, 0.2], pingPong: false, spread: [1, 1.25] },
      granular: { density: 7, size: 0.55, pitch: 12, pitchSpread: 3, spray: 4.2, reverse: 0.35, mix: 0.9, feedback: 0.36 },
      master: { drive: [0.0, 0.1], lowCut: [30, 60], highCut: [10500, 19000], gain: 1, dark: 1.0 },
    },
    ch: { lead: { gain: 0.6, delay: 0.4, grain: 0.1 }, bell: { reverb: 0.8, delay: 0.55, cutoff: 18000 }, texture: { gain: 0.34, grain: 0.42 }, pad: { chorus: 0.5, reverb: 0.65 }, ghost: { reverb: 0.95 }, drone: { reverb: 0.45 } },
    glitch: 0,
  }),

  // ============================================================================ V. Torridon
  torridon: mk({
    id: 'torridon', loud: 0, bedDb: -4.5, title: 'Monumental. Brass-like saw pads, terraced rhythm.',
    root: 48, modeName: 'mixolydian', mode: M.mixolydian, dawn: M.ionian, night: M.dorian,
    bpm: 68, swing: 0.0, phraseBars: 4, nightTempo: 0.94, terraced: true,
    motifOp: 'rotate:3',
    chords: [
      { d: 0, steps: [0, 2, 4], w: 4, name: 'I' }, { d: 3, steps: [0, 2, 4], w: 3, name: 'IV' },
      { d: 6, steps: [0, 2, 4], w: 3, name: 'bVII' }, { d: 4, steps: [0, 2, 4], w: 1.5, name: 'v' },
      { d: 0, steps: [0, 4, 7], w: 2.4, name: 'I5', spread: 1 }, { d: 0, steps: [0, 2, 4, 8], w: 2, name: 'Iadd9', spread: 1 },
      { d: 3, steps: [0, 1, 4], w: 1.5, name: 'IVsus2' }, { d: 5, steps: [0, 2, 4], w: 1.1, name: 'vi' },
    ],
    lead: { base: 60, span: 9, octaves: 1, pan: 0.5, hold: 1.8,
      patch: { wave1: 'sawtooth', wave2: 'square', detune: 8, saw: 0.58, tri: 0.2, sub: 0.45, tune: 0, glide: 0.1, vibRate: 5.0, vibDepth: 12, vibDelay: 0.55, vibRamp: 0.8, scoop: 24, drift: 2, cutoff: 2100, envAmt: 2.2, filterAttack: 0.22, filterDecay: 0.8, filterSustain: 0.45, resonance: 3, keytrack: 0.45, attack: 0.09, decay: 0.45, sustain: 0.9, release: 0.8, level: 0.56 } },
    drone: { low: -12, cut: [450, 1700], patch: { voices: 6, wave: 'sawtooth', spread: 10, detuneLfo: 7, lfoRate: 0.058, cutoff: 700, cutoffLfo: 0.55, resonance: 3, level: 0.16, sub: 0.5, stereo: 0.85, tune: 0, fadeIn: 4.5, release: 5.5 } },
    pad: { center: 60, cut: [650, 2600], patch: { saws: 3, detune: 21, triMix: 0.3, attack: 0.9, decay: 2.0, sustain: 0.82, release: 3.0, cutoff: 1100, envAmt: 2.8, resonance: 2.5, keytrack: 0.5, lfoRate: 0.09, lfoDepth: 0.15, tune: 4, width: 0.75, level: 0.2 } },
    bass: { style: 'terrace', octave: -24, patch: { sub: 0.75, saw: 0.65, tri: 0.15, cutoff: 360, envAmt: 2.3, filterDecay: 0.4, resonance: 5, attack: 0.015, decay: 0.5, sustain: 0.75, release: 0.32, tune: 3, glide: 0.08, drive: 0.4, level: 0.2 } },
    bell: { kind: 'bowl', patch: { kind: 'bowl', indexDecay: 0.5, attack: 0.002, tune: 0, level: 0.3, brightness: 1.0, dampDur: 0.8 } },
    pluck: { patch: { kind: 'string', cutoff: 6200, level: 0.85, damp: 0.5, tune: 0, drift: 3 } },
    ghost: { kind: 'bowl' },
    ticks: { bell: 0.4, pluck: 0.6, density: 0.65 },
    texture: { patch: { kind: 'wind', level: 0.5, tone: 0.5, motion: 1.0, fade: 2.6 }, covers: { moor: { level: 0.46 }, rock: { kind: 'wind', level: 0.4, tone: 0.45 }, scree: { level: 0.55 } } },
    kit: {
      patch: { level: 1.05, humanize: 0.018, kickFreq: null, kickDecay: 0.6, kickClick: 0.45, kickSweep: 3.0, snareFreq: 180, snareNoise: 0.75, snareDecay: 0.22, hatBright: 0.95, hatDecay: 0.05, hatOpenDecay: 0.42, crashDecay: 5.5, crashBright: 0.95, rideDecay: 2.6, tomDecay: 0.5, timpDecay: 4.2, gongDecay: 10, grainCount: 11, swellLength: 2.6, breathLength: 2.0 },
      favour: MIX({ shaker: 0.4, click: 0.5, rim: 0.7, kick: 1.2, snare: 1.0, clap: 0.8, hatC: 0.7, hatO: 0.7, ride: 1.0, tomL: 1.3, tomM: 1.3, tomH: 1.0, snap: 0.5, grainBurst: 0.7, metal: 0.9, breath: 0.6 }),
      over: {
        kick: { flow: { p: 0.7, k: [3, 4], n: 12 }, swell: { p: 0.9, k: [4, 6], n: 12 } },
        snare: { flow: { p: 0.2, k: [3], n: 12, rot: [3] }, swell: { p: 0.85, k: [3], n: 12, rot: [3, 6] } },
        tomL: { swell: { p: 0.6, k: [3, 4], n: 12, rot: [0, 6] } }, tomM: { swell: { p: 0.55, k: [3, 4], n: 12, rot: [2, 8] } },
      },
      crash: { phrase: 0.8, ride: true, swellFill: 2, gong: 0.3, timp: 0.5 },
    },
    fx: {
      reverb: { min: 3, max: 12, wet: 0.9, damp: [3200, 7800], pre: [0.035, 0.055] },
      delay: { beats: 1.0, fb: [0.3, 0.66], tone: [2200, 5200], wet: 0.5, mod: [0.1, 0.28], pingPong: false, spread: [1, 1.5] },
      granular: { density: 16, size: 0.22, pitch: 7, pitchSpread: 5, spray: 2.2, reverse: 0.18, mix: 0.7, feedback: 0.26 },
      master: { drive: [0.06, 0.28], lowCut: [24, 42], highCut: [9000, 16000], gain: 1, dark: 0.35 },
    },
    ch: { pad: { gain: 0.32, chorus: 0.5, drive: 0.12 }, bass: { drive: 0.22 }, lead: { drive: 0.16 }, kmain: { drive: 0.22 }, forePad: { drive: 0.14 } },
    glitch: 0.0,
  }),

  // ============================================================================ VI. The Cuillin
  cuillin: mk({
    id: 'cuillin', loud: 1, title: 'Jagged and metallic. FM rock percussion, bitcrush glitch.',
    root: 54, modeName: 'lydianDom', mode: M.lydianDom, dawn: M.lydian, night: M.octatonic,
    bpm: 84, swing: 0.18, phraseBars: 4, nightTempo: 0.92,
    motifOp: 'invert+retro',
    chords: [
      { d: 0, steps: [0, 2, 4, 6], w: 4, name: 'I7' }, { d: 1, steps: [0, 2, 4], w: 2.5, name: 'II' },
      { d: 5, steps: [0, 2, 4], w: 1.6, name: 'vi' }, { d: 3, steps: [0, 2, 4], w: 1.6, name: 'dim' },
      { d: 6, steps: [0, 2, 4], w: 1, name: 'aug' }, { d: 0, steps: [0, 1, 4], w: 1.8, name: 'Isus2' },
      { d: 0, steps: [0, 3, 6], w: 1.2, name: 'tritone' }, { d: 2, steps: [0, 2, 4, 6], w: 1.2, name: 'iii7' },
    ],
    lead: { base: 66, span: 8, octaves: 1, pan: 0.65, hold: 0.9,
      patch: { wave1: 'square', wave2: 'sawtooth', detune: 22, saw: 0.5, tri: 0.35, sub: 0.2, tune: 0, glide: 0.04, vibRate: 6.6, vibDepth: 22, vibDelay: 0.25, vibRamp: 0.35, scoop: 38, drift: 5, cutoff: 3000, envAmt: 2.6, filterAttack: 0.04, filterDecay: 0.35, filterSustain: 0.2, resonance: 11, keytrack: 0.65, attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.35, level: 0.5 } },
    drone: { low: -12, cut: [380, 1500], patch: { voices: 5, wave: 'square', spread: 18, detuneLfo: 14, lfoRate: 0.09, cutoff: 540, cutoffLfo: 0.9, resonance: 7, level: 0.12, sub: 0.5, stereo: 0.95, tune: 0, fadeIn: 3.5, release: 4.5 } },
    pad: { center: 66, cut: [700, 3600], patch: { wave: 'square', saws: 2, detune: 25, triMix: 0.2, attack: 0.5, decay: 1.4, sustain: 0.6, release: 2.2, cutoff: 1400, envAmt: 2.4, resonance: 6, keytrack: 0.65, lfoRate: 0.19, lfoDepth: 0.4, tune: 6, width: 0.95, level: 0.14 } },
    bass: { style: 'pulse', octave: -24, patch: { wave: 'square', sub: 0.8, saw: 0.6, tri: 0.4, cutoff: 480, envAmt: 3.0, filterDecay: 0.2, resonance: 9, attack: 0.006, decay: 0.25, sustain: 0.5, release: 0.2, tune: 7, glide: 0.03, drive: 0.6, level: 0.18 } },
    bell: { kind: 'tine', patch: { kind: 'tine', indexDecay: 0.25, attack: 0.001, tune: 0, level: 0.3, brightness: 1.4, dampDur: 0.6 } },
    pluck: { patch: { kind: 'string', cutoff: 9500, level: 0.9, damp: 0.7, tune: 0, drift: 6 } },
    ghost: { kind: 'tine' },
    ticks: { bell: 0.6, pluck: 0.4, density: 0.85 },
    texture: { patch: { kind: 'hiss', level: 0.34, tone: 0.45, motion: 2.0, fade: 2.0 }, covers: { moor: { kind: 'wind', level: 0.36, tone: 0.5 }, rock: { kind: 'hiss', level: 0.4, tone: 0.5 }, scree: { kind: 'rustle', level: 0.62, tone: 0.5 } } },
    kit: {
      patch: { level: 1.0, humanize: 0.05, kickFreq: null, kickDecay: 0.42, kickClick: 0.55, kickSweep: 3.8, snareFreq: 215, snareNoise: 1.0, snareDecay: 0.16, hatBright: 1.25, hatDecay: 0.04, hatOpenDecay: 0.3, crashDecay: 3.2, crashBright: 1.4, rideDecay: 1.8, tomDecay: 0.33, timpDecay: 2.8, gongDecay: 7.0, grainCount: 18, swellLength: 1.9, breathLength: 1.3 },
      favour: MIX({ shaker: 0.5, click: 1.5, rim: 1.3, kick: 0.9, snare: 0.8, clap: 0.8, hatC: 1.1, hatO: 1.0, ride: 0.7, tomL: 0.7, tomM: 0.7, tomH: 1.0, snap: 1.8, grainBurst: 1.6, metal: 2.2, breath: 0.4 }),
      over: { metal: { flow: { p: 0.3, k: [3, 5], rot: [0, 2] }, swell: { p: 0.5, k: [5, 7], rot: [1, 3] } }, click: { flow: { p: 0.45, k: [5, 7], n: 16 } } },
      crash: { phrase: 0.7, ride: true, swellFill: 2, gong: 0.1, timp: 0.12 },
    },
    fx: {
      reverb: { min: 1.8, max: 8, wet: 0.82, damp: [3600, 9000], pre: [0.01, 0.025] },
      delay: { beats: 0.75, fb: [0.32, 0.7], tone: [2800, 8000], wet: 0.5, mod: [0.2, 0.55], pingPong: true, spread: [0.75, 1.5] },
      granular: { density: 38, size: 0.04, pitch: 0, pitchSpread: 14, spray: 1.1, reverse: 0.5, mix: 0.7, feedback: 0.32 },
      master: { drive: [0.08, 0.22], lowCut: [30, 60], highCut: [10500, 18500], gain: 1, dark: 0.55 },
    },
    ch: { ktex: { crush: 0.18, drive: 0.12 }, kcym: { crush: 0.06 }, lead: { crush: 0.04, drive: 0.22, chorus: 0.15 }, bell: { crush: 0.05 }, pluck: { crush: 0.03, drive: 0.1 }, bass: { crush: 0.04, drive: 0.25 } },
    glitch: 0.1,
  }),

  // ============================================================================ VII. Assynt
  assynt: mk({
    id: 'assynt', loud: -3, bedDb: -4, frontDb: -3, title: 'Stillness. Minimal, the longest delays, isolated peaks.',
    root: 51, modeName: 'pentMajor', mode: M.pentMajor, dawn: [0, 2, 4, 6, 9], night: [0, 2, 3, 7, 9],
    bpm: 60, swing: 0.0, phraseBars: 4, nightTempo: 0.88,
    motifOp: 'augment+retro',
    chords: [
      { d: 0, steps: [0, 2, 3], w: 4, name: 'I' }, { d: 0, steps: [0, 1, 3], w: 3.5, name: 'Isus2' },
      { d: 3, steps: [0, 2, 3], w: 1.6, name: 'Vsus' }, { d: 1, steps: [0, 2, 4], w: 1.6, name: 'II' },
      { d: 4, steps: [0, 2, 3], w: 1.0, name: 'VI' }, { d: 0, steps: [0, 3], w: 2.2, name: 'fifth' },
      { d: 0, steps: [0, 2, 3, 5], w: 1.6, name: 'Iadd' }, { d: 3, steps: [0, 1, 3], w: 1.0, name: 'Vsus2' },
    ],
    lead: { base: 63, span: 7, octaves: 1, pan: 0.35, hold: 3.2,
      patch: { wave1: 'sine', wave2: 'triangle', detune: 2, saw: 0.0, tri: 0.55, sub: 0.1, tune: 0, glide: 0.24, vibRate: 4.3, vibDepth: 6, vibDelay: 1.2, vibRamp: 1.4, scoop: 10, drift: 7, cutoff: 1500, envAmt: 0.6, filterAttack: 0.25, filterDecay: 1.8, filterSustain: 0.55, resonance: 0.5, keytrack: 0.65, attack: 0.12, decay: 0.6, sustain: 0.92, release: 2.2, level: 0.7 } },
    drone: { low: -12, cut: [360, 1300], patch: { voices: 4, wave: 'sawtooth', spread: 5, detuneLfo: 4, lfoRate: 0.04, cutoff: 450, cutoffLfo: 0.35, resonance: 1, level: 0.14, sub: 0.4, stereo: 0.6, tune: 0, fadeIn: 7, release: 8 } },
    pad: { center: 63, cut: [520, 2300], patch: { saws: 1, detune: 5, triMix: 0.9, attack: 4.0, decay: 4.2, sustain: 0.88, release: 7.0, cutoff: 900, envAmt: 0.7, resonance: 0.3, keytrack: 0.45, lfoRate: 0.05, lfoDepth: 0.45, tune: -3, width: 0.6, level: 0.17 } },
    bass: { style: 'long', octave: -24, patch: { sub: 0.8, saw: 0.1, tri: 0.0, cutoff: 180, envAmt: 0.6, filterDecay: 1.0, resonance: 0.5, attack: 0.15, decay: 1.2, sustain: 0.9, release: 1.2, tune: -2, glide: 0.25, drive: 0.02, level: 0.2 } },
    bell: { kind: 'bowl', patch: { kind: 'bowl', indexDecay: 0.8, attack: 0.004, tune: 0, level: 0.38, brightness: 0.7, dampDur: 0 } },
    pluck: { patch: { kind: 'kalimba', cutoff: 3600, level: 0.75, damp: 0.0, tune: 0, drift: 1 } },
    ghost: { kind: 'bowl' },
    ticks: { bell: 0.8, pluck: 0.2, density: 0.35 },
    texture: { patch: { kind: 'wind', level: 0.36, tone: 0.3, motion: 0.5, fade: 5 }, covers: { moor: { level: 0.3, tone: 0.28 }, bog: { level: 0.34, tone: 0.06 }, shallow: { level: 0.5 }, rock: { kind: 'wind', level: 0.32, tone: 0.32 } } },
    kit: {
      patch: { level: 0.75, humanize: 0.06, kickFreq: null, kickDecay: 1.2, kickClick: 0.05, kickSweep: 1.8, snareFreq: 160, snareNoise: 0.35, snareDecay: 0.35, hatBright: 0.7, hatDecay: 0.1, hatOpenDecay: 0.8, crashDecay: 9, crashBright: 0.7, rideDecay: 4.2, tomDecay: 0.9, timpDecay: 6.5, gongDecay: 14, grainCount: 7, swellLength: 4.8, breathLength: 4.0 },
      favour: MIX({ shaker: 0.2, click: 0.7, rim: 0.2, kick: 0.25, snare: 0.05, clap: 0.05, hatC: 0.1, hatO: 0.05, ride: 0.3, tomL: 0.5, tomM: 0.2, tomH: 0.2, snap: 0.3, grainBurst: 0.9, metal: 0.4, breath: 2.0 }),
      crash: { phrase: 0.2, ride: false, swellFill: 1, gong: 0.7, timp: 0.35 },
    },
    fx: {
      reverb: { min: 6, max: 16, wet: 1.05, damp: [4200, 9800], pre: [0.08, 0.12] },
      delay: { beats: 3, fb: [0.4, 0.82], tone: [1800, 4200], wet: 0.4, mod: [0.1, 0.45], pingPong: true, spread: [1, 1.33] },
      granular: { density: 4.5, size: 0.8, pitch: -12, pitchSpread: 2, spray: 5, reverse: 0.4, mix: 0.9, feedback: 0.38 },
      master: { drive: [0.0, 0.08], lowCut: [26, 44], highCut: [8800, 15500], gain: 1, dark: 0.28 },
    },
    ch: { bell: { reverb: 0.85, delay: 0.7 }, lead: { delay: 0.75, reverb: 0.6 }, ghost: { reverb: 0.95, delay: 0.75 }, pad: { reverb: 0.7 }, drone: { drive: 0.0, chorus: 0.12 } },
    glitch: 0,
  }),

  // ============================================================================ VIII. Ben Nevis
  nevis: mk({
    id: 'nevis', loud: 1, title: 'Homecoming. Every fragment, full tutti.',
    root: 50, modeName: 'ionian', mode: M.ionian, dawn: M.lydian, night: M.mixolydian,
    bpm: 70, swing: 0.06, phraseBars: 4, nightTempo: 0.93,
    motifOp: 'identity',
    chords: [
      { d: 0, steps: [0, 2, 4], w: 5, name: 'I' }, { d: 3, steps: [0, 2, 4], w: 3, name: 'IV' },
      { d: 4, steps: [0, 2, 4], w: 1.6, name: 'V' }, { d: 5, steps: [0, 2, 4], w: 2.2, name: 'vi' },
      { d: 1, steps: [0, 2, 4], w: 0.8, name: 'ii' }, { d: 0, steps: [0, 2, 4, 6], w: 2.4, name: 'Imaj7', spread: 1 },
      { d: 3, steps: [0, 2, 4, 8], w: 1.4, name: 'IVadd9', spread: 1 }, { d: 0, steps: [0, 1, 4], w: 1.6, name: 'Isus2' },
    ],
    lead: { base: 62, span: 9, octaves: 2, pan: 0.5, hold: 1.8,
      patch: { wave1: 'sawtooth', wave2: 'triangle', detune: 6, saw: 0.46, tri: 0.55, sub: 0.28, tune: 0, glide: 0.1, vibRate: 5.4, vibDepth: 14, vibDelay: 0.45, vibRamp: 0.7, scoop: 20, drift: 3, cutoff: 2600, envAmt: 1.6, filterAttack: 0.12, filterDecay: 0.75, filterSustain: 0.4, resonance: 4.5, keytrack: 0.55, attack: 0.055, decay: 0.38, sustain: 0.86, release: 0.8, level: 0.6 } },
    drone: { low: -12, cut: [500, 2000], patch: { voices: 6, wave: 'sawtooth', spread: 12, detuneLfo: 8, lfoRate: 0.065, cutoff: 760, cutoffLfo: 0.5, resonance: 2.5, level: 0.18, sub: 0.5, stereo: 0.95, tune: 0, fadeIn: 5, release: 6 } },
    pad: { center: 62, cut: [700, 3000], patch: { saws: 3, detune: 14, triMix: 0.6, attack: 1.8, decay: 2.5, sustain: 0.78, release: 4, cutoff: 1050, envAmt: 2.0, resonance: 1.8, keytrack: 0.4, lfoRate: 0.11, lfoDepth: 0.26, tune: 2, width: 0.82, level: 0.18 } },
    bass: { style: 'pulse', octave: -24, patch: { sub: 0.9, saw: 0.55, tri: 0.25, cutoff: 380, envAmt: 2.0, filterDecay: 0.35, resonance: 5, attack: 0.012, decay: 0.4, sustain: 0.7, release: 0.28, tune: 1, glide: 0.07, drive: 0.35, level: 0.19 } },
    bell: { kind: 'glass', patch: { kind: 'glass', indexDecay: 0.45, attack: 0.002, tune: 0, level: 0.32, brightness: 1.0, dampDur: 0 } },
    pluck: { patch: { kind: 'harp', cutoff: 7000, level: 0.85, damp: 0.2, tune: 0, drift: 3 } },
    ghost: { kind: 'bowl' },
    ticks: { bell: 0.5, pluck: 0.5, density: 0.7 },
    texture: { patch: { kind: 'wind', level: 0.5, tone: 0.5, motion: 1.0, fade: 2.5 }, covers: {} },
    kit: {
      patch: { level: 1.0, humanize: 0.025, kickFreq: null, kickDecay: 0.55, kickClick: 0.35, kickSweep: 2.9, snareFreq: 188, snareNoise: 0.8, snareDecay: 0.2, hatBright: 1.0, hatDecay: 0.05, hatOpenDecay: 0.42, crashDecay: 4.8, crashBright: 1.0, rideDecay: 2.5, tomDecay: 0.45, timpDecay: 3.6, gongDecay: 9, grainCount: 14, swellLength: 2.8, breathLength: 2.0 },
      favour: MIX({ shaker: 0.8, click: 0.8, rim: 0.9, kick: 1.0, snare: 0.9, clap: 0.8, hatC: 0.9, hatO: 0.8, ride: 1.0, tomL: 1.0, tomM: 1.0, tomH: 1.0, snap: 0.8, grainBurst: 0.9, metal: 0.8, breath: 1.0 }),
      crash: { phrase: 0.85, ride: true, swellFill: 2, gong: 0.35, timp: 0.35 },
    },
    fx: {
      reverb: { min: 3, max: 14, wet: 0.95, damp: [3600, 8800], pre: [0.03, 0.06] },
      delay: { beats: 0.75, fb: [0.32, 0.7], tone: [2400, 6000], wet: 0.55, mod: [0.12, 0.34], pingPong: true, spread: [1, 1.5] },
      granular: { density: 16, size: 0.2, pitch: 12, pitchSpread: 7, spray: 2.2, reverse: 0.25, mix: 0.75, feedback: 0.3 },
      master: { drive: [0.04, 0.24], lowCut: [26, 46], highCut: [10000, 17500], gain: 1, dark: 0.5 },
    },
    ch: { pad: { gain: 0.3 }, lead: { gain: 0.88 }, ghost: { gain: 0.28 }, kcym: { reverb: 0.55 } },
    glitch: 0,
  }),
};

// kit patches derive the tonal frequencies from the tonic so drums sit in the key
for (const p of Object.values(PROFILES)) {
  const kp = p.kit.patch;
  if (kp.kickFreq === null || kp.kickFreq === undefined) kp.kickFreq = fold(p.root, 40, 66);
  kp.timpFreq = fold(p.root, 55, 110);
  kp.gongFreq = fold(p.root, 75, 150);
  kp.metalFreq = fold(p.root + 12, 200, 420) * (p.id === 'cuillin' ? 1.19 : 1);
}

// ------------------------------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------------------------------
export function getProfile(id) {
  const p = PROFILES[id];
  if (!p) throw new Error('no music profile for level: ' + id);
  return p;
}

/** Transformed contour motif of a level: {degrees, durations}. */
export function motifFor(profile) {
  const p = typeof profile === 'string' ? getProfile(profile) : profile;
  return transformMotif(CONTOUR_MOTIF, p.motifOp);
}

/** Resolved voice patches of a profile (defaults merged with level overrides). */
export function patchesFor(profile) {
  return {
    drone: resolve('drone', profile.drone.patch),
    pad: resolve('pad', profile.pad.patch),
    bass: resolve('bass', profile.bass.patch),
    lead: resolve('lead', profile.lead.patch),
    bell: resolve('bell', profile.bell.patch),
    pluck: resolve('pluck', profile.pluck.patch),
    texture: resolve('texture', profile.texture.patch),
    kit: resolve('kit', profile.kit.patch),
  };
}

/** Channel baseline for a profile: CH_BASE with the level's overrides. */
export function channelBase(profile) {
  const out = {};
  for (const name of CHANNEL_NAMES) out[name] = { ...CH_BASE[name], ...(profile.ch && profile.ch[name]) };
  return out;
}

/** Texture settings per cover key for a profile. */
export function textureFor(profile, coverKey) {
  const base = TEXTURE_COVERS[coverKey] || TEXTURE_COVERS.moor;
  const lv = profile.texture.covers && profile.texture.covers[coverKey];
  const gen = profile.texture.patch;
  // moor defaults come from the level's own texture patch
  const own = coverKey === 'moor' ? { kind: gen.kind, level: gen.level, tone: gen.tone } : {};
  return { ...base, ...own, ...(lv || {}) };
}

/** Kit generator list for a profile: KIT_STD with the level's `over` replacements and `favour` scaling applied. */
export function kitGens(profile) {
  const over = profile.kit.over || {};
  const list = KIT_STD.concat(profile.kit.extra || []);
  return list.map((g) => {
    const o = over[g.id || g.h] || {};
    const out = { ...g };
    if (o.vel) out.vel = o.vel;
    for (const s of ['ebb', 'flow', 'swell']) {
      if (o[s]) out[s] = { ...(g[s] || {}), ...o[s] };
      else if (g[s]) out[s] = { ...g[s] };
    }
    out.favour = (profile.kit.favour[g.id || g.h] ?? profile.kit.favour[g.h] ?? 1);
    return out;
  });
}

/** Pitch classes of the tonic triad (root, third, fifth taken from the mode's own intervals) for verification. */
export function tonicTriadPcs(profile) {
  const m = profile.mode;
  const third = m.includes(3) ? 3 : 4;
  const fifth = m.includes(7) ? 7 : m.includes(6) ? 6 : 8;
  return [0, third, fifth].map((iv) => (((profile.root + iv) % 12) + 12) % 12);
}
