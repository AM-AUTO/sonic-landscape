// Renders title / select / play / map / notes / pause / complete screens to out/render-*.png (3x).
// usage: node tools/render-preview.mjs [--worlds mock:glen,real:0,real:1] [--scale 3] [--out out] [--fx-only] [--no-fx]
// The atmosphere pass (weather on) renders real levels 0 rannoch, 2 coe, 3 cairngorm, 5 cuillin: day / dusk / night play
// frames, a lightning (or storm) frame, a mist frame, a bothy-at-night frame and walker crops at 8x, plus the walker
// pose sheet and the gate ring-cross sheet. Every frame is checked against the strict 21-colour palette.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARTEFACT_NAMES, BANNER, fmt } from '../src/text.js';
import { LEVELS } from '../src/world/levels/index.js';
import { describeCondition } from '../src/game/describe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const g = execSync('npm root -g').toString().trim();
  const require = createRequire(import.meta.url);
  return require(path.join(g, 'playwright'));
}

async function loadServer() {
  const serve = path.join(here, 'lib', 'serve.mjs');
  if (fs.existsSync(serve)) {
    const m = await import(serve);
    if (m.startServer) return m.startServer;
  }
  throw new Error('tools/lib/serve.mjs (startServer) is required');
}

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SCALE = +opt('scale', 3);
const FX_ONLY = args.includes('--fx-only');
const NO_FX = args.includes('--no-fx');
const OUT = path.resolve(root, opt('out', 'out'));
fs.mkdirSync(OUT, { recursive: true });

const { chromium } = await loadPlaywright();
const startServer = await loadServer();
const srv = await startServer(root, 0);
const baseUrl = srv.url || `http://127.0.0.1:${srv.port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(baseUrl + '/tools/render-preview.html');
await page.waitForFunction(() => window.__ready);

const save = (name, dataUrl) => {
  const f = path.join(OUT, `render-${name}.png`);
  fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', path.relative(root, f));
};
const cropShot = (spec, x, y, w, h, sc) => page.evaluate(([s, a, b, c, d, e]) => window.P.crop(s, a, b, c, d, e), [spec, x, y, w, h, sc]);
let levelDefs = null;   // real level definitions: the tracklist and the complete card are built from them
const withLevels = (spec) => (levelDefs && spec.ui && !spec.ui.levels ? { ...spec, ui: { ...spec.ui, levels: levelDefs } } : spec);
const frame = (spec) => page.evaluate(([s, sc]) => window.P.frame(s, sc), [withLevels(spec), SCALE]);

await page.evaluate(() => window.P.initRenderer());

let worlds = (opt('worlds', '') || '').split(',').filter(Boolean);
if (FX_ONLY && !worlds.length) worlds = [];
const nReal = await page.evaluate(() => window.P.realLevels());
if (!worlds.length && !FX_ONLY) {
  worlds = ['mock:glen', 'mock:alpine'];
  for (let i = 0; i < Math.min(nReal, 8); i++) worlds.push('real:' + i);
}
console.log('real levels available:', nReal);

// ---- world-independent screens (use the first world for the clean state)
const first = worlds[0] || 'real:0';
await page.evaluate((w) => window.P.setWorld(w), first);
await page.evaluate(() => window.P.useWorldInRenderer());
levelDefs = await page.evaluate(() => window.P.levelDefs());
if (!FX_ONLY) {
save('title', await frame({ state: null, ui: { screen: 'title', time: 2.0 }, warm: 1 }));
save('title-touch', await frame({ state: null, ui: { screen: 'title', time: 2.0 }, touch: 'idle', warm: 1 }));
save('select', await frame({ state: null, ui: { screen: 'select', levels: levelDefs || undefined, selected: 2, time: 1.1, unlocked: ['rannoch', 'affric', 'coe'], completed: ['rannoch'] }, warm: 1 }));
save('select-locked', await frame({ state: null, ui: { screen: 'select', levels: levelDefs || undefined, selected: 5, time: 1.4, unlocked: ['rannoch', 'affric', 'coe'], completed: ['rannoch', 'affric'] }, warm: 1 }));

}
for (const w of worlds) {
  const key = w.replace(':', '-');
  const info = await page.evaluate((x) => window.P.setWorld(x), w);
  if (info.error) { console.log('skip', w, info.error); continue; }
  const ms = await page.evaluate(() => window.P.useWorldInRenderer());
  console.log(w, info.name, 'setWorld+bake', Math.round(ms), 'ms');
  const poiTypes = await page.evaluate(() => window.P.world().pois.map((p) => p.type));
  const has = (t) => poiTypes.includes(t);
  const sp = { at: has('lochan') ? 'lochan' : poiTypes[0], dx: 4, dy: 3 };
  const base = { heading: 0.4, speed: 4.2 };
  // day, walking, with a gate chain half-lit and a resonance
  save(`${key}-play-day`, await frame({ state: { ...base, tod: 0.32, at: has('cairn') ? 'cairn' : poiTypes[0], dx: 5, dy: 4, proximity: ['cairn'], resonance: ['lochan', 'trig'], chainLit: 1, discovered: ['lochan', 'trig'] }, ui: { message: ARTEFACT_NAMES.trig, messageT: 3.2, messageKind: 'artefact', messageSub: fmt(BANNER.keyWoken.sub, { n: 1, N: 2, secs: 90 }) } }));
  // ---- discovery layer (UX pass): chain bar, partial banner, knowledge marks, learned map
  const nChain = await page.evaluate(() => window.P.world().gate.chain.length);
  const know = 'demo';
  const dBase = { ...base, tod: 0.32, know, trail: 'walk', speed: 3 };
  const hudSpec = { state: { ...dBase, atIdx: 0, dx: 9, dy: 7 } };
  save(`${key}-hud-idle`, await frame(hudSpec));
  save(`${key}-hud-idle-crop`, await cropShot(hudSpec, 0, 160, 260, 56, 6));
  const resSpec = { state: { ...dBase, atIdx: 1, dx: -12, dy: 8, litTypes: [await page.evaluate(() => window.P.world().gate.chain[0])], resonance: [await page.evaluate(() => window.P.world().gate.chain[0]), 'bothy'] } };
  save(`${key}-hud-res`, await frame(resSpec));
  save(`${key}-hud-res-crop`, await cropShot(resSpec, 0, 150, 260, 66, 6));
  const allSpec = { state: { ...dBase, atIdx: 0, dx: 12, dy: 6, chainLit: nChain, resonance: await page.evaluate(() => window.P.world().gate.chain.slice()) } };
  save(`${key}-hud-gate`, await frame(allSpec));
  save(`${key}-hud-gate-crop`, await cropShot(allSpec, 0, 160, 260, 56, 6));
  const partialUi = { message: fmt(BANNER.partial.title, { artefact: ARTEFACT_NAMES.lochan }), messageT: 3.2, messageDur: 5, messageKind: 'partial', messageSub: LEVELS[0].pois[0].hint, messageSub2: describeCondition('speed', { speed: 'slow' }) };
  save(`${key}-partial`, await frame({ state: { ...dBase, atIdx: 0, dx: 5, dy: 4 }, ui: partialUi }));
  save(`${key}-partial-crop`, await cropShot({ state: { ...dBase, atIdx: 0, dx: 5, dy: 4 }, ui: partialUi }, 60, 10, 270, 64, 4));
  const markSpec = { state: { ...dBase, atIdx: 0, dx: 14, dy: 10, speed: 0 } };
  save(`${key}-marks`, await frame(markSpec));
  save(`${key}-marks-crop`, await cropShot({ state: { ...dBase, atIdx: 1, dx: 8, dy: 6, speed: 0 } }, 100, 40, 190, 120, 5));
  save(`${key}-map-know`, await frame({ state: { ...dBase, atIdx: 1, dx: 6, dy: 5, chainLit: 1, resonance: [await page.evaluate(() => window.P.world().gate.chain[0])] }, ui: { screen: 'map', time: 3 } }));
  save(`${key}-map-know-empty`, await frame({ state: { ...base, tod: 0.3 }, ui: { screen: 'map', time: 3 } }));
  save(`${key}-play-dawn`, await frame({ state: { ...base, tod: 0.09, at: has('bothy') ? 'bothy' : poiTypes[0], dx: -6, dy: 5, heading: 1.6 }, ui: { message: fmt(BANNER.fieldNote, { note: LEVELS[0].fieldNotes[0] }), messageT: 3, messageKind: 'note' } }));
  save(`${key}-play-dusk`, await frame({ state: { ...base, tod: 0.6, ...sp, heading: 3.14 }, pre: [{ op: 'flash' }], advance: 0.12 }));
  save(`${key}-play-night`, await frame({ state: { ...base, tod: 0.88, at: has('stone') ? 'stone' : poiTypes[0], dx: 3, dy: 3, heading: -1.2, resonance: ['stone'], chainLit: 2, gateOpen: false }, pre: [{ op: 'flash' }, { op: 'rippleAtPlayer', color: 'magenta' }], advance: 0.35 }));
  save(`${key}-play-ripple`, await frame({ state: { ...base, tod: 0.3, at: has('summit') ? 'summit' : poiTypes[0], dx: 3, dy: 5, speed: 0 }, pre: [{ op: 'rippleAtPlayer', color: 'magenta' }, { op: 'pulse', type: 'summit' }], advance: 0.55 }));
  save(`${key}-play-wade`, await frame({ state: { ...base, tod: 0.3, at: has('lochan') ? 'lochan' : poiTypes[0], dx: 0, dy: 0, speed: 2, heading: 0.2, onCover: 'SHALLOW' } }));
  save(`${key}-play-slide`, await frame({ state: { ...base, tod: 0.3, at: has('crag') ? 'crag' : poiTypes[0], dx: 0, dy: 0, speed: 5, heading: 1.2, onCover: 'SCREE', sliding: true } }));
  save(`${key}-play-gateopen`, await frame({ state: { ...base, tod: 0.35, pos: await page.evaluate(() => ({ x: window.P.world().gate.x, y: window.P.world().gate.y - 14 })), gateOpen: true, chainLit: 3, heading: 1.57, discovered: ['lochan', 'cairn', 'summit'] }, advance: 0.2 }));
  save(`${key}-play-resting`, await frame({ state: { ...base, tod: 0.3, at: has('bothy') ? 'bothy' : poiTypes[0], dx: 6, dy: 3, speed: 0, resting: true }, ui: {} }));
  save(`${key}-play-touch`, await frame({ state: { ...base, tod: 0.3, at: has('cairn') ? 'cairn' : poiTypes[0], dx: 7, dy: 3, speed: 3, proximity: ['cairn'] }, ui: {}, touch: 'active' }));
  save(`${key}-play-touch-idle`, await frame({ state: { ...base, tod: 0.3, speed: 0 }, ui: {}, touch: 'idle' }));
  save(`${key}-map`, await frame({ state: { ...base, tod: 0.3, ...sp, chainLit: 1, discovered: ['lochan', 'cairn', 'trig', 'summit', 'bothy'] }, ui: { screen: 'map', time: 3 } }));
  save(`${key}-notes`, await frame({ state: { ...base, tod: 0.3 }, ui: { screen: 'notes', time: 3, notes: LEVELS[0].fieldNotes } }));
  save(`${key}-pause`, await frame({ state: { ...base, tod: 0.3, ...sp }, ui: { screen: 'pause', time: 3, selected: 1 } }));
  save(`${key}-complete`, await frame({ state: { ...base, tod: 0.3, ...sp, gateOpen: true, chainLit: 3, fragments: ['rannoch'] }, ui: { screen: 'complete', time: 4 }, warm: 3, advance: 0.8 }));
  // timing
  const perf = await page.evaluate(() => window.P.perf(120, { at: 'cairn', heading: 0.4, speed: 4, tod: 0.88 }));
  console.log(w, 'draw() avg', perf.toFixed(2), 'ms/frame (night, worst case)');
}

// ------------------------------------------------------------------ atmosphere (weather on)
const FX_LEVELS = [0, 2, 3, 5];
const saveRaw = (name, dataUrl) => save(name, dataUrl);
if (!NO_FX && nReal > 0) {
  saveRaw('fx-sprites', await page.evaluate(() => window.P.sprites(8)));
  saveRaw('fx-gates', await page.evaluate(() => window.P.gates(10)));
  for (const L of FX_LEVELS) {
    if (L >= nReal) continue;
    const key = 'fx-' + L;
    const info = await page.evaluate((x) => window.P.setWorld(x), 'real:' + L);
    await page.evaluate(() => window.P.useWorldInRenderer());
    const fi = await page.evaluate(() => window.P.fxInfo());
    console.log('fx level', L, fi.id, 'bothies', fi.bothies, 'storm', !!fi.weather.lightning);
    const poiTypes = await page.evaluate(() => window.P.world().pois.map((p) => p.type));
    const has = (t) => poiTypes.includes(t);
    const at = has('lochan') ? 'lochan' : poiTypes[0];
    const base = { heading: 0.3, speed: 3.2 };
    const T = 41;
    save(`${key}-day`, await frame({ state: { ...base, tod: 0.33, at, dx: 5, dy: 3 }, ui: { time: T } }));
    save(`${key}-dusk`, await frame({ state: { ...base, tod: 0.62, at, dx: 5, dy: 3 }, ui: { time: T } }));
    save(`${key}-night`, await frame({ state: { ...base, tod: 0.88, at, dx: 5, dy: 3 }, ui: { time: T } }));
    save(`${key}-mist`, await frame({ state: { ...base, tod: 0.3, at, dx: 0, dy: 2, speed: 0 }, ui: { time: T + 3 } }));
    save(`${key}-mist-dusk`, await frame({ state: { ...base, tod: 0.6, at, dx: 0, dy: 2, speed: 0 }, ui: { time: T + 3 } }));
    const t0 = await page.evaluate(() => window.P.strike(1));
    if (t0 != null) {
      save(`${key}-lightning`, await frame({ state: { ...base, tod: 0.86, at, dx: 5, dy: 3 }, ui: { time: t0 + 0.02 }, warm: 2 }));
      save(`${key}-lightning-bolt`, await frame({ state: { ...base, tod: 0.86, at, dx: 5, dy: 3 }, ui: { time: t0 + 0.11 }, warm: 2 }));
      save(`${key}-lightning-day`, await frame({ state: { ...base, tod: 0.33, at, dx: 5, dy: 3 }, ui: { time: t0 + 0.02 }, warm: 2 }));
    } else {
      save(`${key}-weather`, await frame({ state: { ...base, tod: 0.8, at, dx: 5, dy: 3 }, ui: { time: T + 7 } }));
    }
    if (has('bothy')) {
      save(`${key}-bothy-night`, await frame({ state: { ...base, tod: 0.88, at: 'bothy', dx: -9, dy: 6, heading: 0.2, speed: 0 }, ui: { time: T } }));
      save(`${key}-bothy-dusk`, await frame({ state: { ...base, tod: 0.63, at: 'bothy', dx: -9, dy: 6, heading: 0.2, speed: 0 }, ui: { time: T } }));
      save(`${key}-bothy-day`, await frame({ state: { ...base, tod: 0.33, at: 'bothy', dx: -9, dy: 6, heading: 0.2, speed: 0 }, ui: { time: T } }));
    }
    // walker crops at 8x (day / night; walking E, idle S)
    const crop = (spec) => cropShot(spec, 160, 84, 64, 48, 8);
    save(`${key}-walker-day`, await crop({ state: { ...base, tod: 0.33, at, dx: 5, dy: 3, heading: 0.1 }, ui: { time: T } }));
    save(`${key}-walker-night`, await crop({ state: { ...base, tod: 0.88, at, dx: 5, dy: 3, heading: 1.5, speed: 0 }, ui: { time: T } }));
    // timing: night, weather on, walking
    const tm = await page.evaluate(() => window.P.perfFx(180, { at: 'cairn', heading: 0.4, speed: 4, tod: 0.88 }, 30));
    console.log(`fx level ${L} (${fi.id}) draw() night+weather: avg ${tm.avg.toFixed(2)} ms  p95 ${tm.p95.toFixed(2)} ms  max ${tm.max.toFixed(2)} ms`);
  }
}
const pr = await page.evaluate(() => window.P.paletteReport());
console.log(`palette audit: ${pr.bad === 0 ? 'OK' : 'FAIL'}  frames with off-palette pixels: ${pr.bad}, distinct palette colours seen: ${pr.used}/${pr.of}`);
if (pr.bad) process.exitCode = 1;

await browser.close();
await srv.close();
