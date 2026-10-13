/**
 * Texture — continuous noise-based layers: wind, water, rustle, crackle, hiss, each with
 * modulated filters. Changing `kind` crossfades to a freshly built chain; the old chain is stopped
 * and disconnected after the fade.
 *
 *   new Texture(engine, channel, patch).start(t).set({kind, level, tone}, t).stop(t)
 */
import { mulberry32 } from '../../core/rng.js';
import { Scope, num, clamp, fclamp, destOf, recordPatch } from '../fx/util.js';

export const TEXTURE_KINDS = ['wind', 'water', 'rustle', 'crackle', 'hiss'];

export const TEXTURE_DEFAULTS = Object.freeze({
  kind: 'wind',
  level: 0.5,     // 0..1.5
  tone: 0.5,      // 0..1 brightness
  motion: 1,      // modulation speed multiplier
  fade: 2.5,      // s crossfade / fade in / fade out
});

// per-kind output compensation so equal `level` sounds equally loud
const COMP = { wind: 1.0, water: 1.3, rustle: 1.7, crackle: 1.6, hiss: 0.5 };

/**
 * Crackle buffer as an incremental builder: step() does a slice of the work and returns true when finished, so the Score can make
 * it over many updates (a whole buffer in one go is ~15 ms of main thread). build-to-completion gives the identical buffer.
 */
function crackleBuilder(ctx, seconds, seed, rate) {
  const sr = ctx.sampleRate, len = Math.floor(seconds * sr);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const r = mulberry32(seed);
  let t = 0, ci = 0;
  return {
    buffer: b,
    step(slice = 1.2) {
      if (t < seconds) {
        const limit = t + slice;
        while (t < seconds && t < limit) {
          // clustered Poisson: occasionally a burst of several close pops
          t += -Math.log(1 - r()) / rate;
          const cluster = r() < 0.2 ? 2 + Math.floor(r() * 4) : 1;
          for (let c = 0; c < cluster; c++) {
            const start = Math.floor((t + c * (0.004 + r() * 0.02)) * sr);
            const amp = Math.pow(r(), 2.5) * 0.9 + 0.04;
            const tau = (0.0003 + r() * 0.0014) * sr;
            const n = Math.floor(tau * 7);
            const sign = r() < 0.5 ? -1 : 1;
            for (let i = 0; i < n && start + i < len; i++) {
              d[start + i] += amp * Math.exp(-i / tau) * (i < 2 ? sign : (r() * 2 - 1));
            }
          }
        }
        return false;
      }
      const end = Math.min(len, ci + 160000);
      for (; ci < end; ci++) d[ci] = clamp(d[ci], -1, 1);
      return ci >= len;
    },
  };
}
function buildCrackle(ctx, seconds, seed, rate) {
  const bld = crackleBuilder(ctx, seconds, seed, rate);
  while (!bld.step(1e9)) { /* run to completion */ }
  return bld.buffer;
}

const CRACKLE_SPECS = [[7.3, 4242, 11], [11.1, 2424, 7]];

/** every (kind, seconds) noise buffer the texture kinds loop: the Score pre-warms these gradually */
export const TEXTURE_NOISE = [['brown', 8], ['pink', 6], ['white', 3], ['white', 5], ['white', 4]];

export class Texture {
  constructor(engine, channel, patch = {}) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...TEXTURE_DEFAULTS, ...patch };
    this.chain = null;
    this.running = false;
    this.crackleBufs = null;
  }

  start(t = this.ctx.currentTime) {
    if (this.running) return this;
    const { ctx, engine } = this;
    recordPatch(engine, 'texture', this.p);
    this.master = new GainNode(ctx, { gain: 0 });
    this.lvl = new GainNode(ctx, { gain: clamp(num(this.p.level, 0.5), 0, 1.5) });
    this.master.connect(this.lvl); this.lvl.connect(this.dest);
    this.master.gain.setValueAtTime(0, t);
    this.master.gain.linearRampToValueAtTime(1, t + Math.max(0.05, num(this.p.fade, 2.5)));
    this.hLevel = engine.param('texture.level', this.lvl.gain);
    this.chain = this._build(this.p.kind, t);
    this.running = true;
    return this;
  }

  set(patch = {}, t = this.ctx.currentTime) {
    const { engine } = this;
    const prevKind = this.p.kind;
    Object.assign(this.p, patch);
    recordPatch(engine, 'texture', patch);
    if (patch.kind !== undefined) engine.record('texture.kindIndex', Math.max(0, TEXTURE_KINDS.indexOf(patch.kind)));
    if (!this.running) return this;
    if (patch.level !== undefined) this.hLevel.set(clamp(num(this.p.level, 0.5), 0, 1.5), t, 0.4);
    if (patch.kind !== undefined && patch.kind !== prevKind && TEXTURE_KINDS.includes(patch.kind)) {
      const fade = Math.max(0.05, num(this.p.fade, 2.5));
      const old = this.chain;
      old.out.gain.cancelScheduledValues(t);
      old.out.gain.setTargetAtTime(0, t, fade / 4);
      old.sc.stopAll(t + fade * 2.2);
      this.chain = this._build(patch.kind, t, fade);
    } else if (patch.tone !== undefined || patch.motion !== undefined) {
      this.chain.applyTone(clamp(num(this.p.tone, 0.5), 0, 1), t, 0.6);
    }
    return this;
  }

  stop(t = this.ctx.currentTime) {
    if (!this.running) return this;
    this.running = false;
    const fade = Math.max(0.05, num(this.p.fade, 2.5));
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, fade / 4);
    const end = t + fade * 2.2;
    const { master, lvl } = this;
    this.chain.sc.onDispose = () => { try { master.disconnect(); lvl.disconnect(); } catch (e) { /* gone */ } };
    this.chain.sc.stopAll(end);
    return this;
  }

  /** the two pop buffers (built once per voice; warmCrackle() lets the Score make them ahead of need, a slice per call) */
  _crackle(i) {
    if (!this.crackleBufs) this.crackleBufs = [];
    if (!this.crackleBufs[i]) { const s = CRACKLE_SPECS[i]; this.crackleBufs[i] = buildCrackle(this.ctx, s[0], s[1], s[2]); this._crackleB = null; }
    return this.crackleBufs[i];
  }
  /** one slice of building pop buffer `i`; true when it is complete */
  warmCrackle(i) {
    if (this.crackleBufs && this.crackleBufs[i]) return true;
    if (!this._crackleB || this._crackleB.i !== i) { const s = CRACKLE_SPECS[i]; this._crackleB = { i, bld: crackleBuilder(this.ctx, s[0], s[1], s[2]) }; }
    if (!this._crackleB.bld.step()) return false;
    if (!this.crackleBufs) this.crackleBufs = [];
    this.crackleBufs[i] = this._crackleB.bld.buffer; this._crackleB = null;
    return true;
  }

  _noise(sc, kind, seconds, t) {
    const buf = this.engine.noiseBuffer(kind, seconds);
    return sc.buf(buf, t, null, { loop: true, offset: this.engine.rng.float() * buf.duration * 0.9 });
  }

  _build(kind, t, fadeIn = 0.01) {
    const { ctx, engine } = this;
    const p = this.p;
    const sc = new Scope(ctx);
    const out = sc.gain(0);
    out.connect(this.master);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(COMP[kind] ?? 1, t + fadeIn + 0.01);
    const m = Math.max(0.1, num(p.motion, 1, 0, 8));
    const rnd = () => engine.rng.float();
    const lfo = (rate, depth, target, ...more) => {
      const o = sc.osc('sine', rate * m * (0.85 + 0.3 * rnd()), t);
      const g = sc.gain(depth);
      o.connect(g); g.connect(target);
      for (const x of more) g.connect(x);
      return g;
    };
    const tone0 = clamp(num(p.tone, 0.5), 0, 1);
    let applyTone = () => {};

    if (kind === 'wind') {
      const src = this._noise(sc, 'brown', 8, t);
      const bpA = sc.biquad('bandpass', 300, 0.9);
      const bpB = sc.biquad('bandpass', 900, 7);
      const gA = sc.gain(1.8), gB = sc.gain(0.5), sum = sc.gain(1);
      const swell = sc.gain(0.65);
      src.connect(bpA); src.connect(bpB);
      bpA.connect(gA); bpB.connect(gB); gA.connect(sum); gB.connect(sum);
      sum.connect(swell); swell.connect(out);
      lfo(0.043, 750, bpA.detune);
      lfo(0.071, 900, bpB.detune);
      lfo(0.037, 0.3, swell.gain);
      lfo(0.113, 0.12, swell.gain);
      applyTone = (tone, tt, tc) => {
        bpA.frequency.cancelScheduledValues(tt); bpA.frequency.setTargetAtTime(fclamp(180 + tone * 900, 60, 4000), tt, tc);
        bpB.frequency.cancelScheduledValues(tt); bpB.frequency.setTargetAtTime(fclamp(600 + tone * 1600, 100, 6000), tt, tc);
      };
    } else if (kind === 'water') {
      const src = this._noise(sc, 'pink', 6, t);
      const bands = [[420, 5, 2.3, 1.6], [900, 6, 3.7, 1.1], [1700, 7, 5.3, 0.7]];
      const mixer = sc.gain(1);
      const bps = [];
      for (const [f, q, rate, gv] of bands) {
        const bp = sc.biquad('bandpass', f, q);
        const g = sc.gain(0);
        src.connect(bp); bp.connect(g); g.connect(mixer);
        g.gain.value = gv * 0.5;
        lfo(rate, 1500, bp.detune);               // bubbling pitch wander
        lfo(rate * 0.73, gv * 0.45, g.gain);      // bubbling amplitude
        bps.push([bp, f]);
      }
      const hiss = sc.biquad('highpass', 3500, -3);
      const hg = sc.gain(0.07);
      const w = this._noise(sc, 'white', 3, t);
      w.connect(hiss); hiss.connect(hg); hg.connect(mixer);
      lfo(0.2, 0.03, hg.gain);
      mixer.connect(out);
      applyTone = (tone, tt, tc) => {
        for (const [bp, f] of bps) { bp.frequency.cancelScheduledValues(tt); bp.frequency.setTargetAtTime(fclamp(f * (0.55 + tone * 1.0), 100, 7000), tt, tc); }
        hiss.frequency.cancelScheduledValues(tt); hiss.frequency.setTargetAtTime(fclamp(2200 + tone * 3500, 500, 9000), tt, tc);
      };
    } else if (kind === 'rustle') {
      const src = this._noise(sc, 'pink', 6, t);
      const hp = sc.biquad('highpass', 2200, -3);
      const bp = sc.biquad('bandpass', 5000, 0.7);
      const amp = sc.gain(0);
      src.connect(hp); hp.connect(bp); bp.connect(amp); amp.connect(out);
      // random bursts: lowpassed noise → square → amplitude
      const mod = this._noise(sc, 'white', 5, t);
      const mlp = sc.biquad('lowpass', 11 * m, -3);
      const mg = sc.gain(16);
      const shaper = sc.add(new WaveShaperNode(ctx, { curve: Float32Array.from({ length: 1024 }, (_, i) => { const u = (i / 1023) * 2 - 1; return Math.min(1, u * u * 3.2); }) }));
      const mo = sc.gain(2.2);
      mod.connect(mlp); mlp.connect(mg); mg.connect(shaper); shaper.connect(mo); mo.connect(amp.gain);
      applyTone = (tone, tt, tc) => {
        bp.frequency.cancelScheduledValues(tt); bp.frequency.setTargetAtTime(fclamp(2600 + tone * 5200, 500, 12000), tt, tc);
        hp.frequency.cancelScheduledValues(tt); hp.frequency.setTargetAtTime(fclamp(900 + tone * 2400, 200, 8000), tt, tc);
      };
    } else if (kind === 'crackle') {
      const crackles = [this._crackle(0), this._crackle(1)];
      const sum = sc.gain(1);
      const hp = sc.biquad('highpass', 900, -3);
      const bp = sc.biquad('peaking', 3000, 0.8, 5);
      crackles.forEach((b, i) => {
        const s = sc.buf(b, t, null, { loop: true, offset: rnd() * b.duration, rate: 1 });
        const g = sc.gain(i === 0 ? 1.4 : 0.9);
        s.connect(g); g.connect(sum);
        // slow playback-rate wander varies density and pitch of the pops
        const l = sc.osc('sine', 0.05 + 0.04 * i, t);
        const lg = sc.gain(0.12);
        l.connect(lg); lg.connect(s.playbackRate);
      });
      sum.connect(hp); hp.connect(bp); bp.connect(out);
      applyTone = (tone, tt, tc) => {
        hp.frequency.cancelScheduledValues(tt); hp.frequency.setTargetAtTime(fclamp(400 + tone * 2400, 100, 8000), tt, tc);
        bp.frequency.cancelScheduledValues(tt); bp.frequency.setTargetAtTime(fclamp(1800 + tone * 4000, 500, 12000), tt, tc);
      };
    } else { // hiss
      const src = this._noise(sc, 'white', 4, t);
      const hp = sc.biquad('highpass', 4200, -3);
      const lp = sc.biquad('lowpass', 9000, -3);
      const swell = sc.gain(0.7);
      src.connect(hp); hp.connect(lp); lp.connect(swell); swell.connect(out);
      lfo(0.083, 0.28, swell.gain);
      lfo(0.31, 0.1, swell.gain);
      applyTone = (tone, tt, tc) => {
        lp.frequency.cancelScheduledValues(tt); lp.frequency.setTargetAtTime(fclamp(5500 + tone * 8000, 2000, 18000), tt, tc);
        hp.frequency.cancelScheduledValues(tt); hp.frequency.setTargetAtTime(fclamp(2500 + tone * 3500, 800, 10000), tt, tc);
      };
    }
    applyTone(tone0, t, 0.01);
    const chain = { sc, out, applyTone: (tone, tt, tc) => applyTone(tone, tt, tc), kind };
    sc.arm();
    return chain;
  }
}
