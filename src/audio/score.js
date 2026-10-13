/**
 * Score — THE mapping layer (docs/DESIGN.md "Score mapping"). It reads GameState each update(), turns events
 * into quantised notes, drives the conductor's chance machinery, and morphs every channel and global effect
 * from the continuous state (altitude, slope, speed, stillness, cover, heading, time of day, proximity).
 *
 *   contour (minor)  → soft pluck/bell tick, quantised to the next 16th, ≤1 per 16th (extras brighten)
 *   contour (index)  → foreground Lead note + bell double; Markov continuation while ascending
 *   grid change      → seeded-hash chord, voice-led pad + drone + bass; major line adds a crash swell
 *   slope / speed    → percussion density, kick & tom weight, hat grid, granular density
 *   still > 4 s      → Drift: pulse fades, drone opens, Eno tape-loop bells, reverb grows
 *   altitude         → drone/pad cutoff + register, reverb 2→14 s, delay feedback ceiling, lead octave
 *   cover            → texture layer & timbre, percussion colour (scree snaps, rock metal, snow bells…)
 *   heading          → lead pan, chord inversion       time of day → mode variant, tempo, delay
 *   proximity        → artefact pre-echo              fragments → ghost motifs from completed levels
 *   poi / chain / gate-open / level-complete → artefacts.js
 */
import { degreeToMidi } from './theory.js';
import { Drone } from './voices/drone.js';
import { TEXTURE_NOISE } from './voices/texture.js';
import { Conductor, PatternGen, MelodyMarkov, humanise } from './conductor.js';
import { pickChordIndex, chordTones, chordRoot, voiceChord, droneNotes, nearestTone, pc } from './harmony.js';
import {
  PROFILES, getProfile, motifFor, kitGens, textureFor, COVER_KEYS, CHANNEL_NAMES, FRONT_CHANNELS,
} from './levelmusic.js';
import { createStage, applyProfile } from './stage.js';
import { channelTarget, applyChannelMods, fxTargets, clamp, lerp, ovr } from './macros.js';
import { Artefacts } from './artefacts.js';

const GRID_CELLS = 25;
const TAU = Math.PI * 2;
const CEILING_DB = -13.5;      // sustained long-term level the leveler will not let the mix exceed
/** the bed's own level against its section: ebb is a whisper, flow sits back, only swell is full (dB, vs the swell reference) */
const BED_CURVE = [[0, -12], [0.25, -9], [0.45, -5], [0.7, -1.5], [1, 0]];
function bedCurveDb(e) {
  for (let i = 1; i < BED_CURVE.length; i++) {
    if (e <= BED_CURVE[i][0]) { const [x0, y0] = BED_CURVE[i - 1], [x1, y1] = BED_CURVE[i]; return y0 + (y1 - y0) * ((e - x0) / (x1 - x0)); }
  }
  return 0;
}
const BUDGET_RATE = 30, BUDGET_MAX = 80;
const HIT_COST = { kick: 15, snare: 22, rim: 9, clap: 16, hatC: 12, hatO: 14, ride: 18, crash: 20, tomL: 12, tomM: 12, tomH: 12, timp: 18, gong: 40, click: 7, snap: 9, grainBurst: 35, breath: 7, reverseSwell: 12, metal: 10, shaker: 6 };
const STRUCTURAL = new Set(['crash', 'gong', 'timp', 'reverseSwell']);          // always sound
const smooth = (cur, target, dt, tcUp, tcDown = tcUp) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? tcUp : tcDown)));
const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

export class Score {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.rng = engine.rng;
    this.stage = createStage(engine);
    this.cond = new Conductor({
      rng: this.rng,
      hooks: {
        onStep: (s) => this._onStep(s),
        onTransition: (x) => this._onTransition(x),
        onSection: (x) => this._onSection(x),
        onMutate: (x) => this._onMutate(x),
      },
    });
    this.art = new Artefacts(this);

    this.profile = null; this.levelId = null; this.levelDef = null; this.seed = 1;
    this.base = null; this.P = null;
    this.drone = null;
    this.texStarted = false;
    this.volume = 1;

    // musical state
    this.keyShift = 0; this.modeOverride = null;
    this.modeKind = 'day'; this.pendingModeKind = null;
    this.entry = null; this.padPrev = null; this.lastPadBar = -99; this.padVariant = 0;
    this.altOct = 0;
    this.gridPending = null;
    this.pendingTicks = new Map();
    this.lastTickStep = -1; this.carryBright = 0; this.tickBudget = 3;
    this.cont = { left: 0, dir: 1, notBefore: 0 };
    this.lastMajorT = -99; this.ascentCount = 0; this.lastAscentT = -99;
    this.markov = null;
    this.loops = [];
    this.ghostIdx = 0; this.nextGhostPhrase = 1;
    this.gens = []; this.bassGen = null;
    this.duck = { amount: 0, end: 0 };
    this.lastFootT = -9; this.lastSplashT = -9;
    this.slideUntil = 0;

    // controls (smoothed)
    this.C = { a: 0.3, e: 0.1, d: 0, s: 0, v: 0, sw: 0, n: 0, w: 0, water: 0, snow: 0, bog: 0, scree: 0, rock: 0, wood: 0, path: 0, glitch: 0, slide: 0, t: 0, leadPan: 0 };
    this.cov = { key: 'moor', pending: 'moor', since: 0, appliedKey: null, lastTexChange: -99 };
    this.heading = 0; this.phase = 'dawn';
    this.prox = {};      // type → closeness 0..1
    this.proxMax = 0;
    this.heardPow = 1e-3; this.heardDb = -30; this.heardFastPow = 1e-3; this.heardFastDb = -30; this.rawPow = 0; this.levelHoldUntil = 0;
    this.lvPow = Math.pow(10, -24 / 10); this.trimDb = 0; this._lvBuf = null; this.gainNow = 1; this.gainNom = 1;
    this.lastNow = null; this.lastCtl = -1; this.lastFxSlow = -99; this.lastReverbT = -99; this.lastReverbSize = 0; this.lastDelayTime = 0;
    this.lastPingPong = null; this.lastScaleKey = ''; this.frozen = false;
    this.fragments = []; this.resonance = []; this.state = null;

    this.budget = BUDGET_MAX; this.budgetT = 0;
    this.stats = { dropped: 0, hits: {}, notes: {}, chords: 0, ticks: 0, leads: 0, ghosts: 0, loops: 0, sections: [], transitions: 0, footsteps: 0, duck: 0 };
    this.timeline = [];
    this.nodeBudget = 0;
  }

  // ------------------------------------------------------------------------------------------------
  // small helpers (also used by artefacts)
  // ------------------------------------------------------------------------------------------------
  get now() { return this.ctx.currentTime; }
  at(t) { return Math.max(t, this.ctx.currentTime + 0.003); }
  log(kind, data) {
    if (this.timeline.length < 6000) this.timeline.push({ t: +this.ctx.currentTime.toFixed(2), kind, ...data });
  }
  count(group, key, n = 1) { const o = this.stats[group]; o[key] = (o[key] || 0) + n; }
  beat() { return this.cond.beatDur; }
  rootNow() { return this.profile.root + this.keyShift; }
  modeNow() { return this.modeOverride || this.modeCur; }
  /** midi of scale degree `deg` of the current mode on root + offset semitones */
  midi(deg, offset = 0) { return degreeToMidi(this.rootNow() + offset, this.modeNow(), deg); }
  motif() { return this._motif; }
  chordPcs() {
    const e = this.entry; if (!e) return [];
    return [...new Set(chordTones(this.rootNow(), this.modeNow(), e).map(pc))];
  }
  isChordTone(midi) { return this.chordPcs().includes(pc(midi)); }
  /** pitch classes of the level's tonic triad in the current key (root, third, fifth) — the anchor of every free-floating line */
  tonicPcs() {
    const m = this.modeNow(), r = this.rootNow();
    const third = m.includes(3) ? 3 : 4, fifth = m.includes(7) ? 7 : m.includes(6) ? 6 : 8;
    return [pc(r), pc(r + third), pc(r + fifth)];
  }
  /** pad-register voicing of an ad-hoc chord (scale degree d, scale-step stack) in the current key/mode */
  chordTonesForPad(d, steps) {
    const tones = chordTones(this.rootNow(), this.modeNow(), { d, steps });
    const center = this.profile.pad.center + this.keyShift;
    return voiceChord(null, tones, center - 9, center + 10);
  }

  /**
   * Kit hit through a node budget (~42 new nodes/s sustained for the bed's percussion): foreground hits (artefacts)
   * and the structural hits (crash, gong, timpani, reverse swell) always sound and draw the budget down; the bed's
   * other hits are dropped when it is spent — percussion thins out instead of piling up.
   */
  hit(name, t, vel, opts, front = false) {
    const now = this.now;
    const cost = HIT_COST[name] || 8;
    this.budget = Math.min(BUDGET_MAX, this.budget + (now - this.budgetT) * BUDGET_RATE); this.budgetT = now;
    if (!front && !STRUCTURAL.has(name) && this.budget < cost) { this.stats.dropped++; return; }
    this.budget -= cost;
    const kit = front ? this.stage.v.aKit : this.stage.v.kit;
    kit.hit(name, this.at(t), vel, opts || {});
    this.count('hits', name);
  }
  note(voice, midi, t, dur, vel) {
    this.stage.v[voice].note(midi, this.at(t), dur, vel);
    this.count('notes', voice);
  }

  /** duck the bed; arbitrates between deep (artefact) and shallow (lead) requests */
  duckBed(amount, attack, hold, release, t = this.now) {
    if (this.duck.amount > amount + 0.01 && this.duck.end > t) return false;
    this.engine.fx.master.duck(amount, attack, hold, release, t);
    this.duck = { amount, end: t + attack + hold };
    this.stats.duck++;
    return true;
  }

  // ------------------------------------------------------------------------------------------------
  // level
  // ------------------------------------------------------------------------------------------------
  setLevel(levelDef) {
    if (!levelDef || levelDef.id === this.levelId) return;
    const prof = getProfile(levelDef.id);
    const t = this.now;
    const first = !this.profile;
    this.levelDef = levelDef; this.levelId = levelDef.id; this.profile = prof;
    this.seed = (levelDef.seed ?? 1) | 0;
    const { patches, base } = applyProfile(this.stage, prof, t);
    this.P = patches; this.base = base;
    this._motif = motifFor(prof);
    this.keyShift = 0; this.modeOverride = null;
    this.modeKind = 'day'; this.pendingModeKind = null;
    this.modeCur = prof.mode;

    // drone: new instance per level (voice count / waveform are fixed at start); crossfade over ~4 s
    if (this.drone) { this.drone.set({ release: 4 }, t); this.drone.stop(t); }
    this.entry = prof.chords[0];
    const dp = { ...patches.drone };
    if (!first) dp.fadeIn = 4;
    this.drone = new Drone(this.engine, this.stage.ch.drone, dp);
    this.drone.setChord(droneNotes(this.rootNow(), this.modeNow(), this.entry, prof.drone.low), t, 0.1);
    this.drone.start(t + 0.05);

    // texture
    const tex = this.stage.v.texture;
    const tx = textureFor(prof, 'moor');
    if (!this.texStarted) { tex.set({ kind: tx.kind, level: tx.level, tone: tx.tone }); tex.start(t + 0.05); this.texStarted = true; }
    else tex.set({ kind: tx.kind, level: tx.level, tone: tx.tone, motion: patches.texture.motion, fade: patches.texture.fade }, t);
    this.cov = { key: 'moor', pending: 'moor', since: t, appliedKey: 'moor', lastTexChange: t };

    // conductor + generators
    this.cond.snapTempo(prof.bpm, prof.swing, prof.phraseBars);
    this.cond.reset();
    this.gens = kitGens(prof).map((spec) => new PatternGen(spec, this.rng));
    this.bassGen = new PatternGen({ h: 'bass', flow: { p: 0.5, k: [2, 3], rot: [0, 3, 6] }, swell: { p: 0.9, k: [5, 6, 7], rot: [0, 2] } }, this.rng);
    this.terraced = !!prof.terraced;
    this.markov = new MelodyMarkov(this.rng, { center: Math.floor(prof.lead.span / 2), span: prof.lead.span });
    const dens = prof.ticks.density;
    this.loops = [
      { voice: 'bell', period: 11.7 / (0.6 + 0.8 * dens), next: t + 3 + this.rng.float() * 3, reg: 12 },
      { voice: 'pad', period: 19.3 / (0.7 + 0.6 * dens), next: t + 9 + this.rng.float() * 5, reg: 0 },
      { voice: 'pluck', period: 15.1 / (0.6 + 0.8 * dens), next: t + 6 + this.rng.float() * 4, reg: -12 },
    ];
    this.pendingTicks.clear(); this.gridPending = null;
    this.padPrev = null; this.lastPadBar = -99; this.altOct = 0;
    this.ghostIdx = 0; this.nextGhostPhrase = 2;
    this.lastLeadT = -99;
    this.lvPow = Math.pow(10, -24 / 10);
    this.initChord = true;
    this.lastScaleKey = '';
    this.art.reset();
    this.log('level', { id: prof.id, root: prof.root, bpm: prof.bpm });
    this.levelStartT = t;
    this._queueWarm(prof);
  }

  /**
   * Pre-warming: everything that is expensive to make on the main thread (noise buffers, Karplus-Strong pluck buffers) is made
   * ahead of need, one slice every 0.05–0.1 s after a level starts, so no update has to synthesise a buffer at trigger time.
   */
  _queueWarm(prof) {
    const eng = this.engine, q = [];
    for (const [k, s] of TEXTURE_NOISE) q.push(() => eng.noiseWarm(k, s));
    const tex = this.stage.v.texture;
    q.push(() => tex.warmCrackle(0), () => tex.warmCrackle(1));      // an item returning false is run again on the next tick (incremental work)
    const pl = this.stage.v.pluck;
    const modes = [prof.mode, prof.dawn, prof.night].filter(Boolean);
    const seen = new Set();
    for (let m = prof.lead.base - 14; m <= prof.lead.base + 26; m++) {
      const rel = (((m - prof.root) % 12) + 12) % 12;
      if (!modes.some((md) => md.includes(rel)) || seen.has(m)) continue;
      seen.add(m);
      q.push(() => pl.warm(m));
    }
    this.warmQ = q; this.lastWarm = this.now;
  }
  _warm(now) {
    if (!this.warmQ || !this.warmQ.length || now - this.lastWarm < (this.warmBusy ? 0.05 : 0.1)) return;
    this.lastWarm = now;
    try {
      const done = this.warmQ[0]() !== false;          // an item returning false is incremental work: run again at the next tick
      if (done) this.warmQ.shift();
      this.warmBusy = !done;
    } catch (e) { this.warmQ.length = 0; }
  }

  // ------------------------------------------------------------------------------------------------
  // update
  // ------------------------------------------------------------------------------------------------
  update(state) {
    if (!state || !state.player) return;
    if (state.level && state.level.id !== this.levelId) this.setLevel(state.level);
    if (!this.profile) return;
    const now = this.now;
    const dt = this.lastNow === null ? 0.05 : clamp(now - this.lastNow, 0, 1);
    this.lastNow = now;
    this.state = state;
    this._read(state, dt, now);
    this.cond.setEnergy(this._energyTarget(), 7 - 4.5 * this.C.d);
    this.cond.setTempo(this.profile.bpm * this._tempoMul(), this.profile.swing);
    if (!this.cond.started) this.cond.update(now);       // establish the grid before quantising events
    if (this.initChord) { this.initChord = false; this._applyChord(this.profile.chords[0], now + 0.12, { reason: 'init' }); }
    this._events(state.events || [], now, state);
    this.cond.update(now);
    this.art.update(now, state, dt);
    this._warm(now);
    if (now - this.lastCtl >= 0.1) {
      const cdt = this.lastCtl < 0 ? 0.1 : clamp(now - this.lastCtl, 0.1, 1);        // time since the previous control tick (the smoothers inside are per tick, not per update)
      this.lastCtl = now; this._control(now, cdt);
    }
  }

  _read(state, dt, now) {
    const p = state.player, w = state.world, C = this.C;
    const span = Math.max(1, (w && w.maxH - w.minH) || 1);
    const altRaw = clamp(((p.elevation ?? 0) - ((w && w.minH) || 0)) / span, 0, 1);
    C.a = smooth(C.a, altRaw, dt, 3);
    C.s = smooth(C.s, clamp((p.slope || 0) / 0.6, 0, 1), dt, 0.8, 1.6);
    C.v = smooth(C.v, clamp((p.speed || 0) / 8.5, 0, 1), dt, 0.4, 1.2);
    const driftRaw = clamp(((p.still || 0) - 4) / 3, 0, 1) * (this.art.activeCount ? 0.35 : 1);   // an artefact sounding holds the pulse
    C.d = smooth(C.d, smoothstep(driftRaw), dt, 2.5, 0.6);
    this.heading = p.heading ?? 0;
    this.phase = state.phase || 'day';
    const night = this.phase === 'night' ? 1 : this.phase === 'dusk' ? 0.45 : 0;
    const dawn = this.phase === 'dawn' ? 1 : 0;
    C.n = smooth(C.n, night, dt, 12); C.w = smooth(C.w, dawn, dt, 12);
    C.t = now;
    C.sw = smoothstep((this.cond.energy - 0.45) / 0.4);
    C.e = this.cond.energy;
    const sliding = p.sliding ? 1 : (now < this.slideUntil ? 1 : 0);
    C.slide = smooth(C.slide, sliding, dt, 0.3, 1.5);
    C.glitch = smooth(C.glitch, this.profile.glitch + 0.5 * C.slide, dt, 0.5, 2) ;
    // cover
    const key = COVER_KEYS[p.cover] || 'moor';
    if (key !== this.cov.pending) { this.cov.pending = key; this.cov.since = now; }
    if (now - this.cov.since > 1.1 && this.cov.key !== key) this.cov.key = key;
    const ck = this.cov.key;
    const tgt = (k) => (ck === k ? 1 : 0);
    C.water = smooth(C.water, (tgt('shallow') || tgt('deep')) ? 1 : 0, dt, 1.2);
    C.snow = smooth(C.snow, tgt('snow'), dt, 1.5); C.bog = smooth(C.bog, tgt('bog'), dt, 1.5);
    C.scree = smooth(C.scree, tgt('scree'), dt, 0.8); C.rock = smooth(C.rock, tgt('rock'), dt, 1.2);
    C.wood = smooth(C.wood, tgt('wood'), dt, 1.5); C.path = smooth(C.path, tgt('path'), dt, 1.5);
    C.leadPan = Math.cos(this.heading) * this.profile.lead.pan;   // east right, west left
    // proximity → closeness per artefact type
    const prox = {}; let mx = 0;
    for (const pr of state.proximity || []) {
      const c = clamp(1 - pr.dist / 25, 0, 1);
      if (c <= 0) continue;
      const k = Math.pow(c, 1.3);
      const type = pr.poi.type;
      if (!(prox[type] > k)) prox[type] = k;
      mx = Math.max(mx, k);
    }
    this.prox = prox; this.proxMax = mx;
    this.fragments = state.fragments || [];
    this.resonance = state.resonance || [];
    // altitude register (hysteresis): high ground lifts pad / lead an octave
    if (C.a > 0.78) this.altOct = 1; else if (C.a < 0.5) this.altOct = 0;
    // time-of-day mode variant is applied at the next phrase start
    const kind = this.phase === 'dawn' ? 'dawn' : this.phase === 'night' ? 'night' : 'day';
    if (kind !== this.modeKind && kind !== this.pendingModeKind) this.pendingModeKind = kind;
  }

  _energyTarget() {
    const C = this.C, st = this.state, p = st.player;
    let e = 0.06 + 0.30 * C.v + 0.35 * C.s * Math.min(1, C.v * 1.5) + 0.12 * C.slide + 0.22 * this.proxMax;
    e *= 1 - 0.95 * C.d;
    const A = this.art.cached;
    if (A && A.energy !== undefined) e = Math.max(e, A.energy);
    else if (this.art.activeCount) e = Math.max(e, 0.62);
    if (A && A.energyFloor !== undefined) e = Math.max(e, A.energyFloor);
    if (A && A.energyMax !== undefined) e = Math.min(e, A.energyMax);
    return clamp(e, 0, 1);
  }

  _tempoMul() {
    const C = this.C, pr = this.profile;
    let m = 1 - (1 - pr.nightTempo) * C.n + 0.02 * C.w;
    const A = this.art.cached;
    if (A && A.tempoMul) m *= A.tempoMul;
    return m;
  }

  // ------------------------------------------------------------------------------------------------
  // events
  // ------------------------------------------------------------------------------------------------
  _events(events, now, state) {
    let gridEv = null;
    const gateNow = events.some((e) => e.type === 'gate-open');
    const fullNow = events.some((e) => e.type === 'poi' && e.full);
    for (const ev of events) {
      switch (ev.type) {
        case 'contour': this._contour(ev, now); break;
        case 'grid': gridEv = ev; if (ev.major) this._majorGrid(now); break;
        case 'step': this._footstep(ev, now); break;
        case 'splash': this._splash(now); break;
        case 'slide-start': this._slide(true, now); break;
        case 'slide-end': this._slide(false, now); break;
        case 'poi':
          if (ev.full) { const P = this.art.play(ev.poi.type, { t: now, quality: ev.quality, poi: ev.poi, gate: gateNow }); if (P) { this.levelHoldUntil = now + 9; this.log('boost', { type: ev.poi.type, boost: +(P.boostDb + P.servoDb).toFixed(1), target: +P.targetDb.toFixed(1), heard: +this.heardDb.toFixed(1) }); } }
          else this.art.playPartial(ev.poi.type, { t: now, quality: ev.quality, missing: ev.missing, poi: ev.poi });
          this.log('poi', { type: ev.poi.type, full: ev.full });
          break;
        case 'resonance-end': this.art.endResonance(ev.poiId); break;
        case 'chain': this.art.concord(ev.types, now); break;
        case 'gate-open': if (!fullNow) this.art.cadence(now); this.log('gate-open', {}); break;
        case 'level-complete': this.art.finale(now); this.log('level-complete', {}); break;
        default: break;
      }
    }
    if (gridEv) this.gridPending = { gx: gridEv.gx, gy: gridEv.gy, major: gridEv.major };
    if (this.gridPending) this._resolveGrid(now);
  }

  _contour(ev, now) {
    this.art.onContour(ev, now);
    if (ev.dir > 0) { this.lastAscentT = now; }
    if (ev.major) { if (this.art.activeCount) this._queueTick(ev, now); else this._leadFromContour(ev, now); }
    else this._queueTick(ev, now);
  }

  // -------- ticks
  _queueTick(ev, now) {
    const q = this.cond.quantise(now + 0.02);
    const sec = this.cond.section;
    // rate-limit by section and a leaky bucket so a steep descent doesn't machine-gun
    this.tickBudget = Math.min(3, this.tickBudget + (now - (this._lastTickBudgetT ?? now)) * (sec === 'ebb' ? 0.35 : sec === 'flow' ? 0.8 : 2.0));
    this._lastTickBudgetT = now;
    const dens = this.profile.ticks.density;
    const slot = this.pendingTicks.get(q.step);
    if (slot) { slot.bright = Math.min(1, slot.bright + 0.3); return; }
    if (q.step === this.lastTickStep) { this.carryBright = Math.min(1, this.carryBright + 0.25); return; }
    if (this.tickBudget < 1 || this.rng.float() > (0.2 + 0.5 * dens) * (this.C.d > 0.5 ? 0.25 : 1) * (this.art.activeCount ? 0.3 : 1)) { this.carryBright = Math.min(1, this.carryBright + 0.1); return; }
    this.tickBudget -= 1;
    const item = { idx: ev.index, speed: ev.speed, bright: this.carryBright, t: q.t };
    this.carryBright = 0;
    if (q.step >= this.cond.step) this.pendingTicks.set(q.step, item);
    else { this.lastTickStep = q.step; this._playTick(item, q.t); }
  }

  _playTick(item, t) {
    if (this.budget < 12) { this.stats.dropped++; return; }                 // the bed's note ticks share the node budget with its percussion
    this.budget -= 12;
    const prof = this.profile, C = this.C, mode = this.modeNow();
    const n = mode.length;
    const deg = ((item.idx % n) + n) % n;
    // voice choice: profile bias nudged by cover
    let pb = prof.ticks.bell, pp = prof.ticks.pluck;
    pb *= 1 + 1.4 * C.snow + 0.8 * C.water; pp *= 1 + 1.6 * C.wood + 0.6 * C.scree + 0.5 * C.rock;
    const bell = this.rng.float() * (pb + pp) < pb;
    const base = prof.lead.base + (bell ? 12 : 0);
    let midi = degreeToMidi(this.rootNow() + (base - prof.root), mode, deg);
    const r = this.rng.float();
    if (r < 0.3) midi = nearestTone(midi, this.chordPcs());
    else if (r < 0.58) midi = nearestTone(midi, this.tonicPcs());            // the key stays audible whatever the chord
    const vel = clamp(0.22 + 0.25 * (item.speed / 8) + 0.22 * item.bright + 0.1 * this.rng.float(), 0.15, 0.7);
    const V = this.stage.v;
    if (bell) {
      V.bell.p.brightness = this.P.bell.brightness * (1 + 0.7 * item.bright) * (1 + 0.3 * C.snow);
      V.bell.note(midi + (C.snow > 0.5 ? 12 : 0), this.at(t), 1.4, vel);
      this.count('notes', 'bell');
    } else {
      V.pluck.p.cutoff = this.P.pluck.cutoff * (0.7 + 0.9 * item.bright);
      V.pluck.note(midi, this.at(t), 1.0, vel);
      this.count('notes', 'pluck');
    }
    this.stats.ticks++;
  }

  // -------- lead
  _leadMidi(deg, dir = 1) {
    const L = this.profile.lead;
    const oct = (this.C.a > 0.62 && L.octaves >= 1 ? 1 : 0) + (this.C.a > 0.9 && L.octaves >= 2 ? 1 : 0);
    return degreeToMidi(this.rootNow() + (L.base - this.profile.root), this.modeNow(), deg) + 12 * oct;
  }

  _leadFromContour(ev, now) {
    const L = this.profile.lead, C = this.C;
    // leave air: one bed-lead phrase per ~1.5 bars at most; crossings in between become quiet bell ticks
    if (now - this.lastLeadT < this.cond.barDur * 1.5) { this._queueTick(ev, now); return; }
    const h = Math.round(ev.index / 5);
    const span = L.span;
    const deg = ((h % span) + span) % span;
    const vel = clamp(0.3 + 0.4 * clamp(ev.speed / 8, 0, 1), 0.25, 0.8);     // the bed's lead sits above the pad, below an artefact solo
    const q = this.cond.quantise(now + 0.01);
    const t = (q.t - now) < 0.1 ? q.t : now + 0.02;
    const b = this.beat();
    const dur = L.hold * b * (0.8 + 0.5 * this.rng.float());
    const midi = this._leadMidi(deg);
    this.stage.v.lead.note(midi, this.at(t), dur, vel);
    this.stage.v.bell.note(midi + 12, this.at(t + 0.015), 2.2, vel * 0.55);
    this.count('notes', 'lead'); this.count('notes', 'bell');
    this.stats.leads++;
    this.markov.reset(deg);
    // shallow duck so the solo reads
    if (vel > 0.5) this.duckBed(0.14, 0.04, dur * 0.5, 0.7, t);
    this.lastLeadT = now;
    // ascent bookkeeping: arm the Markov continuation
    this.ascentCount = (now - this.lastMajorT < 10 ? this.ascentCount : 0) + 1;
    this.lastMajorT = now;
    this.cont = { left: ev.dir > 0 ? 2 : 1, dir: ev.dir, notBefore: t + b * 3 };
  }

  // -------- grid → chord
  _majorGrid(now) {
    const q = this.cond.quantise(now + 0.02);
    const t = q.t;
    this.hit('crash', t, 0.55 + 0.2 * this.rng.float(), { tone: 0.6 });
    this.hit('breath', t, 0.35, { length: this.beat() * 3, tone: 0.5 });
    this.stage.v.bell.note(this.midi(0, 36), this.at(t + 0.02), 4, 0.5);
    this.count('notes', 'bell');
    this.engine.fx.granular.set({ density: 50, mix: 1.0 }, now, 0.1);
    this.log('major-grid', {});
  }

  _resolveGrid(now) {
    const g = this.gridPending;
    if (!g) return;
    // chord changes land on a beat, at least 2 beats apart
    const q = this.cond.quantise(now + 0.03);
    const toBeat = (4 - (((q.step % 4) + 4) % 4)) % 4;
    const t = this.cond.timeOfStep(q.step + toBeat);
    // harmony breathes: chords change at most every ~1.6 bars (the latest square wins), sooner only on a major line
    const gap = g.major ? this.beat() * 1.9 : this.cond.barDur * 1.6;
    if (t - (this.lastChordT ?? -99) < gap) return;                            // keep pending until allowed
    this.gridPending = null;
    const idx = pickChordIndex(this.profile.chords, g.gx, g.gy, this.seed);
    this._applyChord(this.profile.chords[idx], t, { gx: g.gx, gy: g.gy, major: g.major, reason: 'grid' });
  }

  _invFromHeading() {
    const sy = Math.sin(this.heading);        // +south
    return sy < -0.5 ? 1 : sy > 0.5 ? -1 : 0;
  }

  _bassMidi(entry) {
    let m = chordRoot(this.rootNow() + (this.profile.bass.octave), this.modeNow(), entry);
    while (m < 26) m += 12;
    while (m > 45) m -= 12;
    return m;
  }

  _applyChord(entry, t, info = {}) {
    const prof = this.profile, C = this.C, V = this.stage.v;
    t = this.at(t);
    this.entry = entry; this.lastChordT = t;
    const root = this.rootNow(), mode = this.modeNow();
    const tones = chordTones(root, mode, entry);
    const center = prof.pad.center + this.keyShift + 12 * this.altOct;
    const voicing = voiceChord(this.padPrev, tones, center - 9, center + 10, { inversion: this._invFromHeading() });
    this.padPrev = voicing;
    const vel = clamp(0.5 + 0.35 * C.e - 0.1 * C.d, 0.35, 0.95);
    const dur = Math.max(4, this.cond.barDur * prof.phraseBars * 0.9);
    // bog: longer attacks, darker
    V.pad.p.attack = this.P.pad.attack * (1 + 0.9 * C.bog);
    V.pad.p.cutoff = lerp(prof.pad.cut[0], prof.pad.cut[1], C.a) * (1 - 0.35 * C.bog) * (1 + 0.2 * C.w - 0.2 * C.n);
    V.pad.chord(voicing, t, dur, vel);
    this.count('notes', 'pad');
    this.lastPadBar = this.cond.bar;
    // drone follows (tonic stays)
    const glide = 3 + 3 * C.d;
    if (this.drone) this.drone.setChord(droneNotes(root, mode, entry, prof.drone.low + (C.a > 0.85 ? 12 : 0)), t, glide);
    // bass
    if (this.cond.section !== 'ebb' && C.d < 0.5) {
      const b = V.bass;
      b.note(this._bassMidi(entry), t, Math.min(this.cond.barDur * 1.6, 6), 0.55 + 0.3 * C.e);
      this.count('notes', 'bass');
    }
    this.stats.chords++;
    this.log('chord', { name: entry.name, gx: info.gx, gy: info.gy, reason: info.reason });
    if (info.major) { /* crash swell handled by _majorGrid */ }
  }

  _setKeyShift(semi, t) {
    if (semi === this.keyShift) return;
    this.keyShift = semi;
    this._refreshHarmony(t ?? this.now, 2.5);
  }
  setKeyShift(semi, t) { this._setKeyShift(semi, t); }
  setModeOverride(mode, t) { this.modeOverride = mode; this._refreshHarmony(t ?? this.now, 2.5); }

  /** re-voice drone + pad + granular scale for a changed key/mode */
  _refreshHarmony(t, glide = 3) {
    if (!this.entry) return;
    const root = this.rootNow(), mode = this.modeNow(), prof = this.profile;
    if (this.drone) this.drone.setChord(droneNotes(root, mode, this.entry, prof.drone.low), t, glide);
    this._applyScale();
    this._applyChord(this.entry, t + 0.05, { reason: 'refresh' });
  }

  _applyScale() {
    const mode = this.modeNow();
    // grain pitch shifts are intervals from the (in-key) input, so the scale is the mode itself, relative to the tonic
    const key = mode.join(',');
    if (key === this.lastScaleKey) return;
    this.lastScaleKey = key;
    this.engine.fx.granular.setScale(mode.slice());
  }

  // -------- ground sounds
  _footstep(ev, now) {
    if (this.C.d > 0.3 || this.cond.section === 'ebb') return;
    if (now - this.lastFootT < 0.2) return;
    this._stepN = (this._stepN || 0) + 1;
    if (this._stepN % 3 !== 0) return;                                  // every third step: a trace of ground, not a metronome
    this.lastFootT = now;
    const ck = this.cov.key;
    const run = this.C.v > 0.6;
    if (ev.foot === 1 && (run || this.rng.chance(0.5))) return;      // thin the steps: mostly the left foot
    const q = this.cond.quantise(now + 0.01);
    const t = (q.t - now) < 0.04 ? q.t : now + 0.01;
    const vel = 0.06 + 0.06 * this.C.v + 0.03 * this.rng.float();
    if (ck === 'scree' || ck === 'snow') {
      this.hit('snap', t, vel * 1.4, { tone: ck === 'snow' ? 0.8 : 0.35, decay: 0.01 + 0.008 * this.rng.float(), pitch: ck === 'snow' ? 1.3 : 0.9 });
    } else if (ck === 'shallow' || ck === 'deep') {
      this.hit('shaker', t, vel * 1.5, { tone: 0.8, decay: 0.05 + 0.04 * this.rng.float(), pan: ev.foot ? 0.3 : -0.3 });
    } else {
      const tone = ck === 'path' ? 0.6 : ck === 'wood' ? 0.45 : ck === 'bog' ? 0.08 : 0.22;
      this.hit('click', t, vel, { tone: tone + 0.1 * this.rng.float(), pan: ev.foot ? 0.2 : -0.2 });
    }
    this.stats.footsteps++;
  }

  _splash(now) {
    if (now - this.lastSplashT < 0.7) return;
    this.lastSplashT = now;
    this.hit('shaker', now + 0.01, 0.3 + 0.1 * this.rng.float(), { decay: 0.12 + 0.1 * this.rng.float(), tone: 0.75 + 0.2 * this.rng.float(), pan: this.rng.float() - 0.5 });
    if (this.rng.chance(0.2)) this.hit('grainBurst', now + 0.03, 0.3, { length: 0.16 + 0.1 * this.rng.float(), tone: 0.8 });
  }

  _slide(on, now) {
    if (on) {
      this.slideUntil = now + 1.5;
      this.hit('breath', now + 0.02, 0.3, { length: 1.4, tone: 0.8, pitch: 1.25 });
      this.hit('grainBurst', now + 0.05, 0.35, { length: 0.5, tone: 0.3 });
    } else this.slideUntil = now + 0.4;
  }

  // ------------------------------------------------------------------------------------------------
  // conductor hooks
  // ------------------------------------------------------------------------------------------------
  _onMutate({ bar }) {
    const steady = this.C.path > 0.5 ? 0.35 : 1;          // path: steadier, cleaner pulse
    if (this.rng.float() < steady) for (const g of this.gens) g.mutate(0.8 * steady);
    if (this.bassGen && this.rng.float() < steady) this.bassGen.mutate(1);
  }

  _onTransition({ from, to, t, tApply, lenSec }) {
    this.stats.transitions++;
    const sd = this.cond.stepDur, len = clamp(lenSec, 0.6, 7), favour = this.profile.kit;
    const C = this.C;
    if (to === 'swell') {
      this.hit('reverseSwell', t, 0.55 + 0.15 * C.e, { length: len, tone: 0.6 });
      const fill = favour.crash.swellFill;
      const n = fill === 2 ? 8 : 4, step = (fill === 2 ? sd * 0.5 : sd);
      const names = ['tomH', 'tomM', 'tomL', 'tomL'];
      for (let i = 0; i < n; i++) {
        const tt = tApply - (n - i) * step;
        if (tt < t) continue;
        const nm = fill === 2 ? names[Math.floor(i / 2) % 4] : names[i % 4];
        this.hit(nm, tt, 0.3 + 0.5 * (i / n), { midi: this._tomMidi(nm), pan: (i % 2 ? 0.25 : -0.25) });
      }
    } else if (from === 'ebb' && to === 'flow') {
      this.hit('breath', t, 0.35, { length: len, tone: 0.45 });
      this.hit('shaker', tApply - sd, 0.2, { tone: 0.6, pan: 0.2 });
    } else if (to === 'flow') {
      this.hit('ride', tApply, 0.28, { tone: 0.4 });
      for (let i = 0; i < 3; i++) this.hit('rim', tApply - (3 - i) * sd, 0.18 + 0.05 * i, { pan: i % 2 ? 0.3 : -0.3, pitch: 1 - 0.08 * i });
    } else if (to === 'ebb') {
      this.hit('breath', t, 0.3, { length: len, tone: 0.25 });
      if (this.rng.chance(0.6)) this.hit('gong', tApply, 0.28, { midi: this.rootNow() - 12, decay: 8 + 3 * this.rng.float(), tone: 0.4 });
    }
    this.log('transition', { from, to });
  }

  _tomMidi(nm) {
    const r = this.rootNow();
    return nm === 'tomL' ? r - 12 : nm === 'tomM' ? r - 5 : r;
  }

  _onSection({ from, to, t }) {
    const cr = this.profile.kit.crash;
    this.stats.sections.push(to);
    this.log('section', { from, to });
    if (to === 'swell') {
      this.hit('crash', t, 0.7 + 0.15 * this.rng.float(), { tone: 0.6 });
      if (this.rng.chance(cr.timp)) this.hit('timp', t, 0.7, { midi: this.rootNow() - 12 });
    } else if (to === 'flow' && from === 'ebb') {
      this.hit('crash', t, 0.22, { tone: 0.4, decay: 3 });
    } else if (to === 'flow') {
      this.hit('crash', t, 0.3, { tone: 0.5 });
    }
  }

  // ------------------------------------------------------------------------------------------------
  // per-16th scheduling
  // ------------------------------------------------------------------------------------------------
  _onStep(s) {
    const C = this.C, prof = this.profile, rng = this.rng, sec = s.section;
    const sd = s.sd;
    // time-of-day mode variant, at phrase starts
    if (s.isPhraseStart && this.pendingModeKind) {
      this.modeKind = this.pendingModeKind; this.pendingModeKind = null;
      this.modeCur = this.modeKind === 'dawn' ? prof.dawn : this.modeKind === 'night' ? prof.night : prof.mode;
      this._refreshHarmony(s.t, 4);
      this.log('mode', { variant: this.modeKind });
    }
    if (!this.lastScaleKey) this._applyScale();

    // ticks queued for this step
    const tk = this.pendingTicks.get(s.step);
    if (tk) { this.pendingTicks.delete(s.step); this.lastTickStep = s.step; this._playTick(tk, s.t); }
    if (this.pendingTicks.size > 8) for (const k of this.pendingTicks.keys()) if (k < s.step) this.pendingTicks.delete(k);

    const A = this.art.cached;
    const pulse = clamp(1 - C.d, 0, 1) * (this.art.pulseHold ? 0 : 1);

    // ---- percussion
    if (pulse > 0.06) this._kitStep(s, pulse);

    // ---- bass
    if (sec !== 'ebb' && pulse > 0.3) this._bassStep(s);

    // ---- pad breathing: re-articulate the chord each phrase so the harmony never goes silent
    const sparse = sec === 'ebb' || C.d > 0.3;                      // ebb / drift: the pad swells and ebbs away instead of holding
    if (s.isPhraseStart && s.bar - this.lastPadBar >= prof.phraseBars && this.entry && !(sparse && C.d > 0.3 && rng.chance(0.4))) {
      this.padVariant = (this.padVariant + 1) % 3;
      const tones = chordTones(this.rootNow(), this.modeNow(), this.entry);
      const center = prof.pad.center + this.keyShift + 12 * this.altOct;
      const inv = this._invFromHeading() || [0, 1, -1][this.padVariant];      // heading sets the inversion; otherwise the voicing cycles
      const voicing = voiceChord(this.padPrev, tones, center - 9, center + 10, { inversion: inv });
      this.padPrev = voicing;
      this.stage.v.pad.p.attack = this.P.pad.attack * (1 + 0.9 * C.bog);
      this.stage.v.pad.chord(voicing, s.t, this.cond.barDur * prof.phraseBars * (sparse ? 0.45 : 0.95), clamp(0.42 + 0.3 * C.e + 0.15 * C.d, 0.3, 0.9));
      this.count('notes', 'pad');
      this.lastPadBar = s.bar;
    }

    // ---- crashes / gong / timpani on phrase boundaries
    if (s.isPhraseStart) this._phraseAccents(s, pulse);

    // ---- Eno tape loops (sparse chance bells / pad swells / low plucks)
    this._loops(s)

    // ---- melodic continuation while ascending/descending
    if (this.cont.left > 0 && s.t >= this.cont.notBefore && (s.i16 & 1) === 0 && C.d < 0.5 && !this.art.activeCount) {
      if (rng.chance(0.4)) {
        const deg = this.markov.next({ dir: this.cont.dir * 0.8, isChord: (d) => this.isChordTone(this._leadMidi(d)) });
        const midi = this._leadMidi(deg);
        const b = this.beat();
        this.stage.v.lead.note(midi, this.at(humanise(s.t, sd, rng, 0.05, this.now)), b * (0.7 + 0.6 * rng.float()), 0.42 + 0.15 * rng.float());
        this.count('notes', 'lead');
        this.cont.left--;
        this.cont.notBefore = s.t + b * (2 + 2 * rng.float());
      }
    }

    // ---- ghost fragments
    if (s.i16 === 0 && s.barInPhrase === 2 && s.phrase >= this.nextGhostPhrase && this.fragments.length) this._ghost(s);

    // ---- artefact pre-echo layers and resonance
    this.art.onStep(s, this.prox);

    // ---- autonomous motif quote at long phrase boundaries (the album's binding thread)
    if (s.isPhraseStart && s.phrase % 4 === 3 && sec !== 'swell' && rng.chance(0.25 + 0.4 * C.d)) this._quoteMotif(s);
  }

  _kitStep(s, pulse) {
    const C = this.C, rng = this.rng, sec = s.section, sd = s.sd;
    const eN = this.terraced ? (C.e < 0.33 ? 0.2 : C.e < 0.66 ? 0.5 : 0.85) : C.e;
    const dens = 0.45 + 0.9 * eN;
    const running = C.v > 0.62;
    for (const g of this.gens) {
      const cfg = g.cfg(sec);
      const spec = g.spec;
      if (!cfg) continue;
      const gate = g.gate(sec, s.step);
      let p;
      if (!gate) {
        // ghost notes: faint extra snare / rim / hat
        if ((spec.h === 'snare' || spec.h === 'rim' || spec.h === 'hatC') && sec !== 'ebb' && rng.float() < 0.04 * eN * spec.favour) {
          this._playHit(spec, s, 0.35, true);
        }
        continue;
      }
      if (spec.hats && !running && (s.i16 & 1)) continue;                     // running doubles the hat grid
      p = cfg.p * spec.favour * dens * (sec === 'swell' ? 1 : sec === 'flow' ? 0.5 : 0.45);
      if (spec.slope) p *= 1 + spec.slope * (C.s * 1.6 - 0.3);
      if (spec.speed) p *= 1 + spec.speed * (C.v - 0.4);
      if (spec.scree) p *= 1 + spec.scree * C.scree * 1.5 * (1 + C.slide);
      if (spec.rock) p *= 1 + spec.rock * C.rock * 1.5;
      if (spec.snow) p *= 1 + spec.snow * C.snow;
      if (spec.wood) p *= 1 + spec.wood * C.wood;
      if (spec.water) p *= 1 + spec.water * C.water * 1.5;
      p *= pulse;
      if (rng.float() < p) this._playHit(spec, s, eN, false);
    }
  }

  _playHit(spec, s, eN, ghost) {
    const rng = this.rng, h = spec.h, sd = s.sd;
    const [lo, hi] = spec.vel;
    let vel = lerp(lo, hi, clamp(rng.float() * 0.55 + eN * 0.45, 0, 1));
    if (ghost) vel *= 0.45;
    if (s.i16 === 0 && h === 'kick') vel = Math.min(1, vel * 1.15);
    const loud = h === 'kick' || h === 'tomL' || h === 'tomM' || h === 'tomH';
    const t = this.at(humanise(s.t, sd, rng, loud ? 0.012 : 0.04, this.now));
    const o = {};
    if (spec.tone === 'rand') o.tone = rng.float(); else if (typeof spec.tone === 'number') o.tone = clamp(spec.tone + 0.2 * (rng.float() - 0.5), 0, 1);
    if (h === 'hatC' || h === 'hatO' || h === 'shaker' || h === 'click' || h === 'rim') o.pan = (rng.float() * 2 - 1) * 0.5;
    if (h === 'hatC') o.decay = this.P.kit.hatDecay * (0.7 + 0.8 * rng.float());
    if (h === 'hatO') o.decay = this.P.kit.hatOpenDecay * (0.8 + 0.5 * rng.float());
    if (h === 'shaker') o.decay = 0.045 + 0.06 * rng.float();
    if (h === 'tomL' || h === 'tomM' || h === 'tomH') { o.midi = this._tomMidi(h) + (rng.chance(0.2) ? 7 : 0); o.pan = (rng.float() * 2 - 1) * 0.35; }
    if (h === 'kick') o.decay = this.P.kit.kickDecay * (0.8 + 0.4 * rng.float());
    if (h === 'ride') o.tone = 0.3 + 0.5 * eN;
    if (h === 'metal') { o.midi = this.midi(rng.int(0, 4), 12 + (this.C.rock > 0.3 ? 12 : 0)); o.decay = 0.3 + 0.7 * rng.float(); }
    if (h === 'snap') o.pitch = 0.8 + 0.6 * rng.float();
    if (h === 'grainBurst') o.length = 0.18 + 0.4 * rng.float() * (1 + this.C.scree);
    if (h === 'breath') { o.length = this.P.kit.breathLength * (0.8 + 0.6 * rng.float()); o.pitch = 0.9 + 0.3 * rng.float(); }
    this.hit(h, t, vel, o);
  }

  _phraseAccents(s, pulse) {
    const cr = this.profile.kit.crash, rng = this.rng, sec = s.section;
    const t = s.t;
    if (sec === 'swell' && pulse > 0.3) {
      if (rng.chance(cr.phrase)) this.hit('crash', t, 0.5 + 0.25 * rng.float(), { tone: 0.55, decay: this.P.kit.crashDecay * (0.8 + 0.4 * rng.float()) });
      if (rng.chance(cr.gong * 0.5)) this.hit('gong', t, 0.4, { midi: this.rootNow() - 12 + (rng.chance(0.3) ? 7 : 0), decay: 9 + 4 * rng.float() });
      if (rng.chance(cr.timp * 0.5)) this.hit('timp', t, 0.6, { midi: this.rootNow() - 12 });
    } else if (sec === 'flow' && pulse > 0.3 && rng.chance(cr.phrase * 0.18)) {
      this.hit('crash', t, 0.26, { tone: 0.4, decay: this.P.kit.crashDecay * 0.7 });
    }
  }

  _bassStep(s) {
    const prof = this.profile, rng = this.rng, sec = s.section, C = this.C, V = this.stage.v;
    const style = prof.bass.style;
    const m = this._bassMidi(this.entry);
    const bd = this.cond.barDur;
    const vel = 0.5 + 0.3 * C.e;
    if (style === 'long') {
      if (s.i16 === 0 && s.barInPhrase % 2 === 0) { V.bass.note(m, s.t, bd * 1.9, vel * 0.9); this.count('notes', 'bass'); }
    } else if (style === 'terrace') {
      if (s.i16 % 8 === 0) {
        const k = (s.bar * 2 + s.i16 / 8) % 4;
        const mm = k === 2 ? m + 7 : k === 3 ? m + 12 : m;
        V.bass.note(mm, s.t, bd * 0.48, vel); this.count('notes', 'bass');
        if (k === 1 && sec === 'swell') V.bass.glideTo(m + 5, s.t + bd * 0.3);
      }
    } else {
      if (this.bassGen.gate(sec, s.step) && rng.float() < (sec === 'swell' ? 0.9 : 0.7)) {
        const oct = rng.chance(0.18) ? 12 : 0;
        const mm = m + oct + (rng.chance(0.12) ? 7 : 0);
        V.bass.note(mm, this.at(humanise(s.t, s.sd, rng, 0.015, this.now)), s.sd * (1.5 + 3 * rng.float()), vel);
        this.count('notes', 'bass');
        if (s.i16 === 8 && rng.chance(0.25)) V.bass.glideTo(m + 7, s.t + s.sd * 3);
      } else if (s.i16 === 0 && s.barInPhrase === 0) { V.bass.note(m, s.t, bd * 0.9, vel); this.count('notes', 'bass'); }
    }
  }

  _loops(s) {
    const prof = this.profile, rng = this.rng, C = this.C, sec = s.section, V = this.stage.v;
    const pOn = { ebb: 0.55, flow: 0.3, swell: 0.12 }[sec] * (1 + 0.6 * C.d);
    for (const lp of this.loops) {
      if (s.t < lp.next) continue;
      const per = lp.period * 1.4 * (C.d > 0.4 ? 0.8 : 1) * (0.8 + 0.45 * rng.float());
      lp.next = s.t + per;
      if (rng.float() > Math.min(1, pOn)) continue;
      const pcs = this.chordPcs();
      let midi;
      if (lp.voice === 'pad') {
        const f = this.midi(rng.pick([0, 2, 4, 4]), 12 + 12 * this.altOct);
        const tones = [nearestTone(f, pcs), nearestTone(f + 7, pcs)].sort((a, b) => a - b);
        const cp = V.cPad, a0 = cp.p.attack, r0 = cp.p.release;
        cp.p.attack = 3.2 + 1.5 * rng.float(); cp.p.release = 6;
        cp.chord(tones, s.t, 4 + 3 * rng.float(), 0.3 + 0.16 * C.d);       // a slow swell that rises and falls away
        cp.p.attack = a0; cp.p.release = r0;
        this.count('notes', 'pad');
      } else {
        const reg = prof.lead.base - prof.root + lp.reg + 12 * (C.a > 0.6 ? 1 : 0);
        midi = this.midi(rng.int(0, 7), reg);
        const rr = rng.float();
        if (rr < 0.4) midi = nearestTone(midi, pcs); else if (rr < 0.75) midi = nearestTone(midi, this.tonicPcs());
        const vel = 0.2 + 0.18 * rng.float() + 0.1 * C.d;
        if (lp.voice === 'bell') { V.bell.p.brightness = this.P.bell.brightness * (0.8 + 0.4 * rng.float()); V.bell.note(midi, s.t, 2.5, vel); }
        else { V.pluck.p.cutoff = this.P.pluck.cutoff * (0.6 + 0.5 * rng.float()); V.pluck.note(midi, s.t, 1.4, vel); }
        this.count('notes', lp.voice);
      }
      this.stats.loops++;
    }
  }

  _ghost(s) {
    const rng = this.rng;
    const frags = this.fragments.filter((id) => id !== this.levelId && PROFILES[id]);
    if (!frags.length) return;
    const id = frags[this.ghostIdx % frags.length];
    this.ghostIdx++;
    this.nextGhostPhrase = s.phrase + 1 + rng.int(0, 1);
    const fp = PROFILES[id];
    const m = motifFor(fp);
    const b = this.beat();
    const G = this.stage.v.ghost;
    G.p.kind = fp.ghost.kind;
    let t = s.t + 0.3;
    for (let i = 0; i < m.degrees.length; i++) {
      const midi = this.midi(m.degrees[i], 24);
      G.note(midi, this.at(t), 4, 0.2 + 0.08 * rng.float());
      t += b * m.durations[i] * 1.6 * (0.9 + 0.2 * rng.float());
    }
    G.note(this.midi(0, 24), this.at(t), 7, 0.26);                                // every ghost resolves to the tonic
    this.count('notes', 'ghost'); this.stats.ghosts++;
    this.log('ghost', { from: id });
  }

  _quoteMotif(s) {
    const m = this._motif, b = this.beat(), V = this.stage.v;
    let t = s.t + b * 0.5;
    for (let i = 0; i < m.degrees.length; i++) {
      const midi = this._leadMidi(m.degrees[i] + 2);
      V.lead.note(midi, this.at(t), b * m.durations[i] * 1.1, 0.34);
      t += b * m.durations[i] * 1.25;
    }
    V.lead.note(this._leadMidi(0), this.at(t), b * 3, 0.38);                     // resolves home
    this.count('notes', 'lead');
    this.log('quote', {});
  }

  // ------------------------------------------------------------------------------------------------
  // continuous control (10 Hz)
  // ------------------------------------------------------------------------------------------------
  _control(now, dt) {
    const C = this.C, prof = this.profile, ch = this.stage.ch, V = this.stage.v, fx = this.engine.fx;
    const A = this.art.mods(now) || {};
    this.art.cached = A;
    const tc = A.fast ? 0.25 : 0.6;

    // --- channels: all ten parameters, baseline from the level's colouring
    const bedMul = Math.pow(10, ((prof.bedDb || 0) + bedCurveDb(C.e)) / 20);
    // front channels (lead, resonance echoes, the concord pad, artefact bodies) step back while the land is quiet and no
    // artefact sounds, and a little more in drift: the 'calm' is what makes an artefact's arrival an event
    const calmDb = this.art.activeCount ? 0 : -6.5 * (1 - smoothstep(C.e / 0.5)) - 3 * C.d;
    const frontMul = Math.pow(10, ((prof.frontDb || 0) + calmDb) / 20);
    const leadMul = frontMul;
    for (const name of CHANNEL_NAMES) {
      const o = applyChannelMods(channelTarget(name, this.base[name], C, prof), name, A);
      if (bedMul !== 1 && !FRONT_CHANNELS.includes(name)) o.gain *= bedMul;
      else if (name === 'lead') o.gain *= leadMul;
      else if (frontMul !== 1) o.gain *= frontMul;
      if (this.mute && this.mute.has(name)) o.gain = 0;
      const cur = ch[name].state;
      const diff = {};
      let any = false;
      for (const k of Object.keys(o)) {
        const prev = cur[k];
        const tol = k === 'cutoff' ? Math.abs(o[k]) * 0.012 : k === 'resonance' ? 0.05 : 0.004;
        if (prev === undefined || Math.abs(prev - o[k]) > tol) { diff[k] = o[k]; any = true; }
      }
      if (any) ch[name].set(diff, now, name === 'lead' || name === 'ghost' ? tc : Math.max(tc, 0.5));
    }

    // --- voices: altitude / drift / cover → drone & texture
    const dp = prof.drone;
    const dCut = lerp(dp.cut[0], dp.cut[1], C.a) * (1 + 0.7 * C.d) * (1 - 0.35 * C.bog) * (1 + 0.25 * C.w - 0.25 * C.n) * ((A.drone && A.drone.cutMul) || 1);
    if (this.drone && this.drone.running) {
      // the foundation breathes: two slow incommensurate swells (≈41 s and ≈17 s), deeper while the land plays itself
      const breath = 1 + (0.22 + 0.22 * C.d) * Math.sin((TAU * now) / 41) + 0.1 * Math.sin((TAU * now) / 17 + 1);
      this.drone.set({
        cutoff: clamp(dCut * (1 + (0.2 + 0.3 * C.d) * Math.sin((TAU * now) / 29 + 2)), 120, 9000),
        level: this.P.drone.level * (0.82 + 0.2 * C.d) * breath * (1 - 0.18 * C.sw) * ((A.drone && A.drone.levelMul) || 1),
        sub: this.P.drone.sub * (0.9 + 0.5 * C.d) * ((A.drone && A.drone.subMul) || 1),
        resonance: this.P.drone.resonance + 3 * C.d + 1.5 * C.sw,
        cutoffLfo: this.P.drone.cutoffLfo * (1 + 1.3 * C.d),
      }, now);
    }
    // texture follows the ground (debounced), swells in drift
    const tex = V.texture;
    if (tex.running) {
      let tx = textureFor(prof, this.cov.key);
      let kind = tx.kind, level = tx.level, tone = tx.tone;
      if (A.texture) { kind = A.texture.kind ?? kind; level = ovr(level, A.texture.level); tone = ovr(tone, A.texture.tone); }
      level *= (0.6 + 0.3 * C.d) * (1 - 0.35 * C.sw) * (1 + 0.5 * C.slide) * (1 + 0.45 * Math.sin((TAU * now) / 13) + 0.25 * Math.sin((TAU * now) / 7.3 + 1));   // quiet, and always moving
      tone = clamp(tone + 0.15 * C.w - 0.15 * C.n + 0.18 * Math.sin((TAU * now) / 19 + 2), 0, 1);
      const patch = { level: clamp(level, 0, 1.4), tone };
      if (kind !== tex.p.kind && now - this.cov.lastTexChange > (A.texture && A.texture.kind ? 0.3 : 6)) { patch.kind = kind; this.cov.lastTexChange = now; }
      tex.set(patch, now);
    }
    // lead voice: dawn brightens, night darkens (pad cutoff is set per chord)
    V.lead.p.cutoff = this.P.lead.cutoff * (1 + 0.3 * C.w - 0.3 * C.n) * (1 + 0.35 * (C.a - 0.4)) * (1 - 0.35 * C.bog);

    // --- global FX
    const F = fxTargets(prof.fx, C, A, this.beat(), this.cond.section);
    const rv = fx.reverb, dl = fx.delay, gr = fx.granular, ms = fx.master;
    const ts = now;
    // reverb size is a crossfade over a fixed convolver bank (cheap); re-aim it when the target has moved noticeably
    if (now - this.lastReverbT > (A.fast ? 0.5 : 1.5) && Math.abs(F.reverb.size - this.lastReverbSize) > Math.max(0.4, this.lastReverbSize * 0.08)) {
      rv.setSize(F.reverb.size, A.fast ? 4 : 6, ts); this.lastReverbT = now; this.lastReverbSize = F.reverb.size;
    }
    rv.setWet(F.reverb.wet, ts); rv.setDamp(F.reverb.damp, ts); rv.setPreDelay(F.reverb.pre, ts);
    if (Math.abs(F.delay.time - this.lastDelayTime) > this.lastDelayTime * 0.03 && now - this.lastFxSlow > 0.8) { dl.setTime(F.delay.time, ts); this.lastDelayTime = F.delay.time; this.lastFxSlow = now; }
    dl.setFeedback(F.delay.fb, ts); dl.setTone(F.delay.tone, ts); dl.setWet(F.delay.wet, ts); dl.setModDepth(F.delay.mod, ts);
    if (this.lastPingPong !== F.delay.pingPong) { dl.setPingPong(F.delay.pingPong, ts); this.lastPingPong = F.delay.pingPong; }
    if (now - (this._lastSpreadT ?? -9) > 1.5) { dl.setSpread(F.delay.spread, ts); this._lastSpreadT = now; }
    gr.set(F.granular, ts, A.fast ? 0.3 : 0.8);
    if (!!F.freeze !== this.frozen) { gr.freeze(F.freeze, ts); this.frozen = !!F.freeze; }
    ms.setDrive(F.master.drive, ts); ms.setLowCut(F.master.lowCut, ts); ms.setHighCut(F.master.highCut, ts);
    const trim = this._leveler(now, dt);
    this.gainNom = this.volume * F.master.gain * 0.8 * Math.pow(10, -5 * C.d / 20);
    this.gainNow = this.gainNom * Math.pow(10, trim / 20);
    ms.setGain(this.gainNow, ts);
  }

  /**
   * Slow loudness leveler (feed-forward, attenuate-only). It refers the master analyser's reading back to the mix
   * level before the final gain, smooths it over 6–16 s and applies a trim of 0..-7 dB when that long-term level sits
   * above the level's target (-18.5 dBFS + profile.loud). Quiet passages are never boosted, so lulls and drift stay
   * quiet; short swells and artefact blooms pass untouched; sustained tutti is eased down and kept out of the limiter.
   */
  _leveler(now, dt) {
    const eng = this.engine;
    const aL = eng.meterL || eng.analyser, aR = eng.meterR || null;
    if (!aL || typeof aL.getFloatTimeDomainData !== 'function') return 0;
    if (!this._lvBuf || this._lvBuf.length !== aL.fftSize) { this._lvBuf = new Float32Array(aL.fftSize); this._lvBuf2 = new Float32Array(aL.fftSize); }
    aL.getFloatTimeDomainData(this._lvBuf);
    let e = 0;
    const buf = this._lvBuf;
    for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
    if (aR && typeof aR.getFloatTimeDomainData === 'function') {            // stereo power: the mean of both channels
      aR.getFloatTimeDomainData(this._lvBuf2);
      let e2 = 0; const b2 = this._lvBuf2;
      for (let i = 0; i < b2.length; i++) e2 += b2[i] * b2[i];
      e = 0.5 * (e + e2);
    }
    // the analyser sits after the final gain: refer the reading back to the level the mix would have with no trim
    const g = Math.max(1e-3, this.gainNow || 1);
    this.rawPow = e / buf.length;
    this.heardPow += (this.rawPow - this.heardPow) * (1 - Math.exp(-dt / 3));      // ≈ the last six seconds, as heard
    this.heardDb = 10 * Math.log10(this.heardPow + 1e-12);
    this.heardFastPow += (this.rawPow - this.heardFastPow) * (1 - Math.exp(-dt / 0.8));
    this.heardFastDb = 10 * Math.log10(this.heardFastPow + 1e-12);
    const p = e / buf.length / (g * g);
    if (Number.isFinite(p)) this.lvPow += (p - this.lvPow) * (1 - Math.exp(-dt / (p > this.lvPow ? 9 : 16)));
    const db = 10 * Math.log10(this.lvPow + 1e-12) + 20 * Math.log10(this.gainNom || 1);
    const target = CEILING_DB + (this.profile.loud || 0);
    this.measuredDb = db;
    // a ceiling, never a lift: only sustained loudness above the target is eased down, and not while an artefact sounds
    let want = now - this.levelStartT > 5 ? clamp(target - db, -7, 0) : 0;
    if ((this.art.activeCount || now < this.levelHoldUntil) && want < this.trimDb) want = this.trimDb;
    this.trimDb += (want - this.trimDb) * (1 - Math.exp(-dt / (want < this.trimDb ? 5 : 6)));
    return this.trimDb;
  }

}
