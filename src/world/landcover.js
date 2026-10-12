/**
 * Land-cover assignment from height, slope, water and flow.
 *
 * Params (levelDef.cover), all optional:
 *   treeline, woodDensity (0..1), woodSlope, woodMin     — woodland band
 *   bogFlatness (max slope), bogMax (max height), bogAmount (0..1)
 *   snowline (null = none), snowSlope
 *   rockline (default treeline+260), rockAmount
 *   cragSlope (slope above which ground is CRAG), cragJitter, cragMinH, cragMaxH
 *   screeSlope, screeBand (cells below crags), screeMinH
 *   streamThreshold, riverThreshold
 *   adjust(x, y, h, slope, cover) -> cover | undefined — per-level override hook
 */
import { COVER, MAP_SIZE as S, CELL_METERS } from './codes.js';
import { WATER_SHALLOW, WATER_DEEP } from './hydro.js';

/** Slope magnitude (rise/run) per cell via central differences. */
export function computeSlope(h) {
  const slope = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const ym = y > 0 ? y - 1 : 0, yp = y < S - 1 ? y + 1 : y;
    for (let x = 0; x < S; x++) {
      const xm = x > 0 ? x - 1 : 0, xp = x < S - 1 ? x + 1 : x;
      const gx = (h[y * S + xp] - h[y * S + xm]) / ((xp - xm) * CELL_METERS);
      const gy = (h[yp * S + x] - h[ym * S + x]) / ((yp - ym) * CELL_METERS);
      slope[y * S + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return slope;
}

export function assignCover({ h, slope, water, acc, noise, params }) {
  const N = S * S;
  const P = params || {};
  const treeline = P.treeline ?? 450;
  const woodDensity = P.woodDensity ?? 0.3;
  const woodSlope = P.woodSlope ?? 0.55;
  const woodMin = P.woodMin ?? -1e9;
  const bogFlat = P.bogFlatness ?? 0.04;
  const bogMax = P.bogMax ?? treeline;
  const bogAmount = P.bogAmount ?? 0.55;
  const snowline = P.snowline ?? null;
  const snowSlope = P.snowSlope ?? 0.95;
  const rockline = P.rockline ?? treeline + 260;
  const rockAmount = P.rockAmount ?? 0.5;
  const cragSlope = P.cragSlope ?? 0.9;
  const cragJitter = P.cragJitter ?? 0.12;
  const cragMinH = P.cragMinH ?? -1e9;
  const cragMaxH = P.cragMaxH ?? 1e9;
  const screeSlope = P.screeSlope ?? 0.6;
  const screeBand = P.screeBand ?? 3;
  const screeMinH = P.screeMinH ?? treeline - 120;
  const riverThreshold = P.riverThreshold ?? 2400;
  const cragBand = P.cragBand ?? 55;       // metres: vertical spacing of crag ledges
  const cragStrata = P.cragStrata ?? 0.3;  // how strongly crag is confined to ledge bands
  const cragGap = P.cragGap ?? 0;   // 0..1: fraction of crag cells opened into gullies
  const adjust = P.adjust;

  const cover = new Uint8Array(N);
  const nz = noise.noise2;

  // pass 1: crags — organic bands on the steepest faces. Slope is lightly blurred so single steep
  // cells don't speckle; concave cells (gullies running down the fall line) are carved out of the bands,
  // leaving convex buttresses; tiny fragments are demoted to scree.
  const slopeS = new Float32Array(N);
  const conc = new Float32Array(N); // mean of a ring at r=3 minus centre: >0 where the ground is concave
  const RX = [3, 2, 0, -2, -3, -2, 0, 2], RY = [0, 2, 3, 2, 0, -2, -3, -2];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    let a = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
      a += slope[yy * S + xx] * (dx || dy ? 1 : 2); c += dx || dy ? 1 : 2;
    }
    slopeS[i] = a / c;
    let r = 0;
    for (let k = 0; k < 8; k++) {
      const xx = Math.min(S - 1, Math.max(0, x + RX[k])), yy = Math.min(S - 1, Math.max(0, y + RY[k]));
      r += h[yy * S + xx];
    }
    conc[i] = r / 8 - h[i];
  }
  const gullyT = P.gullyT ?? 2.2;   // metres of concavity above which a steep cell is a gully, not cliff
  const crag = new Uint8Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (water[i]) continue;
    const hh = h[i];
    if (hh < cragMinH || hh > cragMaxH) continue;
    // strata: crag forms ledges that follow the contours (alternating bands of cliff and scree/grass),
    // with a slowly varying phase so the bands drift and break up
    const strata = 0.5 + 0.5 * Math.sin(6.2832 * hh / cragBand + 2.2 * nz(x * 0.045 + 5, y * 0.045 - 17));
    const thr = cragSlope + cragJitter * nz(x * 0.11 + 40, y * 0.11 + 7) + cragStrata * (1 - strata);
    if (slopeS[i] <= thr) continue;
    // gullies: concave ground, scaled with a noise so some faces are solid and others deeply cut
    const gt = gullyT * (1.5 + 1.2 * nz(x * 0.06 + 21, y * 0.06 - 9)) * (1 - cragGap * 0.8);
    if (conc[i] > gt) continue;
    if (cragGap > 0 && nz(x * 0.09 + 21, y * 0.09 - 9) < (cragGap * 2 - 1) * 0.9) continue;
    crag[i] = 1;
  }
  // closing: bridge 1-cell breaks so ledges read as continuous bands (only on genuinely steep ground)
  {
    const dil = new Uint8Array(N);
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (crag[i]) { dil[i] = 1; continue; }
      if (water[i] || slopeS[i] < cragSlope * 0.7) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (crag[i + dy * S + dx]) n++;
      if (n >= 3 && conc[i] <= gullyT * 1.5) dil[i] = 1;
    }
    for (let i = 0; i < N; i++) crag[i] = dil[i];
  }
  // demote fragments smaller than 12 cells (8-connected components) to scree
  {
    const seen = new Uint8Array(N), stack = new Int32Array(N);
    for (let i0 = 0; i0 < N; i0++) {
      if (!crag[i0] || seen[i0]) continue;
      let sp = 0, cnt = 0;
      const members = [];
      stack[sp++] = i0; seen[i0] = 1;
      while (sp) {
        const c = stack[--sp]; cnt++; members.push(c);
        const cx = c % S, cy = (c / S) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
          const ni = ny * S + nx;
          if (crag[ni] && !seen[ni]) { seen[ni] = 1; stack[sp++] = ni; }
        }
      }
      if (cnt < 12) for (const m of members) crag[m] = 0;
    }
  }

  // scree aprons: ground with crag directly uphill of it (along the fall line), plus a thin rim
  const cd = new Uint8Array(N).fill(255);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (crag[i]) { cd[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const d = cd[i] + 1;
    if (d > 1) continue;
    const x = i % S, y = (i / S) | 0;
    if (x > 0 && cd[i - 1] > d) { cd[i - 1] = d; q[qt++] = i - 1; }
    if (x < S - 1 && cd[i + 1] > d) { cd[i + 1] = d; q[qt++] = i + 1; }
    if (y > 0 && cd[i - S] > d) { cd[i - S] = d; q[qt++] = i - S; }
    if (y < S - 1 && cd[i + S] > d) { cd[i + S] = d; q[qt++] = i + S; }
  }
  const apron = new Uint8Array(N); // distance (1..) to crag measured uphill, 0 = none
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x;
    if (crag[i] || slope[i] < 0.2) continue;
    const gx = h[i + 1] - h[i - 1], gy = h[i + S] - h[i - S];
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-6) continue;
    const ux = gx / gl, uy = gy / gl; // uphill
    for (let k = 1; k <= screeBand + 3; k++) {
      const xx = Math.round(x + ux * k), yy = Math.round(y + uy * k);
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) break;
      if (crag[yy * S + xx]) { apron[i] = k; break; }
    }
  }

  const gxk = 1 / (2 * CELL_METERS);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w = water[i];
      if (w === WATER_DEEP) { cover[i] = COVER.DEEP; continue; }
      if (w === WATER_SHALLOW) { cover[i] = COVER.SHALLOW; continue; }
      const hh = h[i], sl = slope[i];
      let c = COVER.MOOR;
      if (crag[i]) {
        c = COVER.CRAG;
      } else {
        const n1 = nz(x * 0.09 + 3.1, y * 0.09 + 8.2) * 0.6 + nz(x * 0.23 - 6, y * 0.23 + 2) * 0.4; // -1..1
        let snowy = false;
        if (snowline !== null) {
          // north-facing ground (height rises toward +y, i.e. south) holds snow lower
          const gy = (h[Math.min(S - 1, y + 1) * S + x] - h[Math.max(0, y - 1) * S + x]) * gxk;
          const north = Math.max(0, Math.min(1, gy * 3));
          if (hh > snowline - 70 * north + n1 * 55 && sl < snowSlope) snowy = true;
        }
        if (snowy) c = COVER.SNOW;
        else if (((apron[i] && sl > 0.22 && n1 > -0.35 + 0.12 * apron[i]) || (cd[i] <= 1 && sl > 0.28))) c = COVER.SCREE;
        else if (sl > screeSlope && hh > screeMinH) c = COVER.SCREE;
        else if (hh > rockline + n1 * 70 && (sl > 0.14 || n1 > 1 - 2 * rockAmount)) c = COVER.ROCK;
        else {
          // woodland: lower slopes and glen floors, patchy
          let wooded = false;
          if (hh < treeline + n1 * 35 && hh > woodMin && sl < woodSlope && woodDensity > 0) {
            const wn = noise.fbm(x * 0.045 + 70, y * 0.045 + 31, 3) * 0.5 + 0.5;
            const low = Math.max(0, Math.min(1, (treeline - hh) / 180));
            if (wn + 0.28 * low + 0.1 * (1 - sl / woodSlope) > 1 - woodDensity) wooded = true;
          }
          if (wooded) c = COVER.WOOD;
          else if (sl < bogFlat && hh < bogMax) {
            const bn = nz(x * 0.045 + 90, y * 0.045 + 11) * 0.65 + nz(x * 0.12 + 5, y * 0.12 - 40) * 0.35;
            if (bn > 0.5 - bogAmount * 1.0 || acc[i] > 60) c = COVER.BOG;
          }
        }
      }
      if (adjust) { const r = adjust(x, y, hh, sl, c); if (r !== undefined) c = r; }
      cover[i] = c;
    }
  }
  smoothSoft(cover, 2);
  return cover;
}

/** Majority filter over the 'soft' ground classes to remove single-cell speckle. */
function smoothSoft(cover, passes) {
  const soft = (c) => c === COVER.MOOR || c === COVER.BOG || c === COVER.WOOD;
  const tmp = new Uint8Array(cover.length);
  const cnt = new Uint8Array(10);
  for (let p = 0; p < passes; p++) {
    tmp.set(cover);
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const c = cover[i];
      if (!soft(c)) continue;
      cnt.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[cover[i + dy * S + dx]]++;
      let best = c, bn = cnt[c];
      for (const k of [COVER.MOOR, COVER.BOG, COVER.WOOD]) if (cnt[k] > bn + 1) { best = k; bn = cnt[k]; }
      tmp[i] = best;
    }
    cover.set(tmp);
  }
}
