#!/usr/bin/env node
// Offline verification of the audio core. Serves the repo, opens tools/lib/render-page.html in headless
// Chromium, renders (a) every voice / kit hit solo and (b) a full demo sequence with an OfflineAudioContext
// (44.1 kHz stereo), writes out/voices.wav and prints per-segment stats + the param-audit dead list.
//
//   node tools/render-voices.mjs [--no-solo] [--keep-open]
//
// Exit code 0 only if: no clipping (peak < -0.3 dBFS), no NaN, every voice audible (RMS > -45 dBFS), no console errors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { startServer } from './lib/serve.mjs';
import { encodeWav, analyse, toDb } from './lib/wav.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'out');
fs.mkdirSync(outDir, { recursive: true });
const args = new Set(process.argv.slice(2));

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

const fmt = (v, w = 7) => (Number.isFinite(v) ? v.toFixed(1) : String(v)).padStart(w);
let uploaded = null;
const { server, url, close } = await (async () => {
  const s = await startServer(root, 0, {
    routes: {
      '/__upload/voices.f32': async (req, res, body) => { uploaded = Buffer.from(body); res.writeHead(200); res.end('ok'); },
    },
  });
  return s;
})();

const pw = await loadPlaywright();
const chromium = pw.chromium || pw.default?.chromium;
const exe = findChromium();
const browser = await chromium.launch({
  ...(exe ? { executablePath: exe } : {}),
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); if (m.type() === 'warning') console.log('[page warn]', m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + (e.stack || e.message)));
page.on('requestfailed', (r) => consoleErrors.push('requestfailed: ' + r.url()));

let failures = [];
try {
  await page.goto(url + '/tools/lib/render-page.html');
  await page.waitForFunction('window.__ready === true', null, { timeout: 30000 });

  // ---------------------------------------------------------------- solo renders
  if (!args.has('--no-solo')) {
    const names = await page.evaluate('window.soloNames()');
    console.log('\nSOLO RENDERS (each voice/hit alone in a fresh engine; window = clip + 1.5 s tail)');
    console.log('name'.padEnd(22) + 'peak dB'.padStart(9) + 'rms dB'.padStart(9) + 'loud100ms'.padStart(11) + 'centroid'.padStart(10) + '  silence%  NaN');
    for (const n of names) {
      const r = await page.evaluate((nm) => window.renderSolo(nm), n);
      console.log(n.padEnd(22) + fmt(r.peakDb, 9) + fmt(r.rmsDb, 9) + fmt(r.maxWinRmsDb, 11) + String(Math.round(r.centroidHz)).padStart(10) + fmt(r.silencePct, 10) + String(r.nan).padStart(5));
      if (r.nan) failures.push(`${n}: ${r.nan} NaN samples`);
      // short hits have low whole-clip RMS: require the loudest 100 ms window (what you actually hear) > -45 dBFS
      if (!(r.maxWinRmsDb > -45)) failures.push(`${n}: inaudible (loudest 100 ms ${r.maxWinRmsDb.toFixed(1)} dBFS)`);
      if (r.rmsDb > -45 === false && r.kind === 'voice') failures.push(`${n}: clip RMS ${r.rmsDb.toFixed(1)} dBFS < -45`);
      if (r.peakDb >= -0.3) failures.push(`${n}: peak ${r.peakDb.toFixed(2)} dBFS`);
    }
  }

  // ---------------------------------------------------------------- full demo
  console.log('\nFULL DEMO SEQUENCE (OfflineAudioContext 44.1 kHz stereo)');
  const demo = await page.evaluate(() => window.renderDemo({ upload: true }));
  console.log(`duration ${demo.duration.toFixed(1)} s, rendered in ${(demo.renderMs / 1000).toFixed(1)} s (${(demo.duration / (demo.renderMs / 1000)).toFixed(1)}x realtime)`);
  console.log('segment'.padEnd(22) + '   t0     t1'.padEnd(14) + 'peak dB'.padStart(9) + 'rms dB'.padStart(9) + 'loud100ms'.padStart(11) + 'centroid'.padStart(10) + '  silence%  NaN');
  for (const s of demo.segments) {
    console.log(s.name.padEnd(22) + s.t0.toFixed(1).padStart(6) + s.t1.toFixed(1).padStart(7) + '  ' + fmt(s.peakDb, 7) + fmt(s.rmsDb, 9) + fmt(s.maxWinRmsDb, 11) + String(Math.round(s.centroidHz)).padStart(10) + fmt(s.silencePct, 10) + String(s.nan).padStart(5));
    if (s.nan) failures.push(`demo ${s.name}: NaN`);
  }
  console.log(`\nTOTAL   peak ${demo.total.peakDb.toFixed(2)} dBFS  rms ${demo.total.rmsDb.toFixed(2)} dBFS  NaN ${demo.total.nan}  silence ${demo.total.silencePct.toFixed(1)}%`);
  console.log(`TUTTI   peak ${demo.tutti.peakDb.toFixed(2)} dBFS  rms ${demo.tutti.rmsDb.toFixed(2)} dBFS  (target RMS -14..-10 before limiting)`);
  console.log(`live per-note node graphs after the final tail: ${demo.liveScopes} (must be 0: every voice stops and disconnects)`);
  if (demo.total.nan) failures.push('NaN in demo output');
  if (!(demo.total.peakDb < -0.3)) failures.push(`demo peak ${demo.total.peakDb.toFixed(2)} dBFS >= -0.3`);

  if (demo.liveScopes !== 0) { failures.push(`${demo.liveScopes} per-note graphs still alive after the tail (node leak?)`); console.log(JSON.stringify(demo.liveInfo, null, 1)); }

  // ---------------------------------------------------------------- patch fuzz (every numeric patch param at 0.5x / 1.6x)
  let fuzz = null;
  if (!args.has('--no-fuzz')) {
    console.log('\nPATCH FUZZ (every numeric patch parameter at 0.5x and 1.6x default, every kit opt at both extremes, hostile inputs)');
    fuzz = await page.evaluate(() => window.renderFuzz());
    console.log(`${fuzz.steps} steps over ${fuzz.duration.toFixed(0)} s: peak ${fuzz.peakDb.toFixed(2)} dBFS, rms ${fuzz.rmsDb.toFixed(1)} dBFS, NaN ${fuzz.nan}, exceptions ${fuzz.errors.length}, live scopes at end ${fuzz.liveScopes}`);
    for (const e of fuzz.errors) failures.push('fuzz: ' + e);
    if (fuzz.nan) failures.push('fuzz: NaN in output');
    if (!(fuzz.peakDb < -0.3)) failures.push(`fuzz peak ${fuzz.peakDb.toFixed(2)} dBFS`);
    if (fuzz.liveScopes !== 0) { failures.push(`fuzz: ${fuzz.liveScopes} graphs still alive (leak?)`); console.log(JSON.stringify(fuzz.liveInfo, null, 1)); }
  }

  // merged audit: a param is dead only if it never moved in either render
  const merged = {};
  for (const a of [demo.audit, fuzz && fuzz.audit].filter(Boolean)) {
    for (const [k, r] of Object.entries(a.params)) {
      const m = merged[k] || (merged[k] = { min: Infinity, max: -Infinity, count: 0 });
      if (r.count > 0) { m.min = Math.min(m.min, r.min); m.max = Math.max(m.max, r.max); m.count += r.count; }
    }
  }
  const dead = Object.entries(merged).filter(([, r]) => r.count < 2 || r.min === r.max).map(([k]) => k);
  console.log(`\nAUDIT: ${Object.keys(merged).length} params registered, ${dead.length} dead (demo alone: ${demo.audit.dead.length})`);
  if (dead.length) console.log('dead: ' + dead.join(', '));
  fs.writeFileSync(path.join(outDir, 'voices-audit.json'), JSON.stringify({ params: merged, dead }, null, 1));

  if (uploaded) {
    const f32 = new Float32Array(uploaded.buffer, uploaded.byteOffset, uploaded.byteLength / 4);
    const n = f32.length / 2;
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = f32[2 * i]; R[i] = f32[2 * i + 1]; }
    const wav = encodeWav([L, R], demo.sampleRate, { bits: 16 });
    fs.writeFileSync(path.join(outDir, 'voices.wav'), wav);
    // double-check the written data
    const chk = analyse([L, R], demo.sampleRate);
    console.log(`wrote out/voices.wav (${(wav.length / 1e6).toFixed(1)} MB, ${n} frames) peak ${chk.peakDb.toFixed(2)} dBFS`);
  }
} catch (e) {
  failures.push('exception: ' + (e.stack || e.message));
}

if (consoleErrors.length) for (const e of consoleErrors) failures.push('console error: ' + e);
console.log('\n' + (failures.length ? 'FAIL\n - ' + failures.join('\n - ') : 'PASS: no clipping, no NaN, all voices audible, no console errors'));
if (!args.has('--keep-open')) { await browser.close(); await close(); }
process.exit(failures.length ? 1 : 0);
