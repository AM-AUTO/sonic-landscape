/**
 * POI proximity, approach-condition evaluation, triggers, cooldowns and resonance. Pure JS.
 *
 * Thresholds (all documented here, exported for tests/tools):
 *   TRIGGER_RADIUS 3 cells to enter, LEAVE_RADIUS 3.6 to leave (hysteresis).
 *   Vertical velocity is in m/s. One cell is 40 m, so walking at 5 cells/s on a 2 % grade is
 *   already 4 m/s; "typical" hill slopes (0.1-0.5) give 20-100 m/s. Hence:
 *     approach 'descending' : mean vz over the last 2 s  < -5 m/s   (about a 2.5 % grade at walking pace)
 *     approach 'ascending'  : mean vz over the last 2 s  > +5 m/s
 *   speed 'slow' : speed (cells/s) at the moment of entering the radius < 2.2
 *   speed 'fast' : max speed over the last 0.5 s before/at entry       > 6
 *   dwell        : seconds continuously still (< 0.3 cells/s) while inside the radius
 *   climb        : upward INDEX-contour crossings since the last downward index crossing (tracked by sim)
 *   time         : state.phase === condition.time
 *   requires     : a resonance of that POI type is active
 * The held thread: a full fire of a gate-chain type renews every other chain-type resonance still sounding
 * (the poi event carries `renewed: [poiId]`). Non-chain artefacts never renew the thread.
 * Time conditions compare against the phase the sim passes in, which follows the level's season.
 * Arrival conditions (approach, speed, climb) are sampled once, on entering the radius.
 * Live conditions (dwell, time, requires) are re-evaluated every step while inside, so a POI that
 * fired partially can still fire full once e.g. the dwell is satisfied. A partial fires at most once
 * per entry.
 */
import { RESONANCE_SECONDS } from '../world/codes.js';

export const TRIGGER_RADIUS = 3;
export const LEAVE_RADIUS = 3.6;
export const DESCEND_VZ = -5;
export const ASCEND_VZ = 5;
export const SLOW_SPEED = 2.2;
export const FAST_SPEED = 6;
export const STILL_SPEED = 0.3;
export const APPROACH_WINDOW = 2;     // s, mean vz window
export const FAST_WINDOW = 0.5;       // s, max speed window
export const FULL_COOLDOWN = 20;
export const PARTIAL_COOLDOWN = 6;

/** Cell-centre coordinates of a (possibly integer) world position. */
export function centre(p) { return { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 }; }

/** Condition keys that are actually specified on `cond`. */
export function conditionKeys(cond) {
  const k = [];
  if (!cond) return k;
  if (cond.approach && cond.approach !== 'any') k.push('approach');
  if (cond.speed && cond.speed !== 'any') k.push('speed');
  if (cond.dwell > 0) k.push('dwell');
  if (cond.climb > 0) k.push('climb');
  if (cond.time) k.push('time');
  if (cond.requires) k.push('requires');
  return k;
}

/**
 * Evaluate a condition against a snapshot.
 * snap = { meanVz, speed, maxSpeed, dwell, climb, phase, resonating:(type)=>bool }
 * -> { quality, missing:[keys], total }
 */
export function evaluateCondition(cond, snap) {
  const keys = conditionKeys(cond);
  const missing = [];
  for (const k of keys) {
    let ok = true;
    switch (k) {
      case 'approach':
        ok = cond.approach === 'descending' ? snap.meanVz < DESCEND_VZ : snap.meanVz > ASCEND_VZ;
        break;
      case 'speed':
        ok = cond.speed === 'slow' ? snap.speed < SLOW_SPEED : snap.maxSpeed > FAST_SPEED;
        break;
      case 'dwell': ok = snap.dwell >= cond.dwell; break;
      case 'climb': ok = snap.climb >= cond.climb; break;
      case 'time': ok = snap.phase === cond.time; break;
      case 'requires': ok = !!snap.resonating(cond.requires); break;
    }
    if (!ok) missing.push(k);
  }
  const total = keys.length;
  return { quality: total === 0 ? 1 : (total - missing.length) / total, missing, total };
}

/** Ring buffer of recent (t, elevation, speed) samples. */
export class History {
  constructor(n = 256) {
    this.n = n; this.t = new Float64Array(n); this.e = new Float64Array(n); this.s = new Float64Array(n);
    this.head = 0; this.count = 0;
  }
  clear() { this.head = 0; this.count = 0; }
  push(t, elev, speed) {
    this.t[this.head] = t; this.e[this.head] = elev; this.s[this.head] = speed;
    this.head = (this.head + 1) % this.n; if (this.count < this.n) this.count++;
  }
  _at(back) { return (this.head - 1 - back + this.n * 2) % this.n; } // back=0 -> newest
  /** Mean vertical velocity (m/s) over the last `window` s; uses what exists (>= 0.2 s) else 0. */
  meanVz(window) {
    if (this.count < 2) return 0;
    const iNew = this._at(0), tNew = this.t[iNew];
    let iOld = iNew;
    for (let b = 1; b < this.count; b++) {
      iOld = this._at(b);
      if (tNew - this.t[iOld] >= window) break;
    }
    const span = tNew - this.t[iOld];
    if (span < 0.2) return 0;
    return (this.e[iNew] - this.e[iOld]) / span;
  }
  maxSpeed(window) {
    if (!this.count) return 0;
    const tNew = this.t[this._at(0)];
    let m = 0;
    for (let b = 0; b < this.count; b++) {
      const i = this._at(b);
      if (tNew - this.t[i] > window) break;
      if (this.s[i] > m) m = this.s[i];
    }
    return m;
  }
}

export class PoiSystem {
  /**
   * @param world  World (uses world.pois)
   * @param hooks  { onFire(poi, full, event), afterFire(poi, full, event, events) } optional.
   *               onFire runs before the resonance is added (annotate hint/note); afterFire runs after it
   *               (resonance state is final) and may push further events after the poi event.
   */
  constructor(world, hooks = {}) {
    this.world = world;
    this.hooks = hooks;
    this.pois = world.pois || [];
    this.centres = this.pois.map(centre);
    this.history = new History();
    this.resonance = [];          // [{poiId,type,t0,strength}]
    this.discovered = [];         // poi ids
    this.ps = this.pois.map(() => ({
      inside: false, enterT: 0, fullUntil: -1e9, partialUntil: -1e9, fullDone: false, partialDone: false,
      snap: { meanVz: 0, speed: 0, maxSpeed: 0, climb: 0 },
    }));
    this._types = new Set();
    this._resFn = (type) => this.isResonating(type);
  }

  isResonating(type) {
    for (const r of this.resonance) if (r.type === type) return true;
    return false;
  }
  resonatingTypes() {
    const out = [];
    for (const r of this.resonance) if (!out.includes(r.type)) out.push(r.type);
    return out;
  }

  /** Gate-chain types of this world (the held thread). */
  chainTypes() { return (this.world.gate && this.world.gate.chain) || []; }

  /**
   * Add (or refresh) a resonance. The held thread: when the artefact is of a gate-chain type, every other
   * chain-type resonance still sounding is renewed too (t0 = now, strength 1), so only each leg of the
   * chain has to fit inside RESONANCE_SECONDS. Non-chain artefacts renew only themselves.
   * Returns the poiIds that were renewed by the thread (not counting this one).
   */
  _addResonance(poi, t, events) {
    const before = this.resonatingTypes();
    let e = this.resonance.find((r) => r.poiId === poi.id);
    if (e) { e.t0 = t; e.strength = 1; } else { e = { poiId: poi.id, type: poi.type, t0: t, strength: 1 }; this.resonance.push(e); }
    const renewed = [];
    const chain = this.chainTypes();
    if (chain.includes(poi.type)) {
      for (const r of this.resonance) {
        if (r === e || !chain.includes(r.type)) continue;
        r.t0 = t; r.strength = 1; renewed.push(r.poiId);
      }
    }
    const after = this.resonatingTypes();
    if (after.length >= 2 && after.length > before.length) events.push({ type: 'chain', types: after });
    return renewed;
  }

  _fire(i, full, quality, missing, t, events) {
    const poi = this.pois[i];
    const st = this.ps[i];
    const ev = { type: 'poi', poi, full, quality, missing };
    if (full) {
      st.fullUntil = t + FULL_COOLDOWN; st.fullDone = true;
      if (!this.discovered.includes(poi.id)) this.discovered.push(poi.id);
    } else {
      st.partialUntil = t + PARTIAL_COOLDOWN; st.partialDone = true;
    }
    if (this.hooks.onFire) this.hooks.onFire(poi, full, ev);
    events.push(ev);
    if (full) ev.renewed = this._addResonance(poi, t, events);
    if (this.hooks.afterFire) this.hooks.afterFire(poi, full, ev, events);
  }

  /**
   * Per-step update. Call after the player has moved.
   * @param t  sim time (s) @param dt step
   * @param player the player (x,y,speed,still,elevation,climb) @param phase current dayPhase
   */
  update(t, dt, player, phase, events) {
    this.history.push(t, player.elevation, player.speed);

    // resonance decay / expiry
    for (let k = this.resonance.length - 1; k >= 0; k--) {
      const r = this.resonance[k];
      const s = 1 - (t - r.t0) / RESONANCE_SECONDS;
      if (s <= 0) {
        this.resonance.splice(k, 1);
        // contract's {type:'resonance-end', poiId, type} has a duplicate key; the POI type is `poiType`
        events.push({ type: 'resonance-end', poiId: r.poiId, poiType: r.type });
      } else r.strength = s;
    }

    for (let i = 0; i < this.pois.length; i++) {
      const st = this.ps[i];
      const c = this.centres[i];
      const d = Math.hypot(player.x - c.x, player.y - c.y);
      const cond = this.pois[i].condition || {};
      if (!st.inside) {
        if (d > TRIGGER_RADIUS) continue;
        // ---- entry: sample arrival conditions
        st.inside = true; st.enterT = t; st.fullDone = false; st.partialDone = false;
        st.snap.meanVz = this.history.meanVz(APPROACH_WINDOW);
        st.snap.speed = player.speed;
        st.snap.maxSpeed = Math.max(player.speed, this.history.maxSpeed(FAST_WINDOW));
        st.snap.climb = player.climb || 0;
        const r = this._eval(st, cond, player, phase, t);
        if (r.quality === 1) {
          if (t >= st.fullUntil) this._fire(i, true, 1, [], t, events);
        } else if (t >= st.fullUntil && t >= st.partialUntil) {
          this._fire(i, false, r.quality, r.missing, t, events);
        } else st.partialDone = true;
      } else if (d > LEAVE_RADIUS) {
        st.inside = false;
      } else if (!st.fullDone && t >= st.fullUntil) {
        const r = this._eval(st, cond, player, phase, t);
        if (r.quality === 1) this._fire(i, true, 1, [], t, events);
      }
    }
  }

  _eval(st, cond, player, phase, t) {
    return evaluateCondition(cond, {
      meanVz: st.snap.meanVz, speed: st.snap.speed, maxSpeed: st.snap.maxSpeed, climb: st.snap.climb,
      dwell: Math.min(player.still, t - st.enterT), phase, resonating: this._resFn,
    });
  }
}
