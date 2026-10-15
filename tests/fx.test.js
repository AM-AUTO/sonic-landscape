import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEATHER, WEATHER_DEFAULT, weatherFor, darknessAt, effectiveNight, twilightAt, makeNoiseTex, buildMistField, LightningSchedule,
  flashDensity, boltVisibility, shakeAt, boltPoints, stampLight, flicker, makeParticles, precipitationFor, smokePuff, visibleBothies,
  createFx, BOLT_LIFE, SHAKE_LIFE,
} from '../src/render/fx.js';
import { PAL_U32 as U, PAL_INDEX as I, paletteIndexOf, tintAt, applyTint } from '../src/render/palette.js';
import { COVER, CELL_PX, SCREEN_W as SW, SCREEN_H as SH } from '../src/world/codes.js';
import { LEVELS } from '../src/world/levels/index.js';

const IDS = ['rannoch', 'affric', 'coe', 'cairngorm', 'torridon', 'cuillin', 'assynt', 'nevis', 'corryvreckan', 'cruachan', 'lyon'];

/** a small synthetic world: height rises left to right, a lochan in the low left, bog patch, pines */
function synth({ size = 128, id = 'coe', seed = 777, bothies = [{ x: 60, y: 50 }] } = {}) {
  const N = size * size;
  const height = new Float32Array(N), cover = new Uint8Array(N);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      height[i] = 100 + (x / (size - 1)) * 900;                 // 100 .. 1000 m
      cover[i] = COVER.MOOR;
      if (x > 8 && x < 24 && y > 40 && y < 56) cover[i] = COVER.SHALLOW;
      if (x > 8 && x < 24 && y > 70 && y < 86) cover[i] = COVER.BOG;
    }
  }
  const pois = bothies.map((b, i) => ({ id: 'b' + i, type: 'bothy', x: b.x, y: b.y }));
  pois.push({ id: 'c0', type: 'cairn', x: 40, y: 40 });
  return { size, height, cover, minH: 100, maxH: 1000, level: { id, seed }, pois };
}

test('there is a weather entry for every level id, with sane numbers', () => {
  for (const id of IDS) {
    const w = WEATHER[id];
    assert.ok(w, id);
    assert.equal(weatherFor(id), w);
    for (const k of ['mist', 'cloudline', 'shadow', 'rain', 'snow', 'dark']) assert.ok(w[k] >= 0 && w[k] <= 1, `${id}.${k}`);
    assert.equal(w.wind.length, 2);
  }
  assert.equal(weatherFor('mock-glen'), WEATHER_DEFAULT);
  for (const l of LEVELS) assert.ok(WEATHER[l.id], 'level ' + l.id + ' has weather');
  // the brief (docs/LEVELS.md): Coe is the storm, the only lightning of the new sheets; snow on the winter sheets;
  // each new sheet carries its atmosphere signatures
  assert.ok(WEATHER.coe.lightning && WEATHER.coe.rain > 0.4 && WEATHER.coe.effects.includes('storm'));
  for (const id of ['corryvreckan', 'cruachan', 'lyon', 'rannoch', 'cairngorm', 'cuillin', 'nevis']) assert.equal(WEATHER[id].lightning, null, id);
  assert.ok(WEATHER.torridon.lightning && WEATHER.torridon.shadow >= WEATHER.coe.shadow);
  assert.ok(WEATHER.cairngorm.snow > 0.4 && ['whiteout', 'aurora', 'spindrift'].every((e) => WEATHER.cairngorm.effects.includes(e)));
  assert.ok(WEATHER.rannoch.snow > 0 && WEATHER.rannoch.effects.includes('squalls') && WEATHER.rannoch.effects.includes('deer'));
  assert.ok(WEATHER.corryvreckan.effects.includes('seaFret') && WEATHER.corryvreckan.effects.includes('whirlpool') && WEATHER.corryvreckan.effects.includes('firstSnow') && WEATHER.corryvreckan.snow === 0);
  assert.ok(WEATHER.cruachan.rainStyle === 'sleet' && WEATHER.cruachan.effects.includes('cloudCap'));
  assert.ok(WEATHER.lyon.stars && WEATHER.lyon.effects.includes('frostGlint') && WEATHER.lyon.effects.includes('inversion'));
  assert.ok(WEATHER.cuillin.effects.includes('clearing') && WEATHER.cuillin.rain > 0);
  assert.ok(WEATHER.nevis.effects.includes('thawMist') && WEATHER.nevis.snow === 0);
  assert.ok(WEATHER.assynt.stars && WEATHER.assynt.rain === 0 && WEATHER.assynt.snow === 0 && !WEATHER.assynt.lightning);
  assert.ok(WEATHER.affric.woods > 0 && WEATHER.affric.rain === 0);
});

test('darkness follows the day: none by day, a lot at night, dusk in between; storms add gloom', () => {
  assert.equal(darknessAt(0.375), 0);
  assert.ok(darknessAt(0.875) > 0.99);
  const d = darknessAt(0.625);
  assert.ok(d > 0.5 && d < 0.85, 'dusk ' + d);
  assert.ok(twilightAt(0.625) === 1 && twilightAt(0.375) === 0 && twilightAt(0.875) < 0.2 && twilightAt(0.125) > 0.9, 'the red hours');
  assert.equal(effectiveNight(0, 0.375, WEATHER.assynt), 0);
  assert.ok(effectiveNight(0, 0.375, WEATHER.coe) > 0);
  assert.ok(effectiveNight(0, 0.375, WEATHER.coe) < 0.15);
  assert.ok(effectiveNight(0.97, 0.875, WEATHER.coe) >= 0.97);
  assert.ok(effectiveNight(0, 0.625, WEATHER.assynt) > 0.3);
});

test('noise textures are deterministic, seed-dependent, tileable and span a range', () => {
  const a = makeNoiseTex(11, 128, 64, 48, 12), b = makeNoiseTex(11, 128, 64, 48, 12), c = makeNoiseTex(12, 128, 64, 48, 12);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  let mn = 255, mx = 0;
  for (const v of a) { if (v < mn) mn = v; if (v > mx) mx = v; }
  assert.ok(mx - mn > 120);
  // tileable: the wrap-around seam is as smooth as any interior step
  let seam = 0, inner = 0;
  for (let y = 0; y < 64; y++) { seam += Math.abs(a[y * 128] - a[y * 128 + 127]); inner += Math.abs(a[y * 128 + 64] - a[y * 128 + 63]); }
  assert.ok(seam < inner * 4 + 200, `seam ${seam} vs inner ${inner}`);
});

test('mist field: zero above the cloudline, thick low down, boosted over water and bog, deterministic', () => {
  const w = synth();
  const wx = { ...WEATHER.rannoch };
  const f = buildMistField(w, wx), f2 = buildMistField(w, wx);
  assert.deepEqual(f, f2);
  const S = w.size;
  const at = (x, y) => f[y * S + x];
  // above the cloudline (altitude fraction > cloudline) there is no mist at all
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const alt = (w.height[y * S + x] - w.minH) / (w.maxH - w.minH);
    if (alt >= wx.cloudline) assert.equal(at(x, y), 0, `cell ${x},${y} alt ${alt.toFixed(2)}`);
  }
  // low ground is mistier than high ground, in the same cover
  assert.ok(at(30, 20) > at(90, 20), 'low moor mistier than high moor');
  assert.ok(at(100, 20) < at(30, 20));
  // water and bog are mistier than moor at the same altitude (compare equal x, different y)
  assert.ok(at(16, 48) > at(16, 20) + 20, 'water');
  assert.ok(at(16, 78) > at(16, 20) + 10, 'bog');
  // woods among pines (affric) outrank bare moor
  const wood = synth(); for (let y = 100; y < 120; y++) for (let x = 5; x < 30; x++) wood.cover[y * S + x] = COVER.WOOD;
  const fa = buildMistField(wood, WEATHER.affric);
  assert.ok(fa[110 * S + 16] > fa[90 * S + 16]);
  // a lower cloudline removes more mist
  const lowCl = buildMistField(w, { ...wx, cloudline: 0.3 });
  let a = 0, b = 0; for (let i = 0; i < f.length; i++) { a += f[i]; b += lowCl[i]; }
  assert.ok(b < a);
  assert.ok(f instanceof Uint8Array && f.length === S * S);
});

test('mist hugs glens: a cell lower than its surroundings is mistier than a ridge cell at equal altitude band', () => {
  const size = 96, N = size * size;
  const height = new Float32Array(N), cover = new Uint8Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) height[y * size + x] = 300 + 40 * Math.cos((x / size) * 6 * Math.PI) * 4;   // ripples: glens and ridges
  const f = buildMistField({ size, height, cover, minH: 140, maxH: 460 }, { ...WEATHER_DEFAULT, cloudline: 1.2 });
  // x = 16 is a trough (cos(pi) = -1 -> low), x = 0 / 32 are crests
  assert.ok(f[48 * size + 16] > f[48 * size + 0] || f[48 * size + 16] > f[48 * size + 32]);
});

test('lightning schedule: seeded, increasing, intervals within the weather bounds, never uses Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random must not be used'); };
  try {
    const s1 = new LightningSchedule(4404, { min: 8, max: 25 }), s2 = new LightningSchedule(4404, { min: 8, max: 25 }), s3 = new LightningSchedule(5505, { min: 8, max: 25 });
    const t1 = [], t2 = [], t3 = [];
    for (let i = 0; i < 40; i++) { t1.push(s1.time(i)); t2.push(s2.time(i)); t3.push(s3.time(i)); }
    assert.deepEqual(t1, t2);
    assert.notDeepEqual(t1, t3);
    for (let i = 1; i < 40; i++) {
      const gap = t1[i] - t1[i - 1];
      assert.ok(gap >= 8 - 1e-9 && gap <= 25 + 1e-9, `gap ${gap}`);
    }
    assert.ok(t1[0] > 0 && t1[0] <= 25);
    // random access matches sequential generation
    const s4 = new LightningSchedule(4404, { min: 8, max: 25 });
    assert.equal(s4.time(25), t1[25]);
    // latest()
    assert.equal(s1.latest(t1[0] - 0.001), null);
    const l = s1.latest(t1[5] + 0.5);
    assert.equal(l.index, 5); assert.ok(Math.abs(l.age - 0.5) < 1e-9);
    assert.equal(s1.indexAt(t1[5]), 5);
  } finally { Math.random = real; }
});

test('flash, bolt blink and camera shake timings: 2 flash frames, a short stuttering bolt, +-2 px shake for ~0.25 s', () => {
  assert.equal(flashDensity(-0.01), 0);
  assert.ok(flashDensity(0.01) > flashDensity(0.08) && flashDensity(0.08) > 0);
  assert.equal(flashDensity(0.2), 0);
  const seen = new Set(); for (let a = 0; a < 0.12; a += 0.001) seen.add(flashDensity(a));
  assert.equal(seen.size, 2, 'exactly two flash frames');
  assert.equal(boltVisibility(0.02), 1); assert.equal(boltVisibility(0.12), 0); assert.equal(boltVisibility(0.2), 1); assert.equal(boltVisibility(BOLT_LIFE + 0.01), 0);
  let maxAmp = 0, nz = 0;
  for (let i = 0; i < 20; i++) for (let a = 0; a < SHAKE_LIFE; a += 0.01) {
    const s = shakeAt(4404, i, a);
    assert.ok(Number.isInteger(s.x) && Number.isInteger(s.y));
    maxAmp = Math.max(maxAmp, Math.abs(s.x), Math.abs(s.y));
    if (s.x || s.y) nz++;
  }
  assert.equal(maxAmp, 2);
  assert.ok(nz > 100);
  for (const a of [-0.1, SHAKE_LIFE, 1, 10]) assert.deepEqual(shakeAt(1, 3, a), { x: 0, y: 0 });
  assert.deepEqual(shakeAt(9, 3, 0.1), shakeAt(9, 3, 0.1));
});

test('bolt polyline: seeded, starts at the top edge, runs downward, stays on screen, has a fork sometimes', () => {
  const buf1 = new Int16Array(96), buf2 = new Int16Array(96);
  let forks = 0;
  for (let i = 0; i < 60; i++) {
    const a = boltPoints(4404, i, buf1), b = boltPoints(4404, i, buf2);
    assert.deepEqual(a, b); assert.deepEqual(buf1, buf2);
    assert.ok(a.trunk >= 6 && a.points >= a.trunk);
    assert.equal(buf1[1], 0, 'starts at y = 0');
    let lastY = -1, jag = 0;
    for (let k = 0; k < a.trunk; k++) {
      const x = buf1[k * 2], y = buf1[k * 2 + 1];
      assert.ok(x >= 0 && x < SW && y >= 0 && y < SH, 'trunk on screen');
      assert.ok(y >= lastY, 'trunk does not climb'); lastY = y;
      if (k > 0 && buf1[k * 2] !== buf1[(k - 1) * 2]) jag++;
    }
    assert.ok(jag >= 3, 'jagged');
    if (a.forkPts > 0) {
      forks++;
      assert.equal(buf1[a.trunk * 2], -1);
      for (let k = a.trunk + 1; k < a.points; k++) assert.ok(buf1[k * 2] >= 0 && buf1[k * 2] < SW && buf1[k * 2 + 1] >= 0 && buf1[k * 2 + 1] < SH);
    }
  }
  assert.ok(forks > 5);
  assert.notDeepEqual(boltPoints(1, 1, buf1), boltPoints(2, 1, buf2));
});

test('light pools: lit inside r0, dark beyond r1, monotone in between, combining by min/max', () => {
  const w = 200, h = 200;
  const night = new Uint8Array(w * h).fill(255), tone = new Uint8Array(w * h);
  stampLight(night, tone, w, h, 100, 100, 40, 90, 0.9, 0.5);
  assert.ok(night[100 * w + 100] < 40, 'centre is bright');
  assert.equal(night[100 * w + 100 + 39], night[100 * w + 100]);
  assert.equal(night[100 * w + 100 + 90], 255, 'full dark at r1');
  assert.equal(night[100 * w + 199], 255);
  let last = 0;
  for (let d = 40; d <= 90; d++) { const v = night[100 * w + 100 + d]; assert.ok(v >= last, 'darkness rises with distance'); last = v; }
  assert.ok(tone[100 * w + 100] > 100 && tone[100 * w + 190] === 0);
  const before = night[100 * w + 150];
  stampLight(night, tone, w, h, 150, 100, 11, 30, 0.92, 1);          // a bothy pool nearby only ever lightens
  assert.ok(night[100 * w + 150] <= before);
  assert.ok(tone[100 * w + 150] >= 200);
  assert.ok(stampLight(night, null, w, h, 10, 10, 5, 20) === undefined);
  // flicker is small and a function of the clock only
  for (let t = 0; t < 60; t += 0.37) { const f = flicker(t, 1.2); assert.ok(f > 0.9 && f < 1.1); assert.equal(f, flicker(t, 1.2)); }
});

test('precipitation: drizzle, heavy rain, blowing snow with diagonal streaks, high-only snow on nevis, nothing for assynt', () => {
  const o = {};
  const riz = { ...precipitationFor(WEATHER.torridon, 0, o) };
  assert.ok(riz.kind === 'rain' && riz.streaks > 40 && riz.flakes === 0 && riz.dy > 0.9);
  const heavy = { ...precipitationFor(WEATHER.coe, 0, o) };
  assert.ok(heavy.streaks > riz.streaks && heavy.speed > riz.speed && heavy.len >= riz.len);
  const snow = { ...precipitationFor(WEATHER.cairngorm, 0, o) };
  assert.ok(snow.kind === 'snow' && snow.flakes > 50 && snow.streaks > 50);
  assert.ok(Math.abs(snow.dx) > 0.85 && snow.dy > 0 && snow.dy < 0.5, 'shallow diagonal like the Amiga clouds');
  const highSnow = { ...WEATHER_DEFAULT, snow: 0.34, snowAbove: 0.5 };
  const low = precipitationFor(highSnow, 0.1, {}), high = precipitationFor(highSnow, 0.95, {});
  const sleet = precipitationFor(WEATHER.cruachan, 0, {});
  assert.ok(sleet.kind === 'sleet' && sleet.streaks > 40 && sleet.flakes > 20, 'sleet: rain with wet flakes');
  assert.equal(low.streaks + low.flakes, 0);
  assert.ok(high.streaks + high.flakes > 20, 'thin snow only high up');
  const none = precipitationFor(WEATHER.assynt, 1, {});
  assert.equal(none.streaks + none.flakes, 0);
  for (const id of IDS) { const p = precipitationFor(WEATHER[id], 0.7, {}); assert.ok(p.streaks <= 420 && p.flakes <= 420); assert.ok(Math.abs(Math.hypot(p.dx, p.dy) - 1) < 1e-9); }
  const P = makeParticles(1101), Q = makeParticles(1101);
  assert.deepEqual(P.x0, Q.x0);
  for (let i = 0; i < P.n; i++) assert.ok(P.x0[i] >= 0 && P.x0[i] < SW && P.y0[i] >= 0 && P.y0[i] < SH);
});

test('smoke rises and drifts with the clock; bothies far away are not smoked', () => {
  const p = {}, q = {};
  smokePuff(10, 0, 10, 0.3, 1, p);
  smokePuff(10.01, 0, 10, 0.3, 1, q);
  assert.ok(q.y < p.y || q.age < p.age, 'older puffs are higher');
  let maxR = 0;
  for (let t = 0; t < 12; t += 0.05) for (let i = 0; i < 9; i++) {
    smokePuff(t, i, 9, 0.7, 1, p);
    assert.ok(p.y <= 0 && p.y > -60 && p.r > 0 && p.d >= 0 && p.d <= 1);
    maxR = Math.max(maxR, p.r);
  }
  assert.ok(maxR > 4);
  smokePuff(3, 2, 9, 0.2, 1, p); const xr = p.x, yr = p.y;
  smokePuff(3, 2, 9, 0.2, -1, q);
  assert.equal(q.y, yr);                                   // the wind only bends the drift sideways
  assert.ok(Math.abs(q.x - xr) > 0 || p.age < 0.05, 'drift follows the wind');
  const bs = [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 14, y: 40 }];
  const out = new Int32Array(8);
  assert.equal(visibleBothies(bs, 12, 12, 40, out), 2);
  assert.deepEqual([...out.slice(0, 2)], [0, 2]);
  assert.equal(visibleBothies(bs, 300, 300, 40, out), 0);
});

test('createFx: onLightning fires once per strike as the clock passes it, can be unsubscribed, ignores rewinds', () => {
  const w = synth({ id: 'coe', seed: 3303 });
  const fx = createFx(); fx.setWorld(w);
  const times = [0, 1, 2, 3].map((i) => fx.strikeTime(i));
  assert.ok(times.every((t) => t > 0));
  const got = [];
  const off = fx.onLightning((e) => got.push(e));
  const state = { player: { x: 50, y: 50, elevation: 300 } };
  for (let t = 0; t < times[2] + 1; t += 1 / 30) fx.update(state, t, 1 / 30);
  assert.equal(got.length, 3);
  got.forEach((e, i) => { assert.equal(e.index, i); assert.equal(e.time, times[i]); assert.ok(e.x >= 0 && e.x < SW); });
  // rewind (new session / seek): no callbacks, then continues
  fx.update(state, 0.5, 0);
  assert.equal(got.length, 3);
  off();
  for (let t = 0; t < times[3] + 1; t += 1 / 30) fx.update(state, t, 1 / 30);
  assert.equal(got.length, 3, 'unsubscribed');
  // levels without storms never strike
  const calm = createFx(); calm.setWorld(synth({ id: 'assynt' }));
  assert.equal(calm.strikeTime(0), null);
  let n = 0; calm.onLightning(() => n++);
  for (let t = 0; t < 200; t += 0.5) calm.update(state, t, 0.5);
  assert.equal(n, 0);
});

test('createFx: shake is non-zero only in the 0.25 s after a strike, never beyond +-2', () => {
  const fx = createFx(); fx.setWorld(synth({ id: 'coe', seed: 6606 }));
  const t0 = fx.strikeTime(1);
  const state = { player: { x: 50, y: 50, elevation: 300 } };
  let during = 0, after = 0;
  for (let t = t0 - 1; t < t0 + 1; t += 1 / 120) {
    fx.update(state, t, 1 / 120);
    const m = Math.max(Math.abs(fx.shake.x), Math.abs(fx.shake.y));
    assert.ok(m <= 2);
    if (t < t0) assert.equal(m, 0);
    else if (t < t0 + SHAKE_LIFE) during += m;
    else if (t > t0 + SHAKE_LIFE + 0.02) after += m;
  }
  assert.ok(during > 0); assert.equal(after, 0);
  assert.equal(fx.strike === null || fx.strike.index >= 1, true);
});

// ------------------------------------------------------------------ the drawing, in Node
const MW = 128 * CELL_PX;
function paintFrame(world, { tod, clock, cam = [60, 40], lvlFill = 0, fill = null }) {
  const fx = createFx(); fx.setWorld(world);
  const fb = new Uint32Array(SW * SH);
  const keys = fill || [U.paper, U.paper2, U.water, U.wood, U.snow, U.bog, U.waterDeep, U.contour, U.ink, U.rock, U.grid, U.magenta, U.night, U.waterInk];
  let s = 31;
  for (let i = 0; i < fb.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; fb[i] = keys[(s >>> 9) % keys.length]; }
  const lvl = new Int16Array(MW * MW).fill(lvlFill);
  const [camX, camY] = cam;
  const t0 = fx.strikeTime(0);
  const clk = clock != null ? clock : (t0 != null ? t0 + 0.03 : 40);
  fx.update({ player: { x: 70, y: 52, elevation: 900 } }, clk, 1 / 60);
  const tint = tintAt(tod);
  const pre = fx.prepare(fb, camX, camY, tint, tod, clk, 192, 100, lvl, MW);
  applyTint(fb, SW, SH, pre.tint, camX, camY, 0, SH, pre.lightMap);
  fx.paintGround(fb, camX, camY, clk);
  fx.paintAir(fb, camX, camY, clk, lvl, MW);
  return { fb, fx };
}

test('every frame stays strictly on the 35-colour palette: all weathers, all times of day, flash frames included', () => {
  for (const id of [...IDS, 'mock']) {
    for (const tod of [0.05, 0.375, 0.5, 0.625, 0.875]) {
      const { fb } = paintFrame(synth({ id, seed: 1000 + IDS.indexOf(id) }), { tod });
      for (let i = 0; i < fb.length; i++) if (paletteIndexOf(fb[i]) === 255) assert.fail(`off-palette pixel ${fb[i].toString(16)} at ${i} (${id}, tod ${tod})`);
    }
  }
});

test('mist never touches contour pixels, ink, labels or symbols: only light ground, water, wood and bog take it', () => {
  const world = synth({ id: 'rannoch' });
  // a map of only ink and paper pixels; every ink pixel and every contour-flagged pixel must survive mist + shadow
  const { fb, fx } = (() => {
    const fx = createFx(); fx.setWorld(world);
    const fb = new Uint32Array(SW * SH);
    for (let i = 0; i < fb.length; i++) fb[i] = (i % 3 === 0) ? U.ink : (i % 7 === 0 ? U.contourIdx : U.paper);
    const lvl = new Int16Array(MW * MW);
    for (let y = 0; y < MW; y++) for (let x = 0; x < MW; x += 5) lvl[y * MW + x] = 3;      // vertical "contours"
    const camX = 50, camY = 30, clock = 30.3;
    const src = fb.slice();
    fx.update({ player: { x: 40, y: 40, elevation: 200 } }, clock, 0);
    fx.prepare(fb, camX, camY, tintAt(0.375), 0.375, clock, 192, 100, lvl, MW);   // (no tint pass: only the mist is under test)
    fx.paintGround(fb, camX, camY, clock);
    // contour pixels: the lvl map says so, regardless of the colour under them
    let touched = 0, moved = 0;
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      if (src[i] === U.ink || src[i] === U.contourIdx) { assert.equal(fb[i], src[i], 'ink / contour colour changed'); touched++; }
      else if (lvl[(y + camY) * MW + x + camX] !== 0) { assert.equal(fb[i], src[i], 'pixel on a contour line changed'); touched++; }
      else if (fb[i] !== src[i]) moved++;
    }
    assert.ok(touched > 10000);
    assert.ok(moved > 200, 'but plain paper does get misted (' + moved + ')');
    return { fb, fx };
  })();
  assert.ok(fb && fx);
});

test('no darkness by day and light pools only when it is dark; the lantern pool is lit, the far field dark', () => {
  const world = synth({ id: 'assynt' });
  const day = paintFrame(world, { tod: 0.375, clock: 41 });
  assert.equal(day.fx.lit, false);
  assert.ok(day.fx.night < 0.01);
  const night = paintFrame(world, { tod: 0.875, clock: 41, fill: [U.paper] });
  assert.equal(night.fx.lit, true);
  assert.ok(night.fx.night > 0.9);
  const dark = (x0, y0, x1, y1) => { let n = 0, t = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (night.fb[y * SW + x] !== U.paper && night.fb[y * SW + x] !== U.paper2 && night.fb[y * SW + x] !== U.lamp) n++; } return n / t; };
  const near = dark(184, 92, 200, 108), far = dark(2, 2, 40, 40);
  assert.ok(far > 0.8, 'far corner dark ' + far);
  assert.ok(near < 0.2, 'beside the lantern light ' + near);
  // dusk is darker than day, lighter than night
  const dusk = paintFrame(world, { tod: 0.625, clock: 41, fill: [U.paper] });
  assert.ok(dusk.fx.night > 0.3 && dusk.fx.night < night.fx.night);
});

test('bothies glow orange at night and breathe smoke from a distance; day smoke is thin', () => {
  const world = synth({ id: 'affric', bothies: [{ x: 70, y: 40 }] });           // bothy a few cells from the view centre (a dry level)
  const fill = [U.paper];
  const nightF = paintFrame(world, { tod: 0.875, clock: 41, fill, cam: [200, 100] });
  let lamp = 0; for (const v of nightF.fb) if (v === U.lamp) lamp++;
  assert.ok(lamp > 150, 'lamp-coloured glow pixels ' + lamp);
  assert.equal(nightF.fx.bothies().length, 1);
  // smoke pixels above the chimney (paintAir alone, so no mist is counted): thin by day, plain at night
  const plume = (tod, base) => {
    const r = paintFrame(world, { tod, clock: 41, fill: [base], cam: [200, 100] });
    r.fx.update({ player: { x: 60, y: 42, elevation: 100 } }, 41, 0);
    const b = r.fx.bothies()[0];
    const fb = new Uint32Array(SW * SH).fill(base);
    r.fx.night = tod > 0.7 ? 0.97 : 0;
    r.fx.paintAir(fb, 200, 100, 41, null, MW);
    const sx = Math.round(b.px - 200), sy = Math.round(b.py - 100);
    let n = 0;
    for (let y = sy - 56; y < sy - 3; y++) for (let x = sx - 14; x < sx + 36; x++) { if (x < 0 || y < 0 || x >= SW || y >= SH) continue; const v = fb[y * SW + x]; if (v === U.rock || v === U.dusk || v === U.paper2) n++; }
    return n;
  };
  const n = plume(0.875, U.night), d = plume(0.375, U.paper);
  assert.ok(n > 60, 'night plume ' + n);
  assert.ok(d > 5 && d < n, 'day plume is thinner: ' + d + ' vs ' + n);
  // far away (> 40 cells): no smoke
  const far = paintFrame(world, { tod: 0.875, clock: 41, fill: [U.night], cam: [200, 100] });
  far.fx.update({ player: { x: 5, y: 120, elevation: 100 } }, 41, 0);
  const fb2 = new Uint32Array(SW * SH).fill(U.night);
  far.fx.paintAir(fb2, 200, 100, 41, null, MW);
  let changed = 0; for (const v of fb2) if (v !== U.night) changed++;
  assert.ok(changed < 800, 'only rain-free sky left: ' + changed);
});

test('determinism: the same level and clock always draw the same frame', () => {
  for (const id of ['coe', 'cairngorm', 'assynt']) {
    const w = synth({ id, seed: 55 });
    const a = paintFrame(w, { tod: 0.8, clock: 52.25 }), b = paintFrame(w, { tod: 0.8, clock: 52.25 });
    assert.deepEqual(a.fb, b.fb);
    const c = paintFrame(w, { tod: 0.8, clock: 53.25 });
    assert.notDeepEqual(a.fb, c.fb);
  }
});

test('lightning frame: flash dither of bolt/snow appears at the strike, a bolt polyline in bolt colour with a snow core, gone later', () => {
  const w = synth({ id: 'coe', seed: 3303 });
  const fx0 = createFx(); fx0.setWorld(w);
  const t0 = fx0.strikeTime(0);
  const flash = paintFrame(w, { tod: 0.875, clock: t0 + 0.02, fill: [U.night] });
  let b = 0, sn = 0; for (const v of flash.fb) { if (v === U.bolt) b++; else if (v === U.heather) sn++; }
  assert.ok(b > 3000 && sn > 3000, 'flash dither ' + b + '/' + sn);
  assert.ok(b + sn > 0.3 * SW * SH && b + sn < 0.42 * SW * SH, 'frame A is a sparse ~35% wash, the map shows through: ' + (b + sn));
  const bolt = paintFrame(w, { tod: 0.875, clock: t0 + 0.2, fill: [U.night] });
  let bb = 0, ss = 0; for (const v of bolt.fb) { if (v === U.bolt) bb++; else if (v === U.snow) ss++; }
  assert.ok(bb > 40 && bb < 1500, 'bolt pixels ' + bb);
  assert.ok(ss > 20 && ss < bb, 'snow core ' + ss);
  const later = paintFrame(w, { tod: 0.875, clock: t0 + 1.0, fill: [U.night] });
  let lb = 0; for (const v of later.fb) if (v === U.bolt) lb++;
  assert.equal(lb, 0);
});
