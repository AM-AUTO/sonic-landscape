/**
 * NoiseWall — the noise layer of the palette (the sketches' windNoise, scrape, noiseBursts and dust).
 *
 *   band     looped pink noise through a band-pass whose centre breathes (two slow LFOs) between `lo` and
 *            lo + (1500 + 3500·wall) Hz, its level breathing too: band-limited moving noise
 *   dust     a looped crackle bed (sparse clicks with tiny rings), quiet, always there under the wall
 *   scrapes  contact-mic gestures (band-limited noise with sharp irregular spikes) and short shaped noise bursts,
 *            pre-rendered per level and fired as one-shots by scrapeStep() at a density set by `scrape`
 *
 * Controls: wall 0..1 (level + brightness), scrape 0..1 (density + level), dark 0..1 (night: darker band, fewer highs).
 *
 *   new NoiseWall(engine, channel).start(t).set({wall, scrape, dark}, t, tc).warmItems() / scrapeStep(t, beat, rng)
 */
import { mulberry32 } from '../../core/rng.js';
import { num, clamp, destOf } from '../fx/util.js';
import { scrape as renderScrape, dust as renderDust } from './dsp.js';

export const NOISEWALL_DEFAULTS = Object.freeze({ wall: 0.3, scrape: 0.3, dark: 0, lo: 400, fadeIn: 3 });

export class NoiseWall {
  constructor(engine, channel, patch = {}) {
    this.engine = engine; this.ctx = engine.ctx;
    this.dest = destOf(channel);
    this.p = { ...NOISEWALL_DEFAULTS, ...patch };
    this.running = false;
    this.scrapes = []; this.dustBuf = null;
    this.seed = 1;
  }

  start(t = this.ctx.currentTime) {
    if (this.running) return this;
    const { ctx, engine } = this;
    const G = (v) => new GainNode(ctx, { gain: v });
    const nodes = this.nodes = [];
    const keep = (n) => { nodes.push(n); return n; };
    const buf = engine.noiseBuffer('pink', 12);
    const src = keep(new AudioBufferSourceNode(ctx, { buffer: buf, loop: true }));
    const bp = keep(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1200, Q: 0.7 }));
    const hp = keep(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 160, Q: -3 }));
    const l1 = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 0.05 })), l1g = keep(G(900));        // cents: the centre breathes
    const l2 = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 0.031 })), l2g = keep(G(500));
    l1.connect(l1g); l1g.connect(bp.detune); l2.connect(l2g); l2g.connect(bp.detune);
    const swell = keep(G(0.7));
    const l3 = keep(new OscillatorNode(ctx, { type: 'sine', frequency: 0.07 })), l3g = keep(G(0.3));       // and the level
    l3.connect(l3g); l3g.connect(swell.gain);
    const bandG = keep(G(0)), fade = keep(G(0));
    src.connect(hp); hp.connect(bp); bp.connect(swell); swell.connect(bandG); bandG.connect(fade); fade.connect(this.dest);
    this.scrapeOut = keep(G(1)); this.scrapeOut.connect(fade);
    this.dustG = keep(G(0)); this.dustG.connect(fade);
    fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(1, t + Math.max(0.05, num(this.p.fadeIn, 3)));
    src.start(t, engine.rng.float() * buf.duration * 0.9);
    for (const o of [l1, l2, l3]) o.start(t);
    this.src = src; this.fade = fade;
    this.h = {
      band: engine.param('noisewall.level', bandG.gain),
      centre: engine.param('noisewall.centre', bp.frequency),
      dust: engine.param('noisewall.dust', this.dustG.gain),
    };
    this.running = true;
    this.set({ ...this.p }, t, 0.5);
    return this;
  }

  /** per-level pre-render: a few scrape gestures and a dust loop (each item is one small buffer) */
  warmItems(seed = 1) {
    this.seed = seed; this.scrapes = []; this.dustBuf = null;
    const sr = this.ctx.sampleRate, rng = mulberry32((seed * 2654435761) >>> 0);
    const items = [];
    for (let k = 0; k < 6; k++) items.push(() => { this.scrapes.push(this._buf(renderScrape(sr, rng, { fc: 1500 + 1300 * rng(), level: 0.7 }))); });
    items.push(() => { this.dustBuf = this._buf(renderDust(sr, rng, 4.3, 9, 0.6)); this._startDust(); });
    return items;
  }

  _buf(data) {
    const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    b.getChannelData(0).set(data);
    return b;
  }

  _startDust() {
    if (!this.running || !this.dustBuf) return;
    const t = this.ctx.currentTime + 0.05;
    if (this.dustSrc) { try { this.dustSrc.stop(t + 0.5); } catch (e) { /* gone */ } }
    const d = new AudioBufferSourceNode(this.ctx, { buffer: this.dustBuf, loop: true });
    d.connect(this.dustG); d.start(t);
    const old = this.dustSrc;
    this.dustSrc = d;
    if (old) old.onended = () => { try { old.disconnect(); } catch (e) { /* gone */ } };
  }

  set(patch = {}, t = this.ctx.currentTime, tc = 0.4) {
    Object.assign(this.p, patch);
    if (!this.running) return this;
    const p = this.p, w = clamp(num(p.wall, 0.3), 0, 1), dark = clamp(num(p.dark, 0), 0, 1);
    if (patch.wall !== undefined) this.h.band.set(1.5 * w, t, tc);
    if (patch.wall !== undefined || patch.dark !== undefined) {
      const lo = num(p.lo, 400, 60, 4000), hi = lo + (1500 + 3500 * w) * (1 - 0.55 * dark);
      this.h.centre.set(Math.sqrt(lo * hi), t, tc);
      this.h.dust.set(0.05 + 0.06 * (1 - dark) * (0.5 + w), t, tc);
    }
    return this;
  }

  /**
   * Called once per beat by the score: maybe fire a scrape gesture at t (density and level from `scrape`, the arrangement's
   * scrape layer). Returns true when one fired (the caller charges its node budget).
   */
  scrapeStep(t, level, rng) {
    if (!this.running || !this.scrapes.length || !(level > 0.02)) return false;
    if (rng.float() > 0.12 + 0.3 * level) return false;
    const b = this.scrapes[rng.int(0, this.scrapes.length - 1)];
    const src = new AudioBufferSourceNode(this.ctx, { buffer: b, playbackRate: 0.85 + 0.3 * rng.float() });
    const g = new GainNode(this.ctx, { gain: (0.25 + 0.5 * level) * (0.6 + 0.5 * rng.float()) * (1 - 0.4 * clamp(this.p.dark, 0, 1)) });
    const pan = new StereoPannerNode(this.ctx, { pan: rng.float() * 1.2 - 0.6 });
    src.connect(g); g.connect(pan); pan.connect(this.scrapeOut);
    src.start(t);
    src.onended = () => { try { src.disconnect(); g.disconnect(); pan.disconnect(); } catch (e) { /* gone */ } };
    this.engine.record('noisewall.scrape', level);
    return true;
  }

  stop(t = this.ctx.currentTime, release = 3) {
    if (!this.running) return this;
    this.running = false;
    this.fade.gain.cancelScheduledValues(t); this.fade.gain.setTargetAtTime(0, t, release / 4);
    const end = t + release * 2;
    for (const n of [...this.nodes, this.dustSrc].filter(Boolean)) if (typeof n.stop === 'function') { try { n.stop(end); } catch (e) { /* gone */ } }
    const nodes = this.nodes;
    this.src.onended = () => { for (const n of nodes) { try { n.disconnect(); } catch (e) { /* gone */ } } };
    return this;
  }
}
