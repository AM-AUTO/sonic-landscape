/**
 * Atmosphere signatures (docs/LEVELS.md §5): the one or two weather / light effects only one sheet has.
 * Driven by fx.js; every effect writes whole palette colours with the ordered dither, nothing is blended.
 *
 *   seaFret     fog banks rolling in from one side over the sea and low ground, in and out over two minutes
 *   whirlpool   foam spiral turning at look.tidalRace
 *   cloudCap    cloud sitting on the summits above a height; lifts through the dawn, settles again at dusk
 *   inversion   at dawn cloud fills the low ground while the tops stand clear
 *   thawMist    dawn mist lifting off the burns and lochs
 *   frostGlint  sparse twinkles on snow, ice and frosted ground at night
 *   squalls     snow showers sweeping across in bands (the snow only falls inside a band)
 *   deer        a small herd on the high ground, away from the walker; they drift off if approached
 *   whiteout    by day the visibility closes in round the walker, in gusts; the rest whites out
 *   aurora      at night slow curtains of green and pale blue over the top of the view
 *   spindrift   snow blown low across the snowfields in gusts
 *   clearing    the showers move off one edge (opt-in rainbow in the trailing rain: params.clearing.rainbow)
 *   firstSnow   snow starts falling only once the gate has opened
 *   storm       lightning and heavy rain (fx.js's own machinery)
 * Effects come from WEATHER[id].effects plus any atmosphere names in level.look.signature; parameters from the
 * weather entry's params, overridden by look[name] (e.g. look.seaFret = { from: 'W' }).
 */
import { PAL_U32 as U, PAL_INDEX as I, PAL_RGB, PAL_NAMES, PAL_COUNT, BAYER8, paletteIndexOf } from './palette.js';
import { mulberry32, hash2 } from '../core/rng.js';
import { COVER, CELL_PX, SCREEN_W, SCREEN_H, phaseBounds } from '../world/codes.js';

const SW = SCREEN_W, SH = SCREEN_H;
const GW = SW >> 1, GH = SH >> 1;
const TAU = Math.PI * 2;
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
const pmod = (a, m) => ((a % m) + m) % m;

export const BANK_EFFECTS = Object.freeze(['seaFret', 'cloudCap', 'inversion', 'thawMist']);

// colour classes, by palette index
const DARK = new Uint8Array(PAL_COUNT);          // dark enough for the aurora to show over
const SKIP_INK = new Uint8Array(PAL_COUNT);      // text, symbols, paths: banks and veils never cover them
const WATERY = new Uint8Array(PAL_COUNT);        // sea colours the whirlpool foams on
const SNOWY = new Uint8Array(PAL_COUNT);         // snow / ice ground (glints, spindrift)
const LIGHTGROUND = new Uint8Array(PAL_COUNT);   // open ground that frosts (glints at a lower rate)
for (let i = 0; i < PAL_COUNT; i++) {
  const [r, g, b] = PAL_RGB[PAL_NAMES[i]];
  if (0.3 * r + 0.59 * g + 0.11 * b < 82) DARK[i] = 1;
}
[I.ink, I.magenta, I.waterInk].forEach((i) => { SKIP_INK[i] = 1; });
[I.water, I.waterDeep].forEach((i) => { WATERY[i] = 1; });
[I.snow, I.frost, I.ice].forEach((i) => { SNOWY[i] = 1; });
[I.paper, I.paper2, I.fog, I.paleblue].forEach((i) => { LIGHTGROUND[i] = 1; });

/** tileable value-noise texture (256 x 128 bytes), lattice cx x cy px, two octaves */
function makeTex(seed, cx, cy) {
  const w = 256, h = 128, rnd = mulberry32(seed >>> 0);
  const lw = Math.max(2, Math.round(w / cx)), lh = Math.max(2, Math.round(h / cy));
  const lat = new Float32Array(lw * lh), lat2 = new Float32Array(lw * lh * 4);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  for (let i = 0; i < lat2.length; i++) lat2[i] = rnd();
  const samp = (L, W2, H2, fx, fy) => {
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const xa = pmod(x0, W2), xb = (xa + 1) % W2, ya = pmod(y0, H2), yb = (ya + 1) % H2;
    const a = L[ya * W2 + xa], b = L[ya * W2 + xb], c = L[yb * W2 + xa], d = L[yb * W2 + xb];
    return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
  };
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = samp(lat, lw, lh, (x / w) * lw, (y / h) * lh) * 0.7 + samp(lat2, lw * 2, lh * 2, (x / w) * lw * 2, (y / h) * lh * 2) * 0.3;
    out[y * w + x] = Math.round(clamp(v, 0, 1) * 255);
  }
  return out;
}
const texAt = (t, x, y) => t[((y & 127) << 8) | (x & 255)];

function boxBlur(src, n, r) {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * n + clamp(k, 0, n - 1)];
    for (let x = 0; x < n; x++) { tmp[y * n + x] = acc / w; acc += src[y * n + clamp(x + r + 1, 0, n - 1)] - src[y * n + clamp(x - r, 0, n - 1)]; }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, n - 1) * n + x];
    for (let y = 0; y < n; y++) { out[y * n + x] = acc / w; acc += tmp[clamp(y + r + 1, 0, n - 1) * n + x] - tmp[clamp(y - r, 0, n - 1) * n + x]; }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ deer
// a hind side-on, facing east: walk frames A / B, and grazing (head down)
export const DEER_ART = Object.freeze([
  ['......#..', '......##.', '.......##', '.#####.#.', '########.', '.######..', '.#....#..', '.#....#..'],
  ['......#..', '......##.', '.......##', '.#####.#.', '########.', '.######..', '..#..#...', '.#....#..'],
  ['.........', '.........', '.........', '.#####...', '########.', '.#######.', '.#....#.#', '.#....#..'],
]);

// ------------------------------------------------------------------------------------------ setup
/**
 * Build the atmosphere state for a world. effects: Set of names; params: { [name]: {...} }.
 * Returns A, the object every paint function takes.
 */
export function createAtmos(world, effects, params, seed, look) {
  const A = {
    world, effects, params, seed, look, N: 0, alt: null, fret: null, thaw: null, high: null,
    texA: makeTex(seed * 7 + 11, 90, 30), texB: makeTex(seed * 13 + 29, 40, 22), texC: makeTex(seed * 5 + 3, 140, 60),
    herd: null, gateAt: null, bank: new Uint8Array(GW * GH), bankOn: false, sheet: null, sheetW: 0,
    cold: !!(look && look.present && (look.print.base === 'snow' || look.print.base === 'frost')),
    parts: null, dark: DARK,
  };
  const rnd = mulberry32((seed ^ 0x5eed1234) >>> 0);
  A.parts = { n: 160, x: new Float32Array(160), y: new Float32Array(160), sp: new Float32Array(160), len: new Uint8Array(160), ph: new Float32Array(160) };
  for (let i = 0; i < 160; i++) { A.parts.x[i] = rnd() * SW; A.parts.y[i] = 14 + rnd() * (SH - 14); A.parts.sp[i] = 0.7 + rnd() * 0.6; A.parts.len[i] = 4 + Math.floor(rnd() * 6); A.parts.ph[i] = rnd() * TAU; }
  if (!world || !world.height || !world.cover) return A;
  const N = world.size, NN = N * N;
  A.N = N;
  const range = Math.max(1e-6, world.maxH - world.minH);
  A.alt = new Float32Array(NN);
  for (let i = 0; i < NN; i++) A.alt[i] = (world.height[i] - world.minH) / range;
  const isW = (c) => c === COVER.SHALLOW || c === COVER.DEEP;
  if (effects.has('seaFret')) {
    const f = new Float32Array(NN);
    for (let i = 0; i < NN; i++) f[i] = isW(world.cover[i]) ? 1 : 1 - smooth(0.02, 0.2, A.alt[i]);
    A.fret = boxBlur(f, N, 4);
  }
  if (effects.has('thawMist')) {
    const f = new Float32Array(NN);
    for (let i = 0; i < NN; i++) f[i] = (world.stream && world.stream[i]) || isW(world.cover[i]) ? 1 : 0;
    const b = boxBlur(f, N, 3);
    for (let i = 0; i < NN; i++) b[i] = Math.min(1, b[i] * 5.5) * (1 - smooth(0.55, 0.85, A.alt[i]));
    A.thaw = b;
  }
  if (effects.has('deer')) {
    // grazing ground: high and open (A.high), with the lower slopes as a fallback (A.mid)
    const hi = [], mid = [];
    for (let y = 6; y < N - 6; y += 3) for (let x = 6; x < N - 6; x += 3) {
      const i = y * N + x, c = world.cover[i];
      if (isW(c) || c === COVER.CRAG || c === COVER.WOOD) continue;
      if (A.alt[i] >= 0.45) hi.push(x, y); else if (A.alt[i] >= 0.22) mid.push(x, y);
    }
    A.high = Int16Array.from(hi); A.mid = Int16Array.from(mid);
  }
  return A;
}

/** the baked sheet (base colours, before any tint): glints, foam and spindrift check what lies under them */
export function atmosSetSheet(A, baked) { A.sheet = baked ? baked.pixels : null; A.sheetW = baked ? baked.W : 0; }
const sheetIdx = (A, wx, wy) => (A.sheet && wx >= 0 && wy >= 0 && wx < A.sheetW && wy < A.sheetW ? paletteIndexOf(A.sheet[wy * A.sheetW + wx]) : 255);

// ------------------------------------------------------------------------------------------ update
export function atmosUpdate(A, state, clock, dt) {
  if (A.effects.has('firstSnow')) {
    if (state && state.gateOpen) { if (A.gateAt == null || clock < A.gateAt) A.gateAt = clock; }
    else A.gateAt = null;
  }
  if (A.effects.has('deer') && A.high && state && state.player) updateHerd(A, state.player, clock, dt);
}
/** snow amount (0..0.55) the first snow has reached by `clock` */
export function firstSnowAmount(A, clock) {
  if (!A.effects.has('firstSnow') || A.gateAt == null) return 0;
  return smooth(0, 22, clock - A.gateAt) * 0.55;
}

function updateHerd(A, p, clock, dt) {
  const H = A.herd;
  const far = H ? Math.hypot(H.x - p.x, H.y - p.y) : Infinity;
  if (!H || far > 64 || (H.fleeing && far > 52)) {
    if (A.nextTry != null && clock < A.nextTry && clock > A.nextTry - 5) { A.herd = null; return; }   // look again in a moment
    A.nextTry = clock + 1.5;
    // a new herd on high ground within view but well away from the walker (lower slopes if the tops are out of sight)
    let pick = -1, L = null;
    for (const list of [A.high, A.mid]) {
      const n = list.length >> 1;
      if (!n) continue;
      const start = hash2(Math.floor(clock / 7), 3, A.seed) % n;
      for (let k = 0; k < n; k++) {
        const j = (start + k * 7919) % n, x = list[j * 2], y = list[j * 2 + 1];
        const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
        if (d >= 22 && d <= 42 && Math.abs(dx) < 44 && Math.abs(dy) < 22) { pick = j; break; }
      }
      if (pick >= 0) { L = list; break; }
    }
    if (pick < 0) { A.herd = null; return; }
    const rnd = mulberry32(hash2(pick, Math.floor(clock), A.seed));
    const m = [];
    for (let i = 0; i < 6; i++) m.push({ dx: (rnd() - 0.5) * 7, dy: (rnd() - 0.5) * 3.5, ph: rnd() * TAU, sp: 0.8 + rnd() * 0.5 });
    A.herd = { x: L[pick * 2] + 0.5, y: L[pick * 2 + 1] + 0.5, dir: rnd() < 0.5 ? -1 : 1, members: m, fleeing: false, t0: clock };
    return;
  }
  const d = Math.hypot(H.x - p.x, H.y - p.y);
  if (d < 17) H.fleeing = true;
  let vx, vy;
  if (H.fleeing) { vx = (H.x - p.x) / (d || 1) * 3.2; vy = (H.y - p.y) / (d || 1) * 3.2; H.dir = vx >= 0 ? 1 : -1; }
  else { vx = H.dir * 0.35 * (0.5 + 0.5 * Math.sin(clock * 0.3)); vy = Math.sin(clock * 0.21 + H.t0) * 0.12; }
  const step = Math.min(0.1, Math.max(0, dt || 0));
  H.x += vx * step; H.y += vy * step;
  // turn back at the edge of the grazing (keeps them on the high ground)
  if (!H.fleeing && A.alt) {
    const N = A.N, cx = clamp(Math.round(H.x), 0, N - 1), cy = clamp(Math.round(H.y), 0, N - 1);
    if (A.alt[cy * N + cx] < 0.3) H.dir = -H.dir;
  }
}

// ------------------------------------------------------------------------------------------ banks
function phaseInfo(tod, season) {
  const p = pmod(tod, 1), [a, b, c] = phaseBounds(season);
  return { p, a, b, c };
}
/** Is any bank effect present at this time of day? (cheap early-out) */
export function bankDensity(A, camX, camY, clock, tod, season) {
  const E = A.effects;
  if (!A.alt) { A.bankOn = false; return false; }
  const { p, a, b, c } = phaseInfo(tod, season);
  const N = A.N, P = CELL_PX;
  // envelopes
  const fretOn = E.has('seaFret') && A.fret;
  let front = 0, fdx = 1, fdy = 0, side = 'W';
  if (fretOn) {
    side = (A.params.seaFret && A.params.seaFret.from) || 'W';
    front = 0.14 + 0.3 * (0.5 - 0.5 * Math.cos((clock / 120) * TAU));
    fdx = side === 'W' ? 1 : side === 'E' ? -1 : 0; fdy = side === 'N' ? 1 : side === 'S' ? -1 : 0;
  }
  let cap = -1;
  if (E.has('cloudCap')) {
    const cp = A.params.cloudCap || {};
    const base = cp.above != null ? cp.above : 0.68, top = 1.25;
    if (cp.lift === false) cap = base;
    else if (p < a) cap = base + (top - base) * smooth(0, a, p);
    else if (p < b) cap = top;
    else if (p < c) cap = base + (top - base) * (1 - smooth(b, c, p));
    else cap = base;
    if (cap > 1.15) cap = -1;
  }
  let inv = 0, invTop = 0.3;
  if (E.has('inversion')) {
    const ip = A.params.inversion || {};
    invTop = ip.top != null ? ip.top : 0.3;
    inv = p < a ? 1 : p < b ? 1 - smooth(a, a + (b - a) * 0.4, p) : p > c ? smooth(c + (1 - c) * 0.85, 1, p) * 0.6 : 0;
  }
  let thaw = 0;
  if (E.has('thawMist') && A.thaw) thaw = p < a ? 0.6 + 0.4 * smooth(0, a * 0.5, p) : p < b ? 1 - smooth(a, a + (b - a) * 0.35, p) : 0;
  if (!fretOn && cap < 0 && inv <= 0.01 && thaw <= 0.01) { A.bankOn = false; return false; }
  const bank = A.bank, ta = A.texA, tb = A.texB, tc = A.texC;
  const t = clock;
  let any = false;
  for (let gy = 0; gy < GH; gy++) {
    const wy = camY + gy * 2 + 1, cj = clamp((wy / P) | 0, 0, N - 1);
    for (let gx = 0; gx < GW; gx++) {
      const wx = camX + gx * 2 + 1, ci = clamp((wx / P) | 0, 0, N - 1), i = cj * N + ci;
      const al = A.alt[i];
      let d = 0;
      if (fretOn) {
        const e = side === 'W' ? ci / N : side === 'E' ? 1 - ci / N : side === 'N' ? cj / N : 1 - cj / N;
        const env = smooth(front + 0.1, front - 0.05, e);
        if (env > 0) {
          const n = texAt(ta, ((wx - fdx * t * 9) * 0.5) | 0, ((wy - fdy * t * 9) * 0.7) | 0) / 255;
          const v = A.fret[i] * env * clamp((n - 0.5) * 3.6, 0, 1.2);    // banks with wide clear lanes between
          if (v > d) d = v;
        }
      }
      if (cap >= 0) {
        const n = texAt(tc, ((wx + t * 4) * 0.6) | 0, (wy * 0.8) | 0) / 255;
        const lvl = cap + (n - 0.5) * 0.06;
        const v = smooth(lvl - 0.015, lvl + 0.07, al) * (0.62 + 0.55 * n);
        if (v > d) d = v;
      }
      if (inv > 0.01) {
        const n = texAt(tb, ((wx + t * 2) * 0.5) | 0, ((wy) * 0.6) | 0) / 255;
        const top = invTop + (n - 0.5) * 0.05;
        const v = (1 - smooth(top - 0.03, top + 0.012, al)) * inv * (0.86 + 0.3 * n);
        if (v > d) d = v;
      }
      if (thaw > 0.01) {
        const n = texAt(tb, (wx * 0.9) | 0, ((wy + t * 6) * 0.9) | 0) / 255;
        const v = A.thaw[i] * thaw * clamp(n * 1.6 - 0.2, 0, 1.1);
        if (v > d) d = v;
      }
      const q = d <= 0 ? 0 : d >= 1 ? 255 : (d * 255) | 0;
      bank[gy * GW + gx] = q;
      if (q) any = true;
    }
  }
  A.bankOn = any;
  return any;
}

/** paint the banks into the framebuffer (after the night pass): day / twilight / night colours */
export function paintBanks(A, fb, camX, camY, night, twilight, lvl, MW) {
  if (!A.bankOn) return;
  const lit = twilight > 0 || (night > 0.1 && night < 0.6);
  const bank = A.bank;
  // greys, whites and blues only: white cloud by day (grey-edged on the white prints), steel-blue cloud at night;
  // at dawn and dusk the core stays white with a thin flame edge where the cloud top meets clear air
  const dayThin = A.cold ? U.fog : U.snow, dayCore = U.snow;
  const ntThin = U.steelD, ntCore = U.steel;
  for (let y = 0; y < SH; y++) {
    const gRow = (y >> 1) * GW, wy = y + camY;
    const bRow = (wy & 7) << 3, bRow2 = ((wy + 4) & 7) << 3;
    const mrow = lvl ? wy * MW + camX : 0;
    for (let x = 0; x < SW; x++) {
      const d = bank[gRow + (x >> 1)];
      if (d < 56) continue;                                             // no faint even haze: banks have edges
      const wx = x + camX;
      const th = BAYER8[bRow | (wx & 7)] << 2;
      if (d <= th && d < 205) continue;                                 // a dense bank is solid: no map speckle left in it
      const i = y * SW + x;
      const pi = paletteIndexOf(fb[i]);
      if (pi === 255 || SKIP_INK[pi]) continue;
      const core = d > 150 && (d - 150) * 2.4 > (BAYER8[bRow2 | ((wx + 3) & 7)] << 2);
      if (!core && lvl && lvl[mrow + x] !== 0 && d < 200) continue;   // thin haze leaves the contours alone
      let c;
      if (night > 0.7) c = core ? ntCore : ntThin;
      else if (night > 0.6) c = core ? U.blue : U.steel;
      else c = core ? dayCore : dayThin;
      if (lit && core && night > 0.1 && night < 0.6) {                // dawn / dusk: a 1 px flame rim on the lit top edge
        const up = y > 0 ? bank[(((y - 2) >> 1) < 0 ? 0 : (y - 2) >> 1) * GW + (x >> 1)] : 255;
        if (up < 60) c = U.flame;
      }
      fb[i] = c;
    }
  }
}

// ------------------------------------------------------------------------------------------ glints
export function paintGlint(A, fb, camX, camY, clock, night) {
  if (night < 0.45 || !A.sheet) return;
  const k = smooth(0.45, 0.8, night);
  const S = 5, seed = A.seed + 401;
  const i0 = Math.floor(camX / S), j0 = Math.floor(camY / S);
  for (let j = j0; j <= j0 + Math.ceil(SH / S); j++) {
    for (let i = i0; i <= i0 + Math.ceil(SW / S); i++) {
      const h = hash2(i, j, seed);
      if ((h & 15) !== 0) continue;
      const wx = i * S + ((h >>> 4) % S), wy = j * S + ((h >>> 8) % S);
      const x = wx - camX, y = wy - camY;
      if (x < 1 || y < 14 || x >= SW - 1 || y >= SH - 1) continue;
      const bi = sheetIdx(A, wx, wy);
      if (bi === 255) continue;
      const snowy = SNOWY[bi];
      if (!snowy && (!LIGHTGROUND[bi] || ((h >>> 12) & 1) !== 0)) continue;
      const tw = Math.sin(clock * (1.3 + ((h >>> 14) & 7) * 0.35) + ((h >>> 17) & 63) * 0.1);
      if (tw < 0.93 - 0.1 * k) continue;
      const o = y * SW + x;
      fb[o] = U.snow;
      if (tw > 0.985) {                                          // the peak of a twinkle: a tiny cross
        const arm = snowy ? U.ice : U.frost;
        fb[o - 1] = arm; fb[o + 1] = arm; fb[o - SW] = arm; fb[o + SW] = arm;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------ whirlpool
export function paintWhirlpool(A, fb, camX, camY, clock, night) {
  const t = (A.params.whirlpool && A.params.whirlpool.at) || (A.look && A.look.raw && A.look.raw.tidalRace);
  if (!t) return;
  const P = CELL_PX;
  const R = Math.max(12, (t.r || 10) * P * 0.75);
  const cx = t.x * P + P / 2 - camX, cy = t.y * P + P / 2 - camY;
  if (cx < -R || cy < -R || cx > SW + R || cy > SH + R) return;
  const foam = night > 0.6 ? U.frost : U.snow, foam2 = night > 0.6 ? U.paleblue : U.frost;
  const fl = Math.floor(clock * 6);
  for (let arm = 0; arm < 3; arm++) {
    for (let s = 0; s < 150; s++) {
      const u = s / 150;
      const r = R * (0.08 + 0.92 * u);
      const th = arm * (TAU / 3) + (1 - u) * 6.2 - clock * 0.85;
      const x = Math.round(cx + Math.cos(th) * r), y = Math.round(cy + Math.sin(th) * r * 0.72);
      if (x < 0 || y < 14 || x >= SW - 1 || y >= SH) continue;
      if ((hash2(arm * 197 + s, fl, A.seed) & 7) === 0) continue;   // the foam breaks and re-forms
      const bi = sheetIdx(A, x + camX, y + camY);
      if (!WATERY[bi]) continue;
      const c = u > 0.75 && (s & 1) ? foam2 : foam;
      fb[y * SW + x] = c;
      if (u < 0.6) fb[y * SW + x + 1] = c;                        // the inner arms are thicker
    }
  }
  // the dark eye
  const ex = Math.round(cx), ey = Math.round(cy);
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x = ex + dx, y = ey + dy;
    if (x >= 0 && y >= 14 && x < SW && y < SH && WATERY[sheetIdx(A, x + camX, y + camY)]) fb[y * SW + x] = night > 0.6 ? U.deepblue : U.waterInk;
  }
}

// ------------------------------------------------------------------------------------------ deer
export function paintDeer(A, fb, camX, camY, clock, night) {
  const H = A.herd;
  if (!H || night > 0.75) return;
  const col = night > 0.35 ? U.char : U.ink;
  const halo = U[(A.look && A.look.present && A.look.print.base) || 'paper'];
  for (let k = 0; k < H.members.length; k++) {
    const m = H.members[k];
    const bob = Math.sin(clock * 0.5 + m.ph);
    const x0 = Math.round((H.x + m.dx + bob * 0.4) * CELL_PX - camX), y0 = Math.round((H.y + m.dy) * CELL_PX - camY);
    if (x0 < -10 || y0 < 10 || x0 > SW + 10 || y0 > SH + 8) continue;
    const moving = H.fleeing || Math.abs(Math.sin(clock * 0.3 + m.ph * 0.2)) > 0.25;
    const grazing = !H.fleeing && !moving && Math.sin(clock * 0.7 + m.ph * 3) > 0;
    const art = grazing ? DEER_ART[2] : DEER_ART[moving ? Math.floor(clock * (H.fleeing ? 8 : 3) * m.sp + m.ph) & 1 : 0];
    const flip = H.dir < 0, w = art[0].length, h = art.length;
    const at = (xx, yy) => yy >= 0 && yy < h && xx >= 0 && xx < w && art[yy][flip ? w - 1 - xx : xx] === '#';
    const ox = x0 - 4, oy = y0 - 7;
    for (let yy = -1; yy <= h; yy++) {
      for (let xx = -1; xx <= w; xx++) {
        const X = ox + xx, Y = oy + yy;
        if (X < 0 || Y < 14 || X >= SW || Y >= SH) continue;
        if (at(xx, yy)) { fb[Y * SW + X] = col; continue; }
        if (night > 0.35) continue;                                // by day a thin light halo keeps them clear of the map
        if (at(xx - 1, yy) || at(xx + 1, yy) || at(xx, yy - 1) || at(xx, yy + 1)) fb[Y * SW + X] = halo;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------ precipitation masks
/** 0..1: is the snow of a squall falling at screen (x, y)? bands sweeping across with the wind */
export function squallMask(A, x, y, camX, camY, clock, wind) {
  const wx = x + camX, wy = y + camY;
  const m = Math.hypot(wind[0], wind[1]) || 1;
  const proj = (wx * wind[0] + wy * wind[1]) / m - clock * 38;
  const s = pmod(proj, 620);
  return smooth(0, 80, s) * (1 - smooth(170, 260, s));
}
/** 0..1: is the trailing shower of a clearing over screen (x, y)? the band moves off towards params.to */
export function clearingMask(A, x, y, camX, camY, clock) {
  const to = (A.params.clearing && A.params.clearing.to) || 'E';
  const wx = x + camX, wy = y + camY;
  const L = A.N * CELL_PX + 700;
  const pos = pmod(clock * 16, L) - 350;
  const coord = to === 'E' ? wx : to === 'W' ? A.N * CELL_PX - wx : to === 'S' ? wy : A.N * CELL_PX - wy;
  const d = coord - pos;                                         // ahead of the band: clear, behind: clear
  return smooth(-200, -60, d) * (1 - smooth(40, 150, d));
}

/** a light veil of snow inside the squall bands (visibility drops), over ground only */
export function paintSquallVeil(A, fb, camX, camY, clock, wind, night) {
  const col = night > 0.6 ? U.paleblue : U.snow;
  for (let y = 14; y < SH; y += 1) {
    const wy = y + camY, bRow = (wy & 7) << 3;
    for (let x = (y & 1); x < SW; x += 2) {
      const k = squallMask(A, x, y, camX, camY, clock, wind);
      if (k < 0.3) continue;
      const wx = x + camX;
      if ((BAYER8[bRow | (wx & 7)] + 0.5) / 64 > (k - 0.3) * 0.34) continue;
      const i = y * SW + x, pi = paletteIndexOf(fb[i]);
      if (pi === 255 || SKIP_INK[pi]) continue;
      fb[i] = col;
    }
  }
}

// ------------------------------------------------------------------------------------------ spindrift
export function paintSpindrift(A, fb, camX, camY, clock, wind, night) {
  if (!A.sheet) return;
  const g = smooth(0.25, 0.85, 0.5 + 0.5 * Math.sin(clock * 0.37) * Math.sin(clock * 0.11 + 1));
  const P = A.parts, n = Math.round(P.n * g);
  if (!n) return;
  const dir = wind[0] >= 0 ? 1 : -1;
  const head = night > 0.6 ? U.frost : U.snow, body = night > 0.6 ? U.paleblue : U.frost;
  for (let i = 0; i < n; i++) {
    const sp = 150 * P.sp[i];
    const x = Math.round(pmod(P.x[i] + dir * sp * clock, SW + 20) - 10);
    const y = Math.round(P.y[i] + Math.sin(clock * 1.4 + P.ph[i]) * 2);
    if (y < 14 || y >= SH) continue;
    for (let k = 0; k < P.len[i]; k++) {
      const X = x - dir * k;
      if (X < 0 || X >= SW) continue;
      const bi = sheetIdx(A, X + camX, y + camY);
      if (!SNOWY[bi] && !(A.cold && LIGHTGROUND[bi])) continue;
      const o = y * SW + X, pi = paletteIndexOf(fb[o]);
      if (pi === 255 || SKIP_INK[pi]) continue;
      if (k > 2 && ((k + i) & 1)) continue;
      fb[o] = k === 0 ? head : body;
    }
  }
}

// ------------------------------------------------------------------------------------------ whiteout
/** 0..1 how closed-in the white-out is at `clock` (gusts) and by daylight (none at night) */
export function whiteoutAmount(clock, night) {
  const g = 0.5 + 0.5 * Math.sin((clock / 64) * TAU) * 0.8 + 0.2 * Math.sin((clock / 17) * TAU);
  return smooth(0.3, 0.8, g) * (1 - smooth(0.25, 0.6, night));
}
export function paintWhiteout(A, fb, camX, camY, clock, night, px, py) {
  const k = whiteoutAmount(clock, night);
  if (k < 0.03) return k;
  const r0 = 26 + (1 - k) * 170, r1 = r0 + 70;
  const max = 0.4 + 0.6 * k;
  const y0 = 13;
  for (let y = y0; y < SH; y++) {
    const dy = y - py, wy = y + camY, bRow = (wy & 7) << 3, bRow2 = ((wy + 2) & 7) << 3;
    for (let x = 0; x < SW; x++) {
      const dx = x - px, d = Math.sqrt(dx * dx + dy * dy);
      if (d <= r0) continue;
      const f = smooth(r0, r1, d) * max;
      const wx = x + camX;
      const th = (BAYER8[bRow | (wx & 7)] + 0.5) / 64;
      if (th >= f) { if (f > 0.78) fb[y * SW + x] = U.frost; continue; }   // deep in the white: no map left, a faint grain
      fb[y * SW + x] = (f < 0.55 && (BAYER8[bRow2 | ((wx + 5) & 7)] + 0.5) / 64 < 0.5) ? U.frost : U.snow;
    }
  }
  return k;
}

// ------------------------------------------------------------------------------------------ aurora
export function paintAurora(A, fb, camX, camY, clock, night) {
  if (night < 0.6) return;
  const nk = smooth(0.6, 0.9, night);
  const t = clock;
  const top = 14;
  for (let x = 0; x < SW; x++) {
    const wx = x + Math.round(camX * 0.15);                       // a little parallax: the sky is far away
    let I0 = 0.55 * Math.sin(wx * 0.017 + t * 0.09) + 0.35 * Math.sin(wx * 0.049 - t * 0.14 + 2) + 0.22 * Math.sin(wx * 0.12 + t * 0.33) + 0.04;
    if (I0 <= 0) continue;
    I0 = Math.min(1, I0 * 1.3);
    const yb = 62 + 20 * Math.sin(wx * 0.011 + t * 0.06) + 7 * Math.sin(wx * 0.047 - t * 0.17);
    const hgt = 30 + 36 * I0;
    const ray = 0.55 + 0.45 * ((hash2(wx >> 1, Math.floor(t * 0.5), A.seed + 9) & 255) / 255);
    for (let y = Math.max(top, Math.floor(yb - hgt)); y <= Math.min(SH - 1, Math.ceil(yb)); y++) {
      const v = 1 - (yb - y) / hgt;                                // 1 at the lower hem, 0 at the top
      const dens = Math.min(0.62, I0 * (0.2 + 0.9 * v * Math.sqrt(v)) * ray * nk);
      const wy = y;
      if ((BAYER8[((wy & 7) << 3) | (wx & 7)] + 0.5) / 64 >= dens) continue;
      const i = y * SW + x, pi = paletteIndexOf(fb[i]);
      if (pi === 255 || !DARK[pi]) continue;
      fb[i] = v > 0.82 ? U.wood : v > 0.45 ? U.bog : v > 0.2 ? U.paleblue : U.frost;
    }
  }
}

// ------------------------------------------------------------------------------------------ rainbow (clearing)
const BOW = [U.lamp, U.flame, U.wood, U.grid, U.blue, U.steel];   // no red band: the palette rule bars red stipple
export function paintRainbow(A, fb, camX, camY, clock, night, px, py) {
  if (night > 0.2 || !(A.params.clearing && A.params.clearing.rainbow === true)) return;   // opt-in: clearing: { rainbow: true }
  const cx = px, cy = py + 60, R = 120;
  for (let y = 14; y < Math.min(SH, cy); y++) {
    const dy = y - cy, wy = y + camY, bRow = (wy & 7) << 3;
    for (let x = 0; x < SW; x++) {
      const dx = x - cx, d = Math.sqrt(dx * dx + dy * dy) - R;
      if (d < 0 || d >= 12) continue;
      const m = clearingMask(A, x, y, camX, camY, clock);
      if (m < 0.35) continue;
      const wx = x + camX;
      if ((BAYER8[bRow | (wx & 7)] + 0.5) / 64 > (m - 0.35) * 0.5) continue;
      const i = y * SW + x, pi = paletteIndexOf(fb[i]);
      if (pi === 255 || SKIP_INK[pi]) continue;
      fb[i] = BOW[(d / 2) | 0];
    }
  }
}

export { GW as ATMOS_GW, GH as ATMOS_GH };
