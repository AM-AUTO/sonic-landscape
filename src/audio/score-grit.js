/**
 * GritBand — the score's wiring of the grit palette voices (palette.js, stage.ensureGrit): what the arrangement's
 * palette layers do on the stanza downbeat, on every 16th, and at the 10 Hz control tick.
 *
 *   downbeat   the resonators take the layer level (and the current ground pitch); a glimpse of the ground on chosen
 *              stanzas; the eroding loop (re-)captures on the form steps; the contra cycle starts when it comes in;
 *              the night darkens the wall
 *   16th       contra A / B on their own periods (logged in score.contraLog for the guardrails), grain clicks,
 *              the arp's eighths, the eroding loop's next pass on each bar, scrapes on the beat
 *   control    the palette channels (gain from the layer ramps, sends / cutoff / crush like the other channels), the
 *              sub-drone's sub / beat / wall, the noise wall
 *   pickups    buffer-repeat stutters of the level's played material, or crushed reverse swells, landing on the downbeat
 *   artefacts  the entry gesture: a crushed hit, a resonator bloom and a short stutter
 *
 * Layer levels change only on stanza downbeats (score._layersAt ramps them over a beat, or cuts them on a hard cut);
 * continuous expression (energy, altitude, drift breathing) stays continuous on top.
 */
import { midiToHz } from './theory.js';
import { ensureGrit } from './stage.js';
import { GRIT_CH_NAMES } from './palette.js';
import { applyChannelMods, clamp } from './macros.js';
import { setSend } from './voices/io.js';

const TAU = Math.PI * 2;
const CONTRA_LOG_MAX = 8000;

export class GritBand {
  constructor(score) {
    this.S = score;
    this.g = null; this.pal = null;
    this.started = false;
    this.groundIdx = 0; this.glimpseIdx = 0; this.arpStep = 0;
    this.contraOrigin = 0; this.contraOn = false;
    this.pendingGround = false;
    this.captured = false;
  }

  get ch() { return this.S.stage.ch; }

  /** a new level in the grit palette: (re)start the voices, retune the drone, queue the level's pre-renders */
  setLevel(pal, prof, t, first) {
    const S = this.S;
    const g = this.g = ensureGrit(S.stage);
    this.pal = pal;
    if (!this.started) {
      g.sub.root = pal.droneRoot;
      g.sub.start(t + 0.05); g.wall.start(t + 0.05); g.res.start(t + 0.05); g.arp.start(t + 0.05);
      this.started = true;
    } else g.sub.setRoot(pal.droneRoot, t, first ? 0.1 : 4);
    this.groundIdx = 0; this.glimpseIdx = 0; this.arpStep = 0;
    this.contraOrigin = 0; this.contraOn = false; this.captured = false; this.pendingGround = false; this._v = null;
    g.res.setLevel(0, t, 0.1);
    g.res.setTargets(this.resTargets(), 0.5, t);
    // with the engine resonators, the grain clicks and the noise wall also ring them a little (pitch inside the noise)
    setSend(S.engine, this.ch.grain, 'res', 0.18, t, 0.5);
    setSend(S.engine, this.ch.noise, 'res', 0.08, t, 0.5);
    const seed = ((S.seed * 7919) ^ (prof.root * 104729)) >>> 0;
    const beat = 60 / prof.bpm, bar = beat * 4;
    // pre-render order: the played source, the day-register glimpse tines, the eroded passes, grains / metal, the noise
    // wall's scrapes and dust, then the night-register tines and the ghost pitches (the level's scale tones an octave up)
    const er = g.erode.warmItems(seed, { source: pal.erode.source, midis: pal.erode.voicing.map((iv) => pal.droneRoot + iv), notes: pal.ground.map((n) => ({ midi: n.midi - 12, beats: n.beats })), beat, barSec: bar });
    const reg = (o) => pal.ground.map((n) => ({ midi: n.midi + o, grace: n.grace === null ? null : n.grace + o }));
    const ghosts = [];
    for (const m of [prof.mode, prof.dawn, prof.night].filter(Boolean)) for (const iv of m) ghosts.push({ midi: prof.root + 12 + iv, grace: null }, { midi: prof.root + 24, grace: null });
    return [
      er[0], ...g.glimpse.warmItems(seed, reg(-12)), ...er.slice(1),
      ...g.grain.warmItems(seed, { metalMidi: pal.droneRoot + 7 + 24, material: () => g.erode.material }),
      ...g.wall.warmItems(seed),
      ...g.glimpse.warmItems(seed + 1, [...reg(-24), ...ghosts]),
    ];
  }

  /** silence the voices (a level in the legacy palette) */
  sleep(t) {
    if (!this.started || !this.g) return;
    const g = this.g;
    g.sub.stop(t); g.wall.stop(t); g.res.stop(t); g.arp.stop(t);
    this.started = false;
  }

  // ------------------------------------------------------------------------------------------------ pitch
  groundNote(k = this.groundIdx) { const gr = this.pal.ground; return gr.length ? gr[((k % gr.length) + gr.length) % gr.length] : { midi: this.pal.root + 12, beats: 1, grace: null }; }

  /** the resonator targets: the ground's pitch an octave down and a fourth below that, the drone root and fifth, the chord root */
  resTargets() {
    const pal = this.pal, S = this.S, gm = this.groundNote().midi, r = pal.droneRoot;
    const T = [
      { f: midiToHz(gm - 12), g: 0.93, gain: 0.5, pan: -0.2 },
      { f: midiToHz(gm - 17), g: 0.93, gain: 0.25, pan: 0.25 },
      { f: midiToHz(r), g: 0.97, gain: 0.35, pan: 0 },
      { f: midiToHz(r + 7), g: 0.97, gain: 0.3, pan: 0.1 },
    ];
    if (S.entry && S.profile) {
      let c = S.midi(S.entry.d || 0, 0);
      while (c < r + 12) c += 12; while (c >= r + 24) c -= 12;
      T.push({ f: midiToHz(c), g: 0.95, gain: 0.15, pan: -0.1 });
    }
    return T;
  }

  /** an index contour walks the ground one note on (or back); the resonators retune on the next bar line */
  advanceGround(dir, now) {
    if (!this.g) return;
    this.groundIdx += dir >= 0 ? 1 : -1;
    if (this.pendingGround) return;
    this.pendingGround = true;
    this.S.atGrid('bar', now + 0.02, (t) => {
      this.pendingGround = false;
      this.g.res.setTargets(this.resTargets(), this.S.beat(), t);
      this.S.log('ground', { at: +t.toFixed(3), idx: this.groundIdx, midi: this.groundNote().midi });
    });
  }

  onChord(t) { if (this.g) this.g.res.setTargets(this.resTargets(), Math.min(2, this.S.beat() * 2), t); }

  // ------------------------------------------------------------------------------------------------ the downbeat
  onStanza(arr, x, prev) {
    const S = this.S, g = this.g, pal = this.pal, L = arr.layers, b = S.beat();
    if (!g) return;
    // the resonators take the layer level (with the engine worklet: scaled targets, and the bed's energy level as it stands
    // at the downbeat — the fallback's res channel carries both in its gain)
    g.res.setLevel(g.res.native ? L.res * (this.bedMul ?? 0.3) : 1, x.t, b);
    if (g.res.native) g.res.setTargets(this.resTargets(), b, x.t);
    // the grains and the noise wall ring the engine resonators a little more as the groove / the wall come up
    setSend(S.engine, this.ch.grain, 'res', 0.1 + 0.12 * L.grain, x.t, b / 2);
    setSend(S.engine, this.ch.noise, 'res', 0.04 + 0.1 * L.wall, x.t, b / 2);
    g.arp.set({ level: 0.42 + 0.16 * clamp(arr.energy ?? 0.4, 0, 1) }, x.t);
    g.sub.set({ dark: arr.dark || 0 }, x.t, b / 2);
    g.wall.set({ dark: arr.dark || 0 }, x.t, b / 2);
    g.arp.set({ dark: arr.dark || 0 }, x.t);
    // contra: the cycle starts when the layers come in (and then runs on across stanzas: a real polymeter)
    const on = L.contraA > 0.02 || L.contraB > 0.02;
    if (on && !this.contraOn) this.contraOrigin = x.step;
    this.contraOn = on;
    // the eroding loop captures one bar on this downbeat
    if (arr.erodeCapture) {
      const ok = g.erode.capture(x.t, S.cond.barDur, S.cond.stanzaBars, pal.erode.ageStanzas);
      if (ok) { this.captured = true; this.lastCapture = x.stanza; S.stats.captures = (S.stats.captures || 0) + 1; S.log('capture', { at: +x.t.toFixed(3), stanza: x.stanza, form: arr.formStep }); }
    }
    arr.captured = this.captured;
    arr.capturedStanza = arr.erodeCapture && this.captured && this.lastCapture === x.stanza ? x.stanza : (prev && prev.capturedStanza);
    if (arr.glimpse && L.glimpse > 0.02) this.glimpse(x.t, L.glimpse, arr.dark ? -24 : -12, x.stanza);
  }

  /** a few notes of the ground on worn tines from t (about a bar) */
  glimpse(t, level, oct = -12, stanza = null) {
    const S = this.S, pal = this.pal, n = Math.max(1, pal.glimpse.notes | 0);
    const notes = [];
    for (let k = 0; k < n; k++) { const x = this.groundNote(this.glimpseIdx + k); notes.push({ midi: x.midi + oct, grace: x.grace === null ? null : x.grace + oct }); }
    this.glimpseIdx += n;
    const played = this.g.glimpse.phrase(notes, t, pal.glimpse.spread * S.beat(), 0.32 * level);
    S.count('notes', 'glimpse', played);
    S.stats.glimpses = (S.stats.glimpses || 0) + 1;
    S.log('glimpse', { at: +t.toFixed(3), stanza, notes: notes.map((x) => x.midi).join(' ') });
  }

  // ------------------------------------------------------------------------------------------------ every 16th
  onStep(s, L, arr) {
    const S = this.S, g = this.g, pal = this.pal, rng = S.rng, C = S.C;
    if (!g) return;
    // contra A / B on their own periods against the 4 of the beat
    if (this.contraOn) {
      const surge = arr.contraSurge ? pal.surge.factor : 1;
      for (const k of ['A', 'B']) {
        const lv = L['contra' + k] * surge;
        if (!(lv > 0.02)) continue;
        const c = pal.contra[k], rel = s.step - this.contraOrigin, ph = ((rel % c.period) + c.period) % c.period;
        if (!c.offsets.includes(ph)) continue;
        const t = S.at(s.t + (rng.float() - 0.5) * 0.008);
        const snapAccent = c.offsets.length > 1 && ph === c.offsets[0] ? 0.75 : 1;        // the snap: the short first note lighter
        const ok = k === 'A' ? g.grain.click(t, 0.42 * lv * snapAccent, 0.4, rng) : g.grain.metal(t, 0.3 * lv, -0.4, rng);
        if (ok) {
          if (S.contraLog.length < CONTRA_LOG_MAX) S.contraLog.push({ t: +s.t.toFixed(4), layer: k, period: c.period / 4, step: s.step });
          S.count('notes', 'contra' + k);
        }
      }
    }
    // grain clicks: a broken scatter off the beat, density with energy
    if (L.grain > 0.02 && (s.i16 & 3) !== 0 && rng.float() < 0.12 * L.grain * (0.5 + C.e) && S.budget >= 4) {
      S.budget -= 4;
      if (g.grain.click(S.at(s.t + (rng.float() - 0.5) * 0.01), 0.3 * L.grain * (0.6 + 0.6 * rng.float()), rng.float() * 1.4 - 0.7, rng)) S.count('notes', 'grain');
    }
    // the arp: eighths of the ground, skipping, gliding, accents in fives, a register shift by stanza
    if (pal.arp && L.arp > 0.02 && (s.i16 & 1) === 0) this._arp(s);
    // the eroding loop: the next (older) pass on each bar line
    if (s.i16 === 0) g.erode.onBar(s.t, S.cond.barDur, L.erode);
    // scrapes on the beat
    if ((s.i16 & 3) === 0 && L.scrape > 0.02 && S.budget >= 3 && g.wall.scrapeStep(s.t, L.scrape, rng)) { S.budget -= 3; S.count('notes', 'scrape'); }
  }

  _arp(s) {
    const S = this.S, pal = this.pal, rng = S.rng, b = this.arpStep++;
    const play = pal.arpPlay[((s.stanza % pal.arpPlay.length) + pal.arpPlay.length) % pal.arpPlay.length];
    if (rng.float() > play) return;                                            // the cell is implied, never spelled out
    const n = this.groundNote(b), stz = ((s.stanza % 5) + 5) % 5;
    const oct = stz === 2 && b % 5 === 0 ? 12 : stz === 4 && b % 7 === 3 ? -12 : 0;
    const accent = b % 5 === 0 ? 1 : 0.55;                                     // accents every 5 eighths across the 8-step bar
    const dur = 2 * s.sd * (0.6 + 0.7 * rng.float());
    const t = S.at(s.t + (rng.float() - 0.5) * 0.012);
    this.g.arp.note(n.midi - 24 + oct, t, dur, accent, 0.5 + 0.5 * Math.sin(TAU * 0.06 * s.t));
    S.count('notes', 'arp');
  }

  /** a contour tick in the grit palette: a grain click, now and then the walked ground note on a worn tine */
  tick(t, vel, bright) {
    const S = this.S, g = this.g, rng = S.rng;
    if (!g) return false;
    const ok = g.grain.click(t, clamp(0.25 + 0.5 * vel + 0.2 * bright, 0.1, 0.9), rng.float() * 1.2 - 0.6, rng);
    if (rng.float() < 0.18) {
      const n = this.groundNote();
      if (g.glimpse.has(n.midi - 12)) { g.glimpse.phrase([{ midi: n.midi - 12, grace: null }], t + 0.004, 0, 0.18 * vel + 0.06); S.count('notes', 'glimpse'); }
    }
    if (ok) S.count('notes', 'grain');
    return ok;
  }

  // ------------------------------------------------------------------------------------------------ transitions
  /** a pickup landing on the downbeat `at`: a buffer-repeat stutter of the played material, else a crushed reverse swell */
  pickup(at, { swell = false, vel = 0.45, dest = null } = {}) {
    const S = this.S, g = this.g;
    if (!g) return null;
    const sd = S.cond.stepDur, pib = this.pal.time === 'pibroch';
    const d = dest || this.ch.grain;
    const slice = pib ? sd * 2 : sd, reps = 3 + S.rng.int(0, 1);
    if (!swell && g.grain.stutter(at, slice, reps, vel, d.input || d, null, S.rng)) return 'stutter';
    if (g.grain.swell(at, Math.min(S.cond.barDur * 0.5, 2.5), vel * 0.9, d.input || d)) return 'swell';
    if (g.grain.stutter(at, slice, reps, vel, d.input || d, null, S.rng)) return 'stutter';
    return null;
  }

  /** the artefact entry in the grit palette: a crushed hit, a resonator bloom on the tonic, a short stutter after */
  entry(t, vel = 1) {
    const S = this.S, g = this.g;
    if (!g) return;
    S.hit('kick', t, 0.95 * vel, { decay: 0.3 }, true);
    S.hit('snare', t + 0.003, 0.8 * vel, { tone: 0.85, decay: 0.12 }, true);
    S.hit('grainBurst', t, 0.55 * vel, { length: 0.3, tone: 0.35 }, true);
    g.res.bloom(t, 2 + 0.8 * clamp(vel, 0, 1), 4.5);
    const sd = S.cond.stepDur;
    g.grain.stutter(t + 4 * sd, sd, 3, 0.5 * vel, this.ch.ftex.input, null, S.rng);
    S.log('entry', { at: +t.toFixed(3) });
  }

  // ------------------------------------------------------------------------------------------------ control (10 Hz)
  control(now, L, C, A, bedMul, tc, ramping, R = null) {
    const S = this.S, g = this.g, ch = this.ch, base = S.base;
    if (!g) return;
    // a hard cut coming on the next downbeat (planned ahead of the clock): what falls is scheduled to fall exactly there
    let cutAt = null;
    if (R && R.cut && now >= R.t0 - 0.4 && now < R.t0 + 0.06) {
      L = { ...L };
      for (const k of Object.keys(R.to)) if ((R.to[k] ?? 0) < (R.from[k] ?? 0)) L[k] = R.to[k];
      cutAt = Math.max(R.t0, now);
    }
    this.bedMul = bedMul;
    const lvl = {
      sub: L.sub, beat: L.sub * (0.45 + 0.55 * L.wall), noise: 1, res: g.res.native ? 1 : L.res,
      erode: L.erode, grain: 1, arp: L.arp, glimpse: 1,
    };
    for (const name of GRIT_CH_NAMES) {
      const b = base[name]; if (!b || !ch[name]) continue;
      const ph = name.length * 0.9;
      const o = applyChannelMods({
        gain: b.gain * lvl[name] * bedMul * (name === 'sub' ? 1 + 0.25 * C.d : 1),
        pan: b.pan + 0.15 * Math.sin((TAU * now) / (31 + 4 * name.length) + ph),
        reverb: b.reverb * (0.8 + 0.5 * C.d + 0.3 * C.a),
        delay: b.delay * (0.8 + 0.6 * C.d + 0.4 * C.water),
        grain: b.grain * (0.8 + 0.8 * C.d + 0.4 * C.s),
        cutoff: b.cutoff * (1 - 0.35 * C.n) * (1 - 0.3 * C.bog) * (1 + 0.15 * C.w),
        resonance: b.resonance + 1.2 * C.sw + 0.8 * C.d,
        drive: b.drive + 0.1 * C.sw,
        crush: b.crush + 0.2 * C.glitch,
        chorus: b.chorus * (0.8 + 0.6 * C.d),
      }, name, A);
      if (S.mute && S.mute.has(name)) o.gain = 0;
      const cur = ch[name].state, diff = {};
      let any = false;
      for (const k of Object.keys(o)) {
        const prev = cur[k], tol = k === 'cutoff' ? Math.abs(o[k]) * 0.012 : k === 'resonance' ? 0.05 : 0.004;
        if (prev === undefined || Math.abs(prev - o[k]) > tol) { diff[k] = o[k]; any = true; }
      }
      if (any) {
        if (cutAt !== null && diff.gain !== undefined) ch[name].set(diff, cutAt, 0.012);
        else ch[name].set(diff, now, ramping && lvl[name] !== 1 ? 0.08 : Math.max(tc, 0.3));
      }
    }
    const breath = 1 + 0.08 * Math.sin((TAU * now) / 23);
    const wall = clamp(L.wall * breath * (1 + 0.15 * C.sw), 0, 1);
    const stc = cutAt !== null ? 0.012 : ramping ? 0.08 : 0.4, st = cutAt ?? now;
    const v = this._v || (this._v = {});
    const moved = (k, x, tol) => { if (v[k] !== undefined && Math.abs(v[k] - x) <= tol) return false; v[k] = x; return true; };
    const sub = 0.55 * (1 + 0.2 * C.d);
    if (moved('sub', sub, 0.004)) g.sub.set({ sub }, st, stc);
    if (g.erode.native) g.erode.setLevel(Math.min(2, 2.5 * L.erode * bedMul), st, stc);
    if (moved('wall', wall, 0.006)) { g.sub.set({ beat: 0.4, wall }, st, stc); g.wall.set({ wall }, st, stc); }
  }
}
