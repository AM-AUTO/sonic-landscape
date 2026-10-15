/**
 * Game simulation. Pure JS, no DOM. Fixed-step: call step(input, 1/60).
 * See docs/CONTRACTS.md section 2 for GameState / Event shapes; deviations are noted inline.
 */
import { GRID_CELLS, DAY_SECONDS, RESONANCE_SECONDS, dayPhase, seasonOf, startTimeOf } from '../world/codes.js';
import { createPlayer, stepPlayer } from './player.js';
import { PoiSystem, centre, conditionKeys } from './pois.js';
import {
  normalizeProgress, revealNote, completeLevel, chainProgress, chainSatisfied, gateCentre, GATE_RADIUS, knowledgeFor,
} from './progression.js';
import { describeCondition } from './describe.js';
import { BANNER, fmt } from '../text.js';

// The world builder is written by another module; load it lazily so this file (and the tests that
// inject their own buildWorld) still load while terrain.js is missing or broken.
let defaultBuildWorld = null;
let defaultBuildError = null;
try {
  ({ buildWorld: defaultBuildWorld } = await import('../world/terrain.js'));
} catch (e) { defaultBuildError = e; }

export const REST_TIME_MULT = 8;
export const START_TIME = 0.05;      // default start (codes.js startTimeOf: season.startTime ?? level.startTime ?? this)
export const TRAIL_SPACING = 1.5;    // cells between trail points
export const TRAIL_CAP = 4000;
export const BOTHY_NEAR_RADIUS = 14;
export const GATE_NEAR_RADIUS = 10;
export const GATE_REARM_DIST = 20;
export const GATE_REARM_SECONDS = 30;
const NEAREST_EVERY = 10;            // steps between nearest-per-chain-type recomputes
const ZERO_INPUT = Object.freeze({ x: 0, y: 0, run: false, rest: false });

const conditionKeysOf = (poi) => conditionKeys(poi.condition);
const mod = (n, m) => ((n % m) + m) % m;

export class Game {
  /**
   * @param {{levels:object[], progress?:object, buildWorld?:Function}} opts
   */
  constructor({ levels, progress, buildWorld } = {}) {
    this.levels = levels || [];
    this.progress = normalizeProgress(progress, this.levels);
    this._build = buildWorld || defaultBuildWorld;
    this.world = null; this.level = null; this.levelIndex = -1;
    this.player = null; this.pois = null;
    this.state = null;
    this._pass = (cx, cy) => this._passable(cx, cy);
    this._gateCell = { x: -1, y: -1 };
    this._gateLatched = false;
    this._onFire = (poi, full, ev) => this._handleFire(poi, full, ev);
    this._afterFire = (poi, full, ev, events) => this._handleAfterFire(poi, full, ev, events);
    this._knowledge = {};
    this._chainIdx = [];
    this._bothyIdx = [];
    this._bothyNear = new Set();
    this._gateArmed = true; this._gateNearT = -1e9;
    this._stepN = 0;
  }

  _passable(cx, cy) {
    if (cx === this._gateCell.x && cy === this._gateCell.y) return this._gateLatched;
    return this.world.passable(cx, cy);
  }

  _handleFire(poi, full, ev) {
    if (poi.type === 'bothy') ev.note = revealNote(this.progress, this.level);
    if (!full && poi.hint) ev.hint = poi.hint;
  }

  _chainTypes() { return (this.world && this.world.gate && this.world.gate.chain) || []; }

  _keysSounding() {
    const chain = this._chainTypes();
    let n = 0;
    for (let i = 0; i < chain.length; i++) if (this.pois.isResonating(chain[i])) n++;
    return n;
  }

  /** Knowledge bookkeeping, graduated reveal and bothy guidance. Runs once the resonance is final. */
  _handleAfterFire(poi, full, ev, events) {
    const k = this._knowledge;
    const e = k[poi.id] || (k[poi.id] = { heard: 0, woken: false, learned: [] });
    const chain = this._chainTypes();
    ev.inChain = chain.includes(poi.type);
    ev.keysTotal = chain.length;
    ev.keysSounding = this._keysSounding();
    ev.plain = [];
    ev.learnedNow = [];
    if (full) {
      e.woken = true;
    } else {
      e.heard++;
      const reveal = this.level.index === 0 || e.heard >= 2;
      if (reveal) {
        for (const key of ev.missing) {
          if (!e.learned.includes(key)) { e.learned.push(key); ev.learnedNow.push(key); }
        }
      }
      for (const key of ev.missing) {
        if (e.learned.includes(key)) ev.plain.push(describeCondition(key, poi.condition, this.level));
      }
    }
    if (poi.type === 'bothy') this._bothyGuide(poi, events);
  }

  /** A bothy note points at one unlearned condition of the nearest un-woken POI of the first silent key. */
  _bothyGuide(bothy, events) {
    const chain = this._chainTypes();
    const pl = this.player, pois = this.pois.pois, pc = this.pois.centres, k = this._knowledge;
    for (let ci = 0; ci < chain.length; ci++) {
      const type = chain[ci];
      if (this.pois.isResonating(type)) continue;
      let best = -1, bestD = Infinity, bestKey = null;
      for (let i = 0; i < pois.length; i++) {
        const p = pois[i];
        if (p.type !== type) continue;
        const e = k[p.id];
        if (e && e.woken) continue;
        const key = conditionKeysOf(p).find((kk) => !e || !e.learned.includes(kk));
        if (!key) continue;
        const d = Math.hypot(pl.x - pc[i].x, pl.y - pc[i].y);
        if (d < bestD) { bestD = d; best = i; bestKey = key; }
      }
      if (best < 0) continue;
      const target = pois[best];
      const e = k[target.id] || (k[target.id] = { heard: 0, woken: false, learned: [] });
      e.learned.push(bestKey);
      const plain = describeCondition(bestKey, target.condition, this.level);
      const text = fmt(BANNER.bothyGuide, { place: target.name || target.id, plain: plain.charAt(0).toLowerCase() + plain.slice(1) });
      events.push({ type: 'bothy-guide', poi: bothy, target, key: bestKey, text });
      return;
    }
  }

  loadLevel(index) {
    if (!this._build) {
      throw new Error('buildWorld unavailable' + (defaultBuildError ? ': ' + defaultBuildError.message : ''));
    }
    const level = this.levels[index];
    if (!level) throw new Error('no such level ' + index);
    const world = this._build(level);
    this.levelIndex = index; this.level = level; this.world = world;
    this._gateLatched = false;
    const g = world.gate;
    this._gateCell = g ? { x: Math.floor(g.x), y: Math.floor(g.y) } : { x: -1, y: -1 };

    const sp = centre(world.spawn);
    const p = createPlayer(sp.x, sp.y);
    p.elevation = world.heightAt(p.x, p.y);
    p._prevElev = p.elevation;
    p.cover = world.coverAt(p.x, p.y);
    const gr = world.gradientAt(p.x, p.y);
    p.slope = Math.hypot(gr.gx, gr.gy);
    p.contourIndex = Math.floor(p.elevation / world.contourInterval);
    this.player = p;

    this._knowledge = knowledgeFor(this.progress, level.id);
    this.pois = new PoiSystem(world, { onFire: this._onFire, afterFire: this._afterFire });
    this._chainIdx = this._chainTypes().map((type) => {
      const idx = [];
      this.pois.pois.forEach((q, i) => { if (q.type === type) idx.push(i); });
      return idx;
    });
    this._bothyIdx = [];
    this.pois.pois.forEach((q, i) => { if (q.type === 'bothy') this._bothyIdx.push(i); });
    this._bothyNear = new Set();
    this._gateArmed = true; this._gateNearT = -1e9;
    this._stepN = 0;
    this._gx = Math.floor(p.x / GRID_CELLS);
    this._gy = Math.floor(p.y / GRID_CELLS);
    const tod = startTimeOf(level);
    const season = seasonOf(level);   // normalised { dawn, day, dusk, night } shares (quarters without a season)

    this.state = {
      t: 0, dt: 0,
      levelIndex: index, level, world,
      player: p,
      timeOfDay: tod, phase: dayPhase(tod, season),
      season,                               // read-only: the renderer / score may use it (phaseBounds(season) etc.)
      day: 1,                               // +1 each time timeOfDay wraps past 1 (a full day cycle walked)
      events: [],
      proximity: [],
      resonance: this.pois.resonance,
      gateOpen: false,
      chainProgress: chainProgress(g, (type) => this.pois.isResonating(type)),
      knowledge: this._knowledge,
      trail: [{ x: p.x, y: p.y }],
      fragments: this.progress.fragments,
      discovered: this.pois.discovered,
      levelComplete: false,
    };
    this._updateChainExtras(true);
    this._refreshProximity();
    return this.state;
  }

  /** remaining/count every call (cheap); nearest only every NEAREST_EVERY steps (or when forced). */
  _updateChainExtras(force) {
    const cp = this.state.chainProgress, res = this.pois.resonance, p = this.player, pc = this.pois.centres, pois = this.pois.pois;
    const doNearest = force || this._stepN % NEAREST_EVERY === 0;
    for (let i = 0; i < cp.length; i++) {
      const c = cp[i];
      let rem = 0;
      for (let r = 0; r < res.length; r++) {
        if (res[r].type === c.type) { const v = res[r].strength * RESONANCE_SECONDS; if (v > rem) rem = v; }
      }
      c.remaining = rem;
      const idx = this._chainIdx[i];
      c.count = idx.length;
      if (!doNearest) continue;
      let best = -1, bestD = Infinity;
      for (let j = 0; j < idx.length; j++) {
        const q = pc[idx[j]];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) { bestD = d; best = idx[j]; }
      }
      if (best < 0) { c.nearest = null; continue; }
      const q = pc[best];
      let n = c.nearest;
      if (!n) n = c.nearest = { poiId: '', name: '', x: 0, y: 0, dist: 0, bearing: 0 };
      n.poiId = pois[best].id; n.name = pois[best].name || pois[best].id;
      n.x = q.x; n.y = q.y; n.dist = bestD; n.bearing = Math.atan2(q.y - p.y, q.x - p.x);
    }
  }

  _refreshProximity() {
    const p = this.player, pc = this.pois.centres, pois = this.pois.pois;
    // keep the 3 nearest, sorted
    let a = null, b = null, c = null;
    for (let i = 0; i < pois.length; i++) {
      const d = Math.hypot(p.x - pc[i].x, p.y - pc[i].y);
      if (!a || d < a.dist) { c = b; b = a; a = { poi: pois[i], dist: d }; }
      else if (!b || d < b.dist) { c = b; b = { poi: pois[i], dist: d }; }
      else if (!c || d < c.dist) { c = { poi: pois[i], dist: d }; }
    }
    const out = [];
    if (a) out.push(a); if (b) out.push(b); if (c) out.push(c);
    this.state.proximity = out;
  }

  step(input, dt = 1 / 60) {
    const s = this.state;
    if (!s) throw new Error('loadLevel() first');
    input = input || ZERO_INPUT;
    const world = this.world, p = this.player;
    const events = [];
    s.events = events;
    s.dt = dt; s.t += dt;

    // --- walker
    const prevCover = p.cover;
    stepPlayer(p, world, input, dt, this._pass, events);
    p.resting = !!input.rest && !p.moving;
    if (p.cover !== prevCover) events.push({ type: 'cover', from: prevCover, to: p.cover });

    // --- time of day
    const prevTod = s.timeOfDay;
    s.timeOfDay = mod(s.timeOfDay + (dt / DAY_SECONDS) * (p.resting ? REST_TIME_MULT : 1), 1);
    if (s.timeOfDay < prevTod) s.day++;
    s.phase = dayPhase(s.timeOfDay, s.season);

    // --- contour crossings. index = line number (height = index * interval).
    // up i -> i+1 crosses line i+1; down i -> i-1 crosses line i. major when line % 5 === 0.
    const ci = Math.floor(p.elevation / world.contourInterval);
    if (ci !== p.contourIndex) {
      if (ci > p.contourIndex) {
        for (let i = p.contourIndex; i < ci; i++) {
          const line = i + 1, major = mod(line, 5) === 0;
          if (major) p.climb++;
          events.push({ type: 'contour', dir: 1, index: line, major, elevation: p.elevation, speed: p.speed });
        }
      } else {
        for (let i = p.contourIndex; i > ci; i--) {
          const line = i, major = mod(line, 5) === 0;
          if (major) p.climb = 0;
          events.push({ type: 'contour', dir: -1, index: line, major, elevation: p.elevation, speed: p.speed });
        }
      }
      p.contourIndex = ci;
    }

    // --- 1 km grid crossings (lines every GRID_CELLS cells)
    const gx = Math.floor(p.x / GRID_CELLS), gy = Math.floor(p.y / GRID_CELLS);
    if (gx !== this._gx) {
      const dir = gx > this._gx ? 1 : -1;
      for (let i = this._gx; i !== gx; i += dir) {
        const line = dir > 0 ? i + 1 : i;
        events.push({ type: 'grid', axis: 'x', line, gx, gy, major: mod(line, 5) === 0 });
      }
      this._gx = gx;
    }
    if (gy !== this._gy) {
      const dir = gy > this._gy ? 1 : -1;
      for (let i = this._gy; i !== gy; i += dir) {
        const line = dir > 0 ? i + 1 : i;
        events.push({ type: 'grid', axis: 'y', line, gx, gy, major: mod(line, 5) === 0 });
      }
      this._gy = gy;
    }

    // --- artefacts
    this.pois.update(s.t, dt, p, s.phase, events);

    // --- gate chain
    const cp = s.chainProgress;
    this._stepN++;
    for (let i = 0; i < cp.length; i++) cp[i].resonating = this.pois.isResonating(cp[i].type);
    this._updateChainExtras(false);
    if (!this._gateLatched && chainSatisfied(cp)) {
      this._gateLatched = true;
      s.gateOpen = true;
      events.push({ type: 'gate-open' });
    }
    if (s.gateOpen && !s.levelComplete && world.gate) {
      const gc = gateCentre(world.gate);
      if (Math.hypot(p.x - gc.x, p.y - gc.y) <= GATE_RADIUS) {
        s.levelComplete = true;
        completeLevel(this.progress, this.levels, this.levelIndex);
        events.push({ type: 'level-complete', levelId: this.level.id });
      }
    }

    // --- walked route
    const tr = s.trail, last = tr[tr.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= TRAIL_SPACING) {
      if (tr.length >= TRAIL_CAP) tr.splice(0, 100);
      tr.push({ x: p.x, y: p.y });
    }

    // --- proximity hints: bothies and the gate
    for (let b = 0; b < this._bothyIdx.length; b++) {
      const i = this._bothyIdx[b], bp = this.pois.pois[i];
      if (this._bothyNear.has(bp.id)) continue;
      const kn = this._knowledge[bp.id];
      if (kn && (kn.woken || kn.heard > 0)) { this._bothyNear.add(bp.id); continue; }
      const c = this.pois.centres[i];
      if (Math.hypot(p.x - c.x, p.y - c.y) <= BOTHY_NEAR_RADIUS) {
        this._bothyNear.add(bp.id);
        events.push({ type: 'bothy-near', poi: bp });
      }
    }
    if (world.gate && this._chainTypes().length) {
      const gc = gateCentre(world.gate), gd = Math.hypot(p.x - gc.x, p.y - gc.y);
      if (this._gateArmed) {
        if (gd <= GATE_NEAR_RADIUS) {
          this._gateArmed = false; this._gateNearT = s.t;
          events.push({ type: 'gate-near', chain: this._chainTypes().slice(), open: s.gateOpen });
        }
      } else if (gd > GATE_REARM_DIST && s.t - this._gateNearT >= GATE_REARM_SECONDS) this._gateArmed = true;
    }

    this._refreshProximity();
    return s;
  }
}
