/**
 * CPU sphere-tracing renderer for SDF scenes (see tools/render3d/README.md for the scene contract).
 *
 *   render({ scene, params, w=384, h=216, ss=2, workers=os.cpus().length }) -> Promise<{ w, h, lum, emis, depth, layer, ms }>
 *        scene   a path to a scene module (tools/scenes/<name>.mjs, absolute or relative to cwd) -- required for workers > 0 --
 *                or an already built scene object (then it renders in this thread)
 *        params  passed to the module's build(params)
 *        lum Float32Array 0..1 (display luminance), emis Float32Array 0..1, depth Float32Array (metres along the ray; 1e4 = sky),
 *        layer Uint8Array (0 sky/far, 1 mid, 3 near; thresholds scene.layers = [nearMax, midMax] metres)
 *   renderSync(scene, {w,h,ss}) -> same, single thread.   prepare(scene, w, h, ss) / renderRows(ctx, y0, y1) are what workers run.
 *
 * Per sample: sphere tracing with over-relaxation (omega 1.3, falls back to plain steps on overstep) and a hit threshold that
 * widens with distance (cone tracing), tetrahedral normal at pixel-footprint scale, SDF soft shadow (penumbra from sun.softness),
 * 5-sample ambient occlusion, hemisphere ambient + bounce + rim light, exponential aerial perspective, sky for misses.
 * SSxSS regular samples per pixel are box-averaged; emissive samples are averaged separately so a glow edge keeps its grey.
 */
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { M } from './sdf.mjs';

const FAR = 1e4;

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

export function prepare(scene, W, H, SS = 2) {
  const cam = scene.camera;
  const pos = cam.pos, f = norm([cam.target[0] - pos[0], cam.target[1] - pos[1], cam.target[2] - pos[2]]);
  let up = [0, 1, 0];
  const roll = cam.roll || 0;
  let right = norm([up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]]);     // up x f: +x is screen-right when looking down +z
  let u = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const r2 = right.map((v, i) => v * c + u[i] * s), u2 = u.map((v, i) => v * c - right[i] * s); right = r2; u = u2; }
  const tanH = Math.tan((cam.fov || 40) * Math.PI / 360);
  const sun = scene.sun || {};
  const sd = norm(sun.dir || [0.5, 0.6, 0.3]);
  const sunI = typeof sun.color === 'number' ? sun.color : 1;
  const amb = scene.ambient || {};
  const sky = scene.sky || (() => 0.8);
  const hd = new Float64Array(3);
  hd[0] = f[0]; hd[1] = 0.02; hd[2] = f[2];
  const hl = Math.hypot(hd[0], hd[1], hd[2]); hd[0] /= hl; hd[1] /= hl; hd[2] /= hl;
  const emissive = new Uint8Array(256);
  for (const id of scene.emissiveMats || []) emissive[id & 255] = 1;
  const layers = scene.layers || [10, 50];
  const bounds = scene.bounds || null;
  return {
    scene, W, H, SS, map: scene.map, sky, pos, f, right, up: u, tanH, aspect: W / H, pxAngle: 2 * tanH / (H * SS),
    sd, sunI, softK: 1 / Math.max(sun.softness == null ? 0.06 : sun.softness, 0.004),
    ambSky: amb.sky == null ? 0.3 : amb.sky, ambGround: amb.ground == null ? 0.1 : amb.ground,
    rimK: scene.rim == null ? 0.15 : scene.rim, bounceK: scene.bounce == null ? 0.1 : scene.bounce,
    aoR: scene.aoRadius == null ? 0.5 : scene.aoRadius, aoK: scene.aoStrength == null ? 1 : scene.aoStrength,
    shadowDist: scene.shadowDist == null ? 40 : scene.shadowDist, shadowSteps: scene.shadowSteps || 56,
    near: scene.near == null ? 0.05 : scene.near, far: scene.far == null ? 400 : scene.far, maxSteps: scene.maxSteps || 200, omega: scene.omega || 1.3, minStep: scene.minStep == null ? 0.6 : scene.minStep,
    fogDensity: scene.fogDensity || 0, fogFall: scene.fogFall || 0, fogY0: scene.fogY0 || 0,
    fogLum: scene.fogLum != null ? scene.fogLum : sky(hd),
    emissive, layers, bounds, shift: cam.shift || [0, 0],
    hit: { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, id: 0, i: 0, a: 0, b: 0, c: 0, t: 0, vx: 0, vy: 0, vz: 1, ndl: 0, shadow: 1, ao: 1, sun: 0, hemi: 0, rim: 0, light: 0, lit: true, px: 0, py: 0 },
    dir: new Float64Array(3),
  };
}

function softShadow(ctx, px, py, pz, lx, ly, lz) {
  const map = ctx.map, k = ctx.softK, tmax = ctx.shadowDist, N = ctx.shadowSteps;
  let res = 1, t = 0.02, ph = 1e20;
  for (let i = 0; i < N; i++) {
    const h = map(px + lx * t, py + ly * t, pz + lz * t);
    if (h < 0.0004) return 0;
    const y = h * h / (2 * ph), dd = Math.sqrt(Math.max(h * h - y * y, 0)), w = t - y;
    const r = k * dd / (w > 1e-4 ? w : 1e-4);
    if (r < res) res = r;
    ph = h;
    t += h > 0.012 + t * 0.01 ? h : 0.012 + t * 0.01;
    if (res < 0.004 || t > tmax) break;
  }
  res = res < 0 ? 0 : res > 1 ? 1 : res;
  return res * res * (3 - 2 * res);
}

function ambientOcc(ctx, px, py, pz, nx, ny, nz) {
  const map = ctx.map, R = ctx.aoR;
  let occ = 0, w = 1, ws = 0;
  for (let i = 1; i <= 5; i++) {
    const h = R * i / 5;
    const d = map(px + nx * h, py + ny * h, pz + nz * h);
    const o = (h - d) / h;
    occ += (o > 0 ? o : 0) * w; ws += w; w *= 0.78;
  }
  const ao = 1 - ctx.aoK * occ / ws;
  return ao < 0 ? 0 : ao;
}

/** march one ray: returns distance t of the hit or -1. Over-relaxed sphere tracing; steps never shrink below a fraction of the pixel footprint
 *  (so grazing rays over far terrain terminate), and the hit threshold widens with distance (cone tracing). */
function trace(ctx, ox, oy, oz, dx, dy, dz, t0, t1) {
  const map = ctx.map, pa = ctx.pxAngle, N = ctx.maxSteps, minK = ctx.minStep;
  let om = ctx.omega, t = t0, tPrev = t0, rPrev = 0, relaxed = false, lastAr = 1e9;
  for (let i = 0; i < N; i++) {
    const r = map(ox + dx * t, oy + dy * t, oz + dz * t);
    const ar = r < 0 ? -r : r;
    if (relaxed && rPrev + ar < t - tPrev) { t = tPrev + rPrev; relaxed = false; continue; }   // overstepped: back to a plain sphere step
    const eps = 0.0005 + t * pa * 0.35;
    if (ar < eps) return t;
    lastAr = ar;
    tPrev = t; rPrev = ar;
    const ms = t * pa * minK;
    const st = ar * om;
    if (st > ms) { t += st; relaxed = om > 1; } else { t += ms; relaxed = false; }
    if (t > t1) return -1;
  }
  return lastAr < (0.0005 + t * pa * 0.35) * 8 ? t : -1;
}

/** shade the sample at ray distance t: fills ctx.hit and returns [lum, emis] in ctx.out */
function shadeHit(ctx, ox, oy, oz, dx, dy, dz, t, out) {
  const { map, scene, hit } = ctx;
  const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
  map(px, py, pz);
  hit.id = M.id; hit.i = M.i; hit.a = M.a; hit.b = M.b; hit.c = M.c;
  const e = Math.max(0.0006, t * ctx.pxAngle * 0.8);
  const a = map(px + e, py - e, pz - e), b = map(px - e, py - e, pz + e), c = map(px - e, py + e, pz - e), d = map(px + e, py + e, pz + e);
  let nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  hit.x = px; hit.y = py; hit.z = pz; hit.nx = nx; hit.ny = ny; hit.nz = nz; hit.t = t;
  hit.vx = -dx; hit.vy = -dy; hit.vz = -dz;
  const emissiveMat = ctx.emissive[hit.id & 255] === 1;
  let ndl = 0, shadow = 1, ao = 1, sunT = 0, hemi = 0, rim = 0, light = 1;
  if (!emissiveMat) {
    const [lx, ly, lz] = ctx.sd;
    ndl = nx * lx + ny * ly + nz * lz;
    const bias = 0.012 + t * ctx.pxAngle * 0.8;
    if (ndl > 0.01) shadow = softShadow(ctx, px + nx * bias, py + ny * bias, pz + nz * bias, lx, ly, lz); else shadow = 0;
    ao = ambientOcc(ctx, px, py, pz, nx, ny, nz);
    sunT = (ndl > 0 ? ndl : 0) * shadow * ctx.sunI;
    hemi = (ctx.ambGround + (ctx.ambSky - ctx.ambGround) * (0.5 + 0.5 * ny)) * ao;
    const bounce = ctx.bounceK * (ndl < 0 ? -ndl : 0) * ao;
    const nv = nx * hit.vx + ny * hit.vy + nz * hit.vz, fr = 1 - (nv > 0 ? nv : 0);
    rim = ctx.rimK * fr * fr * fr * (0.4 + 0.6 * (ny > 0 ? ny : 0)) * (0.3 + 0.7 * ao);
    light = sunT + hemi + bounce + rim;
  }
  hit.ndl = ndl; hit.shadow = shadow; hit.ao = ao; hit.sun = sunT; hit.hemi = hemi; hit.rim = rim; hit.light = light; hit.lit = !emissiveMat;
  let lum, emis = 0;
  if (scene.shade) {
    const s = scene.shade(hit);
    if (typeof s === 'number') lum = s; else { lum = s.lum; emis = s.emissive || 0; }
  } else lum = 0.5 * light;
  if (ctx.fogDensity > 0) {
    const ym = (oy + py) * 0.5;
    const dens = ctx.fogDensity * (ctx.fogFall > 0 ? Math.exp(-ctx.fogFall * Math.max(ym - ctx.fogY0, 0)) : 1);
    const fg = 1 - Math.exp(-dens * t);
    lum += (ctx.fogLum - lum) * fg;
    emis *= 1 - fg;
  }
  out[0] = lum; out[1] = emis;
}

/** rows y0..y1-1 of the final image. Returns { lum, emis, depth, layer } (typed arrays of W*(y1-y0)). */
export function renderRows(ctx, y0, y1) {
  const { W, SS, scene, pos, f, right, up, tanH, aspect, hit, dir } = ctx;
  const H = ctx.H, n = W * (y1 - y0);
  const lumO = new Float32Array(n), emisO = new Float32Array(n), depthO = new Float32Array(n), layerO = new Uint8Array(n);
  const out = [0, 0], inv = 1 / SS, cnt = SS * SS;
  const [nearMax, midMax] = ctx.layers;
  const bd = ctx.bounds;
  const ox = pos[0], oy = pos[1], oz = pos[2];
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < W; x++) {
      let lumNE = 0, nNE = 0, lumE = 0, nE = 0, emisS = 0, dSum = 0, nHit = 0, dMin = FAR;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = ((x + (sx + 0.5) * inv) / W * 2 - 1 + ctx.shift[0]) * tanH * aspect;
        const v = (1 - (y + (sy + 0.5) * inv) / H * 2 + ctx.shift[1]) * tanH;
        let dx = f[0] + right[0] * u + up[0] * v, dy = f[1] + right[1] * u + up[1] * v, dz = f[2] + right[2] * u + up[2] * v;
        const l = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx *= l; dy *= l; dz *= l;
        let t0 = ctx.near, t1 = ctx.far, ok = true;
        if (bd) {
          let a = t0, b = t1;
          for (let k = 0; k < 3 && ok; k++) {
            const o = k === 0 ? ox : k === 1 ? oy : oz, d = k === 0 ? dx : k === 1 ? dy : dz;
            if (Math.abs(d) < 1e-9) { if (o < bd.min[k] || o > bd.max[k]) ok = false; continue; }
            let ta = (bd.min[k] - o) / d, tb = (bd.max[k] - o) / d;
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > a) a = ta; if (tb < b) b = tb;
            if (a > b) ok = false;
          }
          t0 = a; t1 = b;
        }
        const t = ok ? trace(ctx, ox, oy, oz, dx, dy, dz, t0, t1) : -1;
        if (t < 0) {
          dir[0] = dx; dir[1] = dy; dir[2] = dz;
          lumNE += ctx.sky(dir); nNE++;
        } else {
          shadeHit(ctx, ox, oy, oz, dx, dy, dz, t, out);
          nHit++; dSum += t; if (t < dMin) dMin = t;
          if (out[1] > 0) { lumE += out[0]; nE++; emisS += out[1] > 1 ? 1 : out[1]; } else { lumNE += out[0]; nNE++; }
        }
      }
      const i = (y - y0) * W + x;
      lumO[i] = nNE > 0 ? lumNE / nNE : lumE / nE;
      emisO[i] = emisS / cnt;
      if (nHit * 2 >= cnt) { depthO[i] = dSum / nHit; layerO[i] = dMin <= nearMax ? 3 : dMin <= midMax ? 1 : 0; } else { depthO[i] = FAR; layerO[i] = 0; }
    }
  }
  return { lum: lumO, emis: emisO, depth: depthO, layer: layerO };
}

export function renderSync(scene, { w = 384, h = 216, ss = 2 } = {}) {
  const t0 = process.hrtime.bigint();
  const ctx = prepare(scene, w, h, ss);
  const r = renderRows(ctx, 0, h);
  return { w, h, ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

export async function render({ scene, params = {}, w = 384, h = 216, ss = 2, workers = os.cpus().length, onProgress } = {}) {
  const t0 = process.hrtime.bigint();
  if (typeof scene !== 'string' || workers <= 0) {
    let s = scene;
    if (typeof s === 'string') { const mod = await import(pathToFileURL(path.resolve(s)).href); s = mod.build(params); }
    const r = renderSync(s, { w, h, ss });
    return r;
  }
  const url = pathToFileURL(path.resolve(scene)).href;
  const out = { w, h, lum: new Float32Array(w * h), emis: new Float32Array(w * h), depth: new Float32Array(w * h), layer: new Uint8Array(w * h) };
  const strip = 3, tasks = [];
  for (let y = 0; y < h; y += strip) tasks.push([y, Math.min(h, y + strip)]);
  let next = 0, done = 0;
  const wurl = new URL('./worker.mjs', import.meta.url);
  const nW = Math.min(workers, tasks.length);
  await new Promise((resolve, reject) => {
    const pool = [];
    const finish = (err) => { for (const wk of pool) wk.terminate(); err ? reject(err) : resolve(); };
    for (let k = 0; k < nW; k++) {
      const wk = new Worker(wurl, { workerData: { url, params, w, h, ss } });
      pool.push(wk);
      const give = () => { if (next < tasks.length) wk.postMessage({ y0: tasks[next][0], y1: tasks[next][1] }), next++; };
      wk.on('message', (m) => {
        if (m.ready) { give(); return; }
        const o = m.y0 * w;
        out.lum.set(m.lum, o); out.emis.set(m.emis, o); out.depth.set(m.depth, o); out.layer.set(m.layer, o);
        done++;
        if (onProgress) onProgress(done / tasks.length);
        if (done === tasks.length) finish(); else give();
      });
      wk.on('error', finish);
    }
  });
  out.ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return out;
}
