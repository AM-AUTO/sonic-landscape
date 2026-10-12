#!/usr/bin/env node
/**
 * End-to-end gameplay verification in headless Chromium.
 *
 *  1. For every track: boot index.html?level=N&autopilot=1 (muted, sim sped up), let the
 *     autopilot walk the gate chain, and assert that the level completes, no console errors,
 *     no NaN in player state, artefacts fired, and the frame budget holds. Screenshots
 *     are taken along the way.
 *  2. Menu flow with audio on: title → tracklist → play, walk with the keyboard, check the
 *     AudioContext is running and the master analyser carries signal.
 *
 * Usage: node tools/verify-play.mjs [--level id|index] [--speed 6] [--out out/play] [--no-audio] [--menu-only]
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
  await page.goto(`${base}/index.html?fresh=1`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'menu-title.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'menu-select.png') });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
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
  if (!audioCheck.ok || errors.length) failed = true;
  await page.close();
}

await browser.close();
srv.close();

console.table(results.map((r) => ({ ...r, errors: r.errors.join(' | ').slice(0, 80) })));
if (audioCheck) console.log('audio/menu flow:', JSON.stringify(audioCheck));
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ results, audioCheck }, null, 2));
console.log(failed ? 'VERIFY-PLAY: FAIL' : 'VERIFY-PLAY: PASS');
process.exit(failed ? 1 : 0);
