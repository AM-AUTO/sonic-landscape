/**
 * Play-view HUD in the OS legend-margin style. Compact: the map is the star.
 */
import { PAL } from './palette.js';
import { drawText, measureText, wrapText } from './font.js';
import { rect, frame, hline, vline, pline, panel, px, clamp, pdisc, pcircle, pcircleDotted } from './draw.js';
import { iconSprite, iconMono, gateSprite, timeSprite, blit, artCanvas, touchIcon, arrowSprite, octantOf } from './sprites.js';
import { typeShort } from './glyphs.js';
import { CELL_PX, SCREEN_W, SCREEN_H, RESONANCE_SECONDS } from '../world/codes.js';
import { HUD, STORY, fmt } from '../text.js';

export const STRIP_H = 13;
const MINI = 48;

/** 6-figure grid reference, e.g. "NN 162 563", from a world and a cell position. */
export function gridRef(world, x, y) {
  const lv = world.level || {};
  const [e0, n0] = lv.gridOrigin || [0, 0];
  const cm = (world.cellMeters || 40) / 1000;
  const e = e0 + x * cm, n = n0 - y * cm;
  const d3 = (v) => String(((Math.floor(v * 10) % 1000) + 1000) % 1000).padStart(3, '0');
  return `${lv.gridLetters || ''} ${d3(e)} ${d3(n)}`.trim();
}

export function bearingDeg(heading) {
  return Math.round((((heading * 180) / Math.PI + 90) % 360 + 360) % 360) % 360;
}

function compass(ctx, x, y, heading) {
  // 9x9 dial with N tick, needle in magenta
  const cx = x + 4, cy = y + 4;
  const ring = [
    [3, 0], [4, 0], [5, 0], [2, 1], [6, 1], [1, 2], [7, 2], [0, 3], [8, 3], [0, 4], [8, 4], [0, 5], [8, 5], [1, 6], [7, 6], [2, 7], [6, 7], [3, 8], [4, 8], [5, 8],
  ];
  ctx.fillStyle = PAL.ink;
  for (const [a, b] of ring) ctx.fillRect(x + a, y + b, 1, 1);
  rect(ctx, cx - 0, y - 1, 1, 1, PAL.magenta);
  const ax = Math.cos(heading), ay = Math.sin(heading);
  pline(ctx, cx, cy, cx + ax * 3.4, cy + ay * 3.4, PAL.magenta);
  px(ctx, cx, cy, PAL.ink);
}

const STRIP_GAP = 6;

/** Which right-hand strip items fit beside the level name. Pure measurement, shared with tests. */
export function stripLayout(st, R) {
  const w = st.world, p = st.player, lv = (w && w.level) || st.level || {};
  const name = String(lv.name || '').toUpperCase();
  const sub = String(lv.subtitle || '').toUpperCase();
  const x = 4 + measureText(name, {}) + 5;
  let rEnd = SCREEN_W - 3;
  if (R && R.touchLeft) rEnd = Math.min(rEnd, R.touchLeft - 4);
  const limit = x + (sub ? measureText(sub, { font: 'small' }) : 0) + 4;
  const brg = String(bearingDeg(p.heading || 0)).padStart(3, '0') + '°';
  const alt = fmt(HUD.altitude, { n: Math.round(p.elevation || 0) });
  const ref = gridRef(w, p.x, p.y);
  const widths = { ref: measureText(ref, {}), alt: measureText(alt, {}), brg: 9 + 2 + measureText(brg, {}), time: 9 };
  let avail = rEnd - limit;
  const use = [];
  for (const k of ['ref', 'alt', 'brg', 'time']) {
    const need = widths[k] + (use.length ? STRIP_GAP : 0);
    if (need <= avail) { use.push(k); avail -= need; }
  }
  return { name, sub, x, limit, rEnd, brg, alt, ref, widths, use };
}

export function drawStrip(ctx, st, ui, R) {
  const p = st.player;
  rect(ctx, 0, 0, SCREEN_W, STRIP_H, PAL.paper);
  hline(ctx, 0, STRIP_H - 1, SCREEN_W, PAL.ink);
  // ruler ticks inside the border
  ctx.fillStyle = PAL.grid;
  for (let i = 0; i < SCREEN_W; i += 8) ctx.fillRect(i, STRIP_H - 3 + (i % 32 === 0 ? -1 : 0), 1, 2 + (i % 32 === 0 ? 1 : 0));
  // left: name + subtitle; right cluster kept clear of touch buttons, dropping the least important items if space is short
  const L = stripLayout(st, R);
  drawText(ctx, L.name, 4, 2, PAL.ink, {});
  if (L.sub) drawText(ctx, L.sub, L.x, 4, PAL.contourIdx, { font: 'small' });
  const phase = st.phase || 'day';
  const draws = {
    ref: (X) => drawText(ctx, L.ref, X, 3, PAL.waterInk, {}),
    alt: (X) => drawText(ctx, L.alt, X, 3, PAL.ink, {}),
    brg: (X) => { compass(ctx, X, 2, p.heading || 0); drawText(ctx, L.brg, X + 11, 3, PAL.ink, {}); },
    time: (X) => blit(ctx, timeSprite(phase), X, 2),
  };
  let rx = L.rEnd;
  for (const k of ['time', 'brg', 'alt', 'ref']) {
    if (!L.use.includes(k)) continue;
    rx -= L.widths[k];
    draws[k](rx);
    rx -= STRIP_GAP;
  }
}

function drawMinimap(ctx, st, R) {
  const mini = R.mini;
  if (!mini) return;
  const x = SCREEN_W - MINI - 4, y = Math.max(STRIP_H + 3, R.miniY || 0);
  rect(ctx, x - 1, y - 1, MINI + 2, MINI + 2, PAL.paper);
  frame(ctx, x - 2, y - 2, MINI + 4, MINI + 4, PAL.ink);
  ctx.drawImage(mini, x, y);
  const w = st.world, p = st.player;
  const mapPx = w.size * CELL_PX;
  const f = MINI / w.size;
  // viewport rectangle
  const vw = Math.max(3, Math.round((SCREEN_W / mapPx) * MINI)), vh = Math.max(2, Math.round((SCREEN_H / mapPx) * MINI));
  const vx = Math.round(p.x * f - vw / 2), vy = Math.round(p.y * f - vh / 2);
  const cvx = clamp(vx, 0, MINI - vw), cvy = clamp(vy, 0, MINI - vh);
  frame(ctx, x + cvx, y + cvy, vw, vh, PAL.snow);
  // discovered pois
  const disc = new Set(st.discovered || []);
  for (const poi of w.pois || []) {
    if (!disc.has(poi.id)) continue;
    rect(ctx, x + Math.round(poi.x * f) - 1, y + Math.round(poi.y * f) - 1, 2, 2, PAL.magenta);
  }
  // gate
  if (w.gate) {
    const gx = clamp(Math.round(w.gate.x * f), 1, MINI - 2), gy = clamp(Math.round(w.gate.y * f), 1, MINI - 2);
    const open = !!st.gateOpen;
    rect(ctx, x + gx - 1, y + gy - 1, 3, 3, open ? PAL.snow : PAL.magenta);
    px(ctx, x + gx, y + gy, PAL.ink);
  }
  // player
  const blink = Math.floor((R.clock || 0) * 3) % 2 === 0;
  const ppx = Math.round(p.x * f), ppy = Math.round(p.y * f);
  rect(ctx, x + ppx - 1, y + ppy - 1, 3, 3, PAL.ink);
  px(ctx, x + ppx, y + ppy, blink ? PAL.snow : PAL.magenta);
}

// ======================================================================= scroll banner
// Knight-Lore-style parchment scroll along the foot of the screen: black fill, 1 px line art in the
// track's accent colour, a rolled scroll end in each corner, long diagonals running down to the
// centre, where DAY (flame) over the day number (white) sits between two curls. Left: the key bar.
// Right: a window with the sun or moon, and the resting text beside it.
export const SCROLL_H = 36;                      // rows reserved at the foot of the screen
export const SCROLL_Y = SCREEN_H - SCROLL_H;     // top of the corner rolls
export const SCROLL = Object.freeze({
  roll: 13,                                       // width of a corner roll
  drop: 13,                                       // how far the diagonals fall to the centre
  notch: 14,                                      // half-width of the central notch (curls + day block)
  vertexY: SCROLL_Y + 13,
  centreX: SCREEN_W / 2,
});
export const CELL_H = 22;                         // key-bar cell: icon row, label row, status row
export const CHAIN_W = 27, GATE_W = 32, CHEV = 3;
export const DRAIN_W = 11;                       // seconds-left bar in row three (1 px frame each side, label 3 px after)
export const KEYBAR = Object.freeze({
  x0: 17, y: SCROLL_Y + 13, h: CELL_H,
  labelW: CHAIN_W,                                // widest label / status line a chain cell takes
  limit: SCREEN_W / 2 - SCROLL.notch - 8,         // the key bar must end before the curls
});
export const WINDOW = Object.freeze({ w: 36, h: 24, y: SCREEN_H - 26, right: SCREEN_W - 15 });

/** Cells of the key bar for a chain of n artefacts (+ the bealach cell). Pure geometry, shared with tests. */
export function keyBarLayout(n) {
  const cells = [];
  let x = KEYBAR.x0;
  for (let i = 0; i < n; i++) { cells.push({ x, y: KEYBAR.y, w: CHAIN_W, h: CELL_H }); x += CHAIN_W + CHEV; }
  const gate = { x, y: KEYBAR.y, w: GATE_W, h: CELL_H };
  return { cells, gate, end: gate.x + gate.w };
}

/** y of the scroll's top line at column x (the diagonals; flat on the rolls and in the notch). */
export function scrollTop(x) {
  const xl = SCROLL.roll - 1, xr = SCREEN_W - SCROLL.roll;
  const c = SCROLL.centreX, nl = c - SCROLL.notch, nr = c + SCROLL.notch - 1;
  if (x <= xl || x >= xr) return SCROLL_Y;
  if (x >= nl && x <= nr) return SCROLL.vertexY;
  if (x < nl) return SCROLL_Y + Math.round(((x - xl) / (nl - xl)) * SCROLL.drop);
  return SCROLL_Y + Math.round(((xr - x) / (xr - nr)) * SCROLL.drop);
}

/** The track's signature hue (a palette name) from palette.accent; magenta when unset or unknown. */
export function accentName(st) {
  const lv = (st && ((st.world && st.world.level) || st.level)) || {};
  const a = lv.palette && lv.palette.accent;
  return a && PAL[a] ? a : 'magenta';
}
export function accentOf(st) { return PAL[accentName(st)]; }

// corner roll, 13 wide, 'a' = accent line (drawn mirrored on the right)
const ROLL_TOP = [
  '..aaaaaaaaa..',
  '.a..aaaaa..a.',
  'a..a.....a..a',
  'a.a..aaa..a.a',
  'a.a.a...a.a.a',
  '.a..a.a.a.a..',
  '.a...aa.a.a..',
  '.a......a.a..',
];
const ROLL_BOT = [
  '.a.......a.a.',
  '.a.......a.a.',
  'a.a.....a..a.',
  'a..aaaaa..a.a',
  '.a.......a..a',
  '..aaaaaaaa.a.',
];
function drawRoll(ctx, left, color) {
  const W = 13;
  ctx.fillStyle = color;
  const put = (art, y0) => art.forEach((row, j) => { for (let i = 0; i < W; i++) if (row[i] === 'a') ctx.fillRect(left ? i : SCREEN_W - 1 - i, y0 + j, 1, 1); });
  put(ROLL_TOP, SCROLL_Y);
  put(ROLL_BOT, SCREEN_H - ROLL_BOT.length);
  const y0 = SCROLL_Y + ROLL_TOP.length, y1 = SCREEN_H - ROLL_BOT.length;
  for (const x of [0, 2, 9, 11]) ctx.fillRect(left ? x : SCREEN_W - 1 - x, y0, 1, y1 - y0);
}

// curl where each diagonal ends beside the day block (the right one is mirrored)
const CURL = [
  'aaaaaa.',
  '.....a.',
  '..aa.a.',
  '.a..aa.',
  '.a.a...',
  '.a..a..',
  '..aa...',
];
function drawCurl(ctx, left, color) {
  const x0 = SCROLL.centreX - SCROLL.notch - 6, y0 = SCROLL.vertexY;
  ctx.fillStyle = color;
  CURL.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === 'a') ctx.fillRect(left ? x0 + i : SCREEN_W - 1 - (x0 + i), y0 + j, 1, 1);
  });
}

// ---- the window: a sun or moon crossing it as the day goes
const SUN_ART = [
  '....L....',
  '.L..f..L.',
  '..fffff..',
  '..fffff..',
  'LffffwffL',
  '..fffff..',
  '..fffff..',
  '.L..f..L.',
  '....L....',
];
const SUN_LOW_ART = [
  '.........',
  '..L.L.L..',
  '...LfL...',
  '..LfffL..',
  '.LfffffL.',
  'LfffwfffL',
  '.........',
  '.........',
  '.........',
];
const MOON_ART = [
  '..sswww..',
  '.swww....',
  'swww.....',
  'swww.....',
  'swww.....',
  'swww.....',
  '.swwww...',
  '..swwwww.',
  '...ssss..',
];
function sunMoonSprite(night, low) {
  if (night) return artCanvas('hud-moon', MOON_ART);
  return low ? artCanvas('hud-sun-low', SUN_LOW_ART) : artCanvas('hud-sun', SUN_ART);
}

function drawWindow(ctx, st, accent, wx, clock) {
  const { w, h, y } = WINDOW;
  const x = wx - w;
  // frame with clipped corners and little studs, as the red window in the reference
  rect(ctx, x, y, w, h, PAL.ink);
  ctx.fillStyle = accent;
  ctx.fillRect(x + 2, y, w - 4, 1); ctx.fillRect(x + 2, y + h - 1, w - 4, 1);
  ctx.fillRect(x, y + 2, 1, h - 4); ctx.fillRect(x + w - 1, y + 2, 1, h - 4);
  for (const [a, b] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) ctx.fillRect(x + a, y + b, 1, 1);
  ctx.fillRect(x + 3, y + 2, w - 6, 1); ctx.fillRect(x + 3, y + h - 3, w - 6, 1);
  const ix = x + 3, iy = y + 3, iw = w - 6, ih = h - 6;
  const tod = ((st.timeOfDay || 0) % 1 + 1) % 1;
  const night = tod >= 0.5;
  const f = night ? (tod - 0.5) * 2 : tod * 2;
  const a = clamp(f, 0.04, 0.96) * Math.PI;
  const cx = ix + iw / 2 - Math.cos(a) * (iw / 2 - 4);
  const cy = iy + ih - 6 - Math.sin(a) * (ih - 9);
  if (night) {
    ctx.fillStyle = PAL.dusk;
    for (const [sx, sy] of [[4, 2], [10, 7], [24, 3], [27, 9], [16, 1], [20, 10]]) if (((sx * 7 + sy + Math.floor(clock * 1.3)) % 5) !== 0) ctx.fillRect(ix + sx, iy + sy, 1, 1);
  }
  const low = !night && (f < 0.16 || f > 0.84);
  const spr = sunMoonSprite(night, low);
  ctx.save();
  ctx.beginPath(); ctx.rect(ix, iy, iw, ih - 1); ctx.clip();
  ctx.drawImage(spr, Math.round(cx - 4), Math.round(cy - 4));
  ctx.restore();
  hline(ctx, ix, iy + ih - 1, iw, PAL.rock);   // the ground line
}

/** Resting text block beside the window: its width (kept in step with tests/text.test.js). */
export const RESTING_W = 52;
export const RESTING_LABEL_X = 0;

function windowRight(R) {
  return R.touchBottomLeft ? Math.min(WINDOW.right, R.touchBottomLeft - 4) : WINDOW.right;
}

function drawRightZone(ctx, st, accent, R) {
  const clock = R.clock || 0;
  const wx = windowRight(R);
  drawWindow(ctx, st, accent, wx, clock);
  const p = st.player;
  if (p && p.resting) {
    const x = wx - WINDOW.w - 6 - RESTING_W + RESTING_LABEL_X, y = WINDOW.y + 5;
    const dots = '.'.repeat(1 + (Math.floor(clock * 2) % 3));
    const labW = drawText(ctx, HUD.resting, x, y, PAL.snow, { font: 'small', spacing: 0 });
    drawText(ctx, dots, x + labW + 1, y, accent, { font: 'small' });
    drawText(ctx, HUD.timeSpeed, x, y + 9, PAL.rock, { font: 'small' });
    if (Math.floor(clock * 3) % 2 === 0) px(ctx, x + RESTING_W - 3, y + 1, accent);
  }
}

function drawDay(ctx, st) {
  const day = String(Math.max(1, (st.day | 0) || 1));
  const cx = SCROLL.centreX;
  drawText(ctx, STORY.dayLabel, cx, SCROLL.vertexY + 4, PAL.flame, { font: 'small', align: 'center', spacing: 1 });
  drawText(ctx, day, cx, SCROLL.vertexY + 12, PAL.snow, { align: 'center' });
}

/** km text for a distance in cells (40 m per cell). */
function kmText(dist) {
  if (!(dist > 3)) return HUD.here;
  return fmt(HUD.km, { km: (dist * 0.04).toFixed(1) });
}

function drainBar(ctx, x, y, w, frac, secs, accent) {
  const f = clamp(frac, 0, 1);
  rect(ctx, x, y, w, 4, PAL.night);
  const bw = Math.max(f > 0 ? 1 : 0, Math.round(w * f));
  rect(ctx, x, y, bw, 4, f > 0.25 ? accent : PAL.lamp);
  frame(ctx, x - 1, y - 1, w + 2, 6, PAL.rock);
  drawText(ctx, fmt(HUD.seconds, { n: Math.max(0, Math.ceil(secs)) }), x + w + 3, y - 1, PAL.snow, { font: 'small' });
}

const centred = (cell, text) => cell.x + Math.round((cell.w - measureText(text, { font: 'small' })) / 2);

function drawKeyBar(ctx, st, accent, R) {
  const w = st.world;
  const chain = st.chainProgress || [];
  const res = st.resonance || [];
  const p = st.player;
  const clock = R.clock || 0;
  if (!chain.length) return;
  const L = keyBarLayout(chain.length);
  const allLit = chain.every((c) => c.resonating);
  chain.forEach((c, i) => {
    const cell = L.cells[i];
    const lit = !!c.resonating;
    const bx = cell.x, by = cell.y;
    // icon tile: paper, so the OS legend symbol reads on black
    rect(ctx, bx, by, 10, 10, lit ? PAL.paper : PAL.paper2);
    frame(ctx, bx, by, 10, 10, lit ? accent : PAL.rock);
    ctx.drawImage(iconSprite(c.type, true), bx + 1, by + 1);
    if (lit && Math.floor(clock * 2 + i) % 2 === 0) px(ctx, bx + 9, by, PAL.snow);
    // row one, right: dowsing arrow to the nearest of that type, or a spark while it sounds
    let dist = null;
    if (!lit && c.nearest) {
      const n = c.nearest;
      const brg = n.bearing != null ? n.bearing : Math.atan2(n.y - p.y, n.x - p.x);
      dist = n.dist != null ? n.dist : Math.hypot(n.x - p.x, n.y - p.y);
      if (dist > 3) ctx.drawImage(arrowSprite(octantOf(brg), accent), bx + 14, by + 1);
      else if (Math.floor(clock * 3) % 2 === 0) rect(ctx, bx + 16, by + 3, 3, 3, accent);
    } else if (lit) {
      ctx.fillStyle = Math.floor(clock * 3 + i) % 2 ? PAL.flame : PAL.lamp;
      ctx.fillRect(bx + 17, by + 3, 1, 5); ctx.fillRect(bx + 15, by + 5, 5, 1); ctx.fillRect(bx + 16, by + 4, 3, 3);
    }
    // row two: label
    const lab = typeShort(c.type);
    drawText(ctx, lab, centred(cell, lab), by + 11, lit ? PAL.snow : PAL.rock, { font: 'small' });
    // row three: seconds left (bar) or distance
    if (lit) {
      let secs = c.remaining;
      if (secs == null) { const r = res.find((q) => q.type === c.type); secs = r ? (r.strength == null ? 1 : r.strength) * RESONANCE_SECONDS : 0; }
      drainBar(ctx, bx + 1, by + 18, DRAIN_W, secs / RESONANCE_SECONDS, secs, accent);
    } else if (dist != null) {
      const t = kmText(dist);
      drawText(ctx, t, centred(cell, t), by + 17, PAL.paper2, { font: 'small' });
    } else {
      hline(ctx, bx + 9, by + 19, 8, PAL.rock);
    }
    // connector chevron
    const next = chain[i + 1];
    ctx.fillStyle = (lit && (next ? next.resonating : st.gateOpen)) ? accent : PAL.rock;
    ctx.fillRect(bx + cell.w, by + 4, 1, 3); ctx.fillRect(bx + cell.w + 1, by + 5, 1, 1);
  });
  // bealach cell
  const g = L.gate, open = !!st.gateOpen, gate = w && w.gate;
  if (open && Math.floor(clock * 3) % 2 === 0) frame(ctx, g.x - 1, g.y - 1, 13, 12, PAL.snow);
  else if (!open && allLit) frame(ctx, g.x - 1, g.y - 1, 13, 12, accent);
  rect(ctx, g.x, g.y, 11, 10, PAL.paper2);
  ctx.drawImage(gateSprite(open), g.x, g.y);
  drawText(ctx, HUD.gate, centred(g, HUD.gate), g.y + 11, open ? accent : PAL.snow, { font: 'small' });
  if (open) {
    drawText(ctx, HUD.gateOpen, centred(g, HUD.gateOpen), g.y + 17, accent, { font: 'small' });
  } else if (gate && p) {
    const dx = gate.x - p.x, dy = gate.y - p.y, dist = Math.hypot(dx, dy);
    if (dist > 3) ctx.drawImage(arrowSprite(octantOf(Math.atan2(dy, dx)), allLit ? accent : PAL.waterDeep), g.x + 14, g.y + 1);
    const t = kmText(dist);
    drawText(ctx, t, centred(g, t), g.y + 17, PAL.paper2, { font: 'small' });
  }
}

/** Artefacts sounding that are not part of the key: a slim row above the scroll. */
function drawExtras(ctx, st) {
  const chain = st.chainProgress || [], res = st.resonance || [];
  const extra = res.filter((r) => !chain.some((c) => c.type === r.type));
  if (!extra.length) return;
  const rw = 6 + extra.length * 14, rh = 14;
  const y = SCROLL_Y - rh - 2;
  panel(ctx, 4, y, rw, rh, {});
  let ix = 7;
  for (const r of extra) {
    const s = clamp(r.strength == null ? 1 : r.strength, 0, 1);
    ctx.drawImage(iconSprite(r.type, true), ix, y + 2);
    rect(ctx, ix, y + 11, 8, 2, PAL.rock);
    rect(ctx, ix, y + 11, Math.max(s > 0 ? 1 : 0, Math.round(8 * s)), 2, s > 0.25 ? PAL.magenta : PAL.contourIdx);
    ix += 14;
  }
}

/** The whole scroll: fill, line art, key bar, day block, window. */
export function drawScroll(ctx, st, ui, R) {
  const accent = accentOf(st);
  ctx.fillStyle = PAL.ink;                         // black fill below the top line (the map shows above the diagonals)
  let x = 0;
  while (x < SCREEN_W) {
    const y = scrollTop(x);
    let x2 = x + 1;
    while (x2 < SCREEN_W && scrollTop(x2) === y) x2++;
    ctx.fillRect(x, y, x2 - x, SCREEN_H - y);
    x = x2;
  }
  const xl = SCROLL.roll - 1, xr = SCREEN_W - SCROLL.roll;
  const nl = SCROLL.centreX - SCROLL.notch, nr = SCROLL.centreX + SCROLL.notch - 1;
  pline(ctx, xl, SCROLL_Y, nl, SCROLL.vertexY, accent);
  pline(ctx, xr, SCROLL_Y, nr, SCROLL.vertexY, accent);
  drawRoll(ctx, true, accent);
  drawRoll(ctx, false, accent);
  drawCurl(ctx, true, accent);
  drawCurl(ctx, false, accent);
  drawDay(ctx, st);
  drawKeyBar(ctx, st, accent, R);
  drawRightZone(ctx, st, accent, R);
  drawExtras(ctx, st);
}

// ---- banner layout (exported so tests/text.test.js can check the real text against the real boxes)
/** Widths and line limits of the three banner kinds. Text that needs more lines than allowed is cut, so tests forbid it. */
export const BANNER_BOX = Object.freeze({
  noteW: 250, noteLines: 4,                 // 'note': one wrapped paragraph
  partialW: 252, poeticLines: 2, plainLines: 3, // 'partial': title, italic poetic hint, plain instruction
  artefactMax: 272,                          // 'artefact': widest allowed box (title + 28 px of furniture); clears the minimap
  artefactSubLines: 2,
});

export function noteLayout(msg) {
  const lines = wrapText(String(msg), BANNER_BOX.noteW, { italic: false });
  return { lines, shown: lines.slice(0, BANNER_BOX.noteLines) };
}

export function partialLayout(title, sub, sub2) {
  const maxW = BANNER_BOX.partialW;
  const poeticAll = sub ? wrapText(String(sub), maxW, { italic: true }) : [];
  const plainAll = sub2 ? wrapText(String(sub2), maxW - 8, {}) : [];
  const poetic = poeticAll.slice(0, BANNER_BOX.poeticLines), plain = plainAll.slice(0, BANNER_BOX.plainLines);
  let lw = measureText(String(title).toUpperCase(), { spacing: 2 });
  for (const l of poetic) lw = Math.max(lw, measureText(l, { italic: true }));
  for (const l of plain) lw = Math.max(lw, measureText(l, {}) + 8);
  const bw = Math.min(maxW + 20, Math.max(150, lw + 20));
  const bh = 15 + poetic.length * 10 + (plain.length ? plain.length * 10 + 5 : 0) + 3;
  return { poetic, plain, poeticAll, plainAll, titleW: measureText(String(title).toUpperCase(), { spacing: 2 }), bw, bh };
}

/** Artefact banner: spaced title (wraps and tightens when long) with an optional small-caps sub-line (wraps to two). */
export function artefactLayout(title, sub) {
  const text = String(title).toUpperCase();
  const subT = sub ? String(sub).toUpperCase() : '';
  const inner = BANNER_BOX.artefactMax - 28;
  let spacing = 3, lines = [text];
  if (measureText(text, { spacing }) > inner) {
    spacing = 1;
    lines = wrapText(text, inner, { spacing });
  }
  const subLinesAll = subT ? wrapText(subT, inner, { font: 'small', spacing: 1 }) : [];
  const subLines = subLinesAll.slice(0, BANNER_BOX.artefactSubLines);
  const titleW = Math.max(...lines.map((l) => measureText(l, { spacing })));
  const subW = subLines.length ? Math.max(...subLines.map((l) => measureText(l, { font: 'small', spacing: 1 }))) : 0;
  const bw = Math.max(titleW, subW) + 28;
  const bh = (subLines.length ? 20 + subLines.length * 7 : 18) + (lines.length - 1) * 10;
  return { text, lines, spacing, titleW, subT, subLines, subLinesAll, subW, bw, bh };
}

function drawMessage(ctx, ui, R) {
  const msg = ui && ui.message;
  const rem = ui && ui.messageT;
  if (!msg || !(rem > 0)) return;
  const dur = ui.messageDur || 4;
  const kind = ui.messageKind || 'note';
  const elapsed = Math.max(0, dur - rem);
  const fade = rem < 0.35;
  const col = fade ? PAL.rock : PAL.ink;
  const y0 = STRIP_H + 5;
  if (kind === 'partial') {
    // STILL SLEEPIN: muted contour-brown banner. Title, poetic hint (italic), plain instruction (main font, wrapped).
    const title = String(msg).toUpperCase();
    const { poetic, plain, bw, bh } = partialLayout(title, ui.messageSub, ui.messageSub2);
    const x = Math.round(SCREEN_W / 2 - bw / 2);
    const band = fade ? PAL.rock : PAL.contourIdx, edge = fade ? PAL.rock : PAL.contour;
    panel(ctx, x, y0, bw, bh, { fill: PAL.paper2, border: PAL.contourIdx });
    rect(ctx, x + 1, y0 + 1, bw - 2, 12, band);
    drawText(ctx, title, x + 8, y0 + 3, PAL.snow, { spacing: 2 });
    rect(ctx, x + 1, y0 + 13, 3, bh - 14, edge);
    let ty = y0 + 17;
    for (const l of poetic) { drawText(ctx, l, x + 9, ty, fade ? PAL.rock : PAL.contourIdx, { italic: true }); ty += 10; }
    if (plain.length) {
      hline(ctx, x + 9, ty - 1, bw - 18, PAL.contour);
      ty += 3;
      plain.forEach((l, i) => {
        if (i === 0) drawText(ctx, '>', x + 8, ty, PAL.magenta, {});
        drawText(ctx, l, x + 16, ty, col, {});
        ty += 10;
      });
    }
  } else if (kind === 'artefact') {
    const { text, lines, spacing, subLines, bw, bh } = artefactLayout(msg, ui.messageSub);
    let left = Math.min(text.length, Math.floor(elapsed * 40) + 1);   // typewriter reveal across all lines
    const x = Math.round(SCREEN_W / 2 - bw / 2);
    panel(ctx, x, y0, bw, bh, { fill: PAL.paper, inner: null });
    rect(ctx, x + 1, y0 + 1, bw - 2, 2, fade ? PAL.rock : PAL.magenta);
    // end ticks
    rect(ctx, x + 5, y0 + 8, 3, 1, fade ? PAL.rock : PAL.magenta);
    rect(ctx, x + bw - 8, y0 + 8, 3, 1, fade ? PAL.rock : PAL.magenta);
    lines.forEach((l, i) => {
      const shown = l.slice(0, Math.max(0, left));
      left -= l.length + 1;
      if (!shown) return;
      const lx = Math.round(SCREEN_W / 2 - measureText(l, { spacing }) / 2);
      drawText(ctx, shown, lx, y0 + 5 + i * 10, col, { spacing });
    });
    subLines.forEach((l, i) => {
      drawText(ctx, l, SCREEN_W / 2, y0 + 17 + (lines.length - 1) * 10 + i * 7, fade ? PAL.rock : PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
    });
  } else {
    const lines = noteLayout(msg).shown;
    const lw = Math.max(...lines.map((l) => measureText(l, {})));
    const bw = lw + 16, bh = lines.length * 10 + 7;
    const x = Math.round(SCREEN_W / 2 - bw / 2);
    panel(ctx, x, y0, bw, bh, { fill: PAL.paper2 });
    rect(ctx, x + 1, y0 + 1, 3, bh - 2, fade ? PAL.rock : PAL.magenta);
    lines.forEach((l, i) => drawText(ctx, l, x + 9, y0 + 4 + i * 10, col, {}));
  }
}

/** Virtual stick + buttons. Client-pixel input rects are mapped to framebuffer px via the canvas rect. */
function drawTouch(ctx, ui, R) {
  const t = ui && ui.touch;
  if (!t || !ui.touchVisible || !R.canvas || !R.canvas.getBoundingClientRect) return;
  const rc = R.canvas.getBoundingClientRect();
  if (!rc.width || !rc.height) return;
  const kx = SCREEN_W / rc.width, ky = SCREEN_H / rc.height;
  const fx = (v) => (v - rc.left) * kx, fy = (v) => (v - rc.top) * ky;
  const s = t.stick;
  if (s) {
    const rad = Math.max(10, Math.round(s.radius * kx));
    if (s.active) {
      const cx = Math.round(fx(s.cx)), cy = Math.round(fy(s.cy));
      pcircle(ctx, cx, cy, rad, PAL.ink);
      pcircle(ctx, cx, cy, rad - 1, PAL.paper);
      pcircleDotted(ctx, cx, cy, Math.round(rad * 0.55), PAL.grid);
      const kn = Math.max(4, Math.round(rad * 0.36));
      const kxp = Math.round(cx + s.x * rad), kyp = Math.round(cy + s.y * rad);
      pdisc(ctx, kxp, kyp, kn + 1, PAL.ink);
      pdisc(ctx, kxp, kyp, kn, PAL.magenta);
      px(ctx, kxp - 1, kyp - 2, PAL.snow);
      // N/E/S/W ticks
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(cx, cy - rad - 3, 1, 2); ctx.fillRect(cx, cy + rad + 2, 1, 2); ctx.fillRect(cx - rad - 3, cy, 2, 1); ctx.fillRect(cx + rad + 2, cy, 2, 1);
    } else {
      // faint idle hint, bottom-left
      const cx = Math.round(rad + 18), cy = SCREEN_H - rad - 18;
      const ph = Math.floor((R.clock || 0) * 4);
      pcircleDotted(ctx, cx, cy, rad, PAL.rock, ph);
      pcircleDotted(ctx, cx, cy, Math.round(rad * 0.5), PAL.rock, -ph);
      pdisc(ctx, cx, cy, 2, PAL.rock);
      drawText(ctx, HUD.touchStick, cx, cy + rad + 4, PAL.rock, { font: 'small', align: 'center' });
    }
  }
  for (const b of t.buttons || []) {
    const x = Math.round(fx(b.x)), y = Math.round(fy(b.y)), w = Math.max(14, Math.round(b.w * kx)), h = Math.max(12, Math.round(b.h * ky));
    const held = !!b.held;
    rect(ctx, x + 1, y + 1, w, h, PAL.night);
    rect(ctx, x, y, w, h, held ? PAL.magenta : PAL.paper);
    frame(ctx, x, y, w, h, PAL.ink);
    const sc = Math.max(1, Math.min(3, Math.floor((Math.min(w, h) - 4) / 9)));
    const ic = touchIcon(b.id, held ? PAL.snow : PAL.ink);
    ctx.drawImage(ic, Math.round(x + (w - 9 * sc) / 2), Math.round(y + (h - 9 * sc) / 2), 9 * sc, 9 * sc);
    const cap = b.id === 'run' ? HUD.touchRun : HUD.touchRest;
    if (h >= 22 && (b.id === 'run' || b.id === 'rest') && measureText(cap, { font: 'small' }) <= w - 4) drawText(ctx, cap, x + w / 2, y + h - 7, held ? PAL.snow : PAL.contourIdx, { font: 'small', align: 'center' });
  }
}

/** Full HUD. R = { mini, clock } from the renderer. */
export function drawHud(ctx, st, ui, R) {
  R.miniY = 0; R.touchLeft = 0; R.touchBottomLeft = 0;
  if (ui && ui.touchVisible && ui.touch && ui.touch.buttons && R.canvas && R.canvas.getBoundingClientRect) {
    const rc = R.canvas.getBoundingClientRect();
    if (rc.height) for (const b of ui.touch.buttons) {
      const bot = ((b.y + b.h) - rc.top) * (SCREEN_H / rc.height);
      if (bot < SCREEN_H * 0.4) {
        R.miniY = Math.max(R.miniY, Math.ceil(bot) + 4);
        const lx = (b.x - rc.left) * (SCREEN_W / rc.width);
        if (bot > 2 && (!R.touchLeft || lx < R.touchLeft)) R.touchLeft = Math.floor(lx);
      } else if (bot > SCREEN_H * 0.7) {
        // buttons low on the screen sit over the scroll's right end: the window keeps clear of them
        const lx = (b.x - rc.left) * (SCREEN_W / rc.width);
        if (!R.touchBottomLeft || lx < R.touchBottomLeft) R.touchBottomLeft = Math.floor(lx);
      }
    }
  }
  drawStrip(ctx, st, ui, R);
  if (!ui || ui.showMinimap !== false) drawMinimap(ctx, st, R);
  drawScroll(ctx, st, ui, R);
  drawMessage(ctx, ui, R);
  drawTouch(ctx, ui, R);
}
