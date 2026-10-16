/**
 * CONTOURS audio engine: channels with local FX, global FX returns (reverb / delay / granular),
 * master chain, parameter-audit registry and noise buffer cache.
 * Raw Web Audio only. Works with AudioContext and OfflineAudioContext.
 *
 *   channel → drive → crush → filter → chorus → pan → gain ─┬→ out (ducked bed) ─┐
 *                                                          ├→ outFront (unducked)├→ bus → glue comp → lowcut → highcut → mono-low
 *                                                          └→ sends               │   → soft limiter → drive → soft clip → final → analyser → destination
 *   sends.reverb → reverb ──────────────────────────────────────────────────────→ bus
 *   sends.delay  → delay  ──→ bus, ──(a little)→ sends.reverb
 *   sends.grain  → granular ─→ bus, ──→ delay, ──→ sends.reverb
 *   sends.erode  → erode (eroding loop worklet) ─→ return (fx.erode.return) → bus, ──→ sends.reverb, ──→ sends.grain
 *   sends.res + pink noise (fx.res.noise) → resonators worklet ─→ return (fx.res.return) → bus, ──→ sends.reverb
 *
 * Channel sends to erode / res are made on first use (ch.set({ erode, res })), so channels that never use them cost nothing.
 * The erode / resonator / mono-low / limiter params are registered in the audit on first use (they are new surface the score
 * wires stage by stage; a param registered but never moved would read as dead).
 */
import { Rng, mulberry32 } from '../core/rng.js';
import { createReverb } from './fx/reverb.js';
import { createDelay } from './fx/delay.js';
import { GranularFX } from './fx/granular.js';
import { ErodeFX, erodeStub } from './fx/erode.js';
import { ResonatorsFX, resonatorsStub } from './fx/resonators.js';
import {
  clamp, num, makeDriveCurve, makeCrushCurve, softClipCurve, compressorMakeup,
} from './fx/util.js';

const DRIVE_RANGE = 8;

export async function createEngine(ctx, { seed = 1 } = {}) {
  const rng = new Rng(seed);
  const now = () => ctx.currentTime;

  // ---------------------------------------------------------------- audit registry
  const registry = new Map();
  const entry = (name) => {
    let r = registry.get(name);
    if (!r) { r = { min: Infinity, max: -Infinity, count: 0 }; registry.set(name, r); }
    return r;
  };
  function note(name, v) {
    if (typeof v === 'boolean') v = v ? 1 : 0;
    v = Number(v);
    const r = entry(name);
    if (!Number.isFinite(v)) return;
    if (v < r.min) r.min = v;
    if (v > r.max) r.max = v;
    r.count++;
  }
  function record(name, value) { note(name, value); }

  /** an audited handle on an AudioParam (or null: audit only). opts.lazy: registered in the audit on its first set, not now */
  function param(name, audioParam, opts = {}) {
    if (!opts.lazy) entry(name);
    const h = {
      name, param: audioParam,
      /** smooth set: cancels later events, exponential approach with time constant tc */
      set(value, t = now(), tc = 0.1) {
        const v = Number(value);
        if (!Number.isFinite(v)) return h;
        note(name, v);
        if (audioParam) {
          audioParam.cancelScheduledValues(t);
          audioParam.setTargetAtTime(v, t, Math.max(0.001, num(tc, 0.1)));
        }
        return h;
      },
      /** linear ramp from the current value to `value` at time t */
      ramp(value, t = now() + 0.1) {
        const v = Number(value);
        if (!Number.isFinite(v)) return h;
        note(name, v);
        if (audioParam) {
          const n = now();
          audioParam.cancelScheduledValues(n);
          audioParam.setValueAtTime(audioParam.value, n);
          audioParam.linearRampToValueAtTime(v, Math.max(t, n + 0.001));
        }
        return h;
      },
    };
    return h;
  }

  function auditReport() {
    const params = {};
    const dead = [];
    for (const [name, r] of registry) {
      params[name] = r.count === 0 ? { min: 0, max: 0, count: 0 } : { min: r.min, max: r.max, count: r.count };
      if (r.count < 2 || r.min === r.max) dead.push(name);
    }
    return { params, dead };
  }

  // ---------------------------------------------------------------- noise cache
  const noiseCache = new Map();
  const noiseJobs = new Map();
  /**
   * A noise buffer is built by a resumable job (fill → remove DC → normalise to RMS 0.3), so the Score can make one over several
   * updates (noiseWarm) instead of stalling a frame; noiseBuffer runs the same job to completion when a voice needs one now.
   */
  function noiseJob(kind, seconds, key) {
    const sr = ctx.sampleRate;
    const len = Math.max(64, Math.floor(seconds * sr));
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    const r = mulberry32((seed * 7919 + kind.length * 104729 + len) >>> 0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    let phase = 0, i = 0, mean = 0, e = 0, k = 1;
    return {
      buffer: b,
      /** do up to `n` samples of work; true when the buffer is finished */
      step(n) {
        const stop = Math.min(len, i + n);
        if (phase === 0) {
          if (kind === 'pink') {
            for (; i < stop; i++) {
              const w = r() * 2 - 1;
              b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
              b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
              b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
              d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
            }
          } else if (kind === 'brown') {
            for (; i < stop; i++) { const w = r() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          } else {
            for (; i < stop; i++) d[i] = r() * 2 - 1;
          }
          if (i >= len) { phase = 1; i = 0; for (let j = 0; j < len; j++) mean += d[j]; mean /= len; }     // DC: one cheap pass
        } else if (phase === 1) {
          for (; i < stop; i++) { d[i] -= mean; e += d[i] * d[i]; }
          if (i >= len) { phase = 2; i = 0; k = 0.3 / (Math.sqrt(e / len) || 1); }
        } else {
          for (; i < stop; i++) d[i] = clamp(d[i] * k, -1, 1);
          if (i >= len) { noiseCache.set(key, b); noiseJobs.delete(key); return true; }
        }
        return false;
      },
    };
  }
  const noiseKey = (kind, seconds) => kind + ':' + clamp(num(seconds, 2), 0.05, 30).toFixed(2);
  function noiseBuffer(kind = 'white', seconds = 2) {
    seconds = clamp(num(seconds, 2), 0.05, 30);
    const key = kind + ':' + seconds.toFixed(2);
    const hit = noiseCache.get(key);
    if (hit) return hit;
    let job = noiseJobs.get(key);
    if (!job) { job = noiseJob(kind, seconds, key); noiseJobs.set(key, job); }
    while (!job.step(1e9)) { /* run to completion */ }
    return noiseCache.get(key);
  }
  /** one slice (~100k samples) of building a noise buffer ahead of need; true when it is in the cache */
  function noiseWarm(kind = 'white', seconds = 2) {
    seconds = clamp(num(seconds, 2), 0.05, 30);
    const key = noiseKey(kind, seconds);
    if (noiseCache.has(key)) return true;
    let job = noiseJobs.get(key);
    if (!job) { job = noiseJob(kind, seconds, key); noiseJobs.set(key, job); }
    return job.step(100000);
  }

  // ---------------------------------------------------------------- shared curves
  const driveCurve = makeDriveCurve(DRIVE_RANGE);
  const crushCurves = new Map();
  const crushCurve = (bits) => {
    let c = crushCurves.get(bits);
    if (!c) { c = makeCrushCurve(bits); crushCurves.set(bits, c); }
    return c;
  };

  // ---------------------------------------------------------------- master chain
  const bus = new GainNode(ctx, { gain: 0.75 });  // trim so a dense tutti sits around -13 dBFS RMS
  const glue = new DynamicsCompressorNode(ctx, { threshold: -16, knee: 14, ratio: 2.4, attack: 0.025, release: 0.28 });
  const glueMakeup = new GainNode(ctx, { gain: 1.15 });
  const lowcut = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 28, Q: -3 });
  const highcut = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 17500, Q: -3 });
  // mono-low: M/S split; the side (L - R) / 2 is high-passed (4-pole Butterworth at ~150 Hz) and the pair rebuilt as M ± S', so
  // everything below the crossover is mid only (a hi-fi mono bottom) and the mid itself is untouched (the sketch's monoLow)
  const mlSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const mono1 = { channelCount: 1, channelCountMode: 'explicit' };
  const mlMid = new GainNode(ctx, { gain: 0.5, ...mono1 });
  const mlInvR = new GainNode(ctx, { gain: -1, ...mono1 });
  const mlSide = new GainNode(ctx, { gain: 0.5, ...mono1 });
  const mlHp1 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 150, Q: 0.5412 });
  const mlHp2 = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 150, Q: 1.3066 });
  const mlNeg = new GainNode(ctx, { gain: -1, ...mono1 });
  const mlMerge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  mlSplit.connect(mlMid, 0); mlSplit.connect(mlMid, 1);
  mlSplit.connect(mlSide, 0); mlSplit.connect(mlInvR, 1); mlInvR.connect(mlSide);
  mlSide.connect(mlHp1); mlHp1.connect(mlHp2);
  mlMid.connect(mlMerge, 0, 0); mlHp2.connect(mlMerge, 0, 0);
  mlMid.connect(mlMerge, 0, 1); mlHp2.connect(mlNeg); mlNeg.connect(mlMerge, 0, 1);
  // soft limiter: a fast, high-threshold compressor ahead of the soft clip catches the transient spikes (surging contra layers)
  // so the clip rarely bends, without flattening the arc (a -6 dB threshold took ~1.5 dB off loud stanzas and artefact entries);
  // the compressor's own make-up gain (compressorMakeup: +1.37 dB at -3 dB) is taken back off, so below the threshold the stage
  // is unity. master.setLimit(dB) moves the threshold and the trim together.
  const LIM_KNEE = 2, LIM_RATIO = 20, LIM_DEFAULT = -3;
  const limiter = new DynamicsCompressorNode(ctx, { threshold: LIM_DEFAULT, knee: LIM_KNEE, ratio: LIM_RATIO, attack: 0.001, release: 0.06 });
  const limTrim = new GainNode(ctx, { gain: 1 / compressorMakeup(LIM_DEFAULT, LIM_KNEE, LIM_RATIO) });
  const mDrive = new GainNode(ctx, { gain: 1 / 2.5 });       // 1/range → unity through softclip
  const clip = new WaveShaperNode(ctx, { curve: softClipCurve(8192, { ceiling: 0.9, knee: 0.55, range: 2.5 }), oversample: '2x' });
  const finalGain = new GainNode(ctx, { gain: 0.95 });
  const analyser = new AnalyserNode(ctx, { fftSize: 2048, smoothingTimeConstant: 0.8 });
  bus.connect(glue); glue.connect(glueMakeup); glueMakeup.connect(lowcut); lowcut.connect(highcut);
  highcut.connect(mlSplit); mlMerge.connect(limiter); limiter.connect(limTrim); limTrim.connect(mDrive); mDrive.connect(clip); clip.connect(finalGain); finalGain.connect(analyser);
  analyser.connect(ctx.destination);
  // per-channel meters: the mono analyser above averages L and R (wide reverb / ping-pong content partly cancels), so the Score's
  // level reading (leveler, artefact servo) uses these two instead and matches the true stereo RMS of the render
  const meterSplit = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const meterL = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0 });      // ~93 ms: covers the Score's 100 ms reading interval
  const meterR = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0 });
  finalGain.connect(meterSplit); meterSplit.connect(meterL, 0); meterSplit.connect(meterR, 1);

  const out = new GainNode(ctx, { gain: 1 });       // ducked bed input
  const outFront = new GainNode(ctx, { gain: 1 });  // un-ducked input
  out.connect(bus); outFront.connect(bus);

  const hMasterGain = param('master.gain', finalGain.gain);
  const hDrive = param('master.drive', mDrive.gain);
  const hLow = param('master.lowCut', lowcut.frequency);
  const hHigh = param('master.highCut', highcut.frequency);
  const hDuck = param('master.duck', null);
  const hMonoLow = param('master.monoLow', null, { lazy: true });
  const hLimit = param('master.limit', null, { lazy: true });

  // ---------------------------------------------------------------- global FX
  const sends = {
    reverb: new GainNode(ctx, { gain: 1 }),
    delay: new GainNode(ctx, { gain: 1 }),
    grain: new GainNode(ctx, { gain: 1 }),
    erode: new GainNode(ctx, { gain: 1 }),
    res: new GainNode(ctx, { gain: 1 }),
  };
  const hooks = { param, record };
  const reverb = createReverb(ctx, hooks, { seed });
  const delay = createDelay(ctx, hooks);

  // load the granular worklet
  let granular = null;
  let readyResolve;
  const ready = new Promise((res) => { readyResolve = res; });
  try {
    if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable');
    await ctx.audioWorklet.addModule(new URL('./worklets/granular.js', import.meta.url));
    granular = new GranularFX(ctx, hooks);
  } catch (err) {
    console.error('[engine] granular worklet failed to load:', err && err.message ? err.message : err);
    // fall back to a silent stub so the rest of the engine still works
    const stub = {
      input: new GainNode(ctx), output: new GainNode(ctx, { gain: 0 }),
      set() {}, freeze() {}, setScale() {},
    };
    stub.input.connect(stub.output);
    granular = stub;
  }
  // the eroding loop and the resonators (each falls back to a silent stub if its worklet cannot load)
  let erode, res;
  try {
    if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable');
    await ctx.audioWorklet.addModule(new URL('./worklets/erode.js', import.meta.url));
    erode = new ErodeFX(ctx, hooks, { seed });
  } catch (err) {
    console.error('[engine] erode worklet failed to load:', err && err.message ? err.message : err);
    erode = erodeStub(ctx);
  }
  try {
    if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable');
    await ctx.audioWorklet.addModule(new URL('./worklets/resonators.js', import.meta.url));
    res = new ResonatorsFX(ctx, hooks, { seed });
  } catch (err) {
    console.error('[engine] resonators worklet failed to load:', err && err.message ? err.message : err);
    res = resonatorsStub(ctx);
  }
  readyResolve(true);

  sends.reverb.connect(reverb.input);
  sends.delay.connect(delay.input);
  sends.grain.connect(granular.input);
  const retReverb = new GainNode(ctx, { gain: 1 });
  const retDelay = new GainNode(ctx, { gain: 1 });
  const retGrain = new GainNode(ctx, { gain: 1 });
  reverb.output.connect(retReverb); retReverb.connect(bus);
  delay.output.connect(retDelay); retDelay.connect(bus);
  granular.output.connect(retGrain); retGrain.connect(bus);
  const delayToReverb = new GainNode(ctx, { gain: 0.3 });
  delay.output.connect(delayToReverb); delayToReverb.connect(sends.reverb);
  const grainToDelay = new GainNode(ctx, { gain: 0.45 });
  const grainToReverb = new GainNode(ctx, { gain: 0.5 });
  granular.output.connect(grainToDelay); grainToDelay.connect(delay.input);
  granular.output.connect(grainToReverb); grainToReverb.connect(sends.reverb);

  // erode: send in, return to the bus, a little into the reverb, and optionally into the grain cloud (the sketch granulates the loop)
  sends.erode.connect(erode.input);
  const retErode = new GainNode(ctx, { gain: 1 });
  const erodeToReverb = new GainNode(ctx, { gain: 0.25 });
  const erodeToGrain = new GainNode(ctx, { gain: 0 });
  erode.output.connect(retErode); retErode.connect(bus);
  erode.output.connect(erodeToReverb); erodeToReverb.connect(sends.reverb);
  erode.output.connect(erodeToGrain); erodeToGrain.connect(sends.grain);
  erode.bindReturns({
    return: { h: param('fx.erode.return', retErode.gain, { lazy: true }), lim: [0, 2] },
    reverb: { h: param('fx.erode.reverb', erodeToReverb.gain, { lazy: true }), lim: [0, 1.5] },
    grain: { h: param('fx.erode.grain', erodeToGrain.gain, { lazy: true }), lim: [0, 1.5] },
  });
  // resonators: send in, plus an always-running pink-noise source (silent until fx.res.noise is raised) so they can sing from noise alone
  sends.res.connect(res.input);
  const noiseGain = new GainNode(ctx, { gain: 0 });
  const noiseSrc = new AudioBufferSourceNode(ctx, { buffer: noiseBuffer('pink', 12), loop: true });
  noiseSrc.connect(noiseGain); noiseGain.connect(res.input);
  noiseSrc.start(0);
  const retRes = new GainNode(ctx, { gain: 1 });
  const resToReverb = new GainNode(ctx, { gain: 0.3 });
  res.output.connect(retRes); retRes.connect(bus);
  res.output.connect(resToReverb); resToReverb.connect(sends.reverb);
  const hNoise = param('fx.res.noise', noiseGain.gain, { lazy: true });
  res.bindReturns({
    return: { h: param('fx.res.return', retRes.gain, { lazy: true }), lim: [0, 2] },
    reverb: { h: param('fx.res.reverb', resToReverb.gain, { lazy: true }), lim: [0, 1.5] },
    noise: { h: hNoise, lim: [0, 2] },
  });
  const noiseSource = {
    source: noiseSrc, output: noiseGain, param: hNoise,
    /** pink-noise level into the resonators (0..2; the buffer is RMS 0.3) */
    set(level, t = now(), tc = 0.1) { hNoise.set(num(level, 0, 0, 2), t, tc); },
  };

  delay.setWet(0.55, 0);
  delay.setTime(0.5, 0);
  delay.setFeedback(0.45, 0);
  delay.setTone(3200, 0);
  delay.setModDepth(0.15, 0);
  reverb.setWet(0.9, 0);

  const master = {
    setDrive(v, t = now()) {
      v = num(v, 0, 0, 1);
      hDrive.set((1 + v * 1.8) / 2.5, t, 0.1);
    },
    setLowCut(hz, t = now()) { hLow.set(num(hz, 28, 10, 400), t, 0.1); },
    setHighCut(hz, t = now()) { hHigh.set(num(hz, 17500, 200, 20000), t, 0.1); },
    setGain(v, t = now()) { hMasterGain.set(num(v, 0.95, 0, 1.5), t, 0.05); },
    /** soft-limiter threshold (dBFS at the master, -12..0; default -3): lower squeezes the peaks (crest) harder */
    setLimit(db, t = now()) {
      const v = num(db, LIM_DEFAULT, -12, 0);
      hLimit.set(v, t, 0.05);
      limiter.threshold.cancelScheduledValues(t); limiter.threshold.setTargetAtTime(v, t, 0.05);
      limTrim.gain.cancelScheduledValues(t); limTrim.gain.setTargetAtTime(1 / compressorMakeup(v, LIM_KNEE, LIM_RATIO), t, 0.05);
    },
    /** mono-low crossover (Hz, 60..300; default 150): below it the master is mono */
    setMonoLow(hz, t = now()) {
      const f = num(hz, 150, 60, 300);
      hMonoLow.set(f, t, 0.1);
      for (const b of [mlHp1, mlHp2]) { b.frequency.cancelScheduledValues(t); b.frequency.setTargetAtTime(f, t, 0.1); }
    },
    /**
     * Duck the bed (everything routed through `out`, i.e. all channels with duck:true) by
     * `amount` (0..1 linear reduction; 0.5 ≈ -6 dB): attack s down, hold s, release s back up.
     */
    duck(amount = 0.5, attack = 0.05, hold = 0.5, release = 1.5, t = now()) {
      amount = num(amount, 0.5, 0, 0.95);
      attack = Math.max(0.005, num(attack, 0.05)); hold = Math.max(0, num(hold, 0.5)); release = Math.max(0.02, num(release, 1.5));
      note('master.duck', amount);
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(1 - amount, t, attack / 3);
      out.gain.setTargetAtTime(1, t + attack + hold, release / 3);
    },
  };

  // ---------------------------------------------------------------- channels
  const channels = new Map();

  function channel(name, opts = {}) {
    if (channels.has(name)) { const c = channels.get(name); c.set(opts, now(), 0.01); return c; }
    const o = { gain: 0.8, pan: 0, reverb: 0.3, delay: 0.15, grain: 0.1, drive: 0, duck: true, ...opts };
    const input = new GainNode(ctx, { gain: 1 });
    const pre = new GainNode(ctx, { gain: 1 / DRIVE_RANGE });
    const shaper = new WaveShaperNode(ctx, { curve: driveCurve });
    const post = new GainNode(ctx, { gain: 1 });
    const crushDry = new GainNode(ctx, { gain: 1 });
    const crushWet = new GainNode(ctx, { gain: 0 });
    const crusher = new WaveShaperNode(ctx, { curve: crushCurve(8) });
    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 18000, Q: -3 });
    const cDry = new GainNode(ctx, { gain: 1 });
    const cDelay = new DelayNode(ctx, { maxDelayTime: 0.06, delayTime: 0.016 });
    const cLfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.43 });
    const cDepth = new GainNode(ctx, { gain: 0.0035 });
    const cWet = new GainNode(ctx, { gain: 0 });
    const cSum = new GainNode(ctx, { gain: 1 });
    const panner = new StereoPannerNode(ctx, { pan: 0 });
    const gain = new GainNode(ctx, { gain: 0.8 });
    const sendRev = new GainNode(ctx, { gain: 0 });
    const sendDel = new GainNode(ctx, { gain: 0 });
    const sendGrn = new GainNode(ctx, { gain: 0 });

    input.connect(pre); pre.connect(shaper); shaper.connect(post);
    post.connect(crushDry); post.connect(crusher); crusher.connect(crushWet);
    crushDry.connect(filter); crushWet.connect(filter);
    filter.connect(cDry); filter.connect(cDelay); cDelay.connect(cWet);
    cLfo.connect(cDepth); cDepth.connect(cDelay.delayTime); cLfo.start(0);
    cDry.connect(cSum); cWet.connect(cSum);
    cSum.connect(panner); panner.connect(gain);
    gain.connect(o.duck === false ? outFront : out);
    gain.connect(sendRev); sendRev.connect(sends.reverb);
    gain.connect(sendDel); sendDel.connect(sends.delay);
    gain.connect(sendGrn); sendGrn.connect(sends.grain);

    const p = (suffix, ap) => param(`ch.${name}.${suffix}`, ap);
    const H = {
      gain: p('gain', gain.gain), pan: p('pan', panner.pan),
      reverb: p('reverb', sendRev.gain), delay: p('delay', sendDel.gain), grain: p('grain', sendGrn.gain),
      cutoff: p('cutoff', filter.frequency), resonance: p('resonance', filter.Q),
      drive: p('drive', null), crush: p('crush', null), chorus: p('chorus', null),
    };
    // sends to the eroding loop and the resonators: the GainNode and its audited handle are made on first use
    const lazySend = (key) => {
      if (!H[key]) {
        const g = new GainNode(ctx, { gain: 0 });
        gain.connect(g); g.connect(sends[key]);
        H[key] = p(key, g.gain);
        ch.nodes['send_' + key] = g;
      }
      return H[key];
    };
    let crushBits = 0;
    const ch = {
      name, input, output: gain, filter, panner, gain, nodes: { pre, shaper, post, crusher, filter, cDelay, panner, gain },
      state: {},
      set(v = {}, t = now(), tc = 0.05) {
        if (v.gain !== undefined) H.gain.set(num(v.gain, 0.8, 0, 3.2), t, tc);
        if (v.pan !== undefined) H.pan.set(num(v.pan, 0, -1, 1), t, tc);
        if (v.reverb !== undefined) H.reverb.set(num(v.reverb, 0, 0, 2), t, tc);
        if (v.delay !== undefined) H.delay.set(num(v.delay, 0, 0, 2), t, tc);
        if (v.grain !== undefined) H.grain.set(num(v.grain, 0, 0, 2), t, tc);
        if (v.erode !== undefined) lazySend('erode').set(num(v.erode, 0, 0, 2), t, tc);
        if (v.res !== undefined) lazySend('res').set(num(v.res, 0, 0, 2), t, tc);
        if (v.cutoff !== undefined) H.cutoff.set(num(v.cutoff, 18000, 40, Math.min(20000, ctx.sampleRate * 0.45)), t, tc);
        if (v.resonance !== undefined) H.resonance.set(num(v.resonance, -3, -12, 24), t, tc);
        if (v.drive !== undefined) {
          const d = num(v.drive, 0, 0, 1);
          H.drive.set(d, t, tc);
          const preG = (1 + d * d * 11) / DRIVE_RANGE;
          const eff = preG * DRIVE_RANGE;
          const postG = 0.5 / Math.tanh(0.5 * eff);
          pre.gain.cancelScheduledValues(t); pre.gain.setTargetAtTime(preG, t, tc);
          post.gain.cancelScheduledValues(t); post.gain.setTargetAtTime(postG, t, tc);
        }
        if (v.crush !== undefined) {
          const c = num(v.crush, 0, 0, 1);
          H.crush.set(c, t, tc);
          const bits = c < 0.02 ? 0 : Math.round(12 - c * 9);   // 12 → 3 bits
          if (bits !== crushBits) {
            if (bits > 0) crusher.curve = crushCurve(bits);
            crushBits = bits;
          }
          crushDry.gain.cancelScheduledValues(t); crushDry.gain.setTargetAtTime(bits ? 0 : 1, t, 0.02);
          crushWet.gain.cancelScheduledValues(t); crushWet.gain.setTargetAtTime(bits ? 1 : 0, t, 0.02);
        }
        if (v.chorus !== undefined) {
          const c = num(v.chorus, 0, 0, 1);
          H.chorus.set(c, t, tc);
          cWet.gain.cancelScheduledValues(t); cWet.gain.setTargetAtTime(c * 0.75, t, tc);
          cDry.gain.cancelScheduledValues(t); cDry.gain.setTargetAtTime(1 - c * 0.25, t, tc);
        }
        Object.assign(ch.state, v);
      },
    };
    channels.set(name, ch);
    const init = { ...o };
    if (opts.filter !== undefined && opts.cutoff === undefined) init.cutoff = opts.filter;
    delete init.filter; delete init.duck;
    ch.set(init, 0, 0.001);
    return ch;
  }

  const engine = {
    ctx, rng, seed, out, outFront, sends, bus, analyser, meterL, meterR,
    masterNodes: { glue, glueMakeup, lowcut, highcut, monoLow: { split: mlSplit, mid: mlMid, side: mlSide, hp: [mlHp1, mlHp2], merge: mlMerge }, limiter, limTrim, drive: mDrive, clip, finalGain },
    fx: { reverb, delay, granular, erode, res, master },
    /** the eroding-loop worklet wrapper (captureAt / setAge / setPassesToFull / reset / set / passLog) */
    erode,
    /** the resonator worklet wrapper (setTargets / clear / set) */
    res,
    /** the pink-noise source feeding the resonators: { source, output, set(level, t, tc) } */
    noiseSource,
    channel, channels,
    param, record, auditReport, audit: auditReport,
    noiseBuffer, noiseWarm, ready,
    /** release the master graph (voices should be stopped first) */
    dispose() {
      try { bus.disconnect(); analyser.disconnect(); meterSplit.disconnect(); out.disconnect(); outFront.disconnect(); } catch (e) { /* already gone */ }
      try { noiseSrc.stop(); noiseSrc.disconnect(); } catch (e) { /* already gone */ }
    },
    /** cached lookup of a bitcrush curve (shared by voices) */
    crushCurve,
    now,
  };
  return engine;
}
