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
  const cragGap = P.cragGap ?? 0;   // 0..1: fraction of crag cells opened into gullies
  const adjust = P.adjust;

  const cover = new Uint8Array(N);
  const nz = noise.noise2;

  // pass 1: crags
  const crag = new Uint8Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (water[i]) continue;
    const hh = h[i];
    if (hh < cragMinH || hh > cragMaxH) continue;
    const thr = cragSlope + cragJitter * nz(x * 0.11 + 40, y * 0.11 + 7);
    if (slope[i] > thr) {
      if (cragGap > 0 && nz(x * 0.09 + 21, y * 0.09 - 9) < (cragGap * 2 - 1) * 0.9) continue; // gully
      crag[i] = 1;
    }
  }
  // drop speckle: a lone crag cell (no crag neighbour) becomes scree unless very steep
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    const i = y * S + x;
    if (!crag[i]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && crag[i + dy * S + dx]) n++;
    if (n === 0 && slope[i] < cragSlope * 1.35) crag[i] = 2; // 2 = demoted
  }
  for (let i = 0; i < N; i++) if (crag[i] === 2) crag[i] = 0;

  // distance (4-neighbour, capped) from crags, for scree aprons
  const cd = new Uint8Array(N).fill(255);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (crag[i]) { cd[i] = 0; q[qt++] = i; }
  while (qh < qt) {
    const i = q[qh++];
    const d = cd[i] + 1;
    if (d > screeBand) continue;
    const x = i % S, y = (i / S) | 0;
    if (x > 0 && cd[i - 1] > d) { cd[i - 1] = d; q[qt++] = i - 1; }
    if (x < S - 1 && cd[i + 1] > d) { cd[i + 1] = d; q[qt++] = i + 1; }
    if (y > 0 && cd[i - S] > d) { cd[i - S] = d; q[qt++] = i - S; }
    if (y < S - 1 && cd[i + S] > d) { cd[i + S] = d; q[qt++] = i + S; }
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
        else if (cd[i] <= screeBand && sl > 0.28 && n1 > -0.1 + 0.25 * (cd[i] - 1)) c = COVER.SCREE;
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
  // wide rivers become wadeable water
  for (let i = 0; i < N; i++) {
    if (acc[i] >= riverThreshold && !water[i] && cover[i] !== COVER.CRAG) cover[i] = COVER.SHALLOW;
  }
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
