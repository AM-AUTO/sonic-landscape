// Renders title / select / play / map / notes / pause / complete screens to out/render-*.png (3x).
// usage: node tools/render-preview.mjs [--worlds mock:glen,real:0,real:1] [--scale 3] [--out out]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const frame = (spec) => page.evaluate(([s, sc]) => window.P.frame(s, sc), [spec, SCALE]);

await page.evaluate(() => window.P.initRenderer());

let worlds = (opt('worlds', '') || '').split(',').filter(Boolean);
const nReal = await page.evaluate(() => window.P.realLevels());
if (!worlds.length) {
  worlds = ['mock:glen', 'mock:alpine'];
  for (let i = 0; i < Math.min(nReal, 8); i++) worlds.push('real:' + i);
}
console.log('real levels available:', nReal);

// ---- world-independent screens (use the first world for the clean state)
const first = worlds[0];
await page.evaluate((w) => window.P.setWorld(w), first);
await page.evaluate(() => window.P.useWorldInRenderer());
const levelDefs = await page.evaluate(() => window.P.levelDefs());
save('title', await frame({ state: null, ui: { screen: 'title', time: 2.0 }, warm: 1 }));
save('select', await frame({ state: null, ui: { screen: 'select', levels: levelDefs || undefined, selected: 2, time: 1.1, unlocked: ['rannoch', 'affric', 'coe'], completed: ['rannoch'] }, warm: 1 }));
save('select-locked', await frame({ state: null, ui: { screen: 'select', levels: levelDefs || undefined, selected: 5, time: 1.4, unlocked: ['rannoch', 'affric', 'coe'], completed: ['rannoch', 'affric'] }, warm: 1 }));

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
  save(`${key}-play-day`, await frame({ state: { ...base, tod: 0.32, at: has('cairn') ? 'cairn' : poiTypes[0], dx: 5, dy: 4, proximity: ['cairn'], resonance: ['lochan', 'trig'], chainLit: 1, discovered: ['lochan', 'trig'] }, ui: { message: 'TRIANGULATION', messageT: 3.2, messageKind: 'artefact', messageSub: 'Triangulation · trig' } }));
  save(`${key}-play-dawn`, await frame({ state: { ...base, tod: 0.09, at: has('bothy') ? 'bothy' : poiTypes[0], dx: -6, dy: 5, heading: 1.6 }, ui: { message: 'Mist lifts from the burn.', messageT: 3, messageKind: 'note' } }));
  save(`${key}-play-dusk`, await frame({ state: { ...base, tod: 0.6, ...sp, heading: 3.14 }, pre: [{ op: 'flash' }], advance: 0.12 }));
  save(`${key}-play-night`, await frame({ state: { ...base, tod: 0.88, at: has('stone') ? 'stone' : poiTypes[0], dx: 3, dy: 3, heading: -1.2, resonance: ['stone'], chainLit: 2, gateOpen: false }, pre: [{ op: 'flash' }, { op: 'rippleAtPlayer', color: 'magenta' }], advance: 0.35 }));
  save(`${key}-play-ripple`, await frame({ state: { ...base, tod: 0.3, at: has('summit') ? 'summit' : poiTypes[0], dx: 3, dy: 5, speed: 0 }, pre: [{ op: 'rippleAtPlayer', color: 'magenta' }, { op: 'pulse', type: 'summit' }], advance: 0.55 }));
  save(`${key}-play-wade`, await frame({ state: { ...base, tod: 0.3, at: has('lochan') ? 'lochan' : poiTypes[0], dx: 0, dy: 0, speed: 2, heading: 0.2, onCover: 'SHALLOW' } }));
  save(`${key}-play-slide`, await frame({ state: { ...base, tod: 0.3, at: has('crag') ? 'crag' : poiTypes[0], dx: 0, dy: 0, speed: 5, heading: 1.2, onCover: 'SCREE', sliding: true } }));
  save(`${key}-play-gateopen`, await frame({ state: { ...base, tod: 0.35, pos: await page.evaluate(() => ({ x: window.P.world().gate.x, y: window.P.world().gate.y - 14 })), gateOpen: true, chainLit: 3, heading: 1.57, discovered: ['lochan', 'cairn', 'summit'] }, advance: 0.2 }));
  save(`${key}-map`, await frame({ state: { ...base, tod: 0.3, ...sp, chainLit: 1, discovered: ['lochan', 'cairn', 'trig', 'summit', 'bothy'] }, ui: { screen: 'map', time: 3 } }));
  save(`${key}-notes`, await frame({ state: { ...base, tod: 0.3 }, ui: { screen: 'notes', time: 3, notes: ['Where the water stands still, listen from above.', 'Stones remember those who wait.', 'The cairn grows when you climb past it, slowly.', 'At dusk the lochan answers the trig.'] } }));
  save(`${key}-pause`, await frame({ state: { ...base, tod: 0.3, ...sp }, ui: { screen: 'pause', time: 3, selected: 1 } }));
  save(`${key}-complete`, await frame({ state: { ...base, tod: 0.3, ...sp, gateOpen: true, chainLit: 3, fragments: ['rannoch'] }, ui: { screen: 'complete', time: 4 }, warm: 3, advance: 0.8 }));
  // timing
  const perf = await page.evaluate(() => window.P.perf(120, { at: 'cairn', heading: 0.4, speed: 4, tod: 0.88 }));
  console.log(w, 'draw() avg', perf.toFixed(2), 'ms/frame (night, worst case)');
}

await browser.close();
await srv.close();
