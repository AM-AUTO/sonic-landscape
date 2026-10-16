/**
 * Conductor — the lookahead clock and the chance machinery. No timers: everything is driven by update(now)
 * (called from Audio.update every frame, real-time or offline), so it behaves identically under
 * OfflineAudioContext.
 *
 *   • schedules 16th steps up to now + LOOKAHEAD; a gap of more than 0.5 s (background tab, pause) skips ahead
 *     instead of bursting;
 *   • tracks step / beat / bar / phrase / STANZA (N bars, the profile's stanzaBars) and the section (ebb | flow | swell)
 *     from smoothed energy with hysteresis. Sections only change on stanza downbeats: the next stanza is planned at the
 *     first step of the current stanza's last bar (hooks.onStanzaPlan, then hooks.onTransition when the section
 *     changes, so the score has a full bar for a pickup / fill) and committed on the downbeat (hooks.onSection, then
 *     hooks.onStanza). Explicit cuts (requestCut) also wait for the next stanza downbeat;
 *   • every 4–8 bars (on a stanza downbeat) calls hooks.onMutate so pattern generators can rotate / re-pulse;
 *   • exports the building blocks: euclid(), PatternGen (probabilistic Euclid), MelodyMarkov, humanise().
 */

export const LOOKAHEAD = 0.15;
export const MAX_GAP = 0.5;

// ------------------------------------------------------------------------------------------------
// Euclid & pattern generators
// ------------------------------------------------------------------------------------------------

/** Euclidean rhythm: k onsets spread over n steps, rotated right by `rot`. */
export function euclid(k, n, rot = 0) {
  n = Math.max(1, Math.round(n));
  k = Math.max(0, Math.min(n, Math.round(k)));
  const out = new Array(n).fill(false);
  if (k === 0) return out;
  for (let i = 0; i < n; i++) {
    if ((i * k) % n < k) out[(i + Math.round(rot)) % n] = true;
  }
  return out;
}

const pickOf = (rng, arr, def) => (Array.isArray(arr) && arr.length ? arr[Math.floor(rng.float() * arr.length)] : def);

/**
 * One drum voice's probabilistic Euclid pattern. spec: { ebb?, flow?, swell?: {p, k:[..], n, rot:[..]}, vel:[lo,hi], ... }.
 * Each section holds its own current (k, n, rot); mutate() re-draws them.
 */
export class PatternGen {
  constructor(spec, rng) {
    this.spec = spec;
    this.rng = rng;
    this.h = spec.h;
    this.cur = {};
    for (const s of ['ebb', 'flow', 'swell']) if (spec[s]) this.cur[s] = this._draw(spec[s], null);
  }

  _draw(cfg, prev) {
    const rng = this.rng;
    const n = cfg.n || 16;
    let k = pickOf(rng, cfg.k, 3);
    let rot = pickOf(rng, cfg.rot, 0);
    if (prev && rng.chance(0.5)) rot = (prev.rot + (rng.chance(0.5) ? 1 : -1) + n) % n;   // drift the existing pattern
    return { k, n, rot, mask: euclid(k, n, rot) };
  }

  mutate(strength = 1) {
    for (const s of Object.keys(this.cur)) {
      if (this.rng.float() < 0.55 * strength) this.cur[s] = this._draw(this.spec[s], this.cur[s]);
    }
  }

  /** is the pattern gate open for this section at global step `i`? */
  gate(section, i) {
    const c = this.cur[section];
    if (!c) return false;
    return c.mask[i % c.n];
  }
  cfg(section) { return this.spec[section]; }
}

/** Markov melody over scale-degree indices. next() returns a new degree near the current one. */
export class MelodyMarkov {
  constructor(rng, { center = 4, span = 9 } = {}) {
    this.rng = rng;
    this.center = center;
    this.span = span;
    this.pos = center;
    // interval weights: repeat, step, skip, leap
    this.base = { 0: 0.35, 1: 3.0, 2: 2.0, 3: 1.0, 4: 0.5, 5: 0.2 };
  }

  reset(pos) { this.pos = pos ?? this.center; }

  /**
   * dir: -1..1 directional bias (ascending contour momentum); isChord(deg) → bool for chord-tone attraction.
   * Returns the chosen degree (also stored as the new state).
   */
  next({ dir = 0, isChord = null, jump = 1 } = {}) {
    const rng = this.rng, lo = 0, hi = this.span;
    const weights = [], cands = [];
    for (let iv = -5; iv <= 5; iv++) {
      const to = this.pos + iv;
      if (to < lo - 2 || to > hi + 2) continue;
      let w = this.base[Math.abs(iv)] ?? 0.1;
      if (iv > 0) w *= 1 + 1.6 * Math.max(0, dir) + 0.0 - 0.5 * Math.max(0, -dir);
      if (iv < 0) w *= 1 + 1.6 * Math.max(0, -dir) - 0.5 * Math.max(0, dir);
      if (Math.abs(iv) > 2) w *= jump;
      // gentle pull toward the centre of the register, except while climbing/descending steadily
      const off = (to - this.center) / (this.span * 0.5);
      w *= Math.exp(-0.5 * off * off * (1 - 0.6 * Math.abs(dir)));
      if (isChord && isChord(to)) w *= 1.7;
      if (w > 0.0001) { weights.push(w); cands.push(to); }
    }
    if (!cands.length) return this.pos;
    this.pos = cands[rng.weighted(weights)];
    return this.pos;
  }
}

/** timing humanisation: t ± up to amt × sd, never before `floor`. */
export function humanise(t, sd, rng, amt = 0.03, floor = 0) {
  return Math.max(floor, t + (rng.float() * 2 - 1) * amt * sd);
}

// ------------------------------------------------------------------------------------------------
// Conductor
// ------------------------------------------------------------------------------------------------

export const SECTIONS = ['ebb', 'flow', 'swell'];
export const STANZA_BARS = 4;

/**
 * The section energy `e` asks for, coming from section `s` (hysteresis: ebb → flow above 0.3; flow → swell above 0.7,
 * → ebb below 0.19; swell → flow below 0.56). Pure, so the score can ask what a predicted energy would lead to.
 */
export function sectionFor(e, s) {
  if (s === 'ebb') return e > 0.3 ? 'flow' : 'ebb';
  if (s === 'flow') return e > 0.7 ? 'swell' : e < 0.19 ? 'ebb' : 'flow';
  return e < 0.56 ? 'flow' : 'swell';
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export class Conductor {
  /**
   * @param {{rng: Rng, hooks?: {onStep, onSection, onTransition, onMutate, onStanzaPlan, onStanza}}} opts
   *
   * Form: a stanza is `stanzaBars` bars (the level profile's `stanzaBars`, default 4). The grid starts on a line where
   * a phrase and a stanza both begin, so stanza downbeats are also bar (and phrase, when they divide) lines.
   *   • at the first step of a stanza's LAST bar the conductor plans the next one: it decides the section (energy model
   *     + hysteresis, or a requested cut) and calls hooks.onStanzaPlan({stanza, at, step, applyStep, from, to, lenSec})
   *     so the score can choose the next arrangement and schedule a pickup; then, if the section changes,
   *     hooks.onTransition({from, to, t, tApply, lenSec, ...}) with a full bar to fill;
   *   • at the next stanza downbeat the section change applies (hooks.onSection) and then hooks.onStanza({stanza, t,
   *     step, section, planned}) commits the arrangement. Sections never change anywhere else.
   */
  constructor({ rng, hooks = {}, bpm = 64, swing = 0, phraseBars = 4, stanzaBars = STANZA_BARS } = {}) {
    this.rng = rng;
    this.hooks = hooks;
    this.bpm = bpm; this.bpmTarget = bpm;
    this.swing = swing; this.swingTarget = swing;
    this.phraseBars = phraseBars;
    this.stanzaBars = Math.max(1, Math.round(stanzaBars) || STANZA_BARS);

    this.started = false;
    this.nextTime = 0;        // time of the next step to schedule
    this.step = 0;            // index of the next step to schedule
    this.lastNow = null;

    this.energy = 0.1;        // smoothed
    this.energyTarget = 0.1;
    this.section = 'ebb';
    this.pending = null;      // {to, applyStep}: a section change waiting for its stanza downbeat
    this.planned = null;      // {stanza, applyStep, at}: the plan made in the last bar for the coming downbeat
    this.cut = null;          // {to}: an explicit cut (requestCut) waiting for the next plan
    this._planning = false;
    this.stanzaOrigin = 0;    // step of stanza 0's downbeat
    this.sectionStartStep = 0;
    this.nextMutateBar = 6;
    this.skipped = 0;
    this.stats = { steps: 0, skips: 0, sections: 0, mutations: 0, stanzas: 0, plans: 0, cuts: 0 };
  }

  get stepDur() { return 60 / this.bpm / 4; }
  get beatDur() { return 60 / this.bpm; }
  get barDur() { return 240 / this.bpm; }
  get stanzaDur() { return this.barDur * this.stanzaBars; }
  get bar() { return Math.floor(this.step / 16); }
  get stanzaSteps() { return 16 * this.stanzaBars; }
  /** stanza index / bar-in-stanza of step `k` (default: the next step to schedule) */
  stanzaOf(k = this.step) { return Math.floor((k - this.stanzaOrigin) / this.stanzaSteps); }
  barInStanzaOf(k = this.step) { const b = Math.floor((k - this.stanzaOrigin) / 16), n = this.stanzaBars; return ((b % n) + n) % n; }
  get stanza() { return this.stanzaOf(this.step); }
  get barInStanza() { return this.barInStanzaOf(this.step); }
  /** step of stanza k's downbeat */
  stanzaStep(k) { return this.stanzaOrigin + k * this.stanzaSteps; }
  isStanzaStart(k) { return (((k - this.stanzaOrigin) % this.stanzaSteps) + this.stanzaSteps) % this.stanzaSteps === 0; }

  setTempo(bpm, swing) {
    if (Number.isFinite(bpm)) this.bpmTarget = Math.max(30, Math.min(200, bpm));
    if (Number.isFinite(swing)) this.swingTarget = Math.max(0, Math.min(0.5, swing));
  }
  /** jump immediately (level change). stanzaBars takes effect when the grid restarts (reset()). */
  snapTempo(bpm, swing, phraseBars, stanzaBars) {
    this.setTempo(bpm, swing);
    this.bpm = this.bpmTarget; this.swing = this.swingTarget;
    if (phraseBars) this.phraseBars = phraseBars;
    if (stanzaBars) this.stanzaBars = Math.max(1, Math.round(stanzaBars));
  }

  /** `fallTc`: seconds the smoothed energy takes to fall (drift passes a short one so the pulse really lets go) */
  setEnergy(e, fallTc = 7) { if (Number.isFinite(e)) this.energyTarget = Math.max(0, Math.min(1, e)); this.fallTc = Number.isFinite(fallTc) ? fallTc : 7; }

  /**
   * An explicit cut to `section`. It never lands off a stanza boundary: it is taken by the next plan and applies on the
   * next stanza downbeat. If the coming downbeat has already been planned and at least a beat remains before it, the
   * plan is redone at once (onStanzaPlan with replan: true, and onTransition with the shorter lead); otherwise it waits
   * for the following stanza. Returns the stanza index it will land on (or null for an unknown section).
   */
  requestCut(section) {
    if (!SECTIONS.includes(section)) return null;
    this.stats.cuts++;
    this.cut = { to: section };
    if (this._planning || !this.started) return this.planned ? this.planned.stanza : this.stanza + 1;
    const p = this.planned;
    if (p && p.applyStep - this.step >= 4) {
      this.cut = null;
      const from = this.section;
      const already = this.pending ? this.pending.to : from;
      if (already !== section) {
        const t = this.timeOfStep(this.step);
        this._planning = true;
        try { if (this.hooks.onStanzaPlan) this.hooks.onStanzaPlan({ stanza: p.stanza, at: p.at, t, step: this.step, applyStep: p.applyStep, from, to: section, lenSec: p.at - t, replan: true }); }
        finally { this._planning = false; }
        this.cut = null;
        this._commit(from, section, t, p.at, this.step, p.applyStep);
      }
      return p.stanza;
    }
    return p ? p.stanza + 1 : this.stanza + 1;
  }
  /** kept for callers of the old API: a forced section is now an explicit cut on the next stanza downbeat */
  forceSection(sec) { return this.requestCut(sec); }

  /** restart the bar counter on the next update (new level) */
  reset() {
    this.started = false; this.pending = null; this.planned = null; this.cut = null;
    this.section = 'ebb'; this.energy = 0.1; this.energyTarget = 0.1;
    this.nextMutateBar = 6;
  }

  /** time of step `k` (>= this.step) given the current tempo and swing, relative to nextTime */
  timeOfStep(k) {
    const sd = this.stepDur;
    return this.nextTime + (k - this.step) * sd + ((k & 1) ? this.swing * sd : 0);
  }

  /**
   * First grid point (a 16th, or finer with div>1: 2 = 32nds) at or after time t. Returns {t, step}.
   */
  quantise(t, div = 1) {
    const sd = this.stepDur / div;
    const n = Math.ceil((t - this.nextTime) / sd - 1e-6);
    const step = this.step + Math.floor(n / div);
    return { t: this.nextTime + n * sd, step, sub: ((n % div) + div) % div };
  }

  /** the first 16th at or after t, with its own (swung) time — scheduled or not. Returns {t, step}. */
  next16(t) {
    const q = this.quantise(t);
    return { t: Math.max(q.t, this.timeOfStep(q.step)), step: q.step };
  }

  /**
   * First grid line of `tier` ('16th' | 'beat' | 'bar' | 'stanza') at or after time t that has not been scheduled yet.
   * Returns {t, step} (t is the predicted time at the current tempo).
   */
  nextGrid(t, tier = '16th') {
    let step = Math.max(this.step, this.quantise(t).step);
    if (tier === 'beat') step = Math.ceil(step / 4) * 4;
    else if (tier === 'bar') step = Math.ceil(step / 16) * 16;
    else if (tier === 'stanza') step = this.stanzaStep(Math.ceil((step - this.stanzaOrigin) / this.stanzaSteps));
    return { t: this.timeOfStep(step), step };
  }

  /** per-update clock. now: ctx.currentTime. Returns number of steps scheduled. */
  update(now) {
    if (!this.started) {
      this.started = true;
      this.nextTime = now + 0.08;
      // start on a line where a phrase and a stanza both begin (the step index is a counter: jumping it costs no time)
      const pb = Math.max(1, this.phraseBars | 0), sb = this.stanzaBars;
      const lcm = (pb * sb) / gcd(pb, sb);
      this.step = Math.ceil(this.step / (16 * lcm)) * (16 * lcm);
      this.stanzaOrigin = this.step;
      this.lastNow = now;
      this.sectionStartStep = this.step;
      this.pending = null; this.planned = null;
      this.nextMutateBar = this.bar + this.rng.int(4, 8);
    }
    const dt = Math.max(0, now - this.lastNow);
    this.lastNow = now;

    // smooth tempo / swing / energy
    const k = (tc) => 1 - Math.exp(-dt / tc);
    this.bpm += (this.bpmTarget - this.bpm) * k(6);
    this.swing += (this.swingTarget - this.swing) * k(4);

    if (!Number.isFinite(this.energy)) this.energy = this.energyTarget;
    this.energy += (this.energyTarget - this.energy) * k(this.energyTarget > this.energy ? 1.6 : (this.fallTc || 7));

    // large gap or fallen far behind: skip ahead rather than burst. A plan or a pending change skipped over is
    // dropped (the next plan decides afresh): nothing is applied off a stanza downbeat.
    const behind = now - this.nextTime;
    if (dt > MAX_GAP || behind > 0.25) {
      const sd = this.stepDur;
      const n = Math.ceil((now + 0.03 - this.nextTime) / sd);
      if (n > 0) {
        this.step += n; this.nextTime += n * sd;
        this.stats.skips++;
        if (this.pending && this.pending.applyStep < this.step) this.pending = null;
        if (this.planned && this.planned.applyStep < this.step) this.planned = null;
      }
    }

    let n = 0;
    while (this.nextTime < now + LOOKAHEAD && n < 64) {
      this._scheduleStep();
      n++;
    }
    return n;
  }

  _evalSection() {
    const s = this.section;
    const held = this.step - this.sectionStartStep;
    if (held < (s === 'ebb' ? 8 : 24)) return null;       // a section that has only just begun is not left at once
    const to = sectionFor(this.energy, s);
    return to === s ? null : to;
  }

  _applyPending(t) {
    const p = this.pending;
    if (!p) return;
    const from = this.section;
    this.section = p.to;
    this.sectionStartStep = p.applyStep;
    this.pending = null;
    this.stats.sections++;
    if (this.hooks.onSection) this.hooks.onSection({ from, to: this.section, t, step: p.applyStep, stanza: this.stanzaOf(p.applyStep) });
  }

  /** plan stanza `next` (called at the first scheduled step of the stanza before, in its last bar) */
  _plan(next, step, t) {
    const applyStep = this.stanzaStep(next);
    const tApply = this.timeOfStep(applyStep);
    const from = this.section;
    let to = this.cut ? this.cut.to : (this._evalSection() ?? from);
    this.planned = { stanza: next, applyStep, at: tApply };
    this.stats.plans++;
    this._planning = true;
    try { if (this.hooks.onStanzaPlan) this.hooks.onStanzaPlan({ stanza: next, at: tApply, t, step, applyStep, from, to, lenSec: tApply - t }); }
    finally { this._planning = false; }
    if (this.cut) { to = this.cut.to; this.cut = null; }
    this._commit(from, to, t, tApply, step, applyStep);
  }

  _commit(from, to, t, tApply, step, applyStep) {
    if (to === from) { this.pending = null; return; }
    this.pending = { to, applyStep };
    if (this.hooks.onTransition) this.hooks.onTransition({ from, to, t, tApply, lenSec: tApply - t, step, applyStep, stanza: this.stanzaOf(applyStep) });
  }

  _scheduleStep() {
    const step = this.step, sd = this.stepDur;
    const swing = (step & 1) ? this.swing * sd : 0;
    const t = this.nextTime + swing;
    const i16 = step % 16, bar = Math.floor(step / 16);
    const barInPhrase = bar % this.phraseBars;
    const stanza = this.stanzaOf(step), barInStanza = this.barInStanzaOf(step);
    const isStanzaStart = this.isStanzaStart(step);

    // the stanza downbeat: a pending section change applies, then the arrangement is committed
    if (isStanzaStart) {
      if (this.pending && step >= this.pending.applyStep) this._applyPending(t);
      const planned = !!(this.planned && this.planned.stanza === stanza);
      if (this.planned && this.planned.applyStep <= step) this.planned = null;
      this.stats.stanzas++;
      if (this.hooks.onStanza) this.hooks.onStanza({ stanza, t, step, section: this.section, planned });
    }
    // the plan for the next stanza: at the first step scheduled in this stanza's last bar (normally its downbeat)
    let isStanzaPlan = false;
    if (barInStanza === this.stanzaBars - 1 && !(this.planned && this.planned.stanza === stanza + 1)) {
      isStanzaPlan = true;
      this._plan(stanza + 1, step, t);
    }

    // pattern mutation every 4–8 bars, on a stanza downbeat (the kit pattern is part of the arrangement)
    if (isStanzaStart && bar >= this.nextMutateBar) {
      this.nextMutateBar = bar + this.rng.int(4, 8);
      this.stats.mutations++;
      if (this.hooks.onMutate) this.hooks.onMutate({ bar, t, stanza });
    }

    if (this.hooks.onStep) {
      this.hooks.onStep({
        t, step, sd, i16, beat: Math.floor(i16 / 4), bar, barInPhrase,
        phrase: Math.floor(bar / this.phraseBars),
        stanza, barInStanza, stanzaBars: this.stanzaBars, isStanzaStart, isStanzaPlan,
        isDownbeat: i16 === 0, isPhraseStart: i16 === 0 && barInPhrase === 0,
        isBackbeat: i16 === 4 || i16 === 12, section: this.section, energy: this.energy,
      });
    }
    this.stats.steps++;
    this.step++;
    this.nextTime += sd;
  }
}
