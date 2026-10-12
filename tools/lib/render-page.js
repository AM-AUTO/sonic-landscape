// Runs inside the browser: renders the demo and solo clips with OfflineAudioContext and reports stats.
import { createEngine } from '../../src/audio/engine.js';
import { Scope } from '../../src/audio/fx/util.js';
import { createRig } from './rig.js';
import { clips, scheduleDemo } from './demo.js';
import { analyse, perSecond } from './wav.mjs';

const SR = 44100;

async function makeCtx(seconds) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
  const engine = await createEngine(ctx, { seed: 20241 });
  return { ctx, engine, rig: createRig(engine) };
}

function b64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

window.renderDemo = async function renderDemo(opts = {}) {
  const noop = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : noop), apply: () => noop });
  const dummy = scheduleDemo(noop, 0.2);   // dry run: only to learn the duration
  const { ctx, engine, rig } = await makeCtx(dummy.duration + 1);
  const demo = scheduleDemo(rig, 0.2);
  // drive the engine the way the conductor will: schedule each section when the context reaches it
  const lead = 0.05, quantum = 128 / SR;
  const used = new Set();
  for (const seg of demo.segments) {
    let at = Math.max(0, Math.floor((seg.t0 - lead) / quantum) * quantum);
    while (used.has(at.toFixed(5))) at += quantum;
    used.add(at.toFixed(5));
    ctx.suspend(at).then(() => { seg.run(); ctx.resume(); });
  }
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  const channels = [buf.getChannelData(0), buf.getChannelData(1)];
  const segments = demo.segments.filter((s) => s.kind !== 'action').map(({ run, ...s }) => ({ ...s, ...analyse(channels, SR, s.t0, s.t1, { centroid: true }) }));
  const total = analyse(channels, SR, 0, buf.duration);
  const tutti = analyse(channels, SR, demo.tuttiStart + 0.5, demo.tuttiStart + 9.5);
  if (opts.upload) {
    // send both channels interleaved as float32 to the server
    const inter = new Float32Array(channels[0].length * 2);
    for (let i = 0; i < channels[0].length; i++) { inter[2 * i] = channels[0][i]; inter[2 * i + 1] = channels[1][i]; }
    await fetch('/__upload/voices.f32', { method: 'POST', body: inter.buffer });
  }
  return {
    sampleRate: SR, duration: buf.duration, renderMs, segments, total, tutti,
    audit: engine.auditReport(), liveScopes: Scope.live, perSecond: perSecond(channels, SR),
  };
};

window.renderSolo = async function renderSolo(name) {
  const c = clips[name];
  const { ctx, engine, rig } = await makeCtx(c.dur + 1.5);
  c.play(rig, 0.1);
  const buf = await ctx.startRendering();
  const channels = [buf.getChannelData(0), buf.getChannelData(1)];
  return { name, kind: c.kind, ...analyse(channels, SR, 0, buf.duration, { centroid: true }), liveScopes: Scope.live, audit: engine.auditReport() };
};

window.soloNames = () => Object.keys(clips);
window.__ready = true;
document.getElementById('log').textContent = 'ready';

// ---------------------------------------------------------------------------------------------
// Patch fuzz: every numeric patch parameter of every voice is played at 0.5x and 1.6x its default in
// one long offline render. Verifies no exceptions / NaN / clipping on any parameter path, and exercises the audit.
import { Drone, DRONE_DEFAULTS } from '../../src/audio/voices/drone.js';
import { Pad, PAD_DEFAULTS } from '../../src/audio/voices/pad.js';
import { Bass, BASS_DEFAULTS } from '../../src/audio/voices/bass.js';
import { Lead, LEAD_DEFAULTS } from '../../src/audio/voices/lead.js';
import { Bell, BELL_DEFAULTS } from '../../src/audio/voices/bell.js';
import { Pluck, PLUCK_DEFAULTS } from '../../src/audio/voices/pluck.js';
import { Texture, TEXTURE_DEFAULTS, TEXTURE_KINDS } from '../../src/audio/voices/texture.js';
import { Kit, KIT_DEFAULTS } from '../../src/audio/voices/kit.js';

window.renderFuzz = async function renderFuzz() {
  const fakeLen = 230;
  const ctx = new OfflineAudioContext(2, SR * fakeLen, SR);
  const engine = await createEngine(ctx, { seed: 77 });
  const ch = {
    a: engine.channel('fz.a', { gain: 0.8, reverb: 0.3, delay: 0.2, grain: 0.1 }),
    k1: engine.channel('fz.k1', {}), k2: engine.channel('fz.k2', {}), k3: engine.channel('fz.k3', {}),
  };
  const steps = [];
  const errors = [];
  const nums = (def, skip = []) => Object.keys(def).filter((k) => typeof def[k] === 'number' && !skip.includes(k));
  const vals = (def, k) => (def[k] === 0 ? [0.4, 1] : [def[k] * 0.5, def[k] * 1.6]);
  const add = (name, run) => steps.push({ name, run });

  for (const k of nums(DRONE_DEFAULTS, ['voices'])) for (const v of vals(DRONE_DEFAULTS, k)) add(`drone.${k}=${v}`, (t) => {
    const d = new Drone(engine, ch.a, { ...DRONE_DEFAULTS, fadeIn: 0.2, release: 0.3, [k]: v });
    d.start(t); d.setChord([38, 45, 50], t); d.setChord([40, 47, 52], t + 0.2, 0.2); d.set({ cutoff: 900, level: 0.1 }, t + 0.25); d.stop(t + 0.35);
  });
  for (const v of [4, 6]) add(`drone.voices=${v}`, (t) => { const d = new Drone(engine, ch.a, { voices: v, fadeIn: 0.1, release: 0.2 }); d.start(t); d.stop(t + 0.3); });
  const padBase = { attack: 0.08, decay: 0.2, release: 0.25 };
  const pad = new Pad(engine, ch.a, padBase);
  for (const k of nums(PAD_DEFAULTS)) for (const v of vals({ ...PAD_DEFAULTS, ...padBase }, k)) add(`pad.${k}=${v}`, (t) => {
    pad.set({ ...PAD_DEFAULTS, ...padBase, [k]: v }); pad.chord([50, 57, 62], t, 0.3, 0.8);
  });
  const bass = new Bass(engine, ch.a);
  for (const k of nums(BASS_DEFAULTS)) for (const v of vals(BASS_DEFAULTS, k)) add(`bass.${k}=${v}`, (t) => {
    bass.set({ ...BASS_DEFAULTS, [k]: v }); bass.note(38, t, 0.2, 0.8); bass.note(43, t + 0.22, 0.15, 0.5); bass.glideTo(40, t + 0.3);
  });
  const lead = new Lead(engine, ch.a);
  for (const k of nums(LEAD_DEFAULTS)) for (const v of vals(LEAD_DEFAULTS, k)) add(`lead.${k}=${v}`, (t) => {
    lead.set({ ...LEAD_DEFAULTS, [k]: v }); lead.note(69, t, 0.25, 0.8); lead.note(74, t + 0.26, 0.2, 0.6);
  });
  const bell = new Bell(engine, ch.a);
  for (const k of nums(BELL_DEFAULTS)) for (const v of vals(BELL_DEFAULTS, k)) add(`bell.${k}=${v}`, (t) => { bell.set({ ...BELL_DEFAULTS, [k]: v }); bell.note(84, t, 0.3, 0.8); });
  for (const [k, vs] of [['ratio', [1.41, 6.2]], ['index', [0.8, 7]], ['indexEnd', [0, 2]], ['decay', [1, 9]], ['beat', [0.5, 3]]]) for (const v of vs) add(`bell.${k}=${v}`, (t) => { bell.set({ ...BELL_DEFAULTS, [k]: v }); bell.note(79, t, 0.3, 0.8); });
  for (const kind of ['glass', 'bowl', 'tine']) add(`bell.kind=${kind}`, (t) => { bell.set({ ...BELL_DEFAULTS, kind }); bell.note(72, t, 0.3, 1.0); });
  const pluck = new Pluck(engine, ch.a);
  for (const k of nums(PLUCK_DEFAULTS)) for (const v of vals(PLUCK_DEFAULTS, k)) add(`pluck.${k}=${v}`, (t) => { pluck.set({ ...PLUCK_DEFAULTS, [k]: v }); pluck.note(67, t, 0.3, 0.8); });
  for (const [k, vs] of [['damping', [0.05, 0.9]], ['decay', [0.5, 9]], ['pos', [0.05, 0.8]], ['bright', [0, 1]]]) for (const v of vs) add(`pluck.${k}=${v}`, (t) => { pluck.set({ ...PLUCK_DEFAULTS, [k]: v }); pluck.note(60, t, 0.3, 0.8); });
  for (const kind of ['string', 'harp', 'kalimba']) for (const m of [36, 84]) add(`pluck.${kind}@${m}`, (t) => { pluck.set({ ...PLUCK_DEFAULTS, kind }); pluck.note(m, t, 0.3, 0.9); });
  for (const kind of TEXTURE_KINDS) for (const m of [0.4, 2.5]) add(`texture.${kind} motion=${m}`, (t) => {
    const tx = new Texture(engine, ch.a, { ...TEXTURE_DEFAULTS, kind, motion: m, fade: 0.1 });
    tx.start(t); tx.set({ tone: 0.1, level: 0.9 }, t + 0.1); tx.set({ tone: 0.9, level: 0.3 }, t + 0.25); tx.stop(t + 0.4);
  });
  add('texture.kind-switch', (t) => {
    const tx = new Texture(engine, ch.a, { fade: 0.15 }); tx.start(t);
    TEXTURE_KINDS.forEach((kind, i) => tx.set({ kind }, t + 0.1 * (i + 1))); tx.stop(t + 0.7);
  });
  const hitMap = { kickFreq: 'kick', kickDecay: 'kick', kickClick: 'kick', kickSweep: 'kick', level: 'snare', humanize: 'kick', snareFreq: 'snare', snareNoise: 'snare', snareDecay: 'snare',
    hatBright: 'hatC', hatDecay: 'hatC', hatOpenDecay: 'hatO', crashDecay: 'crash', crashBright: 'crash', rideDecay: 'ride', tomDecay: 'tomL', timpFreq: 'timp', timpDecay: 'timp',
    gongFreq: 'gong', gongDecay: 'gong', metalFreq: 'metal', grainCount: 'grainBurst', swellLength: 'reverseSwell', breathLength: 'breath' };
  for (const k of nums(KIT_DEFAULTS)) for (const v of vals(KIT_DEFAULTS, k)) add(`kit.${k}=${v}`, (t) => {
    const kit = new Kit(engine, { main: ch.k1, cymbals: ch.k2, textural: ch.k3 }, { ...KIT_DEFAULTS, [k]: v });
    kit.hit(hitMap[k] || 'kick', t, 0.8, k === 'swellLength' || k === 'breathLength' ? {} : { pan: 0.3 }); kit.dispose();
  });
  // every kit hit with every opt (pitch, decay, tone, pan, length, midi) at both extremes
  const kitAll = new Kit(engine, { main: ch.k1, cymbals: ch.k2, textural: ch.k3 });
  for (const name of KIT_NAMES_LOCAL()) for (const o of [{ pitch: 0.6, decay: 0.15, tone: 0, pan: -1, length: 0.3 }, { pitch: 1.7, decay: 1.2, tone: 1, pan: 1, length: 1.2, midi: 55 }]) add(`kit.${name} ${JSON.stringify(o)}`, (t) => kitAll.hit(name, t, 1.0, o));
  // single-channel kit form
  add('kit.single-channel', (t) => { const k = new Kit(engine, ch.a); k.hit('kick', t, 0.8); k.hit('hatC', t + 0.2, 0.8); k.dispose(); });
  // hostile input
  add('hostile-input', (t) => {
    try {
      pad.set(PAD_DEFAULTS); pad.chord([NaN, 60, Infinity], t, NaN, NaN); bell.note(NaN, t, NaN, NaN); lead.note(undefined, t, -1, 99);
      bass.note(1e9, t, 0, 0); pluck.note(-100, t, 0, -5); kitAll.hit('kick', NaN, NaN, { pitch: NaN, decay: Infinity, pan: NaN }); kitAll.hit('nope', t, 1);
      engine.fx.reverb.setSize(NaN); engine.fx.reverb.setSize(1000); engine.fx.reverb.setSize(-5); engine.fx.delay.setFeedback(5); engine.fx.delay.setTime(NaN);
      engine.fx.granular.set({ density: 1e6, size: -1, pitch: NaN }); ch.a.set({ gain: NaN, pan: 9, cutoff: -5, resonance: 1e9, drive: 5, crush: 9, chorus: -3 });
      engine.fx.master.duck(NaN, NaN, NaN, NaN); engine.fx.master.setLowCut(NaN);
    } catch (e) { errors.push('hostile: ' + e.message); }
  });
  function KIT_NAMES_LOCAL() { return ['kick', 'snare', 'rim', 'clap', 'hatC', 'hatO', 'ride', 'crash', 'tomL', 'tomM', 'tomH', 'timp', 'gong', 'click', 'snap', 'grainBurst', 'breath', 'reverseSwell', 'metal', 'shaker']; }

  const quantum = 128 / SR, STEP = 0.45;
  let end = 0.2;
  steps.forEach((s, i) => {
    const t0 = 0.2 + i * STEP;
    end = t0 + STEP;
    ctx.suspend(Math.floor((t0 - 0.05) / quantum) * quantum).then(() => {
      try { s.run(t0); } catch (e) { errors.push(`${s.name}: ${e && e.message}`); }
      ctx.resume();
    });
  });
  if (end + 7 > fakeLen) errors.push(`fuzz needs ${end + 7} s but the context is ${fakeLen} s`);
  const buf = await ctx.startRendering();
  const channels = [buf.getChannelData(0), buf.getChannelData(1)];
  const a = analyse(channels, SR, 0, end + 6);
  return { steps: steps.length, duration: end, errors, peakDb: a.peakDb, rmsDb: a.rmsDb, nan: a.nan, audit: engine.auditReport(), liveScopes: Scope.live };
};
