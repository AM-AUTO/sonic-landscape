// Explorability rules (docs/LEVELS.md §3), enforced on every level that declares `designVersion: 2`.
// Levels from the old brief are listed as a todo until they are rebuilt. The rules themselves live in
// src/world/design.js (also used by `node tools/check-level.mjs <id>`); they are unit-tested here on a
// synthetic sheet so the scaffold is proven before any v2 level exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER, MAP_SIZE as S, CELL_METERS } from '../src/world/codes.js';
import {
  DESIGN_RULES, checkLevel, checkPoiCount, checkSpread, checkGateDistance, requiredRoute, zonesCrossed, routeElevation,
} from '../src/world/design.js';

let LEVELS = [], buildWorld = null, loadError = null;
try {
  ({ LEVELS } = await import('../src/world/levels/index.js'));
  ({ buildWorld } = await import('../src/world/terrain.js'));
} catch (e) { loadError = e; }

// ------------------------------------------------------------------ synthetic sheet

/** A walkable S×S sheet: open moor rising west→east (100..900 m), a sea strip along the north edge. */
function synthWorld({ pois, spawn, gate, zones = [], sea = 0 }) {
  const height = new Float32Array(S * S), cover = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const wet = y < sea;
    height[i] = wet ? 0 : 100 + (800 * x) / (S - 1);
    cover[i] = wet ? COVER.DEEP : COVER.MOOR;
  }
  let minH = Infinity, maxH = -Infinity;
  for (const h of height) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
  const w = {
    level: null, size: S, cellMeters: CELL_METERS, scale: 1, height, cover, stream: new Uint8Array(S * S),
    contourInterval: 10, minH, maxH, zones,
    pois: pois.map((p) => ({ name: p.id, condition: {}, ...p, elevation: height[p.y * S + p.x] })),
    gate, spawn, features: { waterfalls: [], spotHeights: [], labels: [], paths: [] },
    heightAt(x, y) {
      x = Math.max(0, Math.min(S - 1, x)); y = Math.max(0, Math.min(S - 1, y));
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1), fx = x - x0, fy = y - y0;
      const a = height[y0 * S + x0], b = height[y0 * S + x1], c = height[y1 * S + x0], d = height[y1 * S + x1];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    },
    gradientAt(x, y) { return { gx: (w.heightAt(x + 0.5, y) - w.heightAt(x - 0.5, y)) / CELL_METERS, gy: (w.heightAt(x, y + 0.5) - w.heightAt(x, y - 0.5)) / CELL_METERS }; },
    slopeAt(x, y) { const g = w.gradientAt(x, y); return Math.hypot(g.gx, g.gy); },
    coverAt(x, y) { const cx = Math.floor(x), cy = Math.floor(y); return cx < 0 || cy < 0 || cx >= S || cy >= S ? COVER.CRAG : cover[cy * S + cx]; },
    passable(x, y) { const c = w.coverAt(x, y); return c !== COVER.CRAG && c !== COVER.DEEP; },
  };
  return w;
}

const f = (v) => Math.round(v * (S - 1));
/** A sheet built to the brief: 12 POIs over all nine cells, a 4-link chain zig-zagging across it. */
function goodSheet() {
  const pois = [
    { id: 'c1', type: 'lochan', x: f(0.15), y: f(0.45) },
    { id: 'c2', type: 'cairn', x: f(0.45), y: f(0.80) },
    { id: 'c3', type: 'trig', x: f(0.85), y: f(0.55) },
    { id: 'b1', type: 'bothy', x: f(0.50), y: f(0.50) },
    { id: 'b2', type: 'bothy', x: f(0.80), y: f(0.85) },
    { id: 'x1', type: 'stone', x: f(0.15), y: f(0.15) },
    { id: 'x2', type: 'stone', x: f(0.50), y: f(0.15) },
    { id: 'x3', type: 'waterfall', x: f(0.85), y: f(0.15) },
    { id: 'x4', type: 'crag', x: f(0.15), y: f(0.85) },
    { id: 'x5', type: 'summit', x: f(0.60), y: f(0.30) },
    { id: 'x6', type: 'stone', x: f(0.30), y: f(0.60) },
    { id: 'x7', type: 'stone', x: f(0.70), y: f(0.70) },
  ];
  const zones = [
    { id: 'west', name: 'the west', x: f(0.15), y: f(0.3), r: 60 },
    { id: 'south', name: 'the south', x: f(0.45), y: f(0.85), r: 50 },
    { id: 'east', name: 'the east', x: f(0.85), y: f(0.55), r: 50 },
    { id: 'north', name: 'the north', x: f(0.9), y: f(0.15), r: 45 },
    { id: 'corner', name: 'nowhere', x: f(0.05), y: f(0.95), r: 15 },
  ];
  return synthWorld({ pois, zones, spawn: { x: f(0.1), y: f(0.03) }, gate: { x: S - 1, y: f(0.1), chain: ['lochan', 'cairn', 'trig'], name: 'Gate', side: 'E' } });
}

test('design rules: a sheet built to the brief passes every rule', () => {
  const w = goodSheet();
  const { rules, route, pass } = checkLevel(w, { id: 'synth' });
  const failing = rules.filter((r) => !r.pass).map((r) => `${r.id}: ${r.value} (${r.detail})`);
  assert.ok(pass, 'failing: ' + failing.join(' | '));
  assert.deepEqual(rules.map((r) => r.id), ['pois', 'spread', 'gate', 'legs', 'route', 'elevation', 'zones']);
  assert.deepEqual(route.order, ['c1', 'c2', 'c3']);
  assert.deepEqual(route.legs.map((l) => l.from + '>' + l.to), ['spawn>c1', 'c1>c2', 'c2>c3', 'c3>gate']);
  for (const l of route.legs) {
    assert.ok(l.straight >= DESIGN_RULES.legMin && l.straight <= DESIGN_RULES.legMax, `${l.to}: ${l.straight}`);
    assert.ok(l.dist >= l.straight - 1, 'walked ≥ straight');
  }
  assert.ok(route.length >= DESIGN_RULES.routeMin);
  assert.deepEqual(zonesCrossed(w, null, route).sort(), ['east', 'north', 'south', 'west']);
  const e = routeElevation(w, route);
  assert.ok(e.frac > 0.6 && e.lo < 200 && e.hi > 880, JSON.stringify(e));
});

test('design rules: each rule fails for the thing it guards', () => {
  const w = goodSheet();
  // POI count and bothies
  assert.equal(checkPoiCount({ ...w, pois: w.pois.slice(0, 9) }).pass, false);
  assert.equal(checkPoiCount({ ...w, pois: w.pois.filter((p) => p.id !== 'b2') }).pass, false, 'one bothy');
  // spread: drop the north-east POI -> its cell is empty...
  const noNE = { ...w, pois: w.pois.filter((p) => p.id !== 'x3') };
  const sp = checkSpread(noNE);
  assert.equal(sp.pass, false);
  assert.match(sp.detail, /\(2,0\)/);
  // ...unless that cell is mostly sea
  const seaNorth = synthWorld({ pois: noNE.pois, spawn: { x: 40, y: 200 }, gate: w.gate, sea: Math.ceil(S / 3) });
  const sp2 = checkSpread(seaNorth);
  assert.ok(sp2.cells.find((c) => c.cx === 2 && c.cy === 0).water > 0.5);
  assert.equal(sp2.cells.filter((c) => c.pois === 0 && c.water <= 0.5).length, 0);
  // gate distance
  assert.equal(checkGateDistance({ ...w, gate: { ...w.gate, x: w.spawn.x + 150, y: w.spawn.y } }).pass, false);
  // a clustered chain: short legs, short route, little height, few zones
  const tight = synthWorld({
    pois: w.pois.map((p) => (p.id === 'c1' ? { ...p, x: 60, y: 60 } : p.id === 'c2' ? { ...p, x: 80, y: 90 } : p.id === 'c3' ? { ...p, x: 110, y: 70 } : p)),
    zones: w.zones, spawn: { x: 40, y: 40 }, gate: { x: 0, y: 120, chain: ['lochan', 'cairn', 'trig'], name: 'G', side: 'W' },
  });
  const res = checkLevel(tight, { id: 'tight' });
  const byId = Object.fromEntries(res.rules.map((r) => [r.id, r]));
  assert.equal(res.pass, false);
  for (const id of ['gate', 'legs', 'route', 'elevation', 'zones']) assert.equal(byId[id].pass, false, id + ' should fail: ' + byId[id].value);
  assert.equal(byId.pois.pass, true);
  // zones: declared count is part of the rule
  const few = checkLevel({ ...w, zones: w.zones.slice(0, 3) }, { id: 'few' }, { route: requiredRoute(w, {}).waypoints });
  assert.equal(few.rules.find((r) => r.id === 'zones').pass, false);
});

// ------------------------------------------------------------------ the album

test('levels module loads', { skip: loadError ? 'levels/terrain not available: ' + loadError.message : false }, () => {
  assert.ok(LEVELS.length >= 1);
});

if (!loadError) {
  const v2 = LEVELS.filter((l) => l.designVersion === 2);
  const old = LEVELS.filter((l) => l.designVersion !== 2);
  if (old.length) {
    test(`explorability rules for old-brief levels (${old.map((l) => l.id).join(', ')})`,
      { todo: `not yet rebuilt to docs/LEVELS.md (no designVersion: 2): ${old.map((l) => l.id).join(', ')}` }, () => {});
  }
  for (const level of v2) {
    test(`${level.id}: explorability rules (docs/LEVELS.md §3)`, () => {
      const world = buildWorld(level);
      const { rules, route } = checkLevel(world, level);
      const failing = rules.filter((r) => !r.pass);
      const report = rules.map((r) => `${r.pass ? 'pass' : 'FAIL'} ${r.label}: ${r.value} [want ${r.want}]${r.detail ? ' ' + r.detail : ''}`).join('\n    ');
      assert.equal(failing.length, 0, `${level.id}:\n    ${report}\n    legs: ${route.legs.map((l) => `${l.from}>${l.to} ${l.straight.toFixed(0)}c ${l.time.toFixed(0)}s`).join(', ')}`);
      assert.deepEqual(route.warnings, [], 'planner warnings');
    });
  }
}
