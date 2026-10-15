/**
 * Explorability rules for level design (docs/LEVELS.md §3). Pure functions over a built World, so a level
 * builder can check a sheet from the CLI (`node tools/check-level.mjs <id>`) and tests/level-design.test.js
 * can enforce them on every level that declares `designVersion: 2`.
 *
 *   const route = requiredRoute(world, level);   // planner order, legs, walked A* paths
 *   const rules = checkLevel(world, level);       // [{ id, label, pass, value, want, detail }]
 *
 * Distances are in cells. Leg distance is straight-line between the leg's end points (spawn, each visited
 * artefact in the autopilot planner's order, gate); the required route length is the walked A* length of
 * the planner's route (approach detours included). Leg times are the planner's estimates (running at
 * PLAN_SPEED, plus rests for time-of-day conditions, approach run-ups and dwells).
 */
import { COVER } from './codes.js';
import { planChainRoute, findPath, pathLength } from '../game/autopilot.js';

export const DESIGN_RULES = Object.freeze({
  poiMin: 10, poiMax: 14, bothyMin: 2,
  spreadDiv: 3, seaFrac: 0.5,
  gateMin: 230,
  legMin: 90, legMax: 260, legTimeMax: 75,
  routeMin: 700,
  elevFrac: 0.6,
  zonesMin: 4, zonesDeclaredMin: 4, zonesDeclaredMax: 6,
});

const rule = (id, label, pass, value, want, detail = '') => ({ id, label, pass: !!pass, value, want, detail });
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

/** Zones in world cells: world.zones (scaled by buildWorld) or the level's own. */
export function zonesOf(world, level) {
  return (world && world.zones && world.zones.length ? world.zones : (level && level.zones)) || [];
}

/** POI count 10–14 with at least 2 bothies. */
export function checkPoiCount(world, R = DESIGN_RULES) {
  const n = world.pois.length, b = world.pois.filter((p) => p.type === 'bothy').length;
  return rule('pois', 'POIs per level (incl. bothies)', n >= R.poiMin && n <= R.poiMax && b >= R.bothyMin,
    `${n} POIs, ${b} bothies`, `${R.poiMin}–${R.poiMax}, ≥${R.bothyMin} bothies`);
}

/**
 * Each cell of a 3×3 division holds a POI, except cells that are mostly water (sea). Returns the rule plus
 * `cells`: [{ cx, cy, pois, water }] for diagnostics.
 */
export function checkSpread(world, R = DESIGN_RULES) {
  const S = world.size, D = R.spreadDiv, cells = [];
  for (let cy = 0; cy < D; cy++) for (let cx = 0; cx < D; cx++) {
    const x0 = Math.floor((cx * S) / D), x1 = Math.floor(((cx + 1) * S) / D), y0 = Math.floor((cy * S) / D), y1 = Math.floor(((cy + 1) * S) / D);
    let wet = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const c = world.cover[y * S + x];
      if (c === COVER.DEEP || c === COVER.SHALLOW) wet++;
    }
    const water = wet / ((x1 - x0) * (y1 - y0));
    const pois = world.pois.filter((p) => p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1).length;
    cells.push({ cx, cy, pois, water });
  }
  const empty = cells.filter((c) => c.pois === 0 && c.water <= R.seaFrac);
  const r = rule('spread', `Spread over a ${D}×${D} division`, empty.length === 0,
    `${cells.filter((c) => c.pois > 0).length}/${D * D} cells hold a POI`, 'every cell that is not mostly sea',
    empty.length ? 'empty: ' + empty.map((c) => `(${c.cx},${c.cy})`).join(' ') : '');
  r.cells = cells;
  return r;
}

/** Straight-line gate distance from spawn ≥ 230 cells. */
export function checkGateDistance(world, R = DESIGN_RULES) {
  const d = Math.hypot(world.gate.x - world.spawn.x, world.gate.y - world.spawn.y);
  return rule('gate', 'Gate distance from spawn', d >= R.gateMin, `${fmt(d)} cells`, `≥ ${R.gateMin}`);
}

/**
 * The required route: spawn → the planner's visiting order → gate. Returns
 * { order, legs: [{ from, to, type, straight, dist, time }], paths: [[{x,y}...]...], length, waypoints }.
 * `paths` are raw (unsmoothed) A* cell paths between consecutive moving waypoints.
 */
export function requiredRoute(world, level, opts = {}) {
  const wps = opts.route || planChainRoute(world, level);
  const at = (id) => (id === 'spawn' ? world.spawn : id === 'gate' ? world.gate : world.pois.find((p) => p.id === id));
  const legs = (wps.legs || []).map((l) => {
    const a = at(l.from), b = at(l.to);
    return { ...l, straight: a && b ? Math.hypot(b.x - a.x, b.y - a.y) : NaN };
  });
  const paths = [];
  let cur = { x: world.spawn.x + 0.5, y: world.spawn.y + 0.5 }, length = 0;
  for (const w of wps) {
    if (w.rest && !w.poiId) continue;  // rests stand still
    const p = findPath(world, cur, w, { smooth: false });
    if (p) { paths.push(p); length += pathLength(p); }
    cur = w;
  }
  return { order: wps.order || [], legs, paths, length, waypoints: wps, warnings: wps.warnings || [] };
}

/** Chain legs 90–260 cells straight-line, each with an estimated walk ≤ 75 s. */
export function checkLegs(route, R = DESIGN_RULES) {
  const bad = route.legs.filter((l) => !(l.straight >= R.legMin && l.straight <= R.legMax) || !(l.time <= R.legTimeMax));
  return rule('legs', 'Chain legs (distance and estimated time)', route.legs.length > 0 && bad.length === 0,
    route.legs.map((l) => `${l.to} ${fmt(l.straight)}c/${fmt(l.time)}s`).join(', '), `${R.legMin}–${R.legMax} cells, ≤ ${R.legTimeMax} s each`,
    bad.length ? 'failing: ' + bad.map((l) => `${l.from}→${l.to}`).join(' ') : '');
}

/** Required route ≥ 700 cells walked. */
export function checkRouteLength(route, R = DESIGN_RULES) {
  return rule('route', 'Required route length (walked)', route.length >= R.routeMin, `${fmt(route.length)} cells`, `≥ ${R.routeMin}`);
}

/** Heights sampled along the route's paths: min, max, and the share of the level's range covered. */
export function routeElevation(world, route) {
  let lo = Infinity, hi = -Infinity;
  for (const p of route.paths) for (const q of p) { const h = world.heightAt(q.x, q.y); if (h < lo) lo = h; if (h > hi) hi = h; }
  const range = world.maxH - world.minH;
  return { lo, hi, frac: range > 0 && hi >= lo ? (hi - lo) / range : 0 };
}

export function checkElevation(world, route, R = DESIGN_RULES) {
  const e = routeElevation(world, route);
  return rule('elevation', 'Elevation range covered by the route', e.frac >= R.elevFrac,
    `${Math.round(e.frac * 100)}% (${fmt(e.lo)}–${fmt(e.hi)} m of ${fmt(world.minH)}–${fmt(world.maxH)} m)`, `≥ ${Math.round(R.elevFrac * 100)}%`);
}

/** Zone ids whose circle the route's paths enter. */
export function zonesCrossed(world, level, route) {
  const zones = zonesOf(world, level), hit = new Set();
  for (const z of zones) {
    const r2 = z.r * z.r;
    outer: for (const p of route.paths) for (const q of p) {
      if ((q.x - z.x) ** 2 + (q.y - z.y) ** 2 <= r2) { hit.add(z.id); break outer; }
    }
  }
  return [...hit];
}

export function checkZones(world, level, route, R = DESIGN_RULES) {
  const zones = zonesOf(world, level), crossed = zonesCrossed(world, level, route);
  const declaredOk = zones.length >= R.zonesDeclaredMin && zones.length <= R.zonesDeclaredMax;
  return rule('zones', 'Sonic zones crossed by the route', declaredOk && crossed.length >= R.zonesMin,
    `${crossed.length} of ${zones.length} (${crossed.join(', ') || 'none'})`, `≥ ${R.zonesMin}; ${R.zonesDeclaredMin}–${R.zonesDeclaredMax} declared`,
    declaredOk ? '' : `level declares ${zones.length} zones`);
}

/** Every rule, in table order. `opts.route` reuses a planned route. Returns { rules, route, pass }. */
export function checkLevel(world, level, opts = {}) {
  const R = opts.rules || DESIGN_RULES;
  const route = requiredRoute(world, level, opts);
  const rules = [
    checkPoiCount(world, R),
    checkSpread(world, R),
    checkGateDistance(world, R),
    checkLegs(route, R),
    checkRouteLength(route, R),
    checkElevation(world, route, R),
    checkZones(world, level, route, R),
  ];
  return { rules, route, pass: rules.every((r) => r.pass) };
}
