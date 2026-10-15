#!/usr/bin/env node
/**
 * End-to-end gameplay verification in headless Chromium.
 *
 *  1. For every track: boot index.html?level=N&autopilot=1 (muted, sim sped up), let the
 *     autopilot walk the gate chain, and assert that the level completes, no console errors,
 *     no NaN in player state, artefacts fired, and the frame budget holds. Screenshots
 *     are taken along the way.
 *  2. Menu flow with audio on: title → tracklist → play (no screens in between), walk with the keyboard, check the
 *     AudioContext is running and the master analyser carries signal.
 *  3. Real-time performance with live audio (full run, or --perf).
 *
 * Usage: node tools/verify-play.mjs [--level id|index] [--speed 6] [--out out/play] [--no-audio] [--menu-only] [--perf]
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/serve.mjs';
import { LEVELS } from '../src/world/levels/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const outDir = path.resolve(root, arg('--out', 'out/play'));
const speed = parseFloat(arg('--speed', '6'));
const only = arg('--level', null);
const doAudio = !args.includes('--no-audio');
fs.mkdirSync(outDir, { recursive: true });

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const g = execSync('npm root -g').toString().trim();
  const require = createRequire(import.meta.url);
  return require(path.join(g, 'playwright'));
}
const { chromium } = await loadPlaywright();
const srv = await startServer(root, 0);
const base = `http://localhost:${srv.port}`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

const results = [];
let failed = false;

const menuOnly = args.includes('--menu-only');
const indices = menuOnly ? [] : LEVELS.map((_, i) => i).filter((i) => only == null || String(i) === only || LEVELS[i].id === only);

for (const i of indices) {
  const lvl = LEVELS[i];
  const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/index.html?level=${i}&autopilot=1&mute=1&fresh=1&speed=${speed}`);
  await page.waitForFunction(() => window.__contours && window.__contours.game.state, null, { timeout: 15000 });

  const t0 = Date.now();
  const shots = [];
  let nan = false, fires = 0, partials = 0, maxFrameMs = 0, lastScreen = '';
  let nextShot = 0;
  // hook the renderer + count artefacts from inside the page
  await page.evaluate(() => {
    const c = window.__contours;
    c.__fires = 0; c.__partials = 0; c.__frameMax = 0;
    const origDraw = c.renderer.draw;
    c.renderer.draw = function (s, u) { const a = performance.now(); const r = origDraw.call(this, s, u); c.__frameMax = Math.max(c.__frameMax, performance.now() - a); return r; };
    const origStep = c.game.step.bind(c.game);
    c.game.step = (inp, dt) => {
      const st = origStep(inp, dt);
      for (const e of c.game.state.events) if (e.type === 'poi') { if (e.full) c.__fires++; else c.__partials++; }
      return st;
    };
  });
  while (Date.now() - t0 < 240000) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => {
      const c = window.__contours, st = c.game.state, p = st.player;
      return {
        t: st.t, x: p.x, y: p.y, el: p.elevation, screen: c.ui.screen, done: st.levelComplete,
        gate: st.gateOpen, fires: c.__fires, partials: c.__partials, frame: c.__frameMax,
        nan: [p.x, p.y, p.vx, p.vy, p.elevation, p.vz].some((v) => !Number.isFinite(v)),
        res: st.resonance.length,
      };
    });
    nan = nan || s.nan; fires = s.fires; partials = s.partials; maxFrameMs = s.frame; lastScreen = s.screen;
    if (s.t >= nextShot || (s.res > 0 && shots.length < 6 && s.t > nextShot - 8)) {
      const f = path.join(outDir, `${lvl.id}-${String(Math.round(s.t)).padStart(3, '0')}.png`);
      await page.screenshot({ path: f });
      shots.push(f);
      nextShot = s.t + 30;
    }
    if (s.screen === 'complete') break;
  }
  const done = lastScreen === 'complete';
  const fin = path.join(outDir, `${lvl.id}-final.png`);
  await page.screenshot({ path: fin });
  const simT = await page.evaluate(() => window.__contours.game.state.t);
  const ok = done && !nan && errors.length === 0 && fires >= lvl.gate.chain.length;
  if (!ok) failed = true;
  results.push({ id: lvl.id, ok, done, simT: +simT.toFixed(1), fires, partials, nan, maxFrameMs: +maxFrameMs.toFixed(1), errors: errors.slice(0, 3) });
  await page.close();
}

// --- menu flow with audio
let audioCheck = null;
if (doAudio && only == null) {
  const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const screen = () => page.evaluate(() => window.__contours.ui.screen);
  const screens = [];
  await page.goto(`${base}/index.html?fresh=1`);
  await page.waitForTimeout(800);
  screens.push(await screen());
  await page.screenshot({ path: path.join(outDir, 'menu-title.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  screens.push(await screen());
  await page.screenshot({ path: path.join(outDir, 'menu-select.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  screens.push(await screen());
  // walk around with the keyboard
  const walk = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
  await walk('ArrowUp', 2500); await walk('ArrowRight', 2500);
  await page.keyboard.down('Shift'); await walk('ArrowDown', 2500); await page.keyboard.up('Shift');
  await walk('ArrowLeft', 2000);
  await page.waitForTimeout(2000);
  audioCheck = await page.evaluate(async () => {
    const c = window.__contours;
    if (c.audioReady) await c.audioReady;
    const a = c.audio;
    if (!a) return { ok: false, reason: 'no audio' };
    const an = a.engine.analyser;
    const buf = new Float32Array(an.fftSize);
    let peak = 0;
    for (let k = 0; k < 10; k++) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: a.ctx.state === 'running' && peak > 0.001, state: a.ctx.state, peak };
  });
  await page.screenshot({ path: path.join(outDir, 'menu-play.png') });
  audioCheck.errors = errors.slice(0, 5);
  audioCheck.screens = screens;
  if (screens.join('>') !== 'title>select>play') audioCheck.ok = false;
  if (!audioCheck.ok || errors.length) failed = true;
  await page.close();
}


// --- real-time performance with live audio: autopilot at normal speed, time every audio.update + frame
let perf = null;
if (doAudio && (only == null || args.includes('--perf'))) {
  const lvl = only != null ? (LEVELS.findIndex((l) => l.id === only || String(LEVELS.indexOf(l)) === only)) : LEVELS.findIndex((l) => l.id === 'coe');   // the heaviest score
  const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/index.html?level=${lvl}&autopilot=1&fresh=1`);
  await page.waitForFunction(() => window.__contours && window.__contours.game.state, null, { timeout: 15000 });
  await page.mouse.click(400, 300); // user gesture → audio
  await page.waitForFunction(() => window.__contours.audio, null, { timeout: 15000 });
  await page.evaluate(() => {
    const c = window.__contours, a = c.audio;
    c.__upd = []; c.__frames = [];
    const orig = a.update.bind(a);
    c.__slow = [];
    a.update = (s) => {
      const t0 = performance.now(); const r = orig(s); const du = performance.now() - t0; c.__upd.push(du);
      if (du > 12) {                       // what was going on in an update that took longer than a frame's share
        const sc = a.score, ev = (s.events || []).map((e) => e.type).filter((x) => x !== 'step' && x !== 'cover');
        c.__slow.push({ at: Math.round(t0), t: +s.t.toFixed(1), ms: +du.toFixed(1), ev: ev.join('+'), sec: sc.cond.section, art: sc.art.pieces.filter((p) => !p.ended).map((p) => p.type + '@' + (sc.now - p.t0).toFixed(1)).join(','), lvl: sc.levelId });
      }
      return r;
    };
    let last = performance.now();
    c.__long = [];
    const tick = () => { const n = performance.now(); c.__frames.push(n - last); if (n - last > 40 && c.__frames.length > 30) c.__long.push({ at: Math.round(n), dt: Math.round(n - last) }); last = n; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(60000);
  perf = await page.evaluate(() => {
    const c = window.__contours;
    const q = (arr, p) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0; };
    const u = c.__upd, f = c.__frames.slice(30);
    return {
      level: c.game.level.id, simT: +c.game.state.t.toFixed(1), fires: c.game.state.discovered.length,
      updates: u.length, updP50: +q(u, 0.5).toFixed(2), updP99: +q(u, 0.99).toFixed(2), updMax: +Math.max(...u).toFixed(1),
      frameP50: +q(f, 0.5).toFixed(1), frameP99: +q(f, 0.99).toFixed(1), longFrames: f.filter((x) => x > 50).length,
      ctx: c.audio.ctx.state, audioErrors: (c.audio.errors || []).length, slow: c.__slow.slice(0, 20), longFrameList: c.__long.slice(0, 20),
    };
  });
  perf.errors = errors.slice(0, 5);
  perf.ok = perf.ctx === 'running' && perf.updP99 < 8 && perf.audioErrors === 0 && errors.length === 0;
  if (!perf.ok) failed = true;
  await page.screenshot({ path: path.join(outDir, 'perf-final.png') });
  await page.close();
}

await browser.close();
srv.close();

console.table(results.map((r) => ({ ...r, errors: r.errors.join(' | ').slice(0, 80) })));
if (audioCheck) console.log('audio/menu flow:', JSON.stringify(audioCheck));
if (perf) console.log('realtime perf:', JSON.stringify(perf));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, audioCheck, perf }, null, 2));
console.log(failed ? 'VERIFY-PLAY: FAIL' : 'VERIFY-PLAY: PASS');
process.exit(failed ? 1 : 0);
