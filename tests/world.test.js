import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/world/levels/index.js';
import { buildWorld } from '../src/world/terrain.js';
import { createNoise } from '../src/core/noise.js';
import { COVER, POI_TYPES, MAP_SIZE as S } from '../src/world/codes.js';

const ID_ORDER = ['rannoch', 'affric', 'coe', 'cairngorm', 'torridon', 'cuillin', 'assynt', 'nevis'];
const worlds = new Map();
const buildMs = new Map();
function world(lv) {
  if (!worlds.has(lv.id)) {
    const t0 = performance.now();
    worlds.set(lv.id, buildWorld(lv));
    buildMs.set(lv.id, performance.now() - t0);
  }
  return worlds.get(lv.id);
}

/** BFS over passable 8-connected cells; a diagonal may not cut between two impassable orthogonals. */
function reachable(w, start) {
  const seen = new Uint8Array(S * S);
  const dist = new Int32Array(S * S).fill(-1);
  const q = [start.y * S + start.x];
  seen[q[0]] = 1; dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % S, cy = (c / S) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S || !w.passable(nx, ny)) continue;
      if (dx && dy && !w.passable(nx, cy) && !w.passable(cx, ny)) continue;
      const ni = ny * S + nx;
      if (seen[ni]) continue;
      seen[ni] = 1; dist[ni] = dist[c] + 1; q.push(ni);
    }
  }
  return { seen, dist };
}
const within = (w, x, y, r, pred) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < S && yy < S && pred(xx, yy)) return true;
  }
  return false;
};

test('levels index: eight levels in album order', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ID_ORDER);
  LEVELS.forEach((l, i) => assert.equal(l.index, i));
  for (const l of LEVELS) {
    assert.ok(l.name && l.gaelic && l.gridLetters && l.subtitle, `${l.id} naming`);
    assert.ok([10, 20].includes(l.contourInterval), `${l.id} contour interval`);
    assert.ok(l.elevation.min < l.elevation.max);
    assert.ok(Array.isArray(l.gridOrigin) && l.gridOrigin.length === 2);
    assert.ok(l.fieldNotes.length >= 3 && l.fieldNotes.length <= 5, `${l.id} fieldNotes 3-5`);
    assert.ok(l.fieldNotes.every((n) => typeof n === 'string' && n.length > 10));
    assert.ok(l.palette && l.palette.tint && l.palette.paper);
  }
});

test('album uses all eight POI types', () => {
  const used = new Set();
  for (const l of LEVELS) for (const p of l.pois) used.add(p.type);
  for (const t of POI_TYPES) assert.ok(used.has(t), `type ${t} used somewhere`);
});

test('noise: deterministic and bounded', () => {
  const a = createNoise(5), b = createNoise(5), c = createNoise(6);
  let diff = 0;
  for (let i = 0; i < 200; i++) {
    const x = i * 0.37, y = i * 0.91;
    assert.equal(a.noise2(x, y), b.noise2(x, y));
    assert.ok(Math.abs(a.noise2(x, y)) <= 1.05);
    assert.ok(Math.abs(a.fbm(x, y)) <= 1.05);
    const r = a.ridged(x, y, 4);
    assert.ok(r >= 0 && r <= 1.0001);
    if (a.noise2(x, y) !== c.noise2(x, y)) diff++;
    const w = a.warp(x, y, 10);
    assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y));
  }
  assert.ok(diff > 150, 'different seeds differ');
});

for (const lv of LEVELS) {
  test(`${lv.id}: structure, determinism, no NaN, height range`, () => {
    const w = world(lv);
    assert.equal(w.size, 256);
    assert.equal(w.cellMeters, 40);
    assert.equal(w.height.length, S * S);
    assert.equal(w.cover.length, S * S);
    assert.equal(w.stream.length, S * S);
    assert.equal(w.contourInterval, lv.contourInterval);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < w.height.length; i++) {
      const v = w.height[i];
      assert.ok(Number.isFinite(v), 'finite height');
      if (v < mn) mn = v; if (v > mx) mx = v;
      assert.ok(w.cover[i] <= COVER.ROCK, 'valid cover code');
      assert.ok(w.stream[i] === 0 || w.stream[i] === 1);
    }
    assert.equal(w.minH, mn); assert.equal(w.maxH, mx);
    assert.ok(mn >= lv.elevation.min - 5, `min ${mn} >= ${lv.elevation.min - 5}`);
    assert.ok(mx <= lv.elevation.max + 5, `max ${mx} <= ${lv.elevation.max + 5}`);
    // the level should actually use its declared envelope
    assert.ok(mx >= lv.elevation.max - 60, `max ${mx} reaches the declared ${lv.elevation.max}`);
    assert.ok(mn <= lv.elevation.min + 60, `min ${mn} reaches the declared ${lv.elevation.min}`);
    // determinism
    const w2 = buildWorld(lv);
    assert.deepEqual(w2.height, w.height);
    assert.deepEqual(w2.cover, w.cover);
    assert.deepEqual(w2.stream, w.stream);
    assert.deepEqual(w2.pois, w.pois);
    assert.deepEqual(w2.gate, w.gate);
    assert.deepEqual(w2.spawn, w.spawn);
    assert.deepEqual(w2.features, w.features);
  });

  test(`${lv.id}: POIs, spawn, gate passable and mutually reachable`, () => {
    const w = world(lv);
    assert.ok(w.pois.length >= 7 && w.pois.length <= 9, `7-9 POIs, got ${w.pois.length}`);
    assert.equal(new Set(w.pois.map((p) => p.id)).size, w.pois.length, 'unique ids');
    const pts = [w.spawn, w.gate, ...w.pois];
    for (const p of pts) {
      assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
      assert.ok(w.passable(p.x, p.y), `(${p.x},${p.y}) passable (${p.id || 'spawn/gate'})`);
    }
    const { seen } = reachable(w, w.spawn);
    for (const p of pts) assert.ok(seen[p.y * S + p.x], `${p.id || 'point'} reachable from spawn at ${p.x},${p.y}`);
    // spawn on a path
    assert.equal(w.cover[w.spawn.y * S + w.spawn.x], COVER.PATH, 'spawn on a path');
    // POIs keep their distance (fire radius is 3 cells)
    for (let i = 0; i < w.pois.length; i++) for (let j = i + 1; j < w.pois.length; j++) {
      const d = Math.hypot(w.pois[i].x - w.pois[j].x, w.pois[i].y - w.pois[j].y);
      assert.ok(d >= 6, `${w.pois[i].id} / ${w.pois[j].id} too close (${d.toFixed(1)})`);
    }
    for (const p of w.pois) assert.ok(Math.hypot(p.x - w.spawn.x, p.y - w.spawn.y) >= 8, `${p.id} too near spawn`);
  });

  test(`${lv.id}: POI placement semantics`, () => {
    const w = world(lv);
    const range = w.maxH - w.minH;
    for (const p of w.pois) {
      assert.ok(POI_TYPES.includes(p.type));
      assert.ok(typeof p.name === 'string' && p.name.length > 2);
      assert.ok(typeof p.hint === 'string' && p.hint.length > 5, `${p.id} has a hint`);
      assert.ok(p.condition && typeof p.condition === 'object');
      assert.ok(Math.abs(p.elevation - w.height[p.y * S + p.x]) < 0.1, 'elevation filled');
      switch (p.type) {
        case 'lochan':
          assert.ok(within(w, p.x, p.y, 2, (x, y) => [COVER.SHALLOW, COVER.DEEP].includes(w.cover[y * S + x])), `${p.id} by water`);
          break;
        case 'crag':
          assert.ok(within(w, p.x, p.y, 2, (x, y) => w.cover[y * S + x] === COVER.CRAG), `${p.id} next to crag`);
          break;
        case 'summit':
        case 'trig': {
          let mx = -Infinity;
          for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
            const x = Math.min(S - 1, Math.max(0, p.x + dx)), y = Math.min(S - 1, Math.max(0, p.y + dy));
            mx = Math.max(mx, w.height[y * S + x]);
          }
          assert.ok(mx - p.elevation <= 8, `${p.id} near a local high (${(mx - p.elevation).toFixed(1)} m below)`);
          break;
        }
        case 'waterfall':
          assert.ok(within(w, p.x, p.y, 2, (x, y) => w.stream[y * S + x] === 1), `${p.id} beside a stream`);
          assert.ok(w.features.waterfalls.some((f) => Math.hypot(f.x - p.x, f.y - p.y) <= 4), `${p.id} near a waterfall feature`);
          break;
        case 'bothy':
          assert.ok(w.slopeAt(p.x, p.y) < 0.3, `${p.id} flat (${w.slopeAt(p.x, p.y).toFixed(2)})`);
          assert.ok(within(w, p.x, p.y, 6, (x, y) => w.cover[y * S + x] === COVER.PATH), `${p.id} near a path`);
          assert.ok(p.elevation <= w.minH + 0.8 * range, `${p.id} low ground`);
          break;
        default: break;
      }
    }
  });

  test(`${lv.id}: gate on the map edge, chain present, routes plausible`, () => {
    const w = world(lv);
    const g = w.gate;
    const toEdge = { N: g.y, S: S - 1 - g.y, W: g.x, E: S - 1 - g.x };
    assert.ok(['N', 'E', 'S', 'W'].includes(g.side));
    assert.ok(toEdge[g.side] <= 3, `gate within 3 cells of side ${g.side}`);
    assert.equal(toEdge[g.side], Math.min(...Object.values(toEdge)), 'side is the nearest edge');
    assert.ok(typeof g.name === 'string' && /Bealach|Lairig|Làirig/.test(g.name), 'gate name');
    assert.deepEqual(g.chain, lv.gate.chain);
    const types = new Set(w.pois.map((p) => p.type));
    for (const t of g.chain) assert.ok(types.has(t), `chain type ${t} present`);
    // the gate is far from the start: the player crosses the map
    assert.ok(Math.hypot(g.x - w.spawn.x, g.y - w.spawn.y) >= 100, 'gate is far from spawn');
    // chain legs
    let prev = w.spawn;
    for (const t of g.chain) {
      const p = w.pois.find((q) => q.type === t);
      const straight = Math.hypot(p.x - prev.x, p.y - prev.y);
      assert.ok(straight >= 25 && straight <= 135, `${lv.id} leg to ${t}: ${straight.toFixed(0)} cells`);
      const { dist } = reachable(w, prev);
      const walk = dist[p.y * S + p.x];
      assert.ok(walk >= 0 && walk <= straight * 2.4 + 20, `${lv.id} walk to ${t}: ${walk} (straight ${straight.toFixed(0)})`);
      prev = p;
    }
  });

  test(`${lv.id}: features, labels, paths and accessors`, () => {
    const w = world(lv);
    const f = w.features;
    assert.ok(f.spotHeights.length >= 5, 'spot heights');
    assert.ok(f.labels.length >= 6, 'labels');
    for (const l of f.labels) {
      assert.ok(['peak', 'water', 'glen', 'feature'].includes(l.kind));
      assert.ok(l.x >= 0 && l.x < S && l.y >= 0 && l.y < S && l.text.length > 2);
    }
    assert.ok(f.labels.some((l) => l.kind === 'peak') && f.labels.some((l) => l.kind === 'water'));
    assert.ok(f.paths.length >= 2);
    for (const path of f.paths) for (const pt of path) assert.ok(pt.x >= 0 && pt.x < S && pt.y >= 0 && pt.y < S);
    // paths are burned in and are passable
    for (const path of f.paths) {
      const mid = path[path.length >> 1];
      const mx = Math.round(mid.x), my = Math.round(mid.y);
      assert.ok(within(w, mx, my, 1, (x, y) => w.cover[y * S + x] === COVER.PATH || w.cover[y * S + x] === COVER.SHALLOW), 'path burned into cover');
    }
    for (const s of f.spotHeights) assert.ok(Math.abs(w.height[s.y * S + s.x] - s.h) <= 1);
    for (const wf of f.waterfalls) assert.ok(w.stream[wf.y * S + wf.x] === 1);
    // accessors
    assert.equal(w.heightAt(10, 20), w.height[20 * S + 10]);
    const mid = (w.heightAt(10.5, 20) - (w.height[20 * S + 10] + w.height[20 * S + 11]) / 2);
    assert.ok(Math.abs(mid) < 1e-3, 'bilinear');
    assert.equal(w.heightAt(-5, -5), w.height[0]);
    assert.equal(w.heightAt(999, 999), w.height[S * S - 1]);
    assert.equal(w.coverAt(-1, 3), COVER.CRAG);
    assert.equal(w.coverAt(3, 300), COVER.CRAG);
    assert.equal(w.passable(-1, 3), false);
    assert.equal(w.passable(256, 3), false);
    assert.equal(w.coverAt(10.9, 20.9), w.cover[20 * S + 10]);
    // gradient points uphill: nudging along +grad increases height
    let checked = 0;
    for (let y = 20; y < 236 && checked < 30; y += 17) for (let x = 20; x < 236 && checked < 30; x += 19) {
      const g = w.gradientAt(x + 0.3, y + 0.3);
      const s = w.slopeAt(x + 0.3, y + 0.3);
      assert.ok(Math.abs(s - Math.hypot(g.gx, g.gy)) < 1e-9);
      if (s < 0.05) continue;
      const k = 0.4 / (s * 40);
      assert.ok(w.heightAt(x + 0.3 + g.gx * k * 40, y + 0.3 + g.gy * k * 40) > w.heightAt(x + 0.3, y + 0.3) - 1e-6, 'gradient uphill');
      checked++;
    }
    assert.ok(checked > 5);
  });

  test(`${lv.id}: cover mix is sensible`, () => {
    const w = world(lv);
    const counts = new Array(10).fill(0);
    for (const c of w.cover) counts[c]++;
    const frac = (c) => counts[c] / (S * S);
    assert.ok(frac(COVER.CRAG) < 0.2, 'crag fraction');
    assert.ok(frac(COVER.DEEP) < 0.12, 'deep water fraction');
    assert.ok(frac(COVER.PATH) > 0.002, 'paths present');
    assert.ok(counts[COVER.SHALLOW] + counts[COVER.DEEP] > 100, 'there is water');
    assert.ok(w.stream.reduce((a, b) => a + b, 0) > 150, 'streams');
    // the crag repair safety net should be a rare event, not the design
    assert.ok(w.stats.repairs <= 30, `repairs ${w.stats.repairs}`);
  });

  test(`${lv.id}: buildWorld is fast (< 1.5 s)`, () => {
    world(lv);
    const t0 = performance.now();
    buildWorld(lv);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${lv.id} built in ${ms.toFixed(0)} ms`);
  });
}

test('level-specific features', () => {
  const by = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
  const cover = (id, c) => world(by[id]).cover.reduce((n, v) => n + (v === c), 0);
  assert.ok(cover('rannoch', COVER.SHALLOW) + cover('rannoch', COVER.DEEP) > 1500, 'rannoch: lochan country');
  assert.ok(cover('affric', COVER.WOOD) > 8000, 'affric: pinewood');
  assert.ok(cover('coe', COVER.CRAG) > 2000, 'coe: crags');
  assert.ok(cover('cairngorm', COVER.SNOW) > 3000, 'cairngorm: snow');
  assert.ok(cover('torridon', COVER.DEEP) > 1500, 'torridon: sea loch');
  assert.ok(cover('cuillin', COVER.CRAG) > 2500, 'cuillin: jagged');
  assert.ok(cover('nevis', COVER.CRAG) > 3000, 'nevis: north face');
  const rn = world(by.rannoch);
  assert.ok(rn.maxH - rn.minH < 400, 'rannoch is a plateau');
  assert.ok(world(by.nevis).maxH > 1300);
  // Rannoch: conditions are gentle
  const ra = by.rannoch.pois;
  assert.deepEqual(ra.find((p) => p.type === 'cairn').condition, { approach: 'descending' });
});
