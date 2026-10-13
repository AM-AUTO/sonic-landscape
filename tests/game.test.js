import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER, MAP_SIZE, CELL_METERS, GRID_CELLS, DAY_SECONDS, RESONANCE_SECONDS } from '../src/world/codes.js';
import { Rng } from '../src/core/rng.js';
import { Game } from '../src/game/sim.js';
import { createPlayer, stepPlayer, COVER_PHYS } from '../src/game/player.js';
import { evaluateCondition, PoiSystem, History } from '../src/game/pois.js';
import { serialize, deserialize, createProgress } from '../src/game/progression.js';
import { findPath, Autopilot, pathLength } from '../src/game/autopilot.js';

// ------------------------------------------------------------------ helpers

/** Synthetic World conforming to the World contract (heights sampled at integer cell coordinates). */
function makeTestWorld({
  heightFn = () => 100, coverFn = () => COVER.PATH, pois = [], gate = { x: 240, y: 128, chain: [], name: 'Test gate', side: 'E' },
  spawn = { x: 20, y: 128 }, contourInterval = 10, size = MAP_SIZE,
} = {}) {
  const height = new Float32Array(size * size);
  const cover = new Uint8Array(size * size);
  let minH = Infinity, maxH = -Infinity;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = heightFn(x, y);
    height[y * size + x] = h; cover[y * size + x] = coverFn(x, y);
    if (h < minH) minH = h; if (h > maxH) maxH = h;
  }
  const clampI = (v) => Math.max(0, Math.min(size - 1, v));
  const w = {
    level: null, size, cellMeters: CELL_METERS, height, cover, stream: new Uint8Array(size * size),
    contourInterval, minH, maxH,
    pois: pois.map((p) => ({ ...p, elevation: height[p.y * size + p.x] })),
    gate, spawn,
    features: { waterfalls: [], spotHeights: [], labels: [], paths: [] },
    heightAt(x, y) {
      const fx = Math.max(0, Math.min(size - 1, x)), fy = Math.max(0, Math.min(size - 1, y));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = clampI(x0 + 1), y1 = clampI(y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = height[y0 * size + x0], b = height[y0 * size + x1], c = height[y1 * size + x0], d = height[y1 * size + x1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    },
    gradientAt(x, y) {
      const e = 0.5;
      return {
        gx: (w.heightAt(x + e, y) - w.heightAt(x - e, y)) / (2 * e * CELL_METERS),
        gy: (w.heightAt(x, y + e) - w.heightAt(x, y - e)) / (2 * e * CELL_METERS),
      };
    },
    slopeAt(x, y) { const g = w.gradientAt(x, y); return Math.hypot(g.gx, g.gy); },
    coverAt(x, y) {
      const cx = Math.floor(x), cy = Math.floor(y);
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) return COVER.CRAG;
      return cover[cy * size + cx];
    },
    passable(x, y) { const c = w.coverAt(x, y); return c !== COVER.CRAG && c !== COVER.DEEP; },
  };
  return w;
}

const IDLE = { x: 0, y: 0, run: false, rest: false };

function mkLevel(id, index, world, extra = {}) {
  return { id, index, name: id, contourInterval: world.contourInterval ?? 10, fieldNotes: ['note A', 'note B', 'note C'], world, ...extra };
}
function mkGame(worldOpts, levelExtra = {}, n = 2) {
  const levels = [];
  for (let i = 0; i < n; i++) levels.push(mkLevel('L' + i, i, i === 0 ? worldOpts : {}, i === 0 ? levelExtra : {}));
  const game = new Game({ levels, buildWorld: (lv) => makeTestWorld(lv.world) });
  game.loadLevel(0);
  return game;
}
function run(game, input, seconds, collect) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) { game.step(input, 1 / 60); if (collect) for (const e of game.state.events) collect.push(e); }
}
function teleport(game, x, y) {
  const p = game.player, w = game.world;
  p.x = x; p.y = y; p.vx = p.vy = 0; p.speed = 0;
  p.elevation = w.heightAt(x, y); p._prevElev = p.elevation; p.vz = 0;
  p.contourIndex = Math.floor(p.elevation / w.contourInterval);
  p.cover = w.coverAt(x, y); p.climb = 0; p.still = 0;
  game._gx = Math.floor(x / GRID_CELLS); game._gy = Math.floor(y / GRID_CELLS);
  game.pois.history.clear();
  // leave any POI radius cleanly
  for (const st of game.pois.ps) st.inside = false;
}
function follow(game, wps, maxSeconds = 60, collect) {
  const ap = new Autopilot(game.world, wps);
  let t = 0;
  while (!ap.done && t < maxSeconds) {
    game.step(ap.input(game.state), 1 / 60); t += 1 / 60;
    if (collect) for (const e of game.state.events) collect.push(e);
  }
  return ap;
}
const poiEvents = (evs) => evs.filter((e) => e.type === 'poi');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

// ------------------------------------------------------------------ physics

test('flat-ground top speeds: walk ≈5, run ≈8.5 on path', () => {
  const g = mkGame({});
  run(g, { x: 1, y: 0, run: false, rest: false }, 3);
  near(g.player.speed, 5, 0.3, 'walk');
  teleport(g, 20, 128);
  run(g, { x: 1, y: 0, run: true, rest: false }, 3);
  near(g.player.speed, 8.5, 0.4, 'run');
  assert.ok(g.player.running);
});

test('accelerates to walk speed in ~0.25 s and stops in ~0.3 s on normal ground', () => {
  const g = mkGame({});
  run(g, { x: 1, y: 0, run: false, rest: false }, 0.25);
  assert.ok(g.player.speed > 4.2, 'speed after 0.25s ' + g.player.speed);
  run(g, IDLE, 0.3);
  assert.ok(g.player.speed < 0.4, 'speed 0.3s after release ' + g.player.speed);
  // scree/snow glide longer
  const gs = mkGame({ coverFn: () => COVER.SCREE });
  run(gs, { x: 1, y: 0, run: false, rest: false }, 2);
  run(gs, IDLE, 0.3);
  assert.ok(gs.player.speed > 0.8, 'scree should glide, got ' + gs.player.speed);
});

test('moor / wood / bog are slower than path; bog is slowest', () => {
  const sp = {};
  for (const [name, c] of [['path', COVER.PATH], ['moor', COVER.MOOR], ['wood', COVER.WOOD], ['bog', COVER.BOG], ['shallow', COVER.SHALLOW]]) {
    const g = mkGame({ coverFn: () => c });
    run(g, { x: 1, y: 0, run: false, rest: false }, 2);
    sp[name] = g.player.speed;
  }
  assert.ok(sp.path > sp.moor && sp.moor > sp.bog, JSON.stringify(sp));
  assert.ok(sp.wood < sp.path && sp.wood > sp.bog, JSON.stringify(sp));
  assert.ok(sp.shallow < sp.moor, JSON.stringify(sp));
});

test('uphill is noticeably slower than flat, downhill faster', () => {
  const slope = { heightFn: (x) => 3000 + 20 * x, coverFn: () => COVER.MOOR, spawn: { x: 128, y: 128 } }; // slope 0.5
  const flat = mkGame({ coverFn: () => COVER.MOOR });
  run(flat, { x: 1, y: 0, run: false, rest: false }, 2);
  const up = mkGame(slope);
  run(up, { x: 1, y: 0, run: false, rest: false }, 2);
  const down = mkGame(slope);
  run(down, { x: -1, y: 0, run: false, rest: false }, 2);
  assert.ok(up.player.speed < flat.player.speed * 0.85, `up ${up.player.speed} flat ${flat.player.speed}`);
  assert.ok(down.player.speed > flat.player.speed * 1.15, `down ${down.player.speed} flat ${flat.player.speed}`);
  assert.ok(up.player.vz > 0 && down.player.vz < 0, `vz up ${up.player.vz} down ${down.player.vz}`);
});

test('standing still on a moor hillside does not drift', () => {
  const g = mkGame({ heightFn: (x) => 3000 + 20 * x, coverFn: () => COVER.MOOR, spawn: { x: 128, y: 128 } });
  run(g, IDLE, 3);
  assert.ok(g.player.speed < 0.05);
});

test('scree: slides downhill with slide events; moor does not', () => {
  const sc = mkGame({ heightFn: (x) => 3000 - 24 * x, coverFn: () => COVER.SCREE, spawn: { x: 60, y: 128 } }); // downhill east, slope .6
  const evs = [];
  run(sc, IDLE, 2, evs);
  assert.ok(sc.player.sliding, 'should be sliding');
  assert.ok(sc.player.speed > 3 && sc.player.vx > 0);
  assert.ok(evs.some((e) => e.type === 'slide-start'));
  // flatten out -> slide ends
  const flat = mkGame({ coverFn: () => COVER.SCREE });
  run(flat, { x: 1, y: 0, run: false, rest: false }, 2);
  assert.equal(flat.player.sliding, false);
  const mo = mkGame({ heightFn: (x) => 3000 - 24 * x, coverFn: () => COVER.MOOR, spawn: { x: 60, y: 128 } });
  run(mo, { x: 1, y: 0, run: false, rest: false }, 2);
  assert.equal(mo.player.sliding, false);
});

test('scree slide ends (slide-end) when ground levels out', () => {
  const g = mkGame({ heightFn: (x) => (x < 90 ? 3000 - 24 * x : 3000 - 24 * 90), coverFn: () => COVER.SCREE, spawn: { x: 60, y: 128 } });
  const evs = [];
  run(g, IDLE, 16, evs);
  assert.ok(evs.some((e) => e.type === 'slide-start') && evs.some((e) => e.type === 'slide-end'));
});

test('max speed is clamped', () => {
  const g = mkGame({ heightFn: (x) => 9000 - 80 * x, coverFn: () => COVER.SCREE, spawn: { x: 10, y: 128 } }); // slope 2
  let mx = 0;
  for (let i = 0; i < 600; i++) { g.step({ x: 1, y: 0, run: true, rest: false }, 1 / 60); mx = Math.max(mx, g.player.speed); }
  assert.ok(mx <= 14.0001, 'max ' + mx);
});

test('collision: walls stop the player, who slides along them; never tunnels; stays on map', () => {
  const wall = { coverFn: (x, y) => ((x === 100 || x === 101) && (y < 120 || y > 130) ? COVER.CRAG : COVER.PATH), spawn: { x: 90, y: 60 } };
  const g = mkGame(wall);
  // run diagonally (south-east) into the wall: x blocked, y keeps going
  let maxX = 0;
  for (let i = 0; i < 240; i++) { g.step({ x: 1, y: 1, run: true, rest: false }, 1 / 60); maxX = Math.max(maxX, g.player.x); }
  assert.ok(maxX < 100 - 0.3 + 1e-6, 'x ' + maxX);
  assert.ok(g.player.y > 75, 'should have slid south along the wall, y=' + g.player.y);
  // through the gap at y 120..130 then run east to the map edge
  teleport(g, 95, 125);
  for (let i = 0; i < 1200; i++) g.step({ x: 1, y: 0, run: true, rest: false }, 1 / 60);
  assert.ok(g.player.x > 200, 'passed the gap, x=' + g.player.x);
  assert.ok(g.player.x < MAP_SIZE - 0.3 + 1e-6, 'x=' + g.player.x);
});

test('collision: huge velocity against a 1-cell wall never tunnels', () => {
  const g = mkGame({ coverFn: (x) => (x === 100 ? COVER.CRAG : COVER.PATH), heightFn: (x) => 9000 - 80 * x, spawn: { x: 80, y: 128 } });
  for (let i = 0; i < 600; i++) { g.step({ x: 1, y: 0, run: true, rest: false }, 1 / 60); assert.ok(g.player.x < 100); }
});

test('map edges are walls', () => {
  const g = mkGame({ spawn: { x: 5, y: 5 } });
  for (let i = 0; i < 300; i++) g.step({ x: -1, y: -1, run: true, rest: false }, 1 / 60);
  assert.ok(g.player.x >= 0.3 - 1e-6 && g.player.y >= 0.3 - 1e-6, `${g.player.x},${g.player.y}`);
  for (let i = 0; i < 900; i++) g.step({ x: 1, y: 1, run: true, rest: false }, 1 / 60);
  assert.ok(g.player.x <= MAP_SIZE - 0.3 + 1e-6 && g.player.y <= MAP_SIZE - 0.3 + 1e-6);
});

test('10k random-input steps: no NaN, always on passable ground, bounded speed', () => {
  const noise = (x, y) => 400 + 120 * Math.sin(x * 0.05) * Math.cos(y * 0.07) + 40 * Math.sin(x * 0.31 + y * 0.17);
  const cov = (x, y) => {
    const v = (Math.sin(x * 0.13) + Math.cos(y * 0.11) + Math.sin((x + y) * 0.21));
    if (v > 2.2) return COVER.CRAG; if (v > 1.7) return COVER.SCREE; if (v > 1.2) return COVER.SHALLOW;
    if (v < -2) return COVER.DEEP; if (v < -1.5) return COVER.BOG; if (v < -1) return COVER.WOOD; if (v < -0.4) return COVER.SNOW; return COVER.MOOR;
  };
  const g = mkGame({ heightFn: noise, coverFn: cov, spawn: { x: 128, y: 128 } });
  const rng = new Rng(42);
  let inp = IDLE;
  for (let i = 0; i < 10000; i++) {
    if (i % 20 === 0) inp = { x: rng.range(-1.2, 1.2), y: rng.range(-1.2, 1.2), run: rng.chance(0.4), rest: rng.chance(0.1) };
    g.step(inp, 1 / 60);
    const p = g.player;
    for (const k of ['x', 'y', 'vx', 'vy', 'speed', 'elevation', 'vz', 'slope', 'heading']) assert.ok(Number.isFinite(p[k]), `${k} @${i}`);
    assert.ok(p.speed <= 14.0001);
    assert.ok(p.x >= 0 && p.x < MAP_SIZE && p.y >= 0 && p.y < MAP_SIZE);
    assert.ok(g.world.passable(Math.floor(p.x), Math.floor(p.y)), 'on impassable ground @' + i);
    assert.ok(Number.isFinite(g.state.timeOfDay));
  }
});

test('heading is retained when stopped; moving/still timers', () => {
  const g = mkGame({});
  run(g, { x: 0, y: 1, run: false, rest: false }, 1);
  near(g.player.heading, Math.PI / 2, 0.05);
  run(g, { x: -1, y: 0, run: false, rest: false }, 1);
  near(Math.abs(g.player.heading), Math.PI, 0.05);
  run(g, IDLE, 1.5);
  near(Math.abs(g.player.heading), Math.PI, 0.05);
  assert.equal(g.player.moving, false);
  assert.ok(g.player.still > 1.0 && g.player.still < 1.5);
});

test('footsteps alternate foot at a sensible cadence; splash in shallow water', () => {
  const g = mkGame({});
  const evs = [];
  run(g, { x: 1, y: 0, run: false, rest: false }, 4, evs);
  const steps = evs.filter((e) => e.type === 'step');
  assert.ok(steps.length > 8 && steps.length < 4 * 5 / 1.0, 'steps ' + steps.length);
  for (let i = 1; i < steps.length; i++) assert.notEqual(steps[i].foot, steps[i - 1].foot);
  const w = mkGame({ coverFn: (x) => (x > 28 ? COVER.SHALLOW : COVER.PATH) });
  const e2 = [];
  run(w, { x: 1, y: 0, run: false, rest: false }, 3, e2);
  assert.ok(e2.some((e) => e.type === 'splash'));
  assert.ok(e2.some((e) => e.type === 'cover' && e.to === COVER.SHALLOW && e.from === COVER.PATH));
});

// ------------------------------------------------------------------ contours & grid

test('contour events: indices, direction, major flag (up and down)', () => {
  // 5 m per cell, interval 10 -> a contour every 2 cells; index (major) lines every 10 cells
  const g = mkGame({ heightFn: (x) => 5 * x, coverFn: () => COVER.PATH, spawn: { x: 20, y: 128 } });
  const up = [];
  run(g, { x: 1, y: 0, run: false, rest: false }, 6, up);
  const ce = up.filter((e) => e.type === 'contour');
  assert.ok(ce.length > 6);
  ce.forEach((e, i) => {
    assert.equal(e.dir, 1);
    if (i) assert.equal(e.index, ce[i - 1].index + 1);
    assert.equal(e.major, e.index % 5 === 0);
    assert.ok(Number.isFinite(e.elevation) && e.speed > 0);
    assert.ok(e.elevation >= e.index * 10 - 1e-6, 'crossed up past the line');
  });
  assert.ok(ce.some((e) => e.major) && ce.some((e) => !e.major));
  const top = g.player.contourIndex;
  const down = [];
  run(g, { x: -1, y: 0, run: false, rest: false }, 6, down);
  const de = down.filter((e) => e.type === 'contour');
  assert.ok(de.length > 6);
  de.forEach((e, i) => {
    assert.equal(e.dir, -1);
    if (i === 0) assert.equal(e.index, top); // going down from i to i-1 crosses line i
    else assert.equal(e.index, de[i - 1].index - 1);
    assert.equal(e.major, e.index % 5 === 0);
    assert.ok(e.elevation < e.index * 10 + 1e-6, 'crossed down below the line');
  });
});

test('contour events: several lines in one step each get an event', () => {
  const g = mkGame({ heightFn: (x) => 30 * x, contourInterval: 1, coverFn: () => COVER.PATH, spawn: { x: 20, y: 128 } }); // 30 lines per cell
  const evs = [];
  run(g, { x: 1, y: 0, run: false, rest: false }, 1, evs);
  const ce = evs.filter((e) => e.type === 'contour');
  // contourIndex now vs initial
  assert.equal(ce.length, g.player.contourIndex - Math.floor(30 * 20.5));
  assert.ok(ce.length > 30);
  for (let i = 1; i < ce.length; i++) assert.equal(ce[i].index, ce[i - 1].index + 1);
});

test('player.climb counts upward index crossings and resets on a downward one', () => {
  const g = mkGame({ heightFn: (x) => 10 * x, coverFn: () => COVER.PATH, spawn: { x: 20, y: 128 } }); // index line every 5 cells
  run(g, { x: 1, y: 0, run: false, rest: false }, 3);
  const c1 = g.player.climb;
  assert.ok(c1 >= 2, 'climb ' + c1);
  run(g, { x: -1, y: 0, run: false, rest: false }, 1.5);
  assert.ok(g.player.climb < c1);
  run(g, { x: -1, y: 0, run: false, rest: false }, 1.5);
  assert.equal(g.player.climb, 0);
});

test('grid events: crossing 25-cell lines, major at multiples of 5', () => {
  const g = mkGame({ spawn: { x: 20, y: 20 } });
  const ex = [];
  run(g, { x: 1, y: 0, run: true, rest: false }, 13, ex);
  const gx = ex.filter((e) => e.type === 'grid' && e.axis === 'x');
  assert.deepEqual(gx.map((e) => e.line), [1, 2, 3, 4, 5]);
  assert.deepEqual(gx.map((e) => e.major), [false, false, false, false, true]);
  assert.equal(gx[0].gx, 1);
  assert.equal(gx[0].gy, 0);
  const back = [];
  run(g, { x: -1, y: 0, run: true, rest: false }, 2, back);
  const bx = back.filter((e) => e.type === 'grid');
  assert.equal(bx[0].line, 5); // crossing back west over line 5
  assert.equal(bx[0].major, true);
  // y axis
  const ey = [];
  teleport(g, 100, 20);
  run(g, { x: 0, y: 1, run: false, rest: false }, 6, ey);
  const gy = ey.filter((e) => e.type === 'grid' && e.axis === 'y');
  assert.ok(gy.length >= 1 && gy[0].line === 1 && gy[0].gy === 1);
});

// ------------------------------------------------------------------ conditions

const baseCond = {};
const snap = (o = {}) => ({ meanVz: 0, speed: 0, maxSpeed: 0, dwell: 0, climb: 0, phase: 'dawn', resonating: () => false, ...o });

test('evaluateCondition: each kind, quality and missing', () => {
  assert.deepEqual(evaluateCondition({}, snap()), { quality: 1, missing: [], total: 0 });
  assert.equal(evaluateCondition({ approach: 'descending' }, snap({ meanVz: -9 })).quality, 1);
  assert.deepEqual(evaluateCondition({ approach: 'descending' }, snap({ meanVz: -2 })).missing, ['approach']);
  assert.equal(evaluateCondition({ approach: 'ascending' }, snap({ meanVz: 9 })).quality, 1);
  assert.equal(evaluateCondition({ approach: 'ascending' }, snap({ meanVz: -9 })).quality, 0);
  assert.equal(evaluateCondition({ approach: 'any' }, snap()).quality, 1);
  assert.equal(evaluateCondition({ speed: 'slow' }, snap({ speed: 2.1 })).quality, 1);
  assert.equal(evaluateCondition({ speed: 'slow' }, snap({ speed: 2.3 })).quality, 0);
  assert.equal(evaluateCondition({ speed: 'fast' }, snap({ maxSpeed: 6.5 })).quality, 1);
  assert.equal(evaluateCondition({ speed: 'fast' }, snap({ maxSpeed: 5.5 })).quality, 0);
  assert.equal(evaluateCondition({ dwell: 5 }, snap({ dwell: 5 })).quality, 1);
  assert.equal(evaluateCondition({ dwell: 5 }, snap({ dwell: 4.9 })).quality, 0);
  assert.equal(evaluateCondition({ climb: 2 }, snap({ climb: 2 })).quality, 1);
  assert.equal(evaluateCondition({ climb: 2 }, snap({ climb: 1 })).quality, 0);
  assert.equal(evaluateCondition({ time: 'night' }, snap({ phase: 'night' })).quality, 1);
  assert.equal(evaluateCondition({ time: 'night' }, snap({ phase: 'day' })).quality, 0);
  assert.equal(evaluateCondition({ requires: 'trig' }, snap({ resonating: (t) => t === 'trig' })).quality, 1);
  assert.equal(evaluateCondition({ requires: 'trig' }, snap()).quality, 0);
  const r = evaluateCondition({ speed: 'slow', dwell: 3, time: 'dusk', climb: 1 }, snap({ speed: 1, dwell: 0, phase: 'dusk', climb: 0 }));
  assert.equal(r.quality, 0.5);
  assert.deepEqual(r.missing, ['dwell', 'climb']);
});

test('History.meanVz / maxSpeed', () => {
  const h = new History();
  for (let i = 0; i < 300; i++) h.push(i / 60, 100 - i * 0.1, i < 290 ? 2 : 7);
  near(h.meanVz(2), -6, 0.05); // 0.1 m per 1/60 s = 6 m/s down
  assert.equal(h.maxSpeed(0.5), 7);
  assert.equal(h.maxSpeed(0.05) , 7);
});

const flatPois = (extra = []) => ([
  { id: 'p1', type: 'cairn', name: 'Cairn', x: 100, y: 128, condition: {} },
  ...extra,
]);

test('POI with empty condition fires full on entering radius 3; discovered; resonance added', () => {
  const g = mkGame({ pois: flatPois(), spawn: { x: 80, y: 128 } });
  const evs = [];
  follow(g, [{ x: 100.5, y: 128.5, mode: 'walk' }], 30, evs);
  const pe = poiEvents(evs);
  assert.equal(pe.length, 1);
  assert.equal(pe[0].full, true); assert.equal(pe[0].quality, 1); assert.deepEqual(pe[0].missing, []);
  assert.equal(pe[0].poi.id, 'p1');
  assert.deepEqual(g.state.discovered, ['p1']);
  assert.equal(g.state.resonance.length, 1);
  assert.equal(g.state.resonance[0].type, 'cairn');
  assert.equal(g.state.proximity[0].poi.id, 'p1');
  assert.ok(g.state.proximity[0].dist < 3);
});

test('speed fast: run-in is full, walk-in is partial; slow: creeping is full', () => {
  const pois = [{ id: 'f', type: 'crag', name: 'F', x: 100, y: 128, condition: { speed: 'fast' } }];
  const a = mkGame({ pois, spawn: { x: 80, y: 128 } });
  const ea = [];
  run(a, { x: 1, y: 0, run: true, rest: false }, 4, ea);
  assert.equal(poiEvents(ea)[0].full, true);
  const b = mkGame({ pois, spawn: { x: 80, y: 128 } });
  const eb = [];
  run(b, { x: 1, y: 0, run: false, rest: false }, 6, eb);
  const pb = poiEvents(eb);
  assert.equal(pb.length, 1);
  assert.equal(pb[0].full, false);
  assert.deepEqual(pb[0].missing, ['speed']);
  assert.equal(pb[0].quality, 0);
  const sPois = [{ id: 's', type: 'crag', name: 'S', x: 100, y: 128, condition: { speed: 'slow' } }];
  const c = mkGame({ pois: sPois, spawn: { x: 80, y: 128 } });
  const ec = [];
  run(c, { x: 0.3, y: 0, run: false, rest: false }, 20, ec);
  assert.equal(poiEvents(ec)[0].full, true);
  const d = mkGame({ pois: sPois, spawn: { x: 80, y: 128 } });
  const ed = [];
  run(d, { x: 1, y: 0, run: false, rest: false }, 6, ed);
  assert.equal(poiEvents(ed)[0].full, false);
});

test('approach descending/ascending uses mean vz over last 2 s', () => {
  const pois = [{ id: 'd', type: 'trig', name: 'D', x: 128, y: 128, condition: { approach: 'descending' } }];
  const hf = (x) => 3000 - 6 * x; // east is downhill, 0.15 slope
  const down = mkGame({ pois, heightFn: hf, spawn: { x: 100, y: 128 } });
  const e1 = [];
  run(down, { x: 1, y: 0, run: false, rest: false }, 10, e1);
  assert.equal(poiEvents(e1)[0].full, true);
  const up = mkGame({ pois, heightFn: hf, spawn: { x: 156, y: 128 } });
  const e2 = [];
  run(up, { x: -1, y: 0, run: false, rest: false }, 10, e2);
  const p2 = poiEvents(e2);
  assert.equal(p2[0].full, false);
  assert.deepEqual(p2[0].missing, ['approach']);
  const aPois = [{ id: 'a', type: 'trig', name: 'A', x: 128, y: 128, condition: { approach: 'ascending' } }];
  const asc = mkGame({ pois: aPois, heightFn: hf, spawn: { x: 156, y: 128 } });
  const e3 = [];
  run(asc, { x: -1, y: 0, run: false, rest: false }, 10, e3);
  assert.equal(poiEvents(e3)[0].full, true);
});

test('dwell: partial on arrival (once), then full once enough still time passes', () => {
  const pois = [{ id: 'w', type: 'stone', name: 'W', x: 100, y: 128, condition: { dwell: 4 }, hint: 'stay a while' }];
  const g = mkGame({ pois, spawn: { x: 90, y: 128 } });
  const evs = [];
  run(g, { x: 1, y: 0, run: false, rest: false }, 2.2, evs);
  run(g, IDLE, 2, evs);
  let pe = poiEvents(evs);
  assert.equal(pe.length, 1, 'only the partial so far');
  assert.equal(pe[0].full, false);
  assert.deepEqual(pe[0].missing, ['dwell']);
  assert.equal(pe[0].hint, 'stay a while');
  run(g, IDLE, 4, evs);
  pe = poiEvents(evs);
  assert.equal(pe.length, 2);
  assert.equal(pe[1].full, true);
  assert.equal(pe[1].hint, undefined);
  // standing longer does not re-fire
  run(g, IDLE, 30, evs);
  assert.equal(poiEvents(evs).length, 2);
});

test('dwell resets when the player moves inside the radius', () => {
  const pois = [{ id: 'w', type: 'stone', name: 'W', x: 100, y: 128, condition: { dwell: 3 } }];
  const g = mkGame({ pois, spawn: { x: 100, y: 128 } });
  const evs = [];
  run(g, IDLE, 2, evs); // partial at t≈0 (dwell 0)
  run(g, { x: 0.5, y: 0, run: false, rest: false }, 0.5, evs); // shuffle
  run(g, IDLE, 2, evs);
  assert.equal(poiEvents(evs).filter((e) => e.full).length, 0);
  run(g, IDLE, 1.5, evs);
  assert.equal(poiEvents(evs).filter((e) => e.full).length, 1);
});

test('climb: needs ≥N index-contour climbs before arrival', () => {
  // 10 m / cell; interval 10 -> index line (50 m) every 5 cells. POI at x=100 (h 1000).
  const pois = [{ id: 'c', type: 'summit', name: 'C', x: 100, y: 128, condition: { climb: 3 } }];
  const hf = (x) => 10 * x;
  const good = mkGame({ pois, heightFn: hf, spawn: { x: 70, y: 128 } });
  const e1 = [];
  run(good, { x: 1, y: 0, run: false, rest: false }, 8, e1);
  assert.equal(poiEvents(e1)[0].full, true);
  const bad = mkGame({ pois, heightFn: hf, spawn: { x: 90, y: 128 } });
  const e2 = [];
  run(bad, { x: 1, y: 0, run: false, rest: false }, 4, e2);
  const p2 = poiEvents(e2)[0];
  assert.equal(p2.full, false);
  assert.deepEqual(p2.missing, ['climb']);
  // a descent across an index line in between resets the count
  const reset = mkGame({ pois, heightFn: hf, spawn: { x: 70, y: 128 } });
  const e3 = [];
  run(reset, { x: 1, y: 0, run: false, rest: false }, 1.6, e3); // climbs a bit
  run(reset, { x: -1, y: 0, run: false, rest: false }, 1.6, e3); // back down, crossing lines downward
  run(reset, { x: 1, y: 0, run: false, rest: false }, 1.2, e3);
  run(reset, { x: 1, y: 0, run: false, rest: false }, 6, e3);
  assert.ok(poiEvents(e3).length >= 1);
});

test('time: matches the phase; startTime is a level option', () => {
  const pois = [{ id: 't', type: 'lochan', name: 'T', x: 100, y: 128, condition: { time: 'dusk' } }];
  const dusk = mkGame({ pois, spawn: { x: 90, y: 128 } }, { startTime: 0.55 });
  const e1 = [];
  run(dusk, { x: 1, y: 0, run: false, rest: false }, 4, e1);
  assert.equal(poiEvents(e1)[0].full, true);
  const dawn = mkGame({ pois, spawn: { x: 90, y: 128 } }); // default 0.05 = dawn
  assert.equal(dawn.state.phase, 'dawn');
  near(dawn.state.timeOfDay, 0.05, 1e-9);
  const e2 = [];
  run(dawn, { x: 1, y: 0, run: false, rest: false }, 2.2, e2);
  run(dawn, IDLE, 0.5, e2);
  assert.equal(poiEvents(e2)[0].full, false);
  assert.deepEqual(poiEvents(e2)[0].missing, ['time']);
  // standing there and resting: time races (x8) and the full fires once dusk arrives
  run(dawn, { x: 0, y: 0, run: false, rest: true }, 20.5, e2);
  const fulls = poiEvents(e2).filter((e) => e.full);
  assert.equal(fulls.length, 1);
  assert.equal(dawn.state.phase, 'dusk');
});

test('time of day advances 1/DAY_SECONDS per s, x8 while resting and still', () => {
  const g = mkGame({});
  const t0 = g.state.timeOfDay;
  run(g, IDLE, 36);
  near(g.state.timeOfDay - t0, 36 / DAY_SECONDS, 1e-6);
  const t1 = g.state.timeOfDay;
  run(g, { x: 0, y: 0, run: false, rest: true }, 10);
  near(g.state.timeOfDay - t1, (10 * 8) / DAY_SECONDS, 1e-6);
  assert.equal(g.player.resting, true);
  const t2 = g.state.timeOfDay;
  run(g, { x: 1, y: 0, run: false, rest: true }, 3); // moving: no speed-up
  near(g.state.timeOfDay - t2, 3 / DAY_SECONDS, 1.5 / DAY_SECONDS); // only the first few still frames run fast
  g.state.timeOfDay = 0.999;
  run(g, IDLE, 1);
  assert.ok(g.state.timeOfDay < 1 && g.state.timeOfDay >= 0);
});

test('requires: needs that artefact resonating; partial -> full after visiting it', () => {
  const pois = [
    { id: 'a', type: 'cairn', name: 'A', x: 60, y: 128, condition: {} },
    { id: 'b', type: 'trig', name: 'B', x: 100, y: 128, condition: { requires: 'cairn' } },
  ];
  const g = mkGame({ pois, spawn: { x: 90, y: 128 } });
  const evs = [];
  follow(g, [{ x: 100.5, y: 128.5 }, { x: 118.5, y: 128.5 }], 30, evs); // visit B first
  let pe = poiEvents(evs);
  assert.equal(pe[0].poi.id, 'b'); assert.equal(pe[0].full, false); assert.deepEqual(pe[0].missing, ['requires']);
  follow(g, [{ x: 60.5, y: 128.5 }], 30, evs); // now A
  pe = poiEvents(evs);
  assert.equal(pe.at(-1).poi.id, 'a'); assert.equal(pe.at(-1).full, true);
  follow(g, [{ x: 100.5, y: 128.5 }], 30, evs); // B again (after >6 s partial cooldown)
  pe = poiEvents(evs);
  assert.equal(pe.at(-1).poi.id, 'b'); assert.equal(pe.at(-1).full, true);
});

test('cooldowns: 20 s after full, 6 s after partial', () => {
  const pois = [{ id: 'c', type: 'cairn', name: 'C', x: 100, y: 128, condition: {} }];
  const g = mkGame({ pois, spawn: { x: 100, y: 128 } });
  const evs = [];
  run(g, IDLE, 0.1, evs); // full at once
  assert.equal(poiEvents(evs).length, 1);
  const hop = () => { teleport(g, 120, 128); run(g, IDLE, 0.2, evs); teleport(g, 100, 128); run(g, IDLE, 0.2, evs); };
  hop(); // ~0.5 s later: still cooling
  assert.equal(poiEvents(evs).length, 1);
  run(g, IDLE, 18, evs);
  hop(); // ~19 s
  assert.equal(poiEvents(evs).length, 1, 'still within 20 s');
  run(g, IDLE, 2, evs);
  hop(); // > 20 s
  assert.equal(poiEvents(evs).length, 2);
  // partial cooldown
  const pp = [{ id: 'p', type: 'crag', name: 'P', x: 100, y: 128, condition: { speed: 'fast' } }];
  const h = mkGame({ pois: pp, spawn: { x: 100, y: 128 } });
  const e2 = [];
  const hop2 = () => { teleport(h, 120, 128); run(h, IDLE, 0.1, e2); teleport(h, 100, 128); run(h, IDLE, 0.1, e2); };
  run(h, IDLE, 0.1, e2);
  assert.equal(poiEvents(e2).length, 1); assert.equal(poiEvents(e2)[0].full, false);
  hop2(); // 0.4 s: cooling
  assert.equal(poiEvents(e2).length, 1);
  run(h, IDLE, 6, e2);
  hop2();
  assert.equal(poiEvents(e2).length, 2);
});

test('bothy fires reveal the next field note; partial events carry the hint', () => {
  const pois = [{ id: 'b', type: 'bothy', name: 'B', x: 100, y: 128, condition: { dwell: 100 }, hint: 'a warm hearth' }];
  const g = mkGame({ pois, spawn: { x: 100, y: 128 } });
  const evs = [];
  run(g, IDLE, 0.2, evs);
  const pe = poiEvents(evs)[0];
  assert.equal(pe.full, false);
  assert.equal(pe.hint, 'a warm hearth');
  assert.equal(pe.note, 'note A');
  assert.deepEqual(g.progress.notes, ['note A']);
  teleport(g, 130, 128); run(g, IDLE, 0.2);
  run(g, IDLE, 6.1);
  teleport(g, 100, 128); run(g, IDLE, 0.2);
  assert.deepEqual(g.progress.notes, ['note A', 'note B']);
});

// ------------------------------------------------------------------ resonance, chain, gate

test('resonance strength decays 1→0 over RESONANCE_SECONDS, then resonance-end; retrigger refreshes', () => {
  const pois = [{ id: 'c', type: 'cairn', name: 'C', x: 100, y: 128, condition: {} }];
  const g = mkGame({ pois, spawn: { x: 100, y: 128 } });
  const evs = [];
  run(g, IDLE, 0.05, evs);
  near(g.state.resonance[0].strength, 1, 0.01);
  run(g, IDLE, RESONANCE_SECONDS / 2, evs);
  near(g.state.resonance[0].strength, 0.5, 0.02);
  // refresh: leave and re-enter after the 20 s cooldown
  teleport(g, 130, 128); run(g, IDLE, 0.1);
  teleport(g, 100, 128); run(g, IDLE, 0.1, evs);
  near(g.state.resonance[0].strength, 1, 0.01);
  assert.equal(g.state.resonance.length, 1);
  run(g, IDLE, RESONANCE_SECONDS + 1, evs);
  assert.equal(g.state.resonance.length, 0);
  const end = evs.filter((e) => e.type === 'resonance-end');
  assert.equal(end.length, 1);
  assert.equal(end[0].poiId, 'c'); assert.equal(end[0].poiType, 'cairn');
});

test('chain event when a second distinct type joins; not for refresh of the same one', () => {
  const pois = [
    { id: 'a', type: 'cairn', name: 'A', x: 60, y: 128, condition: {} },
    { id: 'b', type: 'trig', name: 'B', x: 100, y: 128, condition: {} },
  ];
  const g = mkGame({ pois, spawn: { x: 60, y: 128 } });
  const evs = [];
  run(g, IDLE, 0.1, evs);
  assert.equal(evs.filter((e) => e.type === 'chain').length, 0);
  follow(g, [{ x: 100.5, y: 128.5 }], 30, evs);
  const ch = evs.filter((e) => e.type === 'chain');
  assert.equal(ch.length, 1);
  assert.deepEqual(ch[0].types, ['cairn', 'trig']);
  // refresh A after cooldown -> set does not grow -> no new chain
  run(g, IDLE, 21, evs);
  follow(g, [{ x: 60.5, y: 128.5 }], 30, evs);
  assert.equal(evs.filter((e) => e.type === 'chain').length, 1);
});

const gateWorld = (chain) => ({
  pois: [
    { id: 'a', type: 'cairn', name: 'A', x: 60, y: 128, condition: {} },
    { id: 'b', type: 'trig', name: 'B', x: 100, y: 128, condition: {} },
  ],
  gate: { x: 200, y: 128, chain, name: 'Gate', side: 'E' },
  spawn: { x: 60, y: 128 },
});

test('gate opens only when ALL chain types resonate at once; latches; gate-open once', () => {
  const g = mkGame(gateWorld(['cairn', 'trig']));
  const evs = [];
  run(g, IDLE, 0.1, evs);                       // cairn
  assert.deepEqual(g.state.chainProgress.map((c) => ({ type: c.type, resonating: c.resonating })), [{ type: 'cairn', resonating: true }, { type: 'trig', resonating: false }]);
  assert.equal(g.state.gateOpen, false);
  run(g, IDLE, RESONANCE_SECONDS + 5, evs);     // cairn fades
  assert.deepEqual(g.state.chainProgress.map((c) => c.resonating), [false, false]);
  follow(g, [{ x: 100.5, y: 128.5 }], 30, evs);      // trig alone
  assert.equal(g.state.gateOpen, false);
  assert.equal(evs.filter((e) => e.type === 'gate-open').length, 0);
  follow(g, [{ x: 60.5, y: 128.5 }], 30, evs);      // cairn again within the trig's window
  assert.equal(g.state.gateOpen, true);
  assert.equal(evs.filter((e) => e.type === 'gate-open').length, 1);
  run(g, IDLE, RESONANCE_SECONDS + 10, evs);    // everything fades: gate stays open (latch)
  assert.equal(g.state.gateOpen, true);
  assert.equal(g.state.chainProgress.every((c) => !c.resonating), true);
  assert.equal(evs.filter((e) => e.type === 'gate-open').length, 1);
});

test('closed gate is a wall; open gate -> level-complete within 2 cells; progression unlocks next', () => {
  const g = mkGame(gateWorld(['cairn', 'trig']));
  const evs = [];
  // closed: walk into the gate cell from the west; stays out
  teleport(g, 190, 128.5);
  for (let i = 0; i < 400; i++) g.step({ x: 1, y: 0, run: true, rest: false }, 1 / 60);
  assert.ok(g.player.x < 200 - 0.3 + 1e-6, 'x=' + g.player.x);
  assert.equal(g.state.levelComplete, false);
  assert.deepEqual(g.progress.unlocked, ['L0']);
  // open the gate
  teleport(g, 60, 128); run(g, IDLE, 0.1, evs);
  follow(g, [{ x: 100.5, y: 128.5 }], 30, evs);
  assert.equal(g.state.gateOpen, true);
  assert.equal(g.state.levelComplete, false);
  follow(g, [{ x: 200.5, y: 128.5, mode: 'run' }], 40, evs);
  assert.equal(g.state.levelComplete, true);
  const lc = evs.filter((e) => e.type === 'level-complete');
  assert.equal(lc.length, 1); assert.equal(lc[0].levelId, 'L0');
  assert.deepEqual(g.progress.completed, ['L0']);
  assert.deepEqual(g.progress.fragments, ['L0']);
  assert.deepEqual(g.progress.unlocked, ['L0', 'L1']);
  assert.deepEqual(g.state.fragments, ['L0']);
  run(g, IDLE, 2, evs);
  assert.equal(evs.filter((e) => e.type === 'level-complete').length, 1);
});

test('progress: defaults, serialize/deserialize round trip, tolerant of garbage', () => {
  const levels = [{ id: 'a' }, { id: 'b' }];
  const p = createProgress(levels);
  assert.deepEqual(p, { unlocked: ['a'], completed: [], fragments: [], notes: [] });
  p.completed.push('a'); p.unlocked.push('b'); p.notes.push('hello');
  const q = deserialize(serialize(p), levels);
  assert.deepEqual(q, { unlocked: ['a', 'b'], completed: ['a'], fragments: [], notes: ['hello'] });
  assert.deepEqual(deserialize('not json{', levels), createProgress(levels));
  assert.deepEqual(deserialize('{"unlocked":["zzz"],"completed":5}', levels).unlocked, ['a']);
  const g = new Game({ levels, buildWorld: () => makeTestWorld({}) });
  assert.deepEqual(g.progress.unlocked, ['a']);
});

// ------------------------------------------------------------------ determinism & perf

test('determinism: identical inputs give identical states', () => {
  const mk = () => mkGame({
    heightFn: (x, y) => 300 + 80 * Math.sin(x * 0.04) + 60 * Math.cos(y * 0.05),
    coverFn: (x, y) => ((x * 7 + y * 13) % 11 === 0 ? COVER.BOG : COVER.MOOR),
    pois: flatPois(), spawn: { x: 90, y: 128 },
  });
  const a = mk(), b = mk();
  const rng = new Rng(7);
  const snaps = [[], []];
  let inp = IDLE;
  for (let i = 0; i < 3000; i++) {
    if (i % 25 === 0) inp = { x: rng.range(-1, 1), y: rng.range(-1, 1), run: rng.chance(0.3), rest: rng.chance(0.1) };
    for (const [k, g] of [a, b].entries()) {
      g.step(inp, 1 / 60);
      if (i % 50 === 0) {
        const s = g.state;
        snaps[k].push(JSON.stringify({ p: { ...s.player }, t: s.timeOfDay, e: s.events.map((e) => ({ ...e, poi: e.poi && e.poi.id })), r: s.resonance, pr: s.proximity.map((q) => [q.poi.id, q.dist]) }));
      }
    }
  }
  assert.deepEqual(snaps[0], snaps[1]);
});

test('step is cheap (< 0.2 ms average) and events array is fresh each step', () => {
  const g = mkGame({ pois: flatPois(), spawn: { x: 90, y: 128 } });
  const inp = { x: 1, y: 0.2, run: false, rest: false };
  for (let i = 0; i < 300; i++) g.step(inp, 1 / 60); // warm up
  teleport(g, 20, 128);
  const t0 = performance.now();
  const N = 3000;
  for (let i = 0; i < N; i++) { g.step(inp, 1 / 60); if (g.player.x > 230) teleport(g, 20, 128); }
  const per = (performance.now() - t0) / N;
  assert.ok(per < 0.2, `step took ${per.toFixed(4)} ms`);
  const e1 = g.state.events; g.step(inp, 1 / 60);
  assert.notEqual(e1, g.state.events);
});

test('GameState shape matches the contract', () => {
  const g = mkGame({ pois: flatPois(), spawn: { x: 90, y: 128 } });
  g.step(IDLE, 1 / 60);
  const s = g.state;
  for (const k of ['t', 'dt', 'levelIndex', 'level', 'world', 'player', 'timeOfDay', 'phase', 'events', 'proximity', 'resonance', 'gateOpen', 'chainProgress', 'fragments', 'discovered', 'levelComplete']) {
    assert.ok(k in s, 'missing ' + k);
  }
  for (const k of ['x', 'y', 'vx', 'vy', 'speed', 'heading', 'elevation', 'vz', 'slope', 'cover', 'moving', 'still', 'running', 'resting', 'sliding', 'contourIndex']) {
    assert.ok(k in s.player, 'missing player.' + k);
  }
  assert.ok(s.proximity.length <= 3);
  assert.equal(g.world, s.world);
  near(s.dt, 1 / 60, 1e-12);
});

// ------------------------------------------------------------------ pathfinding / autopilot

test('findPath: routes around walls, never cuts corners, returns null when sealed', () => {
  const w = makeTestWorld({ coverFn: (x, y) => (x === 100 && y < 200 ? COVER.CRAG : COVER.MOOR) });
  const path = findPath(w, { x: 90.5, y: 100.5 }, { x: 110.5, y: 100.5 });
  assert.ok(path && path.length >= 3);
  assert.ok(pathLength(path) > 20 + 40, 'must detour around the wall, len=' + pathLength(path));
  // every segment keeps clear of impassable cells
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1);
    for (let k = 0; k <= n; k++) assert.ok(w.passable(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  // diagonal gap between two crag cells that touch only at a corner: no corner cutting
  const d = makeTestWorld({ coverFn: (x, y) => (x === 50 && y === 50) || (x === 51 && y === 51) ? COVER.CRAG : COVER.MOOR });
  const dp = findPath(d, { x: 50.5, y: 51.5 }, { x: 51.5, y: 50.5 }, { smooth: false });
  assert.ok(dp && dp.length > 2, 'must go around, not squeeze through the diagonal');
  const sealed = makeTestWorld({ coverFn: (x, y) => (x >= 100 && x <= 101 ? COVER.CRAG : COVER.MOOR) });
  assert.equal(findPath(sealed, { x: 50.5, y: 50.5 }, { x: 150.5, y: 50.5 }), null);
});

test('findPath prefers paths over bog', () => {
  const w = makeTestWorld({ coverFn: (x, y) => (y === 100 && x > 50 && x < 150 ? COVER.BOG : y === 108 ? COVER.PATH : COVER.MOOR) });
  const p = findPath(w, { x: 40.5, y: 100.5 }, { x: 160.5, y: 100.5 });
  let bog = 0, tot = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5);
    for (let k = 0; k < n; k++) { tot++; if (w.coverAt(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n) === COVER.BOG) bog++; }
  }
  assert.ok(bog / tot < 0.15, `bog fraction ${bog / tot}`);
});

test('Autopilot: follows waypoints around walls; run mode; slow mode arrives < 2.2 cells/s; dwell; rest', () => {
  const g = mkGame({ coverFn: (x, y) => (x === 100 && y < 130 ? COVER.CRAG : COVER.MOOR), spawn: { x: 80.5, y: 100.5 } });
  const ap = follow(g, [{ x: 120.5, y: 100.5 }], 60);
  assert.ok(ap.done);
  assert.ok(Math.hypot(g.player.x - 120.5, g.player.y - 100.5) < 2);
  // slow mode: speed while approaching target
  const h = mkGame({ spawn: { x: 60.5, y: 100.5 } });
  const ap2 = new Autopilot(h.world, [{ x: 100.5, y: 100.5, mode: 'slow' }]);
  let maxNear = 0, t = 0;
  while (!ap2.done && t < 60) {
    h.step(ap2.input(h.state), 1 / 60); t += 1 / 60;
    if (Math.hypot(h.player.x - 100.5, h.player.y - 100.5) < 6) maxNear = Math.max(maxNear, h.player.speed);
  }
  assert.ok(ap2.done && maxNear < 2.2, 'slow arrival speed ' + maxNear);
  // run mode is faster than walk
  const r = mkGame({ spawn: { x: 30.5, y: 100.5 } });
  const w = mkGame({ spawn: { x: 30.5, y: 100.5 } });
  const ar = new Autopilot(r.world, [{ x: 130.5, y: 100.5, mode: 'run' }]);
  const aw = new Autopilot(w.world, [{ x: 130.5, y: 100.5, mode: 'walk' }]);
  let tr = 0, tw = 0;
  while (!ar.done && tr < 60) { r.step(ar.input(r.state), 1 / 60); tr += 1 / 60; }
  while (!aw.done && tw < 60) { w.step(aw.input(w.state), 1 / 60); tw += 1 / 60; }
  assert.ok(tr < tw * 0.75, `run ${tr} vs walk ${tw}`);
  // dwell + rest advances time
  const d = mkGame({ spawn: { x: 60.5, y: 100.5 } });
  const t0 = d.state.timeOfDay;
  const ad = new Autopilot(d.world, [{ x: 62.5, y: 100.5, dwell: 5, rest: true }]);
  let td = 0;
  while (!ad.done && td < 30) { d.step(ad.input(d.state), 1 / 60); td += 1 / 60; }
  assert.ok(ad.done && td > 5 && td < 8);
  assert.ok(d.state.timeOfDay - t0 > (4 * 8) / DAY_SECONDS, 'rest sped time up');
});

test('PoiSystem is usable standalone (direct API)', () => {
  const w = makeTestWorld({ pois: [{ id: 'c', type: 'cairn', name: 'C', x: 10, y: 10, condition: {} }] });
  const ps = new PoiSystem(w);
  const p = createPlayer(10.5, 10.5);
  p.elevation = 100;
  const evs = [];
  ps.update(0, 1 / 60, p, 'dawn', evs);
  assert.equal(poiEvents(evs).length, 1);
  assert.equal(ps.isResonating('cairn'), true);
});

// ------------------------------------------------------------------ input mapper (DOM-free smoke test)

test('createInput: keys -> normalised state, edge-triggered actions; touch stick', async () => {
  const { createInput } = await import('../src/game/input.js');
  const root = new EventTarget();
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const input = createInput(root);
  const key = (type, code, extra = {}) => { const e = new Event(type); Object.assign(e, { code, repeat: false, preventDefault() {}, ...extra }); root.dispatchEvent(e); };
  key('keydown', 'KeyD'); key('keydown', 'KeyS');
  let s = input.state();
  near(Math.hypot(s.x, s.y), 1, 1e-9, 'diagonal normalised');
  assert.ok(s.x > 0 && s.y > 0);
  key('keydown', 'ShiftLeft'); key('keydown', 'Space');
  s = input.state();
  assert.equal(s.run, true); assert.equal(s.rest, true);
  key('keyup', 'KeyD'); key('keyup', 'KeyS'); key('keyup', 'ShiftLeft'); key('keyup', 'Space');
  assert.deepEqual(input.state(), { x: 0, y: 0, run: false, rest: false });
  key('keydown', 'KeyM'); key('keydown', 'KeyL'); key('keydown', 'Escape'); key('keydown', 'Enter');
  const acts = input.consume();
  assert.deepEqual(acts.filter((a) => ['map', 'notes', 'pause', 'confirm'].includes(a)), ['map', 'notes', 'pause', 'confirm']);
  assert.deepEqual(input.consume(), []);
  // touch stick
  const ptr = (type, x, y, id = 1) => { const e = new Event(type); Object.assign(e, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y }); root.dispatchEvent(e); };
  ptr('pointerdown', 100, 450); ptr('pointermove', 100 + 56, 450);
  s = input.state();
  near(s.x, 1, 1e-6); near(s.y, 0, 1e-6);
  ptr('pointerup', 156, 450);
  assert.deepEqual(input.state(), { x: 0, y: 0, run: false, rest: false });
  input.dispose();
});

// ------------------------------------------------------------------ UX pass: knowledge, guidance, trail

const leaveAndReturn = (g, x, y, evs, wait = 6.1) => {
  teleport(g, x, y + 40); run(g, IDLE, wait, evs);
  teleport(g, x, y); run(g, IDLE, 0.2, evs);
};
const twoKeyPoi = [{ id: 'p', type: 'lochan', name: 'P', x: 100, y: 128, condition: { speed: 'slow', dwell: 100 }, hint: 'poetic' }];

test('knowledge: heard/woken counts; track 0 reveals every missing condition on the first partial', () => {
  const g = mkGame({ pois: twoKeyPoi, spawn: { x: 100, y: 128 } });
  const evs = [];
  run(g, IDLE, 0.2, evs);
  const e1 = poiEvents(evs)[0];
  assert.equal(e1.full, false);
  assert.deepEqual(e1.missing, ['dwell']);                // standing still: speed ok, dwell missing
  assert.deepEqual(e1.plain, ['Stand still beside it for 100 seconds.']);
  assert.deepEqual(e1.learnedNow, ['dwell']);
  assert.equal(e1.inChain, false); assert.equal(e1.keysTotal, 0); assert.equal(e1.keysSounding, 0);
  assert.deepEqual(g.state.knowledge.p, { heard: 1, woken: false, learned: ['dwell'] });
  assert.equal(g.state.knowledge, g.progress.knowledge.L0);
  // arriving fast on a second visit: both keys are missing, speed is newly learned
  const e2 = [];
  teleport(g, 60, 128); run(g, IDLE, 6.1);
  teleport(g, 96, 128);
  const fast = { x: 1, y: 0, run: true, rest: false };
  run(g, fast, 1, e2);
  const pe = poiEvents(e2)[0];
  assert.ok(pe && !pe.full);
  assert.deepEqual(pe.missing.sort(), ['dwell', 'speed']);
  assert.deepEqual(pe.learnedNow, ['speed']);
  assert.equal(pe.plain.length, 2);
  assert.equal(g.state.knowledge.p.heard, 2);
});

test('knowledge: other tracks show poetic hint first, plain text from the second partial', () => {
  const g = mkGame({ pois: twoKeyPoi, spawn: { x: 100, y: 128 } }, { index: 2 });
  const evs = [];
  run(g, IDLE, 0.2, evs);
  const e1 = poiEvents(evs)[0];
  assert.equal(e1.hint, 'poetic');
  assert.deepEqual(e1.plain, []); assert.deepEqual(e1.learnedNow, []);
  assert.deepEqual(g.state.knowledge.p, { heard: 1, woken: false, learned: [] });
  const e2 = [];
  leaveAndReturn(g, 100, 128, e2);
  const p2 = poiEvents(e2)[0];
  assert.deepEqual(p2.learnedNow, ['dwell']);
  assert.deepEqual(p2.plain, ['Stand still beside it for 100 seconds.']);
  assert.equal(g.state.knowledge.p.heard, 2);
});

test('knowledge: full trigger sets woken and carries inChain / keysSounding / keysTotal', () => {
  const pois = [
    { id: 'a', type: 'cairn', name: 'A', x: 60, y: 128, condition: {} },
    { id: 'x', type: 'stone', name: 'X', x: 100, y: 128, condition: {} },
  ];
  const g = mkGame({ pois, spawn: { x: 60, y: 128 }, gate: { x: 240, y: 128, chain: ['cairn', 'trig'], name: 'G', side: 'E' } });
  const evs = [];
  run(g, IDLE, 0.1, evs);
  const a = poiEvents(evs)[0];
  assert.equal(a.full, true); assert.equal(a.inChain, true);
  assert.equal(a.keysTotal, 2); assert.equal(a.keysSounding, 1);
  assert.deepEqual(a.plain, []); assert.deepEqual(a.learnedNow, []);
  assert.equal(g.state.knowledge.a.woken, true);
  const e2 = [];
  follow(g, [{ x: 100.5, y: 128.5 }], 30, e2);
  const x = poiEvents(e2)[0];
  assert.equal(x.inChain, false); assert.equal(x.keysSounding, 1); assert.equal(x.keysTotal, 2);
});

test('knowledge persists: round trip, old saves without it, garbage is sanitised', () => {
  const levels = [{ id: 'a' }, { id: 'b' }];
  const p = createProgress(levels);
  p.knowledge = { a: { q: { heard: 2, woken: true, learned: ['dwell', 'speed'] } } };
  const q = deserialize(serialize(p), levels);
  assert.deepEqual(q.knowledge, p.knowledge);
  // old save (no knowledge key) loads, and the game works with it
  const old = deserialize(JSON.stringify({ v: 1, unlocked: ['a'], completed: [], fragments: [], notes: ['n'] }), levels);
  assert.deepEqual(old.notes, ['n']);
  assert.ok(!old.knowledge || Object.keys(old.knowledge).length === 0);
  const g = new Game({ levels: [mkLevel('a', 0, {}), mkLevel('b', 1, {})], progress: old, buildWorld: (lv) => makeTestWorld(lv.world) });
  g.loadLevel(0);
  assert.deepEqual(g.state.knowledge, {});
  // garbage
  const bad = deserialize(JSON.stringify({ unlocked: ['a'], knowledge: { zzz: { x: {} }, a: { q: { heard: -3, woken: 'yes', learned: [1, 'dwell'] }, r: 5 }, b: 7 } }), levels);
  assert.deepEqual(bad.knowledge, { a: { q: { heard: 0, woken: false, learned: ['dwell'] } } });
  assert.doesNotThrow(() => deserialize(JSON.stringify({ knowledge: 'oops' }), levels));
  assert.doesNotThrow(() => deserialize(JSON.stringify({ knowledge: [1, 2] }), levels));
  // a game's live knowledge ends up in serialize()
  const g2 = mkGame({ pois: twoKeyPoi, spawn: { x: 100, y: 128 } });
  run(g2, IDLE, 0.2);
  const back = deserialize(serialize(g2.progress), g2.levels);
  assert.deepEqual(back.knowledge.L0.p, { heard: 1, woken: false, learned: ['dwell'] });
  // ...and reloading restores it
  const g3 = new Game({ levels: g2.levels, progress: back, buildWorld: (lv) => makeTestWorld(lv.world) });
  g3.loadLevel(0);
  assert.equal(g3.state.knowledge.p.heard, 1);
});

const bothyGuideWorld = () => ({
  pois: [
    { id: 'bo', type: 'bothy', name: 'Bo', x: 100, y: 128, condition: {} },
    { id: 'la', type: 'lochan', name: 'La', x: 60, y: 128, condition: { speed: 'slow' } },
    { id: 'lb', type: 'lochan', name: 'Lb', x: 150, y: 128, condition: { speed: 'slow' } },
    { id: 'cr', type: 'cairn', name: 'Cr', x: 100, y: 200, condition: { approach: 'descending' } },
  ],
  gate: { x: 240, y: 128, chain: ['lochan', 'cairn'], name: 'G', side: 'E' },
  spawn: { x: 100, y: 128 },
});

test('bothy-guide: targets the nearest un-woken POI of the first silent chain type, then moves on', () => {
  const g = mkGame(bothyGuideWorld());
  const evs = [];
  run(g, IDLE, 0.2, evs);
  const note = poiEvents(evs)[0];
  assert.equal(note.full, true); assert.equal(note.note, 'note A');
  const gd = evs.filter((e) => e.type === 'bothy-guide');
  assert.equal(gd.length, 1);
  assert.equal(gd[0].poi.id, 'bo'); assert.equal(gd[0].target.id, 'la');
  assert.equal(gd[0].text, 'A note pinned by the door: La — approach slowly: hold SPACE as you walk.');
  assert.deepEqual(g.state.knowledge.la.learned, ['speed']);
  // order: poi event, then guide
  assert.ok(evs.indexOf(note) < evs.indexOf(gd[0]));
  // second visit -> the other lochan, third -> the cairn
  const e2 = [];
  leaveAndReturn(g, 100, 128, e2, 20.5);
  assert.equal(e2.filter((e) => e.type === 'bothy-guide')[0].target.id, 'lb');
  const e3 = [];
  leaveAndReturn(g, 100, 128, e3, 20.5);
  const g3 = e3.filter((e) => e.type === 'bothy-guide')[0];
  assert.equal(g3.target.id, 'cr');
  assert.match(g3.text, /^A note pinned by the door: Cr — come down to it from higher ground\.$/);
  // nothing left to teach -> no event
  const e4 = [];
  leaveAndReturn(g, 100, 128, e4, 20.5);
  assert.equal(e4.filter((e) => e.type === 'bothy-guide').length, 0);
  assert.equal(poiEvents(e4).length, 1);
});

test('bothy-guide: skips woken POIs and resonating types; partial bothies guide too', () => {
  const w = bothyGuideWorld();
  w.pois[0].condition = { dwell: 100 };               // bothy fires only partially
  w.pois.push({ id: 'lc', type: 'lochan', name: 'Lc', x: 100, y: 120, condition: {} }); // nearest lochan, but trivially woken first
  const g = mkGame(w);
  const evs = [];
  teleport(g, 100, 120); run(g, IDLE, 0.2, evs);      // wake Lc (lochan now resonating)
  teleport(g, 100, 128); run(g, IDLE, 0.2, evs);      // bothy: partial
  const pe = poiEvents(evs).find((e) => e.poi.id === 'bo');
  assert.equal(pe.full, false);
  assert.equal(pe.note, 'note A');
  const gd = evs.filter((e) => e.type === 'bothy-guide');
  assert.equal(gd.length, 1);
  assert.equal(gd[0].target.id, 'cr');                // lochan is sounding, so the cairn is next
});

test('bothy-near: once per bothy within 14 cells, never after it has fired', () => {
  const pois = [{ id: 'bo', type: 'bothy', name: 'Bo', x: 120, y: 128, condition: {} }];
  const g = mkGame({ pois, spawn: { x: 20, y: 128 } });
  const evs = [];
  run(g, IDLE, 0.2, evs);
  teleport(g, 100, 128); run(g, IDLE, 0.2, evs);       // 20 cells away
  assert.equal(evs.filter((e) => e.type === 'bothy-near').length, 0);
  teleport(g, 108, 128); run(g, IDLE, 0.2, evs);       // 12 cells
  const bn = evs.filter((e) => e.type === 'bothy-near');
  assert.equal(bn.length, 1); assert.equal(bn[0].poi.id, 'bo');
  teleport(g, 20, 128); run(g, IDLE, 0.2, evs);
  teleport(g, 108, 128); run(g, IDLE, 0.2, evs);
  assert.equal(evs.filter((e) => e.type === 'bothy-near').length, 1);
  // a bothy that has already fired never announces itself
  const g2 = mkGame({ pois, spawn: { x: 120, y: 128 } });
  const e2 = [];
  run(g2, IDLE, 0.2, e2);
  assert.equal(poiEvents(e2).length, 1);
  assert.equal(e2.filter((e) => e.type === 'bothy-near').length, 0);
  // ...including from a saved knowledge entry
  const prog = { unlocked: ['L0'], completed: [], fragments: [], notes: [], knowledge: { L0: { bo: { heard: 0, woken: true, learned: [] } } } };
  const g3 = new Game({ levels: [mkLevel('L0', 0, { pois, spawn: { x: 110, y: 128 } })], progress: prog, buildWorld: (lv) => makeTestWorld(lv.world) });
  g3.loadLevel(0);
  const e3 = [];
  run(g3, IDLE, 0.2, e3);
  assert.equal(e3.filter((e) => e.type === 'bothy-near').length, 0);
});

test('gate-near: within 10 cells; re-arms only after >20 cells away and 30 s', () => {
  const gate = { x: 240, y: 128, chain: ['cairn', 'lochan'], name: 'G', side: 'E' };
  const g = mkGame({ gate, spawn: { x: 20, y: 128 } });
  const evs = [];
  const count = () => evs.filter((e) => e.type === 'gate-near').length;
  run(g, IDLE, 0.2, evs);
  assert.equal(count(), 0);
  teleport(g, 232, 128); run(g, IDLE, 0.2, evs);
  assert.equal(count(), 1);
  const ev = evs.find((e) => e.type === 'gate-near');
  assert.deepEqual(ev.chain, ['cairn', 'lochan']); assert.equal(ev.open, false);
  run(g, IDLE, 2, evs);
  assert.equal(count(), 1);                              // still inside: no repeat
  teleport(g, 232, 128 - 15); run(g, IDLE, 1, evs);      // 15..17 cells: inside the dead band, never re-arms
  teleport(g, 232, 128); run(g, IDLE, 0.2, evs);
  assert.equal(count(), 1);
  teleport(g, 150, 128); run(g, IDLE, 5, evs);           // >20 away but < 30 s since the event
  teleport(g, 232, 128); run(g, IDLE, 0.2, evs);
  assert.equal(count(), 1);
  teleport(g, 150, 128); run(g, IDLE, 31, evs);          // far and long enough
  teleport(g, 232, 128); run(g, IDLE, 0.2, evs);
  assert.equal(count(), 2);
});

test('gate-near reports open=true once the key sounds', () => {
  const pois = [{ id: 'a', type: 'cairn', name: 'A', x: 235, y: 100, condition: {} }];
  const g = mkGame({ pois, gate: { x: 240, y: 128, chain: ['cairn'], name: 'G', side: 'E' }, spawn: { x: 235, y: 100 } });
  const evs = [];
  run(g, IDLE, 0.2, evs);
  assert.equal(g.state.gateOpen, true);
  teleport(g, 236, 128); run(g, IDLE, 0.2, evs);
  assert.equal(evs.find((e) => e.type === 'gate-near').open, true);
});

test('chainProgress: count, nearest (dist/bearing), remaining', () => {
  const pois = [
    { id: 'la', type: 'lochan', name: 'La', x: 60, y: 128, condition: { dwell: 100 } },
    { id: 'lb', type: 'lochan', name: 'Lb', x: 150, y: 128, condition: { dwell: 100 } },
    { id: 'cr', type: 'cairn', name: 'Cr', x: 20, y: 160, condition: {} },
  ];
  const g = mkGame({ pois, gate: { x: 240, y: 128, chain: ['lochan', 'cairn', 'waterfall'], name: 'G', side: 'E' }, spawn: { x: 20, y: 128 } });
  run(g, IDLE, 0.05);
  let [lo, ca, wf] = g.state.chainProgress;
  assert.equal(lo.count, 2); assert.equal(ca.count, 1); assert.equal(wf.count, 0);
  assert.equal(lo.nearest.poiId, 'la'); assert.equal(lo.nearest.name, 'La');
  near(lo.nearest.dist, 40, 0.01, 'dist'); near(lo.nearest.bearing, 0, 1e-9, 'bearing');
  assert.equal(lo.remaining, 0); assert.equal(wf.nearest, null);
  near(ca.nearest.dist, 32, 0.01); near(ca.nearest.bearing, Math.PI / 2, 1e-9);   // south = +y
  // nearest follows the player (recomputed within ~10 steps)
  teleport(g, 148, 128); run(g, IDLE, 0.3);
  assert.equal(g.state.chainProgress[0].nearest.poiId, 'lb');
  // remaining counts down from RESONANCE_SECONDS while a type sounds
  teleport(g, 20, 158); run(g, IDLE, 0.1);
  ca = g.state.chainProgress[1];
  assert.equal(ca.resonating, true);
  near(ca.remaining, RESONANCE_SECONDS, 0.5, 'remaining');
  run(g, IDLE, 30);
  near(g.state.chainProgress[1].remaining, RESONANCE_SECONDS - 30.1, 0.5, 'remaining after 30s');
  run(g, IDLE, RESONANCE_SECONDS);
  assert.equal(g.state.chainProgress[1].remaining, 0);
  assert.equal(g.state.chainProgress[1].resonating, false);
  // resonance entries carry poiId
  teleport(g, 20, 158); run(g, IDLE, 21); teleport(g, 20, 100); run(g, IDLE, 0.2); teleport(g, 20, 158); run(g, IDLE, 0.2);
  assert.equal(g.state.resonance[0].poiId, 'cr');
});

test('trail: first point is the spawn, points >= 1.5 cells apart, capped at 4000, same array', () => {
  const g = mkGame({});
  const tr = g.state.trail;
  assert.equal(tr.length, 1);
  near(tr[0].x, g.player.x, 1e-9); near(tr[0].y, g.player.y, 1e-9);
  run(g, IDLE, 1);
  assert.equal(tr.length, 1);                            // standing still adds nothing
  run(g, { x: 1, y: 0, run: false, rest: false }, 5);
  assert.ok(tr.length > 10 && tr.length < 30, 'trail length ' + tr.length);
  for (let i = 1; i < tr.length; i++) assert.ok(Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y) >= 1.5 - 1e-9, 'spacing at ' + i);
  const lastBefore = tr[tr.length - 1];
  assert.ok(Math.hypot(g.player.x - lastBefore.x, g.player.y - lastBefore.y) < 1.5 + 0.2);
  // cap
  while (tr.length < 4000) tr.push({ x: 0, y: 0 });
  teleport(g, 30, 60);
  run(g, { x: 1, y: 0, run: false, rest: false }, 3);
  assert.ok(g.state.trail === tr && tr.length <= 4000, 'length ' + tr.length);
  const last = tr[tr.length - 1];
  assert.ok(Math.hypot(g.player.x - last.x, g.player.y - last.y) < 1.7);
  // a reload gives a fresh trail
  g.loadLevel(0);
  assert.equal(g.state.trail.length, 1);
});
