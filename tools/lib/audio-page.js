// Runs inside headless Chromium: plays a whole level (autopilot walking the gate chain, one deliberate wrong
// approach, a 20 s standing-still Drift coda) through the real score into an OfflineAudioContext (44.1 kHz stereo),
// stepping audio.update() every 50 ms of audio time with ctx.suspend(t), then analyses the result.
import { createAudio, withEvents } from '../../src/audio/index.js';
import { Scope } from '../../src/audio/fx/util.js';
import { Kit } from '../../src/audio/voices/kit.js';
import { Pad } from '../../src/audio/voices/pad.js';
import { Bell } from '../../src/audio/voices/bell.js';
import { Pluck } from '../../src/audio/voices/pluck.js';
import { Lead } from '../../src/audio/voices/lead.js';
import { Bass } from '../../src/audio/voices/bass.js';
import { Game } from '../../src/game/sim.js';
import { Autopilot, planChainRoute } from '../../src/game/autopilot.js';
import { LEVELS } from '../../src/world/levels/index.js';
import { PROFILES, tonicTriadPcs } from '../../src/audio/levelmusic.js';
import { analyse, fft, spectralCentroid } from './wav.mjs';

const SR = 44100;
const UPDATE = 0.05;
const DT = 1 / 60;
const CODA = 20;
const TAIL = 5;

// ---- node creation counter (per-note graphs go through Scope)
let nodeCount = 0;
let nodeStart = 0;
for (const m of ['add', 'track']) {
  const orig = Scope.prototype[m];
  Scope.prototype[m] = function (...a) { nodeCount++; return orig.apply(this, a); };
}
const origBuf = Scope.prototype.buf;
Scope.prototype.buf = function (...a) { nodeCount++; return origBuf.apply(this, a); };

// attribute node creation to the voice that made it (Kit.hit, Pad.chord, …) for the per-second budget report
const nodesBy = {};
function attribute(cls, names, label) {
  for (const n of names) {
    const orig = cls.prototype[n];
    if (typeof orig !== 'function') continue;
    cls.prototype[n] = function (...a) {
      const before = nodeCount;
      const r = orig.apply(this, a);
      const key = label + '.' + n + (label === 'kit' ? ':' + a[0] : '');
      nodesBy[key] = (nodesBy[key] || 0) + (nodeCount - before);
      return r;
    };
  }
}
attribute(Kit, ['hit'], 'kit'); attribute(Pad, ['chord'], 'pad'); attribute(Bell, ['note'], 'bell'); attribute(Pluck, ['note'], 'pluck');
attribute(Lead, ['note'], 'lead'); attribute(Bass, ['note'], 'bass');

const snap = (s) => ({
  ...s,
  player: { ...s.player },
  proximity: s.proximity.map((x) => ({ poi: x.poi, dist: x.dist })),
  resonance: s.resonance.map((r) => ({ ...r })),
  chainProgress: s.chainProgress.map((c) => ({ ...c })),
  fragments: s.fragments.slice(), discovered: s.discovered.slice(), events: [],
});

/** a deliberately wrong approach to a non-chain POI with an arrival condition (so a partial is heard) */
function wrongVisit(world, level, planned) {
  const chain = new Set((world.gate && world.gate.chain) || []);
  const used = new Set(planned.filter((w) => w.poiId).map((w) => w.poiId));
  const sp = { x: world.spawn.x, y: world.spawn.y };
  let best = null;
  for (const p of world.pois) {
    if (used.has(p.id)) continue;
    const c = p.condition || {};
    const hard = c.speed === 'slow' || c.dwell > 0 || c.climb > 0 || c.approach === 'descending' || c.approach === 'ascending' || c.requires;
    if (!hard) continue;
    const d = Math.hypot(p.x - sp.x, p.y - sp.y) + (chain.has(p.type) ? 40 : 0);
    if (!best || d < best.d) best = { p, d };
  }
  if (!best || best.d > 140) return [];
  return [{ x: Math.floor(best.p.x) + 0.5, y: Math.floor(best.p.y) + 0.5, mode: 'run', poiId: 'wrong-' + best.p.id, note: 'wrong approach' }];
}

function presim(idx, opts) {
  const progress = { unlocked: LEVELS.slice(0, idx + 1).map((l) => l.id), completed: LEVELS.slice(0, idx).map((l) => l.id), fragments: LEVELS.slice(0, idx).map((l) => l.id), notes: [] };
  const game = new Game({ levels: LEVELS, progress });
  game.loadLevel(idx);
  const plan = planChainRoute(game.world, game.level);
  const wv = opts.noWrong || opts.idle ? [] : wrongVisit(game.world, game.level, plan);
  const wps = [...wv, ...plan];
  if (opts.stroll) for (const w of wps) if (w.mode === 'run') w.mode = 'walk';          // diagnostic: a walker's pace
  const ap = new Autopilot(game.world, wps);
  const buckets = [snap(game.state)];
  let ev = [];
  let t = 0, nb = 1, codaT = null, completeT = null;
  const cap = opts.seconds || 190;
  while (t < cap) {
    const inp = codaT === null && !opts.idle ? ap.input(game.state) : { x: 0, y: 0, run: false, rest: false };
    game.step(inp, DT); t += DT;
    ev.push(...game.state.events);
    if (t >= nb * UPDATE - 1e-9) { const s = snap(game.state); s.events = ev; ev = []; buckets.push(s); nb++; }
    if (opts.idle && t >= opts.idle) break;
    if (codaT === null && game.state.levelComplete) { codaT = t; completeT = t; }
    if (codaT !== null && t >= codaT + CODA) break;
    if (codaT === null && ap.done && t > 20 && !game.state.levelComplete && t > cap - 1) break;
  }
  return { game, buckets, wps, wrong: wv.length ? wv[0].poiId : null, simSeconds: t, completeT, warnings: plan.warnings || [] };
}

function chroma(ch, sr) {
  const N = 16384, re = new Float64Array(N), im = new Float64Array(N), acc = new Float64Array(12);
  const hop = Math.floor(sr * 0.5);
  for (let s = 0; s + N <= ch.length; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = ch[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const f = (k * sr) / N;
      if (f < 55 || f > 4200) continue;
      const m = Math.hypot(re[k], im[k]);
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      // weight by closeness to the semitone centre so out-of-tune partials don't smear
      const dev = Math.abs(midi - Math.round(midi));
      acc[pc] += m * m * (1 - dev * 1.2 > 0 ? 1 - dev * 1.2 : 0);
    }
  }
  let sum = 0; for (let i = 0; i < 12; i++) sum += acc[i];
  return Array.from(acc, (v) => (sum ? v / sum : 0));
}

window.renderLevel = async function renderLevel(id, opts = {}) {
  const idx = LEVELS.findIndex((l) => l.id === id);
  if (idx < 0) throw new Error('unknown level ' + id);
  const errors = [];
  nodeStart = nodeCount;
  for (const k of Object.keys(nodesBy)) delete nodesBy[k];
  const ps = presim(idx, opts);
  const { game, buckets } = ps;
  const lastBucket = buckets.length - 1;
  const duration = lastBucket * UPDATE + TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
  const audio = await createAudio(ctx, { seed: game.level.seed });
  audio.setLevel(game.level);
  if (opts.mute && opts.mute.length) audio.score.mute = new Set(opts.mute);
  const quantum = 128 / SR;
  const afterRender = () => { for (const e of audio.errors) errors.push('audio.update: ' + e); };
  const perSecNodes = [];
  const nodeMedian = () => { const a = perSecNodes.slice().sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  let lastNodes = nodeCount, lastSecT = 0;
  let k = 0;
  const upd = { n: 0, sum: 0, max: 0, slow: [] };
  const step = () => {
    const u0 = performance.now();
    try {
      audio.update(buckets[k]);
    } catch (e) { errors.push(`update ${k}: ${e && e.stack ? e.stack : e}`); }
    const du = performance.now() - u0; upd.n++; upd.sum += du; if (du > upd.max) upd.max = du;
    if (du > 25) upd.slow.push([+(k * UPDATE).toFixed(2), Math.round(du), buckets[k].events.map((e) => e.type).filter((x) => x !== 'step' && x !== 'cover').join('+')]);
    const t = k * UPDATE;
    if (t - lastSecT >= 1) { perSecNodes.push(nodeCount - lastNodes); lastNodes = nodeCount; lastSecT = t; }
  };
  step();                                   // t = 0 before rendering starts
  const t0 = performance.now();
  const schedule = () => {
    k++;
    if (k > lastBucket) return;
    const at = Math.max(ctx.currentTime + quantum, Math.round((k * UPDATE) / quantum) * quantum);
    ctx.suspend(at).then(() => { step(); schedule(); ctx.resume(); }).catch((e) => errors.push('suspend: ' + e));
  };
  schedule();
  const buf = await ctx.startRendering();
  const renderMs = performance.now() - t0;
  afterRender();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const channels = [L, R];

  // ---- analysis
  const total = analyse(channels, SR, 0, buf.duration);
  const perSec = [];
  for (let s = 0; s < Math.floor(buf.duration); s++) perSec.push(+analyse(channels, SR, s, s + 1).rmsDb.toFixed(2));
  // silent 100 ms windows
  const w100 = Math.floor(0.1 * SR);
  let silent = 0, wins = 0;
  for (let i = 0; i + w100 <= L.length; i += w100) {
    let e = 0; for (let j = i; j < i + w100; j++) e += L[j] * L[j] + R[j] * R[j];
    if (10 * Math.log10(e / (2 * w100) + 1e-20) < -60) silent++;
    wins++;
  }
  const mono = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) mono[i] = 0.5 * (L[i] + R[i]);
  const centroidMean = spectralCentroid(mono, SR, 0, mono.length);
  const ch = chroma(mono, SR);
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  let top = 0; for (let i = 1; i < 12; i++) if (ch[i] > ch[top]) top = i;
  const prof = PROFILES[id];
  const triad = tonicTriadPcs(prof);
  // dynamics: spread of the per-second RMS curve (ignoring the 3 s fade-in and the final tail)
  const mid = perSec.slice(3, Math.max(4, perSec.length - TAIL)).filter((v) => v > -80).sort((a, b) => a - b);
  const q = (p) => mid[Math.min(mid.length - 1, Math.floor(p * mid.length))];
  const dyn = mid.length ? q(0.95) - q(0.05) : 0;

  // artefact consequence: 6 s after vs 6 s before each full POI event
  const arts = [];
  for (let b = 0; b < buckets.length; b++) {
    for (const ev of buckets[b].events) {
      if (ev.type !== 'poi') continue;
      const t = b * UPDATE;
      const a0 = Math.max(0, t - 6), a1 = t, b0 = t + 0.05, b1 = Math.min(buf.duration, t + 6.05);
      const before = analyse(channels, SR, a0, a1), after = analyse(channels, SR, b0, b1);
      const cb = a1 - a0 > 1 ? spectralCentroid(mono, SR, Math.floor(a0 * SR), Math.floor(a1 * SR)) : 0;
      const ca = spectralCentroid(mono, SR, Math.floor(b0 * SR), Math.floor(b1 * SR));
      const dRms = after.rmsDb - before.rmsDb;
      const dCent = cb > 0 ? (ca - cb) / cb : 1;
      arts.push({ t: +t.toFixed(2), type: ev.poi.type, id: ev.poi.id, full: ev.full, beforeSec: +(a1 - a0).toFixed(1), rmsBefore: +before.rmsDb.toFixed(2), rmsAfter: +after.rmsDb.toFixed(2), dRmsDb: +dRms.toFixed(2), centroidBefore: Math.round(cb), centroidAfter: Math.round(ca), dCentroidPct: +(dCent * 100).toFixed(1), pass: !ev.full || dRms >= 2 || Math.abs(dCent) >= 0.15 });
    }
  }

  const gameEvents = {};
  for (const b of buckets) for (const e of b.events) gameEvents[e.type] = (gameEvents[e.type] || 0) + 1;
  const ins = audio.inspect();
  const nodesMean = perSecNodes.length ? perSecNodes.reduce((a, c) => a + c, 0) / perSecNodes.length : 0;
  const audit = audio.audit();

  let upload = null;
  if (opts.upload) {
    const inter = new Float32Array(L.length * 2);
    for (let i = 0; i < L.length; i++) { inter[2 * i] = L[i]; inter[2 * i + 1] = R[i]; }
    await fetch('/__upload/audio/' + id + '.f32', { method: 'POST', body: inter.buffer });
    upload = true;
  }

  return {
    id, name: game.level.name, root: names[prof.root % 12], mode: prof.modeName, bpm: prof.bpm,
    duration: +buf.duration.toFixed(2), simSeconds: +ps.simSeconds.toFixed(2), completeAt: ps.completeT ? +ps.completeT.toFixed(2) : null,
    wrongApproach: ps.wrong, planWarnings: ps.warnings, renderMs: Math.round(renderMs),
    peakDb: +total.peakDb.toFixed(2), rmsDb: +total.rmsDb.toFixed(2), nan: total.nan, silentPct: +((100 * silent) / wins).toFixed(2),
    dynRangeDb: +dyn.toFixed(1), centroidMean: Math.round(centroidMean),
    rmsCurve: perSec,
    chroma: Array.from(ch, (v) => +v.toFixed(4)), chromaTop: names[top], rootTriad: triad.map((p) => names[p]), chromaInTriad: triad.includes(top),
    artefacts: arts, gameEvents,
    nodes: { perSecMean: +nodesMean.toFixed(1), perSecMedian: nodeMedian(), perSecMax: perSecNodes.length ? Math.max(...perSecNodes) : 0, total: nodeCount - nodeStart, by: Object.fromEntries(Object.entries(nodesBy).sort((a, b) => b[1] - a[1]).slice(0, 14)) },
    stats: ins.stats, timeline: ins.timeline.filter((e) => ['level', 'artefact', 'boost', 'partial', 'section', 'cadence', 'finale', 'concord', 'gate-open', 'level-complete', 'mode', 'ghost', 'quote', 'transition'].includes(e.kind)).slice(0, 400),
    updateMs: { mean: +(upd.sum / Math.max(1, upd.n)).toFixed(2), max: +upd.max.toFixed(1), calls: upd.n, slow: upd.slow.slice(0, 24) },
    audit, errors, uploaded: upload,
  };
};

/**
 * Level-switch check: play the first seconds of level A, then hand the same audio engine the first seconds of level B
 * (as main.js does when the player moves on). The bed must crossfade — no NaN, no silent gap, no exception.
 */
window.renderSwitch = async function renderSwitch(idA, idB, secs = 14) {
  const errors = [];
  const a = LEVELS.findIndex((l) => l.id === idA), b = LEVELS.findIndex((l) => l.id === idB);
  const A = presim(a, { seconds: secs, noWrong: true }), B = presim(b, { seconds: secs, noWrong: true });
  const total = 2 * secs + 6;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  const audio = await createAudio(ctx, { seed: 4242 });
  const seq = [...A.buckets.slice(0, Math.floor(secs / UPDATE)), ...B.buckets.slice(0, Math.floor(secs / UPDATE))];
  const quantum = 128 / SR;
  let k = 0;
  const step = () => { try { audio.update(seq[k]); } catch (e) { errors.push(String(e && e.stack || e)); } };
  step();
  const schedule = () => {
    k++;
    if (k >= seq.length) return;
    const at = Math.max(ctx.currentTime + quantum, Math.round((k * UPDATE) / quantum) * quantum);
    ctx.suspend(at).then(() => { step(); schedule(); ctx.resume(); });
  };
  schedule();
  const buf = await ctx.startRendering();
  for (const e of audio.errors) errors.push(e);
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const around = [];
  for (let t = secs - 3; t < secs + 6; t += 1) around.push(+analyse(ch, SR, t, t + 1).rmsDb.toFixed(1));
  const all = analyse(ch, SR, 0, buf.duration);
  return { idA, idB, switchAt: secs, rmsAround: around, minAround: Math.min(...around), peakDb: all.peakDb, nan: all.nan, levelAfter: audio.score.levelId, errors };
};

window.__ready = true;
document.getElementById('log').textContent = 'ready';
