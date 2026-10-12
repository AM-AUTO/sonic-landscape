/**
 * Sculpt toolkit `T` handed to LevelDef.sculpt(T).
 *
 * All primitives operate in place on one Float32Array heightfield (meters,
 * index y*size+x) and are order-dependent: later calls build on earlier ones.
 * Distances/radii are in CELLS (40 m each); heights are in METERS.
 *
 * Polylines are [[x,y],...] or [[x,y,z],...]; the optional third value is a
 * per-point parameter (floor height for carveGlen, crest height for ridge) that
 * is interpolated along the line. Lines are smoothed with Catmull-Rom splines.
 */
import { MAP_SIZE as S } from './codes.js';
import { Rng } from '../core/rng.js';
import { createNoise } from '../core/noise.js';

const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Catmull-Rom densify. Returns {x,y,z,u} arrays (z NaN where unspecified, u = arc length). */
export function densify(points, step = 2) {
  const n = points.length;
  const xs = [], ys = [], zs = [], us = [];
  if (n === 0) return { x: xs, y: ys, z: zs, u: us };
  const P = (i) => points[clamp(i, 0, n - 1)];
  let u = 0, px = 0, py = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(len / step));
    const z1 = p1[2] === undefined ? NaN : p1[2];
    const z2 = p2[2] === undefined ? NaN : p2[2];
    for (let k = 0; k < m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      if (xs.length) u += Math.hypot(x - px, y - py);
      px = x; py = y;
      xs.push(x); ys.push(y); zs.push(z1 + (z2 - z1) * t); us.push(u);
    }
  }
  const last = points[n - 1];
  if (xs.length) u += Math.hypot(last[0] - px, last[1] - py);
  xs.push(last[0]); ys.push(last[1]); zs.push(last[2] === undefined ? NaN : last[2]); us.push(u);
  return { x: xs, y: ys, z: zs, u: us };
}

/** Displace a polyline sideways by smooth noise so straight spurs/glens gain organic bends. */
function wiggle(points, amp, noise, wavelength = 22, salt = 0) {
  if (!amp) return points;
  const d = densify(points, 3);
  const n = d.x.length, out = [];
  for (let k = 0; k < n; k++) {
    const k0 = Math.max(0, k - 1), k1 = Math.min(n - 1, k + 1);
    let tx = d.x[k1] - d.x[k0], ty = d.y[k1] - d.y[k0];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const edge = Math.min(1, k / 3, (n - 1 - k) / 3); // keep end points fixed
    const off = amp * edge * (noise.noise2(d.u[k] / wavelength + salt * 3.7, salt * 1.9 + 0.5) + 0.35 * noise.noise2(d.u[k] / (wavelength * 0.4) + 7, salt));
    const z = d.z[k];
    out.push(Number.isNaN(z) ? [d.x[k] - ty * off, d.y[k] + tx * off] : [d.x[k] - ty * off, d.y[k] + tx * off, z]);
  }
  return out;
}

export function createSculptKit(levelDef) {
  const seed = levelDef.seed | 0;
  const noise = createNoise(seed);
  const rng = new Rng(seed ^ 0x9e3779b9);
  const h = new Float32Array(S * S);
  const bodyMask = new Uint16Array(S * S); // body index + 1
  const bodies = [];
  const paths = [];
  const labels = [];

  // scratch for polyline distance fields
  const fd = new Float32Array(S * S);
  const fz = new Float32Array(S * S);
  const fu = new Float32Array(S * S);

  /** Distance (cells) from each cell to the polyline, within `radius`. Result lives in shared scratch. */
  function lineField(points, radius, step = 2) {
    const d = densify(points, step);
    fd.fill(Infinity);
    const n = d.x.length;
    let bx0 = S, by0 = S, bx1 = -1, by1 = -1;
    const R = Math.ceil(radius) + 1;
    for (let s = 0; s < Math.max(1, n - 1); s++) {
      const ax = d.x[s], ay = d.y[s];
      const bx = d.x[Math.min(s + 1, n - 1)], by = d.y[Math.min(s + 1, n - 1)];
      const za = d.z[s], zb = d.z[Math.min(s + 1, n - 1)];
      const ua = d.u[s], ub = d.u[Math.min(s + 1, n - 1)];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - R), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx)) + R);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by)) - R), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by)) + R);
      if (x0 < bx0) bx0 = x0; if (y0 < by0) by0 = y0; if (x1 > bx1) bx1 = x1; if (y1 > by1) by1 = y1;
      const vx = bx - ax, vy = by - ay;
      const l2 = vx * vx + vy * vy || 1e-9;
      const r2 = R * R;
      for (let y = y0; y <= y1; y++) {
        const row = y * S;
        for (let x = x0; x <= x1; x++) {
          const px = x - ax, py = y - ay;
          let t = (px * vx + py * vy) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = px - vx * t, dy = py - vy * t;
          const d2 = dx * dx + dy * dy;
          if (d2 < r2 && d2 < fd[row + x]) {
            fd[row + x] = d2;
            fz[row + x] = za + (zb - za) * t;
            fu[row + x] = ua + (ub - ua) * t;
          }
        }
      }
    }
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = y * S + x;
      if (fd[i] !== Infinity) fd[i] = Math.sqrt(fd[i]);
    }
    return { d: fd, z: fz, u: fu, x0: bx0, y0: by0, x1: bx1, y1: by1 };
  }

  const nz = (x, y, f = 0.07) => noise.noise2(x * f + 11.7, y * f - 3.3);

  function heightAt(x, y) {
    x = clamp(x, 0, S - 1); y = clamp(y, 0, S - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(S - 1, x0 + 1), y1 = Math.min(S - 1, y0 + 1);
    const fx = x - x0, fy = y - y0;
    const a = h[y0 * S + x0], b = h[y0 * S + x1], c = h[y1 * S + x0], d = h[y1 * S + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  const T = {
    size: S,
    rng,
    noise,
    height: h,
    heightAt,
    util: { smoothstep: smooth01, clamp },

    /** Distance-to-polyline field (copy), handy for masks. */
    lineDist(points, radius = 40) {
      lineField(points, radius);
      return new Float32Array(fd);
    },

    /** Circles {x,y,r} spaced along a polyline, for T.lochans({avoid}). */
    avoidAlong(points, r = 5, step = 4) {
      const d = densify(points, step);
      return d.x.map((x, i) => ({ x, y: d.y[i], r }));
    },

    fill(v) { h.fill(v); },

    /**
     * Add noise. scale = wavelength in cells, amp in meters (zero-mean).
     * ridged: use ridged multifractal (creases). warp: domain-warp amount in cells.
     * mask: (x,y,h)=>0..1 or Float32Array(size*size).
     */
    addNoise({ scale = 32, amp = 10, octaves = 4, ridged = false, warp = 0, mask = null, lacunarity = 2, gain = 0.5, offset = 0 } = {}) {
      const finest = scale / Math.pow(lacunarity, octaves - 1);
      const step = warp > 0 ? 1 : clamp(Math.floor(finest / 4), 1, 4);
      const inv = 1 / scale;
      const o = offset * 13.7 + 100;
      const sample = (x, y) => {
        let sx = x, sy = y;
        if (warp > 0) { const w = noise.warp(x, y, warp); sx = w.x; sy = w.y; }
        const nx = sx * inv + o, ny = sy * inv + o;
        return ridged
          ? (noise.ridged(nx, ny, octaves, lacunarity, gain) * 2 - 1)
          : noise.fbm(nx, ny, octaves, lacunarity, gain) * 1.6;
      };
      const isFn = typeof mask === 'function';
      const apply = (x, y, v) => {
        const i = y * S + x;
        let w = 1;
        if (mask) w = isFn ? mask(x, y, h[i]) : mask[i];
        if (w > 0) h[i] += v * amp * w;
      };
      if (step === 1) {
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) apply(x, y, sample(x, y));
        return;
      }
      const G = Math.ceil((S - 1) / step) + 1;
      const grid = new Float32Array(G * G);
      for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) grid[gy * G + gx] = sample(gx * step, gy * step);
      for (let y = 0; y < S; y++) {
        const fy = y / step, gy = Math.floor(fy), ty = fy - gy;
        const gy1 = Math.min(G - 1, gy + 1);
        for (let x = 0; x < S; x++) {
          const fx = x / step, gx = Math.floor(fx), tx = fx - gx;
          const gx1 = Math.min(G - 1, gx + 1);
          const a = grid[gy * G + gx], b = grid[gy * G + gx1], c = grid[gy1 * G + gx], d = grid[gy1 * G + gx1];
          apply(x, y, (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
        }
      }
    },

    /**
     * Carve a glen along a polyline. width = half-width in cells (where the cut fades out).
     * floor: absolute floor height (number) — or give per-point z in `points`.
     * depth: optional cap on how far below the existing ground the floor may cut.
     * profile 'U' (flat floor, steep walls) or 'V'.
     */
    carveGlen({ points, width = 14, depth = null, floor = null, profile = 'U', flat = 0.35, wobble = 0.4, raise = false, meander = 0 }) {
      points = wiggle(points, meander, noise, 30, points[0][0] * 0.7 + points[0][1]);
      const f = lineField(points, width * (1 + wobble * 0.5) + 2);
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
        const i = y * S + x;
        let d = fd[i];
        if (d === Infinity) continue;
        d += wobble * width * 0.5 * nz(x, y, 0.06);
        const t = d / width;
        if (t >= 1) continue;
        const tt = t < 0 ? 0 : t;
        const w = profile === 'V' ? Math.pow(1 - tt, 1.25) : 1 - smooth01((tt - flat) / (1 - flat));
        let target = fz[i];
        if (Number.isNaN(target)) target = floor !== null ? floor : h[i] - (depth ?? 20);
        if (depth !== null) target = Math.max(target, h[i] - depth);
        if (!raise && target > h[i]) continue;
        h[i] += (target - h[i]) * w;
      }
    },

    /** Raised spine. height (or per-point z) = crest height added; jagged 0..1+ adds teeth. */
    ridge({ points, width = 8, height = 200, sharpness = 1, jagged = 0.3, wobble = 0.3, meander = 0 }) {
      points = wiggle(points, meander, noise, 24, points[0][0] + points[0][1]);
      const f = lineField(points, width * (1 + jagged * 0.6) + 3);
      const expo = 0.6 + sharpness * 0.9;
      for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) {
        const i = y * S + x;
        const d0 = fd[i];
        if (d0 === Infinity) continue;
        const wn = nz(x, y, 0.16);
        const d = d0 * (1 + jagged * 0.55 * wn) + wobble * width * 0.4 * nz(x, y, 0.05);
        const t = d / width;
        if (t >= 1) continue;
        const crest = Number.isNaN(fz[i]) ? height : fz[i];
        const u = fu[i];
        let tooth = 1;
        if (jagged > 0) {
          tooth = 1 + jagged * (0.6 * noise.noise2(u * 0.2 + 3.1, 7.7) + 0.5 * (noise.ridged(x * 0.13, y * 0.13, 3) - 0.45) * 2);
          if (tooth < 0.2) tooth = 0.2;
        }
        h[i] += crest * Math.pow(1 - (t < 0 ? 0 : t), expo) * tooth;
      }
    },

    /** Dome / inselberg. steep 0 = smooth bell, 1+ = flat-topped steep-sided. rx/ry/angle for elongation. */
    dome({ x, y, radius = 20, rx = null, ry = null, angle = 0, height = 100, steep = 0.3, warp = 0.25, jagged = 0 }) {
      const a = rx ?? radius, b = ry ?? radius;
      const R = Math.ceil(Math.max(a, b) * (1 + warp) + 2);
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const ex = 1 / (1 + 2 * steep);
      for (let yy = Math.max(0, Math.floor(y) - R); yy <= Math.min(S - 1, Math.floor(y) + R); yy++) {
        for (let xx = Math.max(0, Math.floor(x) - R); xx <= Math.min(S - 1, Math.floor(x) + R); xx++) {
          const dx = xx - x, dy = yy - y;
          const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
          let e = Math.hypot(u / a, v / b);
          e *= 1 + warp * nz(xx, yy, 0.05) + (jagged ? jagged * 0.2 * nz(xx, yy, 0.1) : 0);
          if (e >= 1) continue;
          const p = Math.pow(smooth01(1 - e), ex);
          let add = height * p;
          if (jagged) add *= 1 + jagged * 0.35 * noise.ridged(xx * 0.11, yy * 0.11, 3) * p;
          h[yy * S + xx] += add;
        }
      }
    },

    /** Flat-topped high ground blending to `height` (absolute m) over `edge` cells. */
    plateau({ x, y, rx = 40, ry = 40, angle = 0, height = 1000, edge = 12, rough = 0.18, keepHigher = true }) {
      const R = Math.ceil(Math.max(rx, ry) * (1 + rough) + 2);
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const inner = Math.max(0, 1 - edge / Math.min(rx, ry));
      for (let yy = Math.max(0, Math.floor(y) - R); yy <= Math.min(S - 1, Math.floor(y) + R); yy++) {
        for (let xx = Math.max(0, Math.floor(x) - R); xx <= Math.min(S - 1, Math.floor(x) + R); xx++) {
          const dx = xx - x, dy = yy - y;
          const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
          let e = Math.hypot(u / rx, v / ry);
          e *= 1 + rough * (0.7 * nz(xx, yy, 0.045) + 0.3 * nz(xx, yy, 0.13));
          if (e >= 1) continue;
          const w = 1 - smooth01((e - inner) / (1 - inner || 1));
          const i = yy * S + xx;
          if (height > h[i] || !keepHigher) h[i] += (height - h[i]) * w;
        }
      }
    },

    /** Bowl biting into a slope, open toward angle `open` (radians; 0 east, +PI/2 south). */
    corrie({ x, y, radius = 12, depth = 80, open = 0, floorSlope = 1.2 }) {
      const base = heightAt(x, y);
      const dxo = Math.cos(open), dyo = Math.sin(open);
      const R = Math.ceil(radius * 1.5) + 2;
      for (let yy = Math.max(0, Math.floor(y) - R); yy <= Math.min(S - 1, Math.floor(y) + R); yy++) {
        for (let xx = Math.max(0, Math.floor(x) - R); xx <= Math.min(S - 1, Math.floor(x) + R); xx++) {
          const dx = xx - x, dy = yy - y;
          const along = dx * dxo + dy * dyo;
          const across = -dx * dyo + dy * dxo;
          const ra = along > 0 ? radius * 1.4 : radius * 0.85;
          let e = Math.hypot(along / ra, across / (radius * 0.9));
          e *= 1 + 0.12 * nz(xx, yy, 0.12);
          if (e >= 1) continue;
          const w = along < 0 ? 1 - smooth01((e - 0.8) / 0.2) : 1 - smooth01((e - 0.45) / 0.55);
          const floorH = base - depth - along * floorSlope;
          const i = yy * S + xx;
          if (floorH < h[i]) h[i] += (floorH - h[i]) * w;
        }
      }
    },

    /**
     * Flooded basin. Either points + width (half-width, cells) for elongated lochs, or x,y,rx,ry[,angle].
     * level: water surface (m). depth: max depth below level. sea: drains as the ocean (outlet for streams).
     * shallow: width (cells) of the wadeable rim.
     */
    loch(opts) { return makeBody(opts); },

    /** Scatter many small water bodies (peaty lochans). Returns count placed. */
    lochans({ count = 20, area = { x0: 0, y0: 0, x1: S - 1, y1: S - 1 }, rmin = 2, rmax = 6, avoid = [], depth = 1.4, spacing = 2, prefer = 'flat', tries = 8, aspect = 1.9, shallow = 2 }) {
      let placed = 0;
      const mine = [];
      for (let n = 0; n < count; n++) {
        let best = null, bestScore = Infinity;
        for (let k = 0; k < tries; k++) {
          const r = rmin + (rmax - rmin) * Math.pow(rng.float(), 1.8);
          const cx = rng.range(area.x0, area.x1), cy = rng.range(area.y0, area.y1);
          const asp = 1 + (aspect - 1) * rng.float();
          const ra = r * Math.sqrt(asp), rb = r / Math.sqrt(asp);
          const m = Math.ceil(ra * 1.3) + 4;
          if (cx < m || cy < m || cx > S - 1 - m || cy > S - 1 - m) continue;
          let bad = false;
          for (const o of mine) if (Math.hypot(o.x - cx, o.y - cy) < o.r + ra + spacing) { bad = true; break; }
          if (bad) continue;
          for (const o of avoid) if (Math.hypot(o.x - cx, o.y - cy) < (o.r || 6) + ra) { bad = true; break; }
          if (bad) continue;
          // reject if it would overlap a previously declared body
          const ix = Math.round(cx), iy = Math.round(cy), rr = Math.ceil(ra) + 2;
          for (let yy = iy - rr; yy <= iy + rr && !bad; yy += 2) for (let xx = ix - rr; xx <= ix + rr; xx += 2) {
            if (bodyMask[yy * S + xx]) { bad = true; break; }
          }
          if (bad) continue;
          let mn = Infinity, mx = -Infinity;
          for (let a = 0; a < 8; a++) {
            const hh = heightAt(cx + Math.cos(a * 0.785) * ra, cy + Math.sin(a * 0.785) * ra);
            if (hh < mn) mn = hh; if (hh > mx) mx = hh;
          }
          const score = prefer === 'low' ? mn + (mx - mn) * 0.3 : mx - mn;
          if (score < bestScore) { bestScore = score; best = { cx, cy, r, ra, rb, angle: rng.range(0, Math.PI), mn }; }
        }
        if (!best) continue;
        mine.push({ x: best.cx, y: best.cy, r: best.ra });
        makeBody({ x: best.cx, y: best.cy, rx: best.ra, ry: best.rb, angle: best.angle, level: best.mn - 0.3, depth, kind: 'lochan', shore: 2, shallow, wobble: 0.3 });
        placed++;
      }
      return placed;
    },

    /** Sandstone-style steps: quantise heights into treads and risers. */
    terrace({ step = 60, strength = 0.8, sharp = 0.4, mask = null }) {
      const isFn = typeof mask === 'function';
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        let w = strength;
        if (mask) w *= isFn ? mask(x, y, h[i]) : mask[i];
        if (w <= 0) continue;
        const q = h[i] / step, fl = Math.floor(q), fr = q - fl;
        const s = smooth01((fr - (1 - sharp) / 2) / sharp);
        h[i] += ((fl + s) * step - h[i]) * w;
      }
    },

    /** Register a footpath polyline (burned into cover as PATH; always passable). */
    path(points, opts = {}) { paths.push({ points: points.map((p) => [p[0], p[1]]), width: opts.width || 1 }); },

    label(x, y, text, kind = 'feature') { labels.push({ x, y, text, kind }); },

    /** Box-blur the heightfield. */
    smooth(passes = 1) {
      const tmp = new Float32Array(S * S);
      for (let p = 0; p < passes; p++) {
        for (let y = 0; y < S; y++) {
          const r = y * S;
          for (let x = 0; x < S; x++) {
            const a = h[r + (x > 0 ? x - 1 : 0)], b = h[r + x], c = h[r + (x < S - 1 ? x + 1 : x)];
            tmp[r + x] = (a + b + c) / 3;
          }
        }
        for (let y = 0; y < S; y++) {
          const ru = (y > 0 ? y - 1 : 0) * S, r = y * S, rd = (y < S - 1 ? y + 1 : y) * S;
          for (let x = 0; x < S; x++) h[r + x] = (tmp[ru + x] + tmp[r + x] + tmp[rd + x]) / 3;
        }
      }
    },

    /**
     * Linearly compress/stretch everything above `knee` so the tallest point becomes exactly `max`
     * (keeps ordering and avoids the flat tops a hard clamp would leave).
     */
    fitMax(max, knee) {
      let top = -Infinity;
      for (let i = 0; i < h.length; i++) if (h[i] > top) top = h[i];
      if (top <= knee) return;
      const k = (max - knee) / (top - knee);
      for (let i = 0; i < h.length; i++) if (h[i] > knee) h[i] = knee + (h[i] - knee) * k;
    },

    /**
     * Pin a named summit to a real elevation: finds the local high within `search` cells of (x,y) and
     * lifts/lowers a smooth patch of `radius` cells so that top reads exactly `height` metres.
     */
    peak({ x, y, height, radius = 10, search = 6 }) {
      let bi = -1, bh = -Infinity;
      for (let yy = Math.max(0, Math.round(y) - search); yy <= Math.min(S - 1, Math.round(y) + search); yy++) {
        for (let xx = Math.max(0, Math.round(x) - search); xx <= Math.min(S - 1, Math.round(x) + search); xx++) {
          if (h[yy * S + xx] > bh) { bh = h[yy * S + xx]; bi = yy * S + xx; }
        }
      }
      const delta = height - bh, cx = bi % S, cy = (bi / S) | 0;
      for (let yy = Math.max(0, cy - radius); yy <= Math.min(S - 1, cy + radius); yy++) {
        for (let xx = Math.max(0, cx - radius); xx <= Math.min(S - 1, cx + radius); xx++) {
          const d = Math.hypot(xx - cx, yy - cy) / radius;
          if (d >= 1) continue;
          const w = 0.5 + 0.5 * Math.cos(Math.PI * d);
          h[yy * S + xx] += delta * w;
        }
      }
    },

    clampTo(min, max) {
      for (let i = 0; i < h.length; i++) h[i] = h[i] < min ? min : h[i] > max ? max : h[i];
    },
  };

  /** Shared implementation for loch / lochan. */
  function makeBody(o) {
    const kind = o.kind || 'loch';
    const sea = !!o.sea;
    const depth = o.depth ?? 6;
    const shore = o.shore ?? 5;
    const wobble = o.wobble ?? 0.35;
    const shallow = o.shallow ?? 2;
    let x0, y0, x1, y1, inside; // inside(x,y,i) -> {e, out} via closure
    let level = o.level;
    let fieldCache = null, halfW = 0, ellipse = null;

    if (o.points) {
      halfW = o.width ?? 6;
      fieldCache = lineField(o.points, halfW * (1 + wobble * 0.5) + shore + 2);
      x0 = fieldCache.x0; y0 = fieldCache.y0; x1 = fieldCache.x1; y1 = fieldCache.y1;
      if (level === undefined) {
        let mn = Infinity;
        for (const p of o.points) mn = Math.min(mn, heightAt(p[0], p[1]));
        level = mn - 0.5;
      }
    } else {
      const a = o.rx ?? o.radius ?? 8, b = o.ry ?? o.radius ?? 8;
      const R = Math.ceil(Math.max(a, b) * (1 + wobble) + shore + 2);
      ellipse = { a, b, ca: Math.cos(o.angle || 0), sa: Math.sin(o.angle || 0) };
      x0 = Math.max(0, Math.floor(o.x) - R); x1 = Math.min(S - 1, Math.floor(o.x) + R);
      y0 = Math.max(0, Math.floor(o.y) - R); y1 = Math.min(S - 1, Math.floor(o.y) + R);
      if (level === undefined) level = heightAt(o.x, o.y) - 0.5;
    }
    const id = bodies.length + 1;
    bodies.push({ id, kind, level, depth, sea, shallow, shore });
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * S + x;
      let e, outCells;
      if (fieldCache) {
        const d = fd[i];
        if (d === Infinity) continue;
        const de = d + wobble * halfW * 0.5 * nz(x, y, 0.09);
        e = de / halfW; outCells = de - halfW;
      } else {
        const dx = x - o.x, dy = y - o.y;
        const u = dx * ellipse.ca + dy * ellipse.sa, v = -dx * ellipse.sa + dy * ellipse.ca;
        e = Math.hypot(u / ellipse.a, v / ellipse.b) * (1 + wobble * 0.5 * nz(x, y, 0.13));
        outCells = (e - 1) * Math.min(ellipse.a, ellipse.b);
      }
      if (e < 1) {
        const bowl = smooth01((1 - e) / 0.6);
        h[i] = level - 0.3 - depth * bowl;
        bodyMask[i] = id;
      } else if (outCells < shore) {
        // dam: keep the ground around the water at/above the surface so it holds
        const rim = level + 0.4 + 0.3 * outCells;
        if (h[i] < rim && !bodyMask[i]) h[i] = rim;
      }
    }
    return { id, level };
  }

  return { T, state: { h, bodyMask, bodies, paths, labels, noise } };
}
