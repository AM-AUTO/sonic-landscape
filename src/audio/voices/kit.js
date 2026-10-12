/**
 * Kit — envelope-performed percussion. Every hit is a short-lived node graph (Scope) that disconnects
 * itself when its sources end. Metallic voices (hats, ride, crash, reverseSwell) tap two persistent
 * banks of six detuned square oscillators at 808/909-style ratios, so the cluster is always "ringing"
 * and each hit just opens an envelope on it (cheap, and every strike has a different phase).
 *
 *   new Kit(engine, channels, patch).hit(name, t, vel, opts)
 *   channels: a Channel, or an object like {main, cymbals, textural}
 *   opts: {pitch (frequency multiplier, 1=default), midi (absolute note for tuned hits), decay (s),
 *          pan (-1..1), tone (0..1 brightness), length (s, for swells/clouds)}
 */
import { Scope, num, clamp, fclamp, destOf, recordPatch, hannCurve } from '../fx/util.js';
import { midiToHz } from '../theory.js';

export const KIT_NAMES = Object.freeze([
  'kick', 'snare', 'rim', 'clap', 'hatC', 'hatO', 'ride', 'crash', 'tomL', 'tomM', 'tomH', 'timp', 'gong',
  'click', 'snap', 'grainBurst', 'breath', 'reverseSwell', 'metal', 'shaker',
]);

export const KIT_DEFAULTS = Object.freeze({
  level: 1,           // master kit trim
  humanize: 0.025,    // random pitch/level jitter
  kickFreq: 52, kickDecay: 0.55, kickClick: 0.35, kickSweep: 2.9,
  snareFreq: 188, snareNoise: 0.8, snareDecay: 0.2,
  hatBright: 1, hatDecay: 0.05, hatOpenDecay: 0.42,
  crashDecay: 4.3, crashBright: 1,
  rideDecay: 2.2,
  tomDecay: 0.42,
  timpFreq: 73, timpDecay: 3.2,
  gongFreq: 98, gongDecay: 8.5,
  metalFreq: 330,
  grainCount: 22,
  swellLength: 2.5, breathLength: 1.8,
});

const ROUTE = {
  kick: 'main', snare: 'main', rim: 'main', clap: 'main', tomL: 'main', tomM: 'main', tomH: 'main', timp: 'main',
  hatC: 'cymbals', hatO: 'cymbals', ride: 'cymbals', crash: 'cymbals', shaker: 'cymbals',
  gong: 'textural', click: 'textural', snap: 'textural', grainBurst: 'textural', breath: 'textural',
  reverseSwell: 'cymbals', metal: 'textural',
};
// peak level of each hit into its channel at vel=1 (before kit.level)
const LEVEL = {
  kick: 0.52, snare: 0.9, rim: 0.9, clap: 2.1, hatC: 0.9, hatO: 0.62, ride: 0.55, crash: 0.7,
  tomL: 0.5, tomM: 0.48, tomH: 0.46, timp: 0.46, gong: 0.5, click: 4.5, snap: 1.4,
  grainBurst: 0.55, breath: 0.6, reverseSwell: 0.5, metal: 0.32, shaker: 1.2,
};

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];
const CYM_FREQS = [260, 387, 470, 664, 686, 1016];

const perc = (param, t, peak, tc, atk = 0.001) => {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + atk);
  param.setTargetAtTime(0, t + atk, Math.max(0.0005, tc));
};

export class Kit {
  constructor(engine, channels, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.p = { ...KIT_DEFAULTS, ...patch };
    const c = channels || {};
    const isChannel = !!(c.input || (typeof AudioNode !== 'undefined' && c instanceof AudioNode));
    const any = isChannel ? c : (c.main || c.cymbals || c.textural || Object.values(c)[0]);
    this.dests = {
      main: destOf(isChannel ? c : (c.main || any)),
      cymbals: destOf(isChannel ? c : (c.cymbals || c.main || any)),
      textural: destOf(isChannel ? c : (c.textural || c.cymbals || c.main || any)),
    };
    this.route = { ...ROUTE, ...(this.p.route || {}) };
    this.grainWin = hannCurve(20);
    this._banks();
    this.warned = new Set();
  }

  _banks() {
    const { ctx } = this;
    const make = (freqs, gainEach) => {
      const out = new GainNode(ctx, { gain: 1 });
      const oscs = freqs.map((f, i) => {
        const o = new OscillatorNode(ctx, { type: 'square', frequency: f });
        const g = new GainNode(ctx, { gain: gainEach });
        o.connect(g); g.connect(out);
        o.start(0);
        return o;
      });
      return { out, oscs };
    };
    this.hatBank = make(HAT_FREQS, 0.16);
    this.cymBank = make(CYM_FREQS, 0.16);
  }

  /** stop the persistent oscillators and disconnect */
  dispose() {
    for (const b of [this.hatBank, this.cymBank]) {
      for (const o of b.oscs) { try { o.stop(); } catch (e) { /* ok */ } }
      try { b.out.disconnect(); } catch (e) { /* ok */ }
    }
  }

  _noise(sc, len, t, kind = 'white') {
    const buf = this.engine.noiseBuffer(kind, 12);
    const off = this.engine.rng.float() * Math.max(0, buf.duration - len - 0.05);
    return sc.buf(buf, t, t + len, { offset: off });
  }

  hit(name, t = this.ctx.currentTime, vel = 0.8, opts = {}) {
    const fn = this['_' + name];
    if (!KIT_NAMES.includes(name) || !fn) {
      if (!this.warned.has(name)) { this.warned.add(name); console.warn('[kit] unknown hit', name); }
      return this;
    }
    const { ctx, engine } = this, p = this.p;
    t = num(t, ctx.currentTime, 0, 1e7);
    vel = clamp(num(vel, 0.8), 0, 1.3);
    const o = opts || {};
    const sc = new Scope(ctx);
    const dest = this.dests[this.route[name]] || this.dests.main;
    const hum = clamp(num(p.humanize, 0.025), 0, 0.3);
    const jit = 1 + (engine.rng.float() * 2 - 1) * hum;
    const amp = LEVEL[name] * clamp(num(p.level, 1), 0, 2) * (0.12 + 0.88 * vel) * (1 + (engine.rng.float() * 2 - 1) * hum);
    const out = sc.gain(1);
    const pan = num(o.pan, 0, -1, 1);
    if (Math.abs(pan) > 0.01) {
      const pn = sc.add(new StereoPannerNode(ctx, { pan }));
      out.connect(pn); pn.connect(dest);
    } else out.connect(dest);
    recordPatch(engine, 'kit', p);
    const rec = (k, v) => engine.record('kit.' + name + '.' + k, v);
    rec('vel', vel); rec('amp', amp); rec('jitter', jit);
    if (o.pan !== undefined) rec('pan', pan);
    if (o.pitch !== undefined) rec('pitch', num(o.pitch, 1));
    if (o.decay !== undefined) rec('decay', num(o.decay, 0));
    if (o.tone !== undefined) rec('tone', num(o.tone, 0.5));
    if (o.length !== undefined) rec('length', num(o.length, 0));
    const end = fn.call(this, { t, vel, o, sc, out, amp, jit, rec, P: num(o.pitch, 1, 0.1, 8) * jit });
    sc.stopAll(Math.max(num(end, t + 1), t + 0.05));
    return this;
  }

  // ------------------------------------------------------------------ drums
  _kick({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const f0 = fclamp((o.midi != null ? midiToHz(o.midi) : p.kickFreq) * P, 25, 160);
    const d = num(o.decay, p.kickDecay, 0.08, 3);
    const sweep = num(p.kickSweep, 2.9, 1, 8) * (0.8 + 0.4 * vel);
    rec('freq', f0); rec('decayUsed', d);
    const env = sc.gain(0);
    perc(env.gain, t, amp * 0.9, d / 4.5, 0.0025);
    const body = sc.osc('sine', f0 * sweep, t);
    body.frequency.setValueAtTime(f0 * sweep, t);
    body.frequency.setTargetAtTime(f0, t + 0.002, 0.026);
    const tri = sc.osc('triangle', f0 * sweep, t);
    tri.frequency.setValueAtTime(f0 * sweep, t);
    tri.frequency.setTargetAtTime(f0, t + 0.002, 0.026);
    const tg = sc.gain(0.28);
    body.connect(env); tri.connect(tg); tg.connect(env); env.connect(out);
    // beater click
    const ck = this._noise(sc, 0.02, t);
    const hp = sc.biquad('highpass', 1800, -3);
    const cg = sc.gain(0);
    perc(cg.gain, t, amp * num(p.kickClick, 0.35, 0, 1) * (0.4 + 0.6 * vel), 0.0018, 0.0004);
    ck.connect(hp); hp.connect(cg); cg.connect(out);
    return t + d * 1.7 + 0.1;
  }

  _snare({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const f = fclamp(num(p.snareFreq, 188) * P, 80, 500);
    const d = num(o.decay, p.snareDecay, 0.05, 2);
    const tone = num(o.tone, 0.5, 0, 1);
    rec('freq', f);
    const t1 = sc.osc('triangle', f * 1.3, t);
    t1.frequency.setValueAtTime(f * 1.3, t); t1.frequency.setTargetAtTime(f, t + 0.002, 0.018);
    const t2 = sc.osc('sine', f * 1.78, t);
    t2.frequency.setValueAtTime(f * 2.3, t); t2.frequency.setTargetAtTime(f * 1.78, t + 0.002, 0.018);
    const tenv = sc.gain(0);
    perc(tenv.gain, t, amp * (0.36 + 0.3 * tone), 0.045, 0.001);
    const t2g = sc.gain(0.4);
    t1.connect(tenv); t2.connect(t2g); t2g.connect(tenv); tenv.connect(out);
    const n = this._noise(sc, d * 2.2 + 0.1, t);
    const hp = sc.biquad('highpass', 1200, -3);
    const bp = sc.biquad('bandpass', 3600 * (0.8 + 0.4 * tone), 0.65);
    const nenv = sc.gain(0);
    perc(nenv.gain, t, amp * num(p.snareNoise, 0.8, 0, 2) * 1.5, d / 4, 0.001);
    n.connect(hp); hp.connect(bp); bp.connect(nenv); nenv.connect(out);
    const n2 = this._noise(sc, d * 1.2, t);
    const hp2 = sc.biquad('highpass', 5200, -3);
    const e2 = sc.gain(0);
    perc(e2.gain, t, amp * 0.25, d / 3, 0.001);
    n2.connect(hp2); hp2.connect(e2); e2.connect(out);
    return t + d * 2.4 + 0.15;
  }

  _rim({ t, vel, sc, out, amp, P }) {
    const a = sc.osc('sine', 1667 * P, t), b = sc.osc('triangle', 455 * P, t);
    const hp = sc.biquad('highpass', 380, -3);
    const env = sc.gain(0);
    perc(env.gain, t, amp * 0.8, 0.0075, 0.0004);
    const bg = sc.gain(0.7);
    a.connect(hp); b.connect(bg); bg.connect(hp); hp.connect(env); env.connect(out);
    const n = this._noise(sc, 0.02, t);
    const bp = sc.biquad('bandpass', 4200, 1.2), ng = sc.gain(0);
    perc(ng.gain, t, amp * 0.35, 0.004, 0.0003);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    return t + 0.14;
  }

  _clap({ t, vel, o, sc, out, amp, rec }) {
    const d = num(o.decay, 0.24, 0.05, 2);
    const tone = num(o.tone, 0.5, 0, 1);
    const n = this._noise(sc, d + 0.15, t);
    const hp = sc.biquad('highpass', 700, -3);
    const bp = sc.biquad('bandpass', 1050 + tone * 700, 1.3);
    const env = sc.gain(0);
    const offs = [0, 0.0105, 0.0225, 0.037];
    offs.forEach((ofs, i) => {
      const ts = t + ofs + (this.engine.rng.float() - 0.5) * 0.002;
      const last = i === offs.length - 1;
      env.gain.setValueAtTime(0, ts);
      env.gain.linearRampToValueAtTime(amp * (last ? 1.0 : 0.7), ts + 0.0006);
      env.gain.setTargetAtTime(0, ts + 0.0007, last ? d / 4.5 : 0.0045);
    });
    n.connect(hp); hp.connect(bp); bp.connect(env); env.connect(out);
    return t + 0.037 + d * 1.8 + 0.1;
  }

  _hat({ t, vel, o, sc, out, amp, rec, P }, open) {
    const p = this.p;
    const d = open ? num(o.decay, p.hatOpenDecay, 0.05, 3) : num(o.decay, p.hatDecay, 0.01, 0.5);
    const tone = num(o.tone, 0.5, 0, 1);
    const bright = num(p.hatBright, 1, 0.3, 2);
    rec('decayUsed', d);
    const bp = sc.biquad('bandpass', (8200 + tone * 3000) * bright * P, 0.8);
    const hp = sc.biquad('highpass', 6200 * bright, -3);
    const env = sc.gain(0);
    sc.link(this.hatBank.out, bp);
    const boost = sc.gain(8);                 // square-cluster energy above 7 kHz is tiny; make it up here
    bp.connect(hp); hp.connect(boost); boost.connect(env); env.connect(out);
    if (open) {
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp * 0.85, t + 0.0012);
      env.gain.setTargetAtTime(amp * 0.5, t + 0.0012, 0.03);
      env.gain.setTargetAtTime(0, t + 0.05, d / 4.5);
    } else perc(env.gain, t, amp, d / 4, 0.0008);
    // noise sizzle
    const n = this._noise(sc, d * (open ? 6 : 5) + 0.05, t);
    const nhp = sc.biquad('highpass', 8500 * bright, -3);
    const ng = sc.gain(0);
    perc(ng.gain, t, amp * 0.3, d / 4, 0.001);
    n.connect(nhp); nhp.connect(ng); ng.connect(out);
    return t + d * (open ? 6.5 : 6) + 0.05;
  }
  _hatC(h) { return this._hat(h, false); }
  _hatO(h) { return this._hat(h, true); }

  _ride({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const d = num(o.decay, p.rideDecay, 0.2, 8);
    const tone = num(o.tone, 0.5, 0, 1);
    rec('decayUsed', d);
    const bp = sc.biquad('bandpass', (6000 + tone * 2500) * P, 1.0);
    const hp = sc.biquad('highpass', 3200, -3);
    const env = sc.gain(0);
    sc.link(this.cymBank.out, bp);
    bp.connect(hp); hp.connect(env); env.connect(out);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp * 1.4, t + 0.0015);
    env.gain.setTargetAtTime(amp * 0.55, t + 0.0015, 0.045);
    env.gain.setTargetAtTime(0, t + 0.12, d / 5.5);
    // stick/bell ping: inharmonic sine pair
    for (const [fr, lv, tau] of [[2680, 0.28, 0.16], [3930, 0.16, 0.1], [5350, 0.08, 0.06]]) {
      const s = sc.osc('sine', fr * P, t);
      const g = sc.gain(0);
      perc(g.gain, t, amp * lv, tau, 0.0005);
      s.connect(g); g.connect(out);
    }
    const n = this._noise(sc, 0.5, t);
    const nh = sc.biquad('highpass', 7000, -3), ng = sc.gain(0);
    perc(ng.gain, t, amp * 0.18, 0.1, 0.001);
    n.connect(nh); nh.connect(ng); ng.connect(out);
    return t + 0.12 + d * 1.5 + 0.1;
  }

  _crash({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const d = num(o.decay, p.crashDecay, 0.6, 9);
    const bright = num(p.crashBright, 1, 0.3, 2) * (0.7 + 0.5 * num(o.tone, 0.5, 0, 1));
    rec('decayUsed', d);
    const env = sc.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + 0.0018);
    env.gain.setTargetAtTime(amp * 0.5, t + 0.0018, 0.07);
    env.gain.setTargetAtTime(0, t + 0.28, d / 5.2);
    env.connect(out);
    // metallic cluster
    const mh = sc.biquad('highpass', 3000, -3), mb = sc.biquad('bandpass', 6800 * bright * P, 0.55), mg = sc.gain(0.75);
    sc.link(this.cymBank.out, mh);
    mh.connect(mb); mb.connect(mg); mg.connect(env);
    // noise wash, darkening over time
    const len = 0.28 + d * 1.5;
    const n = this._noise(sc, len, t);
    const nh = sc.biquad('highpass', 1800, -3);
    const lp = sc.biquad('lowpass', 12000, -3);
    lp.frequency.setValueAtTime(11500 * Math.min(1.2, bright), t);
    lp.frequency.setTargetAtTime(3200, t + 0.02, d * 0.33);
    const pk = sc.biquad('peaking', 5200, 0.7, 4);
    const ng = sc.gain(0.85);
    n.connect(nh); nh.connect(lp); lp.connect(pk); pk.connect(ng); ng.connect(env);
    return t + len + 0.1;
  }

  _tom({ t, vel, o, sc, out, amp, rec, P }, f, dm) {
    const p = this.p;
    const base = fclamp((o.midi != null ? midiToHz(o.midi) : f) * P, 40, 500);
    const d = num(o.decay, p.tomDecay * dm, 0.06, 3);
    rec('freq', base);
    const s = sc.osc('sine', base * 1.7, t);
    s.frequency.setValueAtTime(base * 1.7, t);
    s.frequency.setTargetAtTime(base, t + 0.002, 0.04);
    const s2 = sc.osc('triangle', base * 1.7 * 1.5, t);
    s2.frequency.setValueAtTime(base * 2.55, t); s2.frequency.setTargetAtTime(base * 1.5, t + 0.002, 0.04);
    const env = sc.gain(0), eg2 = sc.gain(0);
    perc(env.gain, t, amp, d / 4.5, 0.0015);
    perc(eg2.gain, t, amp * 0.18, d / 9, 0.0015);
    s.connect(env); s2.connect(eg2); env.connect(out); eg2.connect(out);
    const n = this._noise(sc, 0.05, t);
    const bp = sc.biquad('bandpass', base * 6, 0.9), ng = sc.gain(0);
    perc(ng.gain, t, amp * 0.3, 0.012, 0.0006);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    return t + d * 1.7 + 0.1;
  }
  _tomL(h) { return this._tom(h, 88, 1.25); }
  _tomM(h) { return this._tom(h, 126, 1.0); }
  _tomH(h) { return this._tom(h, 178, 0.8); }

  _timp({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const f = fclamp((o.midi != null ? midiToHz(o.midi) : p.timpFreq) * P, 35, 220);
    const d = num(o.decay, p.timpDecay, 0.4, 10);
    rec('freq', f);
    // membrane modes (ratios of a circular membrane in air-loaded timpani) with shorter decays up the series
    const modes = [[1, 1, 0.36], [1.5, 0.42, 0.24], [1.99, 0.3, 0.15], [2.44, 0.2, 0.1], [2.9, 0.12, 0.07]];
    modes.forEach(([r, lv, dm], i) => {
      const s = sc.osc('sine', f * r * (i === 0 ? 1.1 : 1.05), t);
      s.frequency.setValueAtTime(f * r * (i === 0 ? 1.1 : 1.05), t);
      s.frequency.setTargetAtTime(f * r, t + 0.003, i === 0 ? 0.11 : 0.07);   // pitch settles after the strike
      const g = sc.gain(0);
      perc(g.gain, t, amp * lv * (0.5 + 0.5 * vel), d * dm * 0.9 / 3.2, 0.004);
      s.connect(g); g.connect(out);
    });
    // soft mallet thud
    const n = this._noise(sc, 0.12, t);
    const lp = sc.biquad('lowpass', 520 + 500 * vel, -3), ng = sc.gain(0);
    perc(ng.gain, t, amp * 0.5, 0.022, 0.002);
    n.connect(lp); lp.connect(ng); ng.connect(out);
    return t + d * 1.2 + 0.2;
  }

  _gong({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const f = fclamp((o.midi != null ? midiToHz(o.midi) : p.gongFreq) * P, 40, 500);
    const D = num(o.decay, p.gongDecay, 2, 14);
    rec('freq', f);
    const partials = [[1, 1.0], [1.51, 0.8], [2.12, 0.7], [2.74, 0.55], [3.39, 0.5], [4.15, 0.38], [5.04, 0.3], [6.2, 0.22], [7.5, 0.16]];
    const bloom = 0.35 + 0.6 * num(o.tone, 0.5, 0, 1);
    partials.forEach(([r, lv], i) => {
      const dets = i < 3 ? [0, 0.0032 * (i + 1)] : [0];
      dets.forEach((dt, k) => {
        const fr = fclamp(f * r * (1 + dt), 20, 12000);
        const s = sc.osc('sine', fr, t);
        const g = sc.gain(0);
        const peak = amp * lv * (k ? 0.5 : 1) * 0.2;
        const att = 0.05 + bloom * (i / partials.length) * 3.2 + this.engine.rng.float() * 0.15;   // upper partials bloom later (up to ~2.5 s)
        const tau = (D / 5.5) * (1 - 0.55 * i / partials.length);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + att);
        g.gain.setTargetAtTime(0, t + att, tau);
        s.connect(g); g.connect(out);
      });
    });
    // shimmering noise bloom
    const len = D * 0.9;
    const n = this._noise(sc, len, t);
    const bp = sc.biquad('bandpass', 2600, 0.8), ng = sc.gain(0);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(amp * 0.07, t + 0.9 * bloom + 0.1);
    ng.gain.setTargetAtTime(0, t + 0.9 * bloom + 0.1, D / 6);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    // mallet strike
    const k = this._noise(sc, 0.08, t);
    const klp = sc.biquad('lowpass', 900, -3), kg = sc.gain(0);
    perc(kg.gain, t, amp * 0.35, 0.02, 0.002);
    k.connect(klp); klp.connect(kg); kg.connect(out);
    return t + D * 1.5 + 0.3;
  }

  // ------------------------------------------------------------------ textural
  _click({ t, vel, o, sc, out, amp, rec, P }) {
    const tone = num(o.tone, this.engine.rng.float(), 0, 1);
    const f = (1500 + tone * 7500) * P;
    rec('freq', f);
    const n = this._noise(sc, 0.02, t);
    const bp = sc.biquad('bandpass', f, 3.5);
    const env = sc.gain(0);
    perc(env.gain, t, amp * 1.4, num(o.decay, 0.0016, 0.0003, 0.05), 0.0002);
    n.connect(bp); bp.connect(env); env.connect(out);
    const th = sc.osc('sine', 160 * P, t), tg = sc.gain(0);
    perc(tg.gain, t, amp * 0.06, 0.004, 0.0006);
    th.connect(tg); tg.connect(out);
    return t + 0.12;
  }

  _snap({ t, vel, o, sc, out, amp, rec, P }) {
    const tone = num(o.tone, 0.5, 0, 1);
    const n = this._noise(sc, 0.06, t);
    const crush = sc.add(new WaveShaperNode(this.ctx, { curve: this.engine.crushCurve(3 + Math.round(tone * 2)) }));
    const pre = sc.gain(0.9);
    const hp = sc.biquad('highpass', 1300 + tone * 1500, -3);
    const env = sc.gain(0);
    perc(env.gain, t, amp * 1.0, num(o.decay, 0.012, 0.002, 0.2), 0.0004);
    n.connect(pre); pre.connect(crush); crush.connect(hp); hp.connect(env); env.connect(out);
    const s = sc.osc('square', 3200 * P, t);
    s.frequency.setValueAtTime(3200 * P, t); s.frequency.setTargetAtTime(700 * P, t, 0.004);
    const sg = sc.gain(0), sh = sc.biquad('lowpass', 5000, -3);
    perc(sg.gain, t, amp * 0.3, 0.006, 0.0004);
    s.connect(sh); sh.connect(sg); sg.connect(out);
    return t + 0.2;
  }

  _grainBurst({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const len = num(o.length, 0.34, 0.05, 3);
    const tone = num(o.tone, 0.5, 0, 1);
    const count = Math.round(clamp(num(p.grainCount, 22), 4, 48));
    rec('lengthUsed', len);
    const pans = [-0.8, 0, 0.8].map((v) => { const pn = sc.add(new StereoPannerNode(this.ctx, { pan: v })); pn.connect(out); return pn; });
    const rng = this.engine.rng;
    const lo = 500 + tone * 900, hi = 3200 + tone * 5000;
    let last = t;
    for (let i = 0; i < count; i++) {
      const gt = t + Math.pow(rng.float(), 1.4) * len;
      const gd = 0.005 + rng.float() * 0.02;
      const fr = (lo * Math.pow(hi / lo, rng.float())) * P;
      const type = rng.float() < 0.3 ? 'triangle' : 'sine';
      const s = sc.osc(type, fr, gt, gt + gd + 0.005);
      const g = sc.gain(0);
      g.gain.setValueCurveAtTime(this.grainWin, gt, gd);
      const lv = amp * (0.35 + 0.65 * rng.float()) * 0.55;
      const sc2 = sc.gain(lv);
      s.connect(g); g.connect(sc2); sc2.connect(pans[Math.floor(rng.float() * 3)]);
      last = Math.max(last, gt + gd);
    }
    return last + 0.05;
  }

  _breath({ t, vel, o, sc, out, amp, rec, P }) {
    const len = num(o.length, this.p.breathLength, 0.2, 10);
    const tone = num(o.tone, 0.5, 0, 1);
    rec('lengthUsed', len);
    const n = this._noise(sc, len + 0.3, t, 'pink');
    const bp = sc.biquad('bandpass', 700 * P, 1.1);
    bp.frequency.setValueAtTime(600 * P + tone * 300, t);
    bp.frequency.exponentialRampToValueAtTime((1900 + tone * 1500) * P, t + len * 0.55);
    bp.frequency.exponentialRampToValueAtTime(900 * P, t + len);
    const env = sc.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp * 1.4, t + len * 0.4);
    env.gain.setTargetAtTime(0, t + len * 0.42, len * 0.16);
    n.connect(bp); bp.connect(env); env.connect(out);
    return t + len + 0.3;
  }

  _reverseSwell({ t, vel, o, sc, out, amp, rec, P }) {
    const len = num(o.length, this.p.swellLength, 0.2, 12);
    const tone = num(o.tone, 0.5, 0, 1);
    rec('lengthUsed', len);
    const env = sc.gain(0.0001);
    // reversed exponential decay: grows exponentially, peaks exactly at t+len, then is cut
    env.gain.setValueAtTime(Math.max(0.0001, amp * 0.03), t);           // -30 dB start so the rise is audible early
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, amp), t + len);
    env.gain.setTargetAtTime(0, t + len, 0.012);
    env.connect(out);
    const n = this._noise(sc, len + 0.15, t);
    const lp = sc.biquad('lowpass', 900, -3);
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(11000 * (0.7 + 0.3 * tone), t + len);
    const hp = sc.biquad('highpass', 500, -3);
    hp.frequency.setValueAtTime(400, t);
    hp.frequency.exponentialRampToValueAtTime(3500, t + len);
    const ng = sc.gain(0.9);
    n.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(env);
    const mh = sc.biquad('highpass', 4000, -3), mg = sc.gain(0.45);
    sc.link(this.cymBank.out, mh);
    mh.connect(mg); mg.connect(env);
    return t + len + 0.15;
  }

  _metal({ t, vel, o, sc, out, amp, rec, P }) {
    const p = this.p;
    const f = fclamp((o.midi != null ? midiToHz(o.midi) : p.metalFreq) * P, 80, 3000);
    const d = num(o.decay, 0.7, 0.1, 4);
    rec('freq', f);
    const env = sc.gain(0);
    perc(env.gain, t, amp * 0.9, d / 4, 0.001);
    const car = sc.osc('sine', f, t);
    const car2 = sc.osc('sine', f * 2.76, t);
    const g2 = sc.gain(0.3);
    const hp = sc.biquad('highpass', 260, -3);
    car.connect(hp); car2.connect(g2); g2.connect(hp); hp.connect(env); env.connect(out);
    for (const [ratio, idx, tau] of [[1.4142, 5.5, 0.14], [3.13, 3.2, 0.09]]) {
      const m = sc.osc('sine', f * ratio, t);
      const mg = sc.gain(0);
      mg.gain.setValueAtTime(f * ratio * idx * (0.5 + 0.5 * vel), t);
      mg.gain.setTargetAtTime(f * ratio * 0.15, t + 0.001, tau);
      m.connect(mg); mg.connect(car.frequency);
      if (ratio > 3) mg.connect(car2.frequency);
    }
    return t + d * 1.7 + 0.1;
  }

  _shaker({ t, vel, o, sc, out, amp, rec, P }) {
    const d = num(o.decay, 0.07, 0.015, 0.6);
    const tone = num(o.tone, 0.5, 0, 1);
    const n = this._noise(sc, d * 7 + 0.05, t);
    const bp = sc.biquad('bandpass', (5600 + tone * 2400) * P, 1.0);
    const hp = sc.biquad('highpass', 2600, -3);
    const env = sc.gain(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp * 1.2, t + 0.012 + d * 0.2);
    env.gain.setTargetAtTime(0, t + 0.012 + d * 0.2, d / 3.5);
    n.connect(bp); bp.connect(hp); hp.connect(env); env.connect(out);
    return t + d * 7 + 0.05;
  }
}
