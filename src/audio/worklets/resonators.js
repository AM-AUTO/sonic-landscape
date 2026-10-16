/**
 * 'resonators' — up to six damped fractional-delay comb resonators excited by the input (see ./resonators-core.js).
 *
 * AudioParams (k-rate): mix (0-4, output level), drive (0-1, tape-style saturation of the summed resonance; 0 = clean).
 * Messages in: {targets: [{f, g, gain, damp?, pan?}, …≤6], glide: seconds, startAt?: audio time} — retune (f glides
 *   exponentially, g / gain / damp linearly over `glide`); combs not listed fade out. {clear: true, glide?, startAt?}.
 *   {inspect: true} → posts back {type:'state', t, f, g, gain, live, pending} (debugging).
 * processorOptions: {seed}.
 */
import { createResonatorState, resonatorMessage, processResonators } from './resonators-core.js';

class ResonatorsProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = 'k-rate';
    return [
      { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: k },
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
    ];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.st = createResonatorState(sampleRate, { seed: o.seed });
    this.p = { mix: 1, drive: 0 };
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d && d.inspect) {
        const st = this.st;
        this.port.postMessage({ type: 'state', t: currentTime, f: Array.from(st.f), g: Array.from(st.g), gain: Array.from(st.gain), live: Array.from(st.live), pending: st.pending.map((q) => q.at) });
      } else resonatorMessage(this.st, d);
    };
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const outL = out[0], outR = out[1] || out[0];
    const inp = inputs[0];
    const inL = inp && inp[0] && inp[0].length ? inp[0] : null;
    const inR = inp && inp[1] && inp[1].length ? inp[1] : null;
    this.p.mix = params.mix[0]; this.p.drive = params.drive[0];
    processResonators(this.st, inL, inR, outL, outR, this.p, currentTime);
    return true;
  }
}

registerProcessor('resonators', ResonatorsProcessor);
