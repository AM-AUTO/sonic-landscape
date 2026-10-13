/**
 * Conductor — the lookahead clock and the chance machinery. No timers: everything is driven by update(now)
 * (called from Audio.update every frame, real-time or offline), so it behaves identically under
 * OfflineAudioContext.
 *
 *   • schedules 16th steps up to now + LOOKAHEAD; a gap of more than 0.5 s (background tab, pause) skips ahead
 *     instead of bursting;
 *   • tracks step / beat / bar / phrase and the section (ebb | flow | swell) from smoothed energy with hysteresis,
 *     calling hooks.onTransition when a change is decided (so the score can place a reverse swell / fill that
 *     lands on the downbeat) and hooks.onSection when it takes effect (crash, ride, ...);
 *   • every 4–8 bars calls hooks.onMutate so pattern generators can rotate / re-pulse;
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

export class Conductor {
  /**
   * @param {{rng: Rng, hooks?: {onStep, onSection, onTransition, onMutate}}} opts
   */
  constructor({ rng, hooks = {}, bpm = 64, swing = 0, phraseBars = 4 } = {}) {
    this.rng = rng;
    this.hooks = hooks;
    this.bpm = bpm; this.bpmTarget = bpm;
    this.swing = swing; this.swingTarget = swing;
    this.phraseBars = phraseBars;

    this.started = false;
    this.nextTime = 0;        // time of the next step to schedule
    this.step = 0;            // index of the next step to schedule
    this.lastNow = null;

    this.energy = 0.1;        // smoothed
    this.energyTarget = 0.1;
    this.section = 'ebb';
    this.pending = null;      // {to, applyStep}
    this.sectionStartStep = 0;
    this.nextMutateBar = 6;
    this.skipped = 0;
    this.stats = { steps: 0, skips: 0, sections: 0, mutations: 0 };
  }

  get stepDur() { return 60 / this.bpm / 4; }
  get beatDur() { return 60 / this.bpm; }
  get barDur() { return 240 / this.bpm; }
  get bar() { return Math.floor(this.step / 16); }

  setTempo(bpm, swing) {
    if (Number.isFinite(bpm)) this.bpmTarget = Math.max(30, Math.min(200, bpm));
    if (Number.isFinite(swing)) this.swingTarget = Math.max(0, Math.min(0.5, swing));
  }
  /** jump immediately (level change) */
  snapTempo(bpm, swing, phraseBars) {
    this.setTempo(bpm, swing);
    this.bpm = this.bpmTarget; this.swing = this.swingTarget;
    if (phraseBars) this.phraseBars = phraseBars;
  }

  /** `fallTc`: seconds the smoothed energy takes to fall (drift passes a short one so the pulse really lets go) */
  setEnergy(e, fallTc = 7) { if (Number.isFinite(e)) this.energyTarget = Math.max(0, Math.min(1, e)); this.fallTc = Number.isFinite(fallTc) ? fallTc : 7; }

  /** force a section immediately (artefacts like Apex), no fill */
  forceSection(sec) {
    this.section = sec; this.pending = null; this.sectionStartStep = this.step;
  }

  /** restart the bar counter on the next update (new level) */
  reset() {
    this.started = false; this.pending = null; this.section = 'ebb'; this.energy = 0.1; this.energyTarget = 0.1;
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

  /** per-update clock. now: ctx.currentTime. Returns number of steps scheduled. */
  update(now) {
    if (!this.started) {
      this.started = true;
      this.nextTime = now + 0.08;
      // start on a bar line
      this.step = Math.ceil(this.step / 16) * 16;
      this.lastNow = now;
      this.sectionStartStep = this.step;
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

    // large gap or fallen far behind: skip ahead rather than burst
    const behind = now - this.nextTime;
    if (dt > MAX_GAP || behind > 0.25) {
      const sd = this.stepDur;
      const n = Math.ceil((now + 0.03 - this.nextTime) / sd);
      if (n > 0) {
        this.step += n; this.nextTime += n * sd;
        this.stats.skips++;
        if (this.pending && this.step >= this.pending.applyStep) this._applyPending(this.nextTime);
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
    const e = this.energy, s = this.section;
    const held = this.step - this.sectionStartStep;
    if (this.pending || held < (s === 'ebb' ? 8 : 24)) return null;       // waking from ebb is quick: movement should be answered in a few seconds
    let to = s;
    if (s === 'ebb') { if (e > 0.3) to = 'flow'; }
    else if (s === 'flow') { if (e > 0.7) to = 'swell'; else if (e < 0.19) to = 'ebb'; }
    else if (e < 0.56) to = 'flow';
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
    if (this.hooks.onSection) this.hooks.onSection({ from, to: this.section, t, step: p.applyStep });
  }

  _scheduleStep() {
    const step = this.step, sd = this.stepDur;
    const swing = (step & 1) ? this.swing * sd : 0;
    const t = this.nextTime + swing;
    const i16 = step % 16, bar = Math.floor(step / 16);
    const barInPhrase = bar % this.phraseBars;

    // apply a pending section change on its bar line
    if (this.pending && step >= this.pending.applyStep) this._applyPending(t);

    // decide a new section change
    const to = this._evalSection();
    if (to) {
      // land on a bar line at least half a bar away
      let apply = (Math.floor(step / 16) + 1) * 16;
      if (apply - step < 8) apply += 16;
      // ebb → flow lands on the next half-bar (at least 4 steps away) rather than waiting for a whole bar line
      if (this.section === 'ebb' && to === 'flow') { apply = (Math.floor(step / 8) + 1) * 8; if (apply - step < 4) apply += 8; }
      const tApply = this.nextTime + (apply - step) * sd;
      this.pending = { to, applyStep: apply };
      if (this.hooks.onTransition) this.hooks.onTransition({ from: this.section, to, t, tApply, lenSec: tApply - t, step, applyStep: apply });
    }

    // mutation every 4–8 bars
    if (i16 === 0 && bar >= this.nextMutateBar) {
      this.nextMutateBar = bar + this.rng.int(4, 8);
      this.stats.mutations++;
      if (this.hooks.onMutate) this.hooks.onMutate({ bar, t });
    }

    if (this.hooks.onStep) {
      this.hooks.onStep({
        t, step, sd, i16, beat: Math.floor(i16 / 4), bar, barInPhrase,
        phrase: Math.floor(bar / this.phraseBars),
        isDownbeat: i16 === 0, isPhraseStart: i16 === 0 && barInPhrase === 0,
        isBackbeat: i16 === 4 || i16 === 12, section: this.section, energy: this.energy,
      });
    }
    this.stats.steps++;
    this.step++;
    this.nextTime += sd;
  }
}
