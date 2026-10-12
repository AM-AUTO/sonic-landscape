/**
 * Game simulation. Pure JS, no DOM. Fixed-step: call step(input, 1/60).
 * See docs/CONTRACTS.md section 2 for GameState / Event shapes; deviations are noted inline.
 */
import { GRID_CELLS, DAY_SECONDS, dayPhase } from '../world/codes.js';
import { createPlayer, stepPlayer } from './player.js';
import { PoiSystem, centre } from './pois.js';
import {
  normalizeProgress, revealNote, completeLevel, chainProgress, chainSatisfied, gateCentre, GATE_RADIUS,
} from './progression.js';

// The world builder is written by another module; load it lazily so this file (and the tests that
// inject their own buildWorld) still load while terrain.js is missing or broken.
let defaultBuildWorld = null;
let defaultBuildError = null;
try {
  ({ buildWorld: defaultBuildWorld } = await import('../world/terrain.js'));
} catch (e) { defaultBuildError = e; }

export const REST_TIME_MULT = 8;
export const START_TIME = 0.05;
const ZERO_INPUT = Object.freeze({ x: 0, y: 0, run: false, rest: false });

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
  }

  _passable(cx, cy) {
    if (cx === this._gateCell.x && cy === this._gateCell.y) return this._gateLatched;
    return this.world.passable(cx, cy);
  }

  _handleFire(poi, full, ev) {
    if (poi.type === 'bothy') ev.note = revealNote(this.progress, this.level);
    if (!full && poi.hint) ev.hint = poi.hint;
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

    this.pois = new PoiSystem(world, { onFire: this._onFire });
    this._gx = Math.floor(p.x / GRID_CELLS);
    this._gy = Math.floor(p.y / GRID_CELLS);
    const tod = level.startTime ?? START_TIME;

    this.state = {
      t: 0, dt: 0,
      levelIndex: index, level, world,
      player: p,
      timeOfDay: tod, phase: dayPhase(tod),
      events: [],
      proximity: [],
      resonance: this.pois.resonance,
      gateOpen: false,
      chainProgress: chainProgress(g, (type) => this.pois.isResonating(type)),
      fragments: this.progress.fragments,
      discovered: this.pois.discovered,
      levelComplete: false,
    };
    this._refreshProximity();
    return this.state;
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
    s.timeOfDay = mod(s.timeOfDay + (dt / DAY_SECONDS) * (p.resting ? REST_TIME_MULT : 1), 1);
    s.phase = dayPhase(s.timeOfDay);

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
    for (let i = 0; i < cp.length; i++) cp[i].resonating = this.pois.isResonating(cp[i].type);
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

    this._refreshProximity();
    return s;
  }
}
