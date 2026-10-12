/**
 * Stereo ping-pong delay with a filtered, saturated, high-passed feedback path and
 * LFO time modulation (tape wobble). Wet-only output (send return).
 *
 *   input → split → [inLL,inRL → dL] [inRR → dR]
 *   dL → tone → hp → sat → F_L → (self | cross) → dL / dR      (same for R)
 *   outputs tapped from dL / dR → merger → wet → output
 */
import { clamp, num, softSatCurve } from './util.js';

const MAX_FB = 0.94;
let SAT = null;

export function createDelay(ctx, hooks = {}) {
  const param = hooks.param || ((n, p) => ({ param: p, set() {}, ramp() {} }));
  const record = hooks.record || (() => {});
  const now = () => ctx.currentTime;
  SAT = SAT || softSatCurve();

  const input = new GainNode(ctx, { gain: 1 });
  const output = new GainNode(ctx, { gain: 1 });
  const wet = new GainNode(ctx, { gain: 0.5 });
  const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merge = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  input.channelCount = 2; input.channelCountMode = 'explicit';
  input.connect(split);

  const dL = new DelayNode(ctx, { maxDelayTime: 5, delayTime: 0.375 });
  const dR = new DelayNode(ctx, { maxDelayTime: 5, delayTime: 0.375 });
  const mk = () => ({
    tone: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3200, Q: -3 }),
    hp: new BiquadFilterNode(ctx, { type: 'highpass', frequency: 140, Q: -3 }),
    sat: new WaveShaperNode(ctx, { curve: SAT }),
    fb: new GainNode(ctx, { gain: 1 }),
  });
  const L = mk(), R = mk();
  for (const [d, p] of [[dL, L], [dR, R]]) {
    d.connect(p.tone); p.tone.connect(p.hp); p.hp.connect(p.sat); p.sat.connect(p.fb);
  }
  // feedback matrix
  const fbLL = new GainNode(ctx, { gain: 0 }), fbLR = new GainNode(ctx, { gain: 0.5 });
  const fbRR = new GainNode(ctx, { gain: 0 }), fbRL = new GainNode(ctx, { gain: 0.5 });
  L.fb.connect(fbLL); L.fb.connect(fbLR); R.fb.connect(fbRR); R.fb.connect(fbRL);
  fbLL.connect(dL); fbRL.connect(dL); fbLR.connect(dR); fbRR.connect(dR);
  // input matrix
  const inLL = new GainNode(ctx, { gain: 0.7 }), inRL = new GainNode(ctx, { gain: 0.7 }), inRR = new GainNode(ctx, { gain: 0 });
  split.connect(inLL, 0); split.connect(inRL, 1); split.connect(inRR, 1);
  inLL.connect(dL); inRL.connect(dL); inRR.connect(dR);
  // outputs
  dL.connect(merge, 0, 0); dR.connect(merge, 0, 1);
  merge.connect(wet); wet.connect(output);

  // modulation (tape wobble)
  const lfoL = new OscillatorNode(ctx, { type: 'sine', frequency: 0.27 });
  const lfoR = new OscillatorNode(ctx, { type: 'sine', frequency: 0.33 });
  const flut = new OscillatorNode(ctx, { type: 'sine', frequency: 4.7 });
  const mL = new GainNode(ctx, { gain: 0.0003 }), mR = new GainNode(ctx, { gain: 0.0003 });
  const mF = new GainNode(ctx, { gain: 0.00003 });
  lfoL.connect(mL); mL.connect(dL.delayTime);
  lfoR.connect(mR); mR.connect(dR.delayTime);
  flut.connect(mF); mF.connect(dL.delayTime); mF.connect(dR.delayTime);
  lfoL.start(0); lfoR.start(0); flut.start(0);

  let pingPong = true, fb = 0.45, spread = 1, time = 0.375;
  const hTimeL = param('delay.timeL', dL.delayTime);
  const hTimeR = param('delay.timeR', dR.delayTime);
  const hWet = param('delay.wet', wet.gain);
  const hTone = param('delay.tone', L.tone.frequency);
  const hMod = param('delay.modDepth', mL.gain);

  function applyFb(t, tc = 0.08) {
    const self = pingPong ? 0 : fb, cross = pingPong ? fb : 0;
    for (const [g, v] of [[fbLL, self], [fbRR, self], [fbLR, cross], [fbRL, cross]]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(v, t, tc);
    }
  }
  function applyRouting(t) {
    const tc = 0.05;
    const set = (g, v) => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(v, t, tc); };
    set(inLL, pingPong ? 0.7 : 1); set(inRL, pingPong ? 0.7 : 0); set(inRR, pingPong ? 0 : 1);
    applyFb(t);
  }
  applyRouting(0);

  return {
    input, output, wet,
    setTime(sec, t = now(), tc = 0.25) {
      time = num(sec, 0.375, 0.02, 4.5);
      hTimeL.set(time, t, tc);
      hTimeR.set(clamp(time * spread, 0.02, 4.9), t, tc);
    },
    /** Right-channel time as a multiple of the left (1 = equal). Useful for off-ping-pong stereo. */
    setSpread(ratio, t = now()) {
      spread = num(ratio, 1, 0.25, 2);
      hTimeR.set(clamp(time * spread, 0.02, 4.9), t, 0.25);
      record('delay.spread', spread);
    },
    setFeedback(v, t = now()) {
      fb = num(v, 0.45, 0, MAX_FB);
      record('delay.feedback', fb);
      applyFb(t);
    },
    setTone(hz, t = now()) {
      hz = num(hz, 3200, 300, 18000);
      hTone.set(hz, t, 0.2);
      R.tone.frequency.cancelScheduledValues(t);
      R.tone.frequency.setTargetAtTime(hz, t, 0.2);
    },
    setWet(v, t = now()) { hWet.set(num(v, 0.5, 0, 2), t, 0.15); },
    /** 0..1 → up to ~6 ms of tape wobble */
    setModDepth(v, t = now()) {
      v = num(v, 0.1, 0, 1);
      const d = v * 0.006;
      hMod.set(d, t, 0.2);
      mR.gain.cancelScheduledValues(t); mR.gain.setTargetAtTime(d, t, 0.2);
      mF.gain.cancelScheduledValues(t); mF.gain.setTargetAtTime(d * 0.1, t, 0.2);
    },
    setPingPong(on, t = now()) {
      pingPong = !!on;
      record('delay.pingPong', pingPong ? 1 : 0);
      applyRouting(t);
    },
    get feedback() { return fb; },
    get pingPong() { return pingPong; },
  };
}
