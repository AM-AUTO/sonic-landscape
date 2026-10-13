/**
 * SHAPES: placed, bounded SDF objects, and the Group that keeps 100+ of them fast.
 *
 * A Shape is { d(x,y,z) -> distance, min:[x,y,z], max:[x,y,z] (world AABB that contains the surface, noise included), id }.
 * Group.add(shape, id) collects shapes. Group.d(x,y,z) is the EXACT min of the children's distances but evaluates only the
 * children whose AABB could beat the current best (first pass: cheap AABB lower bounds; then the nearest child first, then
 * only those whose bound is below the best). Above `leafSize` (12) children, finish() builds a bounding-volume tree of nested Groups
 * so a lookup costs about log(n), not n: hundreds or thousands of stones / blades are fine. Groups nest: a Group is itself a Shape.
 * Hard union only; smooth-union the Group's result with other things (ground) in the scene's map. Call finish() after the last add().
 * After d(): g.lastId = material id of the nearest child, g.lastIdx = its index in adding order (per-stone seeds for shading).
 *
 *   const g = new Group();  g.add(slab({...}), ID_WALL); ... ; g.finish();
 *   in map(): mreset(); const d = g.mat(x,y,z)   // keeps the nearest child's id in M (and M.i = child index, for per-stone variation)
 *             or  g.d(x,y,z) then read g.lastId / g.lastIdx
 *
 * FACTORIES (all take one options object; pos|c = world centre, rot = [rx,ry,rz] radians (R = Ry*Rx*Rz), see sdf.Xf):
 *   sphere({c, r})                               ellipsoid({c, radii:[rx,ry,rz], rot})
 *   box({c, size:[w,h,d], rot, round=0})         cylinder({c, r, h, rot, round=0})       (h = full height)
 *   capsule({a:[x,y,z], b:[x,y,z], r})           torus({c, R, r, rot})
 *   column({base:[x,y,z], h, r0, r1, rot, scale:[sx,sy,sz]})   tapered round-cone (menhir): radius r0 at the foot, r1 at the top, h tall,
 *                                                scale squashes it into an elliptical section (e.g. [1,1,0.55] = a flat slab-like menhir)
 *   roughen(shape, {amp=0.03, freq=4, seed=1, oct=3, bulk=0, bulkFreq})   displace any shape's surface by fbm noise (amp metres, freq cycles per metre);
 *                                                bulk = extra LOW-frequency wobble (metres, at bulkFreq, default freq*0.3) so outlines are not straight
 *   roughBox({c,size,rot,round,rough,freq,seed,oct})     roundBox + roughen
 *   roughEllipsoid({c,radii,rot,rough,freq,seed,oct})    ellipsoid + roughen
 *   slab({c,size,rot,round=0.04,taper=0,rough=0.025,freq=5,seed,oct=3,chip=0,bulk=0,bulkFreq})
 *                                                a dry-stone flagstone: rounded box, optional taper (0..0.5, narrows toward the top)
 *                                                and chiselled roughness
 *   faceted(shape, {c, radius, count=8, depth=0.18, k=0.02, seed, up=0.35})   shave random planes off a blob: angular weathered rock faces
 *   shapeUnion(a,b,k) shapeSub(a,b,k) shapeInter(a,b,k)   smooth booleans of Shapes (k=0 hard); bounds follow (sub keeps a's)
 *   makeShape(fn, min, max, id)                  wrap your own d(x,y,z) with a bounding box
 *   place(localFn, lmin, lmax, {pos,rot,scale})  the primitive used by every factory: localFn(x,y,z) in the shape's own frame
 */
import { Xf, M, sdSphere, sdEllipsoid, sdBox, sdRoundBox, sdCapsule, sdTorus, sdCylinder, sdRoundCone, smin, smax } from './sdf.mjs';
import { getNoise } from './noise.mjs';
import { mulberry32 } from '../../src/core/rng.js';

export function makeShape(fn, min, max, id = 0) { return { d: fn, min: [...min], max: [...max], id }; }

export function place(localFn, lmin, lmax, o = {}) {
  const xf = new Xf({ pos: o.pos || o.c || [0, 0, 0], rot: o.rot || [0, 0, 0], scale: o.scale == null ? 1 : o.scale });
  const r = xf.r, s = xf.s, tx = xf.pos[0], ty = xf.pos[1], tz = xf.pos[2], ms = xf.minScale;
  const r0 = r[0], r1 = r[3], r2 = r[6], r3 = r[1], r4 = r[4], r5 = r[7], r6 = r[2], r7 = r[5], r8 = r[8];
  const isx = 1 / s[0], isy = 1 / s[1], isz = 1 / s[2];
  const d = (x, y, z) => {
    const px = x - tx, py = y - ty, pz = z - tz;
    return localFn((r0 * px + r1 * py + r2 * pz) * isx, (r3 * px + r4 * py + r5 * pz) * isy, (r6 * px + r7 * py + r8 * pz) * isz) * ms;
  };
  const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30], o3 = [0, 0, 0];
  for (let i = 0; i < 8; i++) {
    xf.from(i & 1 ? lmax[0] : lmin[0], i & 2 ? lmax[1] : lmin[1], i & 4 ? lmax[2] : lmin[2], o3);
    for (let k = 0; k < 3; k++) { if (o3[k] < mn[k]) mn[k] = o3[k]; if (o3[k] > mx[k]) mx[k] = o3[k]; }
  }
  return { d, min: mn, max: mx, id: 0 };
}

export function sphere({ c = [0, 0, 0], r = 1 } = {}) {
  return place((x, y, z) => sdSphere(x, y, z, r), [-r, -r, -r], [r, r, r], { c });
}
export function ellipsoid({ c = [0, 0, 0], radii = [1, 1, 1], rot, scale } = {}) {
  const [a, b, d] = radii;
  return place((x, y, z) => sdEllipsoid(x, y, z, a, b, d), [-a, -b, -d], [a, b, d], { c, rot, scale });
}
export function box({ c = [0, 0, 0], size = [1, 1, 1], rot, round = 0, scale } = {}) {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  return place(round > 0 ? (x, y, z) => sdRoundBox(x, y, z, hx, hy, hz, round) : (x, y, z) => sdBox(x, y, z, hx, hy, hz), [-hx, -hy, -hz], [hx, hy, hz], { c, rot, scale });
}
export function cylinder({ c = [0, 0, 0], r = 0.5, h = 1, rot, round = 0 } = {}) {
  const hh = h / 2;
  const fn = round > 0 ? (x, y, z) => { const dx = Math.sqrt(x * x + z * z) - (r - round), dy = Math.abs(y) - (hh - round); const m = dx > dy ? dx : dy; const mx = dx > 0 ? dx : 0, my = dy > 0 ? dy : 0; return (m < 0 ? m : Math.sqrt(mx * mx + my * my)) - round; } : (x, y, z) => sdCylinder(x, y, z, r, hh);
  return place(fn, [-r, -hh, -r], [r, hh, r], { c, rot });
}
export function capsule({ a = [0, 0, 0], b = [0, 1, 0], r = 0.1 } = {}) {
  const [ax, ay, az] = a, [bx, by, bz] = b;
  return makeShape((x, y, z) => sdCapsule(x, y, z, ax, ay, az, bx, by, bz, r),
    [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r], [Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r]);
}
export function torus({ c = [0, 0, 0], R = 1, r = 0.2, rot } = {}) {
  return place((x, y, z) => sdTorus(x, y, z, R, r), [-R - r, -r, -R - r], [R + r, r, R + r], { c, rot });
}
export function column({ base = [0, 0, 0], h = 3, r0 = 0.6, r1 = 0.3, rot, scale } = {}) {
  const sc = scale || [1, 1, 1];
  return place((x, y, z) => sdRoundCone(x, y, z, r0, r1, h), [-r0, -r0, -r0], [r0, h + r1, r0], { pos: base, rot, scale: sc });
}

export function roughen(shape, { amp = 0.03, freq = 4, seed = 1, oct = 3, bulk = 0, bulkFreq } = {}) {
  const nz = getNoise(seed), f = shape.d, tot = amp + bulk, far = tot * 2.5, lip = 0.8, bf = bulkFreq || freq * 0.3;
  const d = bulk > 0
    ? (x, y, z) => {
      const d0 = f(x, y, z);
      if (d0 > far) return d0 - tot;
      return (d0 - amp * nz.fbm3(x * freq, y * freq, z * freq, oct) - bulk * nz.n3(x * bf + 40.7, y * bf + 3.1, z * bf + 19.9)) * lip;
    }
    : (x, y, z) => {
      const d0 = f(x, y, z);
      if (d0 > far) return d0 - amp;
      return (d0 - amp * nz.fbm3(x * freq, y * freq, z * freq, oct)) * lip;
    };
  return { d, min: shape.min.map((v) => v - tot), max: shape.max.map((v) => v + tot), id: shape.id };
}
export function roughBox({ rough = 0.03, freq = 4, seed = 1, oct = 3, bulk = 0, ...o } = {}) { return roughen(box(o), { amp: rough, freq, seed, oct, bulk }); }
export function roughEllipsoid({ rough = 0.03, freq = 4, seed = 1, oct = 3, bulk = 0, ...o } = {}) { return roughen(ellipsoid(o), { amp: rough, freq, seed, oct, bulk }); }

export function slab({ c = [0, 0, 0], size = [1, 0.2, 0.6], rot, round = 0.04, taper = 0, rough = 0.025, freq = 5, seed = 1, oct = 3, chip = 0, bulk = 0, bulkFreq } = {}) {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2, rr = Math.min(round, hx, hy, hz) * 0.999;
  const nz = getNoise(seed + 101), cf = freq * 0.35;
  const fn = (x, y, z) => {
    const yc = y > hy ? hy : y < -hy ? -hy : y, s = taper !== 0 ? 1 - taper * (yc / hy) * 0.5 : 1;
    let d = sdRoundBox(x / s, y, z / s, hx, hy, hz, rr) * (s < 1 ? s : 1);
    if (chip > 0) d -= chip * Math.max(0, nz.n3(x * cf, y * cf, z * cf)) ;   // larger, softer bites out of the corners
    return d;
  };
  const e = Math.max(hx, hz) * Math.abs(taper) * 0.5 + chip;
  const base = place(fn, [-hx - e, -hy, -hz - e], [hx + e, hy, hz + e], { c, rot });
  return rough > 0 || bulk > 0 ? roughen(base, { amp: rough, freq, seed, oct, bulk, bulkFreq }) : base;
}

/**
 * faceted(shape, { c, radius, count=8, depth=0.18, k=0.02, seed=1, up=0.35 }) -> Shape: shave random planes off a blobby shape so it gets
 * the angular, split-and-weathered faces of real rock. c = the shape's centre, radius = its typical radius; each of `count` planes cuts
 * between depth*radius and 0 deep (smooth edges of width k metres). `up` biases the cut normals upwards (frost-shattered tops).
 */
export function faceted(shape, { c = [0, 0, 0], radius = 1, count = 8, depth = 0.18, k = 0.02, seed = 1, up = 0.35 } = {}) {
  const rng = mulberry32((seed * 7919 + 17) >>> 0), nx = [], ny = [], nz = [], off = [];
  for (let i = 0; i < count; i++) {
    let x = rng() * 2 - 1, y = (rng() * 2 - 1) + up * rng(), z = rng() * 2 - 1;
    const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
    nx.push(x); ny.push(y); nz.push(z); off.push(radius * (1 - depth * rng()));
  }
  const f = shape.d, cx = c[0], cy = c[1], cz = c[2];
  const d = (x, y, z) => {
    let v = f(x, y, z);
    if (v > radius * 2) return v;
    const px = x - cx, py = y - cy, pz = z - cz;
    for (let i = 0; i < count; i++) {
      const p = px * nx[i] + py * ny[i] + pz * nz[i] - off[i];
      if (p > v - k) v = smax(v, p, k);
    }
    return v;
  };
  return { d, min: [...shape.min], max: [...shape.max], id: shape.id };
}

export function shapeUnion(a, b, k = 0) {
  const fa = a.d, fb = b.d;
  return { d: k > 0 ? (x, y, z) => smin(fa(x, y, z), fb(x, y, z), k) : (x, y, z) => { const p = fa(x, y, z), q = fb(x, y, z); return p < q ? p : q; },
    min: a.min.map((v, i) => Math.min(v, b.min[i]) - k * 0.25), max: a.max.map((v, i) => Math.max(v, b.max[i]) + k * 0.25), id: a.id };
}
export function shapeSub(a, b, k = 0) {
  const fa = a.d, fb = b.d;
  return { d: (x, y, z) => smax(fa(x, y, z), -fb(x, y, z), k), min: [...a.min], max: [...a.max], id: a.id };
}
export function shapeInter(a, b, k = 0) {
  const fa = a.d, fb = b.d;
  return { d: (x, y, z) => smax(fa(x, y, z), fb(x, y, z), k), min: a.min.map((v, i) => Math.max(v, b.min[i])), max: a.max.map((v, i) => Math.min(v, b.max[i])), id: a.id };
}

// ================================================================================================ Group
export class Group {
  /** leafSize: groups bigger than this are split into a bounding-volume tree on finish() (log-time lookups for hundreds or thousands of shapes) */
  constructor({ leafSize = 12 } = {}) {
    this.items = []; this.ids = []; this.lastId = 0; this.lastIdx = 0; this.leafSize = leafSize;
    this.min = [1e30, 1e30, 1e30]; this.max = [-1e30, -1e30, -1e30]; this.id = 0; this._done = false; this.tree = null; this.orig = null; this.passIdx = false;
  }
  /** add a Shape (or a nested Group) with a material id; M.i / lastIdx is the order of adding (0, 1, 2 ...) */
  add(shape, id = 0) {
    this.items.push(shape); this.ids.push(id); this._done = false;
    for (let k = 0; k < 3; k++) { if (shape.min[k] < this.min[k]) this.min[k] = shape.min[k]; if (shape.max[k] > this.max[k]) this.max[k] = shape.max[k]; }
    return this;
  }
  finish() {
    const n = this.items.length;
    this.n = n; this.tree = null;
    if (n > this.leafSize) {
      const build = (ids) => {
        if (ids.length <= this.leafSize) {
          const g = new Group({ leafSize: Infinity });
          for (const i of ids) g.add(this.items[i], this.ids[i]);
          g.orig = ids.slice(); return g.finish();
        }
        const mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
        for (const i of ids) for (let k = 0; k < 3; k++) { const c = (this.items[i].min[k] + this.items[i].max[k]) / 2; if (c < mn[k]) mn[k] = c; if (c > mx[k]) mx[k] = c; }
        const ax = mx[0] - mn[0] > mx[1] - mn[1] ? (mx[0] - mn[0] > mx[2] - mn[2] ? 0 : 2) : (mx[1] - mn[1] > mx[2] - mn[2] ? 1 : 2);
        const sorted = ids.slice().sort((p, q) => (this.items[p].min[ax] + this.items[p].max[ax]) - (this.items[q].min[ax] + this.items[q].max[ax]) || p - q);
        const half = sorted.length >> 1;
        const g = new Group({ leafSize: Infinity });
        g.add(build(sorted.slice(0, half)), 0).add(build(sorted.slice(half)), 0);
        g.passIdx = true; return g.finish();
      };
      this.tree = build(this.items.map((_, i) => i));
      this._done = true;
      return this;
    }
    this.fns = this.items.map((s) => (s instanceof Group ? (x, y, z) => s.d(x, y, z) : s.d));
    this.nested = this.items.map((s) => s instanceof Group);
    this.bmin = new Float64Array(n * 3); this.bmax = new Float64Array(n * 3); this.lb2 = new Float64Array(n);
    this.items.forEach((s, i) => { for (let k = 0; k < 3; k++) { this.bmin[i * 3 + k] = s.min[k]; this.bmax[i * 3 + k] = s.max[k]; } });
    this._done = true;
    return this;
  }
  d(x, y, z) {
    if (!this._done) this.finish();
    if (this.tree) { const v = this.tree.d(x, y, z); this.lastId = this.tree.lastId; this.lastIdx = this.tree.lastIdx; return v; }
    const n = this.n;
    if (n === 0) return 1e30;
    const { bmin, bmax, lb2, nested, items, ids, fns } = this;
    let bi = 0, bl = 1e30;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      let dx = bmin[j] - x; const ex = x - bmax[j]; if (ex > dx) dx = ex; if (dx < 0) dx = 0;
      let dy = bmin[j + 1] - y; const ey = y - bmax[j + 1]; if (ey > dy) dy = ey; if (dy < 0) dy = 0;
      let dz = bmin[j + 2] - z; const ez = z - bmax[j + 2]; if (ez > dz) dz = ez; if (dz < 0) dz = 0;
      const l = dx * dx + dy * dy + dz * dz;
      lb2[i] = l;
      if (l < bl) { bl = l; bi = i; }
    }
    let best = fns[bi](x, y, z), id = nested[bi] ? items[bi].lastId : ids[bi], idx = this._idx(bi);
    if (best > 0) {
      const b2 = best * best;   // from the first evaluation: conservative (may evaluate a few extra children), never wrong
      for (let i = 0; i < n; i++) {
        if (i === bi || lb2[i] >= b2) continue;
        const v = fns[i](x, y, z);
        if (v < best) { best = v; id = nested[i] ? items[i].lastId : ids[i]; idx = this._idx(i); if (best <= 0) break; }
      }
    }
    this.lastId = id; this.lastIdx = idx;
    return best;
  }
  _idx(i) {
    if (this.nested[i]) return this.passIdx ? this.items[i].lastIdx : (i << 12) ^ this.items[i].lastIdx;
    return this.orig ? this.orig[i] : i;
  }
  /** d() and record the nearest child in the material register */
  mat(x, y, z) {
    const d = this.d(x, y, z);
    if (d < M.d) { M.d = d; M.id = this.lastId; M.i = this.lastIdx; }
    return d;
  }
  /** brute force (no culling): for tests */
  dBrute(x, y, z) { let b = 1e30; for (const s of this.items) { const v = s instanceof Group ? s.dBrute(x, y, z) : s.d(x, y, z); if (v < b) b = v; } return b; }
}
