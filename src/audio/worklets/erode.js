/**
 * 'erode' — records its input for a set length and loops it, degrading it on every pass (see ./erode-core.js for the DSP).
 *
 * AudioParams (k-rate): mix (0-2, output level), ageRate (0-8, multiplies the per-pass auto-ageing), monitor (0-1, input heard
 * while recording).
 * Messages in: {record: seconds, startAt?, age?}, {age: 0..1, startAt?}, {passesToFull: n, startAt?}, {reset: true, startAt?},
 *   {seed: n}, {maxWow: 0..0.05}. `startAt` is an audio time (seconds): the command applies on that exact sample.
 * Messages out: {type:'pass', pass, age, rms, hf, cycle, t} at the end of every loop pass (hf = share of the pass's energy
 *   above ~1.5 kHz, 2-pole: it falls as the loop wears; rms falls too); {type:'record', cycle, seconds, t} when a capture starts; {type:'loop', cycle, t}
 *   when it starts looping.
 * processorOptions: {maxSeconds (≤ 20), seed}.
 */
import { createErodeState, erodeMessage, processErode } from './erode-core.js';

class ErodeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = 'k-rate';
    return [
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: k },
      { name: 'ageRate', defaultValue: 1, minValue: 0, maxValue: 8, automationRate: k },
      { name: 'monitor', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
    ];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.st = createErodeState(sampleRate, { maxSeconds: o.maxSeconds, seed: o.seed });
    this.p = { mix: 1, ageRate: 1, monitor: 0 };
    const port = this.port;
    this.st.onPass = (pass, age, ms, hf, st) => {
      port.postMessage({ type: 'pass', pass, age: +age.toFixed(4), rms: +Math.sqrt(ms).toFixed(5), hf: +hf.toFixed(4), cycle: st.cycle, t: currentTime });
    };
    this.st.onEvent = (kind, st) => {
      port.postMessage({ type: kind, cycle: st.cycle, seconds: st.recLen / sampleRate, t: currentTime });
    };
    port.onmessage = (e) => erodeMessage(this.st, e.data);
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const outL = out[0], outR = out[1] || out[0];
    const inp = inputs[0];
    const inL = inp && inp[0] && inp[0].length ? inp[0] : null;
    const inR = inp && inp[1] && inp[1].length ? inp[1] : inL;
    const p = this.p;
    p.mix = params.mix[0]; p.ageRate = params.ageRate[0]; p.monitor = params.monitor[0];
    processErode(this.st, inL, inR, outL, outR, p, currentTime);
    return true;
  }
}

registerProcessor('erode', ErodeProcessor);
