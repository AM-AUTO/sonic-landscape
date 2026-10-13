/**
 * Artefacts — the eight POI pieces (20–45 s each), their partial variants, resonance echoes, the concord pad,
 * pre-echo signature layers, the gate-open cadence and the level-complete finale.
 *
 * A piece is a timeline of timed actions (executed just-in-time with a short lookahead, so node counts stay low),
 * optional steppers (regular callbacks) and a mods(rel) function that returns *modifiers* for the Score's
 * continuous mapping: reverb size / wet / damp, delay time / feedback / ping-pong / tape wobble, the granular
 * cloud, freeze, master drive / high cut, per-channel mul/add/set maps, texture override, drone boost, pulse
 * hold, energy floor — so each artefact audibly reshapes the whole space, not just adds notes.
 *
 * Every piece: ducks the bed ~6 dB (fx.master.duck), strikes a crash / swell, plays foreground material built on
 * the level's motif transform and mode, and hands over to resonance echoes for RESONANCE_SECONDS.
 */
import { MODES, transformMotif, CONTOUR_MOTIF } from './theory.js';
import { euclid } from './conductor.js';
import { voiceChord, combinedSet, relativeMajorRoot, WARM_MODE, nearestTone } from './harmony.js';
import { degreeToMidi } from './theory.js';
import { clamp, lerp } from './macros.js';
import { patchesFor } from './levelmusic.js';
import { RESONANCE_SECONDS } from '../world/codes.js';
import { ART_NOMINAL } from './artcal.js';

const LA = 0.18;       // action lookahead (s)
const ramp = (x, lo, hi) => clamp((x - lo) / (hi - lo), 0, 1);
/** envelope over a piece: rise over `a`, hold until `h`, fall over `r` after */
const env = (rel, a, h, r) => clamp(Math.min(rel / Math.max(0.01, a), 1 - (rel - h) / Math.max(0.01, r)), 0, 1);
const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

/** unity-gain loudness of each piece's first six seconds (dBFS RMS, measured over the album renders): the entry boost aims for +4 dB over what was heard */
const NOMINAL_DB = { trig: -15.5, cairn: -19.5, lochan: -20, waterfall: -18, bothy: -20.5, stone: -23, crag: -16, summit: -14.5 };

/** bloom and settle: the foreground enters at full level, then hangs ~5 dB lower, with a modest lift for the closing gesture */
const settle = (rel, dur) => {
  const down = smoothstep((rel - 2.0) / 4);
  let g = lerp(1.0, 0.26, down);
  const up = smoothstep((rel - (dur - 10)) / 4) * (1 - smoothstep((rel - (dur - 3)) / 3));
  return g + (0.85 - g) * up * 0.6;
};

/** a spec for macros.ovr: number (hard override) or {v, w}; returns it with its weight scaled by f */
const scaleSpec = (sp, f) => (typeof sp === 'number' ? { v: sp, w: f } : sp && typeof sp === 'object' && 'v' in sp ? { v: sp.v, w: sp.w * f } : sp);
/** two overlapping pieces' specs for the same parameter: weighted by their own weights, so a hand-over is continuous */
function blendSpec(a, b) {
  const sa = typeof a === 'number' ? { v: a, w: 1 } : a, sb = typeof b === 'number' ? { v: b, w: 1 } : b;
  if (!sa || !sb || typeof sa !== 'object' || typeof sb !== 'object' || !('v' in sa) || !('v' in sb)) return b;
  const ws = sa.w + sb.w;
  return ws < 1e-6 ? b : { v: (sa.v * sa.w + sb.v * sb.w) / ws, w: Math.max(sa.w, sb.w) };
}
/** a releasing piece's modifiers at fade factor f (1 → 0): every kind of modifier eases toward neutral */
function scaleMods(m, f) {
  if (!m || f >= 0.999) return m;
  const o = {};
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (v === undefined || v === null) continue;
    if (k === 'chMul') { o.chMul = {}; for (const c of Object.keys(v)) { o.chMul[c] = {}; for (const q of Object.keys(v[c])) o.chMul[c][q] = Math.pow(Math.max(1e-3, v[c][q]), f); } }
    else if (k === 'chAdd') { o.chAdd = {}; for (const c of Object.keys(v)) { o.chAdd[c] = {}; for (const q of Object.keys(v[c])) o.chAdd[c][q] = v[c][q] * f; } }
    else if (k === 'chSet') { if (f > 0.5) o.chSet = v; }
    else if (k === 'gran') { o.gran = {}; for (const q of Object.keys(v)) o.gran[q] = scaleSpec(v[q], f); }
    else if (k === 'drone') { o.drone = {}; for (const q of Object.keys(v)) o.drone[q] = Math.pow(Math.max(1e-3, v[q]), f); }
    else if (k === 'texture') { if (f > 0.5) o.texture = v; }
    else if (k === 'reverbWet' || k === 'delayWet' || k === 'gain' || k === 'tempoMul') o[k] = 1 + (v - 1) * f;
    else if (k === 'masterDrive' || k === 'energy' || k === 'energyFloor') o[k] = v * f;
    else if (k === 'energyMax') o[k] = 1 - (1 - v) * f;                      // a ceiling relaxes toward 1
    else if (typeof v === 'boolean') { if (f > 0.5) o[k] = v; }
    else if (typeof v === 'number' || (typeof v === 'object' && 'v' in v)) o[k] = scaleSpec(v, f);
  }
  return o;
}
const FADE_SECONDS = 2.6;

/** signature scale degree of each artefact type (the concord pitch set and pre-echo notes) */
export const SIGNATURE = { trig: 0, cairn: 2, lochan: 4, waterfall: 1, bothy: 3, stone: 5, crag: 6, summit: 7 };
const ECHO_PERIOD = { trig: 9, cairn: 11.3, lochan: 13.7, waterfall: 8.3, bothy: 12.1, stone: 15.5, crag: 7.7, summit: 10.4 };
const PIECE_NAMES = { trig: 'Triangulation', cairn: 'Accretion', lochan: 'Reflection', waterfall: 'Cascade', bothy: 'Hearth', stone: 'Monolith', crag: 'Fracture', summit: 'Apex' };

class Piece {
  constructor(art, type, t0, opts = {}) {
    this.art = art; this.type = type; this.name = PIECE_NAMES[type] || type;
    this.t0 = t0; this.dur = opts.dur || 28; this.partial = !!opts.partial; this.kind = opts.kind || 'artefact';
    this.acts = []; this.steps = []; this.i = 0;
    this.modsFn = null; this.onContour = null; this.onEnd = null;
    this.flags = {}; this.state = {};
    this.dead = false; this.ended = false;
    this.boostDb = 0; this.shape = null;
    this.servoDb = 0; this.targetDb = null; this.heardFast = null;
  }
  at(rel, fn) { this.acts.push({ rel, fn }); return this; }
  /** repeat fn(t, rel, k) every dt s (number or fn(rel)) from..to */
  every(from, to, dt, fn) { this.steps.push({ next: from, to, dt, fn, k: 0 }); return this; }
  mods(fn) { this.modsFn = fn; return this; }
  finish() { this.acts.sort((a, b) => a.rel - b.rel); return this; }
}

export class Artefacts {
  constructor(score) {
    this.S = score;
    this.pieces = [];
    this.cached = {};
    this.echo = new Map();
    this.concordState = { next: 0, types: [] };
    this.pendingCadence = null;
    this.playedErrors = new Set();
  }

  reset() {
    for (const p of this.pieces) this._end(p, this.S.now, true);
    this.pieces = []; this.echo.clear(); this.concordState = { next: 0, types: [] }; this.pendingCadence = null;
    this.cached = {};
  }

  get active() { return this.pieces.filter((p) => !p.ended); }
  get activeCount() { return this.pieces.filter((p) => !p.ended && !p.fade && p.kind === 'artefact' && !p.partial).length; }
  get pulseHold() { return this.pieces.some((p) => !p.ended && p.flags.pulseHold); }

  // ------------------------------------------------------------------------------------------------
  // public API
  // ------------------------------------------------------------------------------------------------
  /** play(type, {quality, t, poi}) — the full artefact */
  play(type, { t, quality = 1, poi = null, gate = false } = {}) {
    const S = this.S;
    if (!this[`_build_${type}`]) return null;
    t = t ?? S.now;
    this._cutAll(t, 'artefact');
    const P = new Piece(this, type, t);
    this[`_build_${type}`](P);
    if (gate) this._appendCadence(P);
    P.finish();
    P.poi = poi;
    // consequence aim: the piece's first six seconds should sit ~5 dB above what was heard just before it (never louder than
    // -10.5 dBFS, with a floor so a hushed bed still gets a present entry). The entry is aimed from the measured unity level of
    // this piece in this level (artcal.js); the servo (update) trims the remainder while it plays.
    P.targetDb = clamp(S.heardDb + 6.0, -19 + (S.profile.frontDb || 0), -10.5);
    const nominal = (ART_NOMINAL[S.levelId] && ART_NOMINAL[S.levelId][type]) ?? NOMINAL_DB[type] ?? -16;
    P.boostDb = 0;
    P.servoDb = clamp(P.targetDb - nominal, -12, 10);
    this.pieces.push(P);
    S.log('artefact', { type, dur: +P.dur.toFixed(1) });
    S.count('notes', 'artefacts');
    return P;
  }

  /** partial: 4 s muffled, quarter-tone-flat glimpse with a "missing" sigh */
  playPartial(type, { t, missing = [], quality = 0.5 } = {}) {
    const S = this.S, V = S.stage.v;
    t = t ?? S.now;
    if (this.pieces.some((p) => !p.ended && p.kind === 'artefact' && !p.partial)) return null;     // a full piece is sounding
    this.pieces = this.pieces.filter((p) => { if (p.partial && !p.ended) this._end(p, t, true); return !p.ended; });
    const P = new Piece(this, type, t, { dur: 4.6, partial: true, kind: 'partial' });
    const b = S.beat(), M = S.motif();
    S.duckBed(0.3, 0.05, 2.8, 1.2, t);
    // quarter-tone flat, voices dark
    P.at(0, () => {
      V.aBell.p.tune = -50; V.aPluck.p.tune = -50; V.aLead.p.tune = -50; V.eBell.p.tune = -50; V.aPad.p.tune = -50;
    });
    const sig = this._signatureVoice(P, type);
    const n = 3 + (quality > 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) P.at(0.05 + i * b * 0.62, (tt) => sig(M.degrees[i % M.degrees.length], tt, 0.4 + 0.1 * (i === 0)));
    // the missing sigh: breath falling away, a low sad note
    P.at(2.3, (tt) => {
      S.hit('breath', tt, 0.5, { length: 2.1, tone: 0.1, pitch: 0.6 }, true);
      V.aLead.note(S.midi(M.degrees[0], S.profile.lead.base - S.profile.root - 12), S.at(tt + 0.1), 1.6, 0.35);
    });
    P.mods((rel) => {
      const w = env(rel, 0.15, 3.2, 1.0);
      return {
        highCut: { v: 600, w }, reverbWet: 1 + 0.2 * w, energyMax: 0.35,
        chMul: { pad: { cutoff: 1 - 0.5 * w }, bell: { cutoff: 1 - 0.5 * w } },
      };
    });
    P.onEnd = () => {
      V.aBell.p.tune = 0; V.aPluck.p.tune = 0; V.aLead.p.tune = 0; V.eBell.p.tune = 0; V.aPad.p.tune = 0;
    };
    P.finish();
    this.pieces.push(P);
    S.log('partial', { type, missing: missing.join(',') });
    return P;
  }

  endResonance(poiId) { this.echo.delete(poiId); }

  onContour(ev, now) {
    for (const p of this.pieces) if (!p.ended && p.onContour) p.onContour(ev, now);
  }

  /** gate-open: cadence into the tonic. Waits for a sounding artefact to finish (it opens on the same frame as the last one) */
  cadence(now) {
    if (this.activeCount) this.pendingCadence = { due: now };
    else this._playCadence(now);
  }

  finale(now) {
    this._cutAll(now, 'all');
    this.pendingCadence = null;
    const S = this.S;
    const P = new Piece(this, 'finale', now, { dur: 18, kind: 'finale' });
    this._build_finale(P);
    P.finish();
    this.pieces.push(P);
    S.log('finale', {});
  }

  /** two or more artefacts now resonate: interlocking chime (the sustained pad is kept by update()) */
  concord(types, now) {
    const S = this.S, V = S.stage.v;
    if (this.activeCount) { this.pendingConcord = { types: types.slice(), due: now }; return; }
    this._concordChime(types, now);
  }

  // ------------------------------------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------------------------------------
  update(now, state, dt) {
    for (const p of this.pieces) {
      if (p.ended) continue;
      const rel = now - p.t0;
      // actions
      while (p.i < p.acts.length && p.t0 + p.acts[p.i].rel <= now + LA) {
        const a = p.acts[p.i++];
        this._run(a.fn, p.t0 + a.rel, a.rel, p);
      }
      for (const st of p.steps) {
        while (st.next <= st.to && p.t0 + st.next <= now + LA) {
          const r = st.next;
          this._run(st.fn, p.t0 + r, r, p, st.k++);
          st.next += typeof st.dt === 'function' ? st.dt(r) : st.dt;
        }
      }
      if (p.targetDb !== null && !p.fade && rel > 0.25 && rel < 6.4) this._servo(p, rel, dt);
      if (p.fade ? now - p.fade.t0 >= p.fade.dur : rel > p.dur && p.i >= p.acts.length) this._end(p, now);
    }
    this.pieces = this.pieces.filter((p) => !p.ended);
    if (this.pendingCadence && !this.activeCount) { const c = this.pendingCadence; this.pendingCadence = null; this._playCadence(now + 0.4); }
    if (this.pendingConcord && !this.activeCount) { const c = this.pendingConcord; this.pendingConcord = null; this._concordChime(c.types, now + 0.2); }
    this._resonance(now, state);
  }

  /** steer a piece's foreground weight (±) so its short-term level reaches the target during its first six seconds */
  _servo(p, rel, dt) {
    const S = this.S;
    const db = S.heardFastDb;
    if (!Number.isFinite(db)) return;
    p.heardFast = p.heardFast === null ? db : p.heardFast;
    if (rel < 0.8) return;                                   // the entry's strike must have arrived before the level is read
    let err = clamp(p.targetDb - db, -6, 6);
    if (rel < 2.6 && err > 0) err = 0;                       // the piece is still gathering: it may be turned down early, but only turned up once it has bloomed
    p.servoDb = clamp(p.servoDb + err * 2.0 * dt, -12, 10);
  }

  _run(fn, t, rel, piece, k) {
    try { fn(t, rel, k, piece); } catch (e) {
      const key = String(e && e.message);
      if (!this.playedErrors.has(key)) { this.playedErrors.add(key); console.error('[artefacts]', piece.type, e && e.stack ? e.stack : e); }
    }
  }

  _end(p, now, silent) {
    if (p.ended) return;
    p.ended = true;
    if (p.targetDb !== null && !p.partial) this.S.log('servo', { type: p.type, servo: +p.servoDb.toFixed(1), boost: +p.boostDb.toFixed(1), target: +p.targetDb.toFixed(1) });
    if (p.onEnd) { try { p.onEnd(now); } catch (e) { console.error('[artefacts] onEnd', e); } }
  }

  /**
   * Back-to-back artefacts: the previous piece is not cut. It stops scheduling new events and its modifiers (space, filter,
   * foreground weight) ease out over FADE_SECONDS while the new piece's ease in; its already-sounding notes ring on. The
   * 'finale' / 'all' case releases everything in the same way. Pieces with no sound of their own to carry (cadences,
   * partials) end at once.
   */
  _cutAll(t, which) {
    for (const p of this.pieces) {
      if (p.ended) continue;
      if (which === 'all' || p.kind === 'artefact' || p.kind === 'partial' || p.kind === 'cadence') {
        p.dead = true;
        if (p.kind === 'artefact' && !p.partial && p.modsFn && !p.fade) {
          p.fade = { t0: t, dur: FADE_SECONDS }; p.i = p.acts.length; for (const st of p.steps) st.next = Infinity;
          if (p.onEnd) { const f = p.onEnd; p.onEnd = null; try { f(t); } catch (e) { console.error('[artefacts] onEnd', e); } }       // harmony can't crossfade: a lifted key comes home at once
        }
        else if (!p.fade) this._end(p, t);
      }
    }
    this.pieces = this.pieces.filter((p) => !p.ended);
  }

  // ------------------------------------------------------------------------------------------------
  // mods (merged each control tick)
  // ------------------------------------------------------------------------------------------------
  mods(now) {
    const A = { chMul: {}, chAdd: {}, chSet: {}, fast: false };
    const owned = new Set();            // keys already set by a piece: a later piece blends with them rather than replacing them
    let fromPiece = false;
    const merge = (m) => {
      if (!m) return;
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (v === undefined || v === null) continue;
        if (k === 'chMul') for (const c of Object.keys(v)) { A.chMul[c] = A.chMul[c] || {}; for (const q of Object.keys(v[c])) A.chMul[c][q] = (A.chMul[c][q] ?? 1) * v[c][q]; }
        else if (k === 'chAdd') for (const c of Object.keys(v)) { A.chAdd[c] = A.chAdd[c] || {}; for (const q of Object.keys(v[c])) A.chAdd[c][q] = (A.chAdd[c][q] ?? 0) + v[c][q]; }
        else if (k === 'chSet') for (const c of Object.keys(v)) { A.chSet[c] = { ...(A.chSet[c] || {}), ...v[c] }; }
        else if (k === 'gran') A.gran = { ...(A.gran || {}), ...v };
        else if (k === 'drone') { A.drone = A.drone || {}; for (const q of Object.keys(v)) A.drone[q] = (A.drone[q] ?? 1) * v[q]; }
        else if (k === 'texture') A.texture = { ...(A.texture || {}), ...v };
        else if (k === 'reverbWet' || k === 'delayWet' || k === 'gain' || k === 'tempoMul') A[k] = (A[k] ?? 1) * v;
        else if (k === 'masterDrive') A[k] = (A[k] || 0) + v;
        else if (k === 'energy' || k === 'energyFloor') A[k] = Math.max(A[k] ?? 0, v);
        else if (k === 'energyMax') A[k] = Math.min(A[k] ?? 1, v);
        else if (k === 'freeze') A.freeze = A.freeze || v;
        else if (fromPiece && owned.has(k)) A[k] = blendSpec(A[k], v);
        else A[k] = v;
        if (fromPiece) owned.add(k);
      }
    };
    merge(this._proxMods());
    fromPiece = true;
    for (const p of this.pieces) {
      if (p.ended || !p.modsFn) continue;
      A.fast = true;
      const rel = now - p.t0;
      const fade = p.fade ? Math.pow(clamp(1 - (now - p.fade.t0) / p.fade.dur, 0, 1), 1.3) : 1;         // 1 → 0 while released
      merge(scaleMods(p.modsFn(rel, p), fade));
      if (p.kind === 'artefact' && !p.partial) {
        const g = p.shape ? p.shape(rel, p.dur) : settle(rel, p.dur);
        const boost = Math.pow(10, ((p.boostDb + p.servoDb) * clamp(1 - (rel - 6.2) / 4, 0, 1)) / 20);
        const room = rel > 4 ? lerp(1, 0.45, smoothstep((this.S.proxMax - 0.25) / 0.45)) : 1;        // the piece steps back as the next place comes near
        const fg = g * boost * fade * room;
        A.frontGain = A.frontGain === undefined ? fg : Math.max(A.frontGain, fg);
        // the piece's wash (extra reverb / delay / grain level) settles with its foreground, so a long bloom doesn't stay at entry loudness
        const sv = (p.boostDb + p.servoDb) * clamp(1 - (rel - 6.2) / 4, 0, 1);
        const ws = clamp(0.32 + 0.68 * g, 0.4, 1) * (sv < 0 ? Math.pow(10, (sv * 0.8) / 20) : 1);       // a piece steered down takes its wash with it
        if (A.reverbWet !== undefined) A.reverbWet = 1 + (A.reverbWet - 1) * Math.max(ws, 0.55);
        if (A.delayWet !== undefined) A.delayWet = 1 + (A.delayWet - 1) * ws;
        if (A.gran && A.gran.mix && typeof A.gran.mix === 'object') A.gran = { ...A.gran, mix: { v: A.gran.mix.v * ws, w: A.gran.mix.w } };
      }
    }
    return A;
  }

  _proxMods() {
    const pr = this.S.prox, out = {};
    if (!pr) return out;
    const C = this.S.C;
    if (pr.waterfall > 0.15) out.texture = { kind: 'water', level: { v: 0.95, w: pr.waterfall }, tone: { v: 0.7, w: pr.waterfall } };
    if (pr.bothy > 0.15) out.texture = { kind: 'crackle', level: { v: 0.8, w: pr.bothy }, tone: { v: 0.5, w: pr.bothy } };
    if (pr.stone > 0.1) out.drone = { subMul: 1 + 0.9 * pr.stone, levelMul: 1 + 0.2 * pr.stone, cutMul: 1 - 0.2 * pr.stone };
    if (pr.lochan > 0.1) out.gran = { mix: { v: 1.15, w: pr.lochan * 0.7 }, spray: { v: 4.5, w: pr.lochan * 0.5 } };
    if (pr.trig > 0.1 || pr.summit > 0.1) { const c = Math.max(pr.trig || 0, pr.summit || 0); out.delayWet = 1 + 0.5 * c; out.delayFb = { v: 0.62, w: c * 0.6 }; }
    if (pr.summit > 0.1) out.reverbWet = 1 + 0.25 * pr.summit;
    if (pr.crag > 0.1) out.chAdd = { ktex: { crush: 0.14 * pr.crag }, kcym: { crush: 0.06 * pr.crag } };
    if (pr.waterfall > 0.1) out.gran = { ...(out.gran || {}), density: { v: 55, w: pr.waterfall * 0.7 } };
    return out;
  }

  // ------------------------------------------------------------------------------------------------
  // helpers shared by pieces
  // ------------------------------------------------------------------------------------------------
  _ctx(P) {
    const S = this.S, V = S.stage.v, prof = S.profile;
    const b = S.beat();
    const leadOff = prof.lead.base - prof.root;
    const kit = (name, t, vel, o) => S.hit(name, t, vel, o, true);
    const lead = (midi, t, dur, vel) => { V.aLead.note(midi, S.at(t), dur, vel); S.count('notes', 'aLead'); };
    const bell = (midi, t, dur, vel) => { V.aBell.note(midi, S.at(t), dur, vel); S.count('notes', 'aBell'); };
    const pluck = (midi, t, dur, vel) => { V.aPluck.note(midi, S.at(t), dur, vel); S.count('notes', 'aPluck'); };
    const bass = (midi, t, dur, vel) => { V.aBass.note(midi, S.at(t), dur, vel); S.count('notes', 'aBass'); };
    const pad = (midis, t, dur, vel) => { V.aPad.chord(midis, S.at(t), dur, vel); S.count('notes', 'aPad'); };
    const cpad = (midis, t, dur, vel) => { V.cPad.chord(midis, S.at(t), dur, vel); S.count('notes', 'cPad'); };
    /** midi of degree d in the lead register (+octaves) */
    const lm = (d, oct = 0) => S.midi(d, leadOff + 12 * oct);
    const rootLow = () => { let m = S.rootNow() - 24; while (m < 26) m += 12; return m; };
    const duck = (amount, attack, hold, release, rel = 0) => S.duckBed(amount, attack, hold, release, P.t0 + rel);
    const cum = (M) => { let c = 0; return M.durations.map((d) => { const o = c; c += d * b; return o; }); };
    return { S, V, prof, b, leadOff, kit, lead, bell, pluck, bass, pad, cpad, lm, rootLow, duck, cum, M: S.motif() };
  }

  /**
   * The shared entry gesture (the album's grammar: every artefact announces itself the same way, so it is learnable):
   * an immediate crash, a low strike on the tonic, a tonic add9 pad swell and a short bell arpeggio.
   */
  _entry(P, { vel = 1, low = 'timp', crash = true, pad = true, bells = true, swell = 0, pedal = true } = {}) {
    const { S, V, kit, bell, pad: padv, lm, rootLow, cpad } = this._ctx(P);
    // a tonic pedal under the whole piece: whatever the foreground plays, the key never leaves the floor
    if (pedal) {
      P.every(0.15, P.dur - 5, 7.4, (t, rel, k) => {
        V.aBass.note(rootLow(), S.at(t), 8, 0.5);
        if (k % 2 === 0) cpad([S.rootNow() + 12, S.rootNow() + 19], t, 9, 0.28);
      });
    }
    P.at(0, (t) => {
      if (crash) kit('crash', t, 0.95 * vel, { tone: 0.65, decay: 6.5 });
      if (low) kit(low, t, 0.9 * vel, { midi: S.rootNow() - 12, decay: low === 'gong' ? 12 : 4.5, tone: 0.3 + 0.4 * S.rng.float() });
      if (swell) kit('reverseSwell', t, 0.45 * vel, { length: swell, tone: 0.5 });
      if (pad) padv(S.chordTonesForPad(0, [0, 2, 4, 8]), t + 0.02, 10, 0.85 * vel);
      if (bells) [0, 2, 4].forEach((d, i) => bell(lm(d, 1), t + 0.05 + i * 0.11, 5, (0.55 - 0.08 * i) * vel));
    });
  }

  /** the type's own voice for partials / pre-echo: fn(degree, t, vel) */
  _signatureVoice(P, type) {
    const { S, V, lm, b } = this._ctx(P);
    switch (type) {
      case 'trig': return (d, t, v) => V.aBell.note(lm(d, 1), S.at(t), 1.8, v);
      case 'cairn': return (d, t, v) => V.aPluck.note(lm(d, 0), S.at(t), 1.2, v);
      case 'lochan': return (d, t, v) => V.aBell.note(lm(d, 1), S.at(t), 2.5, v * 0.9);
      case 'waterfall': return (d, t, v) => V.aPluck.note(lm(d, 1), S.at(t), 1.0, v);
      case 'bothy': return (d, t, v) => V.aPluck.note(lm(d, 0), S.at(t), 1.4, v);
      case 'stone': return (d, t, v) => V.aBell.note(lm(d, 0), S.at(t), 3, v);
      case 'crag': return (d, t, v) => { S.hit('rim', t, v * 0.9, { pitch: 1 }, true); V.aBell.note(lm(d, 1), S.at(t), 0.6, v * 0.7); };
      default: return (d, t, v) => V.aLead.note(lm(d, 0), S.at(t), b * 0.9, v);
    }
  }

  // ------------------------------------------------------------------------------------------------
  // I. TRIANGULATION  — the motif as a 3-voice canon, ping-pong delay at the dotted eighth, reverb blooming
  // ------------------------------------------------------------------------------------------------
  _build_trig(P) {
    const { S, V, b, lead, bell, pluck, pad, lm, kit, duck, cum, M, rootLow } = this._ctx(P);
    const tot = M.durations.reduce((a, d) => a + d, 0) * b;
    const cl = tot + 1.2 * b, cycles = 4, shifts = [0, 2, 1, 0];
    P.dur = clamp(cycles * cl + 3 * b + 7, 22, 44);
    P.flags.pulseHold = true;
    duck(0.72, 0.05, P.dur - 9, 3.2);
    this._entry(P, { vel: 1, low: 'timp' });
    const onset = cum(M);
    for (let c = 0; c < cycles; c++) {
      for (let v = 0; v < 3; v++) {
        for (let i = 0; i < M.degrees.length; i++) {
          const rel = 0.45 + c * cl + v * b + onset[i];
          const d = M.degrees[i] + shifts[c];
          const dd = b * M.durations[i];
          if (v === 0) P.at(rel, (t) => lead(lm(d, 0), t, dd * 0.92, 0.82));
          else if (v === 1) P.at(rel, (t) => bell(lm(d, 1), t, dd, 0.62));
          else P.at(rel, (t) => pluck(lm(d, 0), t, dd, 0.7));
        }
      }
    }
    // the closing: timpani on the final note, tonic pad
    const fin = 0.45 + cycles * cl + 1.5 * b;
    P.at(fin, (t) => {
      kit('timp', t, 1.0, { midi: S.rootNow() - 12, decay: 4.5 });
      kit('crash', t, 0.6, { tone: 0.5, decay: 6.5 });
      lead(lm(0, 0), t, 4 * b, 0.85); bell(lm(0, 1), t, 4 * b, 0.6); bell(lm(4, 1), t + 0.1, 4 * b, 0.4);
      pad(S.chordTonesForPad(0, [0, 2, 4, 8]), t, 8, 0.75);
      V.aBass.note(rootLow(), S.at(t), 6, 0.7);
    });
    P.mods((rel) => {
      const w = env(rel, 3.5, P.dur - 8, 7);
      return {
        reverbSize: { v: 14.5, w }, reverbWet: 1 + 0.2 * w, delayTime: { v: b * 0.75, w: Math.min(1, w * 1.6) }, delayFb: { v: 0.66, w },
        delayWet: 1 + 0.3 * w, pingPong: w > 0.15 ? true : undefined, delayTone: { v: 4800, w }, lowCut: { v: 150, w }, highCut: { v: 17000, w },
        gran: { pitch: { v: 12, w }, pitchSpread: { v: 7, w }, mix: { v: 0.8, w }, density: { v: 26, w } },
        chSet: w > 0.2 ? { lead: { pan: -0.6 }, fore: { pan: 0 }, foreB: { pan: 0.6 } } : undefined,
        energy: 0.42 * Math.min(1, w * 2),
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // II. ACCRETION — contour crossings stack held notes into a growing cluster pad; a gong closes it
  // ------------------------------------------------------------------------------------------------
  _build_cairn(P) {
    const { S, V, b, cpad, pluck, bell, kit, duck, lm, M, rootLow } = this._ctx(P);
    P.dur = 29;
    P.flags.pulseHold = true;
    duck(0.72, 0.05, 20, 4);
    const holds = [];
    P.state.count = 0; P.state.last = -9;
    const add = (t) => {
      const k = P.state.count++;
      const deg = M.degrees[k % M.degrees.length] + (k >= 5 ? 2 : 0);
      let m = S.midi(deg, 0);
      const lo = S.rootNow() + 5 + 1.15 * k;
      while (m < lo) m += 12; while (m >= lo + 12) m -= 12;
      holds.push({ midi: m, born: t });
      pluck(m + 12, t, 1.1, 0.6);
      kit('click', t, 0.5, { tone: 0.25 + 0.5 * ((k * 0.37) % 1), pan: (k % 2 ? 0.3 : -0.3) });
      cpad([m], t, 9.5, 0.4 + 0.02 * Math.min(10, k));
      if (k % 3 === 2) bell(m + 24, t + 0.05, 3, 0.3);
      S.log('stone', { k });
    };
    this._entry(P, { vel: 0.9, low: 'timp', pad: false, bells: true, swell: 1.2 });
    P.at(0, (t) => { kit('tomL', t + 0.15, 0.7, { midi: S.rootNow() - 12 }); });
    for (let k = 0; k < 10; k++) P.at(0.8 + (k < 6 ? k * 1.35 : 8.1 + (k - 5) * 2.8), (t) => add(t));
    P.onContour = (ev, now) => {
      const rel = now - P.t0;
      if (rel < 0.6 || rel > P.dur - 8 || P.state.count > 15 || now - P.state.last < 0.8) return;
      P.state.last = now;
      add(now + 0.05);
    };
    // refresh the held cluster so it sustains for the whole piece
    P.every(8.5, P.dur - 9, 7.5, (t) => { for (const h of holds) if (t - h.born > 6) { cpad([h.midi], t, 9, 0.38); h.born = t; } });
    P.at(P.dur - 8, (t) => {
      kit('gong', t, 0.9, { midi: S.rootNow() - 12, decay: 12, tone: 0.6 });
      kit('crash', t, 0.4, { tone: 0.4, decay: 6 });
      const top = holds.slice(-4).map((h) => h.midi);
      if (top.length) cpad(top, t + 0.1, 7, 0.55);
      bell(lm(0, 1), t + 0.2, 6, 0.5);
      V.aBass.note(rootLow(), S.at(t), 5, 0.6);
    });
    P.mods((rel) => {
      const n = Math.min(1, P.state.count / 11);
      const w = env(rel, 2, P.dur - 7, 6);
      return {
        reverbSize: { v: lerp(6, 13, n), w }, reverbWet: 1 + 0.3 * n * w,
        chSet: { forePad: { cutoff: lerp(1400, 9500, n) } }, chAdd: { forePad: { grain: 0.15 * n } }, highCut: { v: 4800, w },
        lowCut: { v: lerp(220, 40, smoothstep((rel - 3) / 9)), w: Math.min(1, w * 2) },
        gran: { mix: { v: 0.9, w: w * n }, pitch: { v: 12, w: w * n * 0.6 } },
        energy: 0.35 * w,
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // III. REFLECTION — granular freeze of the last six seconds; the lead plays the motif reversed, an octave down
  // ------------------------------------------------------------------------------------------------
  _build_lochan(P) {
    const { S, V, b, lead, bell, kit, duck, lm, cum, M, rootLow } = this._ctx(P);
    const R = transformMotif(M, 'retro');
    const onset = cum(R);
    const tot = R.durations.reduce((a, d) => a + d, 0) * b * 1.6;
    P.dur = clamp(2.2 + 2 * b + 2 * tot + 7 * b + 2, 24, 38);
    P.flags.pulseHold = true;
    duck(0.72, 0.06, P.dur - 9, 4);
    this._entry(P, { vel: 0.9, low: 'gong', swell: 1.4 });
    const pass = (start, shift, vel) => {
      for (let i = 0; i < R.degrees.length; i++) {
        const rel = start + onset[i] * 1.6;
        P.at(rel, (t) => lead(lm(R.degrees[i] + shift, -1), t, b * R.durations[i] * 1.75, vel));
      }
    };
    P.at(2.2, (t) => lead(lm(0, -1), t, b * 2.2, 0.8));                       // home first, then the reflection
    pass(2.2 + 2 * b, 0, 0.85);
    pass(2.2 + 2 * b + tot + 1.5 * b, -2, 0.6);
    // shimmer of the surface: descending glass fragments
    P.every(3.2, P.dur - 8, 3.6, (t, rel, k) => {
      const ds = [6, 4, 2, 5, 3, 1][k % 6];
      for (let j = 0; j < 3; j++) bell(lm(ds - j * 2, 2), t + j * 0.19, 5, 0.3 - 0.05 * j);
    });
    P.at(P.dur - 6, (t) => { bell(S.midi(0, 12), t, 8, 0.5); V.aBass.note(rootLow(), S.at(t), 5, 0.5); });
    P.mods((rel) => {
      const w = env(rel, 1.2, P.dur - 8, 5);
      return {
        freeze: rel > 1.4 && rel < P.dur - 4.2,           // the entry's tonic chord and bells are in the buffer before it freezes
        chAdd: rel < 1.8 ? { forePad: { grain: 0.5 }, fore: { grain: 0.5 } } : undefined,
        gran: { density: { v: 34, w }, size: { v: 0.38, w }, pitchSpread: { v: 7, w }, spray: { v: 5.2, w }, reverse: { v: 0.8, w }, mix: { v: 1.0 - 0.3 * smoothstep((rel - 5) / 8), w }, feedback: { v: 0.42, w } },
        reverbSize: { v: 12.5, w }, reverbWet: 1 + 0.15 * w, reverbDamp: { v: 3000, w }, lowCut: { v: 120, w },
        delayTime: { v: b * 1.5, w }, delayFb: { v: 0.58, w },
        texture: { kind: 'water', level: { v: 0.8, w }, tone: { v: 0.6, w } },
        energy: 0.3 * w,
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // IV. CASCADE — falling granular pitch cloud, rising filter, tom roll → cymbal swell → crash → noise spray
  // ------------------------------------------------------------------------------------------------
  _build_waterfall(P) {
    const { S, V, b, lead, bell, kit, duck, lm, M, rootLow } = this._ctx(P);
    P.dur = 22;
    P.flags.pulseHold = true;
    duck(0.72, 0.05, 13.5, 4.5);
    this._entry(P, { vel: 0.9, low: 'timp', pad: false, bells: false, swell: 2.0 });
    P.at(0, (t) => { kit('tomL', t + 0.1, 0.85, { midi: S.rootNow() - 12 }); });
    // falling bells under the roll
    P.every(1.2, 6.6, 0.28, (t, rel, k) => bell(S.midi(12 - k, 24), t, 3, 0.3 + 0.22 * (k / 20)));
    // tom roll accelerating into the cymbal swell
    const names = ['tomH', 'tomM', 'tomL'];
    P.every(1.6, 7.6, (rel) => lerp(b * 0.5, 0.065, Math.pow(clamp((rel - 1.6) / 6, 0, 1), 1.4)), (t, rel, k) => {
      const x = clamp((rel - 1.6) / 6, 0, 1);
      kit(names[k % 3], t, lerp(0.35, 1.0, x), { midi: S.rootNow() - 12 + [12, 7, 0][k % 3], pan: (k % 2 ? 0.35 : -0.35), tone: 0.3 + 0.5 * x });
    });
    P.at(5.2, (t) => kit('reverseSwell', t, 0.85, { length: 2.6, tone: 0.8 }));
    P.at(7.8, (t) => {
      kit('crash', t, 1.0, { tone: 0.8, decay: 6 });
      kit('timp', t, 0.8, { midi: S.rootNow() - 12 });
      kit('gong', t + 0.05, 0.5, { midi: S.rootNow() - 12, decay: 9, tone: 0.8 });
    });
    // white-noise spray
    P.every(8.1, 15, 0.12, (t, rel, k) => {
      const r = S.rng.float();
      const fade = 1 - (rel - 8) / 8;
      if (r < 0.5) kit('shaker', t, 0.4 * fade, { tone: 0.9, decay: 0.07 + 0.08 * S.rng.float(), pan: (S.rng.float() * 2 - 1) * 0.6 });
      else if (r < 0.85) kit('grainBurst', t, 0.36, { length: 0.2 + 0.3 * S.rng.float(), tone: 0.9 });
      else kit('breath', t, 0.35, { length: 1.2, tone: 0.9, pitch: 1.3 });
    });
    // after the fall: the motif descending
    const R = transformMotif(M, 'retro');
    let t0 = 9.0;
    for (let i = 0; i < R.degrees.length; i++) { const rel = t0; P.at(rel, (t) => lead(lm(R.degrees[i], 0), t, b * 1.6, 0.8)); t0 += b * R.durations[i] * 1.2; }
    P.at(15.5, (t) => { bell(lm(0, 1), t, 6, 0.5); V.aBass.note(rootLow(), S.at(t), 4, 0.55); });
    P.at(0, () => { S.engine.fx.granular.setScale(S.modeNow().slice()); });
    P.shape = (rel) => (rel < 1.5 ? 1 : rel < 7.2 ? lerp(0.72, 0.88, (rel - 1.5) / 5.7) : rel < 10.5 ? 1 : lerp(1, 0.55, clamp((rel - 10.5) / 5, 0, 1)));
    P.mods((rel) => {
      const w = env(rel, 0.6, 14.5, 5);
      const fall = clamp(rel / 12, 0, 1);
      const dens = rel < 8 ? lerp(24, 70, rel / 8) : lerp(70, 28, clamp((rel - 8) / 7, 0, 1));
      const cm = lerp(0.4, 1.5, clamp(rel / 7, 0, 1));
      return {
        gran: { pitch: { v: 24 - 36 * Math.pow(fall, 1.15), w }, density: { v: dens, w }, size: { v: lerp(0.07, 0.22, fall), w }, spray: { v: 3, w }, pitchSpread: { v: 6, w }, mix: { v: 1.3, w }, reverse: { v: 0.35, w }, feedback: { v: 0.36, w } },
        texture: rel < 7.8 ? { kind: 'water', level: { v: 1.0, w }, tone: { v: lerp(0.2, 0.9, rel / 8), w } } : { kind: 'hiss', level: { v: 0.9, w }, tone: { v: 0.9, w } },
        chMul: { pad: { cutoff: lerp(1, cm, w) }, bell: { cutoff: lerp(1, cm, w) }, pluck: { cutoff: lerp(1, cm, w) }, ghost: { cutoff: lerp(1, cm, w) } },
        reverbWet: 1 + 0.15 * w, reverbSize: { v: rel > 7.8 ? 11 : 7, w }, energy: 0.5 * w,
        lowCut: { v: rel < 7.8 ? lerp(40, 520, Math.pow(clamp(rel / 7.6, 0, 1), 1.5)) : lerp(520, 260, clamp((rel - 7.8) / 8, 0, 1)), w },   // the riser: the bass drains away as the water falls
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // V. HEARTH — warm pad in the relative major, crackle, tape-wobble delay melody, gentle clap on 2 and 4
  // ------------------------------------------------------------------------------------------------
  _build_bothy(P) {
    const { S, V, b, pluck, bell, pad, kit, duck, M, lm, rootLow, prof } = this._ctx(P);
    P.dur = clamp(22 * b + 6, 22, 36);
    P.flags.pulseHold = true;
    duck(0.72, 0.06, P.dur - 9, 4);
    const relR = relativeMajorRoot(S.rootNow(), S.modeNow()) + 12;
    const center = prof.pad.center + S.keyShift;
    const prog = [[0, [0, 2, 4, 6]], [5, [0, 2, 4, 6]], [3, [0, 2, 4, 6]], [4, [0, 2, 4, 8]]];
    this._entry(P, { vel: 0.85, low: 'gong', crash: false, pad: false, swell: 1.2 });
    let prev = null;
    for (let c = 0; c < 4; c++) {
      P.at(0.15 + c * 5 * b, (t) => {
        const [d, steps] = prog[c];
        const tones = steps.map((s) => degreeToMidi(relR, WARM_MODE, d + s));
        const v = voiceChord(prev, tones, center - 8, center + 10);
        prev = v;
        V.aPad.p.attack = 1.0; V.aPad.p.release = 5;
        pad(v, t, 5 * b + 3, 1.0);
        let bm = degreeToMidi(relR - 24, WARM_MODE, d); while (bm < 26) bm += 12;
        V.aBass.note(bm, S.at(t), 5 * b, 0.75);
      });
    }
    // melody through the wobbling tape echo
    const mel = (start, shift) => {
      for (let i = 0; i < M.degrees.length; i++) {
        const rel = start + i * b * 1.5;
        P.at(rel, (t) => pluck(degreeToMidi(relR + 12, WARM_MODE, M.degrees[i] + shift), t, 1.6, 0.8));
      }
    };
    mel(1.2 * b, 0); mel(1.2 * b + 8.5 * b, 1); mel(1.2 * b + 17 * b, 0);
    // a gentle clap on 2 and 4
    for (let bar = 0; bar < Math.floor((P.dur - 5) / (4 * b)); bar++) {
      for (const beat of [1, 3]) P.at(bar * 4 * b + beat * b, (t) => kit('clap', t, 0.42, { tone: 0.25 + 0.3 * S.rng.float(), decay: 0.16 + 0.14 * S.rng.float() }));
    }
    P.at(P.dur - 6, (t) => { bell(S.midi(0, 12 + 12), t, 6, 0.45); });
    P.shape = (rel) => (rel < 4 ? 1 : lerp(1, 0.75, smoothstep((rel - 4) / 5)));       // the hearth keeps its glow
    P.mods((rel) => {
      const w = env(rel, 1.5, P.dur - 8, 6);
      return {
        texture: { kind: 'crackle', level: { v: 1.0, w }, tone: { v: 0.5, w } },
        highCut: { v: 3800, w },                                    // warm: the room closes in around the fire
        delayMod: { v: 0.9, w }, delayTime: { v: b * 0.75, w }, delayFb: { v: 0.52, w }, delayWet: 1 + 0.4 * w, delayTone: { v: 2400, w },
        reverbSize: { v: 5.5, w }, reverbDamp: { v: 3800, w },
        chAdd: { foreB: { delay: 0.35 * w, chorus: 0.3 * w }, forePad: { chorus: 0.2 * w } },
        energy: 0.3 * w, energyMax: 0.45,
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // VI. MONOLITH — sub drone, the pulse stops, a gong every 4 s, octatonic bells in a long reverb, time-dilated grains
  // ------------------------------------------------------------------------------------------------
  _build_stone(P) {
    const { S, V, b, bell, kit, duck, rootLow, lm, M, lead } = this._ctx(P);
    P.dur = 38;
    P.flags.pulseHold = true;
    duck(0.72, 0.06, 28, 5);
    const oct = MODES.octatonic;
    P.at(0, () => {
      V.aBell.p.kind = 'bowl'; V.aBell.p.decay = 11; V.aBell.p.beat = 1.2; V.aBell.p.indexEnd = 0.1; V.aBell.p.ratio = 2.003;
      S.engine.fx.granular.setScale(oct.slice());          // the grain cloud itself turns octatonic
    });
    P.at(0, (t) => { kit('gong', t, 0.95, { midi: S.rootNow() - 12, decay: 13, tone: 0.6 }); kit('breath', t, 0.4, { length: 3, tone: 0.15 }); });
    P.every(0, P.dur - 6, 6.6, (t, rel) => V.aBass.note(rootLow(), S.at(t), 7.4, rel < 1 ? 0.7 : 0.5));
    P.every(4, P.dur - 4, 4, (t, rel, k) => kit('gong', t, 0.38 + 0.24 * ((k % 3) / 2), { midi: S.rootNow() - 12 + (k % 2 ? 7 : 0), decay: 9 + 3 * (k % 3), tone: 0.3 + 0.5 * ((k * 0.31) % 1), pan: (k % 2 ? 0.25 : -0.25) }));
    P.every(1.2, P.dur - 4, 3.1, (t, rel, k) => {
      const m = S.rootNow() + 24 + oct[S.rng.int(0, oct.length - 1)] + (S.rng.chance(0.3) ? 12 : 0);
      const r = S.rng;
      Object.assign(V.aBell.p, { decay: 8 + 5 * r.float(), beat: 0.6 + 1.6 * r.float(), indexEnd: 0.05 + 0.25 * r.float(), ratio: 2.003 + 0.7 * r.float() });
      bell(m, t, 12, 0.34 + 0.12 * r.float());
    });
    P.at(P.dur - 6, (t) => { kit('gong', t, 0.8, { midi: S.rootNow() - 12, decay: 14, tone: 0.5 }); bell(S.midi(0, 24), t + 0.3, 10, 0.5); lead(S.midi(0, S.profile.lead.base - S.profile.root - 12), t + 0.5, 6, 0.4); });
    P.shape = (rel) => (rel < 4 ? 1 : lerp(1, 0.5, smoothstep((rel - 4) / 5)));
    P.onEnd = () => {
      const pa = patchesFor(S.profile).bell; Object.assign(V.aBell.p, { kind: pa.kind, decay: null, beat: null, indexEnd: null, ratio: null });
      S.lastScaleKey = ''; S._applyScale();
    };
    P.mods((rel) => {
      const w = env(rel, 3, P.dur - 8, 7);
      const alt = Math.floor(rel / 8) % 2;
      return {
        pulseHold: true,
        gran: { size: { v: 0.8, w }, density: { v: 5, w }, spray: { v: 4.4, w }, pitch: { v: alt ? 0 : -12, w }, pitchSpread: { v: 3, w }, reverse: { v: 0.3, w }, mix: { v: 0.95, w }, feedback: { v: 0.42, w } },
        reverbSize: { v: 16, w }, reverbWet: 1 + 0.12 * w, delayTime: { v: b * 3, w }, delayFb: { v: 0.64, w }, delayWet: 1 + 0.05 * w,
        drone: { subMul: 1 + 0.9 * w, levelMul: 1 + 0.3 * w, cutMul: 1 - 0.3 * w },
        highCut: { v: 5200, w },
        energyMax: 0.2, energyFloor: 0.0, energy: 0.0,
        chMul: { pad: { gain: 1 - 0.3 * w } },
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // VII. FRACTURE — a 2× percussion break: probabilistic Euclid, snaps and grain bursts, bitcrush sweeps, crash accents
  // ------------------------------------------------------------------------------------------------
  _build_crag(P) {
    const { S, V, b, kit, lead, bell, duck, lm, M, rootLow } = this._ctx(P);
    P.dur = 21;
    P.flags.pulseHold = true;
    duck(0.72, 0.04, 14, 3);
    const sd = S.cond.stepDur;   // a 16th; the break runs at half that: 32nds, i.e. twice the speed
    const rng = S.rng;
    let pats = {};
    const draw = () => {
      pats = {
        kick: euclid(rng.pick([5, 6, 7]), 16, rng.pick([0, 0, 3])), snare: euclid(rng.pick([3, 4]), 16, rng.pick([4, 2, 6])),
        hat: euclid(rng.pick([9, 11, 13]), 16, 0), snap: euclid(rng.pick([5, 7]), 16, rng.pick([1, 3])),
        rim: euclid(rng.pick([3, 4, 5]), 16, rng.pick([2, 5, 9])), grain: euclid(rng.pick([3, 5]), 16, rng.pick([0, 6])),
        tom: euclid(rng.pick([3, 5]), 16, rng.pick([7, 10])),
      };
    };
    draw();
    P.at(0, (t) => { kit('crash', t, 1.0, { tone: 0.85, decay: 5 }); kit('snare', t, 0.8, { tone: 0.8 }); kit('metal', t, 0.5, { midi: S.midi(0, 24), decay: 0.8, tone: 0.2 + 0.6 * S.rng.float() }); });
    P.every(0.3, P.dur - 3, sd * 0.5, (t, rel, k) => {
      const i = k % 16;
      const sec = (k / 16) | 0;
      if (i === 0 && sec > 0) draw();                       // mutation every 16 steps
      const x = clamp(rel / (P.dur - 3), 0, 1);
      const o = (p) => rng.float() < p;
      if (pats.kick[i] && o(0.9)) kit('kick', t, 0.8 + 0.2 * rng.float(), { decay: 0.3 + 0.3 * rng.float() });
      if (pats.snare[i] && o(0.85)) kit('snare', t, 0.7 + 0.25 * rng.float(), { tone: rng.float(), decay: 0.12 + 0.12 * rng.float(), pitch: 0.9 + 0.3 * rng.float() });
      if (pats.hat[i] && o(0.7)) kit('hatC', t, 0.3 + 0.3 * rng.float(), { tone: rng.float(), pan: (rng.float() * 2 - 1) * 0.5, decay: 0.03 + 0.03 * rng.float() });
      if (pats.snap[i] && o(0.62)) kit('snap', t, 0.6 + 0.3 * rng.float(), { tone: rng.float(), pitch: 0.8 + 0.8 * rng.float() });
      if (pats.rim[i] && o(0.5)) kit('rim', t, 0.6 + 0.3 * rng.float(), { pan: (rng.float() * 2 - 1) * 0.5, pitch: 0.8 + 0.5 * rng.float() });
      if (pats.grain[i] && o(0.45)) kit('grainBurst', t, 0.7, { length: 0.1 + 0.25 * rng.float(), tone: rng.float() });
      if (pats.tom[i] && o(0.5)) kit(rng.pick(['tomH', 'tomM', 'tomL']), t, 0.8 + 0.2 * rng.float(), { midi: S.rootNow() - 12 + rng.pick([0, 7, 12]), pan: (rng.float() * 2 - 1) * 0.4 });
      // crash accents each two bars of the original grid
      if (k % 64 === 0 && k > 0) kit('crash', t, 0.65, { tone: 0.8, decay: 3 });
      if (k % 32 === 16) kit('metal', t, 0.35, { midi: S.midi(rng.int(0, 5), 24), decay: 0.5, tone: rng.float() });
      void x;
    });
    // short lead stabs on the retrograde motif
    const R = transformMotif(M, 'retro');
    P.every(2, P.dur - 4, b * 2, (t, rel, k) => {
      const d = R.degrees[k % R.degrees.length];
      lead(lm(d, 0), t, 0.2, 0.72); bell(lm(d, 2), t, 0.6, 0.4);
    });
    P.at(P.dur - 2.6, (t) => { kit('crash', t, 1.0, { tone: 0.9, decay: 7 }); kit('timp', t, 0.9, { midi: S.rootNow() - 12 }); kit('metal', t, 0.5, { midi: S.midi(0, 24), decay: 1.5, tone: 0.3 + 0.5 * S.rng.float() }); V.aBass.note(rootLow(), S.at(t), 3, 0.6); });
    P.shape = (rel) => 0.9 + 0.1 * ramp(rel, P.dur - 8, P.dur - 3);
    P.mods((rel) => {
      const w = env(rel, 0.4, P.dur - 4, 3);
      const sweep = ((rel / (b * 4)) % 1);
      const cr = w * (0.25 + 0.6 * Math.pow(sweep, 1.5));
      const kc = { crush: cr };
      return {
        pulseHold: true, energyFloor: 0.6 * w,
        chAdd: { fmain: { ...kc, drive: 0.3 * w }, fcym: { crush: cr * 0.7, drive: 0.15 * w }, ftex: { ...kc, drive: 0.25 * w }, kmain: kc, kcym: { crush: cr * 0.6 }, ktex: kc, lead: { crush: cr * 0.25 }, fore: { crush: cr * 0.4 } },
        masterDrive: 0.07 * w, lowCut: { v: 230, w }, chMul: { fmain: { gain: 1 + 0.4 * w }, fcym: { gain: 1 + 0.25 * w }, ftex: { gain: 1 + 0.3 * w } }, reverbSize: { v: 4.5, w }, reverbWet: 1 - 0.15 * w + 0.6 * ramp(rel, P.dur - 3, P.dur),
        gran: { size: { v: 0.04, w }, density: { v: 45, w }, reverse: { v: 0.6, w }, pitchSpread: { v: 14, w }, mix: { v: 1.0, w } },
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // VIII. APEX — tutti: every layer, timpani roll, ride crescendo, the key lifts a whole tone, motif in octaves
  // ------------------------------------------------------------------------------------------------
  _build_summit(P) {
    const { S, V, b, kit, lead, bell, bass, pad, cpad, duck, lm, M, rootLow, prof } = this._ctx(P);
    const tot = M.durations.reduce((a, d) => a + d, 0) * b;
    P.dur = clamp(8 + 3 * (tot + 2 * b) + 8, 32, 44);
    duck(0.72, 0.05, P.dur - 10, 5);
    const lyd = prof.id === 'nevis';
    P.at(0, (t) => { kit('crash', t, 1.0, { tone: 0.8, decay: 7 }); kit('timp', t, 1.0, { midi: S.rootNow() - 12, decay: 5 }); kit('gong', t, 0.6, { midi: S.rootNow() - 12, decay: 11 }); });
    P.at(1.8, () => { S.setKeyShift(2, P.t0 + 1.8); if (lyd) S.setModeOverride(MODES.lydian, P.t0 + 1.8); });
    P.at(P.dur - 5.5, (t) => { S.setKeyShift(0, t); if (lyd) S.setModeOverride(null, t); });
    P.onEnd = (t) => { S.setKeyShift(0, t); if (lyd) S.setModeOverride(null, t); };      // also when cut short by another artefact
    // timpani roll, accelerating
    P.every(0.5, 5.6, (rel) => lerp(b * 0.8, 0.065, Math.pow(clamp((rel - 0.5) / 5, 0, 1), 1.25)), (t, rel, k) => {
      const x = clamp((rel - 0.5) / 5, 0, 1);
      kit('timp', t, lerp(0.25, 0.72, x), { midi: S.rootNow() - 12 + (k % 2 ? 7 : 0), decay: 1.4 + 2 * x, pan: (k % 2 ? 0.3 : -0.3) });
    });
    // ride crescendo with open hats on the off-beats
    P.every(1.5, 19, b * 0.5, (t, rel, k) => {
      const x = clamp((rel - 1.5) / 17, 0, 1);
      kit('ride', t, lerp(0.2, 0.5, x), { tone: 0.35 + 0.5 * x, decay: 1.8 + x });
      if (k % 2 === 1) kit('hatO', t, 0.15 + 0.15 * x, { tone: 0.6 + 0.3 * S.rng.float(), pan: (S.rng.float() * 2 - 1) * 0.5 });
    });
    P.every(4, P.dur - 8, b * 4, (t, rel, k) => { kit('kick', t, 0.8, { decay: 0.5 }); kit('snare', t + b * 2, 0.7, { tone: 0.7 }); if (k % 2 === 0) kit('crash', t, 0.5, { tone: 0.7 }); });
    // the motif in octaves on lead and bass (whole in nevis: identity transform), three times, climbing a step each
    const onset = (() => { let c = 0; return M.durations.map((d) => { const o = c; c += d * b; return o; }); })();
    for (let r = 0; r < 3; r++) {
      const start = 5 + r * (tot + 2 * b);
      for (let i = 0; i < M.degrees.length; i++) {
        const d = M.degrees[i] + r;
        P.at(start + onset[i], (t) => {
          lead(lm(d, 0), t, b * M.durations[i] * 0.95, 0.72); bell(lm(d, 1), t, 2.4, 0.45); bell(lm(d, 2), t + 0.02, 2, 0.24);
          let bm = S.midi(d, -24); while (bm < 28) bm += 12; while (bm > 52) bm -= 12;
          bass(bm, t, b * M.durations[i] * 0.95, 0.7);
        });
      }
    }
    // tutti pads
    P.every(2.5, P.dur - 9, b * 8, (t, rel, k) => {
      const c = S.chordTonesForPad(0, [0, 2, 4, 8]);
      pad(c, t, b * 8 + 2, 0.66); cpad(c.map((m) => m + 12), t + 0.1, b * 8, 0.36);
    });
    P.at(P.dur - 8, (t) => { kit('crash', t, 1.0, { tone: 0.75, decay: 8 }); kit('gong', t, 0.8, { midi: S.rootNow() - 12, decay: 13 }); kit('timp', t, 1.0, { midi: S.rootNow() - 12 }); lead(lm(0, 1), t + 0.2, 6, 0.85); bell(lm(0, 2), t + 0.2, 8, 0.5); });
    P.shape = (rel) => (rel < 2.5 ? 1 : rel < 5 ? lerp(1, 0.58, (rel - 2.5) / 2.5) : rel < P.dur - 9 ? 0.58 + 0.06 * Math.sin(rel * 0.7) : lerp(0.58, 1, ramp(rel, P.dur - 9, P.dur - 7)) * (1 - 0.4 * ramp(rel, P.dur - 3, P.dur)));
    P.mods((rel) => {
      const w = env(rel, 2.5, P.dur - 9, 7);
      return {
        reverbSize: { v: 16, w }, reverbWet: 1 + 0.25 * w, delayFb: { v: 0.62, w }, delayWet: 1 + 0.25 * w, delayTime: { v: b * 0.75, w },
        gran: { pitch: { v: 12, w }, pitchSpread: { v: 7, w }, mix: { v: 0.95, w }, density: { v: 30, w } },
        energyFloor: 0.97 * Math.min(1, w * 2) * (1 - 0.24 * ramp(rel, 5, 9) * (1 - ramp(rel, P.dur - 9, P.dur - 7))), masterDrive: 0.1 * w,       // the tutti bed relaxes to flow in the body, back to swell for the close
        chMul: { pad: { cutoff: 1 + 0.5 * w }, drone: { cutoff: 1 + 0.4 * w } }, drone: { levelMul: 1 + 0.25 * w, cutMul: 1 + 0.5 * w },
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // gate-open cadence & level-complete finale
  // ------------------------------------------------------------------------------------------------
  /** the artefact that opens the gate ends by resolving into the tonic: crash, gong, the motif augmented, a long tonic chord */
  _appendCadence(P) {
    const { S, b, kit, lead, bell, pad, lm, M, rootLow, cum } = this._ctx(P);
    const A = transformMotif(M, 'augment');
    const onset = cum({ durations: A.durations });
    const t0 = P.dur - 2;
    P.at(t0, (tt) => {
      kit('crash', tt, 0.95, { tone: 0.6, decay: 7 }); kit('gong', tt, 0.9, { midi: S.rootNow() - 12, decay: 13, tone: 0.5 });
      S._applyChord(S.profile.chords[0], tt, { reason: 'cadence' });
      S.stage.v.aBass.note(rootLow(), S.at(tt), 6, 0.75);
    });
    for (let i = 0; i < A.degrees.length; i++) {
      P.at(t0 + 0.5 + onset[i], (tt) => { lead(lm(A.degrees[i], 0), tt, b * A.durations[i] * 0.95, 0.8); bell(lm(A.degrees[i], 1), tt, 3, 0.45); });
    }
    const end = t0 + 0.5 + onset[onset.length - 1] + b * A.durations[A.durations.length - 1] + 0.3;
    P.at(end, (tt) => {
      lead(lm(0, 0), tt, 5, 0.8); bell(lm(0, 2), tt, 8, 0.4); kit('timp', tt, 0.75, { midi: S.rootNow() - 12, decay: 4 });
      pad(S.chordTonesForPad(0, [0, 2, 4]), tt, 7, 0.7);
    });
    const m0 = P.modsFn;
    P.dur = Math.max(P.dur, end + 5);
    P.mods((rel, p) => {
      const base = m0 ? m0(rel, p) || {} : {};
      const w = env(rel - t0, 1.5, P.dur - t0 - 5, 5);
      return { ...base, reverbSize: { v: 13, w: Math.max(w, base.reverbSize ? (base.reverbSize.w ?? 0) : 0) }, energy: Math.max(base.energy ?? 0, 0.6 * w) };
    });
    P.state.gate = true;
  }

  _playCadence(t) {
    const S = this.S;
    const P = new Piece(this, 'cadence', t, { dur: 13, kind: 'cadence' });
    const { V, b, kit, lead, bell, pad, duck, lm, M, rootLow, cum } = this._ctx(P);
    const A = transformMotif(M, 'augment');
    const onset = cum({ durations: A.durations });
    duck(0.55, 0.05, 7, 4);
    P.at(0, (tt) => {
      kit('crash', tt, 0.95, { tone: 0.6, decay: 7 }); kit('gong', tt, 0.85, { midi: S.rootNow() - 12, decay: 13, tone: 0.5 });
      // tonic chord (voice-led pad, drone home, bass tonic)
      S._applyChord(S.profile.chords[0], tt, { reason: 'cadence' });
      V.aBass.note(rootLow(), S.at(tt), 6, 0.75);
    });
    for (let i = 0; i < A.degrees.length; i++) {
      P.at(0.5 + onset[i], (tt) => { lead(lm(A.degrees[i], 0), tt, b * A.durations[i] * 0.95, 0.8); bell(lm(A.degrees[i], 1), tt, 3, 0.45); });
    }
    const end = 0.5 + onset[onset.length - 1] + b * A.durations[A.durations.length - 1] + 0.3;
    P.at(end, (tt) => {
      lead(lm(0, 0), tt, 5, 0.8); bell(lm(0, 2), tt, 8, 0.4); kit('timp', tt, 0.75, { midi: S.rootNow() - 12, decay: 4 });
      pad(S.chordTonesForPad(0, [0, 2, 4]), tt, 7, 0.7);
    });
    P.dur = end + 5;
    P.mods((rel) => {
      const w = env(rel, 1.5, P.dur - 6, 5);
      return { reverbSize: { v: 13, w }, reverbWet: 1 + 0.3 * w, energy: 0.6 * w };
    });
    P.finish();
    this.pieces.push(P);
    S.log('cadence', {});
  }

  _build_finale(P) {
    const { S, V, b, kit, lead, bell, pluck, bass, pad, cpad, duck, lm, rootLow } = this._ctx(P);
    P.dur = 13;
    duck(0.6, 0.05, 8, 4);
    P.at(0, (t) => { kit('reverseSwell', t, 0.8, { length: 1.8, tone: 0.8 }); kit('breath', t, 0.4, { length: 1.6, tone: 0.6, pitch: 1.2 }); kit('gong', t, 0.5, { midi: S.rootNow() - 12, decay: 10, tone: 0.5 }); });
    P.at(1.8, (t) => {
      kit('crash', t, 1.0, { tone: 0.8, decay: 6 }); kit('gong', t, 0.9, { midi: S.rootNow() - 12, decay: 12 });
      kit('timp', t, 1.0, { midi: S.rootNow() - 12, decay: 4 });
      S._applyChord(S.profile.chords[0], t, { reason: 'finale' });
      pad(S.chordTonesForPad(0, [0, 2, 4, 8]), t, 8, 0.85); bass(rootLow(), t, 7, 0.8);
    });
    // rising arpeggio of the tonic chord across three octaves
    const arp = [0, 2, 4, 7, 9, 11, 14, 16];
    arp.forEach((d, i) => {
      P.at(2.0 + i * 0.17, (t) => { pluck(lm(d, 0), t, 1.5, 0.55 + 0.04 * i); bell(lm(d, 1), t + 0.02, 4, 0.3 + 0.04 * i); });
    });
    // the motif whole, in octaves
    const M = CONTOUR_MOTIF;
    M.forEach((d, i) => {
      P.at(3.4 + i * b * 0.9, (t) => { lead(lm(d, 0), t, b * 0.85, 0.88); bell(lm(d, 2), t, 3, 0.4); let bm = S.midi(d, -24); while (bm < 28) bm += 12; bass(bm, t, b * 0.85, 0.8); });
    });
    P.at(3.4 + 4.5 * b + 0.2, (t) => { lead(lm(0, 1), t, 5, 0.85); bell(lm(0, 2), t, 8, 0.5); cpad(S.chordTonesForPad(0, [0, 2, 4]).map((m) => m + 12), t, 6, 0.5); kit('crash', t, 0.6, { tone: 0.6, decay: 6 }); });
    P.mods((rel) => {
      const w = env(rel, 2, 7, 5);
      return {
        reverbSize: { v: 13.5, w }, reverbWet: 1 + 0.15 * w, delayFb: { v: 0.55, w }, freeze: rel > 5.5 && rel < 11,
        gran: { pitch: { v: 12, w }, mix: { v: 0.9, w }, density: { v: 26, w }, size: { v: 0.4, w }, spray: { v: 5, w }, reverse: { v: 0.4, w }, feedback: { v: 0.36, w } },
        energyFloor: 0.8 * ramp(rel, 1.2, 2.0) * (1 - ramp(rel, 5, 8)), masterDrive: 0.06 * w,
      };
    });
  }

  // ------------------------------------------------------------------------------------------------
  // concord: interlocking chime + sustained pad on the combined pitch set
  // ------------------------------------------------------------------------------------------------
  _concordChime(types, now) {
    const S = this.S, V = S.stage.v;
    const degs = types.map((t) => SIGNATURE[t] ?? 0);
    const pcs = combinedSet(S.rootNow(), S.modeNow(), degs);
    const base = S.profile.lead.base + S.keyShift;
    const q = S.cond.quantise(now + 0.05);
    let t = q.t;
    const midis = pcs.map((p) => nearestTone(base + 12, [p]));
    midis.sort((a, b) => a - b);
    midis.forEach((m, i) => { V.eBell.note(m, S.at(t + i * 0.14), 4.5, 0.42); });
    S.count('notes', 'eBell');
    S.hit('crash', t, 0.4, { tone: 0.5, decay: 5 }, true);
    S.log('concord', { types: types.join('+') });
  }

  // ------------------------------------------------------------------------------------------------
  // resonance echoes + concord pad
  // ------------------------------------------------------------------------------------------------
  _resonance(now, state) {
    const S = this.S, V = S.stage.v;
    const res = (state && state.resonance) || [];
    if (!res.length) { this.echo.clear(); return; }
    const busy = this.activeCount > 0;
    const types = [...new Set(res.map((r) => r.type))];
    const n = types.length;
    // concord pad: held pitch set while two or more artefacts resonate
    if (n >= 2 && now >= this.concordState.next && !busy) {
      const degs = types.map((t) => SIGNATURE[t] ?? 0);
      const pcs = combinedSet(S.rootNow(), S.modeNow(), degs);
      const center = S.profile.lead.base - 7 + S.keyShift;
      const v = voiceChord(this.concordState.prev, pcs.map((p) => p + 36), center - 3, center + 14);
      this.concordState.prev = v;
      const q = S.cond.quantise(now + 0.05);
      V.cPad.chord(v, S.at(q.t), 11, 0.24 * (1 - 0.35 * S.C.d));
      S.count('notes', 'cPad');
      this.concordState.next = now + 9;
      S.log('concord-pad', { n });
    }
    let idx = 0;
    for (const r of res) {
      let e = this.echo.get(r.poiId);
      const period = n >= 2 ? 7.2 + 0.5 * n : ECHO_PERIOD[r.type] || 10;
      if (!e) { e = { next: now + 5 + idx * (period / Math.max(1, n)) }; this.echo.set(r.poiId, e); }
      if (now >= e.next && !busy) {
        this._echo(r, idx, n, now);
        e.next = now + period * (0.92 + 0.16 * S.rng.float());
      }
      idx++;
    }
  }

  _echo(r, idx, n, now) {
    const S = this.S, V = S.stage.v, rng = S.rng;
    const { lm, b } = this._ctx({ t0: now });
    const q = S.cond.quantise(now + 0.05);
    let t = q.t;
    const type = r.type;
    const vel = (0.07 + 0.15 * clamp(r.strength, 0, 1)) * (1 - 0.4 * S.C.d);
    let M = S.motif();
    const op = { trig: null, cairn: 'retro', lochan: 'invert', waterfall: 'rotate:2', bothy: null, stone: null, crag: null, summit: null }[type];
    if (op) M = transformMotif(M, op);
    if (n >= 2) M = transformMotif(M, `rotate:${idx % M.degrees.length}`);
    const sp = type === 'waterfall' ? 0.5 : type === 'crag' ? 0.35 : 0.8;
    const count = Math.min(M.degrees.length, 3 + (rng.chance(0.5) ? 2 : 1));
    const off = n >= 2 ? idx * 0.5 : 0;
    t += off * b;
    for (let i = 0; i < count; i++) {
      const tt = t + i * b * sp * M.durations[i];
      const d = M.degrees[i];
      switch (type) {
        case 'trig': V.eBell.note(lm(d, 1), S.at(tt), 3, vel); break;
        case 'cairn': V.ePluck.note(lm(d, -1), S.at(tt), 1.4, vel * 1.2); break;
        case 'lochan': V.eBell.note(lm(d, 2), S.at(tt), 5, vel); break;
        case 'waterfall': V.ePluck.note(lm(d, 1), S.at(tt), 0.9, vel * 1.1); break;
        case 'bothy': { const relR = relativeMajorRoot(S.rootNow(), S.modeNow()) + 12; V.ePluck.note(degreeToMidi(relR + 12, WARM_MODE, d), S.at(tt), 1.5, vel * 1.1); break; }
        case 'stone': V.eBell.note(S.rootNow() + 12 + MODES.octatonic[((d % 8) + 8) % 8] + (i % 2 ? 12 : 0), S.at(tt), 6, vel * 0.9); break;
        case 'crag': S.hit('rim', tt, vel * 1.3, { pitch: 0.9 + 0.1 * i }, true); V.eBell.note(lm(d, 1), S.at(tt), 0.8, vel * 0.7); break;
        default: V.eBell.note(lm(d, 1), S.at(tt), 3, vel); V.eBell.note(lm(d, 2), S.at(tt + 0.01), 3, vel * 0.5); break;
      }
    }
    // every echo comes home: a longer, slightly stronger tonic closes the motif
    const tend = t + count * b * sp;
    if (type === 'bothy') V.ePluck.note(degreeToMidi(relativeMajorRoot(S.rootNow(), S.modeNow()) + 24, WARM_MODE, 0), S.at(tend), 2.5, vel * 1.3);
    else if (type === 'crag') S.hit('rim', tend, vel * 1.3, { pitch: 0.8 }, true);
    else V.eBell.note(lm(0, 1), S.at(tend), 5, vel * 1.25);
    S.count('notes', 'echo');
  }

  // ------------------------------------------------------------------------------------------------
  // pre-echo: each artefact's signature layer fades in as you near it (found by ear). Called every 16th.
  // ------------------------------------------------------------------------------------------------
  onStep(s, prox) {
    if (!prox) return;
    const S = this.S, V = S.stage.v, rng = S.rng;
    if (this.activeCount) return;
    const b = S.beat();
    for (const type of Object.keys(prox)) {
      const c = prox[type];
      if (c < 0.08) continue;
      const vel = 0.07 + 0.3 * c;
      const t = s.t;
      const lm = (d, oct = 0) => S.midi(d, S.profile.lead.base - S.profile.root + 12 * oct);
      switch (type) {
        case 'trig':     // two clean pings, left/right, every two beats
          if (s.i16 % 8 === 0 && rng.float() < 0.3 + 0.7 * c) { V.eBell.note(lm(0, 2), S.at(t), 2.2, vel); V.eBell.note(lm(4, 2), S.at(t + b * 0.75), 2.2, vel * 0.8); S.count('notes', 'pre'); }
          break;
        case 'cairn':    // stones clicking onto a pile
          if ((s.i16 & 1) === 0 && rng.float() < 0.28 * c) { V.ePluck.note(lm(rng.pick([0, 2, 4]), -1), S.at(t), 1, vel * 1.2); S.count('notes', 'pre'); }
          break;
        case 'lochan':   // glassy shimmer
          if (s.i16 === 0 && s.barInPhrase % 2 === 0 && rng.float() < 0.5 + 0.5 * c) { V.eBell.note(lm(rng.pick([4, 6, 2]), 2), S.at(t), 4, vel); S.count('notes', 'pre'); }
          break;
        case 'waterfall':// rising breath
          if (s.i16 === 0 && rng.float() < 0.4 + 0.6 * c) { S.hit('breath', t, 0.1 + 0.35 * c, { length: b * 3, tone: 0.8, pitch: 1.2 }, true); S.count('notes', 'pre'); }
          if ((s.i16 & 3) === 2 && rng.float() < 0.25 * c) S.hit('shaker', t, 0.15 + 0.25 * c, { tone: 0.9, pan: rng.float() * 1.2 - 0.6 }, true);
          break;
        case 'bothy':    // a warm tone from the hut
          if (s.i16 === 0 && s.barInPhrase === 1 && rng.float() < 0.3 + 0.7 * c) {
            const relR = relativeMajorRoot(S.rootNow(), S.modeNow()) + 12;
            V.cPad.chord([degreeToMidi(relR, WARM_MODE, 0), degreeToMidi(relR, WARM_MODE, 4)], S.at(t), 5, 0.18 + 0.3 * c);
            S.count('notes', 'pre');
          }
          break;
        case 'stone':    // a distant gong
          if (s.i16 === 0 && s.barInPhrase % 2 === 1 && rng.float() < 0.25 + 0.5 * c) { S.hit('gong', t, 0.1 + 0.4 * c, { midi: S.rootNow() - 12, decay: 10 }, true); S.count('notes', 'pre'); }
          break;
        case 'crag':     // ringing rim echoes
          if ((s.i16 & 1) === 1 && rng.float() < 0.5 * c) { S.hit('rim', t, 0.1 + 0.35 * c, { pitch: 0.8 + 0.5 * rng.float(), pan: rng.float() - 0.5 }, true); S.count('notes', 'pre'); }
          break;
        case 'summit':   // a rising shimmer of octaves
          if (s.i16 % 4 === 0 && rng.float() < 0.3 + 0.6 * c) { const k = ((s.step / 4) | 0) % 8; V.eBell.note(lm(k, 2), S.at(t), 2.5, vel); S.count('notes', 'pre'); }
          if (s.i16 === 0 && c > 0.4 && rng.float() < c) S.hit('ride', t, 0.08 + 0.25 * c, { tone: 0.8 }, true);
          break;
        default: break;
      }
    }
  }
}
