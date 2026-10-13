/**
 * CONTOURS atmosphere: mist, weather, lightning, lantern light, chimney smoke, stars.
 *
 * Everything here writes whole palette colours into the 384x216 Uint32 framebuffer using the
 * 8x8 ordered dither (BAYER8): no blending, no anti-aliasing, the 21-colour palette stays strict.
 * Pure logic (weather table, mist density field, noise textures, lightning schedule and bolt
 * shape, light stamping, smoke/precipitation geometry) is exported separately from the drawing
 * so it can be unit-tested in Node with a seeded RNG (src/core/rng.js); nothing uses Math.random.
 *
 *   const fx = createFx();
 *   fx.setWorld(world)                 per level: seeds everything from world.level.seed / .id
 *   fx.onLightning(cb) -> unsubscribe  cb({ index, time, x }) at every strike (audio can hook here later)
 *   fx.update(state, clock, dt)        advance the schedule, fire callbacks, compute camera shake
 *   fx.shake                           {x, y} integer camera shake, pixels (+-2 for ~0.25 s)
 *   fx.prepare(...)                    before the tint pass: darkness + light pools + mist classification
 *   fx.paintGround(...)                after the tint pass: mist, cloud shadow, lamp dither, stars
 *   fx.paintAir(...)                   smoke, precipitation, lightning flash + bolt (over the map, under the HUD)
 *   fx.paintLantern(ctx, ...)          a couple of flickering sparks round the lantern (ctx draw, after the walker)
 *
 * Flicker and drift are driven only by the clock passed in (the renderer clock), so a given
 * (level, clock) always renders the same frame.
 */
import { PAL, PAL_U32 as U, PAL_INDEX as I, PAL_NAMES, PAL_COUNT, BAYER8, paletteIndexOf, phaseBlend, WARM_MAP, LIGHT_GROUND } from './palette.js';
import { mulberry32, hash2 } from '../core/rng.js';
import { COVER, CELL_PX, SCREEN_W, SCREEN_H } from '../world/codes.js';

const SW = SCREEN_W, SH = SCREEN_H;
const GW = SW >> 1, GH = SH >> 1;          // coarse (2x2 px) grid for the mist/shadow density

// ----------------------------------------------------------------------------------- maths
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function fract(x) { return x - Math.floor(x); }

// ------------------------------------------------------------------------------- weather
/**
 * Weather per level id. All numbers are 0..1 intensities unless noted.
 *   mist       overall mist amount (rises low, over water/bog/glens, absent above the cloudline)
 *   cloudline  altitude fraction (0 = lowest cell, 1 = highest) above which there is no mist
 *   woods      extra mist among pines
 *   shadow     drifting cloud shadow over the ground
 *   rain       rain intensity; rainStyle 'drizzle' (short, slow, slanted) or 'heavy'
 *   snow       blowing snow (diagonal streaks + fine flakes); snowAbove: only when the walker is above
 *              this altitude fraction (soft edge)
 *   wind       [x, y] drift direction of mist, shadow, precipitation
 *   lightning  null or { min, max } seconds between strikes
 *   dark       extra darkness (storm light) added to the time-of-day darkness
 *   stars      twinkling stars in the dark
 */
export const WEATHER = Object.freeze({
  rannoch: { mist: 0.55, cloudline: 0.82, woods: 0, shadow: 0.12, rain: 0.34, rainStyle: 'drizzle', snow: 0, wind: [0.8, 0.2], lightning: null, dark: 0.02, stars: false },
  affric: { mist: 0.62, cloudline: 0.72, woods: 0.35, shadow: 0.06, rain: 0, rainStyle: 'drizzle', snow: 0, wind: [0.5, 0.1], lightning: null, dark: 0, stars: false },
  coe: { mist: 0.38, cloudline: 0.78, woods: 0.1, shadow: 0.34, rain: 0.82, rainStyle: 'heavy', snow: 0, wind: [1, 0.15], lightning: { min: 8, max: 25 }, dark: 0.14, stars: false },
  cairngorm: { mist: 0.26, cloudline: 0.6, woods: 0, shadow: 0.1, rain: 0, rainStyle: 'drizzle', snow: 0.78, wind: [1, 0.25], lightning: null, dark: 0.04, stars: false },
  torridon: { mist: 0.3, cloudline: 0.78, woods: 0.1, shadow: 0.62, rain: 0.16, rainStyle: 'drizzle', snow: 0, wind: [0.9, 0.2], lightning: { min: 14, max: 40 }, dark: 0.16, stars: false },
  cuillin: { mist: 0.34, cloudline: 0.8, woods: 0, shadow: 0.3, rain: 0.62, rainStyle: 'heavy', snow: 0, wind: [1, 0.2], lightning: { min: 8, max: 25 }, dark: 0.12, stars: false },
  assynt: { mist: 0.1, cloudline: 0.7, woods: 0, shadow: 0, rain: 0, rainStyle: 'drizzle', snow: 0, wind: [0.4, 0.1], lightning: null, dark: 0, stars: true },
  nevis: { mist: 0.3, cloudline: 0.62, woods: 0, shadow: 0.5, rain: 0, rainStyle: 'drizzle', snow: 0.34, snowAbove: 0.5, wind: [1, 0.3], lightning: null, dark: 0.06, stars: false },
});
export const WEATHER_DEFAULT = Object.freeze({ mist: 0.2, cloudline: 0.75, woods: 0, shadow: 0.1, rain: 0, rainStyle: 'drizzle', snow: 0, wind: [0.6, 0.1], lightning: null, dark: 0, stars: false });

export function weatherFor(levelId) { return WEATHER[levelId] || WEATHER_DEFAULT; }

/** How dark each phase is (0 = daylight, 1 = full night); blended with the same easing as the tint. */
export const PHASE_DARK = Object.freeze({ dawn: 0.28, day: 0, dusk: 0.62, night: 1 });
/** 0..1 darkness for a timeOfDay in [0,1). */
export function darknessAt(timeOfDay) {
  const { a, b, f } = phaseBlend(timeOfDay);
  return PHASE_DARK[a] + (PHASE_DARK[b] - PHASE_DARK[a]) * f;
}
/** Night amount (0..0.97, what the tint pass dithers) from the clock-of-day darkness plus weather. */
export function effectiveNight(tintNight, timeOfDay, weather) {
  const d = clamp(darknessAt(timeOfDay) + (weather ? weather.dark : 0), 0, 1);
  return Math.max(tintNight, d * 0.97);
}

// ------------------------------------------------------------------------ noise textures
function latticeSample(lat, lw, lh, fx, fy) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  let tx = fx - x0, ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const xa = ((x0 % lw) + lw) % lw, xb = (xa + 1) % lw;
  const ya = ((y0 % lh) + lh) % lh, yb = (ya + 1) % lh;
  const a = lat[ya * lw + xa], b = lat[ya * lw + xb], c = lat[yb * lw + xa], d = lat[yb * lw + xb];
  return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
}

/**
 * Tileable value-noise texture, w x h bytes (both powers of two). Lattice cell size cx x cy
 * pixels (so cx >> cy gives streaky bands); two octaves, contrast-shaped so there are clear
 * gaps between the banks.
 */
export function makeNoiseTex(seed, w, h, cx, cy) {
  const rnd = mulberry32(seed >>> 0);
  const lw = Math.max(2, Math.round(w / cx)), lh = Math.max(2, Math.round(h / cy));
  const lw2 = lw * 2, lh2 = lh * 2;
  const lat = new Float32Array(lw * lh), lat2 = new Float32Array(lw2 * lh2);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  for (let i = 0; i < lat2.length; i++) lat2[i] = rnd();
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = latticeSample(lat, lw, lh, (x / w) * lw, (y / h) * lh);
      const b = latticeSample(lat2, lw2, lh2, (x / w) * lw2, (y / h) * lh2);
      let v = a * 0.68 + b * 0.32;
      v = clamp((v - 0.36) * 2.1, 0, 1);
      out[y * w + x] = Math.round(v * 255);
    }
  }
  return out;
}

// ------------------------------------------------------------------------ mist field
function boxBlur(src, size, r, tmp, out) {
  const n = size;
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {                     // horizontal
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * n + clamp(k, 0, n - 1)];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = acc / w;
      acc += src[y * n + clamp(x + r + 1, 0, n - 1)] - src[y * n + clamp(x - r, 0, n - 1)];
    }
  }
  for (let x = 0; x < n; x++) {                     // vertical
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, n - 1) * n + x];
    for (let y = 0; y < n; y++) {
      out[y * n + x] = acc / w;
      acc += tmp[clamp(y + r + 1, 0, n - 1) * n + x] - tmp[clamp(y - r, 0, n - 1) * n + x];
    }
  }
}

/**
 * Static mist density per world cell (Uint8Array size*size, 0..255).
 * Mist hugs low ground, glens (a cell lower than its surroundings), water, bog and (optionally)
 * woods, and is exactly zero above the cloudline (an altitude fraction of the level's own range).
 * world: { size, height: Float32Array|number[], cover: Uint8Array, minH, maxH }
 */
export function buildMistField(world, weather = WEATHER_DEFAULT) {
  const n = world.size, N = n * n;
  const h = world.height, cover = world.cover;
  const range = Math.max(1e-6, world.maxH - world.minH);
  const alt = new Float32Array(N);
  for (let i = 0; i < N; i++) alt[i] = (h[i] - world.minH) / range;
  const tmp = new Float32Array(N), blur = new Float32Array(N);
  boxBlur(alt, n, 7, tmp, blur);                    // regional mean altitude: below it = in a glen
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = cover[i];
    const valley = clamp((blur[i] - alt[i]) / 0.10, 0, 1);
    let v = 0.3 + valley * 0.95;
    if (c === COVER.SHALLOW || c === COVER.DEEP) v += 0.75;
    else if (c === COVER.BOG) v += 0.5;
    else if (c === COVER.WOOD) v += 0.2 + (weather.woods || 0) * 1.6;
    else if (c === COVER.CRAG || c === COVER.ROCK || c === COVER.SCREE) v *= 0.55;
    raw[i] = v;
  }
  boxBlur(raw, n, 3, tmp, blur);
  const out = new Uint8Array(N);
  const cl = weather.cloudline;
  for (let i = 0; i < N; i++) {
    const low = 1 - smooth(cl * 0.55, cl, alt[i]);   // exactly 0 at and above the cloudline
    out[i] = Math.round(clamp(blur[i] * low, 0, 1) * 255);
  }
  return out;
}

// --------------------------------------------------------------------------- lightning
/**
 * Seeded strike schedule: strike i happens at times[i] seconds of the renderer clock.
 * Intervals are uniform in [min, max]; no Math.random, so a (seed, clock) pair is repeatable.
 */
export class LightningSchedule {
  constructor(seed, { min = 8, max = 25 } = {}) {
    this.min = min; this.max = max;
    this.rnd = mulberry32((seed ^ 0x1f3d5b79) >>> 0);
    this.times = [min * 0.5 + this.rnd() * (max - min) * 0.5];
  }
  time(i) {
    while (this.times.length <= i) {
      const last = this.times[this.times.length - 1];
      this.times.push(last + this.min + this.rnd() * (this.max - this.min));
    }
    return this.times[i];
  }
  /** index of the latest strike with time <= t, or -1 */
  indexAt(t) {
    let i = -1;
    while (this.time(i + 1) <= t) i++;
    return i;
  }
  /** { index, time, age } of the latest strike at or before t, or null */
  latest(t) {
    const i = this.indexAt(t);
    return i < 0 ? null : { index: i, time: this.times[i], age: t - this.times[i] };
  }
}

export const FLASH_A = 0.06, FLASH_B = 0.12, BOLT_LIFE = 0.34, SHAKE_LIFE = 0.25;

/** Flash dither density for a strike `age` seconds old: 2 frames (strong, then light). */
export function flashDensity(age) {
  if (age < 0 || age >= FLASH_B) return 0;
  return age < FLASH_A ? 0.55 : 0.26;
}
/** Is the bolt itself drawn at this age? (it stutters: on, off, on, dithered fade) 1 = solid, 0.5 = dithered, 0 = off */
export function boltVisibility(age) {
  if (age < 0 || age >= BOLT_LIFE) return 0;
  if (age < 0.1) return 1;
  if (age < 0.14) return 0;
  if (age < 0.26) return 1;
  return 0.5;
}
/** Camera shake in whole pixels (+-2 decaying to +-1 over ~0.25 s) for strike `index`, `age` seconds old. */
export function shakeAt(seed, index, age, out = { x: 0, y: 0 }) {
  out.x = 0; out.y = 0;
  if (age < 0 || age >= SHAKE_LIFE) return out;
  const amp = age < 0.12 ? 2 : 1;
  const step = Math.floor(age / 0.04);
  const h = hash2(index, step, seed);
  out.x = ((h & 7) % (2 * amp + 1)) - amp;
  out.y = (((h >>> 3) & 7) % (2 * amp + 1)) - amp;
  return out;
}

/**
 * Jagged bolt polyline from the top edge: writes x,y pairs into `out` (Int16Array), returns the
 * number of points. A main trunk plus one fork. Pure and seeded by (seed, index).
 */
export function boltPoints(seed, index, out, w = SW, h = SH) {
  const rnd = mulberry32(hash2(index, 0x51ed, seed));
  let n = 0;
  let x = Math.round(w * 0.18 + rnd() * w * 0.64), y = 0;
  const yEnd = Math.round(h * (0.5 + rnd() * 0.3));
  out[n++] = x; out[n++] = y;
  let forkAt = -1, fx0 = 0, fy0 = 0;
  const maxPts = out.length >> 1;
  while (y < yEnd && n < maxPts * 2 - 8) {
    const dy = 7 + Math.floor(rnd() * 8);
    const dx = Math.round((rnd() - 0.5) * 18) + (rnd() < 0.3 ? Math.round((rnd() - 0.5) * 16) : 0);
    // a quick sideways kick then a downward run gives the jagged zigzag
    x = clamp(x + dx, 4, w - 5);
    out[n++] = x; out[n++] = y + 2;
    y = Math.min(yEnd, y + dy);
    out[n++] = clamp(x + Math.round((rnd() - 0.5) * 6), 4, w - 5); out[n++] = y;
    x = out[n - 2];
    if (forkAt < 0 && y > yEnd * 0.35 && rnd() < 0.5) { forkAt = n; fx0 = x; fy0 = y; }
  }
  const trunk = n >> 1;
  let forkPts = 0;
  if (forkAt >= 0) {
    // fork: separate polyline appended after a sentinel (-1,-1)
    out[n++] = -1; out[n++] = -1;
    let fx = fx0, fy = fy0;
    const dir = rnd() < 0.5 ? -1 : 1;
    out[n++] = fx; out[n++] = fy;
    for (let k = 0; k < 3 && n < maxPts * 2 - 2; k++) {
      fx = clamp(fx + dir * (4 + Math.floor(rnd() * 7)), 4, w - 5);
      fy += 5 + Math.floor(rnd() * 6);
      out[n++] = fx; out[n++] = fy; forkPts++;
    }
  }
  return { points: n >> 1, trunk, forkPts };
}

// ----------------------------------------------------------------------------- lights
/**
 * Stamp a radial light into the night-scale map (255 = unlit, lower = lit) and the lamp-tone
 * map (0 = none, 255 = full orange). Fully lit inside r0, fading to dark by r1 (smoothstep).
 * Overlapping lights combine by min / max. Pure: used for the lantern pool and the bothy pools.
 */
export function stampLight(night, tone, w, h, cx, cy, r0, r1, litMax = 0.9, toneMax = 0.5) {
  const x0 = Math.max(0, Math.floor(cx - r1)), x1 = Math.min(w - 1, Math.ceil(cx + r1));
  const y0 = Math.max(0, Math.floor(cy - r1)), y1 = Math.min(h - 1, Math.ceil(cy + r1));
  const r12 = r1 * r1, span = r1 - r0;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    const row = y * w;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r12) continue;
      const d = Math.sqrt(d2);
      let lit = 1;
      if (d > r0) { const t = (d - r0) / span; lit = 1 - t * t * (3 - 2 * t); }
      const nv = Math.round(255 * (1 - lit * litMax));
      if (nv < night[row + x]) night[row + x] = nv;
      if (tone) { const tv = Math.round(lit * toneMax * 255); if (tv > tone[row + x]) tone[row + x] = tv; }
    }
  }
}

/** Lantern / lamp flicker: radius multiplier in about 0.94..1.06, a function of the clock only. */
export function flicker(clock, phase = 0) {
  return 1 + 0.032 * Math.sin(clock * 9.1 + phase) + 0.022 * Math.sin(clock * 17.3 + phase * 1.7 + 1.3) + 0.014 * Math.sin(clock * 3.7 + phase * 0.6);
}

// ------------------------------------------------------------------------- precipitation
/** Seeded particle field: x0,y0 in screen px, sp = speed px/s, len, kind 0 = streak 1 = flake, ph = phase. */
export function makeParticles(seed, n = 420) {
  const rnd = mulberry32((seed ^ 0x2545f491) >>> 0);
  const P = { n, x0: new Float32Array(n), y0: new Float32Array(n), sp: new Float32Array(n), len: new Uint8Array(n), ph: new Float32Array(n), r: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    P.x0[i] = rnd() * SW; P.y0[i] = rnd() * SH; P.ph[i] = rnd() * 6.283; P.r[i] = rnd();
    P.sp[i] = 0.75 + rnd() * 0.5; P.len[i] = 0;
  }
  return P;
}

/**
 * What falls, as counts and geometry, for a weather and walker altitude fraction (0..1).
 * { streaks, flakes, dx, dy, speed, len, kind } -- dx,dy unit direction of travel.
 */
export function precipitationFor(weather, altFrac = 0, out = {}) {
  let streaks = 0, flakes = 0, dx = 0.22, dy = 1, speed = 200, len = 5, kind = 'rain';
  if (weather.rain > 0) {
    const heavy = weather.rainStyle === 'heavy';
    streaks = Math.round(weather.rain * (heavy ? 330 : 190));
    speed = heavy ? 230 : 105; len = heavy ? 6 : 3;
    const w = weather.wind;
    dx = w[0] * (heavy ? 0.3 : 0.2); dy = 1;
  } else if (weather.snow > 0) {
    let k = weather.snow;
    if (weather.snowAbove != null) k *= smooth(weather.snowAbove - 0.06, weather.snowAbove + 0.12, altFrac);
    kind = 'snow';
    streaks = Math.round(k * 110); flakes = Math.round(k * 200);
    const w = weather.wind;
    dx = w[0]; dy = w[1] * 0.32 + 0.1; speed = 170; len = 11;
  }
  const m = Math.hypot(dx, dy) || 1;
  out.streaks = Math.min(streaks, 420); out.flakes = Math.min(flakes, 420);
  out.dx = dx / m; out.dy = dy / m; out.speed = speed; out.len = len; out.kind = kind;
  return out;
}

// ---------------------------------------------------------------------- chimney smoke
/**
 * One smoke puff of a plume at `clock`: writes into out { x, y, r, d } relative to the chimney
 * mouth (px), radius px and a 0..1 density. i = puff index of n. wind: x drift sign/strength.
 */
export function smokePuff(clock, i, n, seedPhase, wind, out = {}) {
  const age = fract(clock * 0.2 + i / n + seedPhase);
  out.age = age;
  out.x = wind * 26 * age * age + Math.sin(age * 7 + seedPhase * 6.283 + i) * (0.8 + age * 1.6);
  out.y = -age * 36;
  out.r = 0.9 + age * 3.2;
  out.d = (1 - age) * (age < 0.08 ? age / 0.08 : 1);
  return out;
}

/** Bothies close enough (<= maxCells) to the walker that their smoke is drawn; fills `out` indices, returns count. */
export function visibleBothies(bothies, px, py, maxCells, out) {
  let n = 0;
  for (let i = 0; i < bothies.length; i++) {
    const b = bothies[i];
    if (Math.hypot(b.x - px, b.y - py) <= maxCells) out[n++] = i;
  }
  return n;
}

// ------------------------------------------------------------------------------- the fx
const MISTABLE = new Uint8Array(PAL_COUNT);       // light ground, water, woods and bog take mist; nothing else does
[I.paper, I.paper2, I.snow, I.water, I.waterDeep, I.wood, I.bog].forEach((i) => { MISTABLE[i] = 1; });
const WARM_U32 = Array.from(WARM_MAP, (wi) => U[PAL_NAMES[wi]]);   // u32 of the warmer neighbour, by palette index
const SMOKE_SKIP = new Uint8Array(PAL_COUNT);     // never smoke over ink (symbols, labels, contours of crags) or magenta
[I.ink, I.magenta].forEach((i) => { SMOKE_SKIP[i] = 1; });

// mist bands: [texture cell w, cell h, parallax, drift px/s x, drift px/s y, weight]
const BANDS = [
  { cx: 96, cy: 20, par: 0.55, sx: 5, sy: 0.5, w: 0.5 },
  { cx: 60, cy: 14, par: 0.78, sx: 9, sy: -0.7, w: 0.38 },
  { cx: 36, cy: 9, par: 1.0, sx: 15, sy: 0.9, w: 0.3 },
];
const TW = 256, TH = 128;

export function createFx() {
  const fx = {
    weather: WEATHER_DEFAULT, levelId: null, seed: 1, world: null,
    shake: { x: 0, y: 0 },
    night: 0,            // effective night amount of the last prepare()
    lit: false,          // were light pools stamped this frame?
    strike: null,        // { index, time, age } of the strike that is still visible, or null
    lastIndex: -1, lastClock: null,
    playerX: 0, playerY: 0,
  };
  const listeners = [];
  let sched = null;
  let field = null;                                  // Uint8Array(size*size) mist field
  let fieldSize = 0;
  let texBands = null, texShadow = null;
  let parts = null;
  let stars = null;
  let bothies = [];
  const near = new Int32Array(32);
  let nNear = 0;
  const bolt = new Int16Array(96);
  let boltInfo = { points: 0, trunk: 0, forkPts: 0 };
  let boltIndex = -1;
  const precip = {};
  const dens = new Uint8Array(GW * GH);
  const shd = new Uint8Array(GW * GH);
  const lightMap = new Uint8Array(SW * SH);
  const toneMap = new Uint8Array(SW * SH);
  const list = new Int32Array(SW * SH);
  const lvls = new Uint8Array(SW * SH);
  let nList = 0;
  const shakeTmp = { x: 0, y: 0 };
  const puff = {};
  let lantern = { x: 0, y: 0, on: false };
  let toneBoxes = [];                                // reused [{x0,y0,x1,y1}]
  const boxPool = [];
  let altFrac = 0;

  // ------------------------------------------------------------------ setup
  fx.setWorld = function setWorld(world) {
    fx.world = world || null;
    const level = (world && world.level) || {};
    fx.levelId = level.id || null;
    fx.seed = (level.seed != null ? level.seed : 1) | 0;
    fx.weather = weatherFor(fx.levelId);
    fx.lastIndex = -1; fx.lastClock = null; fx.strike = null; boltIndex = -1;
    fx.shake.x = 0; fx.shake.y = 0;
    sched = fx.weather.lightning ? new LightningSchedule(fx.seed, fx.weather.lightning) : null;
    field = null; fieldSize = 0; bothies = [];
    if (world && world.height && world.cover) {
      fieldSize = world.size;
      field = buildMistField(world, fx.weather);
    }
    const s = fx.seed;
    texBands = BANDS.map((b, i) => makeNoiseTex(s * 31 + i * 977 + 5, TW, TH, b.cx, b.cy));
    texShadow = makeNoiseTex(s * 17 + 4001, TW, TH, 120, 56);
    parts = makeParticles(s);
    // stars: fixed screen positions
    const rnd = mulberry32((s ^ 0xa5a5a5) >>> 0);
    stars = { n: 52, x: new Int16Array(52), y: new Int16Array(52), ph: new Float32Array(52), sp: new Float32Array(52) };
    for (let i = 0; i < stars.n; i++) {
      stars.x[i] = 2 + Math.floor(rnd() * (SW - 4)); stars.y[i] = 2 + Math.floor(rnd() * (SH - 4));
      stars.ph[i] = rnd() * 6.283; stars.sp[i] = 0.6 + rnd() * 1.6;
    }
    if (world && world.pois) {
      for (const p of world.pois) {
        if (p.type !== 'bothy') continue;
        const r = mulberry32(hash2(Math.round(p.x), Math.round(p.y), s));
        bothies.push({ x: p.x, y: p.y, px: p.x * CELL_PX + CELL_PX / 2, py: p.y * CELL_PX + CELL_PX / 2, ph: r() * 6.283, sph: r() });
      }
    }
  };

  fx.onLightning = function onLightning(cb) {
    listeners.push(cb);
    return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
  };
  /** time (clock seconds) of strike i, or null if this level has no lightning */
  fx.strikeTime = (i) => (sched ? sched.time(i) : null);
  fx.bothies = () => bothies;

  // ----------------------------------------------------------------- update
  fx.update = function update(state, clock, dt) {
    void dt;
    if (state && state.player) { fx.playerX = state.player.x; fx.playerY = state.player.y; }
    // walker altitude fraction (for the high-snow levels)
    const w = fx.world;
    altFrac = 0;
    if (w && state && state.player && w.maxH > w.minH) altFrac = clamp((state.player.elevation - w.minH) / (w.maxH - w.minH), 0, 1);
    fx.shake.x = 0; fx.shake.y = 0; fx.strike = null;
    if (!sched) { fx.lastClock = clock; return; }
    const idx = sched.indexAt(clock);
    if (fx.lastClock !== null && clock >= fx.lastClock && idx > fx.lastIndex) {
      for (let i = fx.lastIndex + 1; i <= idx; i++) {
        if (!listeners.length) continue;
        const ev = { index: i, time: sched.time(i), x: boltX(i) };
        for (const cb of listeners.slice()) cb(ev);
      }
    }
    fx.lastIndex = idx; fx.lastClock = clock;
    if (idx >= 0) {
      const age = clock - sched.time(idx);
      if (age < BOLT_LIFE) {
        fx.strike = { index: idx, time: sched.time(idx), age };
        shakeAt(fx.seed, idx, age, shakeTmp);
        fx.shake.x = shakeTmp.x; fx.shake.y = shakeTmp.y;
      }
    }
  };
  function boltX(i) {
    const p = boltPoints(fx.seed, i, bolt);
    void p;
    boltIndex = i;
    boltInfo = p;
    return bolt[0];
  }

  // ---------------------------------------------------------------- prepare
  /**
   * Before the tint pass. Computes the effective night amount, stamps the light pools and
   * classifies which pixels take mist/shadow (on the untinted map). Returns the tint to apply
   * (a reused object) and the lightMap (or null when it is fully day).
   */
  const tintOut = { phase: 'day', night: 0, warm: 0, wash: [] };
  fx.prepare = function prepare(fb, camX, camY, tint, timeOfDay, clock, lx, ly, lvl, MW) {
    const night = effectiveNight(tint.night, timeOfDay, fx.weather);
    fx.night = night;
    tintOut.phase = tint.phase; tintOut.night = night; tintOut.warm = tint.warm; tintOut.wash = tint.wash;
    // ---- lights
    fx.lit = night > 0.04;
    toneBoxes = [];
    let lm = null;
    if (fx.lit) {
      lightMap.fill(255); toneMap.fill(0);
      const f = flicker(clock, 0);
      const lr0 = 40 * f, lr1 = 90 * f;
      lantern.x = lx; lantern.y = ly; lantern.on = true;
      stampLight(lightMap, toneMap, SW, SH, lx, ly, lr0, lr1, 0.88, 0.5);
      toneBoxes.push(box(0, lx - lr1, ly - lr1, lx + lr1, ly + lr1));
      for (let i = 0; i < bothies.length; i++) {
        const b = bothies[i];
        const bx = b.px - camX, by = b.py - camY - 1;
        if (bx < -40 || bx > SW + 40 || by < -40 || by > SH + 40) continue;
        const ff = flicker(clock, b.ph);
        stampLight(lightMap, toneMap, SW, SH, bx, by, 11 * ff, 30 * ff, 0.92, 1);
        toneBoxes.push(box(toneBoxes.length, bx - 30 * ff, by - 30 * ff, bx + 30 * ff, by + 30 * ff));
      }
      lm = lightMap;
    } else lantern.on = false;
    // ---- mist / shadow density and per-pixel classification
    nList = 0;
    const wa = fx.weather;
    if (field && (wa.mist > 0.01 || wa.shadow > 0.01)) classify(fb, camX, camY, clock, night, lm, lvl, MW);
    return { tint: tintOut, lightMap: lm };
  };
  function box(i, x0, y0, x1, y1) {
    let b = boxPool[i];
    if (!b) b = boxPool[i] = { x0: 0, y0: 0, x1: 0, y1: 0 };
    b.x0 = Math.max(0, Math.floor(x0)); b.y0 = Math.max(0, Math.floor(y0));
    b.x1 = Math.min(SW - 1, Math.ceil(x1)); b.y1 = Math.min(SH - 1, Math.ceil(y1));
    return b;
  }

  function classify(fb, camX, camY, clock, night, lm, lvl, MW) {
    const wa = fx.weather;
    const wdx = wa.wind[0] >= 0 ? 1 : -1;
    const mistAmt = wa.mist * 255 * 1.05;
    const shAmt = wa.shadow;
    const fs = fieldSize;
    // base offsets per band (parallax + drift)
    const bu0 = ((camX * BANDS[0].par + clock * BANDS[0].sx * wdx) | 0), bv0 = ((camY * BANDS[0].par * 0.6 + clock * BANDS[0].sy) | 0);
    const bu1 = ((camX * BANDS[1].par + clock * BANDS[1].sx * wdx) | 0), bv1 = ((camY * BANDS[1].par * 0.6 + clock * BANDS[1].sy) | 0);
    const bu2 = ((camX * BANDS[2].par + clock * BANDS[2].sx * wdx) | 0), bv2 = ((camY * BANDS[2].par * 0.6 + clock * BANDS[2].sy) | 0);
    const su = ((camX + clock * 6 * wdx) | 0), sv = ((camY + clock * 1.5) | 0);
    const t0 = texBands[0], t1 = texBands[1], t2 = texBands[2], ts = texShadow;
    const w0 = BANDS[0].w, w1 = BANDS[1].w, w2 = BANDS[2].w;
    const doShadow = shAmt > 0.01 && night < 0.5;
    for (let gy = 0; gy < GH; gy++) {
      const sy = gy * 2 + 1;
      const wy = camY + sy;
      const cy = (wy / CELL_PX) | 0;
      const rowF = clamp(cy, 0, fs - 1) * fs;
      const v0 = ((bv0 + sy) & 127) << 8, v1 = ((bv1 + sy) & 127) << 8, v2 = ((bv2 + sy) & 127) << 8, vs = ((sv + sy) & 127) << 8;
      for (let gx = 0; gx < GW; gx++) {
        const sx = gx * 2 + 1;
        const cx = ((camX + sx) / CELL_PX) | 0;
        const fv = field[rowF + clamp(cx, 0, fs - 1)];
        let d = 0;
        if (fv) {
          const n = t0[v0 | ((bu0 + sx) & 255)] * w0 + t1[v1 | ((bu1 + sx) & 255)] * w1 + t2[v2 | ((bu2 + sx) & 255)] * w2;
          d = (fv * n * (1 / 255)) * mistAmt * (1 / 255);
          if (lm) d *= 0.4 + 0.6 * lm[sy * SW + sx] * (1 / 255);
          if (d > 255) d = 255;
        }
        dens[gy * GW + gx] = d;
        shd[gy * GW + gx] = doShadow ? Math.min(255, ts[vs | ((su + sx) & 255)] * shAmt * 1.5) : 0;
      }
    }
    let n = 0;
    for (let y = 0; y < SH; y++) {
      const gRow = (y >> 1) * GW;
      const wy = y + camY;
      const bRow = (wy & 7) << 3, bRow2 = ((wy + 3) & 7) << 3;
      const mrow = wy * MW + camX;
      for (let x = 0; x < SW; x++) {
        const gi = gRow + (x >> 1);
        const d = dens[gi], s = shd[gi];
        if ((d | s) === 0) continue;
        const wx = x + camX;
        let l = 0;
        if (d > 0) {
          const thr = BAYER8[bRow | (wx & 7)] << 2;
          if (d > thr) l = d - thr > 90 ? 2 : 1;
        }
        if (l === 0 && s > 0 && ((x + y) & 1) === 0) {
          const thr = BAYER8[bRow2 | ((wx + 5) & 7)] << 2;
          if (s > thr) l = s - thr > 70 ? 4 : 3;
        }
        if (l === 0) continue;
        if (lvl[mrow + x] !== 0) continue;                       // never over a contour line
        const i = y * SW + x;
        if (!MISTABLE[paletteIndexOf(fb[i])]) continue;           // only light ground, water, wood, bog
        list[n] = i; lvls[n] = l; n++;
      }
    }
    nList = n;
  }

  // ------------------------------------------------------------ paintGround
  const MIST_DAY = [0, U.paper2, U.rock, U.rock, U.dusk];
  const MIST_NIGHT = [0, U.dusk, U.rock, 0, 0];
  fx.paintGround = function paintGround(fb, camX, camY, clock) {
    const night = fx.night;
    const lm = fx.lit ? lightMap : null;
    // ---- warm lamp dither in the pools (on light ground the night pass left alone)
    if (fx.lit) {
      for (let b = 0; b < toneBoxes.length; b++) {
        const bx = toneBoxes[b];
        for (let y = bx.y0; y <= bx.y1; y++) {
          const wy = y + camY;
          const r1 = (wy & 7) << 3, r2 = ((wy + 3) & 7) << 3;
          for (let x = bx.x0; x <= bx.x1; x++) {
            const i = y * SW + x;
            const t = toneMap[i];
            if (t === 0) continue;
            const wx = x + camX;
            const pi = paletteIndexOf(fb[i]);
            if (pi === 255 || !LIGHT_GROUND[pi]) continue;
            const night1 = lightMap[i] * (1 / 255) * night;      // darkness left here
            if (night1 > 0.6) continue;
            const lit = t * (1 / 255);
            if (BAYER8[r1 | (wx & 7)] < lit * 40) fb[i] = WARM_U32[pi];
            if (((x + y) & 1) === 0 && BAYER8[r2 | ((wx + 4) & 7)] < lit * 15) fb[i] = U.lamp;
          }
        }
      }
    }
    // ---- mist / shadow
    for (let k = 0; k < nList; k++) {
      const i = list[k], l = lvls[k];
      const y = (i / SW) | 0, x = i - y * SW;
      const nl = night * (lm ? lm[i] * (1 / 255) : 1);
      const isNight = nl > (BAYER8[(((y + camY) & 7) << 3) | ((x + camX) & 7)] + 0.5) * (1 / 64);
      const c = isNight ? MIST_NIGHT[l] : MIST_DAY[l];
      if (c) fb[i] = c;
    }
    // ---- stars (only in the dark, on dark ground)
    if (fx.weather.stars && night > 0.62) {
      const dk = clamp((night - 0.62) / 0.3, 0, 1);
      for (let s = 0; s < stars.n; s++) {
        const tw = Math.sin(clock * stars.sp[s] + stars.ph[s]);
        if (tw < 0.1 - dk * 0.3) continue;
        const i = stars.y[s] * SW + stars.x[s];
        if (lm && lm[i] < 150) continue;
        const pi = paletteIndexOf(fb[i]);
        if (pi !== I.night && pi !== I.ink && pi !== I.waterInk) continue;
        fb[i] = tw > 0.8 ? U.snow : U.ice;
      }
    }
  };

  // --------------------------------------------------------------- paintAir
  fx.paintAir = function paintAir(fb, camX, camY, clock, lvl, MW) {
    void lvl; void MW;
    const night = fx.night;
    // ---- chimney smoke
    if (bothies.length) {
      nNear = visibleBothies(bothies, fx.playerX, fx.playerY, 40, near);
      for (let k = 0; k < nNear; k++) drawSmoke(fb, bothies[near[k]], camX, camY, clock, night);
    }
    // ---- precipitation
    const wa = fx.weather;
    if (wa.rain > 0 || wa.snow > 0) drawPrecip(fb, clock, night);
    // ---- lightning: flash dither, then the bolt
    const st = fx.strike;
    if (st) {
      const dd = flashDensity(st.age);
      if (dd > 0) {
        for (let y = 0; y < SH; y++) {
          const r = (y & 7) << 3;
          for (let x = 0; x < SW; x++) {
            if (BAYER8[r | (x & 7)] < dd * 64) fb[y * SW + x] = ((x + y) & 1) === 0 ? U.snow : U.bolt;
          }
        }
      }
      const vis = boltVisibility(st.age);
      if (vis > 0) {
        if (boltIndex !== st.index) { boltInfo = boltPoints(fx.seed, st.index, bolt); boltIndex = st.index; }
        drawBolt(fb, vis);
      }
    }
  };

  function drawSmoke(fb, b, camX, camY, clock, night) {
    const cx = b.px - camX + 2, cy = b.py - camY - 4;
    if (cx < -30 || cx > SW + 30 || cy < -50 || cy > SH + 50) return;
    const wind = fx.weather.wind[0] >= 0 ? 1 : -1;
    const dist = Math.hypot(b.x - fx.playerX, b.y - fx.playerY);
    const fade = 1 - smooth(32, 40, dist);
    const dayThin = night > 0.5 ? 1 : 0.55;
    const N = 8;
    for (let i = 0; i < N; i++) {
      smokePuff(clock, i, N, b.sph, wind, puff);
      const px = cx + puff.x, py = cy + puff.y;
      const dens = puff.d * fade * dayThin;
      if (dens <= 0.02) continue;
      const r = puff.r, ri = Math.ceil(r);
      const col1 = U.rock, col2 = night > 0.5 ? U.dusk : U.paper2;
      for (let yy = -ri; yy <= ri; yy++) {
        for (let xx = -ri; xx <= ri; xx++) {
          const rr = Math.sqrt(xx * xx + yy * yy);
          if (rr > r) continue;
          const X = Math.round(px + xx), Y = Math.round(py + yy);
          if (X < 0 || Y < 0 || X >= SW || Y >= SH) continue;
          const th = BAYER8[((((Y + camY) & 7) << 3) | ((X + camX) & 7))] * (1 / 64);
          if (th > dens * (1 - rr / (r + 0.5))) continue;
          const i = Y * SW + X;
          if (SMOKE_SKIP[paletteIndexOf(fb[i])]) continue;
          fb[i] = (puff.age < 0.6 && th < dens * 0.55) ? col1 : col2;
        }
      }
    }
  }

  function put(fb, x, y, c) {
    if (x >= 0 && y >= 0 && x < SW && y < SH) fb[y * SW + x] = c;
  }

  const RAIN_DAY = [U.waterInk, U.grid], RAIN_NIGHT = [U.grid, U.rock];
  const SNOW_DAY = [U.ice, U.grid], SNOW_NIGHT = [U.snow, U.ice];
  function drawPrecip(fb, clock, night) {
    precipitationFor(fx.weather, altFrac, precip);
    const P = parts;
    const dark = night > 0.5;
    const cols = precip.kind === 'rain' ? (dark ? RAIN_NIGHT : RAIN_DAY) : (dark ? SNOW_NIGHT : SNOW_DAY);
    const dx = precip.dx, dy = precip.dy;
    const lenBase = precip.len;
    for (let i = 0; i < precip.streaks; i++) {
      const sp = precip.speed * P.sp[i];
      let x = P.x0[i] + dx * sp * clock, y = P.y0[i] + dy * sp * clock;
      x = ((x % SW) + SW) % SW; y = ((y % SH) + SH) % SH;
      const len = Math.max(2, Math.round(lenBase * (0.6 + P.r[i] * 0.8)));
      const c = cols[P.r[i] < 0.5 ? 0 : 1];
      for (let k = 0; k < len; k++) put(fb, Math.round(x - dx * k), Math.round(y - dy * k), c);
    }
    for (let j = 0; j < precip.flakes; j++) {
      const i = 420 - 1 - j;
      if (i < 0) break;
      const sp = 22 + P.sp[i] * 26;
      let x = P.x0[i] + dx * sp * clock * 1.6 + Math.sin(clock * 1.7 + P.ph[i]) * 2.5;
      let y = P.y0[i] + (dy * 0.5 + 0.35) * sp * clock;
      x = ((x % SW) + SW) % SW; y = ((y % SH) + SH) % SH;
      put(fb, Math.round(x), Math.round(y), cols[P.r[i] < 0.6 ? 1 : 0]);
    }
  }

  function drawBolt(fb, vis) {
    const pts = bolt;
    const total = boltInfo.points;
    const dither = vis < 1;
    let px = pts[0], py = pts[1];
    let seg = 1;
    for (let k = 1; k < total; k++) {
      const x = pts[k * 2], y = pts[k * 2 + 1];
      if (x === -1 && y === -1) { // fork starts: next point is its first vertex
        k++; px = pts[k * 2]; py = pts[k * 2 + 1]; seg = 0; continue;
      }
      line(fb, px, py, x, y, dither);
      px = x; py = y; seg++;
    }
  }
  function line(fb, x0, y0, x1, y1, dither) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!dither || ((x0 + y0) & 1) === 0) {
        put(fb, x0 + 1, y0, U.bolt);
        put(fb, x0 - 1, y0, U.bolt);
        put(fb, x0, y0, U.snow);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // ----------------------------------------------------------- lantern sparks
  /** Two or three ember pixels flickering round the lantern (ctx draw after the walker sprite). */
  fx.paintLantern = function paintLantern(ctx, lx, ly, clock) {
    if (!(fx.night > 0.12)) return;
    const k = clamp(fx.night, 0, 1);
    const n = 1 + Math.floor(k * 2);
    for (let i = 0; i < n; i++) {
      const ph = fract(clock * 1.7 + i * 0.37);
      const a = i * 2.1 + Math.floor(clock * 3 + i) * 0.9;
      const r = 2.6 + ph * 3.2;
      const x = Math.round(lx + Math.cos(a) * r), y = Math.round(ly - 1 - ph * 5 + Math.sin(a) * 1.2);
      ctx.fillStyle = ph < 0.55 ? PAL.flame : PAL.lamp;
      ctx.fillRect(x, y, 1, 1);
    }
  };

  return fx;
}
