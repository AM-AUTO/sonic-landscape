/**
 * ErodeFX — wrapper around the 'erode' AudioWorkletNode (see ../worklets/erode.js and ../worklets/erode-core.js).
 * The worklet module must be loaded first (engine.js does that). Output is wet only (the eroding loop), scaled by `mix`.
 *
 *   erode.captureAt(t, seconds, { age, passesToFull })   capture the input from audio time t for `seconds`, then loop it
 *   erode.setAge(a, t) · erode.setPassesToFull(n, t) · erode.reset(t)
 *   erode.set({ mix, ageRate, monitor }, t, tc)          k-rate params (audited as fx.erode.*)
 *   erode.passLog                                         [{type:'pass', pass, age, rms, hf, cycle, t}, …] posted by the worklet
 *
 * The engine adds return-path keys to set() (return, reverb, grain) with bindReturns().
 */
import { num } from './util.js';

export const ERODE_DEFAULTS = Object.freeze({ mix: 1, ageRate: 1, monitor: 0 });
const LIM = { mix: [0, 2], ageRate: [0, 8], monitor: [0, 1] };
const LOG_MAX = 4000;

export class ErodeFX {
  constructor(ctx, hooks = {}, { maxSeconds = 20, seed = 1 } = {}) {
    this.ctx = ctx;
    const param = hooks.param || ((n, p) => ({ param: p, set() {}, ramp() {} }));
    this.input = new GainNode(ctx, { gain: 1 });
    this.node = new AudioWorkletNode(ctx, 'erode', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      processorOptions: { maxSeconds: Math.min(20, Math.max(0.1, num(maxSeconds, 20))), seed: (seed * 2654435761) >>> 0 },
    });
    this.output = new GainNode(ctx, { gain: 1 });
    this.input.connect(this.node);
    this.node.connect(this.output);
    this.h = {};
    for (const k of Object.keys(LIM)) this.h[k] = param('fx.erode.' + k, this.node.parameters.get(k), { lazy: true });
    this.extra = {};
    this.passLog = [];
    this.events = [];
    this.cycle = 0;
    this.node.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'pass') { this.passLog.push(d); if (this.passLog.length > LOG_MAX) this.passLog.splice(0, this.passLog.length - LOG_MAX); }
      else { this.events.push(d); if (this.events.length > 400) this.events.shift(); }
    };
  }

  /** extra set() keys owned by the engine: { name: { h: param handle, lim: [lo, hi] } } */
  bindReturns(map) { Object.assign(this.extra, map); return this; }

  /** set({mix, ageRate, monitor, …bound returns}, t?, tc?) — smooth */
  set(o = {}, t = this.ctx.currentTime, tc = 0.08) {
    for (const k of Object.keys(LIM)) if (o[k] !== undefined) this.h[k].set(num(o[k], ERODE_DEFAULTS[k], LIM[k][0], LIM[k][1]), t, tc);
    for (const [k, x] of Object.entries(this.extra)) if (o[k] !== undefined) x.h.set(num(o[k], 0, x.lim[0], x.lim[1]), t, tc);
  }

  _post(m, time) {
    if (Number.isFinite(time)) m.startAt = time;
    this.node.port.postMessage(m);
  }

  /** capture `seconds` of the input starting exactly at audio time `time` (quantise it to a bar / stanza line), then loop it */
  captureAt(time, seconds, { age, passesToFull } = {}) {
    const s = num(seconds, 0, 0, 20);
    if (!(s > 0)) return;
    const m = { record: s };
    if (age !== undefined) m.age = num(age, 0, 0, 1);
    if (passesToFull !== undefined) m.passesToFull = num(passesToFull, 0, 0, 1e4);
    this.cycle++;
    this._post(m, Number.isFinite(time) ? Math.max(0, time) : undefined);
  }

  /** capture from now */
  capture(seconds, opts) { this.captureAt(this.ctx.currentTime, seconds, opts); }

  setAge(age, time) { this._post({ age: num(age, 0, 0, 1) }, time); }

  /** auto-ageing: the age reaches 1 after n passes (times ageRate); 0 = no auto-ageing */
  setPassesToFull(n, time) { this._post({ passesToFull: num(n, 0, 0, 1e4) }, time); }

  /** stop looping (the output fades in ~6 ms) */
  reset(time) { this._post({ reset: true }, time); }

  /** the worklet's own wow depth at age 1 (0..0.05; default 0.012, the sketch used 0.006-0.02) */
  setWow(depth) { this.node.port.postMessage({ maxWow: num(depth, 0.012, 0, 0.05) }); }
}

/** silent stand-in when the worklet cannot load: same surface, no sound */
export function erodeStub(ctx) {
  const input = new GainNode(ctx), output = new GainNode(ctx, { gain: 0 });
  input.connect(output);
  return {
    stub: true, input, output, passLog: [], events: [], cycle: 0, extra: {},
    bindReturns(map) { Object.assign(this.extra, map); return this; },
    set(o = {}, t, tc) { for (const [k, x] of Object.entries(this.extra)) if (o[k] !== undefined) x.h.set(num(o[k], 0, x.lim[0], x.lim[1]), t, tc); },
    captureAt() {}, capture() {}, setAge() {}, setPassesToFull() {}, reset() {}, setWow() {},
  };
}
