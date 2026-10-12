// Minimal fake Web Audio for Node: enough surface for the engine, the voices and the score to run a whole
// session headlessly (no sound). Used by tests/audio-score.test.js and quick dry runs.
// installFakeAudio() defines the global node constructors and returns a fake context whose clock the caller advances.

const PARAMS = ['gain', 'frequency', 'Q', 'detune', 'delayTime', 'pan', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release',
  'density', 'size', 'pitch', 'pitchSpread', 'spray', 'reverse', 'freeze', 'feedback'];

export class FakeParam {
  constructor(v = 0) { this.value = v; this.calls = 0; this.last = v; }
  setValueAtTime(v) { this.value = v; this.last = v; this.calls++; return this; }
  linearRampToValueAtTime(v) { this.last = v; this.calls++; return this; }
  exponentialRampToValueAtTime(v) { this.last = v; this.calls++; return this; }
  setTargetAtTime(v) { this.last = v; this.calls++; return this; }
  setValueCurveAtTime() { this.calls++; return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}

export const counters = { nodes: 0, started: 0, connects: 0 };

function makeNode(opts = {}) {
  counters.nodes++;
  const target = { _params: {}, onended: null, connected: 0, port: { postMessage() {}, onmessage: null } };
  for (const k of Object.keys(opts)) {
    if (PARAMS.includes(k) && typeof opts[k] === 'number') target._params[k] = new FakeParam(opts[k]);
    else target[k] = opts[k];
  }
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === 'connect') return (d) => { counters.connects++; return d; };
      if (prop === 'disconnect') return () => {};
      if (prop === 'start') return () => { counters.started++; };
      if (prop === 'stop') return (when) => { /* ended callbacks are not simulated */ };
      if (prop === 'parameters') return { get: (n) => (t._params[n] ??= new FakeParam(0)) };
      if (typeof prop === 'string' && PARAMS.includes(prop)) return (t._params[prop] ??= new FakeParam(opts[prop] ?? 0));
      return undefined;
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

export function installFakeAudio() {
  const names = ['GainNode', 'WaveShaperNode', 'BiquadFilterNode', 'DynamicsCompressorNode', 'AnalyserNode', 'ChannelSplitterNode',
    'ChannelMergerNode', 'DelayNode', 'OscillatorNode', 'StereoPannerNode', 'ConvolverNode', 'AudioBufferSourceNode', 'AudioWorkletNode'];
  for (const n of names) {
    globalThis[n] = class { constructor(ctx, o = {}) { return makeNode({ ...o, nodeName: n }); } };
  }
  const ctx = {
    currentTime: 0, sampleRate: 44100, destination: makeNode(),
    audioWorklet: { addModule: async () => {} },
    createBuffer(ch, len, sr) {
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    },
    createOscillator() { return makeNode({ type: 'sine' }); },
    createGain() { return makeNode(); },
    createBufferSource() { return makeNode(); },
    createBiquadFilter() { return makeNode(); },
  };
  return ctx;
}
