/**
 * shelter: a ruined dry-stone shelter in a glen. After the photograph of the bothy ruin: slab walls laid course on course, a heavy flat lintel over
 * a black doorway, a turf roof of tussock, cairns and standing stones and long grass in front, snow-patched hills going back under a bright sky.
 * Greys + ONE ember accent, used once: the single small glow deep inside the doorway (the same signal as a bothy window on the game's map);
 * apart from that only the carved logo's lit edge is ember.
 *
 * Every wall stone is its own shaded slab (castlerigg.js shadedRock): irregular courses, widths and thicknesses that never line up, chipped corners,
 * lichen, hairline cracks, a lit top edge and a dark gap beneath. The hills are the same OS-sheet language as castlerigg: stepped grey tints,
 * hill-shading, faint contours, a thin grid, a spot height, and snow where the tint goes pale (the contour lines run through the snow).
 */
import {
  paintTitleLogo, animLogo, makeMistBands, animMistBands, paintMistBands, pulseEmbers, paintFootPlate, textClear, paintContourField,
  GREY, sinkG, bay, clamp, smooth, mix, vnoise, fbm, rampAt, hash2f, mulberry32, C,
} from './kit.js';
import { shadedRock, paintSky, crestOf, paintRidge, tuft, collectGlints, animGlints } from './castlerigg.js';

export const layout = { prompt: { x: 192, y: 177 }, colors: { subtitle: 'snow' } };
export const levels = [];

const W = 384, H = 216;
const LIGHT = [-0.5, -0.85];                                 // towards the sun: high, a little to the left
const GROUND = 124;                                          // where the glen floor starts behind the hut

// ------------------------------------------------------------------------------------------------ the glen
function snowOf(seed, crest, depthOf, amount) {
  return (x, y) => {
    const xi = clamp(x | 0, 0, W - 1), k = clamp((y - crest[xi]) / depthOf(xi), 0, 1);
    const n = fbm(x * 0.026, y * 0.11 + x * 0.012, seed, 3);                       // streaks lying along the slope
    return smooth(0.6 - amount, 0.63 - amount, n + (0.32 - k) * 0.5) * (1 - smooth(0.6, 0.95, k));
  };
}

function paintGlen(r, seed) {
  paintSky(r, seed, { hz: 118, glow: { x: 190, y: 82, amp: 0.42, sx: 95, sy: 36 }, v: [0.28, 0.78, 1.3], cloud: 1.1, streakAng: 0.25 });
  const dome = crestOf(seed + 11, 110, 30, 0.011, 1.15, (x, y) => y - (vnoise(x * 0.17, 2, seed + 13) - 0.5) * 3);
  const right = crestOf(seed + 21, 0, 0, 0.01, 1, (x, y) => (x < 200 ? 400 : 128 - 58 * Math.pow(smooth(200, 384, x), 0.85) - (vnoise(x * 0.04, 8, seed + 22) - 0.5) * 8 + (vnoise(x * 0.15, 3, seed + 23) - 0.5) * 3));
  const left = crestOf(seed + 31, 0, 0, 0.01, 1, (x, y) => (x > 200 ? 400 : 128 - 58 * Math.pow(1 - smooth(-10, 200, x), 0.9) - (vnoise(x * 0.05, 9, seed + 32) - 0.5) * 8 + (vnoise(x * 0.16, 5, seed + 33) - 0.5) * 3));
  const moor = crestOf(seed + 41, 125, 5, 0.025, 1, (x, y) => y);
  const depth = (c) => (x) => Math.max(8, 130 - c[x]);
  const noText = [{ x: 40, y: 4, w: 310, h: 72 }];
  paintRidge(r, dome, moor, { tints: [0.8, 0.52], hazeV: 0.95, layer: 1, step: 6, soft: 3, edge: 2, seed: seed + 100, grid: 48, spots: 1, shade: 0.25, light: LIGHT, bottomY: 150, metres: [780, 1120], avoid: noText, snow: snowOf(seed + 101, dome, depth(dome), 0.04) });
  paintRidge(r, right, moor, { tints: [0.46, 0.14], hazeV: 1.0, layer: 2, step: 5, soft: 3, edge: 2, seed: seed + 200, grid: 48, shade: 0.4, relief: 34, light: LIGHT, bottomY: 150, snow: snowOf(seed + 201, right, depth(right), 0.0) });
  paintRidge(r, left, moor, { tints: [0.42, 0.12], hazeV: 1.0, layer: 2, step: 5, soft: 3, edge: 2, seed: seed + 300, grid: 48, shade: 0.4, relief: 34, light: LIGHT, bottomY: 150, snow: snowOf(seed + 301, left, depth(left), -0.02) });
  paintRidge(r, moor, null, { tints: [0.36, 0.16], hazeV: 0.6, foot: 0.4, layer: 3, step: 5, soft: 4, seed: seed + 400, grid: 48, shade: 0.35, light: LIGHT, bottomY: 150 });
  paintMistBands(r, [{ y: 104, rows: 20, layerMax: 3, dens: 0.8, phase: 90 }], seed + 900);
  // the glen floor: dark banded tints with the lines of its own gentle rise
  const hf = (x, y) => clamp(0.4 + (fbm(x * 0.012, y * 0.03, seed + 60, 3) - 0.5) * 0.9 - (y - 140) * 0.0014, 0, 1);
  paintContourField(r, hf, {
    rect: { x: 0, y: 134, w: W, h: H - 134 }, bands: 11, tints: [0.03, 0.4], seam: 0.65, light: LIGHT, shade: 0.22, relief: 55, fine: true, index: 4,
    layer: 4, haze: (x, y) => 0.5 * (1 - smooth(134, 160, y)), hazeV: 0.55,
  });
}

// ------------------------------------------------------------------------------------------------ the hut
const HUT = { floor: 156, top: 92, L0: 84, R0: 302, L1: 112, R1: 274 };
const DOOR = { x0: 160, x1: 228, y0: 121 };
const edgeL = (y) => mix(HUT.L1, HUT.L0, clamp((y - HUT.top) / (HUT.floor - HUT.top), 0, 1));
const edgeR = (y) => mix(HUT.R1, HUT.R0, clamp((y - HUT.top) / (HUT.floor - HUT.top), 0, 1));

/** The darkness between the stones, then the courses of slabs. */
function paintWalls(r, seed, S) {
  const rng = mulberry32(seed * 31 + 7);
  // dark core of the walls (the gaps show it)
  for (let y = HUT.top - 2; y <= HUT.floor + 4; y++) for (let x = Math.floor(edgeL(y)) - 8; x <= Math.ceil(edgeR(y)) + 8; x++) {
    r.px(x, y, bay(x, y) < 0.5 ? C.char : C.ink, 5);
  }
  const courses = [[156, 144], [144, 132], [132, 121], [121, 109], [109, 99], [99, 91]];
  let prevJoints = [];
  const slabs = [];
  courses.forEach(([yb, yt], ci) => {
    const ch = yb - yt;
    const y = (yb + yt) / 2;
    const xl = edgeL(y) - 5 - rng() * 6 + (ci === 0 ? -8 : 0), xr = edgeR(y) + 5 + rng() * 6 + (ci === 0 ? 8 : 0);
    // runs either side of the door (and the lintel course is the lintel itself)
    const runs = [];
    if (yb > DOOR.y0 + 1) runs.push([xl, DOOR.x0 - 1 - rng() * 3], [DOOR.x1 + 1 + rng() * 3, xr]);
    else if (yb > 109) runs.push([xl, 138 - 2], [250 + 2, xr]);
    else runs.push([xl, xr]);
    const joints = [];
    for (const [a, b] of runs) {
      let x = a;
      while (x < b - 6) {
        let w = 17 + rng() * 30 + (rng() < 0.18 ? 14 : 0);
        for (let tries = 0; tries < 8; tries++) {                                         // never let a joint sit over the joint below
          if (prevJoints.every((j) => Math.abs(x + w - j) > 7)) break;
          w = 17 + rng() * 32;
        }
        if (x + w > b - 8) w = b - x;
        if (w < 9) break;
        const th = ch * (0.82 + rng() * 0.38), cy = y + (rng() - 0.5) * 2.2 + (th - ch) * 0.2;
        slabs.push({ x, w, cy, th, ci, rot: (rng() - 0.5) * 0.07, seed: 300 + slabs.length * 7, left: (x + w / 2 - 192) / 100 });
        joints.push(x + w);
        x += w + 0.5 + rng() * 1.2;
      }
    }
    prevJoints = joints;
  });
  // the lintel: one massive slab, thick, proud of the wall, with its own long shadow
  slabs.push({ x: 136, w: 118, cy: 113, th: 15, ci: 3, rot: -0.012, seed: 99, lintel: true, left: 0 });
  // paint: bottom courses first so each slab's shadow falls on the one beneath
  slabs.sort((a, b) => b.cy + (b.lintel ? 40 : 0) - (a.cy + (a.lintel ? 40 : 0)) || a.x - b.x);
  slabs.sort((a, b) => (a.lintel ? 1 : 0) - (b.lintel ? 1 : 0));
  for (const s of slabs) {
    const tone = 0.3 + 0.3 * hash2f(s.seed, 1, seed) - s.left * 0.06 + (s.lintel ? 0.1 : 0);
    const hv = (k) => hash2f(s.seed, k, seed);
    const info = shadedRock(r, {
      cx: s.x + s.w / 2, cy: s.cy, rx: s.w / 2 * 1.04, ry: s.th / 2 * 1.18, rot: s.rot, p: s.lintel ? 7 : 6 + hv(2) * 3, planes: s.lintel ? 5 : 3 + Math.round(hv(4)), rough: 0.5, facet: 1.2, bump: 0.8,
      shear: s.lintel ? 0.12 : (hv(5) - 0.5) * 0.6, bevel: s.lintel ? 3.2 : 2 + hv(3) * 0.8, H: s.lintel ? 5 : 3.2, light: LIGHT, elev: 0.5, tone, contrast: 1.2, grain: 0.16, rim: s.lintel ? 0.7 : 0.4,
      lichen: s.lintel ? 1.5 : 1.0, lichenSize: [1.1, 3.2], lichenTone: 0.55, cracks: s.w > 24 ? 1 : 0, base: 0.28, layer: 5, seed: s.seed,
    });
    if (!info) continue;
    // the ledge shadow on whatever lies below, and a thin lit lip on the slab's own top
    const sh = s.lintel ? 4 : 2;
    for (let i = 0; i < info.w; i++) {
      let bottom = -1;
      for (let j = info.h - 1; j >= 0; j--) if (info.data[j * info.w + i]) { bottom = j; break; }
      if (bottom < 0) continue;
      for (let k = 1; k <= sh; k++) {
        const X = info.x + i, Y = info.y + bottom + k;
        if (r.get(X, Y) && bay(X, Y) < (1 - k / (sh + 1)) * 0.95 && r.layer(X, Y) === 5 && !info.data[(bottom + k) * info.w + i]) r.px(X, Y, sinkG(sinkG(r.get(X, Y))), 5);
      }
    }
    if (s.lintel) S.lintel = info;
  }
  // small pinning stones wedged into the gaps
  for (let i = 0; i < 26; i++) {
    const y = 94 + hash2f(i, 1, seed + 50) * 60, xl = edgeL(y) + 4, xr = edgeR(y) - 4;
    const x = xl + hash2f(i, 2, seed + 50) * (xr - xl);
    if (y > DOOR.y0 - 6 && x > DOOR.x0 - 6 && x < DOOR.x1 + 6) continue;
    if (y > 104 && y < 122 && x > 134 && x < 256) continue;
    if (r.get(Math.round(x), Math.round(y)) !== C.ink && r.get(Math.round(x), Math.round(y)) !== C.char) continue;
    shadedRock(r, { cx: x, cy: y, rx: 3 + hash2f(i, 3, seed + 50) * 3, ry: 1.8 + hash2f(i, 4, seed + 50) * 1.6, rot: (hash2f(i, 5, seed + 50) - 0.5) * 0.6, p: 3, planes: 2, rough: 0.6, bevel: 1.8, H: 2.5, light: LIGHT, elev: 0.5, tone: 0.3 + hash2f(i, 6, seed + 50) * 0.2, contrast: 1.1, base: 0.2, layer: 5, seed: 900 + i });
  }
}

/** The doorway: black. One small ember deep inside. */
function paintDoor(r, seed, S) {
  const rng = mulberry32(seed * 17 + 3);
  const jl = [], jr = [];
  for (let y = DOOR.y0; y <= HUT.floor + 2; y++) { jl.push(DOOR.x0 + Math.round((vnoise(y * 0.3, 1, seed + 5) - 0.5) * 4)); jr.push(DOOR.x1 + Math.round((vnoise(y * 0.3, 2, seed + 6) - 0.5) * 4)); }
  for (let y = DOOR.y0 + 1; y <= HUT.floor + 2; y++) for (let x = jl[y - DOOR.y0] - 1; x <= jr[y - DOOR.y0] + 1; x++) {
    // the shadow of the lintel and jambs: black at once, a ragged lit lip only on the low threshold
    r.px(x, y, C.ink, 5);
  }
  // a few pale rubble stones across the threshold, out of the dark
  const cx = 194, cy = 143;
  S.embers = [];
  for (let y = cy - 6; y <= cy + 6; y++) for (let x = cx - 8; x <= cx + 8; x++) {
    const d = Math.hypot((x - cx) / 1.5, y - cy);
    if (d < 1.4 || (d < 2.2 && bay(x + 1, y) < 0.55)) r.px(x, y, C.ember, 5);
    else if (d < 5.2 && bay(x, y) < Math.pow(1 - (d - 1.4) / 3.8, 1.8) * 0.75) r.px(x, y, C.ember, 5);
  }
  for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 9; x <= cx + 9; x++) if (r.get(x, y) === C.ember && Math.hypot((x - cx) / 1.5, y - cy) > 1.5) S.embers.push([x, y, (x * 5 + y * 11) % 17, C.ink]);
}

// ------------------------------------------------------------------------------------------------ the turf roof
function paintRoof(r, seed, S) {
  const rng = mulberry32(seed * 13 + 1);
  const L = 100, R = 288, base = 98;
  const top = (x) => {
    const u = (x - 194) / 96;
    const dome = Math.pow(Math.max(0, 1 - u * u), 0.55);
    return base - 21 * dome - (fbm(x * 0.07, 3, seed + 3, 3) - 0.5) * 10 + (vnoise(x * 0.4, 7, seed + 4) - 0.5) * 2;
  };
  // the sod: dark, mottled
  for (let x = L; x <= R; x++) {
    const t = top(x);
    for (let y = Math.floor(t); y <= base + 2; y++) {
      const v = 0.1 + fbm(x * 0.12, y * 0.2, seed + 8, 2) * 0.22 + smooth(L + 10, L + 70, x) * 0 + (y - t) * 0.004;
      r.px(x, y, rampAt(GREY, v, x, y), 5);
    }
  }
  // tussock: strokes rooted in the sod, fanning up and out; pale tips, dark roots
  const n = 900;
  for (let i = 0; i < n; i++) {
    const x0 = L + rng() * (R - L), t = top(Math.round(x0));
    if (x0 < L + 2 || x0 > R - 2) continue;
    const y0 = t + 2 + rng() * (base - t + 1), len = 4 + rng() * 6 * (0.6 + 0.4 * (1 - (y0 - t) / Math.max(4, base - t)));
    const ang = (rng() - 0.5) * 1.3 + (x0 - 192) * 0.004;
    const lit = (ang < 0 ? 0.1 : 0) + 0.14 * (1 - smooth(120, 260, x0));
    const bone = rng() < 0.6;
    for (let s = 0; s < len; s++) {
      const u = s / len, px = Math.round(x0 + Math.sin(ang) * s * 0.9 + ang * s * s * 0.06), py = Math.round(y0 - s * 0.95);
      if (py < t - 7) break;
      r.px(px, py, rampAt(GREY, clamp(0.12 + u * (bone ? 0.95 : 0.62) + lit + (rng() - 0.5) * 0.12 - (y0 - t < 3 ? 0.1 : 0), 0, 1), px, py), 5);
    }
  }
  // hummocks of long grass along the crown and the edges, so the silhouette is broken and the sod has bulk
  for (let i = 0; i < 46; i++) {
    const x = L + 4 + hash2f(i, 1, seed + 20) * (R - L - 8), t = top(Math.round(x));
    tuft(r, Math.round(x), Math.round(t + 3 + hash2f(i, 2, seed + 20) * 4), 5 + hash2f(i, 3, seed + 20) * 6, seed + 21 + i * 3, 5, { lean: (x - 194) * 0.004, tipTone: 0.8 });
  }
  // ragged overhang: dark strands falling over the top of the wall, and the shadow they cast
  for (let x = L - 4; x <= R + 4; x++) {
    if (hash2f(x, 5, seed + 9) < 0.62) continue;
    const len = 2 + Math.floor(hash2f(x, 6, seed + 9) * 5), t = base + 1 + (x < L + 4 || x > R - 4 ? 3 : 0);
    for (let s = 0; s < len; s++) r.px(x + Math.round(s * 0.2 * (x > 192 ? 1 : -1)), t + s, s < len - 1 ? C.ink : bay(x, s) < 0.5 ? C.char : C.ink, 5);
  }
  for (let x = L - 6; x <= R + 6; x++) for (let k = 0; k < 4; k++) {
    const y = base + 2 + k;
    if (r.layer(x, y) === 5 && bay(x, y) < 0.8 - k * 0.18) r.px(x, y, sinkG(sinkG(r.get(x, y))), 5);
  }
  // old snow lying in the crown of the turf
  for (const [sx, sy, rx, ry] of [[166, 84, 9, 2.4], [226, 81, 7, 2], [196, 78, 5, 1.6]]) {
    for (let y = Math.floor(sy - ry - 1); y <= sy + ry + 1; y++) for (let x = Math.floor(sx - rx - 1); x <= sx + rx + 1; x++) {
      const d = Math.hypot((x - sx) / rx, (y - sy) / ry) + (vnoise(x * 0.3, y * 0.4, seed + 15) - 0.5) * 0.5;
      if (d < 1 && r.layer(x, y) === 5) r.px(x, y, bay(x, y) < 0.8 - d * 0.5 ? (bay(x + 2, y + 1) < 0.45 ? C.snow : C.fog) : C.rock, 5);
    }
  }
  // a pale slab breaking through the turf, and a rind of old snow
  shadedRock(r, { cx: 142, cy: 87, rx: 14, ry: 3.6, rot: -0.12, p: 4, planes: 2, rough: 0.5, bevel: 3, H: 4, light: LIGHT, elev: 0.5, tone: 0.55, contrast: 1.1, lichen: 1.0, lichenSize: [1, 2.4], layer: 5, seed: 141 });
  shadedRock(r, { cx: 236, cy: 84, rx: 10, ry: 3, rot: 0.1, p: 4, planes: 2, rough: 0.5, bevel: 3, H: 3, light: LIGHT, elev: 0.5, tone: 0.62, contrast: 1.1, lichen: 0.8, lichenSize: [1, 2.2], layer: 5, seed: 143 });
}

// ------------------------------------------------------------------------------------------------ foreground
/** A tall tussock: a fountain of long blades, pale at the tips, dark in the root; the blades behind it darker. */
function tussock(r, x, y, hgt, spread, n, seed) {
  const rng = mulberry32(seed);
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
    const dir = (rng() - 0.5) * 2, len = hgt * (0.35 + rng() * 0.65), bend = dir * spread * (0.4 + rng() * 0.8);
    const dark = pass === 0;
    if (dark !== (rng() < 0.3)) continue;
    const bx = x + (rng() - 0.5) * spread * 0.3;
    for (let s = 0; s < len; s++) {
      const u = s / len, px = Math.round(bx + bend * u * u + dir * 2 * u), py = Math.round(y - s * (1 - 0.25 * u * u));
      const v = clamp((dark ? 0.08 : 0.2) + u * (dark ? 0.35 : 0.72) + (dir < 0 ? 0.08 : -0.04) + (rng() - 0.5) * 0.12, 0, 1);
      r.px(px, py, rampAt(GREY, v, px, py), 5);
    }
  }
}

/** A cairn: flat stones stacked and offset, each a little different. */
function cairn(r, cx, base, widths, seed) {
  const rng = mulberry32(seed);
  let y = base;
  widths.forEach((w, i) => {
    const th = w * (0.36 + rng() * 0.2), off = (rng() - 0.5) * w * 0.25 + (i > 0 ? (rng() - 0.5) * 4 : 0), cy = y - th / 2;
    shadedRock(r, {
      cx: cx + off, cy, rx: w / 2, ry: th / 2, rot: (rng() - 0.5) * 0.16, p: 2.6 + rng() * 1.6, planes: 3, rough: 0.55, facet: 1.8, shear: (rng() - 0.5) * 0.3, bevel: Math.min(th * 0.5, 7), H: Math.min(th * 0.6, 8), light: LIGHT, elev: 0.5,
      tone: 0.3 + rng() * 0.25, contrast: 1.2, rim: 0.4, lichen: 1.3, lichenSize: [1.2, 3.4], cracks: w > 20 ? 1 : 0, base: 0.2, layer: 5, seed: seed + i * 11,
      shadow: i === 0 ? { sx: 0.7, sy: 0.22, dens: 0.8, layerMax: 5, baseY: base } : undefined,
    });
    y -= th * 0.82;
  });
}

function paintForeground(r, seed, S) {
  // ground cover: tussocks, bigger towards the viewer
  for (let y = GROUND + 20; y < 196; y += 3) {
    const k = (y - GROUND) / (H - GROUND), n = 2 + Math.round(k * 6);
    for (let i = 0; i < n; i++) {
      const x = Math.round(hash2f(i, y, seed + 70) * W), hgt = 3 + k * 9 * (0.5 + hash2f(i, y, seed + 71));
      if (r.get(x, y) === C.ink && r.layer(x, y) === 5) continue;
      tuft(r, x, y, hgt, seed + x * 3 + y, 4, { lean: -0.1, tipTone: 0.3 + 0.45 * (1 - smooth(0.55, 0.85, k)) });
    }
  }
  // the long grass either side of the door (behind the cairns)
  tussock(r, 98, 166, 58, 26, 80, seed + 1);
  tussock(r, 128, 163, 32, 17, 44, seed + 2);
  tussock(r, 296, 163, 38, 18, 50, seed + 3);
  // the stones
  cairn(r, 46, 173, [44, 36, 27, 18], seed + 10);
  cairn(r, 350, 172, [40, 33, 26, 18, 11], seed + 20);
  // a rounded standing stone, capped by a smaller one
  shadedRock(r, { cx: 306, cy: 152, rx: 16, ry: 17, rot: 0.04, p: 2.4, planes: 2, flat: 1, rough: 0.5, facet: 2.4, bevel: 14, H: 15, light: LIGHT, elev: 0.5, tone: 0.4, contrast: 1.1, lichen: 1.3, lichenSize: [1.4, 4], cracks: 1, base: 0, layer: 5, seed: seed + 30, shadow: { sx: 0.8, sy: 0.25, dens: 0.8, layerMax: 5 } });
  shadedRock(r, { cx: 308, cy: 130, rx: 9, ry: 6.5, rot: -0.1, p: 2.6, planes: 2, rough: 0.5, bevel: 6, H: 6, light: LIGHT, elev: 0.5, tone: 0.45, contrast: 1.1, lichen: 1.0, lichenSize: [1, 2.6], base: 0, layer: 5, seed: seed + 31 });
  // loose stones round the ruin
  for (const [x, y, rx, ry, sd] of [[88, 164, 12, 6, 41], [166, 166, 10, 5, 42], [252, 166, 13, 6, 43], [214, 168, 8, 4, 44]]) {
    shadedRock(r, { cx: x, cy: y, rx, ry, rot: (hash2f(sd, 1, seed) - 0.5) * 0.2, p: 2.8, planes: 3, rough: 0.6, facet: 2, bevel: ry, H: ry, light: LIGHT, elev: 0.5, tone: 0.34, contrast: 1.1, lichen: 1.0, lichenSize: [1, 2.6], base: 0, layer: 5, seed: seed + sd, shadow: { sx: 0.7, sy: 0.2, dens: 0.75, layerMax: 5 } });
  }
  tussock(r, 240, 169, 34, 18, 44, seed + 7);
  tussock(r, 70, 174, 22, 14, 26, seed + 4);
  tussock(r, 210, 175, 14, 10, 16, seed + 5);
  tussock(r, 372, 172, 24, 14, 28, seed + 6);
}

// ------------------------------------------------------------------------------------------------ the screen
export function paint(r, spec, S) {
  const seed = S.seed;
  paintGlen(r, seed);
  paintWalls(r, seed, S);
  paintDoor(r, seed, S);
  paintRoof(r, seed, S);
  paintForeground(r, seed, S);
  S.glints = collectGlints(r, { x: 100, y: 70, w: 190, h: 27 }, seed + 97, 0.3, 4).concat(collectGlints(r, { x: 0, y: 130, w: W, h: 40 }, seed + 98, 0.4, 3).filter((g) => r.layer(g[1], g[2]) === 4));
  paintFootPlate(r, 170);
  textClear(r, { x: 0, y: 186, w: W, h: 30 }, 0.5);
  textClear(r, { x: 56, y: 61, w: 272, h: 13 }, 0.3);
  paintTitleLogo(r, S);
  S.bands = makeMistBands(r.w, [{ y: 100, rows: 22, layerMax: 3, speed: 3, dens: 0.6 }, { y: 126, rows: 14, layerMax: 4, speed: -4, dens: 0.55 }], seed);
}
export function anim(r, spec, S, t) {
  pulseEmbers(r, S.embers, t);
  animGlints(r, S.glints, t);
  animMistBands(r, S.bands, t);
  animLogo(r, S.logo, t);
}
