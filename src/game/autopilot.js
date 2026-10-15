/**
 * Autopilot + route planning for verification tools and attract mode. Pure JS.
 *
 *   findPath(world, from, to)            A* on passable 8-connected cells, slope/cover weighted, smoothed
 *   new Autopilot(world, waypoints, opts) .input(state) -> {x,y,run,rest}; .done
 *   planChainRoute(world, level)         waypoints that complete the level's gate chain, then the gate
 *
 * Waypoint: { x, y, mode?:'walk'|'run'|'slow', dwell?:sec, rest?:bool, waitPhase?:'dawn'|..., radius?:cells }
 *   - mode 'slow' walks normally until SLOW_ZONE cells from the target, then creeps (input ~0.3) so the
 *     arrival speed is well under 2.2 cells/s.
 *   - dwell: stand still that many seconds once within `radius`. rest:true holds the rest input meanwhile
 *     (time of day runs x8). waitPhase: after the dwell, keep waiting (resting) until state.phase matches.
 */
import { COVER, CELL_METERS, DAY_SECONDS, RESONANCE_SECONDS, dayPhase, phaseCentres, startTimeOf } from '../world/codes.js';
import { createPlayer, stepPlayer } from './player.js';
import { centre, TRIGGER_RADIUS, History, APPROACH_WINDOW, FAST_WINDOW } from './pois.js';

export const SLOW_ZONE = 9;
const SLOW_INPUT = 0.3;
const CLEARANCE = 0.8;
const REST_MULT = 8;

// ---------------------------------------------------------------------------------------------
// grid maps (cached per world)
// ---------------------------------------------------------------------------------------------

const COVER_COST = {
  [COVER.PATH]: 0.8, [COVER.MOOR]: 1.0, [COVER.BOG]: 2.4, [COVER.SCREE]: 3.0, [COVER.SNOW]: 1.9,
  [COVER.WOOD]: 1.25, [COVER.SHALLOW]: 1.9, [COVER.ROCK]: 1.15,
};
const coverCost = (c) => COVER_COST[c] ?? 1.5;

const cache = new WeakMap();
function mapsFor(world) {
  let m = cache.get(world);
  if (m) return m;
  const n = world.size;
  const pass = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) pass[y * n + x] = world.passable(x, y) ? 1 : 0;
  const pen = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!pass[y * n + x]) continue;
      let near = 0;
      for (let dy = -2; dy <= 2 && near < 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n || !pass[yy * n + xx]) { near = Math.max(near, Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 2 : 1); if (near === 2) break; }
      }
      pen[y * n + x] = near === 2 ? 0.8 : near === 1 ? 0.25 : 0;
    }
  }
  m = {
    n, pass, pen,
    g: new Float32Array(n * n), parent: new Int32Array(n * n), seen: new Int32Array(n * n), closed: new Int32Array(n * n), gen: 0,
  };
  cache.set(world, m);
  return m;
}

function cellPass(m, cx, cy) { return cx >= 0 && cy >= 0 && cx < m.n && cy < m.n && m.pass[cy * m.n + cx] === 1; }
function boxFree(m, x, y, r) {
  return cellPass(m, Math.floor(x - r), Math.floor(y - r)) && cellPass(m, Math.floor(x + r), Math.floor(y - r))
    && cellPass(m, Math.floor(x - r), Math.floor(y + r)) && cellPass(m, Math.floor(x + r), Math.floor(y + r))
    && cellPass(m, Math.floor(x), Math.floor(y));
}
/** Straight segment keeps the (slightly fattened) player box on passable cells. */
// Keeps a generous margin (0.8 cell): at run speed the walker drifts ~1 cell wide through corners.
function lineClear(m, a, b, r = CLEARANCE) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!boxFree(m, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) return false;
  }
  return true;
}
function segCost(world, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / 0.5));
  const step = d / n;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    c += step * coverCost(world.coverAt(x, y)) * (1 + world.slopeAt(x, y) * 4);
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------------------------

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0], lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function nearestPassable(m, cx, cy) {
  if (cellPass(m, cx, cy)) return [cx, cy];
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (cellPass(m, cx + dx, cy + dy)) return [cx + dx, cy + dy];
    }
  }
  return null;
}

const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/**
 * @returns {{x,y}[]|null} smoothed path; first point = from, last = to (as given).
 * opts.smooth=false returns the raw cell-centre path.
 */
export function findPath(world, from, to, opts = {}) {
  const m = mapsFor(world);
  const n = m.n;
  const s = nearestPassable(m, Math.floor(from.x), Math.floor(from.y));
  const t = nearestPassable(m, Math.floor(to.x), Math.floor(to.y));
  if (!s || !t) return null;
  const sIdx = s[1] * n + s[0], tIdx = t[1] * n + t[0];
  const gate = world.gate ? { x: Math.floor(world.gate.x), y: Math.floor(world.gate.y) } : null;
  const gateIdx = gate && cellPass(m, gate.x, gate.y) ? gate.y * n + gate.x : -1;
  const blockGate = gateIdx >= 0 && gateIdx !== tIdx && gateIdx !== sIdx;
  const ok = (cx, cy) => cellPass(m, cx, cy) && !(blockGate && cy * n + cx === gateIdx);
  const gen = ++m.gen;
  const { g, parent, seen, closed } = m;   // generation-stamped: no per-search clearing (384² sheets)
  const H = world.height;
  const heap = new Heap();
  const hf = (cx, cy) => {
    const dx = Math.abs(cx - t[0]), dy = Math.abs(cy - t[1]);
    return 0.8 * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
  };
  seen[sIdx] = gen; g[sIdx] = 0; parent[sIdx] = -1;
  heap.push(hf(s[0], s[1]), sIdx);
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === tIdx) { found = true; break; }
    const cx = cur % n, cy = (cur / n) | 0;
    const gc = g[cur];
    for (let k = 0; k < 8; k++) {
      const nb = NB[k];
      const nx = cx + nb[0], ny = cy + nb[1];
      if (!ok(nx, ny)) continue;
      if (nb[0] !== 0 && nb[1] !== 0 && (!ok(cx + nb[0], cy) || !ok(cx, cy + nb[1]))) continue; // no corner cutting
      const ni = ny * n + nx;
      if (closed[ni] === gen) continue;
      const d = nb[2];
      const slope = Math.abs(H[ni] - H[cur]) / (d * CELL_METERS);
      const cost = d * (1 + slope * 4) * coverCost(world.cover[ni]) + m.pen[ni];
      const ng = gc + cost;
      if (seen[ni] !== gen || ng < g[ni]) {
        seen[ni] = gen; g[ni] = ng; parent[ni] = cur;
        heap.push(ng + hf(nx, ny), ni);
      }
    }
  }
  if (!found) return null;
  const idxs = [];
  for (let i = tIdx; i !== -1; i = parent[i]) idxs.push(i);
  idxs.reverse();
  const pts = idxs.map((i) => ({ x: (i % n) + 0.5, y: ((i / n) | 0) + 0.5 }));
  const cum = idxs.map((i) => g[i]);
  pts[0] = { x: from.x, y: from.y };
  if (pts.length === 1) pts.push({ x: to.x, y: to.y });
  else pts[pts.length - 1] = { x: to.x, y: to.y };
  if (opts.smooth === false || pts.length < 3) return pts;
  // string pulling: jump to the farthest visible node whose straight cost isn't much worse
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 60);
    for (; j > i + 1; j--) {
      if (!lineClear(m, pts[i], pts[j])) continue;
      if (segCost(world, pts[i], pts[j]) <= 1.12 * (cum[j] - cum[i]) + 0.5) break;
    }
    out.push(pts[j]);
    i = j;
  }
  return out;
}

export function pathLength(path) {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return L;
}

// ---------------------------------------------------------------------------------------------
// Autopilot
// ---------------------------------------------------------------------------------------------

const ZERO = () => ({ x: 0, y: 0, run: false, rest: false });

export class Autopilot {
  constructor(world, waypoints, opts = {}) {
    this.world = world;
    this.wps = waypoints.slice();
    this.opts = opts;
    this.i = 0;
    this.mode = 'go';       // 'go' | 'dwell'
    this.dwellLeft = 0;
    this.path = null; this.k = 1; this.planT = 0; this.age = 0;
    this.stuckT = 0; this.replans = 0; this.lowT = 0;
    this.failed = [];
    this.done = this.wps.length === 0;
    this._m = mapsFor(world);
  }

  get waypointIndex() { return this.i; }

  _next() {
    this.i++; this.mode = 'go'; this.path = null; this.stuckT = 0; this.replans = 0;
    if (this.i >= this.wps.length) this.done = true;
  }

  input(state) {
    if (this.done) return ZERO();
    const p = state.player;
    const dt = state.dt || 1 / 60;
    for (let guard = 0; guard < 8 && !this.done; guard++) {
      const w = this.wps[this.i];
      const dist = Math.hypot(w.x - p.x, w.y - p.y);
      if (this.mode === 'dwell') {
        this.dwellLeft -= dt;
        if (this.dwellLeft <= 0 && (!w.waitPhase || state.phase === w.waitPhase)) { this._next(); continue; }
        return { x: 0, y: 0, run: false, rest: w.rest ?? !!w.waitPhase };
      }
      const radius = w.radius ?? ((w.dwell > 0 || w.waitPhase || w.rest) ? 1.0 : (this.opts.arriveRadius ?? 1.5));
      if (dist <= radius) {
        if (w.dwell > 0 || w.waitPhase) { this.mode = 'dwell'; this.dwellLeft = w.dwell || 0; continue; }
        this._next();
        continue;
      }
      return this._steer(state, w, dist, dt);
    }
    return ZERO();
  }

  _plan(p, w) {
    this.path = findPath(this.world, { x: p.x, y: p.y }, { x: w.x, y: w.y })
      || [{ x: p.x, y: p.y }, { x: w.x, y: w.y }];
    this.k = this.path.length > 1 ? 1 : 0;
    this.age = 0;
  }

  _steer(state, w, dist, dt) {
    const p = state.player;
    this.age += dt;
    if (!this.path || this.age > 5) this._plan(p, w);
    const path = this.path;
    // advance along the path
    const reach = 0.6 + 0.04 * p.speed;
    while (this.k < path.length - 1 && Math.hypot(path[this.k].x - p.x, path[this.k].y - p.y) < reach) this.k++;
    for (let look = 0; look < 2 && this.k < path.length - 1; look++) {
      const nx = path[this.k + 1];
      if (Math.hypot(nx.x - p.x, nx.y - p.y) < 12 && lineClear(this._m, p, nx)) this.k++; else break;
    }
    const tgt = path[this.k];
    let dx = tgt.x - p.x, dy = tgt.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;

    const mode = w.mode || this.opts.defaultMode || 'walk';
    let run = mode === 'run', mag = 1;
    if (mode === 'slow' && dist < SLOW_ZONE) { run = false; mag = p.speed > 1.6 ? 0 : SLOW_INPUT; }

    // crawling up something steep: break into a run (not when deliberately creeping)
    if (mode !== 'slow' && !run && p.speed < 1.2) this.lowT += dt; else if (p.speed > 2) this.lowT = 0;
    if (this.lowT > 0.5) run = true;

    // stuck handling
    if (mag > 0 && p.speed < 0.4) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 1.2) {
      this.stuckT = 0; this.replans++;
      if (this.replans > 6) { this.failed.push(this.i); this._next(); return ZERO(); }
      this.path = null;
    }
    return { x: dx * mag, y: dy * mag, run, rest: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Route planning
// ---------------------------------------------------------------------------------------------

/**
 * Headless trial run of a leg: start at rest at `from`, drive an Autopilot toward `target` with the
 * real walker physics, and report what the arrival snapshot would be on entering the trigger radius:
 * { vz, speed, maxSpeed, climb, time } (null if the target is never reached).
 * Uses the same mean-vz window, max-speed window and index-contour bookkeeping as the sim.
 */
export function simulateApproach(world, from, target, mode = 'run', maxT = 60) {
  const dt = 1 / 60;
  const m = mapsFor(world);
  const gate = world.gate ? { x: Math.floor(world.gate.x), y: Math.floor(world.gate.y) } : null;
  const tcx = Math.floor(target.x), tcy = Math.floor(target.y);
  const pass = (cx, cy) => {
    if (gate && cx === gate.x && cy === gate.y && !(tcx === cx && tcy === cy)) return false;
    return cellPass(m, cx, cy);
  };
  const p = createPlayer(from.x, from.y);
  p.elevation = world.heightAt(p.x, p.y); p._prevElev = p.elevation; p.cover = world.coverAt(p.x, p.y);
  const M = world.contourInterval;
  p.contourIndex = Math.floor(p.elevation / M);
  const ap = new Autopilot(world, [{ x: target.x, y: target.y, mode }]);
  const state = { player: p, dt, phase: 'day' };
  const hist = new History(512);
  const events = [];
  for (let i = 0; i * dt < maxT; i++) {
    const t = i * dt;
    const inp = ap.input(state);
    events.length = 0;
    stepPlayer(p, world, inp, dt, pass, events);
    const ci = Math.floor(p.elevation / M);
    if (ci > p.contourIndex) { for (let k = p.contourIndex; k < ci; k++) if (((k + 1) % 5 + 5) % 5 === 0) p.climb++; }
    else if (ci < p.contourIndex) { for (let k = p.contourIndex; k > ci; k--) if (((k % 5) + 5) % 5 === 0) p.climb = 0; }
    p.contourIndex = ci;
    hist.push(t, p.elevation, p.speed);
    if (Math.hypot(p.x - target.x, p.y - target.y) <= TRIGGER_RADIUS) {
      return {
        vz: hist.meanVz(APPROACH_WINDOW), speed: p.speed, maxSpeed: Math.max(p.speed, hist.maxSpeed(FAST_WINDOW)),
        climb: p.climb, time: t,
      };
    }
    if (ap.done) return null;
  }
  return null;
}

function passAt(world, x, y) { return world.passable(Math.floor(x), Math.floor(y)); }

function findApproach(world, target, cond) {
  const slow = cond.speed === 'slow', fast = cond.speed === 'fast';
  const mode = slow ? 'slow' : 'run';
  const radii = slow ? [8, 11, 14, 6] : [14, 18, 11, 24, 30, 9];
  let best = null;
  for (const R of radii) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const P = { x: Math.floor(target.x + Math.cos(ang) * R) + 0.5, y: Math.floor(target.y + Math.sin(ang) * R) + 0.5 };
      if (!passAt(world, P.x, P.y)) continue;
      const e = simulateApproach(world, P, target, mode, 40);
      if (!e) continue;
      let score = 0, ok = true;
      // the 2 s vz window must lie wholly on the planned leg, else the walker's earlier history leaks in
      const clean = !(cond.approach === 'descending' || cond.approach === 'ascending') || e.time >= 2.3;
      if (cond.approach === 'descending') { ok = ok && e.vz < -7; score += -e.vz; }
      if (cond.approach === 'ascending') { ok = ok && e.vz > 7; score += e.vz; }
      if (slow) { ok = ok && e.speed < 2.0; score -= e.speed * 3; }
      if (fast) { ok = ok && e.maxSpeed > 6.8; score += e.maxSpeed * 3; }
      const rank = (ok ? 1000 : 0) + (clean ? 500 : 0) + score - e.time * (ok ? 1 : 0.1);
      if (!best || rank > best.rank) best = { rank, P, ok, clean, e };
    }
    if (best && best.ok && best.clean) break;
  }
  return best;
}

function findClimbStart(world, target, N, mode) {
  const M = world.contourInterval * 5;
  const hT = world.heightAt(target.x, target.y);
  const cands = [];
  for (let dy = -60; dy <= 60; dy += 3) {
    for (let dx = -60; dx <= 60; dx += 3) {
      const x = Math.floor(target.x + dx) + 0.5, y = Math.floor(target.y + dy) + 0.5;
      if (!passAt(world, x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d < 8 || d > 60) continue;
      const h = world.heightAt(x, y);
      if (hT - h < N * M + 6) continue;
      cands.push({ x, y, d, h });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  let tried = 0, bestAlt = null;
  for (const c of cands) {
    if (tried++ > 60) break;
    const e = simulateApproach(world, c, target, mode, 90);
    if (!e) continue;
    if (e.climb >= N) return { P: { x: c.x, y: c.y }, climb: e.climb, time: e.time, ok: true };
    if (!bestAlt || e.climb > bestAlt.climb) bestAlt = { P: { x: c.x, y: c.y }, climb: e.climb, time: e.time, ok: false };
  }
  return bestAlt;
}

const mod1 = (v) => ((v % 1) + 1) % 1;
export const PLAN_SPEED = 6.0;  // cells/s used to estimate travel time (mostly running)
/**
 * s: the held thread renews every sounding chain resonance whenever a chain artefact wakes, so only each
 * leg (one chain fire to the next, including rests and dwells) has to fit inside RESONANCE_SECONDS (90).
 */
export const LEG_LIMIT = 80;

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

/**
 * Waypoints that complete the level: fire each gate-chain POI with an approach that satisfies its
 * condition (preceded by any `requires` POI), then walk to the gate. The visiting order is the chain
 * order unless another order (respecting `requires`) keeps every leg inside LEG_LIMIT better (the held
 * thread: each chain fire renews the others, so legs, not the whole chain, must fit the 90 s resonance);
 * each candidate order is scored from estimated travel times. Time-of-day conditions insert a rest
 * beforehand; phases follow the level's season (seasonOf / phaseCentres), so long nights are respected.
 *
 * Waypoints carry `poiId` / `note` for diagnostics. The returned array has `.warnings` (strings),
 * `.order` (poi ids in visiting order), `.estimate` ({leg, window, end} seconds: the longest leg between
 * chain fires, first-to-last chain fire, and the time the last artefact fires) and `.legs`
 * ([{ from, to, type, dist, time }]: spawn → each visited artefact → gate; dist = A* path cells,
 * time = estimated seconds including rests, approach runs and dwells).
 */
export function planChainRoute(world, level, opts = {}) {
  level = level || world.level || {};
  const warnings = [];
  const chain = (world.gate && world.gate.chain) || [];
  const pois = world.pois || [];
  const spawn = centre(world.spawn);
  const startTod = startTimeOf(level);
  const centres = phaseCentres(level);
  const phaseAt = (tod) => dayPhase(tod, level);
  const chainSet = new Set(chain);

  const pickFor = new Map();
  const pick = (type) => {
    if (pickFor.has(type)) return pickFor.get(type);
    let best = null, bd = Infinity;
    for (const p of pois) {
      if (p.type !== type) continue;
      const d = Math.hypot(p.x - spawn.x, p.y - spawn.y);
      if (d < bd) { bd = d; best = p; }
    }
    pickFor.set(type, best);
    return best;
  };

  // types to visit: chain + requires closure
  const types = [];
  const addType = (t, depth) => {
    if (types.includes(t) || depth > 4) return;
    const poi = pick(t);
    if (!poi) { warnings.push('no POI of type ' + t); return; }
    types.push(t);
    const r = poi.condition && poi.condition.requires;
    if (r) addType(r, depth + 1);
  };
  for (const t of chain) addType(t, 0);
  const required = (t) => (pick(t).condition || {}).requires;

  // per-POI legs (approach + main), computed once
  const legCache = new Map();
  const legsFor = (type) => {
    if (legCache.has(type)) return legCache.get(type);
    const poi = pick(type);
    const cond = poi.condition || {};
    const target = centre(poi);
    const legs = [];
    if (cond.climb > 0) {
      const c = findClimbStart(world, target, cond.climb, cond.speed === 'slow' ? 'slow' : 'run');
      if (c) {
        legs.push({ x: c.P.x, y: c.P.y, mode: 'run', radius: 0.8, note: 'climb start (' + c.climb + ' idx contours)' });
        if (!c.ok) warnings.push(`${poi.id}: best climb start only reaches climb=${c.climb} < ${cond.climb}`);
      } else warnings.push(`${poi.id}: no climb start found for climb=${cond.climb}`);
    } else if ((cond.approach && cond.approach !== 'any') || (cond.speed && cond.speed !== 'any')) {
      const a = findApproach(world, target, cond);
      if (a) {
        legs.push({ x: a.P.x, y: a.P.y, mode: cond.speed === 'slow' ? 'walk' : 'run', radius: 0.8, note: `approach vz=${a.e.vz.toFixed(1)} v=${a.e.speed.toFixed(1)} vmax=${a.e.maxSpeed.toFixed(1)}` });
        if (!a.ok) warnings.push(`${poi.id}: no approach satisfying ${JSON.stringify({ a: cond.approach, s: cond.speed })} (best vz=${a.e.vz.toFixed(1)}, speed=${a.e.speed.toFixed(1)}, max=${a.e.maxSpeed.toFixed(1)})`);
      } else warnings.push(`${poi.id}: no approach candidate found`);
    }
    const main = { x: target.x, y: target.y, mode: cond.speed === 'slow' ? 'slow' : 'run', poiId: poi.id, type: poi.type };
    if (cond.dwell > 0) main.dwell = cond.dwell + 1;
    if (cond.time) { main.waitPhase = cond.time; main.rest = true; main.dwell = main.dwell || 0; }
    legs.push(main);
    const r = { poi, cond, legs };
    legCache.set(type, r);
    return r;
  };

  const lenCache = new Map();
  const plen = (a, b) => {
    const k = `${a.x},${a.y}>${b.x},${b.y}`;
    let v = lenCache.get(k);
    if (v === undefined) {
      const path = findPath(world, a, b);
      v = path ? pathLength(path) : Math.hypot(b.x - a.x, b.y - a.y) * 3;
      lenCache.set(k, v);
    }
    return v;
  };

  /** Build waypoints for an order and estimate when each type fires. */
  const build = (order) => {
    let cur = spawn, tod = startTod, clock = 0;
    const wps = [], fired = new Map(), legInfo = [];
    for (const type of order) {
      const { cond, legs } = legsFor(type);
      let T = 0, D = 0, from = cur;
      for (const l of legs) { const L = plen(from, l); D += L; T += L / PLAN_SPEED; from = l; }
      const main = legs[legs.length - 1];
      const clock0 = clock;
      if (cond.time) {
        const arr = tod + T / DAY_SECONDS;
        const margin = ((cond.dwell || 0) + 10) / DAY_SECONDS;
        if (!(phaseAt(arr) === cond.time && phaseAt(arr + margin) === cond.time)) {
          const restTod = mod1(centres[cond.time] - arr);
          const secs = (restTod * DAY_SECONDS) / REST_MULT + 0.5;
          wps.push({ x: cur.x, y: cur.y, rest: true, dwell: secs, radius: 99, note: `rest for ${cond.time}` });
          tod = mod1(tod + restTod);
          clock += secs;
        }
      }
      for (const l of legs) wps.push(l);
      tod = mod1(tod + (T + (main.dwell || 0)) / DAY_SECONDS);
      clock += T + (main.dwell || 0);
      fired.set(type, clock);
      legInfo.push({ from: legInfo.length ? legInfo[legInfo.length - 1].to : 'spawn', to: main.poiId, type, dist: D, time: clock - clock0 });
      cur = main;
    }
    return { wps, fired, end: clock, cur, order, legInfo };
  };

  // choose the visiting order
  const base = [];
  const place = (t) => { if (base.includes(t)) return; const r = required(t); if (r && types.includes(r)) place(r); base.push(t); };
  for (const t of types) place(t);
  const score = (b) => {
    let lo = Infinity, hi = -Infinity;
    for (const t of chain) { const c = b.fired.get(t); if (c === undefined) continue; lo = Math.min(lo, c); hi = Math.max(hi, c); }
    const window = Number.isFinite(lo) ? hi - lo : 0;
    // replay the held thread: `last` = when each type's resonance was last (re)started
    const last = new Map();
    let leg = 0, stale = 0;
    for (const t of b.order) {
      const c = b.fired.get(t);
      const r = required(t);
      if (r && last.has(r)) stale = Math.max(stale, c - last.get(r) - LEG_LIMIT);  // `requires` must still sound
      if (chainSet.has(t)) {
        for (const [u, lt] of last) {
          if (!chainSet.has(u)) continue;
          leg = Math.max(leg, c - lt);
          if (c - lt < RESONANCE_SECONDS) last.set(u, c);
        }
      }
      last.set(t, c);
    }
    return { window, leg, cost: Math.max(0, leg - LEG_LIMIT) * 1000 + Math.max(0, stale) * 1000 + b.end };
  };
  let bestOrder = base, best = build(base), bestScore = score(best);
  if (types.length > 1 && types.length <= 6 && opts.reorder !== false) {
    for (const order of permutations(types)) {
      if (order.some((t, i) => { const r = required(t); return r && types.includes(r) && order.indexOf(r) > i; })) continue;
      if (order.join() === base.join()) continue;
      const b = build(order), sc = score(b);
      if (sc.cost < bestScore.cost - 2) { best = b; bestOrder = order; bestScore = sc; }
    }
  }
  if (bestScore.leg > LEG_LIMIT + 5) warnings.push(`estimated chain leg ${bestScore.leg.toFixed(0)} s exceeds the ${RESONANCE_SECONDS} s resonance`);

  const wps = best.wps.slice();
  const legs = best.legInfo.slice();
  if (world.gate) {
    const g = { x: Math.floor(world.gate.x) + 0.5, y: Math.floor(world.gate.y) + 0.5 };
    const D = plen(best.cur, g);
    legs.push({ from: legs.length ? legs[legs.length - 1].to : 'spawn', to: 'gate', type: 'gate', dist: D, time: D / PLAN_SPEED });
    wps.push({ ...g, mode: 'run', radius: 1.2, poiId: 'gate', note: 'gate' });
  }
  wps.warnings = warnings;
  wps.order = bestOrder.map((t) => pick(t).id);
  wps.estimate = { leg: bestScore.leg, window: bestScore.window, end: best.end };
  wps.legs = legs;
  return wps;
}
