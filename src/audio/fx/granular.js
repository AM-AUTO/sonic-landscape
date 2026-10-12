/**
 * GranularFX — wrapper around the 'granular-fx' AudioWorkletNode (see ../worklets/granular.js).
 * The worklet module must be loaded first (engine.js does that). Output is wet-only, scaled by `mix`.
 */
import { clamp, num } from './util.js';

export const GRANULAR_DEFAULTS = Object.freeze({
  density: 14, size: 0.18, pitch: 0, pitchSpread: 0, spray: 1.5, reverse: 0.1, mix: 0.7, feedback: 0.2,
});

export class GranularFX {
  constructor(ctx, hooks = {}) {
    this.ctx = ctx;
    this.record = hooks.record || (() => {});
    const param = hooks.param || ((n, p) => ({ param: p, set() {}, ramp() {} }));
    this.input = new GainNode(ctx, { gain: 1 });
    this.output = new GainNode(ctx, { gain: 1 });
    this.mixNode = new GainNode(ctx, { gain: GRANULAR_DEFAULTS.mix });
    this.node = new AudioWorkletNode(ctx, 'granular-fx', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
    });
    this.input.connect(this.node);
    this.node.connect(this.mixNode);
    this.mixNode.connect(this.output);
    this.h = {};
    for (const name of ['density', 'size', 'pitch', 'pitchSpread', 'spray', 'reverse', 'feedback', 'freeze']) {
      this.h[name] = param('granular.' + name, this.node.parameters.get(name));
    }
    this.h.mix = param('granular.mix', this.mixNode.gain);
    this.set(GRANULAR_DEFAULTS, 0);
    this.frozen = false;
  }

  /** set({density,size,pitch,pitchSpread,spray,reverse,mix,feedback}, t?) — smooth, k-rate */
  set(o = {}, t = this.ctx.currentTime, tc = 0.08) {
    const lim = {
      density: [0, 80], size: [0.01, 1], pitch: [-60, 60], pitchSpread: [0, 36],
      spray: [0, 5.5], reverse: [0, 1], feedback: [0, 0.7], mix: [0, 1.5],
    };
    for (const k of Object.keys(lim)) {
      if (o[k] === undefined) continue;
      const v = num(o[k], GRANULAR_DEFAULTS[k], lim[k][0], lim[k][1]);
      this.h[k].set(v, t, tc);
    }
  }

  freeze(on = true, t = this.ctx.currentTime) {
    this.frozen = !!on;
    this.h.freeze.set(on ? 1 : 0, t, 0.001);
  }

  /** quantise grain pitch intervals to these semitone pitch classes (empty/null = off) */
  setScale(semitones) {
    this.node.port.postMessage({ scale: Array.isArray(semitones) && semitones.length ? semitones.slice() : null });
  }
}
