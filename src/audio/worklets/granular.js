/**
 * 'granular-fx' — a live granular processor.
 * Records the stereo input into a 6 s ring buffer (unless frozen) and plays a cloud of
 * Hann-windowed grains read from random points up to `spray` seconds back, at a pitch ratio
 * (optionally quantised to a scale), forward or reversed. Output is the grain cloud only (wet).
 *
 * AudioParams (all k-rate): density (grains/s, 0-80), size (s, 0.01-1), pitch (st), pitchSpread (st),
 * spray (s, 0-5.5), reverse (0-1), freeze (0/1), feedback (0-0.7).
 * Messages: {scale:[semitone pitch classes]} quantises grain pitch intervals; {seed:n}.
 */
const BUF_SECONDS = 6;
const MAX_GRAINS = 64;
const HANN_N = 1024;
const HANN = new Float32Array(HANN_N + 2);
for (let i = 0; i < HANN.length; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * Math.min(i, HANN_N)) / HANN_N);

class GranularFX extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = 'k-rate';
    return [
      { name: 'density', defaultValue: 12, minValue: 0, maxValue: 80, automationRate: k },
      { name: 'size', defaultValue: 0.15, minValue: 0.01, maxValue: 1, automationRate: k },
      { name: 'pitch', defaultValue: 0, minValue: -60, maxValue: 60, automationRate: k },
      { name: 'pitchSpread', defaultValue: 0, minValue: 0, maxValue: 36, automationRate: k },
      { name: 'spray', defaultValue: 1, minValue: 0, maxValue: 5.5, automationRate: k },
      { name: 'reverse', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: 'feedback', defaultValue: 0, minValue: 0, maxValue: 0.7, automationRate: k },
    ];
  }

  constructor() {
    super();
    this.n = Math.floor(BUF_SECONDS * sampleRate);
    this.bufL = new Float32Array(this.n);
    this.bufR = new Float32Array(this.n);
    this.w = 0;
    this.pos = new Float64Array(MAX_GRAINS);     // read position (samples)
    this.inc = new Float64Array(MAX_GRAINS);     // read increment (signed)
    this.age = new Int32Array(MAX_GRAINS);
    this.len = new Int32Array(MAX_GRAINS);
    this.ampL = new Float32Array(MAX_GRAINS);
    this.ampR = new Float32Array(MAX_GRAINS);
    this.count = 0;
    this.scale = null;
    this.seed = 0x9e3779b9;
    this.untilNext = 0;
    this.fbL = 0; this.fbR = 0;
    this.frozenPrev = false;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (Array.isArray(d.scale)) {
        const pcs = Array.from(new Set(d.scale.map((s) => ((Math.round(s) % 12) + 12) % 12))).sort((a, b) => a - b);
        this.scale = pcs.length ? pcs : null;
      }
      if (d.scale === null) this.scale = null;
      if (typeof d.seed === 'number') this.seed = (d.seed >>> 0) || 1;
    };
  }

  rand() {
    let x = this.seed;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 4294967296;
  }

  quantizeSemis(s) {
    const sc = this.scale;
    if (!sc) return s;
    const base = Math.floor(s / 12) * 12;
    let best = s, bd = 1e9;
    for (let o = -12; o <= 12; o += 12) {
      for (let i = 0; i < sc.length; i++) {
        const c = base + o + sc[i];
        const d = Math.abs(c - s);
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }

  spawn(density, size, pitch, spread, spray, reverseP, frozen) {
    if (this.count >= MAX_GRAINS) return;
    const sr = sampleRate, n = this.n;
    const sz = Math.min(1, Math.max(0.005, size * (0.75 + this.rand() * 0.5)));
    let len = Math.floor(sz * sr);
    let semis = pitch + (this.rand() * 2 - 1) * spread;
    semis = this.quantizeSemis(semis);
    let rate = Math.pow(2, semis / 12);
    if (rate < 0.125) rate = 0.125; else if (rate > 8) rate = 8;
    const rev = this.rand() < reverseP;
    let span = len * rate;
    const room = n - 8;
    if (span > room * 0.5) { rate = Math.max(0.125, (room * 0.5) / len); span = len * rate; }
    const minOff = rev ? 4 : span + 4;
    const maxOff = Math.min(spray * sr + minOff, room - span);
    const off = maxOff > minOff ? minOff + this.rand() * (maxOff - minOff) : minOff;
    if (off + span > room) return;
    let p = this.w - off;
    if (p < 0) p += n;
    const g = this.count++;
    this.pos[g] = p;
    this.inc[g] = rev ? -rate : rate;
    this.age[g] = 0;
    this.len[g] = Math.max(16, len);
    const pan = (this.rand() * 2 - 1) * 0.85;
    const th = (pan + 1) * Math.PI * 0.25;
    const amp = 1.25 / Math.sqrt(Math.max(1, density * sz));
    this.ampL[g] = Math.cos(th) * amp;
    this.ampR[g] = Math.sin(th) * amp;
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const outL = out[0], outR = out[1] || out[0];
    const N = outL.length;
    const inp = inputs[0];
    const inL = inp && inp[0] && inp[0].length ? inp[0] : null;
    const inR = inp && inp[1] && inp[1].length ? inp[1] : inL;

    const density = params.density[0], size = params.size[0], pitch = params.pitch[0];
    const spread = params.pitchSpread[0], spray = params.spray[0], rev = params.reverse[0];
    const frozen = params.freeze[0] > 0.5;
    const fb = frozen ? 0 : Math.min(0.7, Math.max(0, params.feedback[0]));
    const bufL = this.bufL, bufR = this.bufR, n = this.n;
    const sr = sampleRate;
    let w = this.w;
    let fbL = this.fbL, fbR = this.fbR;
    let until = this.untilNext;
    const meanGap = density > 0.05 ? sr / density : 1e12;

    for (let i = 0; i < N; i++) {
      // record
      if (!frozen) {
        let xl = inL ? inL[i] : 0, xr = inR ? inR[i] : 0;
        if (fb > 0) { xl += fb * fbL; xr += fb * fbR; }
        bufL[w] = xl; bufR[w] = xr;
        w++; if (w >= n) w = 0;
      }
      // spawn
      until -= 1;
      if (until <= 0) {
        this.w = w;
        this.spawn(density, size, pitch, spread, spray, rev, frozen);
        until = meanGap * (0.4 + 1.2 * this.rand());
      }
      // grains
      let sL = 0, sR = 0;
      for (let g = 0; g < this.count; ) {
        const age = this.age[g], len = this.len[g];
        if (age >= len) {                                  // retire: swap with last
          const last = --this.count;
          if (g !== last) {
            this.pos[g] = this.pos[last]; this.inc[g] = this.inc[last]; this.age[g] = this.age[last];
            this.len[g] = this.len[last]; this.ampL[g] = this.ampL[last]; this.ampR[g] = this.ampR[last];
          }
          continue;
        }
        const wp = (age / len) * HANN_N, wi = wp | 0;
        const win = HANN[wi] + (HANN[wi + 1] - HANN[wi]) * (wp - wi);
        let p = this.pos[g];
        const i0 = p | 0, fr = p - i0;
        const i1 = i0 + 1 >= n ? 0 : i0 + 1;
        const l = bufL[i0] + (bufL[i1] - bufL[i0]) * fr;
        const r = bufR[i0] + (bufR[i1] - bufR[i0]) * fr;
        sL += l * win * this.ampL[g];
        sR += r * win * this.ampR[g];
        p += this.inc[g];
        if (p >= n) p -= n; else if (p < 0) p += n;
        this.pos[g] = p;
        this.age[g] = age + 1;
        g++;
      }
      outL[i] = sL; outR[i] = sR;
      if (fb > 0) {
        // cheap bounded soft clip in the feedback path
        fbL = sL / (1 + Math.abs(sL) * 0.6); fbR = sR / (1 + Math.abs(sR) * 0.6);
      } else { fbL = 0; fbR = 0; }
    }
    // keep the spawn timer from drifting to a huge value when density is 0
    this.untilNext = until > 1e11 ? 0 : until;
    this.w = w; this.fbL = fbL; this.fbR = fbR;
    if (out[2]) { /* only stereo supported */ }
    return true;
  }
}

registerProcessor('granular-fx', GranularFX);
