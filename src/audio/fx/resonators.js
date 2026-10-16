/**
 * ResonatorsFX — wrapper around the 'resonators' AudioWorkletNode (see ../worklets/resonators.js and resonators-core.js).
 * Up to six comb resonators excited by the input (the engine feeds it sends.res and its pink-noise source).
 *
 *   res.setTargets([{ f, g, gain, damp?, pan? }, …≤6], glideSec = 0.15, time?)   retune at an audio time; unlisted combs fade out
 *   res.clear(glideSec, time?)
 *   res.set({ mix, drive }, t, tc)                                                k-rate params (audited as fx.res.*)
 *
 * The engine adds return-path keys to set() (return, reverb, noise) with bindReturns().
 */
import { num } from './util.js';

export const RES_DEFAULTS = Object.freeze({ mix: 1, drive: 0 });
const LIM = { mix: [0, 4], drive: [0, 1] };

export class ResonatorsFX {
  constructor(ctx, hooks = {}, { seed = 1 } = {}) {
    this.ctx = ctx;
    const param = hooks.param || ((n, p) => ({ param: p, set() {}, ramp() {} }));
    this.record = hooks.record || (() => {});
    this.input = new GainNode(ctx, { gain: 1 });
    this.node = new AudioWorkletNode(ctx, 'resonators', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      processorOptions: { seed },
    });
    this.output = new GainNode(ctx, { gain: 1 });
    this.input.connect(this.node);
    this.node.connect(this.output);
    this.h = {};
    for (const k of Object.keys(LIM)) this.h[k] = param('fx.res.' + k, this.node.parameters.get(k), { lazy: true });
    this.extra = {};
    this.targets = [];
  }

  bindReturns(map) { Object.assign(this.extra, map); return this; }

  set(o = {}, t = this.ctx.currentTime, tc = 0.08) {
    for (const k of Object.keys(LIM)) if (o[k] !== undefined) this.h[k].set(num(o[k], RES_DEFAULTS[k], LIM[k][0], LIM[k][1]), t, tc);
    for (const [k, x] of Object.entries(this.extra)) if (o[k] !== undefined) x.h.set(num(o[k], 0, x.lim[0], x.lim[1]), t, tc);
  }

  /** targets: [{f (Hz), g (feedback 0..0.999, default 0.95), gain (0..4, default 1), damp (0..0.95, default 0.35), pan (-1..1)}] */
  setTargets(targets, glideSec = 0.15, time) {
    const list = (Array.isArray(targets) ? targets : []).slice(0, 6).filter((x) => x && Number.isFinite(x.f) && x.f > 0).map((x) => {
      const o = { f: num(x.f, 220, 20, 20000), g: num(x.g, 0.95, 0, 0.999), gain: num(x.gain, 1, 0, 4), damp: num(x.damp, 0.35, 0, 0.95) };
      if (Number.isFinite(x.pan)) o.pan = num(x.pan, 0, -1, 1);
      return o;
    });
    const glide = num(glideSec, 0.15, 0.001, 10);
    for (const x of list) { this.record('fx.res.f', x.f); this.record('fx.res.g', x.g); }
    this.targets = list;
    const m = { targets: list, glide };
    if (Number.isFinite(time)) m.startAt = Math.max(0, time);
    this.node.port.postMessage(m);
  }

  clear(glideSec = 0.1, time) {
    this.targets = [];
    const m = { clear: true, glide: num(glideSec, 0.1, 0.001, 10) };
    if (Number.isFinite(time)) m.startAt = Math.max(0, time);
    this.node.port.postMessage(m);
  }
}

export function resonatorsStub(ctx) {
  const input = new GainNode(ctx), output = new GainNode(ctx, { gain: 0 });
  input.connect(output);
  return {
    stub: true, input, output, targets: [], extra: {},
    bindReturns(map) { Object.assign(this.extra, map); return this; },
    set(o = {}, t, tc) { for (const [k, x] of Object.entries(this.extra)) if (o[k] !== undefined) x.h.set(num(o[k], 0, x.lim[0], x.lim[1]), t, tc); },
    setTargets() {}, clear() {},
  };
}
