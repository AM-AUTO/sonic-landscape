import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Raster, paintStandingStone, freshBase, paintBase, renderPanel, pixelHash, warmProfile, hasProfile, getPanel,
  TITLE_VARIANTS, TITLE_DEFAULT, TITLE_LAYOUT, TITLE_LEVELS, TITLE_SCENE,
} from '../src/render/panels.js';
import { STONE_SYMBOLS, SYMBOL_STROKES } from '../src/render/stone.js';
import { PAL, PAL_U32_LIST, PAL_U32 } from '../src/render/palette.js';
import { measureText } from '../src/render/font.js';
import { TITLE } from '../src/text.js';

const PAL_SET = new Set(PAL_U32_LIST);
const W = TITLE_SCENE.w, H = TITLE_SCENE.h;
const spec = (variant) => ({ kind: 'title', levelIndex: 3, variant });
// the covers as painted from stand-in fields, before any track's real field has been built in this process
const STAND_IN = Object.fromEntries(TITLE_VARIANTS.map((v) => [v, pixelHash(freshBase({ kind: 'title', levelIndex: 3, variant: v }, W, H))]));
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

// ------------------------------------------------------------------ the three covers
test('title covers: three variants A Survey / B Summit / C Close, each a full-bleed painting in strict palette colours', () => {
  assert.deepEqual([...TITLE_VARIANTS], ['A', 'B', 'C']);
  assert.ok(TITLE_VARIANTS.includes(TITLE_DEFAULT));
  const hashes = new Set();
  for (const v of TITLE_VARIANTS) {
    const d = freshBase(spec(v), W, H);
    assert.equal(d.length, W * H);
    assert.ok(d.every((c) => c !== 0), v + ': every pixel painted');
    assert.equal(offPalette(d), 0, v + ' palette');
    for (const n of ['blood', 'rust', 'ember', 'heather', 'flame', 'grid']) assert.ok(d.includes(PAL_U32[n]), `${v} uses ${n}`);
    hashes.add(pixelHash(d));
    // the logo: bright flame and bone pixels in the lettering band
    let bright = 0;
    for (let y = 14; y < 72; y++) for (let x = 20; x < 364; x++) if (d[y * W + x] === PAL_U32.flame || d[y * W + x] === PAL_U32.paper) bright++;
    assert.ok(bright > 500, `${v}: lettering present (${bright})`);
  }
  assert.equal(hashes.size, 3, 'three different paintings');
});

test('title covers: deterministic, animated, and the animation never touches the cached base', () => {
  for (const v of TITLE_VARIANTS) {
    const s = spec(v);
    assert.equal(pixelHash(freshBase(s, W, H)), pixelHash(freshBase(s, W, H)), v + ' base');
    const base = pixelHash(paintBase(s, W, H));
    const a = pixelHash(renderPanel(s, W, H, 1.0)), b = pixelHash(renderPanel(s, W, H, 4.7));
    assert.notEqual(a, b, v + ' moves');
    assert.equal(pixelHash(renderPanel(s, W, H, 1.0)), a, v + ' same time, same frame');
    assert.equal(pixelHash(paintBase(s, W, H)), base, v + ' base untouched');
    assert.equal(offPalette(renderPanel(s, W, H, 2.2)), 0, v + ' frame palette');
  }
});

test('title covers: a per-frame animation cost of a few milliseconds at most (the picture is a cached base)', () => {
  for (const v of TITLE_VARIANTS) {
    const s = spec(v);
    renderPanel(s, W, H, 0);
    const t0 = performance.now();
    for (let i = 1; i <= 30; i++) renderPanel(s, W, H, i * 0.1);
    const per = (performance.now() - t0) / 30;
    assert.ok(per < 8, `${v}: ${per.toFixed(2)} ms per frame`);
  }
});

test('title covers: a spec that asks for it ({ warm: true }) has the fields its cover draws on built before it paints, so no stand-in is ever shown', () => {
  assert.ok(!hasProfile(6), 'track VII is not warm yet in this process');
  const standIn = STAND_IN.B;
  const p = getPanel({ ...spec('B'), warm: true }, W, H);
  assert.ok(hasProfile(6), 'the field of the Summit cover was built on demand');
  assert.notEqual(pixelHash(p.base.d), standIn, 'and the cover is the real one');
  assert.equal(pixelHash(paintBase({ ...spec('B'), warm: true }, W, H)), pixelHash(p.base.d), 'cached once warm');
});

test('title covers: the real heightfields of the tracks are used once they are warm, and the picture changes with them', () => {
  const before = TITLE_VARIANTS.map((v) => STAND_IN[v]);
  for (const v of TITLE_VARIANTS) for (const i of TITLE_LEVELS[v]) warmProfile(i);
  const after = TITLE_VARIANTS.map((v) => pixelHash(freshBase(spec(v), W, H)));
  before.forEach((h, i) => assert.notEqual(h, after[i], `${TITLE_VARIANTS[i]} is drawn from the track's field`));
  // and warm covers are still deterministic
  assert.deepEqual(after, TITLE_VARIANTS.map((v) => pixelHash(freshBase(spec(v), W, H))));
});

test('title covers: no stag, no wanderer, no birds, no cross: the old small silhouettes are gone from the cover', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/render/titleart.js', import.meta.url), 'utf8'));
  assert.ok(!/drawStag|drawWanderer|drawBird/.test(src));
  for (const v of TITLE_VARIANTS) {
    const l = TITLE_LAYOUT[v];
    assert.ok(l && l.subtitle && l.prompt && l.controls > 0 && l.strapline > 0);
  }
});

test('title covers: the lines of text sit inside the screen and clear of each other for every variant', () => {
  const small = { font: 'small' };
  for (const v of TITLE_VARIANTS) {
    const L = TITLE_LAYOUT[v];
    const subW = L.subtitle.maxW ? L.subtitle.maxW : measureText(TITLE.subtitle, { italic: true, spacing: 1 });
    assert.ok(L.subtitle.x - subW / 2 >= 4 && L.subtitle.x + subW / 2 <= 380, `${v}: subtitle inside the screen`);
    const pw = measureText(TITLE.prompt, { spacing: 1 }) + 40;
    assert.ok(L.prompt.x - pw / 2 >= 2 && L.prompt.x + pw / 2 <= 382, `${v}: prompt inside the screen`);
    assert.ok(L.prompt.y + 9 < L.controls, `${v}: prompt above the controls line`);
    assert.ok(L.controls + 7 < L.strapline && L.strapline + 6 <= H, `${v}: controls above the strapline`);
    assert.ok(measureText(TITLE.controlsKeys, small) <= 380 && measureText(TITLE.strapline, { ...small, spacing: 1 }) <= 380);
  }
});
