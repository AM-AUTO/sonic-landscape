/**
 * buildWorld(levelDef) -> World   (see docs/CONTRACTS.md section 1)
 *
 * Pipeline: sculpt heightfield -> resolve water -> flood-fill flow & streams ->
 * land cover -> burn paths -> place POIs/spawn/gate -> guarantee connectivity ->
 * features (waterfalls, spot heights, labels) -> World object.
 */
import { COVER, MAP_SIZE as S, CELL_METERS } from './codes.js';
import { createSculptKit, densify } from './sculpt.js';
import { resolveWater, computeFlow, buildStreams, findWaterfalls, dropAt, meanderStreams, Heap, WATER_DEEP } from './hydro.js';
import { computeSlope, assignCover } from './landcover.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const N = S * S;

/**
 * Levels authored on an older, smaller sheet declare `authoredSize` (e.g. 256). They are sculpted at that
 * size, then the heightfield is upsampled onto the MAP_SIZE sheet and every authored coordinate (spawn,
 * POIs, gate, paths, labels, zones) is scaled by k = MAP_SIZE / authoredSize. Slope (for cover and placement)
 * and flow thresholds are rescaled so the land reads as it was authored. Native levels omit the field.
 */
export function levelScale(levelDef) {
  const a = levelDef && levelDef.authoredSize;
  return a && a !== S ? S / a : 1;
}

export function buildWorld(levelDef) {
  const k = levelScale(levelDef);
  const A = k === 1 ? S : levelDef.authoredSize;
  const { T, state } = createSculptKit(levelDef, A);
  levelDef.sculpt(T);
  let { h, bodyMask } = state;
  const { bodies, noise } = state;
  let pathDefs = state.paths, labelDefs = state.labels;
  const sc = (p) => ({ ...p, x: p.x * k, y: p.y * k });
  let spawnDef = levelDef.spawn, poiDefs = levelDef.pois, gateDef = levelDef.gate, zones = levelDef.zones || [];
  if (k !== 1) {
    ({ h, bodyMask } = upsample(h, bodyMask, bodies, A));
    pathDefs = pathDefs.map((p) => ({ ...p, points: p.points.map((q) => [q[0] * k, q[1] * k]) }));
    labelDefs = labelDefs.map(sc);
    spawnDef = sc(spawnDef); poiDefs = poiDefs.map(sc); gateDef = sc(gateDef);
    zones = zones.map((z) => ({ ...sc(z), r: z.r * k }));
  }

  // keep inside the declared envelope (+4 m margin for water beds)
  const lo = levelDef.elevation.min - 4, hi = levelDef.elevation.max + 4;
  for (let i = 0; i < N; i++) {
    let v = h[i];
    if (!(v === v)) v = levelDef.elevation.min; // NaN guard
    h[i] = v < lo ? lo : v > hi ? hi : v;
  }

  let P = levelDef.cover || {};
  if (k !== 1) {
    // flow accumulation counts cells (k² more per authored cell); drops and slopes spread over k× more cells
    const adj = P.adjust;
    P = { ...P, streamThreshold: (P.streamThreshold ?? 900) * k * k, riverThreshold: (P.riverThreshold ?? 2400) * k * k, fallDrop: (P.fallDrop ?? 24) / k };
    if (adj) P.adjust = (x, y, hh, sl, c) => adj(x / k, y / k, hh, sl, c);
  }
  const { water, bodyOf } = resolveWater(h, bodyMask, bodies);
  const { flowTo, acc } = computeFlow(h, water, bodyOf, bodies, noise);
  let stream = buildStreams(acc, water, P.streamThreshold ?? 900);
  const slope = computeSlope(h, k);
  const cover = assignCover({ h, slope, water, acc, noise, params: P, season: levelDef.season });

  // ---- paths ---------------------------------------------------------
  const pathCells = [];
  const featPaths = [];
  for (const pd of pathDefs) {
    const d = densify(chaikin(pd.points, 2), 1);
    let px = -1, py = -1;
    const line = [];
    for (let k = 0; k < d.x.length; k++) {
      const x = clamp(Math.round(d.x[k]), 0, S - 1), y = clamp(Math.round(d.y[k]), 0, S - 1);
      if (px >= 0) {
        let lx = px, ly = py;
        bresenham(px, py, x, y, (cx, cy) => {
          // keep paths 4-connected so a diagonal step can never squeeze between two crag cells
          if (cx !== lx && cy !== ly) burn(cx, ly, pd.width);
          burn(cx, cy, pd.width);
          lx = cx; ly = cy;
        });
      }
      else burn(x, y, pd.width);
      px = x; py = y;
      if (k % 2 === 0 || k === d.x.length - 1) line.push({ x: +clamp(d.x[k], 0, S - 1).toFixed(1), y: +clamp(d.y[k], 0, S - 1).toFixed(1) });
    }
    featPaths.push(line);
  }
  function burn(x, y, width) {
    set(x, y);
    if (width > 1) { set(x + 1, y); set(x, y + 1); }
    function set(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= S || cy >= S) return;
      const i = cy * S + cx;
      if (water[i] === WATER_DEEP) { cover[i] = COVER.SHALLOW; return; }
      if (cover[i] === COVER.SHALLOW) return;
      cover[i] = COVER.PATH;
      pathCells.push(i);
    }
  }
  const pathNear = new Uint8Array(N);
  for (const i of pathCells) {
    const px = i % S, py = (i / S) | 0;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= S || y >= S || dx * dx + dy * dy > 25) continue;
      pathNear[y * S + x] = 1;
    }
  }

  // ---- helpers for placement ---------------------------------------
  const isPass = (i) => { const c = cover[i]; return c !== COVER.CRAG && c !== COVER.DEEP; };
  const isLand = (i) => { const c = cover[i]; return c !== COVER.CRAG && c !== COVER.DEEP && c !== COVER.SHALLOW; };
  const hmax5 = windowMax(h, 5);
  let rawMin = Infinity, rawMax = -Infinity;
  for (let i = 0; i < N; i++) { if (h[i] < rawMin) rawMin = h[i]; if (h[i] > rawMax) rawMax = h[i]; }

  function nearWater(x, y, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 0.5) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
      if (water[yy * S + xx]) return true;
    }
    return false;
  }
  function nearCover(x, y, code, r) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
      if (cover[yy * S + xx] === code) return true;
    }
    return false;
  }
  /** Best cell in window around (tx,ty) satisfying pred; score(x,y,i,dist) higher is better. */
  function search(tx, ty, R, pred, score) {
    let best = -1, bs = -Infinity;
    for (let y = Math.max(0, ty - R); y <= Math.min(S - 1, ty + R); y++) {
      for (let x = Math.max(0, tx - R); x <= Math.min(S - 1, tx + R); x++) {
        const dd = Math.hypot(x - tx, y - ty);
        if (dd > R) continue;
        const i = y * S + x;
        if (!pred(x, y, i)) continue;
        const sc = score ? score(x, y, i, dd) : -dd;
        if (sc > bs) { bs = sc; best = i; }
      }
    }
    return best;
  }

  // ---- waterfalls ----------------------------------------------------
  const falls = findWaterfalls(h, stream, flowTo, water, acc, { minDrop: P.fallDrop ?? 24, spacing: 10, max: 10, minAcc: P.streamThreshold ?? 900 })
    .filter((f) => cover[f.y * S + f.x] !== COVER.CRAG);

  /**
   * A requested waterfall may sit on a small burn below the map-wide stream threshold: trace that burn
   * upstream to its source and downstream until it joins a real stream, so the fall has a visible course.
   */
  function burnify(i) {
    let c = i;
    for (let k = 0; k < 120 && c >= 0 && !water[c]; k++) {
      stream[c] = 1;
      const n = flowTo[c];
      if (n >= 0 && stream[n] && acc[n] >= (P.streamThreshold ?? 900)) break;
      c = n;
    }
    c = i;
    for (let k = 0; k < 45; k++) {
      const cx = c % S, cy = (c / S) | 0;
      let best = -1, ba = 40;
      for (let d = 0; d < 8; d++) {
        const nx = cx + [1, 1, 0, -1, -1, -1, 0, 1][d], ny = cy + [0, 1, 1, 1, 0, -1, -1, -1][d];
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const ni = ny * S + nx;
        if (flowTo[ni] === c && acc[ni] > ba && !water[ni]) { ba = acc[ni]; best = ni; }
      }
      if (best < 0) break;
      stream[best] = 1; c = best;
    }
  }

  // ---- POIs -----------------------------------------------------------
  const placed = []; // {x,y}
  const sepOk = (x, y, sep) => placed.every((o) => Math.hypot(o.x - x, o.y - y) >= sep);
  const lowCut = rawMin + 0.72 * (rawMax - rawMin);

  // spawn first so nothing sits on top of it
  let spawnIdx = search(Math.round(spawnDef.x), Math.round(spawnDef.y), 30, (x, y, i) => cover[i] === COVER.PATH);
  if (spawnIdx < 0) spawnIdx = search(Math.round(spawnDef.x), Math.round(spawnDef.y), 40, (x, y, i) => isLand(i) && slope[i] < 0.3);
  const spawn = { x: spawnIdx % S, y: (spawnIdx / S) | 0 };
  placed.push(spawn);

  const pois = [];
  for (const def of poiDefs) {
    const tx = clamp(Math.round(def.x), 0, S - 1), ty = clamp(Math.round(def.y), 0, S - 1);
    let idx = -1;
    const base = (x, y, i, sep) => isLand(i) && slope[i] < 0.8 && sepOk(x, y, sep);
    const tryAll = (mk, scoreFn) => {
      for (const [R, sep] of [[14, 9], [28, 9], [45, 6], [70, 4]]) {
        idx = search(tx, ty, Math.round(R * k), mk(sep), scoreFn);
        if (idx >= 0) return true;
      }
      return false;
    };
    switch (def.type) {
      case 'lochan':
        tryAll((sep) => (x, y, i) => base(x, y, i, sep) && nearWater(x, y, 2) && cover[i] !== COVER.WOOD);
        break;
      case 'waterfall': {
        let fall = null, bd = 1e9;
        for (const f of falls) { const d = Math.hypot(f.x - tx, f.y - ty); if (d < bd && d < 12 * k) { bd = d; fall = f; } }
        if (!fall) {
          // force one: the steepest-dropping stream cell near the requested spot
          const fi = search(tx, ty, Math.round(38 * k), (x, y, i) => acc[i] >= 90 * k * k && cover[i] !== COVER.CRAG && !water[i] && flowTo[i] >= 0, (x, y, i, dd) => Math.min(dropAt(h, flowTo, i), 70) - 2.5 * dd);
          if (fi >= 0) { fall = { x: fi % S, y: (fi / S) | 0, drop: dropAt(h, flowTo, fi) }; falls.push(fall); burnify(fi); }
        }
        if (fall) {
          idx = search(fall.x, fall.y, 3, (x, y, i) => isLand(i) && sepOk(x, y, 8), (x, y, i, dd) => -dd - (stream[i] ? 1.5 : 0));
          if (idx < 0) idx = search(fall.x, fall.y, 5, (x, y, i) => isPass(i) && sepOk(x, y, 6));
        }
        break;
      }
      case 'crag':
        tryAll((sep) => (x, y, i) => base(x, y, i, sep) && nearCover(x, y, COVER.CRAG, 1));
        break;
      case 'summit':
      case 'trig':
        for (const [R, sep] of [[12, 8], [20, 7], [32, 6]]) {
          idx = search(tx, ty, Math.round(R * k),
            (x, y, i) => isLand(i) && slope[i] < 0.75 && hmax5[i] - h[i] <= 6 && sepOk(x, y, sep),
            (x, y, i, dd) => h[i] - 0.55 * dd);
          if (idx >= 0) break;
        }
        break;
      case 'bothy':
        tryAll((sep) => (x, y, i) => base(x, y, i, sep) && slope[i] < 0.18 && pathNear[i] && h[i] <= lowCut && cover[i] !== COVER.BOG,
          (x, y, i, dd) => -dd - (cover[i] === COVER.WOOD ? 3 : 0));
        if (idx < 0) tryAll((sep) => (x, y, i) => base(x, y, i, sep) && slope[i] < 0.25 && pathNear[i]);
        break;
      case 'cairn':
        tryAll((sep) => (x, y, i) => base(x, y, i, sep) && slope[i] < 0.5 && cover[i] !== COVER.BOG && cover[i] !== COVER.WOOD);
        break;
      case 'stone':
      default:
        tryAll((sep) => (x, y, i) => base(x, y, i, sep) && slope[i] < 0.35 && cover[i] !== COVER.WOOD);
        break;
    }
    if (idx < 0) idx = search(tx, ty, 60, (x, y, i) => isLand(i));
    if (idx < 0) throw new Error(`world ${levelDef.id}: cannot place POI ${def.id}`);
    const x = idx % S, y = (idx / S) | 0;
    placed.push({ x, y });
    pois.push({ ...def, condition: { ...(def.condition || {}) }, x, y, elevation: +h[idx].toFixed(1) });
  }

  // ---- give burns a natural, meandering course; wide rivers become wadeable ----
  {
    const m = meanderStreams({ stream, flowTo, acc, water, cover, slope, falls, noise, riverThreshold: P.riverThreshold ?? 2400, crag: COVER.CRAG });
    stream = m.stream;
    for (let i = 0; i < N; i++) if (m.river[i] && cover[i] !== COVER.PATH && cover[i] !== COVER.CRAG) cover[i] = COVER.SHALLOW;
  }

  // ---- gate (on the map edge) ---------------------------------------
  const gd = gateDef;
  const dW = gd.x, dE = S - 1 - gd.x, dN = gd.y, dS = S - 1 - gd.y;
  const dm = Math.min(dW, dE, dN, dS);
  const side = gd.side || (dm === dN ? 'N' : dm === dS ? 'S' : dm === dW ? 'W' : 'E');
  const onEdge = (x, y) => (side === 'N' ? y <= 2 : side === 'S' ? y >= S - 3 : side === 'W' ? x <= 2 : x >= S - 3);
  const gtx = clamp(Math.round(gd.x), 0, S - 1), gty = clamp(Math.round(gd.y), 0, S - 1);
  let gi = search(gtx, gty, 40, (x, y, i) => onEdge(x, y) && isLand(i) && slope[i] < 0.6, (x, y, i, dd) => -dd + (cover[i] === COVER.PATH ? 3 : 0));
  if (gi < 0) gi = search(gtx, gty, 60, (x, y, i) => onEdge(x, y) && isPass(i));
  if (gi < 0) throw new Error(`world ${levelDef.id}: cannot place gate`);
  const gate = { x: gi % S, y: (gi / S) | 0, chain: gd.chain.slice(), name: gd.name, side };

  // ---- connectivity guarantee ----------------------------------------
  const repairs = ensureConnected(cover, spawn, [...pois, gate], water);

  // ---- features --------------------------------------------------------
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < N; i++) { if (h[i] < minH) minH = h[i]; if (h[i] > maxH) maxH = h[i]; }

  const labels = labelDefs.map((l) => {
    let x = clamp(Math.round(l.x), 0, S - 1), y = clamp(Math.round(l.y), 0, S - 1);
    if (l.kind === 'peak') {
      const bi = search(x, y, 6, () => true, (xx, yy, i) => h[i]);
      if (bi >= 0) { x = bi % S; y = (bi / S) | 0; }
    }
    return { x, y, text: l.text, kind: l.kind };
  });

  const spotHeights = computeSpotHeights(h, pois);
  const waterfalls = falls.map((f) => ({ x: f.x, y: f.y }));

  // ---- World object ----------------------------------------------------
  const world = {
    level: levelDef,
    size: S, cellMeters: CELL_METERS, scale: k,
    height: h, cover, stream,
    contourInterval: levelDef.contourInterval,
    minH, maxH,
    pois, gate, spawn, zones,
    features: { waterfalls, spotHeights, labels, paths: featPaths },
    stats: { repairs },
    heightAt(x, y) {
      x = x < 0 ? 0 : x > S - 1 ? S - 1 : x;
      y = y < 0 ? 0 : y > S - 1 ? S - 1 : y;
      const x0 = x | 0, y0 = y | 0;
      const x1 = x0 < S - 1 ? x0 + 1 : x0, y1 = y0 < S - 1 ? y0 + 1 : y0;
      const fx = x - x0, fy = y - y0;
      const a = h[y0 * S + x0], b = h[y0 * S + x1], c = h[y1 * S + x0], d = h[y1 * S + x1];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    },
    gradientAt(x, y) {
      return {
        gx: (world.heightAt(x + 0.5, y) - world.heightAt(x - 0.5, y)) / CELL_METERS,
        gy: (world.heightAt(x, y + 0.5) - world.heightAt(x, y - 0.5)) / CELL_METERS,
      };
    },
    slopeAt(x, y) { const g = world.gradientAt(x, y); return Math.hypot(g.gx, g.gy); },
    coverAt(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      if (!(ix >= 0 && iy >= 0 && ix < S && iy < S)) return COVER.CRAG;
      return cover[iy * S + ix];
    },
    passable(x, y) {
      const c = world.coverAt(x, y);
      return c !== COVER.CRAG && c !== COVER.DEEP;
    },
  };
  return world;
}

// ---------------------------------------------------------------------------

/**
 * Upsample an A×A sculpt (heights bilinear, body mask nearest) onto the S×S sheet. Land cells that borrow
 * height from a water bed are lifted to that body's rim so no dry pits ring the shores.
 */
function upsample(hA, maskA, bodies, A) {
  const k = S / A;
  const h = new Float32Array(N), mask = new Uint16Array(N);
  for (let y = 0; y < S; y++) {
    const v = Math.min(A - 1, Math.max(0, (y + 0.5) / k - 0.5));
    const y0 = v | 0, y1 = Math.min(A - 1, y0 + 1), fy = v - y0;
    const ny = Math.min(A - 1, Math.floor((y + 0.5) / k));
    for (let x = 0; x < S; x++) {
      const u = Math.min(A - 1, Math.max(0, (x + 0.5) / k - 0.5));
      const x0 = u | 0, x1 = Math.min(A - 1, x0 + 1), fx = u - x0;
      const a = hA[y0 * A + x0], b = hA[y0 * A + x1], c = hA[y1 * A + x0], d = hA[y1 * A + x1];
      const i = y * S + x;
      let hv = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
      const id = maskA[ny * A + Math.min(A - 1, Math.floor((x + 0.5) / k))];
      mask[i] = id;
      if (!id) {
        for (const j of [y0 * A + x0, y0 * A + x1, y1 * A + x0, y1 * A + x1]) {
          const bj = maskA[j];
          if (bj && hv < bodies[bj - 1].level + 0.4) hv = bodies[bj - 1].level + 0.4;
        }
      }
      h[i] = hv;
    }
  }
  return { h, bodyMask: mask };
}

/** Chaikin corner cutting (end points kept) so authored kinks become smooth bends. */
function chaikin(pts, iters) {
  let p = pts.map((q) => [q[0], q[1]]);
  for (let it = 0; it < iters && p.length > 2; it++) {
    const o = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    o.push(p[p.length - 1]);
    p = o;
  }
  return p;
}

function bresenham(x0, y0, x1, y1, cb) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

/** Separable sliding max over a (2r+1) square window. */
function windowMax(h, r) {
  const tmp = new Float32Array(N), out = new Float32Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let m = -Infinity;
    for (let k = Math.max(0, x - r); k <= Math.min(S - 1, x + r); k++) { const v = h[y * S + k]; if (v > m) m = v; }
    tmp[y * S + x] = m;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let m = -Infinity;
    for (let k = Math.max(0, y - r); k <= Math.min(S - 1, y + r); k++) { const v = tmp[k * S + x]; if (v > m) m = v; }
    out[y * S + x] = m;
  }
  return out;
}

/** Prominent local maxima for map spot-height labels. */
function computeSpotHeights(h, pois) {
  const R = 6;
  const wm = windowMax(h, R);
  const cands = [];
  for (let y = 4; y < S - 4; y++) for (let x = 4; x < S - 4; x++) {
    const i = y * S + x;
    if (h[i] < wm[i]) continue;
    // plateau tie-break: only the first cell of equal maxima
    if (h[i - 1] === h[i] || h[i - S] === h[i]) continue;
    let low = Infinity;
    for (let a = 0; a < 16; a++) {
      const ang = a * Math.PI / 8;
      const xx = clamp(Math.round(x + Math.cos(ang) * 10), 0, S - 1), yy = clamp(Math.round(y + Math.sin(ang) * 10), 0, S - 1);
      const v = h[yy * S + xx];
      if (v < low) low = v;
    }
    if (h[i] - low >= 18) cands.push({ x, y, h: Math.round(h[i]) });
  }
  cands.sort((a, b) => b.h - a.h || a.y - b.y || a.x - b.x);
  const out = [];
  for (const c of cands) {
    if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= 12)) out.push(c);
    if (out.length >= 28) break;
  }
  for (const p of pois) {
    if ((p.type === 'summit' || p.type === 'trig') && out.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= 5)) {
      out.push({ x: p.x, y: p.y, h: Math.round(p.elevation) });
    }
  }
  return out;
}

/**
 * BFS reachability (8-connected, no diagonal squeeze between two blocked
 * orthogonals). Any target not reached from spawn is joined by a minimum-cost
 * 4-connected route through crag/deep water, converting those cells to scree/
 * shallows (a gully or ford). Returns the number of converted cells.
 */
export function ensureConnected(cover, spawn, targets, water) {
  const pass = (i) => cover[i] !== COVER.CRAG && cover[i] !== COVER.DEEP;
  const reach = bfsReach(cover, spawn.y * S + spawn.x);
  let repairs = 0;
  for (const t of targets) {
    const ti = t.y * S + t.x;
    if (reach[ti]) continue;
    // Dijkstra from target to nearest reached cell
    const dist = new Float32Array(N).fill(Infinity);
    const par = new Int32Array(N).fill(-1);
    const heap = new Heap(N * 2);
    dist[ti] = 0; heap.push(0, ti);
    let hit = -1;
    const done = new Uint8Array(N);
    while (heap.n > 0) {
      const c = heap.pop();
      if (done[c]) continue;
      done[c] = 1;
      if (reach[c]) { hit = c; break; }
      const cx = c % S, cy = (c / S) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const ni = ny * S + nx;
        const cc = cover[ni];
        const cost = cc === COVER.CRAG ? 9 : cc === COVER.DEEP ? 6 : 1;
        const nd = dist[c] + cost;
        if (nd < dist[ni]) { dist[ni] = nd; par[ni] = c; heap.push(nd, ni); }
      }
    }
    if (hit < 0) continue;
    for (let c = hit; c >= 0; c = par[c]) {
      if (cover[c] === COVER.CRAG) { cover[c] = COVER.SCREE; repairs++; }
      else if (cover[c] === COVER.DEEP) { cover[c] = COVER.SHALLOW; repairs++; }
    }
    const again = bfsReach(cover, spawn.y * S + spawn.x);
    reach.set(again);
  }
  return repairs;
}

export function bfsReach(cover, start) {
  const reach = new Uint8Array(N);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  const pass = (i) => cover[i] !== COVER.CRAG && cover[i] !== COVER.DEEP;
  if (!pass(start)) return reach;
  reach[start] = 1; q[qt++] = start;
  while (qh < qt) {
    const c = q[qh++];
    const cx = c % S, cy = (c / S) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const ni = ny * S + nx;
      if (reach[ni] || !pass(ni)) continue;
      if (dx && dy && !pass(cy * S + nx) && !pass(ny * S + cx)) continue;
      reach[ni] = 1; q[qt++] = ni;
    }
  }
  return reach;
}
