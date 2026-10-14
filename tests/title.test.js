import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Raster, paintStandingStone, freshBase, paintBase, renderPanel, pixelHash, hasProfile, getPanel,
  TITLE_VARIANTS, TITLE_DEFAULT, TITLE_LAYOUT, TITLE_LEVELS, TITLE_SCENE,
} from '../src/render/panels.js';
import { DEFAULT_LAYOUT } from '../src/render/title/index.js';
import * as K from '../src/render/title/kit.js';
import { STONE_SYMBOLS, SYMBOL_STROKES } from '../src/render/stone.js';
import { PAL, PAL_U32_LIST, PAL_U32 } from '../src/render/palette.js';
import { measureText } from '../src/render/font.js';
import { TITLE } from '../src/text.js';

const PAL_SET = new Set(PAL_U32_LIST);
const W = TITLE_SCENE.w, H = TITLE_SCENE.h;
const spec = (variant) => ({ kind: 'title', levelIndex: 3, variant });
const offPalette = (d) => { let n = 0; for (let i = 0; i < d.length; i++) if (!PAL_SET.has(d[i])) n++; return n; };

// ------------------------------------------------------------------ the standing stone
function stoneOn(opts = {}, h = 120) {
  const r = new Raster(240, 180);
  r.d.fill(PAL_U32.flame); r.lay.fill(0);
  const info = paintStandingStone(r, 70, 170, h, opts);
  return { r, info };
}

test('paintStandingStone: deterministic for a seed, different for another, strict palette, stays inside its box', () => {
  const a = stoneOn({ seed: 5 }), b = stoneOn({ seed: 5 }), c = stoneOn({ seed: 6 });
  assert.equal(pixelHash(a.r.d), pixelHash(b.r.d), 'same seed, same stone');
  assert.notEqual(pixelHash(a.r.d), pixelHash(c.r.d), 'another seed, another stone');
  assert.equal(offPalette(a.r.d), 0);
  // the options that matter change the picture; the same options do not
  const lit = stoneOn({ seed: 5, glow: 1 }), dim = stoneOn({ seed: 5, glow: 0 }), flip = stoneOn({ seed: 5, light: [0.8, -0.5] });
  assert.notEqual(pixelHash(lit.r.d), pixelHash(dim.r.d));
  assert.notEqual(pixelHash(a.r.d), pixelHash(flip.r.d));
  assert.equal(pixelHash(stoneOn({ seed: 5, glow: 1 }).r.d), pixelHash(lit.r.d));
});

test('paintStandingStone: a tall tapering slab with real detail, not a silhouette', () => {
  const { r, info } = stoneOn({ seed: 3 }, 160);
  assert.equal(info.h, 160);
  assert.ok(info.maskH >= 155 && info.maskH <= 170, 'about as tall as asked: ' + info.maskH);
  assert.ok(info.w > 40 && info.w < 110, 'a slab, not a needle or a boulder: ' + info.w);
  // many different palette colours on the face, shade steps from ink to bone
  const colours = new Set();
  for (let y = 20; y < 170; y++) for (let x = info.x0; x < info.x0 + info.w; x++) colours.add(r.d[y * r.w + x]);
  colours.delete(PAL_U32.flame);
  assert.ok(colours.size >= 14, 'colours on the stone: ' + colours.size);
  for (const n of ['ink', 'rock', 'paper2', 'ember']) assert.ok(colours.has(PAL_U32[n]), n + ' on the stone');
  // lit on the sunward (left) half, in shade on the other: mean brightness falls across the face
  const lum = (u) => { const R = u & 255, G = (u >> 8) & 255, B = (u >> 16) & 255; return 0.3 * R + 0.59 * G + 0.11 * B; };
  const half = (x0, x1) => { let s = 0, n = 0; for (let y = 40; y < 150; y++) for (let x = x0; x < x1; x++) if (info.mask[(170 - y) * info.w + (x - info.x0)]) { s += lum(r.d[y * r.w + x]); n++; } return s / n; };
  const mid = info.x0 + info.w / 2;
  assert.ok(half(info.x0, Math.round(mid)) > half(Math.round(mid), info.x0 + info.w) + 12, 'left (sunward) side is lit, the other is in shade');
  // a groove carrying a lit lip and an ember bed: the symbol is on the face
  assert.ok(info.symbol && info.embers.length > 20, 'incised symbol with glowing bed: ' + (info.embers && info.embers.length));
});

test('paintStandingStone: symbols are the crescent with V-rod and the double disc with Z-rod, or none; no crosses', () => {
  assert.deepEqual([...STONE_SYMBOLS].sort(), ['crescent', 'discs', 'none']);
  const none = stoneOn({ seed: 2, symbol: 'none' }), cres = stoneOn({ seed: 2, symbol: 'crescent' }), disc = stoneOn({ seed: 2, symbol: 'discs' });
  assert.equal(none.info.symbol, null);
  assert.equal(none.info.embers.length, 0);
  assert.notEqual(pixelHash(none.r.d), pixelHash(cres.r.d));
  assert.notEqual(pixelHash(cres.r.d), pixelHash(disc.r.d));
  // the strokes as data: nothing crosses (no plus, no saltire), nothing is a T or an L at a right angle, so no cross can be read in them
  for (const [name, g] of Object.entries(SYMBOL_STROKES)) {
    const segs = g.segs;
    const cross = (a, b) => {
      const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
      if (Math.abs(d) < 1e-9) return null;
      const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
      const u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
      return { t, u };
    };
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j], x = cross(a, b);
      if (!x) continue;
      const e = 0.03;
      const interiorA = x.t > e && x.t < 1 - e, interiorB = x.u > e && x.u < 1 - e;
      assert.ok(!(interiorA && interiorB), `${name}: strokes ${i} and ${j} cross each other`);
      if (x.t >= -e && x.t <= 1 + e && x.u >= -e && x.u <= 1 + e) {                         // they meet: at what angle?
        const ang = Math.abs(Math.atan2(a[3] - a[1], a[2] - a[0]) - Math.atan2(b[3] - b[1], b[2] - b[0])) * 180 / Math.PI % 180;
        const off = Math.min(ang, 180 - ang);
        assert.ok(!(off > 70 && off < 110), `${name}: strokes ${i} and ${j} meet at ${off.toFixed(0)} degrees`);
      }
    }
    // a stroke never runs through a circle either
    for (const [i, s] of segs.entries()) for (const [cx, cy, R] of g.circles) for (let k = 6; k < 35; k++) {
      const x = s[0] + (s[2] - s[0]) * k / 40, y = s[1] + (s[3] - s[1]) * k / 40;
      assert.ok(Math.abs(Math.hypot(x - cx, y - cy) - R) > 0.04, `${name}: stroke ${i} runs through a circle`);
    }
  }
});

test('paintStandingStone: casts a soft dithered shadow along the ground and writes only palette colours and its layer', () => {
  const plain = stoneOn({ seed: 4, layer: 3 });
  const shaded = stoneOn({ seed: 4, layer: 3, shadow: { sx: 1.4, sy: 0.3, dens: 0.9 } });
  let changed = 0;
  for (let i = 0; i < plain.r.d.length; i++) if (plain.r.d[i] !== shaded.r.d[i]) changed++;
  assert.ok(changed > 250, 'shadow pixels: ' + changed);
  assert.equal(offPalette(shaded.r.d), 0);
  const info = shaded.info;
  assert.ok(shaded.r.lay[(170 - 60) * shaded.r.w + info.x0 + (info.w >> 1)] === 3, 'stone pixels carry the layer id');
  // the shadow is dithered, not a flat fill: both the ground colour and its darker steps are present in the shadow band
  const ground = PAL_U32.flame;
  let lit = 0, dark = 0;
  for (let x = info.x0 + info.w; x < info.x0 + info.w + 60; x++) { const c = shaded.r.d[175 * shaded.r.w + x]; if (c === ground) lit++; else dark++; }
  assert.ok(dark > 6 && lit > 3, `shadow lies to the right of the stone, dithered (${dark} dark, ${lit} ground)`);
});

test('paintStandingStone: tilt shows the flat top of the slab, moss and lichen can be turned off', () => {
  const flat = stoneOn({ seed: 8, tilt: 0 }), top = stoneOn({ seed: 8, tilt: 0.8 });
  assert.ok(top.info.maskH > flat.info.maskH, 'the cap adds rows');
  const bare = stoneOn({ seed: 8, moss: 0, lichen: 0 });
  assert.notEqual(pixelHash(bare.r.d), pixelHash(flat.r.d));
  const greens = (r) => { let n = 0; for (let i = 0; i < r.d.length; i++) if (r.d[i] === PAL_U32.woodDark || r.d[i] === PAL_U32.bog || r.d[i] === PAL_U32.wood) n++; return n; };
  assert.ok(greens(flat.r) > greens(bare.r), 'moss and lichen are green');
});

// ------------------------------------------------------------------ greyscale + one accent
const GREYS = ['ink', 'char', 'slate', 'ash', 'rock', 'fog', 'snow'];
const BLUES = ['deepblue', 'steelD', 'steel', 'blue', 'paleblue', 'frost'];
const ALLOWED = new Set([...GREYS, ...BLUES, 'ember', 'paper', 'paper2'].map((n) => PAL_U32[n]));
const BLUE_U32 = new Set(BLUES.map((n) => PAL_U32[n]));
const foreign = (d) => { let n = 0; for (let i = 0; i < d.length; i++) if (!ALLOWED.has(d[i])) n++; return n; };

test('mono stone: greys + ember only, deterministic, the ember sits in the incisions and the rim, the colour stone is untouched', () => {
  const mono = (seed, glow = 0.7) => { const r = new Raster(240, 180); r.d.fill(PAL_U32.ash); r.lay.fill(0); const info = paintStandingStone(r, 90, 170, 130, { seed, mono: true, glow, shadow: { sx: 1.4, sy: 0.3, dens: 0.9, layerMax: 5 } }); return { r, info }; };
  const a = mono(4), b = mono(4), c = mono(5);
  assert.equal(pixelHash(a.r.d), pixelHash(b.r.d));
  assert.notEqual(pixelHash(a.r.d), pixelHash(c.r.d));
  assert.equal(foreign(a.r.d), 0, 'greys + ember only');
  assert.ok(a.r.d.includes(PAL_U32.ember), 'ember in the incisions');
  assert.ok(a.info.embers.length > 20 && a.info.embers.every((e) => e.length === 4));
  const cold = mono(4, 0);
  assert.ok(!cold.r.d.includes(PAL_U32.ember), 'no glow, no ember');
  const col = stoneOn({ seed: 4 });
  assert.ok(foreign(col.r.d) > 0, 'the colour stone is still coloured');
});

test('logo: carved stone in greys with a thin paleblue / frost line on the lit edge only', () => {
  const r = new Raster(384, 216); r.d.fill(PAL_U32.char); r.lay.fill(0);
  const L = K.paintTitleLogo(r, {});
  assert.equal(foreign(r.d), 0);
  assert.ok(L.face.length > 1500 && L.ember.length > 100, `face ${L.face.length}, ember ${L.ember.length}`);
  for (const i of L.ember) assert.ok(r.d[i] === PAL_U32.paleblue || r.d[i] === PAL_U32.frost, 'the cold accent line is painted');
  assert.ok(!r.d.includes(PAL_U32.ember), 'the logo has no ember any more');
  assert.ok(L.ember.filter((i) => r.d[i] === PAL_U32.paleblue).length > L.ember.length * 0.5, 'mostly paleblue');
  const before = pixelHash(r.d);
  K.animLogo(r, L, 1.0);
  assert.notEqual(pixelHash(r.d), before, 'the glint sweeps');
  assert.equal(foreign(r.d), 0);
});

// ------------------------------------------------------------------ the kit
test('kit: ramp / gradient / glow / mist / foot plate stay on the grey ramp (+ ember) and are deterministic', () => {
  const run = () => {
    const r = new Raster(120, 80); r.lay.fill(0);
    K.paintGreyGradient(r, { x: 0, y: 0, w: 120, h: 80 }, 0.1, 0.9, { streak: 0.8, seed: 3 });
    K.paintDitherGlow(r, 60, 40, 30, PAL_U32.ember, 255, { core: PAL_U32.snow });
    K.paintDitherGlow(r, 20, 20, 15, null);
    K.paintMistBands(r, [{ y: 30, rows: 12, dens: 0.8 }], 5);
    K.paintFootPlate(r, 50);
    return r;
  };
  const a = run(), b = run();
  assert.equal(pixelHash(a.d), pixelHash(b.d));
  assert.equal(foreign(a.d), 0);
  assert.ok(a.d.includes(PAL_U32.ember));
  for (let v = 0; v <= 1; v += 0.1) assert.ok(GREYS.map((n) => PAL_U32[n]).includes(K.ramp(v, 3, 5)));
  assert.equal(K.ramp(1, 0, 0, 1), PAL_U32.ember, 'accent 1 at a light tone is ember');
  assert.equal(K.ramp(0, 0, 0, 1), PAL_U32.ink, 'and never over the darkest tone');
});

test('kit: lichen, strata, contour field: deterministic, inside their region, greys + ember, and they change the picture', () => {
  const run = (seed) => {
    const r = new Raster(200, 140); r.d.fill(PAL_U32.ash); r.lay.fill(0);
    const reg = { x: 20, y: 20, w: 100, h: 90 };
    const n = K.paintLichen(r, reg, seed, { density: 1.5 });
    K.paintStrata(r, reg, seed, { cracks: 4, emberCrack: 1 });
    return { r, n };
  };
  const a = run(1), b = run(1), c = run(2);
  assert.equal(pixelHash(a.r.d), pixelHash(b.r.d));
  assert.notEqual(pixelHash(a.r.d), pixelHash(c.r.d));
  assert.ok(a.n > 300, 'lichen painted ' + a.n);
  assert.equal(foreign(a.r.d), 0);
  for (let y = 0; y < 140; y++) for (let x = 0; x < 200; x++) if (x < 20 || x >= 120 || y < 20 || y >= 110) assert.equal(a.r.d[y * 200 + x], PAL_U32.ash, 'nothing outside the region');
  // a masked region: only where the mask is on
  const r = new Raster(60, 60); r.d.fill(PAL_U32.ash);
  const data = new Uint8Array(30 * 60); for (let j = 0; j < 60; j++) for (let i = 0; i < 30; i++) data[j * 30 + i] = 1;
  K.paintLichen(r, { x: 0, y: 0, w: 30, h: 60, data }, 7, { density: 3 });
  for (let y = 0; y < 60; y++) for (let x = 30; x < 60; x++) assert.equal(r.d[y * 60 + x], PAL_U32.ash);
  // contour field
  const field = () => { const q = new Raster(384, 216); q.lay.fill(0); const res = K.paintContourField(q, (x, y) => K.clamp(K.fbm(x * 0.012, y * 0.014, 5, 4) * 1.5 - 0.3, 0, 1), { bands: 16, grid: 24, spots: 4, accent: 0.5, relief: 40 }); return { q, res }; };
  const f1 = field(), f2 = field();
  assert.equal(pixelHash(f1.q.d), pixelHash(f2.q.d));
  assert.ok(f1.q.d.every((v) => v !== 0), 'every pixel painted');
  assert.equal(foreign(f1.q.d), 0);
  assert.ok(f1.q.d.includes(PAL_U32.ember), 'the one ember contour');
  assert.ok(f1.res.spots.length >= 1, 'spot heights');
  // distinct greys used: it is a real hypsometric ramp
  assert.ok(new Set(f1.q.d).size >= 6);
});

test('kit: stoneMask orients the stone mask like the screen', () => {
  const r = new Raster(240, 180); r.d.fill(PAL_U32.magenta); r.lay.fill(0);        // a colour the mono stone never uses
  const st = K.monoStone(r, 100, 170, 120, { seed: 2 });
  const m = K.stoneMask(st);
  assert.equal(m.data.length, m.w * m.h);
  let on = 0, stone = 0;
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.data[j * m.w + i]) { on++; if (r.get(m.x + i, m.y + j) !== PAL_U32.magenta) stone++; }
  assert.ok(on > 1000 && stone / on > 0.99, `mask pixels are stone (${stone}/${on})`);
  assert.ok(m.data[(m.h - 1) * m.w + (m.w >> 1)] || m.data[(m.h - 2) * m.w + (m.w >> 1)], 'the foot is the bottom row');
});

// ------------------------------------------------------------------ the five start screens
test('title registry: five variants, castlerigg by default, a layout and a levels list for each', () => {
  assert.deepEqual([...TITLE_VARIANTS], ['castlerigg', 'shelter', 'mentol', 'dolmen', 'menhir']);
  assert.equal(TITLE_DEFAULT, 'castlerigg');
  for (const v of TITLE_VARIANTS) {
    const L = TITLE_LAYOUT[v];
    assert.ok(L && L.prompt && L.controls > 0 && L.colors && Array.isArray(L.hide), v);
    assert.ok(Array.isArray(TITLE_LEVELS[v]), v + ' levels');
  }
  assert.ok(DEFAULT_LAYOUT.colors.arrow === 'paleblue');
});

test('start screens: each variant is a full-bleed deterministic painting in the 35-colour palette, greys + blues + ember only, with the logo', () => {
  const hashes = new Set();
  for (const v of TITLE_VARIANTS) {
    const d = freshBase(spec(v), W, H);
    assert.equal(d.length, W * H);
    assert.ok(d.every((c) => c !== 0), v + ': every pixel painted');
    assert.equal(offPalette(d), 0, v + ' palette');
    assert.equal(foreign(d), 0, v + ': greys + blues + ember (+ paper endpoints) only');
    const blueOutside = (() => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (BLUE_U32.has(d[y * W + x]) && (v === 'mentol' || y > 90 || y < 8)) n++; return n; })();
    if (v === 'mentol') {
      // the Men-an-Tol cover is greys + blues ONLY (no ember), and the blue is a real second ramp across the picture, not just the logo's edge line
      assert.ok(!d.includes(PAL_U32.ember), 'mentol: no ember');
      assert.ok(blueOutside > 3000, 'mentol: blue ramp used across the picture: ' + blueOutside);
    } else assert.equal(blueOutside, 0, v + ': blue only on the logo\'s accent line');
    assert.equal(pixelHash(d), pixelHash(freshBase(spec(v), W, H)), v + ' deterministic');
    assert.ok(d.includes(PAL_U32.ink) && d.includes(PAL_U32.fog), v + ' spans the greys');
    hashes.add(pixelHash(d));
    // the logo: snow / fog carved pixels in the lettering band
    let bright = 0;
    for (let y = 14; y < 90; y++) for (let x = 10; x < 374; x++) if (d[y * W + x] === PAL_U32.snow || d[y * W + x] === PAL_U32.fog) bright++;
    assert.ok(bright > 300, `${v}: lettering present (${bright})`);
  }
  assert.equal(hashes.size, 5, 'five different paintings');
});

test('start screens: a seed changes the painting, an unknown variant (the old A / B / C) falls back to the default', () => {
  assert.notEqual(pixelHash(freshBase({ ...spec('castlerigg'), seed: 1 }, W, H)), pixelHash(freshBase(spec('castlerigg'), W, H)));
  for (const old of ['A', 'B', 'C', 'nope']) assert.equal(pixelHash(freshBase(spec(old), W, H)), pixelHash(freshBase(spec(TITLE_DEFAULT), W, H)), old);
});

test('start screens: animated, deterministic per time, and the animation never touches the cached base', () => {
  for (const v of TITLE_VARIANTS) {
    const s = spec(v);
    const base = pixelHash(paintBase(s, W, H));
    const a = pixelHash(renderPanel(s, W, H, 1.0)), b = pixelHash(renderPanel(s, W, H, 4.7));
    assert.notEqual(a, b, v + ' moves');
    assert.equal(pixelHash(renderPanel(s, W, H, 1.0)), a, v + ' same time, same frame');
    assert.equal(pixelHash(paintBase(s, W, H)), base, v + ' base untouched');
    assert.equal(offPalette(renderPanel(s, W, H, 2.2)), 0, v + ' frame palette');
    assert.equal(foreign(renderPanel(s, W, H, 2.2)), 0, v + ' frame greys + blues + ember');
    if (v === 'mentol') assert.ok(!renderPanel(s, W, H, 2.2).includes(PAL_U32.ember), 'mentol frame: no ember');
  }
});

test('start screens: a per-frame animation cost of a few milliseconds at most (the picture is a cached base)', () => {
  for (const v of TITLE_VARIANTS) {
    const s = spec(v);
    renderPanel(s, W, H, 0);
    const t0 = performance.now();
    for (let i = 1; i <= 30; i++) renderPanel(s, W, H, i * 0.1);
    const per = (performance.now() - t0) / 30;
    assert.ok(per < 8, `${v}: ${per.toFixed(2)} ms per frame`);
  }
});

test('start screens: a spec that asks for it ({ warm: true }) has the fields its variant lists in `levels` built before it paints', () => {
  for (const v of TITLE_VARIANTS) {
    const p = getPanel({ ...spec(v), warm: true }, W, H);
    for (const i of TITLE_LEVELS[v]) assert.ok(hasProfile(i), `${v}: field ${i} built on demand`);
    assert.equal(pixelHash(paintBase({ ...spec(v), warm: true }, W, H)), pixelHash(p.base.d), v + ' cached once warm');
  }
});

test('start screens: the old A / B / C covers are unreachable and no stag, wanderer, bird or cross is drawn', async () => {
  const fs = await import('node:fs');
  for (const f of ['../src/render/titleart.js', '../src/render/title/index.js', '../src/render/title/kit.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/drawStag|drawWanderer|drawBird/.test(src), f);
  }
  const panels = fs.readFileSync(new URL('../src/render/panels.js', import.meta.url), 'utf8');
  assert.ok(!/paintLegacyTitleArt|LEGACY_TITLE/.test(panels), 'panels.js does not reach the legacy covers');
});

test('start screens: the lines of text sit inside the screen, clear of each other, in greys + blues + ember', () => {
  const small = { font: 'small' };
  const okName = new Set([...GREYS, ...BLUES, 'ember', 'paper', 'paper2']);
  for (const v of TITLE_VARIANTS) {
    const L = TITLE_LAYOUT[v];
    const pw = Math.max(measureText(TITLE.prompt, { spacing: 1 }), measureText(TITLE.promptTouch, { spacing: 1 })) + 40;
    assert.ok(L.prompt.x - pw / 2 >= 2 && L.prompt.x + pw / 2 <= 382, `${v}: prompt inside the screen`);
    assert.ok(L.prompt.y + 9 < L.controls, `${v}: prompt above the controls line`);
    assert.ok(L.controls + 7 <= H, `${v}: controls line inside the screen`);
    assert.ok(measureText(TITLE.controlsKeys, small) <= 380 && measureText(TITLE.controlsTouch, small) <= 380);
    for (const [k, c] of Object.entries(L.colors)) for (const n of [].concat(c)) assert.ok(okName.has(n) && PAL[n], `${v}: colour ${k} = ${n}`);
    assert.ok(L.hide.every((n) => ['prompt', 'controls'].includes(n)), v + ' hide names');
  }
});
