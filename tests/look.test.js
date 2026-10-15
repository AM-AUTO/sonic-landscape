/**
 * The per-level look system (docs/LEVELS.md §5): season print, light, signature cartography, atmosphere, seasons.
 * The map bake runs in Node through the software canvas in tools/lib/softcanvas.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSoftCanvas, fnvHex } from '../tools/lib/softcanvas.js';
import { lookWorld } from './helpers/lookworld.js';
import { COVER, CELL_PX, SCREEN_W as SW, SCREEN_H as SH, seasonOf } from '../src/world/codes.js';
import { PAL_U32 as U, PAL_U32_LIST, PAL_INDEX as I, paletteIndexOf, phaseBlend, tintAt } from '../src/render/palette.js';
import { lookOf, SIGNATURES, ATMOSPHERES, PAPERS, DEFAULT_LIGHT } from '../src/render/look.js';
import { darknessAt, twilightAt, effectiveNight, WEATHER, createFx, effectsFor } from '../src/render/fx.js';
import { whiteoutAmount } from '../src/render/atmos.js';
import { restingSplit } from '../src/render/hud.js';

installSoftCanvas();
const { bakeMap, bakeOverview, castShadows } = await import('../src/render/mapbake.js');

const PAL_SET = new Set(PAL_U32_LIST.map((u) => u >>> 0));
function offPalette(u32) { let n = 0; for (let i = 0; i < u32.length; i++) if (!PAL_SET.has(u32[i] >>> 0)) n++; return n; }
function diffCount(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }
const count = (u32, col) => { let n = 0; for (let i = 0; i < u32.length; i++) if (u32[i] === col) n++; return n; };

// ---------------------------------------------------------------------------------------------- the API
test('lookOf: no look is the legacy sheet; values are normalised and defaulted', () => {
  const none = lookOf({ id: 'x' });
  assert.equal(none.present, false);
  assert.equal(none.legacyRelief, true);
  assert.equal(none.paper, 'paper');
  assert.deepEqual({ ...none.light }, { ...DEFAULT_LIGHT });
  assert.equal(none.sig.size, 0);
  const l = lookOf({ look: { paper: 'frost', light: { az: -90, el: 200, strength: 9 }, signature: ['railway', 7, 'aurora'] } });
  assert.equal(l.present, true);
  assert.equal(l.paper, 'frost');
  assert.equal(l.light.az, 270);
  assert.equal(l.light.el, 89);
  assert.equal(l.light.strength, 1.5);
  assert.deepEqual([...l.signature], ['railway', 'aurora']);
  assert.equal(l.legacyRelief, false);
  assert.equal(lookOf({ look: { paper: 'tartan' } }).paper, 'paper', 'unknown paper falls back');
  assert.equal(lookOf({ look: { signature: ['dam'] } }).legacyRelief, true, 'a look with only signatures keeps the legacy relief');
  // a world carrying a level is accepted too, and the result is cached per look object
  const lv = { look: { paper: 'snow' } };
  assert.equal(lookOf({ level: lv }), lookOf(lv));
  for (const p of Object.values(PAPERS)) for (const k of ['base', 'shade', 'deep', 'snowShade', 'snowDeep', 'rock', 'ice']) assert.ok(I[p[k]] !== undefined, k + ' ' + p[k]);
  // the two name lists do not overlap
  for (const n of SIGNATURES) assert.ok(!ATMOSPHERES.includes(n), n);
});

// -------------------------------------------------------------------------------------- the legacy bake
test('no look = the bake is pixel-identical to the sheet before the look system (hash of the reference world)', () => {
  const w = lookWorld({ size: 96 });
  const c = bakeMap(w);
  // reference hashes taken from the bake as it was before level.look existed
  assert.equal(fnvHex(c.pixels), '3adbbafa');
  assert.equal(fnvHex(c.lvl), '3a137b4d');
  assert.equal(fnvHex(c.lvlKind), '64e527a7');
  assert.equal(c.reveal, null);
  const o = bakeOverview(w, 48, { contourEvery: 50 }), o2 = bakeOverview(w, 96, { contourEvery: 50, grid: true });
  assert.equal(fnvHex(o.getContext('2d').getImageData(0, 0, 48, 48).data), 'a013a0ff');
  assert.equal(fnvHex(o2.getContext('2d').getImageData(0, 0, 96, 96).data), 'f970bb4c');
  // an explicit default look (paper print, no light, no signatures) changes nothing either
  const d = bakeMap(lookWorld({ size: 96, look: { paper: 'paper', signature: [] } }));
  assert.equal(fnvHex(d.pixels), '3adbbafa');
});

// -------------------------------------------------------------------------------------- prints and light
test('every season print is strictly in palette and its ground colour leads the sheet; labels sit on it', () => {
  for (const paper of Object.keys(PAPERS)) {
    const c = bakeMap(lookWorld({ size: 96, look: { paper, light: { az: 180, el: 12 } } }));
    assert.equal(offPalette(c.pixels), 0, paper);
    const base = U[PAPERS[paper].base];
    const hist = new Map();
    for (const v of c.pixels) hist.set(v, (hist.get(v) || 0) + 1);
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
    assert.ok(top.includes(base), paper + ': the print is the main ground colour');
    if (paper !== 'paper') assert.equal(count(c.pixels, U.paper) < count(c.pixels, base), true, paper + ': legacy paper does not dominate');
    // contours and water stay legible: both still drawn in their own colours
    assert.ok(count(c.pixels, U.contourIdx) > 200 && count(c.pixels, U.water) > 500, paper);
  }
});

test('light: a low winter sun gives harder, longer relief (cast shadows) than a high soft one', () => {
  const shadeCount = (look) => { const c = bakeMap(lookWorld({ size: 96, look })); return count(c.pixels, U.paper2); };
  const low = shadeCount({ light: { az: 180, el: 6, strength: 1 } });
  const high = shadeCount({ light: { az: 180, el: 50, strength: 0.6 } });
  assert.ok(low > high * 1.3, `low sun ${low} vs high sun ${high}`);
  // cast shadows: the ground north of the ridge lies in shadow of a southern sun, a northern sun lights it
  const w = lookWorld({ size: 96 });
  const azr = Math.PI;                                     // sun in the south
  const s = castShadows(w, Math.sin(azr), -Math.cos(azr), Math.tan((6 * Math.PI) / 180));
  let lit = 0, shaded = 0;
  for (let i = 0; i < s.length; i++) { if (s[i] > 0.5) shaded++; else lit++; }
  assert.ok(shaded > 50 && lit > shaded, `shadow cells ${shaded}`);
  const flat = castShadows(w, 0, 1, Math.tan((60 * Math.PI) / 180));
  assert.ok(flat.reduce((a, b) => a + b, 0) < s.reduce((a, b) => a + b, 0) * 0.2, 'a high sun casts almost nothing');
  // turning the sun changes the relief
  const a = bakeMap(lookWorld({ size: 96, look: { light: { az: 90, el: 15 } } })), b = bakeMap(lookWorld({ size: 96, look: { light: { az: 270, el: 15 } } }));
  assert.ok(diffCount(a.pixels, b.pixels) > 2000);
});

// ---------------------------------------------------------------------------------------- signatures
const SIG_PARAMS = {
  tidalRace: { tidalRace: { x: 5, y: 40, r: 6 } },
  dam: { dam: { x0: 38, y0: 75, x1: 46, y1: 75 } },
  castle: { castle: { x: 30, y: 50, name: 'Caisteal' } },
  railway: { railway: { points: [[16, 2], [30, 30], [44, 60], [50, 93]], halts: [{ x: 30, y: 30, name: 'Halt' }] } },
  shieling: { shielings: [[34, 20], [38, 26], [52, 44]] },
  gabbro: { gabbro: { x: 68, y: 50, r: 30 } },
  redScree: { redScree: { x: 70, y: 50, r: 30 } },
  boulders: { boulders: { x: 50, y: 30, r: 14 } },
  hiddenValley: { hidden: { x: 40, y: 45, r: 8 } },
  gullySnow: { gullySnow: { above: 100 } },
};
test('every signature renders strictly in palette, and each one draws something on the reference world', () => {
  const plain = bakeMap(lookWorld({ size: 96, look: { paper: 'paper', signature: [] } }));
  const quiet = new Set(['riverIce', 'spate']);            // need real burns; checked on their own below
  for (const name of SIGNATURES) {
    for (const paper of ['paper', 'snow']) {
      const look = { paper, signature: [name], ...(SIG_PARAMS[name] || {}) };
      const c = bakeMap(lookWorld({ size: 96, look }));
      assert.equal(offPalette(c.pixels), 0, `${name} on ${paper}: off-palette pixels`);
      if (paper === 'paper' && !quiet.has(name)) assert.ok(diffCount(c.pixels, plain.pixels) > 20, `${name} draws something (${diffCount(c.pixels, plain.pixels)})`);
    }
  }
  // all at once, on every print
  for (const paper of Object.keys(PAPERS)) {
    const look = { paper, light: { az: 200, el: 9 }, signature: [...SIGNATURES], ...Object.assign({}, ...Object.values(SIG_PARAMS)) };
    const c = bakeMap(lookWorld({ size: 96, look }));
    assert.equal(offPalette(c.pixels), 0, paper);
  }
});

test('signatures draw what they say: ice lochans, blue contours on snow, the tidal race over water only, labels', () => {
  const plain = bakeMap(lookWorld({ size: 96, look: { signature: [] } }));
  const ice = bakeMap(lookWorld({ size: 96, look: { signature: ['iceLochans'] } }));
  assert.ok(count(ice.pixels, U.frost) > 200, 'frozen lochans fill with frost');
  assert.ok(count(ice.pixels, U.water) < count(plain.pixels, U.water), 'less open water');
  assert.ok(count(ice.pixels, U.water) > 1000, 'the sea stays open water');
  const blue = bakeMap(lookWorld({ size: 96, look: { signature: ['blueContoursOnSnow'] } }));
  assert.ok(count(blue.pixels, U.steel) + count(blue.pixels, U.paleblue) > 100 && count(plain.pixels, U.steel) === 0);
  const tr = bakeMap(lookWorld({ size: 96, look: { signature: ['tidalRace'], ...SIG_PARAMS.tidalRace } }));
  const W = tr.W;
  let onLand = 0;
  for (let i = 0; i < tr.pixels.length; i++) {
    if (tr.pixels[i] !== plain.pixels[i] && tr.pixels[i] === U.waterInk) {
      const c = tr.cls[i];
      if (c !== COVER.SHALLOW && c !== COVER.DEEP) onLand++;
    }
  }
  assert.ok(onLand < 40, 'the wave symbols stay on the water (label aside): ' + onLand);
  void W;
  const br = bakeMap(lookWorld({ size: 96, look: { signature: ['bracken'] } }));
  assert.ok(count(br.pixels, U.rust) > 30, 'bracken is rust');
  const rail = bakeMap(lookWorld({ size: 96, look: { signature: ['railway'], ...SIG_PARAMS.railway } }));
  assert.ok(count(rail.pixels, U.ember) >= 6, 'the halt is a red disc');
});

test('river ice and spate change the burns of a world that has them', () => {
  const w = lookWorld({ size: 96 });
  // a long, clean burn down the glen, in its own channel falling to the south
  w.stream.fill(0);
  for (let y = 4; y < 60; y++) { w.stream[y * 96 + 46] = 1; w.height[y * 96 + 46] -= 30 + y; }
  w.minH = Math.min(w.minH, ...w.height);
  const base = bakeMap({ ...w, level: { ...w.level, look: { signature: [] } } });
  const ice = bakeMap({ ...w, level: { ...w.level, look: { signature: ['riverIce'] } } });
  const spate = bakeMap({ ...w, level: { ...w.level, look: { signature: ['spate'] } } });
  assert.ok(count(ice.pixels, U.ice) > count(base.pixels, U.ice) + 10, 'ice on the burn');
  assert.ok(count(spate.pixels, U.waterInk) > count(base.pixels, U.waterInk) + 20, 'the burn runs fuller');
  assert.equal(offPalette(ice.pixels) + offPalette(spate.pixels), 0);
});

test('hidden valley: blank on the sheet until revealed; the reveal record restores exactly the revealed bake', () => {
  const look = { signature: ['hiddenValley'], ...SIG_PARAMS.hiddenValley };
  const veiled = bakeMap(lookWorld({ size: 96, look }));
  const open = bakeMap(lookWorld({ size: 96, look }), { revealed: true });
  const rv = veiled.reveal;
  assert.ok(rv && rv.key === 'hidden' && rv.w > 0 && rv.h > 0);
  assert.equal(open.reveal, null);
  const W = veiled.W;
  let inside = 0, outside = 0;
  for (let i = 0; i < veiled.pixels.length; i++) {
    if (veiled.pixels[i] === open.pixels[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (x >= rv.x0 && y >= rv.y0 && x < rv.x0 + rv.w && y < rv.y0 + rv.h) inside++; else outside++;
  }
  assert.equal(outside, 0, 'nothing outside the valley changes');
  assert.ok(inside > 200, 'the valley is blanked: ' + inside);
  // centre of the valley: ground colour only (and the km grid)
  const cx = Math.round(40 * CELL_PX + 2), cy = Math.round(45 * CELL_PX + 2);
  for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 6; x <= cx + 6; x++) assert.ok([U.paper, U.grid].includes(veiled.pixels[y * W + x]));
  // restoring the box gives back the revealed sheet
  const px = veiled.pixels.slice(), lv = veiled.lvl.slice();
  for (let y = 0; y < rv.h; y++) { px.set(rv.pixels.subarray(y * rv.w, (y + 1) * rv.w), (rv.y0 + y) * W + rv.x0); lv.set(rv.lvl.subarray(y * rv.w, (y + 1) * rv.w), (rv.y0 + y) * W + rv.x0); }
  assert.equal(diffCount(px, open.pixels), 0);
  assert.equal(diffCount(lv, open.lvl), 0);
  // the overview hides it too, until revealed
  const ov = bakeOverview(lookWorld({ size: 96, look }), 96, {}), ovo = bakeOverview(lookWorld({ size: 96, look }), 96, { revealed: true });
  const a = ov.getContext('2d').getImageData(0, 0, 96, 96).data, b = ovo.getContext('2d').getImageData(0, 0, 96, 96).data;
  assert.ok(diffCount(new Uint32Array(a.buffer), new Uint32Array(b.buffer)) > 20);
});

// --------------------------------------------------------------------------------------------- seasons
test('seasons: no season = the quarters exactly; a long night is dark for longer', () => {
  const long = { night: 0.7, dawn: 0.06, dusk: 0.06 };
  for (let t = 0; t < 1; t += 0.0137) {
    assert.deepEqual(phaseBlend(t, undefined), phaseBlend(t));
    assert.deepEqual(phaseBlend(t, { level: 1 }), phaseBlend(t), 'a season-less object');
    assert.deepEqual(phaseBlend(t, { night: 0.25, dawn: 0.25, dusk: 0.25 }), phaseBlend(t), 'the default shares');
    assert.equal(darknessAt(t, null), darknessAt(t));
    assert.equal(twilightAt(t, undefined), twilightAt(t));
    assert.deepEqual(tintAt(t, null, null), tintAt(t));
    assert.deepEqual(tintAt(t, null, seasonOf({ id: 'no-season' })), tintAt(t), 'seasonOf() of a season-less level is the legacy day');
    assert.equal(darknessAt(t, seasonOf(undefined)), darknessAt(t));
  }
  // darkness integrated over the day: the midwinter night holds far more of it
  let dq = 0, dl = 0;
  for (let t = 0; t < 1; t += 0.001) { dq += darknessAt(t); dl += darknessAt(t, long); }
  assert.ok(dl > dq * 1.6, `long night ${dl.toFixed(0)} vs quarters ${dq.toFixed(0)}`);
  // every moment the season calls night is fully dark (bar the eased edge), and day is light
  const q = seasonOf(long);
  const nightStart = q.dawn + q.day + q.dusk;
  for (let t = nightStart + 0.03; t < 0.99; t += 0.01) assert.ok(darknessAt(t, long) > 0.99, 't ' + t);
  assert.equal(darknessAt(q.dawn + q.day / 2, long), 0);
  assert.ok(effectiveNight(0, 0.6, WEATHER.rannoch, long) > 0.9 && effectiveNight(0, 0.6, WEATHER.rannoch) < 0.85);
  // a short (Bealltainn) night: light for most of the cycle
  let ds = 0; for (let t = 0; t < 1; t += 0.001) ds += darknessAt(t, { night: 0.3, dawn: 0.12, dusk: 0.12 });
  assert.ok(ds < dq);
  // the resting arc hands the sky to the moon at the end of the day phase
  assert.equal(restingSplit(null), 0.5);
  assert.equal(restingSplit({ id: 'x' }), 0.5);
  assert.ok(Math.abs(restingSplit(long) - (q.dawn + q.day)) < 1e-9);
});

// ------------------------------------------------------------------------------------------ atmosphere
function synthAtmos(id, look) {
  const w = lookWorld({ size: 96, id, look });
  w.pois = []; w.heightAt = () => 0;
  return w;
}
function frame(world, { tod, clock, cam = [30, 40], player = { x: 48, y: 50, elevation: 200 }, gateOpen = false, sheet = null, steps = 1 }) {
  const fx = createFx(); fx.setWorld(world);
  if (sheet) fx.setSheet(sheet);
  const MW = world.size * CELL_PX;
  const fb = new Uint32Array(SW * SH);
  const src = sheet ? sheet.pixels : null;
  const [camX, camY] = cam;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) fb[y * SW + x] = src ? src[(y + camY) * MW + x + camX] : U.paper;
  const lvl = sheet ? sheet.lvl : new Int16Array(MW * MW);
  for (let k = 0; k < steps; k++) fx.update({ player, gateOpen }, clock - (steps - 1 - k) / 30, 1 / 30);
  const pre = fx.prepare(fb, camX, camY, tintAt(tod, null, world.level.season), tod, clock, 192, 110, lvl, MW);
  void pre;
  fx.paintGround(fb, camX, camY, clock, lvl, MW);
  fx.paintAir(fb, camX, camY, clock, lvl, MW);
  return { fb, fx };
}

test('atmosphere: every effect, on every print, at every time of day, stays strictly in palette', () => {
  const look = { paper: 'frost', signature: [...ATMOSPHERES], tidalRace: { x: 5, y: 40, r: 6 }, seaFret: { from: 'W' } };
  const w = synthAtmos('lookworld', look);
  const sheet = bakeMap(w);
  assert.equal(effectsFor(w.level).size, ATMOSPHERES.length);
  for (const paper of ['paper', 'fog', 'snow']) {
    const wp = synthAtmos('lookworld', { ...look, paper });
    for (const tod of [0.02, 0.1, 0.375, 0.55, 0.66, 0.875]) {
      const { fb } = frame(wp, { tod, clock: 33.3, sheet, gateOpen: true, steps: 3 });
      assert.equal(offPalette(fb), 0, `${paper} tod ${tod}`);
      // no red or pink washes / stipple from the atmosphere or the tints (only what the sheet itself carries)
      for (const c of [U.heather, U.blood, U.bolt, U.ember, U.rust]) assert.equal(count(fb, c), 0, `${paper} tod ${tod}: red/pink ${c.toString(16)}`);
    }
  }
});

test('atmosphere: each effect shows when it should and not otherwise', () => {
  const base = { paper: 'paper', tidalRace: { x: 12, y: 50, r: 8 } };
  const sheetOf = (w) => bakeMap(w);
  const diffAt = (sig, tod, opts = {}) => {
    const w = synthAtmos('x', { ...base, signature: sig });
    const w0 = synthAtmos('x', { ...base, signature: [] });
    const sheet = sheetOf(w0);
    const a = frame(w, { tod, clock: 40, sheet, ...opts }).fb, b = frame(w0, { tod, clock: 40, sheet, ...opts }).fb;
    return diffCount(a, b);
  };
  // inversion: at dawn, not at midday
  assert.ok(diffAt(['inversion'], 0.06) > 2000, 'inversion at dawn');
  assert.ok(diffAt(['inversion'], 0.375) < 50, 'gone by day');
  // cloud cap: on the summits at night, lifted by day
  assert.ok(diffAt(['cloudCap'], 0.875, { cam: [200, 40] }) > 300, 'cap at night');
  assert.equal(diffAt(['cloudCap'], 0.375, { cam: [200, 40] }), 0, 'lifted by day');
  // thaw mist off the burns at dawn
  assert.ok(diffAt(['thawMist'], 0.06) > 50);
  // sea fret over the west at some point of its two-minute roll
  let fret = 0; for (const c of [0, 30, 60, 90]) fret = Math.max(fret, (() => { const w = synthAtmos('x', { ...base, signature: ['seaFret'] }), w0 = synthAtmos('x', { ...base, signature: [] }); const s = sheetOf(w0); return diffCount(frame(w, { tod: 0.375, clock: c, sheet: s, cam: [0, 40] }).fb, frame(w0, { tod: 0.375, clock: c, sheet: s, cam: [0, 40] }).fb); })());
  assert.ok(fret > 500, 'sea fret ' + fret);
  // whirlpool foam at the tidal race, by day
  assert.ok(diffAt(['whirlpool'], 0.375, { cam: [0, 120] }) > 30);
  // aurora only at night; frost glints only at night
  assert.ok(diffAt(['aurora'], 0.875) > 300 && diffAt(['aurora'], 0.375) === 0);
  assert.ok(diffAt(['frostGlint'], 0.875) > 3 && diffAt(['frostGlint'], 0.375) === 0);
  // white-out: by day in its gusts, never at night
  let wo = 0; for (let c = 0; c < 64; c += 4) wo = Math.max(wo, whiteoutAmount(c, 0));
  assert.ok(wo > 0.8);
  for (let c = 0; c < 64; c += 4) assert.equal(whiteoutAmount(c, 0.97), 0);
});

test('snow and frost sheets at night go to deep blues, never violet or red', () => {
  for (const paper of ['snow', 'frost']) {
    const w = synthAtmos('x', { paper, signature: [] });
    const sheet = bakeMap(w);
    const { fb } = frame(w, { tod: 0.875, clock: 20, sheet, cam: [0, 0] });
    for (const c of [U.dusk, U.heather, U.blood]) assert.ok(count(fb, c) < 40, `${paper} night: ${c.toString(16)} ${count(fb, c)}`);
    assert.ok(count(fb, U.steelD) + count(fb, U.deepblue) + count(fb, U.night) > 20000, paper);
  }
});

test('first snow falls only after the gate opens', () => {
  const w = synthAtmos('corryvreckan', undefined);
  const sheet = bakeMap(synthAtmos('x', undefined));
  const snowPx = (fb) => count(fb, U.grid) + count(fb, U.ice);
  const before = frame(w, { tod: 0.375, clock: 50, sheet, gateOpen: false, steps: 2 });
  assert.equal(before.fx.eff.snow, 0);
  // the gate opened 30 s ago: the fx sees it open on every update since
  const fx = createFx(); fx.setWorld(w); fx.setSheet(sheet);
  for (let t = 20; t <= 50; t += 0.5) fx.update({ player: { x: 48, y: 50, elevation: 10 }, gateOpen: true }, t, 0.5);
  assert.ok(fx.eff.snow > 0.4, 'snowing: ' + fx.eff.snow);
  const fb = new Uint32Array(SW * SH).fill(U.paper), fb0 = fb.slice();
  fx.prepare(fb, 30, 40, tintAt(0.375), 0.375, 50, 192, 110, sheet.lvl, sheet.W);
  fx.paintAir(fb, 30, 40, 50, sheet.lvl, sheet.W);
  assert.ok(snowPx(fb) - snowPx(fb0) > 100, 'flakes in the air');
  assert.equal(offPalette(fb), 0);
});

test('deer: a herd appears on the high ground well away from the walker and moves off when approached', () => {
  const w = synthAtmos('rannoch', undefined);
  const fx = createFx(); fx.setWorld(w);
  const p = { x: 40, y: 50, elevation: 100 };
  for (let t = 0; t < 3; t += 1 / 30) fx.update({ player: p }, t, 1 / 30);
  const H = fx.atmos.herd;
  assert.ok(H, 'a herd');
  const d0 = Math.hypot(H.x - p.x, H.y - p.y);
  assert.ok(d0 >= 20, 'far from the walker: ' + d0);
  // walk right up to them: they flee and the gap opens again
  const q = { x: H.x - 10, y: H.y, elevation: 500 };
  for (let t = 3; t < 6; t += 1 / 30) fx.update({ player: q }, t, 1 / 30);
  assert.ok(fx.atmos.herd === null || fx.atmos.herd.fleeing, 'they bolt');
  if (fx.atmos.herd) assert.ok(Math.hypot(fx.atmos.herd.x - q.x, fx.atmos.herd.y - q.y) > 10);
});
