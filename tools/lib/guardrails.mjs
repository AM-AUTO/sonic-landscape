/**
 * The sketch guardrails (tools/sketch-grounds.mjs: guardrails, guardrails5) as checks on a real stereo render.
 * Pure functions (browser and Node): tools/lib/audio-page.js runs them on every level render, tools/render-audio.mjs prints
 * the GUARDRAILS table, tests/audio-worklets.test.js covers them on synthetic signals.
 *
 *   arc        loudest vs 10th-percentile 2 s window (mono RMS)            ≥ 12 dB
 *   crest      peak / RMS of the whole mono render                         11..16 dB
 *   lowCorr    L/R correlation through a 4-pole 150 Hz low-pass            > 0.95
 *   noise      spectral flatness 200 Hz - 8 kHz, louder half of frames     ≥ 0.05
 *   contra     distinct contra periods from score.contraLog                ≥ 2 (skipped when the score keeps no log)
 *   decay      eroding-loop passes: age rises; the high band or the level falls (skipped when no pass was logged)
 */
import { fft } from './wav.mjs';

const rmsOf = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
const monoOf = (L, R) => { const m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = 0.5 * (L[i] + R[i]); return m; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** loudest 2 s window minus the 10th-percentile window (dB); windows of digital silence (< -90 dB) are left out */
export function arcDb(mono, sr, win = 2) {
  const n = Math.floor(win * sr), secs = [];
  for (let i = 0; i + n <= mono.length; i += n) { const d = 20 * Math.log10(rmsOf(mono, i, i + n) + 1e-12); if (d > -90) secs.push(d); }
  if (secs.length < 2) return NaN;
  secs.sort((a, b) => a - b);
  return secs[secs.length - 1] - secs[Math.floor(secs.length * 0.1)];
}

export function crestDb(mono) {
  let peak = 0; for (const v of mono) { const a = Math.abs(v); if (a > peak) peak = a; }
  return 20 * Math.log10((peak + 1e-12) / (rmsOf(mono, 0, mono.length) + 1e-12));
}

/** L/R correlation of the band below fc through a 4-pole (cascaded one-pole) low-pass, as the sketch measures it */
export function lowCorr(L, R, sr, fc = 150) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sr), l = [0, 0, 0, 0], r = [0, 0, 0, 0];
  let sl = 0, srr = 0, slr = 0;
  for (let i = 0; i < L.length; i++) {
    let xl = L[i], xr = R[i];
    for (let k = 0; k < 4; k++) { l[k] += a * (xl - l[k]); r[k] += a * (xr - r[k]); xl = l[k]; xr = r[k]; }
    sl += xl * xl; srr += xr * xr; slr += xl * xr;
  }
  return slr / Math.sqrt(sl * srr + 1e-20);
}

/** spectral flatness (geometric / arithmetic mean of power) over 200 Hz - 8 kHz, averaged over the louder half of 4096-point frames */
export function noiseShare(mono, sr, { N = 4096, lo = 200, hi = 8000 } = {}) {
  const re = new Float64Array(N), im = new Float64Array(N), win = new Float64Array(N);
  for (let j = 0; j < N; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N);
  const k0 = Math.ceil((lo * N) / sr), k1 = Math.floor((hi * N) / sr), nb = k1 - k0 + 1, rows = [];
  for (let i = 0; i + N <= mono.length; i += N) {
    for (let j = 0; j < N; j++) { re[j] = mono[i + j] * win[j]; im[j] = 0; }
    fft(re, im);
    let e = 0, lg = 0;
    for (let k = k0; k <= k1; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-18; e += p; lg += Math.log(p); }
    rows.push({ e, sf: Math.exp(lg / nb) / (e / nb) });
  }
  if (!rows.length) return NaN;
  const med = rows.map((r) => r.e).sort((a, b) => a - b)[rows.length >> 1];
  return mean(rows.filter((r) => r.e >= med).map((r) => r.sf));
}

/**
 * Contra periods from the score's onset log. Entries: { t, layer, period? } (period in beats) or [t, layer, period?].
 * Without a period field, a layer's period is its median inter-onset interval in beats (beatSec = 60 / bpm), to 1/4 beat.
 */
export function contraPeriods(log, beatSec) {
  if (!Array.isArray(log) || !log.length) return null;
  const by = new Map();
  for (const e of log) {
    const t = Array.isArray(e) ? e[0] : e && e.t, layer = Array.isArray(e) ? e[1] : e && e.layer, period = Array.isArray(e) ? e[2] : e && e.period;
    if (!Number.isFinite(t)) continue;
    const k = String(layer ?? '?');
    if (!by.has(k)) by.set(k, { ts: [], periods: [] });
    by.get(k).ts.push(t);
    if (Number.isFinite(period)) by.get(k).periods.push(period);
  }
  const layers = {};
  for (const [k, v] of by) {
    let p = null;
    if (v.periods.length) { const s = v.periods.slice().sort((a, b) => a - b); p = s[s.length >> 1]; }
    else if (v.ts.length >= 3 && beatSec > 0) {
      const ts = v.ts.slice().sort((a, b) => a - b), d = [];
      for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 1e-3) d.push(ts[i] - ts[i - 1]);
      d.sort((a, b) => a - b);
      if (d.length) p = Math.round((d[d.length >> 1] / beatSec) * 4) / 4;
    }
    if (p !== null) layers[k] = { period: +p.toFixed(3), onsets: v.ts.length };
  }
  const periods = [...new Set(Object.values(layers).map((l) => l.period))].sort((a, b) => a - b);
  return { layers, periods };
}

/**
 * Decay trend from the erode worklet's pass log ({pass, age, hf, rms, cycle}): for every capture cycle with ≥ 3 passes, the age
 * must not fall and must end higher than it began, and the later half of the passes must carry less high band, or be 3 dB
 * quieter, than the earlier half (a trend, not a staircase, as in the sketch). Returns null when nothing was logged.
 */
export function decayTrend(passLog) {
  if (!Array.isArray(passLog) || !passLog.length) return null;
  const cyc = new Map();
  for (const p of passLog) { if (!cyc.has(p.cycle)) cyc.set(p.cycle, []); cyc.get(p.cycle).push(p); }
  const rows = [];
  for (const [c, ps] of cyc) {
    if (ps.length < 3) continue;
    ps.sort((a, b) => a.pass - b.pass);
    const ages = ps.map((p) => p.age), hfs = ps.map((p) => p.hf).filter((x) => Number.isFinite(x) && x > 0);
    const rmss = ps.map((p) => p.rms).filter((x) => Number.isFinite(x) && x > 0);
    const ageUp = ages.every((a, i) => i === 0 || a >= ages[i - 1] - 1e-6) && ages[ages.length - 1] > ages[0];
    const h = Math.ceil(hfs.length / 2), hr = Math.ceil(rmss.length / 2);
    const hfDown = hfs.length >= 3 && mean(hfs.slice(h)) < mean(hfs.slice(0, h));
    // a source with little high band (a low tone) wears mostly as level: dropouts and loss, 3 dB down over the later half
    const rmsDown = rmss.length >= 3 && 20 * Math.log10(mean(rmss.slice(hr)) / mean(rmss.slice(0, hr))) < -3;
    const worn = hfs.length < 3 && rmss.length < 3 ? true : hfDown || rmsDown;
    rows.push({ cycle: c, passes: ps.length, ageFrom: ages[0], ageTo: ages[ages.length - 1], hfFrom: hfs[0] ?? null, hfTo: hfs[hfs.length - 1] ?? null, hfDown, rmsDown, ok: ageUp && worn });
  }
  return { cycles: rows.length, passes: passLog.length, rows, ok: rows.length ? rows.every((r) => r.ok) : null };
}

/** energy share per octave band (dB re the total) of one segment — the sketch's timing-insensitive spectrum for the decay check */
export function bandProfile(seg, sr, cuts = [250, 500, 1000, 2000, 4000, 8000]) {
  const e = new Float64Array(cuts.length + 1), st = cuts.map(() => [0, 0]), al = cuts.map((f) => 1 - Math.exp((-2 * Math.PI * f) / sr));
  let tot = 0;
  for (const v of seg) {
    tot += v * v; let prev = 0;
    for (let k = 0; k < cuts.length; k++) { st[k][0] += al[k] * (v - st[k][0]); st[k][1] += al[k] * (st[k][0] - st[k][1]); const lo = st[k][1]; e[k] += (lo - prev) ** 2; prev = lo; }
    e[cuts.length] += (v - prev) ** 2;
  }
  return Array.from(e, (x) => 10 * Math.log10(x / (tot + 1e-12) + 1e-9));
}
export const profileDistance = (a, b) => a.reduce((s, v, k) => s + Math.abs(v - b[k]), 0) / a.length;

/**
 * All checks on a stereo render. Returns { checks: [{ name, value, target, pass (true / false / null = skipped), note }], … }.
 * opts: { contraLog, beatSec, passLog }.
 */
export function guardrailReport(L, R, sr, { contraLog, beatSec, passLog } = {}) {
  const mono = monoOf(L, R);
  const arc = arcDb(mono, sr), crest = crestDb(mono), corr = lowCorr(L, R, sr), flat = noiseShare(mono, sr);
  const contra = contraPeriods(contraLog, beatSec), decay = decayTrend(passLog);
  const checks = [
    { name: 'arc', value: +arc.toFixed(1), target: '>= 12 dB', pass: arc >= 12 },
    { name: 'crest', value: +crest.toFixed(1), target: '11..16 dB', pass: crest >= 11 && crest <= 16 },
    { name: 'lowCorr', value: +corr.toFixed(3), target: '> 0.95', pass: corr > 0.95 },
    { name: 'noise', value: +flat.toFixed(3), target: '>= 0.05', pass: flat >= 0.05 },
    contraLog === undefined || contraLog === null
      ? { name: 'contra', value: null, target: '>= 2 periods', pass: null, note: 'skipped: the score keeps no contraLog yet' }
      : { name: 'contra', value: contra ? contra.periods.join('/') : '', target: '>= 2 periods', pass: !!contra && contra.periods.length >= 2, note: contra ? Object.entries(contra.layers).map(([k, v]) => `${k}:${v.period}b×${v.onsets}`).join(' ') : 'no onsets logged' },
    decay === null
      ? { name: 'decay', value: null, target: 'age up, hf down', pass: null, note: 'skipped: no eroding-loop pass was logged' }
      : { name: 'decay', value: decay.rows.length ? `${decay.rows.filter((r) => r.ok).length}/${decay.rows.length} cyc` : `${decay.passes} passes`, target: 'age up, hf down', pass: decay.ok,
        note: decay.ok === null ? 'skipped: no cycle reached 3 passes' : `${decay.cycles} cycle(s) of >= 3 passes, ${decay.passes} passes logged; age ` + decay.rows.map((r) => `${r.ageFrom.toFixed(2)}>${r.ageTo.toFixed(2)}${r.ok ? '' : '!'}`).join(' ') + `; worn in the high band ${decay.rows.filter((r) => r.hfDown).length}, in level ${decay.rows.filter((r) => r.rmsDown).length}` },
  ];
  return { checks, arc, crest, lowCorr: corr, noise: flat, contra, decay };
}
