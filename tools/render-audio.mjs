#!/usr/bin/env node
// Album verification render. For each level: autopilot walks the gate chain (after one deliberate wrong approach),
// then stands still for a 20 s Drift coda, all through the real score into an OfflineAudioContext (44.1 kHz stereo).
// Writes out/audio/<id>.wav + <id>.json and prints a summary table.
//
//   node tools/render-audio.mjs [--level <id[,id]>] [--seconds N] [--no-wrong] [--no-wav] [--parallel N (default 3)] [--stems]
//                               [--mute ch,ch --tag name]  (diagnostic stems: mute channels, write <id>.<name>.wav)
//                               [--switch | --switch-only]  (also / only run the rannoch -> affric hand-over check; always run on a full album)
//                               [--stroll]  (diagnostic: walk instead of run between waypoints)
//                               [--idle N]  (diagnostic: stand still for N s from the spawn instead of walking — Eno / Drift check)
//
// FAILS (exit 1) if: any NaN; peak > -0.3 dBFS; > 5 % silent 100 ms windows (< -60 dBFS); a full artefact changes
// neither +2 dB RMS nor 15 % spectral centroid versus the preceding 6 s; the chroma's top pitch class is outside the
// level's root triad; (full album only) the union parameter-audit dead list is not empty; or any console error.
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

const IDS = ['rannoch', 'affric', 'coe', 'cairngorm', 'torridon', 'cuillin', 'assynt', 'nevis'];
const switchOnly = flag('--switch-only');
const levels = switchOnly ? [] : (val('--level') ? val('--level').split(',') : IDS);
const seconds = val('--seconds') ? Number(val('--seconds')) : null;
const tag = val('--tag') ? '.' + val('--tag') : '';                       // file-name suffix for diagnostic renders
const muteList = val('--mute') ? val('--mute').split(',') : [];             // diagnostic: mute these channels
const full = levels.length === IDS.length && !flag('--stems');
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
      const r = await pg.evaluate(([i, o]) => window.renderLevel(i, o), [id, { seconds, noWrong: flag('--no-wrong'), upload: !flag('--no-wav'), idle: val('--idle') ? Number(val('--idle')) : 0, mute: muteList, stroll: flag('--stroll') }]);
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
    if (!(r.peakDb <= -0.3)) failures.push(`${id}: peak ${r.peakDb} dBFS > -0.3`);
    if (r.silentPct > 5) failures.push(`${id}: ${r.silentPct}% silent 100 ms windows (> 5%)`);
    for (const a of r.artefacts) if (a.full && !a.pass) failures.push(`${id}: artefact ${a.type}@${a.t}s weak (dRMS ${a.dRmsDb} dB, dCentroid ${a.dCentroidPct}%)`);
    if (!r.chromaInTriad) failures.push(`${id}: chroma top ${r.chromaTop} not in root triad ${r.rootTriad.join('-')}`);
  }

  // ---- level hand-over: the same audio instance moves from one level to the next (as main.js will do)
  if (full || flag('--switch') || switchOnly) {
    const sw = await page.evaluate(() => window.renderSwitch('rannoch', 'affric', 14));
    console.log(`\nLEVEL SWITCH rannoch -> affric at ${sw.switchAt} s: rms around the join ${sw.rmsAround.join(' ')} dB, peak ${sw.peakDb.toFixed(1)}, now on ${sw.levelAfter}`);
    for (const e of sw.errors) failures.push('switch: ' + e);
    if (sw.nan) failures.push('switch: NaN');
    if (sw.minAround < -45) failures.push(`switch: silent gap at the level join (${sw.minAround} dB)`);
    if (sw.levelAfter !== 'affric') failures.push('switch: level did not change');
  }

  // ---- summary
  const f = (v, w, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : String(v)).padStart(w);
  console.log('\nALBUM RENDER');
  console.log('level'.padEnd(10) + 'key'.padEnd(10) + 'bpm'.padStart(4) + 'dur'.padStart(6) + 'peak'.padStart(7) + 'rms'.padStart(7) + 'dyn'.padStart(6) + 'sil%'.padStart(6) + 'cent'.padStart(6) + '  chroma(top|triad)'.padEnd(22) + 'nodes/s'.padStart(10) + ' art(min dRMS/dCent)');
  for (const r of results) {
    const fulls = r.artefacts.filter((a) => a.full);
    const minA = fulls.length ? fulls.map((a) => `${a.type}:${a.dRmsDb >= 0 ? '+' : ''}${a.dRmsDb.toFixed(1)}dB/${a.dCentroidPct >= 0 ? '+' : ''}${a.dCentroidPct.toFixed(0)}%`).join(' ') : '-';
    console.log(r.id.padEnd(10) + (r.root + ' ' + r.mode).padEnd(10) + f(r.bpm, 4, 0) + f(r.duration, 6, 0) + f(r.peakDb, 7) + f(r.rmsDb, 7) + f(r.dynRangeDb, 6) + f(r.silentPct, 6) + f(r.centroidMean, 6, 0) + ('  ' + r.chromaTop + '|' + r.rootTriad.join('-')).padEnd(22) + (f(r.nodes.perSecMean, 4, 0) + '/' + String(r.nodes.perSecMedian).padStart(3)).padStart(10) + ' ' + minA);
  }

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
