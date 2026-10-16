#!/usr/bin/env node
// Album verification render. For each level: autopilot walks the gate chain (after one deliberate wrong approach),
// then stands still for a 20 s Drift coda, all through the real score into an OfflineAudioContext (44.1 kHz stereo).
// Writes out/audio/<id>.wav + <id>.json and prints a summary table.
//
//   node tools/render-audio.mjs [--level <id[,id]>] [--seconds N] [--no-wrong] [--no-wav] [--parallel N (default 3)] [--stems]
//                               [--mute ch,ch --tag name]  (diagnostic stems: mute channels, write <id>.<name>.wav)
//                               [--switch | --switch-only]  (also / only run the corryvreckan -> cruachan hand-over check; always run on a full album)
//                               [--tweak 'js']  (diagnostic: run js(audio, score) after setLevel)
//                               [--stroll]  (diagnostic: walk instead of run between waypoints)
//                               [--stroll-check]  (only the synthetic flat-walk check: percussion must answer steady walking within 10 s)
//                               [--idle N]  (diagnostic: stand still for N s from the spawn instead of walking — Eno / Drift check)
//
// FAILS (exit 1) if: any NaN; peak > -0.3 dBFS; > 5 % silent 100 ms windows (< -60 dBFS); a full artefact rises < +4 dB RMS
// versus the preceding 6 s AND is not (>= +2 dB with >= 30 % spectral-centroid change); P90 - P10 of the 1 s RMS curve < 14 dB;
// the Drift coda (20 s of standing still after the finale) is above -24 dBFS; corryvreckan's mean RMS is above -22 dBFS (it borrows the minimalist assynt profile until the sonic round); the chroma's
// top pitch class is outside the level's root triad; (full album) the union parameter-audit dead list is not empty; the level
// hand-over glitches; a smoothed control (energy / drift / altitude) goes non-finite; or any console error.
// Also: kit-channel RMS in the flow sections must be within 18 dB of the full-mix RMS on every level (the kit's dry bed channels,
// scaled by the master gain), and a synthetic steady flat walk must bring the kit in within 10 s, flow within 7 s, and decay to
// ebb / drift after 15 s of standing (the stroll check; every level, full album or --stroll-check).
// Also prints the level by section (ebb / flow / swell / while an artefact sounds; targets -26..-30 / ~-20 / ~-15 / -11..-15 peaks).
// Stanza form (FORM table): every section / arrangement change (section, the kit's effective section, layers on / off,
// time-of-day mode) is logged with its time; FAILS if any lands off a stanza downbeat (tolerance one 16th), or if an
// artefact piece starts off a bar line / a partial off a beat / a cadence or finale off a bar line. Because changes
// wait for the next stanza downbeat: the artefact consequence is measured from the piece's start (its bar line), the
// Drift coda from the finale's start, and the stroll check allows flow by 4 s + one stanza + one bar after walking
// begins and gives standing one stanza + one bar more to settle (was: flow within 7 s, 22 s of standing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startServer } from './lib/serve.mjs';
import { encodeWav } from './lib/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'out', 'audio');
fs.mkdirSync(outDir, { recursive: true });
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

const IDS = ['corryvreckan', 'cruachan', 'lyon', 'rannoch', 'cairngorm', 'coe', 'cuillin', 'nevis'];
const switchOnly = flag('--switch-only');
const strollOnly = flag('--stroll-check');
const idleRun = !!val('--idle') || flag('--stems');
const levels = switchOnly || strollOnly ? [] : (val('--level') ? val('--level').split(',') : IDS);
const seconds = val('--seconds') ? Number(val('--seconds')) : null;
const tag = val('--tag') ? '.' + val('--tag') : '';                       // file-name suffix for diagnostic renders
const muteList = val('--mute') ? val('--mute').split(',') : [];             // diagnostic: mute these channels
const full = levels.length === IDS.length && !flag('--stems');
const strollIds = strollOnly ? (val('--level') ? val('--level').split(',') : IDS) : (full ? IDS : levels);
const ALL_CH = ['drone', 'pad', 'bass', 'bell', 'pluck', 'texture', 'kmain', 'kcym', 'ktex', 'ghost', 'lead', 'fore', 'foreB', 'forePad', 'foreLow', 'fmain', 'fcym', 'ftex'];
const STEMS = {
  drone: ['drone'], texture: ['texture'], pad: ['pad', 'ghost'], bass: ['bass'], melodic: ['bell', 'pluck'], lead: ['lead'],
  kit: ['kmain', 'kcym', 'ktex'], artefact: ['fore', 'foreB', 'forePad', 'foreLow', 'fmain', 'fcym', 'ftex'],
};

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* fall through */ }
  const g = execSync('npm root -g').toString().trim();
  const req = createRequire(path.join(g, 'playwright', 'package.json'));
  return req(path.join(g, 'playwright'));
}
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base).filter((x) => x.startsWith('chromium-'))) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

const uploads = new Map();
const { url, close } = await startServer(root, 0, {
  routes: { '/__upload/audio/*': async (req, res, body, u) => { uploads.set(path.basename(u.pathname, '.f32'), Buffer.from(body)); res.writeHead(200); res.end('ok'); } },
});
const pw = await loadPlaywright();
const chromium = pw.chromium || pw.default?.chromium;
const exe = findChromium();
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const consoleErrors = [];
const nPages = Math.max(1, Math.min(Math.max(1, levels.length), Number(val('--parallel') || 3)));
const pages = [];
for (let i = 0; i < nPages; i++) {
  const pg = await browser.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); if (m.type() === 'warning') console.log('[page warn]', m.text()); });
  pg.on('pageerror', (e) => consoleErrors.push('pageerror: ' + (e.stack || e.message)));
  pg.on('requestfailed', (r) => consoleErrors.push('requestfailed: ' + r.url()));
  pages.push(pg);
}
const page = pages[0];

const failures = [];
const results = [];
try {
  for (const pg of pages) {
    await pg.goto(url + '/tools/lib/audio-page.html');
    await pg.waitForFunction('window.__ready === true', null, { timeout: 60000 });
  }
  if (flag('--stems')) {
    // mixing report: each group soloed (its sends to reverb / delay / granular included)
    const id = levels[0];
    console.log(`STEMS for ${id} (${seconds || 70} s)`);
    console.log('group'.padEnd(10) + 'rms dB'.padStart(8) + 'peak'.padStart(8) + '  per-10s rms: ');
    for (const [g, chs] of Object.entries(STEMS)) {
      const mute = ALL_CH.filter((c) => !chs.includes(c));
      const r = await page.evaluate(([i, o]) => window.renderLevel(i, o), [id, { seconds: seconds || 70, noWrong: flag('--no-wrong'), mute }]);
      const blocks = [];
      for (let b = 0; b + 10 <= r.rmsCurve.length; b += 10) blocks.push((r.rmsCurve.slice(b, b + 10).reduce((a, c) => a + Math.pow(10, c / 10), 0) / 10));
      console.log(g.padEnd(10) + r.rmsDb.toFixed(1).padStart(8) + r.peakDb.toFixed(1).padStart(8) + '  ' + blocks.map((v) => (10 * Math.log10(v)).toFixed(0).padStart(4)).join(''));
    }
    await browser.close(); await close(); process.exit(0);
  }
  const done = new Map();
  let next = 0;
  async function worker(pg) {
    while (next < levels.length) {
      const id = levels[next++];
      const t0 = Date.now();
      const r = await pg.evaluate(([i, o]) => window.renderLevel(i, o), [id, { seconds, noWrong: flag('--no-wrong'), upload: !flag('--no-wav'), idle: val('--idle') ? Number(val('--idle')) : 0, mute: muteList, stroll: flag('--stroll'), tweak: val('--tweak') || '' }]);
      console.log(`rendered ${id}: ${r.duration.toFixed(0)} s audio in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      done.set(id, r);
    }
  }
  await Promise.all(pages.map(worker));
  for (const id of levels) {
    const r = done.get(id);
    results.push(r);
    const up = uploads.get(id);
    if (up) {
      const f32 = new Float32Array(up.buffer, up.byteOffset, up.byteLength / 4);
      const n = f32.length / 2, L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i++) { L[i] = f32[2 * i]; R[i] = f32[2 * i + 1]; }
      fs.writeFileSync(path.join(outDir, id + tag + '.wav'), encodeWav([L, R], 44100, { bits: 16 }));
      uploads.delete(id);
    }
    const { audit, ...rest } = r;
    fs.writeFileSync(path.join(outDir, id + tag + '.json'), JSON.stringify({ ...rest, auditDead: audit.dead }, null, 1));
    for (const e of r.errors) failures.push(`${id}: ${e}`);
    if (r.nan) failures.push(`${id}: ${r.nan} NaN samples`);
    if (r.ctl.some((c) => c.slice(1, 4).some((v) => !Number.isFinite(v)))) failures.push(`${id}: a smoothed control (energy / drift / altitude) went non-finite`);
    if (!(r.peakDb <= -0.3)) failures.push(`${id}: peak ${r.peakDb} dBFS > -0.3`);
    if (r.silentPct > 5) failures.push(`${id}: ${r.silentPct}% silent 100 ms windows (> 5%)`);
    for (const a of r.artefacts) if (a.full && !a.pass) failures.push(`${id}: artefact ${a.type}@${a.t}s (piece at ${a.start}s) weak (dRMS ${a.dRmsDb} dB, dCentroid ${a.dCentroidPct}%)`);
    if (r.form.offBoundary > 0) failures.push(`${id}: ${r.form.offBoundary} arrangement / section change(s) off a stanza boundary: ` + r.form.changes.filter((c) => !c.onBoundary).map((c) => `${c.t}s ${c.what} (${c.offS}s off)`).join('; '));
    if (r.form.piecesOffGrid > 0) failures.push(`${id}: ${r.form.piecesOffGrid} piece(s) off their grid: ` + r.form.pieces.filter((p) => !p.onGrid).map((p) => `${p.kind} ${p.type}@${p.t0}s (${p.tier}, ${p.offS}s off)`).join('; '));
    if (!idleRun) {
      if (r.dynP90P10 < 14) failures.push(`${id}: dynamics P90-P10 of 1 s RMS is ${r.dynP90P10} dB (< 14)`);
      if (r.codaDb !== null && r.codaDb > -24) failures.push(`${id}: Drift coda ${r.codaDb} dBFS (> -24)`);
      if (id === 'corryvreckan' && r.rmsDb > -22) failures.push(`corryvreckan: mean RMS ${r.rmsDb} dBFS (the minimalist track should sit around -22 to -24)`);
    }
    {
      // kit presence: the kit's dry channels vs the mix, over the seconds spent in flow while the walker is moving, i.e. not drifting or under an artefact (power means; seconds with an artefact piece still sounding or fading are left out)
      const fl = [], kl = [];
      for (const c of r.ctl) { const t = c[0]; if (t < 3 || t >= r.rmsCurve.length - 5 || c[4] !== 'flow' || c[6] > 0 || c[2] >= 0.2 || c[9]) continue; fl.push(r.rmsCurve[t]); kl.push(r.kitCurve[t]); }
      const pmean = (a) => (a.length ? 10 * Math.log10(a.reduce((x, v) => x + Math.pow(10, v / 10), 0) / a.length) : NaN);
      r.kitFlow = { n: fl.length, kitDb: +pmean(kl).toFixed(1), mixDb: +pmean(fl).toFixed(1), gap: +(pmean(kl) - pmean(fl)).toFixed(1), hitsPerMin: fl.length ? +((r.kitHitTimes.filter((tt) => r.ctl.some((c) => c[0] === Math.floor(tt) && c[4] === 'flow' && c[6] === 0 && c[2] < 0.2 && !c[9])).length) / (fl.length / 60)).toFixed(0) : 0 };
      if (fl.length >= 10 && !(r.kitFlow.gap >= -18)) failures.push(`${id}: kit-channel RMS in flow is ${r.kitFlow.gap} dB re the mix (must be within 18 dB)`);
    }
    if (!r.chromaInTriad) failures.push(`${id}: chroma top ${r.chromaTop} not in root triad ${r.rootTriad.join('-')}`);
  }

  // ---- level hand-over: the same audio instance moves from one level to the next (as main.js will do)
  if (full || flag('--switch') || switchOnly) {
    const sw = await page.evaluate(() => window.renderSwitch('corryvreckan', 'cruachan', 14));
    console.log(`\nLEVEL SWITCH corryvreckan -> cruachan at ${sw.switchAt} s: rms around the join ${sw.rmsAround.join(' ')} dB, peak ${sw.peakDb.toFixed(1)}, now on ${sw.levelAfter}`);
    for (const e of sw.errors) failures.push('switch: ' + e);
    if (sw.nan) failures.push('switch: NaN');
    if (sw.minAround < -45) failures.push(`switch: silent gap at the level join (${sw.minAround} dB)`);
    if (sw.levelAfter !== 'cruachan') failures.push('switch: level did not change');
  }

  // ---- stroll check: steady flat walking must be answered by percussion (every level)
  if (strollIds.length && !flag('--stems')) {
    console.log('\nSTROLL CHECK (2 s still, 18 s steady flat walk at moor pace, then 22 s + one stanza + one bar still)');
    console.log('level'.padEnd(10) + '1st hit'.padStart(9) + 'flow at'.padStart(9) + 'hits 4-14'.padStart(11) + 'kit dB'.padStart(8) + 'mix dB'.padStart(8) + '  after standing   what played');
    for (const id of strollIds) {
      const r = await page.evaluate((i) => window.renderStroll(i), id);
      console.log(id.padEnd(10) + String(r.firstHit ?? 'none').padStart(9) + String(r.flowAt ?? 'never').padStart(9) + String(r.hits4to14).padStart(11) + String(r.kitDb).padStart(8) + String(r.mixDb).padStart(8) + `  ${r.endSection} (e ${r.endEnergy})   ` + Object.entries(r.hitNames).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' '));
      for (const e of r.errors) failures.push(`stroll ${id}: ${e}`);
      if (r.kitDb - r.mixDb < -18) failures.push(`stroll ${id}: kit-channel RMS during steady walking is ${(r.kitDb - r.mixDb).toFixed(1)} dB re the mix (must be within 18 dB)`);
      if (r.firstHit === null || r.firstHit > 10) failures.push(`stroll ${id}: first percussion ${r.firstHit} s after walking began (> 10)`);
      const flowLimit = +(4 + r.stanzaSec + r.barSec).toFixed(1);
      if (r.flowAt === null || r.flowAt > flowLimit) failures.push(`stroll ${id}: flow reached ${r.flowAt} s after walking began (> ${flowLimit}: 4 s + one stanza + one bar)`);
      if (r.hits4to14 < 8) failures.push(`stroll ${id}: only ${r.hits4to14} percussion hits in seconds 4-14 of steady walking (< 8)`);
      if (r.endSection === 'flow' || r.endSection === 'swell') failures.push(`stroll ${id}: still ${r.endSection} 20 s after stopping (should decay to ebb / drift)`);
    }
  }

  // ---- summary
  const f = (v, w, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v)).padStart(w);
  console.log('\nALBUM RENDER');
  console.log('level'.padEnd(10) + 'key'.padEnd(10) + 'bpm'.padStart(4) + 'dur'.padStart(6) + 'peak'.padStart(7) + 'rms'.padStart(7) + 'p90-10'.padStart(7) + 'coda'.padStart(6) + 'sil%'.padStart(6) + 'cent'.padStart(6) + '  chroma(top|triad)'.padEnd(22) + 'nodes/s'.padStart(10) + ' art(min dRMS/dCent)');
  for (const r of results) {
    const fulls = r.artefacts.filter((a) => a.full);
    const minA = fulls.length ? fulls.map((a) => `${a.type}:${a.dRmsDb >= 0 ? '+' : ''}${a.dRmsDb.toFixed(1)}dB/${a.dCentroidPct >= 0 ? '+' : ''}${a.dCentroidPct.toFixed(0)}%`).join(' ') : '-';
    console.log(r.id.padEnd(10) + (r.root + ' ' + r.mode).padEnd(10) + f(r.bpm, 4, 0) + f(r.duration, 6, 0) + f(r.peakDb, 7) + f(r.rmsDb, 7) + f(r.dynP90P10, 7) + f(r.codaDb ?? NaN, 6) + f(r.silentPct, 6) + f(r.centroidMean, 6, 0) + ('  ' + r.chromaTop + '|' + r.rootTriad.join('-')).padEnd(22) + (f(r.nodes.perSecMean, 4, 0) + '/' + String(r.nodes.perSecMedian).padStart(3)).padStart(10) + ' ' + minA);
  }

  // ---- level by section: mean 1 s RMS (power-averaged) of the seconds spent in each conductor section, and while an artefact sounds
  console.log('\nLEVEL BY SECTION (dBFS, 1 s RMS power-mean; [seconds])');
  console.log('level'.padEnd(10) + 'ebb'.padStart(14) + 'flow'.padStart(14) + 'swell'.padStart(14) + 'artefact'.padStart(14) + 'max 1 s'.padStart(10));
  for (const r of results) {
    const b = { ebb: [], flow: [], swell: [], art: [] };
    for (const c of r.ctl) { const t = c[0]; if (t < 3 || t >= r.rmsCurve.length - 5) continue; const v = r.rmsCurve[t]; (c[6] > 0 ? b.art : b[c[4]] || []).push(v); }
    const pm = (a) => (a.length ? (10 * Math.log10(a.reduce((x, v) => x + Math.pow(10, v / 10), 0) / a.length)).toFixed(1) + ' [' + a.length + ']' : 'n/a');
    console.log(r.id.padEnd(10) + pm(b.ebb).padStart(14) + pm(b.flow).padStart(14) + pm(b.swell).padStart(14) + pm(b.art).padStart(14) + Math.max(...r.rmsCurve.slice(3, r.rmsCurve.length - 5)).toFixed(1).padStart(10));
  }

  // ---- stanza form: every arrangement / section change and where it landed
  console.log('\nFORM (stanza boundaries; tolerance one 16th)');
  console.log('level'.padEnd(10) + 'N'.padStart(3) + 'stanzas'.padStart(9) + 'changes'.padStart(9) + 'off'.padStart(5) + 'pieces'.padStart(8) + 'offgrid'.padStart(9) + 'acks'.padStart(6) + 'pickups'.padStart(9) + '  change times (s: what)');
  for (const r of results) {
    const F = r.form;
    const list = F.changes.map((c) => `${c.t.toFixed(1)}:${c.what}${c.onBoundary ? '' : '!OFF'}`).join(' ');
    console.log(r.id.padEnd(10) + String(F.stanzaBars).padStart(3) + String(F.stanzas).padStart(9) + String(F.changes.length).padStart(9) + String(F.offBoundary).padStart(5) + String(F.pieces.length).padStart(8) + String(F.piecesOffGrid).padStart(9) + String(F.acks).padStart(6) + String(F.pickups).padStart(9) + '  ' + list);
    console.log(''.padEnd(10) + '   pieces: ' + F.pieces.map((p) => `${p.kind === 'artefact' ? p.type : p.kind}@${p.t0}${p.firedAt !== null ? '(fired ' + p.firedAt + ')' : ''}/${p.tier}${p.onGrid ? '' : '!OFF'}`).join(' '));
  }

  console.log('\nKIT PRESENCE IN FLOW (dBFS, power-mean of the flow seconds; bed hits per flow minute)');
  console.log('level'.padEnd(10) + 'kit'.padStart(8) + 'mix'.padStart(8) + 'gap'.padStart(8) + 'sec'.padStart(6) + 'hits/min'.padStart(10));
  for (const r of results) console.log(r.id.padEnd(10) + String(r.kitFlow.kitDb).padStart(8) + String(r.kitFlow.mixDb).padStart(8) + String(r.kitFlow.gap).padStart(8) + String(r.kitFlow.n).padStart(6) + String(r.kitFlow.hitsPerMin).padStart(10));

  // ---- audit (union over levels)
  const merged = {};
  for (const r of results) for (const [k, v] of Object.entries(r.audit.params)) {
    const m = merged[k] || (merged[k] = { min: Infinity, max: -Infinity, count: 0 });
    if (v.count > 0) { m.min = Math.min(m.min, v.min); m.max = Math.max(m.max, v.max); m.count += v.count; }
  }
  const dead = Object.entries(merged).filter(([, v]) => v.count < 2 || v.min === v.max).map(([k]) => k);
  console.log(`\nAUDIT (union of ${results.length} level renders): ${Object.keys(merged).length} params registered, ${dead.length} dead`);
  if (dead.length) console.log('dead: ' + dead.join(', '));
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ levels: results.map((r) => r.id), params: merged, dead }, null, 1));
  if (full && dead.length) failures.push(`audit: ${dead.length} dead params across the album`);
  if (!full) console.log('(partial run: audit dead-list not enforced)');
} catch (e) {
  failures.push('exception: ' + (e.stack || e.message));
}
if (consoleErrors.length) for (const e of consoleErrors) failures.push('console error: ' + e);
console.log('\n' + (failures.length ? 'FAIL\n - ' + failures.join('\n - ') : 'PASS'));
await browser.close(); await close();
process.exit(failures.length ? 1 : 0);
