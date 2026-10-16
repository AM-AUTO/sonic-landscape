// The palette worklets (erode, resonators) as pure DSP cores, their engine wiring (fake Web Audio), and the render guardrails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createErodeState, erodeMessage, processErode, erodeStage } from '../src/audio/worklets/erode-core.js';
import { createResonatorState, resonatorMessage, processResonators, RES_MAX } from '../src/audio/worklets/resonators-core.js';
import { bandProfile, profileDistance, arcDb, crestDb, lowCorr, noiseShare, contraPeriods, decayTrend, guardrailReport } from '../tools/lib/guardrails.mjs';
import { installFakeAudio } from './helpers/fake-audio.js';
import { compressorMakeup } from '../src/audio/fx/util.js';

const SR = 44100, B = 128;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** run a core over a mono / stereo input in 128-sample blocks; returns [L, R] */
function run(proc, st, inL, inR, p, from = 0) {
  const n = inL.length, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i + B <= n; i += B) proc(st, inL.subarray(i, i + B), inR ? inR.subarray(i, i + B) : null, L.subarray(i, i + B), R.subarray(i, i + B), p, (from + i) / SR);
  return [L, R];
}

/** a played-sounding source: a decaying chord of partials plus a little noise, repeating every second */
function source(sec) {
  const x = new Float32Array(Math.floor(sec * SR));
  for (let i = 0; i < x.length; i++) {
    const t = (i % SR) / SR;
    x[i] = Math.exp(-t * 3) * (0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1320 * t) + 0.15 * Math.sin(2 * Math.PI * 3520 * t)) + (rnd() - 0.5) * 0.05;
  }
  return x;
}

const finite = (a) => a.every((v) => Number.isFinite(v));

test('erode: a captured fragment loops and wears pass by pass (band-spectrum distance from the fragment grows, age rises)', () => {
  const st = createErodeState(SR), passes = [];
  st.onPass = (pass, age, ms, hf) => passes.push({ pass, age, rms: Math.sqrt(ms), hf, cycle: st.cycle });
  erodeMessage(st, { record: 1, startAt: 0.1, passesToFull: 7 });
  const src = source(12);
  const [L] = run(processErode, st, src, null, { mix: 1, ageRate: 1, monitor: 0 });
  assert.ok(finite(L));
  const i0 = Math.ceil(0.1 * SR), ref = bandProfile(src.subarray(i0, i0 + SR), SR);
  const dist = [];
  for (let p = 0; p < 10; p++) { const a = i0 + SR * (p + 1); dist.push(profileDistance(bandProfile(L.subarray(a, a + SR), SR), ref)); }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(dist.at(-1) >= dist[0] + 1, 'last pass at least 1 dB further than the first: ' + dist.map((d) => d.toFixed(2)).join(' '));
  assert.ok(mean(dist.slice(5)) > mean(dist.slice(0, 5)) + 0.3, 'a trend');
  assert.ok(passes.length >= 9);
  for (let i = 1; i < passes.length; i++) assert.ok(passes[i].age >= passes[i - 1].age, 'age never falls');
  assert.equal(passes[0].age, 0); assert.equal(passes.at(-1).age, 1);
  assert.ok(passes[7].hf < passes[0].hf * 0.5, 'the closing filter takes the high band away');
  assert.equal(decayTrend(passes).ok, true);
  // ageRate 0 freezes the age
  const st2 = createErodeState(SR); const ages = [];
  st2.onPass = (p, age) => ages.push(age);
  erodeMessage(st2, { record: 0.5, passesToFull: 2 });
  run(processErode, st2, source(4), null, { mix: 1, ageRate: 0, monitor: 0 });
  assert.ok(ages.length >= 5 && ages.every((a) => a === 0));
});

test('erode: the capture starts on the exact sample of startAt, the loop seam is faded, reset fades the output out', () => {
  const st = createErodeState(SR);
  const n = SR * 3, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (i % 1000) / 1000;          // a ramp: each value says where it came from
  const startAt = 0.73;                                          // not on a block edge
  const k0 = Math.ceil(startAt * SR);
  erodeMessage(st, { record: 0.5, startAt });
  run(processErode, st, x, null, { mix: 1, ageRate: 1, monitor: 0 });
  assert.equal(st.mode, 2);
  assert.equal(st.n, Math.round(0.5 * SR));
  for (const j of [300, 1234, 9000]) assert.equal(st.bufL[j], x[k0 + j], 'sample ' + j);
  assert.equal(st.bufL[0], 0, 'faded in at the seam');
  assert.ok(Math.abs(st.bufL[st.n - 1]) < 1e-6, 'faded out at the seam');
  // nothing comes out before the capture ends (monitor 0), the loop does after
  const st2 = createErodeState(SR);
  erodeMessage(st2, { record: 0.5, startAt: 0.25 });
  const [L] = run(processErode, st2, source(2), null, { mix: 1, ageRate: 1, monitor: 0 });
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += L[i] * L[i]; return Math.sqrt(s / (b - a)); };
  assert.equal(rms(0, Math.floor(0.74 * SR)), 0);
  assert.ok(rms(Math.floor(0.8 * SR), Math.floor(1.2 * SR)) > 0.01);
  // reset at an audio time: silent soon after it
  const st3 = createErodeState(SR);
  erodeMessage(st3, { record: 0.3 });
  erodeMessage(st3, { reset: true, startAt: 1.0 });
  const [L3] = run(processErode, st3, source(1.5), null, { mix: 1, ageRate: 1, monitor: 0 });
  let after = 0; for (let i = Math.floor(1.05 * SR); i < Math.floor(1.4 * SR); i++) after = Math.max(after, Math.abs(L3[i]));
  let before = 0; for (let i = Math.floor(0.5 * SR); i < Math.floor(0.95 * SR); i++) before = Math.max(before, Math.abs(L3[i]));
  assert.ok(before > 0.01 && after < 1e-3, `before ${before} after ${after}`);
  // the stage table: more wear with age
  const a = erodeStage(0, SR), b = erodeStage(1, SR);
  assert.ok(a.bits > b.bits && a.fc > b.fc && a.hold < b.hold && a.dropP < b.dropP && a.loss > b.loss);
});

test('erode: no NaN or blow-up with extreme params and hostile input; the buffer never exceeds 20 s', () => {
  const st = createErodeState(SR, { maxSeconds: 1e9 });
  assert.ok(st.bufL.length <= 20 * SR);
  const hostile = [{ record: 1e9 }, { age: 99 }, { passesToFull: -5 }, { record: NaN }, { record: -1 }, { age: NaN }, { maxWow: 1e9 }, null, 'x', { startAt: NaN, record: 0.2 }];
  for (const m of hostile) erodeMessage(st, m);
  const x = source(3); x[100] = NaN; x[200] = Infinity; x[300] = 1e6;
  for (const p of [{ mix: NaN, ageRate: 1e9, monitor: 7 }, { mix: 1e9, ageRate: -3, monitor: NaN }]) {
    const [L, R] = run(processErode, st, x, x, p);
    assert.ok(finite(L) && finite(R));
  }
  const st2 = createErodeState(SR, { maxSeconds: undefined });
  assert.equal(st2.bufL.length, 20 * SR);
  erodeMessage(st2, { record: 0.2, age: 1 });
  const [L] = run(processErode, st2, source(1), null, { mix: 2, ageRate: 8, monitor: 1 });
  assert.ok(finite(L));
});

/** magnitude of the DFT of x at frequency f */
function dftMag(x, f) {
  let re = 0, im = 0;
  for (let j = 0; j < x.length; j++) { const w = (2 * Math.PI * f * j) / SR; re += x[j] * Math.cos(w); im += x[j] * Math.sin(w); }
  return Math.hypot(re, im);
}
function peakNear(x, f0, lo = 0.6, hi = 1.4, step = 0.004) {
  let best = 0, bf = 0;
  for (let r = lo; r <= hi; r += step) { const m = dftMag(x, f0 * r); if (m > best) { best = m; bf = f0 * r; } }
  return bf;
}
const noise = (n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rnd() * 2 - 1; return x; };

test('resonators: noise through a comb peaks at its target pitch; retuning glides from a scheduled time', () => {
  for (const f of [97, 220, 440]) {
    const st = createResonatorState(SR);
    resonatorMessage(st, { targets: [{ f, g: 0.97, gain: 1, damp: 0.3 }], glide: 0.05 });
    const [L] = run(processResonators, st, noise(SR * 1.5), null, { mix: 1, drive: 0 });
    const seg = L.subarray(SR / 2, SR / 2 + 16384);
    const pk = peakNear(seg, f);
    assert.ok(Math.abs(pk / f - 1) < 0.03, `target ${f} Hz, peak ${pk.toFixed(1)} Hz`);
    assert.ok(dftMag(seg, f) > 4 * dftMag(seg, f * 1.5), 'resonance, not flat noise');
  }
  // scheduled glide: 220 → 330 Hz starting at 1.0 s over 0.2 s
  const st = createResonatorState(SR);
  resonatorMessage(st, { targets: [{ f: 220, g: 0.96 }, { f: 110, g: 0.9, gain: 0.5 }], glide: 0.01 });
  resonatorMessage(st, { targets: [{ f: 330, g: 0.96 }], glide: 0.2, startAt: 1.0 });
  const x = noise(SR * 2), L = new Float32Array(B), R = new Float32Array(B);
  let fAt09 = 0, fAt11 = 0;
  for (let i = 0; i + B <= x.length; i += B) {
    processResonators(st, x.subarray(i, i + B), null, L, R, { mix: 1, drive: 0 }, i / SR);
    if (!fAt09 && i / SR >= 0.9) fAt09 = st.f[0];
    if (!fAt11 && i / SR >= 1.1) fAt11 = st.f[0];
  }
  assert.ok(Math.abs(fAt09 - 220) < 0.01, 'still 220 before the stamp');
  assert.ok(fAt11 > 225 && fAt11 < 325, 'mid-glide at 1.1 s: ' + fAt11);
  assert.ok(Math.abs(st.f[0] - 330) < 0.01, 'arrived');
  assert.equal(st.live[1], 0, 'the comb left out faded and was cleared');
});

test('resonators: no NaN, no blow-up with extreme targets, params and input; never more than six combs', () => {
  const st = createResonatorState(SR);
  const targets = [];
  for (let k = 0; k < 10; k++) targets.push({ f: [1e9, -5, NaN, 0.001, 22050, 30, 5e4, 1, 2, 3][k], g: [5, -1, NaN, 0.9999, 1, 0.999, 2, 0.5, 0.5, 0.5][k], gain: [1e6, NaN, 1, 1, 4, 4, -2, 1, 1, 1][k], damp: [NaN, 5, -1, 0.99, 0, 0, 1, 0.3, 0.3, 0.3][k] });
  resonatorMessage(st, { targets, glide: NaN });
  resonatorMessage(st, { targets: 'nope' }); resonatorMessage(st, null); resonatorMessage(st, { targets, glide: 1e9, startAt: 0.5 });
  const x = noise(SR * 2); x[10] = NaN; x[20] = Infinity; x[30] = -1e9;
  for (const p of [{ mix: NaN, drive: NaN }, { mix: 1e9, drive: 1e9 }, { mix: 4, drive: 1 }]) {
    const [L, R] = run(processResonators, st, x, x, p);
    assert.ok(finite(L) && finite(R));
    let pk = 0; for (const v of L) pk = Math.max(pk, Math.abs(v));
    assert.ok(pk < 1e3, 'bounded: ' + pk);
  }
  assert.ok(st.live.length === RES_MAX && RES_MAX <= 6);
  resonatorMessage(st, { clear: true, glide: 0.01 });
  run(processResonators, st, x, null, { mix: 1, drive: 0 });
  assert.ok(Array.from(st.live).every((v) => v === 0), 'clear fades every comb out');
});

test('engine: erode and resonator worklets, their sends and returns, the pink-noise source, mono-low and limiter on the master', async () => {
  const ctx = installFakeAudio();
  const { createEngine } = await import('../src/audio/engine.js');
  const e = await createEngine(ctx, { seed: 3 });
  for (const k of ['reverb', 'delay', 'grain', 'erode', 'res']) assert.ok(e.sends[k], 'sends.' + k);
  assert.equal(e.erode, e.fx.erode); assert.equal(e.res, e.fx.res);
  assert.ok(e.noiseSource && e.noiseSource.source && typeof e.noiseSource.set === 'function');
  assert.ok(e.masterNodes.limiter && e.masterNodes.monoLow && e.masterNodes.monoLow.hp.length === 2);
  assert.ok(!e.erode.stub && !e.res.stub);
  // nothing new reads as dead before the score uses it: the new surface is registered on first use
  const before = e.auditReport();
  for (const k of Object.keys(before.params)) assert.ok(!/^fx\.(erode|res)\.|\.erode$|\.res$|master\.(monoLow|limit)/.test(k), 'registered before use: ' + k);
  // the limiter trim undoes the compressor's own make-up (values measured in headless Chromium)
  assert.ok(Math.abs(compressorMakeup(-6, 4, 12) - 1.3422) < 0.001 && Math.abs(compressorMakeup(-3, 2, 20) - 1.1714) < 0.001 && Math.abs(compressorMakeup(-4, 3, 20) - 1.2254) < 0.001);
  assert.ok(Math.abs(e.masterNodes.limTrim.gain.value * compressorMakeup(-3, 2, 20) - 1) < 1e-9);
  // channel sends are made on first use and audited
  const ch = e.channel('x', { gain: 0.5 });
  assert.equal(ch.nodes.send_erode, undefined);
  ch.set({ erode: 0.4, res: 0.2 }); ch.set({ erode: 0.1, res: 0.6 }); ch.set({ erode: NaN, res: 99 });
  assert.ok(ch.nodes.send_erode && ch.nodes.send_res);
  e.erode.set({ mix: 0.8, ageRate: 2, monitor: 0, return: 1.2, reverb: 0.1, grain: 0.3 }); e.erode.set({ mix: 0.5, ageRate: 1, monitor: 0.4, return: 0.6, reverb: 0.4, grain: 0 });
  e.res.set({ mix: 1, drive: 0, return: 1, reverb: 0.2, noise: 0.1 }); e.res.set({ mix: 2, drive: 0.5, return: 0.4, reverb: 0.5, noise: 0.6 });
  e.noiseSource.set(0.3);
  e.res.setTargets([{ f: 110, g: 0.96 }, { f: 165 }, { f: NaN }], 0.2, 4.0); e.res.setTargets([{ f: 220, g: 0.9, gain: 2 }], 0.1);
  e.fx.master.setMonoLow(120); e.fx.master.setMonoLow(170); e.fx.master.setLimit(-6); e.fx.master.setLimit(NaN);
  const A = e.auditReport();
  for (const k of ['ch.x.erode', 'ch.x.res', 'fx.erode.mix', 'fx.erode.ageRate', 'fx.erode.monitor', 'fx.erode.return', 'fx.erode.reverb', 'fx.erode.grain',
    'fx.res.mix', 'fx.res.drive', 'fx.res.return', 'fx.res.reverb', 'fx.res.noise', 'fx.res.f', 'fx.res.g', 'master.monoLow', 'master.limit']) {
    assert.ok(A.params[k], 'audited: ' + k);
    assert.ok(!A.dead.includes(k), 'moved: ' + k);
  }
  assert.ok(A.params['ch.x.res'].max <= 2 && A.params['fx.erode.ageRate'].max <= 8);
  // quantised capture / scheduled retune go to the worklets with their audio time
  const sent = e.erode.node.port.sent;
  e.erode.captureAt(12.5, 2.4, { passesToFull: 6 }); e.erode.setAge(0.3, 14); e.erode.reset(20); e.erode.captureAt(1, NaN);
  assert.deepEqual(sent.slice(-3), [{ record: 2.4, passesToFull: 6, startAt: 12.5 }, { age: 0.3, startAt: 14 }, { reset: true, startAt: 20 }]);
  const rs = e.res.node.port.sent;
  assert.deepEqual(rs[0], { targets: [{ f: 110, g: 0.96, gain: 1, damp: 0.35 }, { f: 165, g: 0.95, gain: 1, damp: 0.35 }], glide: 0.2, startAt: 4 });
  // the worklet's pass messages land in passLog
  e.erode.node.port.onmessage({ data: { type: 'pass', pass: 0, age: 0, hf: 0.2, cycle: 1, t: 3 } });
  e.erode.node.port.onmessage({ data: { type: 'record', cycle: 1, seconds: 2, t: 1 } });
  assert.equal(e.erode.passLog.length, 1); assert.equal(e.erode.events.length, 1);
});

test('engine: silent stubs when the worklets cannot load (same surface, no throw)', async () => {
  const ctx = installFakeAudio();
  ctx.audioWorklet = { addModule: async () => { throw new Error('nope'); } };
  const { createEngine } = await import('../src/audio/engine.js');
  const err = console.error; const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  let e;
  try { e = await createEngine(ctx, { seed: 1 }); } finally { console.error = err; }
  assert.ok(logged.some((l) => l.includes('erode')) && logged.some((l) => l.includes('resonators')));
  assert.ok(e.erode.stub && e.res.stub);
  e.erode.captureAt(1, 2); e.erode.setAge(0.5); e.erode.reset(); e.erode.set({ mix: 1, return: 0.5 });
  e.res.setTargets([{ f: 100 }], 0.1, 1); e.res.clear(); e.res.set({ noise: 0.5, return: 1 });
  assert.deepEqual(e.erode.passLog, []);
  assert.ok(e.auditReport().params['fx.erode.return'] && e.auditReport().params['fx.res.noise']);
});

test('guardrails: arc, crest, mono low end, noise share, contra periods and decay on synthetic signals', () => {
  const n = SR * 20, L = new Float32Array(n), R = new Float32Array(n);
  // 10 s quiet then 10 s loud noise (arc ≈ 20 dB), a wide 60 Hz tone (anti-phase: low end not mono)
  for (let i = 0; i < n; i++) { const g = i < n / 2 ? 0.02 : 0.2, s = 0.1 * Math.sin((2 * Math.PI * 60 * i) / SR); L[i] = g * (rnd() * 2 - 1) + s; R[i] = g * (rnd() * 2 - 1) - s; }
  const m = L.map((v, i) => 0.5 * (v + R[i]));
  assert.ok(Math.abs(arcDb(m, SR) - 20) < 1.5, 'arc ' + arcDb(m, SR));
  assert.ok(crestDb(m) > 6 && crestDb(m) < 16);
  assert.ok(lowCorr(L, R, SR) < 0);
  const Rm = L.slice();
  assert.ok(lowCorr(L, Rm, SR) > 0.999);
  assert.ok(noiseShare(m, SR) > 0.3, 'white noise is flat');
  const tone = new Float32Array(SR * 4).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 1320 * i) / SR));
  assert.ok(noiseShare(tone, SR) < 0.01, 'a clean tone is not');
  // contra: periods given, or derived from the onsets (beat 0.5 s: 3 and 5 sixteenths → 0.75 / 1.25 beats)
  const log = [];
  for (let k = 0; k < 20; k++) { log.push({ t: k * 0.375, layer: 'A' }); log.push({ t: k * 0.625, layer: 'B' }); }
  assert.deepEqual(contraPeriods(log, 0.5).periods, [0.75, 1.25]);
  assert.deepEqual(contraPeriods([[0, 'A', 3], [1, 'B', 5], [2, 'A', 3]], 0.5).periods, [3, 5]);
  assert.equal(contraPeriods([], 0.5), null);
  // decay
  assert.equal(decayTrend([]), null);
  assert.equal(decayTrend([{ pass: 0, age: 0, hf: 0.2, cycle: 1 }, { pass: 1, age: 0.3, hf: 0.15, cycle: 1 }, { pass: 2, age: 0.6, hf: 0.1, cycle: 1 }, { pass: 3, age: 0.9, hf: 0.05, cycle: 1 }]).ok, true);
  assert.equal(decayTrend([{ pass: 0, age: 0.5, hf: 0.2, cycle: 1 }, { pass: 1, age: 0.4, hf: 0.15, cycle: 1 }, { pass: 2, age: 0.6, hf: 0.1, cycle: 1 }]).ok, false);
  // the report: skipped checks are null, not failures
  const rep = guardrailReport(L, R, SR, {});
  const by = Object.fromEntries(rep.checks.map((c) => [c.name, c]));
  assert.equal(by.contra.pass, null); assert.equal(by.decay.pass, null);
  assert.equal(by.lowCorr.pass, false); assert.equal(by.arc.pass, true); assert.equal(by.noise.pass, true);
  const rep2 = guardrailReport(L, Rm, SR, { contraLog: log, beatSec: 0.5, passLog: [{ pass: 0, age: 0, hf: 0.2, cycle: 1 }, { pass: 1, age: 0.5, hf: 0.1, cycle: 1 }, { pass: 2, age: 1, hf: 0.05, cycle: 1 }] });
  const by2 = Object.fromEntries(rep2.checks.map((c) => [c.name, c]));
  assert.equal(by2.contra.pass, true); assert.equal(by2.decay.pass, true); assert.equal(by2.lowCorr.pass, true);
});
