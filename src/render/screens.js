/**
 * Full-screen scenes: title, select (track list), pause, map, notes, complete.
 * Each takes an env { R, ctx, state, ui, t, since, SW, SH } from the renderer.
 */
import { PAL, PAL_U32 as U, BAYER4 } from './palette.js';
import { drawText, measureText, wrapText } from './font.js';
import { rect, frame, hline, vline, pline, panel, px, ditherRect, clamp, ruler, pcircle } from './draw.js';
import { typeLabel, typeShort, glyphFor } from './glyphs.js';
import { iconSprite, gateSprite, padlockSprite, symbolSprite, walkerSprite, blit, artCanvas, MAP_SYMBOLS, tickSprite } from './sprites.js';
import { ARTEFACT_NAMES, POI_TYPES, CELL_PX } from '../world/codes.js';
import { gridRef, bearingDeg } from './hud.js';
import { gatePlacement } from './mapbake.js';
import { hash2f } from '../core/rng.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const TRACKS = [
  { id: 'rannoch', name: 'Rannoch Moor', gaelic: 'Mòinteach Raineach', gridLetters: 'NN', subtitle: 'I. The Moor', chain: ['lochan', 'cairn'] },
  { id: 'affric', name: 'Glen Affric', gaelic: 'Gleann Afraig', gridLetters: 'NH', subtitle: 'II. The Pinewood', chain: ['waterfall', 'lochan', 'bothy'] },
  { id: 'coe', name: 'Glen Coe', gaelic: 'Gleann Comhann', gridLetters: 'NN', subtitle: 'III. The Pass', chain: ['crag', 'stone', 'trig'] },
  { id: 'cairngorm', name: 'Cairngorm Plateau', gaelic: 'Am Monadh Ruadh', gridLetters: 'NJ', subtitle: 'IV. The Plateau', chain: ['lochan', 'summit', 'cairn'] },
  { id: 'torridon', name: 'Torridon', gaelic: 'Toirbheartan', gridLetters: 'NG', subtitle: 'V. The Sandstone', chain: ['waterfall', 'crag', 'summit', 'bothy'] },
  { id: 'cuillin', name: 'The Cuillin', gaelic: "A' Chuiltheann", gridLetters: 'NG', subtitle: 'VI. The Ridge', chain: ['crag', 'trig', 'lochan', 'stone'] },
  { id: 'assynt', name: 'Assynt', gaelic: 'Asaint', gridLetters: 'NC', subtitle: 'VII. The Stillness', chain: ['stone', 'lochan', 'summit'] },
  { id: 'nevis', name: 'Ben Nevis', gaelic: 'Beinn Nibheis', gridLetters: 'NN', subtitle: 'VIII. Homecoming', chain: ['waterfall', 'bothy', 'crag', 'summit'] },
];

const CHECK = [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]];
function check(ctx, x, y, color) { ctx.fillStyle = color; for (const [a, b] of CHECK) ctx.fillRect(x + a, y + b, 1, 1); }

function ticksBorder(ctx, SW, SH) {
  frame(ctx, 1, 1, SW - 2, SH - 2, PAL.ink);
  frame(ctx, 4, 4, SW - 8, SH - 8, PAL.grid);
}

function blink(t, rate = 1.6, duty = 0.62) { return ((t * rate) % 1) < duty; }

function levelList(ui) {
  const src = ui.levels && ui.levels.length ? ui.levels : TRACKS;
  return src.map((l, i) => ({
    id: l.id, name: l.name, gaelic: l.gaelic, gridLetters: l.gridLetters,
    subtitle: l.subtitle || (ROMAN[i] + '.'), chain: (l.gate && l.gate.chain) || l.chain || (TRACKS[i] && TRACKS[i].chain) || [],
  }));
}

// ================================================================= emblem
// A little animated OS-map extract: breathing hills, a lochan, wood, walker.
const EMB_W = 264, EMB_H = 88;
let emblem = null;
function buildEmblem() {
  const fields = [];
  const hills = [[70, 44, 34, 0.9], [150, 30, 30, 1.1], [215, 56, 26, 0.7], [110, 70, 22, 0.5]];
  for (const [cx, cy, r, a] of hills) {
    const g = new Float32Array(EMB_W * EMB_H);
    for (let y = 0; y < EMB_H; y++) for (let x = 0; x < EMB_W; x++) {
      const dx = (x - cx) / r, dy = (y - cy) / (r * 0.8);
      g[y * EMB_W + x] = Math.exp(-(dx * dx + dy * dy) * 0.8) * a;
    }
    fields.push(g);
  }
  const dip = new Float32Array(EMB_W * EMB_H);
  for (let y = 0; y < EMB_H; y++) for (let x = 0; x < EMB_W; x++) {
    const dx = (x - 112) / 20, dy = (y - 48) / 9;
    dip[y * EMB_W + x] = Math.exp(-(dx * dx + dy * dy)) * 0.5;
  }
  const noise = new Float32Array(EMB_W * EMB_H);
  for (let y = 0; y < EMB_H; y++) for (let x = 0; x < EMB_W; x++) {
    noise[y * EMB_W + x] = 0.5 + 0.25 * Math.sin(x * 0.11 + y * 0.07) + 0.25 * Math.sin(x * 0.05 - y * 0.13 + 1.3);
  }
  emblem = { fields, dip, noise, buf: new Uint32Array(EMB_W * EMB_H), h: new Float32Array(EMB_W * EMB_H), hills };
}

function drawEmblem(ctx, x0, y0, t) {
  if (!emblem) buildEmblem();
  const { fields, dip, noise, buf, h, hills } = emblem;
  const amps = hills.map((hl, i) => hl[3] * (1 + 0.16 * Math.sin(t * 0.6 + i * 1.9)));
  const f0 = fields[0], f1 = fields[1], f2 = fields[2], f3 = fields[3];
  const [a0, a1, a2, a3] = amps.map((a, i) => a / hills[i][3]);
  for (let i = 0; i < h.length; i++) h[i] = 0.2 + f0[i] * a0 + f1[i] * a1 + f2[i] * a2 + f3[i] * a3 - dip[i] * (0.9 + 0.1 * Math.sin(t));
  // ring from the central summit
  const rx = hills[1][0], ry = hills[1][1];
  const ringR = (t * 24) % 150;
  const BN = 15;
  const band = (v) => Math.floor(v * BN);
  for (let y = 0; y < EMB_H; y++) {
    for (let x = 0; x < EMB_W; x++) {
      const i = y * EMB_W + x, v = h[i];
      const th = (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
      let c;
      if (v < 0.2) c = U.water;
      else if (v > 1.12) c = U.snow;
      else if (noise[i] > 0.62 && v > 0.24 && v < 0.62) c = U.wood;
      else c = th < 0.05 + Math.min(0.5, v * 0.3) ? U.paper2 : U.paper;
      // contour test: lower-side pixel next to a higher band
      const b = band(v);
      let line = 0;
      if (x < EMB_W - 1 && band(h[i + 1]) > b) line = b;
      else if (y < EMB_H - 1 && band(h[i + EMB_W]) > b) line = b;
      else if (x > 0 && band(h[i - 1]) > b) line = b;
      else if (y > 0 && band(h[i - EMB_W]) > b) line = b;
      if (line && v >= 0.2 - 0.001 && b > 2) {
        const idx = ((b + 1) % 4) === 0;
        c = idx ? U.contourIdx : U.contour;
        if (v > 1.12) c = idx ? U.waterDeep : U.grid;
        const d = Math.hypot(x - rx, (y - ry) * 1.25);
        if (Math.abs(d - ringR) < 3.2) c = Math.abs(d - ringR) < 1.2 ? U.snow : U.magenta;
      } else if (v < 0.2 + 0.03 && v >= 0.2 - 0.001) c = U.waterDeep;
      buf[i] = c;
    }
  }
  const img = new ImageData(new Uint8ClampedArray(buf.buffer), EMB_W, EMB_H);
  ctx.putImageData(img, x0, y0);
}

// ================================================================== title
function title(env) {
  const { ctx, t, SW, SH, ui } = env;
  rect(ctx, 0, 0, SW, SH, PAL.paper);
  // faint 1km-style grid over the whole cover
  ctx.fillStyle = PAL.grid;
  for (let x = 12; x < SW; x += 24) for (let y = 0; y < SH; y += 2) ctx.fillRect(x, y, 1, 1);
  for (let y = 12; y < SH; y += 24) for (let x = 0; x < SW; x += 2) ctx.fillRect(x, y, 1, 1);
  // paper pane behind everything central
  rect(ctx, 8, 8, SW - 16, SH - 16, PAL.paper);
  ticksBorder(ctx, SW, SH);

  // header band
  rect(ctx, 6, 6, SW - 12, 46, PAL.magenta);
  hline(ctx, 6, 52, SW - 12, PAL.ink);
  ditherRect(ctx, 6, 44, SW - 12, 8, PAL.ink, 0.12);
  drawText(ctx, 'CONTOURS', SW / 2 + 3, 14 + 3, PAL.ink, { scale: 4, spacing: 1, align: 'center' });
  drawText(ctx, 'CONTOURS', SW / 2, 14, PAL.snow, { scale: 4, spacing: 1, align: 'center' });
  drawText(ctx, 'ALBUM EDITION', 12, 11, PAL.snow, { font: 'small', spacing: 1 });
  drawText(ctx, '1:25 000', SW - 12, 11, PAL.snow, { font: 'small', spacing: 1, align: 'right' });
  drawText(ctx, 'SHEETS I-VIII', 12, 17, PAL.paper2, { font: 'small', spacing: 1 });
  drawText(ctx, 'SONIC SURVEY', SW - 12, 17, PAL.paper2, { font: 'small', spacing: 1, align: 'right' });

  drawText(ctx, 'a playable album in eight glens', SW / 2, 58, PAL.ink, { italic: true, spacing: 1, align: 'center' });

  // emblem window
  const ex = Math.round((SW - EMB_W) / 2), ey = 72;
  frame(ctx, ex - 3, ey - 3, EMB_W + 6, EMB_H + 6, PAL.ink);
  frame(ctx, ex - 2, ey - 2, EMB_W + 4, EMB_H + 4, PAL.paper);
  drawEmblem(ctx, ex, ey, t);
  frame(ctx, ex - 1, ey - 1, EMB_W + 2, EMB_H + 2, PAL.grid);
  // walker strolling along a dashed path across the emblem
  const pathY = ey + EMB_H - 14;
  for (let x = ex + 2; x < ex + EMB_W - 2; x++) {
    const ph = x % 6;
    if (ph < 3) px(ctx, x, pathY + Math.round(Math.sin(x * 0.07) * 2), PAL.magenta);
    else if (ph === 4) px(ctx, x, pathY + Math.round(Math.sin(x * 0.07) * 2), PAL.ink);
  }
  const cycle = 14;
  const wx = ex + 8 + ((t % cycle) / cycle) * (EMB_W - 28);
  const wy = pathY + Math.round(Math.sin(wx * 0.07) * 2);
  blit(ctx, walkerSprite('E', 'walk', Math.floor(t * 4) & 1), wx, wy - 11);
  // trig on the summit
  blit(ctx, symbolSprite('trig'), ex + 150 - 3, ey + 24);
  // grid letters + ticks on the window
  rect(ctx, ex - 1, ey - 1, 15, 9, PAL.paper);
  drawText(ctx, 'NN', ex + 1, ey, PAL.ink, { font: 'small', spacing: 1 });

  // prompt
  const ph = blink(t, 1.2, 0.65);
  if (ph) {
    drawText(ctx, 'PRESS ENTER / TAP TO BEGIN', SW / 2, 168, PAL.ink, { spacing: 1, align: 'center' });
    const w = measureText('PRESS ENTER / TAP TO BEGIN', { spacing: 1 });
    drawText(ctx, '→', SW / 2 - w / 2 - 12 + (Math.floor(t * 3) & 1), 168, PAL.magenta, {});
    drawText(ctx, '←', SW / 2 + w / 2 + 6 - (Math.floor(t * 3) & 1), 168, PAL.magenta, {});
  }
  const how = ui.touchVisible
    ? 'HEADPHONES \u00b7 TOUCH: DRAG TO WALK \u00b7 BUTTONS: RUN, LISTEN, MAP, NOTES'
    : 'HEADPHONES \u00b7 ARROWS/WASD WALK \u00b7 SHIFT RUN \u00b7 SPACE LISTEN \u00b7 M MAP \u00b7 L NOTES';
  drawText(ctx, how, SW / 2, 182, PAL.waterInk, { font: 'small', align: 'center' });
  drawText(ctx, 'EIGHT GLENS  \u00b7  ONE RECORD  \u00b7  THE MAP IS THE SCORE', SW / 2, 191, PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
  ruler(ctx, 12, 205, SW - 24, 4, PAL.grid, 3, 2, 4);
  hline(ctx, 12, 205, SW - 24, PAL.grid);
}

// ================================================================== select
const thumbCache = new Map();
const THUMB_W = 112, THUMB_H = 84;
const THUMB_STYLE = [
  { water: 0.34, wood: 0.1, snow: 9, rock: 0.9 }, { water: 0.2, wood: 0.6, snow: 9, rock: 1.1 }, { water: 0.1, wood: 0.25, snow: 9, rock: 0.5 },
  { water: 0.08, wood: 0.0, snow: 0.7, rock: 0.9 }, { water: 0.12, wood: 0.1, snow: 9, rock: 0.55 }, { water: 0.05, wood: 0.0, snow: 0.95, rock: 0.5 },
  { water: 0.3, wood: 0.0, snow: 9, rock: 0.8 }, { water: 0.1, wood: 0.3, snow: 0.8, rock: 0.7 },
];
function thumb(index, locked) {
  const key = index + (locked ? 'L' : '');
  if (thumbCache.has(key)) return thumbCache.get(key);
  const st = THUMB_STYLE[index % THUMB_STYLE.length];
  const W = THUMB_W, H = THUMB_H;
  const buf = new Uint32Array(W * H);
  const hh = new Float32Array(W * H);
  const seed = 1000 + index * 77;
  const peaks = [];
  const np = 3 + (index % 3);
  for (let i = 0; i < np; i++) peaks.push([hash2f(i, 1, seed) * W, hash2f(i, 2, seed) * H, 10 + hash2f(i, 3, seed) * 18, 0.5 + hash2f(i, 4, seed) * 0.8]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 0.12 + 0.07 * Math.sin(x * 0.09 + index) + 0.06 * Math.sin(y * 0.13 + x * 0.05);
    for (const [cx, cy, r, a] of peaks) { const dx = (x - cx) / r, dy = (y - cy) / (r * 0.85); v += a * Math.exp(-(dx * dx + dy * dy)); }
    hh[y * W + x] = v * st.rock;
  }
  const BN = 11;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, v = hh[i];
    const th = (BAYER4[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
    const wob = 0.5 + 0.25 * Math.sin(x * 0.2 + y * 0.11 + index) + 0.25 * Math.sin(x * 0.07 - y * 0.17);
    let c = th < 0.06 + v * 0.25 ? U.paper2 : U.paper;
    if (v < st.water) c = U.water;
    else if (wob < st.wood && v < 0.6) c = U.wood;
    else if (v > st.snow) c = U.snow;
    const b = Math.floor(v * BN * 1.6);
    const hi = (x < W - 1 && Math.floor(hh[i + 1] * BN * 1.6) > b) || (y < H - 1 && Math.floor(hh[i + W] * BN * 1.6) > b);
    if (hi && v >= st.water) c = (b % 4 === 3) ? U.contourIdx : U.contour;
    else if (v < st.water && v > st.water - 0.012) c = U.waterDeep;
    if (locked) {
      // greyscale: paper / rock / ink dither only
      const g = c === U.water || c === U.waterDeep ? U.paper2 : c === U.wood ? U.rock : c === U.contour || c === U.contourIdx ? U.rock : c;
      c = g;
      if (((x + y) & 1) === 0 && c === U.paper) c = U.paper2;
    }
    buf[i] = c;
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), W, H), 0, 0);
  thumbCache.set(key, cv);
  return cv;
}

function isUnlocked(ui, levels, i) {
  const l = levels[i];
  if (ui.unlocked) {
    if (typeof ui.unlocked === 'number') return i < ui.unlocked;
    if (Array.isArray(ui.unlocked)) return ui.unlocked.includes(l.id) || ui.unlocked.includes(i) || (typeof ui.unlocked[i] === 'boolean' && ui.unlocked[i]);
  }
  if (ui.progress && Array.isArray(ui.progress.unlocked)) return ui.progress.unlocked.includes(l.id);
  return i === 0;
}
function isCompleted(ui, levels, i) {
  const l = levels[i];
  const c = ui.completed || (ui.progress && ui.progress.completed);
  return Array.isArray(c) && (c.includes(l.id) || c.includes(i));
}

function select(env) {
  const { ctx, ui, t, SW, SH } = env;
  const levels = levelList(ui);
  const sel = clamp(ui.selected | 0, 0, levels.length - 1);
  rect(ctx, 0, 0, SW, SH, PAL.paper);
  // header
  rect(ctx, 0, 0, SW, 16, PAL.paper2);
  hline(ctx, 0, 16, SW, PAL.ink);
  drawText(ctx, 'INDEX TO TRACKS', 8, 4, PAL.ink, { spacing: 1 });
  drawText(ctx, 'CONTOURS · ALBUM EDITION', SW - 8, 6, PAL.contourIdx, { font: 'small', spacing: 1, align: 'right' });
  ruler(ctx, 0, 16, SW, 8, PAL.grid, 3, 2, 4);

  const x0 = 8, y0 = 22, rh = 22, lw = 222;
  levels.forEach((lv, i) => {
    const y = y0 + i * rh;
    const unlocked = isUnlocked(ui, levels, i), done = isCompleted(ui, levels, i), on = i === sel;
    if (on) {
      rect(ctx, x0, y, lw, rh - 2, PAL.paper2);
      rect(ctx, x0, y, 3, rh - 2, PAL.magenta);
      frame(ctx, x0, y, lw, rh - 2, PAL.ink);
    } else {
      ctx.fillStyle = PAL.grid;
      for (let x = x0; x < x0 + lw; x += 2) ctx.fillRect(x, y + rh - 2, 1, 1);
    }
    const col = unlocked ? PAL.ink : PAL.rock;
    // roman numeral plate
    const nx = x0 + 7, ny = y + 3;
    rect(ctx, nx, ny, 26, 15, unlocked ? (on ? PAL.magenta : PAL.paper) : PAL.paper2);
    frame(ctx, nx, ny, 26, 15, unlocked ? PAL.magenta : PAL.rock);
    drawText(ctx, ROMAN[i] || String(i + 1), nx + 13, ny + 4, unlocked ? (on ? PAL.snow : PAL.magenta) : PAL.rock, { align: 'center' });
    // name + gaelic
    drawText(ctx, String(lv.name).toUpperCase(), x0 + 40, y + 3, col, { spacing: 1 });
    drawText(ctx, lv.gaelic || '', x0 + 40, y + 13, unlocked ? PAL.contourIdx : PAL.rock, { font: 'small', italic: true });
    // right: grid letters box + lock / check
    const gx = x0 + lw - 26;
    rect(ctx, gx, y + 3, 18, 13, unlocked ? PAL.paper : PAL.paper2);
    frame(ctx, gx, y + 3, 18, 13, unlocked ? PAL.grid : PAL.rock);
    drawText(ctx, lv.gridLetters || '', gx + 9, y + 7, unlocked ? PAL.waterInk : PAL.rock, { align: 'center' });
    if (!unlocked) blit(ctx, padlockSprite(PAL.rock), gx - 12, y + 6);
    else if (done) check(ctx, gx - 11, y + 7, PAL.magenta);
    if (on) {
      const off = Math.floor(t * 3) & 1;
      drawText(ctx, '→', x0 - 6 + off, y + 6, PAL.magenta, {});
    }
  });

  // right panel: sheet cover + details
  const rx = 242, rw = SW - rx - 8;
  const lv = levels[sel];
  const unlocked = isUnlocked(ui, levels, sel);
  panel(ctx, rx, 22, rw, 176, { fill: PAL.paper, shadow: PAL.paper2 });
  const tx = rx + Math.round((rw - THUMB_W) / 2), ty = 28;
  ctx.drawImage(thumb(sel, !unlocked), tx, ty);
  frame(ctx, tx - 1, ty - 1, THUMB_W + 2, THUMB_H + 2, PAL.ink);
  rect(ctx, tx, ty, 14, 9, PAL.paper);
  drawText(ctx, lv.gridLetters || '', tx + 2, ty + 2, PAL.ink, { font: 'small', spacing: 1 });
  if (!unlocked) {
    rect(ctx, tx + THUMB_W / 2 - 18, ty + THUMB_H / 2 - 14, 36, 28, PAL.paper);
    frame(ctx, tx + THUMB_W / 2 - 18, ty + THUMB_H / 2 - 14, 36, 28, PAL.ink);
    ctx.drawImage(padlockSprite(PAL.ink), tx + THUMB_W / 2 - 3, ty + THUMB_H / 2 - 8);
    drawText(ctx, 'LOCKED', tx + THUMB_W / 2, ty + THUMB_H / 2 + 3, PAL.ink, { font: 'small', align: 'center' });
  }
  const cx = rx + rw / 2;
  const subT = String(lv.subtitle || '').toUpperCase();
  const subFont = measureText(subT, {}) <= rw - 8 ? 'main' : 'small';
  drawText(ctx, subT, cx, subFont === 'main' ? 118 : 120, unlocked ? PAL.magenta : PAL.rock, { align: 'center', font: subFont, spacing: subFont === 'small' ? 1 : 0 });
  drawText(ctx, String(lv.name).toUpperCase(), cx, 130, unlocked ? PAL.ink : PAL.rock, { align: 'center', font: 'small', spacing: 1 });
  hline(ctx, rx + 10, 141, rw - 20, PAL.grid);
  // gate chain
  drawText(ctx, 'GATE CHAIN', rx + 10, 146, PAL.contourIdx, { font: 'small', spacing: 1 });
  const chain = lv.chain || [];
  let ix = rx + 10;
  chain.forEach((type) => {
    rect(ctx, ix - 1, 154, 10, 10, PAL.paper2);
    frame(ctx, ix - 1, 154, 10, 10, unlocked ? PAL.ink : PAL.rock);
    ctx.drawImage(iconSprite(type, unlocked), ix, 155);
    ix += 13;
  });
  ctx.drawImage(gateSprite(false, unlocked ? null : PAL.rock), ix + 1, 153);
  const status = !unlocked ? 'LOCKED' : isCompleted(ui, levels, sel) ? 'COMPLETE' : 'OPEN';
  drawText(ctx, status, rx + 10, 172, unlocked ? PAL.waterInk : PAL.rock, { font: 'small', spacing: 1 });
  if (isCompleted(ui, levels, sel)) check(ctx, rx + 10 + measureText(status, { font: 'small', spacing: 1 }) + 4, 171, PAL.magenta);
  if (unlocked && blink(t, 1.4, 0.7)) drawText(ctx, 'ENTER TO WALK', cx, 185, PAL.magenta, { font: 'small', align: 'center', spacing: 1 });

  hline(ctx, 0, SH - 14, SW, PAL.ink);
  rect(ctx, 0, SH - 13, SW, 13, PAL.paper2);
  drawText(ctx, '↑↓ CHOOSE    ENTER WALK    ESC BACK', SW / 2, SH - 9, PAL.contourIdx, { font: 'small', spacing: 1, align: 'center' });
}

// =================================================================== pause
function pause(env) {
  const { ctx, ui, t, SW, SH } = env;
  const items = ui.items || ['RESUME', 'FIELD NOTES', 'SHEET MAP', 'TRACKLIST'];
  const sel = clamp(ui.selected | 0, 0, items.length - 1);
  const w = 150, h = 34 + items.length * 13 + 14;
  const x = Math.round((SW - w) / 2), y = Math.round((SH - h) / 2);
  panel(ctx, x, y, w, h, { fill: PAL.paper, inner: PAL.grid });
  rect(ctx, x + 3, y + 3, w - 6, 20, PAL.magenta);
  drawText(ctx, 'PAUSED', x + w / 2 + 1, y + 7 + 1, PAL.ink, { align: 'center', scale: 1, spacing: 4 });
  drawText(ctx, 'PAUSED', x + w / 2, y + 7, PAL.snow, { align: 'center', spacing: 4 });
  items.forEach((it, i) => {
    const iy = y + 30 + i * 13;
    if (i === sel) {
      rect(ctx, x + 8, iy - 2, w - 16, 11, PAL.paper2);
      drawText(ctx, '→', x + 11 + (Math.floor(t * 3) & 1), iy, PAL.magenta, {});
    }
    drawText(ctx, it, x + 26, iy, i === sel ? PAL.ink : PAL.contourIdx, { spacing: 1 });
  });
  drawText(ctx, 'ESC RESUME', x + w / 2, y + h - 11, PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
}

// ====================================================================== map
function mapScreen(env) {
  const { R, ctx, state, ui, t, SW, SH } = env;
  rect(ctx, 0, 0, SW, SH, PAL.night);
  ditherRect(ctx, 0, 0, SW, SH, PAL.ink, 0.12);
  const w = (state && state.world) || R.world;
  // sheet
  const sx = 6, sy = 4, sw = 220, sh = 208;
  panel(ctx, sx, sy, sw, sh, { fill: PAL.paper2, shadow: PAL.ink });
  const mx = 22, my = 20, n = 188;
  if (R.bigMap && w) ctx.drawImage(R.bigMap, mx, my);
  else rect(ctx, mx, my, n, n, PAL.paper);
  frame(ctx, mx - 1, my - 1, n + 2, n + 2, PAL.ink);
  if (!w) return;
  const lv = w.level || {};
  const f = n / w.size;
  // edge labels
  const [e0, n0] = lv.gridOrigin || [0, 0];
  const two = (v) => String(((v % 100) + 100) % 100).padStart(2, '0');
  const kmPx = (n / (w.size * (w.cellMeters || 40) / 1000));
  for (let k = 0; k * kmPx < n; k++) {
    const gx = mx + Math.round(k * kmPx);
    if (k > 0 || true) drawText(ctx, two(e0 + k), gx, my - 9, PAL.waterInk, { font: 'small', align: 'center' });
    const gy = my + Math.round(k * kmPx);
    if (k > 0) drawText(ctx, two(n0 - k), mx - 4, gy - 2, PAL.waterInk, { font: 'small', align: 'right' });
  }
  drawText(ctx, lv.gridLetters || '', sx + 3, sy + 3, PAL.ink, { font: 'small', spacing: 1 });
  const know = (state && state.knowledge) || {};
  const chain = (state && state.chainProgress) || [];
  const chainTypes = new Set(chain.map((c) => c.type));
  const resIds = new Set(((state && state.resonance) || []).map((r) => r.poiId).filter(Boolean));
  const pois = w.pois || [];

  // the player's route: dotted magenta
  const trail = (state && state.trail) || [];
  if (trail.length) {
    ctx.fillStyle = PAL.magenta;
    let pxp = -1, pyp = -1;
    for (let i = 0; i < trail.length; i++) {
      const X = Math.round(mx + trail[i].x * f), Y = Math.round(my + trail[i].y * f);
      if (X === pxp && Y === pyp) continue;
      pxp = X; pyp = Y;
      if (i % 3 !== 2) ctx.fillRect(X, Y, 1, 1);
    }
  }

  // every POI on the sheet, with what the walker knows about it
  const pulse = Math.floor(t * 2.5) & 1;
  for (const poi of pois) {
    const spr = symbolSprite(poi.type);
    const kn = know[poi.id];
    const cxp = mx + poi.x * f, cyp = my + poi.y * f;
    const X = Math.round(cxp - spr.width / 2), Y = Math.round(cyp - spr.height / 2);
    if (chainTypes.has(poi.type)) pcircle(ctx, Math.round(cxp), Math.round(cyp), 6, PAL.magenta);
    if (resIds.has(poi.id)) {
      pcircle(ctx, Math.round(cxp), Math.round(cyp), 7 + pulse, pulse ? PAL.snow : PAL.magenta);
      pcircle(ctx, Math.round(cxp), Math.round(cyp), 8 - pulse, pulse ? PAL.magenta : PAL.snow);
    }
    rect(ctx, X - 1, Y - 1, spr.width + 2, spr.height + 2, PAL.paper);
    ctx.drawImage(spr, X, Y);
    if (!kn) continue;
    const mxp = X + spr.width + 1, myp = Y - 4;
    if (kn.woken) {
      rect(ctx, mxp - 1, myp - 1, 7, 6, PAL.paper);
      ctx.drawImage(tickSprite(PAL.ink), mxp, myp);
    } else if (kn.heard > 0) {
      drawText(ctx, '?', mxp, myp, PAL.magenta, { font: 'small', halo: PAL.paper });
    }
    const gl = [];
    for (const key of kn.learned || []) { const g = glyphFor(key, poi.condition); if (!gl.includes(g)) gl.push(g); }
    if (gl.length) {
      const txt = gl.slice(0, 2).join(' ') + (gl.length > 2 ? '+' : '');
      const tw = measureText(txt, { font: 'small' });
      const right = X + spr.width + 3 + tw < mx + n - 2;
      drawText(ctx, txt, right ? X + spr.width + 3 : X - 3 - tw, Y + (spr.height >> 1) - 1, PAL.contourIdx, { font: 'small', halo: PAL.paper });
    }
  }
  // gate
  const gp = gatePlacement(w);
  if (gp) {
    const gs = symbolSprite('gate');
    const mapPx = w.size * CELL_PX;
    const X = Math.round(mx + (gp.x / mapPx) * n - 1), Y = Math.round(my + (gp.y / mapPx) * n - 3);
    const open = state && state.gateOpen;
    rect(ctx, clamp(X, mx, mx + n - 11) - 1, clamp(Y, my, my + n - 10) - 1, 11, 10, PAL.paper);
    ctx.drawImage(open ? gateSprite(true) : gs, clamp(X, mx, mx + n - 11), clamp(Y, my, my + n - 10));
  }
  // player
  if (state && state.player) {
    const p = state.player;
    const X = Math.round(mx + p.x * f), Y = Math.round(my + p.y * f);
    const on = blink(t, 2.2, 0.6);
    // ink-ringed magenta disc, white halo that blinks, plus a heading tick
    pline(ctx, X, Y, X + Math.cos(p.heading || 0) * 8, Y + Math.sin(p.heading || 0) * 8, PAL.ink);
    ctx.fillStyle = on ? PAL.snow : PAL.paper;
    ctx.fillRect(X - 3, Y - 2, 7, 5); ctx.fillRect(X - 2, Y - 3, 5, 7);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(X - 2, Y - 2, 5, 5);
    ctx.fillStyle = PAL.magenta;
    ctx.fillRect(X - 1, Y - 1, 3, 3);
  }

  // ------------------------------------------------------------ right panel
  const rx = 234, rw = SW - rx - 6, ix0 = rx + 6, iw = rw - 12;
  panel(ctx, rx, 4, rw, 208, { fill: PAL.paper, shadow: PAL.ink });
  drawText(ctx, String(lv.name || '').toUpperCase(), ix0, 8, PAL.ink, { spacing: 1 });
  drawText(ctx, lv.gaelic || '', ix0, 19, PAL.contourIdx, { font: 'small' });
  const subT = String(lv.subtitle || '').toUpperCase();
  const subW = measureText(subT, { font: 'small' });
  const twoLine = measureText(String(lv.gaelic || ''), { font: 'small' }) + subW + 6 > iw;
  if (twoLine) drawText(ctx, subT, ix0, 26, PAL.magenta, { font: 'small' });
  else drawText(ctx, subT, rx + rw - 6, 19, PAL.magenta, { font: 'small', align: 'right' });
  const ho = twoLine ? 7 : 0;
  hline(ctx, rx + 5, 26 + ho, rw - 10, PAL.ink);

  // legend: symbol, type label, what its artefact does
  drawText(ctx, 'LEGEND', ix0, 30 + ho, PAL.contourIdx, { font: 'small', spacing: 1 });
  const present = new Set(pois.map((p) => p.type));
  POI_TYPES.forEach((type, i) => {
    const y = 38 + ho + i * 9;
    const spr = symbolSprite(type);
    const here = present.has(type);
    const cxm = ix0 + 5;
    if (here) {
      if (chainTypes.has(type)) pcircle(ctx, cxm, y + 4, 6, PAL.magenta);
      ctx.drawImage(spr, Math.round(cxm - spr.width / 2), Math.round(y + 4 - spr.height / 2));
    } else { ctx.fillStyle = PAL.rock; for (let k = 0; k < 5; k += 2) ctx.fillRect(cxm - 2 + k, y + 4, 1, 1); }
    drawText(ctx, typeLabel(type), ix0 + 16, y + 1, here ? PAL.ink : PAL.rock, { font: 'small' });
    drawText(ctx, type === 'bothy' ? 'FIELD NOTES' : ARTEFACT_NAMES[type].toUpperCase(), ix0 + 16 + 64, y + 1, here ? PAL.contourIdx : PAL.rock, { font: 'small' });
  });
  hline(ctx, rx + 5, 111 + ho, rw - 10, PAL.grid);

  // the key: what has to sound together
  let ky = 114 + ho;
  drawText(ctx, 'KEY', ix0, ky, PAL.magenta, { font: 'small', spacing: 1 });
  drawText(ctx, 'WAKE TOGETHER', ix0 + 17, ky, PAL.contourIdx, { font: 'small' });
  ky += 8;
  let kx = ix0;
  chain.forEach((c, i) => {
    const count = c.count != null ? c.count : pois.filter((q) => q.type === c.type).length;
    const label = (count > 1 ? 'ANY ' : '') + typeShort(c.type);
    const cw = 12 + measureText(label, { font: 'small' }) + 1;
    const sep = i < chain.length - 1 ? 7 : 0;
    if (kx > ix0 && kx + cw > ix0 + iw) { kx = ix0; ky += 11; }
    rect(ctx, kx, ky - 1, 10, 10, c.resonating ? PAL.paper : PAL.paper2);
    frame(ctx, kx, ky - 1, 10, 10, c.resonating ? PAL.magenta : PAL.rock);
    ctx.drawImage(iconSprite(c.type, true), kx + 1, ky);
    drawText(ctx, label, kx + 12, ky + 1, c.resonating ? PAL.ink : PAL.contourIdx, { font: 'small' });
    kx += cw;
    if (sep) { drawText(ctx, '+', kx + 1, ky + 1, PAL.magenta, { font: 'small' }); kx += sep; }
  });
  ky += 11;
  if (w.gate) {
    const lit = chain.filter((c) => c.resonating).length;
    ctx.drawImage(gateSprite(!!(state && state.gateOpen)), ix0, ky - 1, 9, 8);
    drawText(ctx, String(w.gate.name || 'Bealach').toUpperCase(), ix0 + 12, ky + 1, PAL.magenta, { font: 'small' });
    const stat = state && state.gateOpen ? 'OPEN' : `${lit}/${chain.length}`;
    drawText(ctx, stat, rx + rw - 6, ky + 1, PAL.ink, { font: 'small', align: 'right' });
    ky += 9;
  }
  hline(ctx, rx + 5, ky, rw - 10, PAL.grid);

  // what has been learned, per place
  const footTop = 177;
  let ly = ky + 3;
  drawText(ctx, 'LEARNED', ix0, ly, PAL.magenta, { font: 'small', spacing: 1 });
  ly += 8;
  const learnedLines = [];
  for (const poi of pois) {
    const kn = know[poi.id];
    if (!kn || !kn.learned || !kn.learned.length) continue;
    const gl = [];
    for (const key of kn.learned) { const g = glyphFor(key, poi.condition); if (!gl.includes(g)) gl.push(g); }
    learnedLines.push({ name: String(poi.name || poi.id), gl: gl.join(' ') });
  }
  const room = Math.max(0, Math.min(4, Math.floor((footTop - 2 - ly) / 7)));
  if (!learnedLines.length) drawText(ctx, 'NOTHING YET. FAILED TRIES TEACH.', ix0, ly, PAL.rock, { font: 'small' });
  learnedLines.slice(0, room).forEach((L, i) => {
    const gw = measureText(L.gl, { font: 'small' });
    let name = L.name.toUpperCase();
    while (name.length > 3 && measureText(name + ':', { font: 'small' }) + 3 + gw > iw) name = name.slice(0, -1);
    drawText(ctx, name + ':', ix0, ly + i * 7, PAL.ink, { font: 'small' });
    drawText(ctx, L.gl, rx + rw - 6, ly + i * 7, PAL.magenta, { font: 'small', align: 'right' });
  });
  if (learnedLines.length > room && room > 0) drawText(ctx, '+' + (learnedLines.length - room), rx + rw - 6, footTop - 8, PAL.contourIdx, { font: 'small', align: 'right' });

  // footer: route, position, scale
  hline(ctx, rx + 5, footTop - 1, rw - 10, PAL.ink);
  ctx.fillStyle = PAL.magenta;
  for (let k = 0; k < 12; k += 3) ctx.fillRect(ix0 + k, footTop + 5, 2, 1);
  const rl = wrapText('YOUR ROUTE: THE TRACK YOU HAVE PLAYED', iw - 16, { font: 'small' });
  rl.slice(0, 2).forEach((l, i) => drawText(ctx, l, ix0 + 16, footTop + 2 + i * 7, PAL.ink, { font: 'small' }));
  if (state && state.player) {
    const p = state.player;
    drawText(ctx, 'YOU ' + gridRef(w, p.x, p.y), ix0, 194, PAL.waterInk, { font: 'small' });
    drawText(ctx, `${Math.round(p.elevation || 0)}M`, rx + rw - 6, 194, PAL.ink, { font: 'small', align: 'right' });
  }
  // scale bar: 1 km
  const kmw = Math.round(kmPx);
  rect(ctx, ix0, 204, kmw, 2, PAL.ink); rect(ctx, ix0 + (kmw >> 1), 204, kmw >> 1, 2, PAL.paper);
  frame(ctx, ix0, 204, kmw, 2, PAL.ink);
  drawText(ctx, '1 KM', ix0 + kmw + 4, 202, PAL.ink, { font: 'small' });
  drawText(ctx, 'M/ESC CLOSE', rx + rw - 6, 202, PAL.contourIdx, { font: 'small', align: 'right' });
  // north arrow
  const nx = sx + sw - 12, ny = sy + 14;
  pline(ctx, nx, ny + 8, nx, ny, PAL.ink); pline(ctx, nx, ny, nx - 2, ny + 3, PAL.ink); pline(ctx, nx, ny, nx + 2, ny + 3, PAL.ink);
  drawText(ctx, 'N', nx, ny - 8, PAL.ink, { font: 'small', align: 'center' });
}

// ===================================================================== notes
function notes(env) {
  const { ctx, ui, t, SW, SH } = env;
  const list = ui.notes || [];
  const x = 36, y = 10, w = SW - 60, h = SH - 22;
  // page shadow + page
  rect(ctx, x + 3, y + 3, w, h, PAL.night);
  rect(ctx, x, y, w, h, PAL.paper);
  frame(ctx, x, y, w, h, PAL.ink);
  // ruled lines
  ctx.fillStyle = PAL.grid;
  for (let ly = y + 36; ly < y + h - 6; ly += 10) ctx.fillRect(x + 4, ly, w - 8, 1);
  vline(ctx, x + 22, y + 2, h - 4, PAL.magenta);
  // spiral binding
  for (let by = y + 8; by < y + h - 6; by += 12) {
    rect(ctx, x - 9, by, 12, 3, PAL.ink);
    rect(ctx, x - 7, by + 1, 6, 1, PAL.rock);
    rect(ctx, x + 4, by, 2, 3, PAL.paper2);
  }
  drawText(ctx, 'FIELD NOTES', x + 30, y + 8, PAL.ink, { spacing: 2 });
  drawText(ctx, `${list.length} FOUND`, x + w - 8, y + 10, PAL.contourIdx, { font: 'small', align: 'right', spacing: 1 });
  hline(ctx, x + 30, y + 19, 82, PAL.magenta);
  hline(ctx, x + 30, y + 21, 82, PAL.magenta);
  const maxW = w - 48;
  let ly = y + 28;
  const scroll = (ui.scroll | 0);
  if (!list.length) {
    drawText(ctx, 'Nothing yet.', x + 30, ly, PAL.contourIdx, { italic: true });
    drawText(ctx, 'Listen to the land.', x + 30, ly + 10, PAL.contourIdx, { italic: true });
  }
  const lines = [];
  list.forEach((n, i) => {
    const wrapped = wrapText(String(n), maxW - 10, { italic: true });
    wrapped.forEach((l, k) => lines.push({ text: l, first: k === 0, i }));
  });
  const visible = Math.floor((h - 34) / 10);
  const off = clamp(scroll, 0, Math.max(0, lines.length - visible));
  lines.slice(off, off + visible).forEach((l, k) => {
    const yy = ly + k * 10;
    if (l.first) { drawText(ctx, String(l.i + 1), x + 26, yy + 1, PAL.magenta, { font: 'small' }); }
    drawText(ctx, l.text, x + 36, yy, PAL.night, { italic: true });
  });
  if (off > 0) drawText(ctx, '↑', x + w - 10, y + 26, PAL.magenta, {});
  if (off + visible < lines.length) drawText(ctx, '↓', x + w - 10, y + h - 12, PAL.magenta, {});
  drawText(ctx, 'ESC CLOSE', x + w / 2, y + h - 9, PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
}

// ================================================================= complete
function motifStave(ctx, cx, y, t) {
  // five lines + the contour motif [0,2,4,1,3] as notes
  const w = 70;
  const x = cx - w / 2;
  for (let i = 0; i < 5; i++) hline(ctx, x, y + i * 3, w, PAL.ink);
  const motif = [0, 2, 4, 1, 3];
  motif.forEach((deg, i) => {
    const nx = x + 8 + i * 13, ny = y + 12 - deg * 1.5;
    const on = Math.floor(t * 4) % 5 === i;
    const col = on ? PAL.magenta : PAL.ink;
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(nx) - 2, Math.round(ny) - 1, 5, 3);
    ctx.fillRect(Math.round(nx) - 1, Math.round(ny) - 2, 3, 5);
    ctx.fillRect(Math.round(nx) + 2, Math.round(ny) - 9, 1, 9);
  });
}

function complete(env) {
  const { ctx, state, ui, t, since, SW, SH } = env;
  const lv = (state && state.world && state.world.level) || (state && state.level) || {};
  const idx = lv.index != null ? lv.index : (state && state.levelIndex) || 0;
  const ease = clamp(since / 0.5, 0, 1);
  const w = 262, h = 146;
  const x = Math.round((SW - w) / 2);
  const y = Math.round((SH - h) / 2 - 8 + (1 - ease) * -40);
  panel(ctx, x, y, w, h, { fill: PAL.paper, inner: PAL.magenta });
  rect(ctx, x + 4, y + 4, w - 8, 30, PAL.magenta);
  const title = 'BEALACH OPENED';
  drawText(ctx, title, SW / 2 + 2, y + 10 + 2, PAL.ink, { scale: 2, spacing: 2, align: 'center' });
  drawText(ctx, title, SW / 2, y + 10, PAL.snow, { scale: 2, spacing: 2, align: 'center' });
  const gate = state && state.world && state.world.gate;
  drawText(ctx, gate ? gate.name : 'Bealach', SW / 2, y + 40, PAL.magenta, { italic: true, align: 'center' });
  ctx.drawImage(gateSprite(true), Math.round(SW / 2 - 5), y + 52);
  const num = ROMAN[idx] || String(idx + 1);
  drawText(ctx, `TRACK ${num} COMPLETE`, SW / 2, y + 68, PAL.ink, { align: 'center', spacing: 1 });
  drawText(ctx, String(lv.subtitle || lv.name || '').toUpperCase(), SW / 2, y + 79, PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
  motifStave(ctx, SW / 2 - 52, y + 92, t);
  const nf = ui.fragmentCount != null ? ui.fragmentCount : ((state && state.fragments) || []).length;
  drawText(ctx, `FRAGMENT ${Math.max(nf, idx + 1)}/8`, SW / 2 + 6, y + 91, PAL.ink, { font: 'small', spacing: 1 });
  drawText(ctx, 'COLLECTED', SW / 2 + 6, y + 99, PAL.contourIdx, { font: 'small', spacing: 1 });
  // next track
  const next = ui.next || TRACKS[idx + 1];
  hline(ctx, x + 8, y + h - 33, w - 16, PAL.grid);
  if (next) {
    drawText(ctx, 'NEXT TRACK', x + 10, y + h - 27, PAL.contourIdx, { font: 'small', spacing: 1 });
    drawText(ctx, String(next.name).toUpperCase(), x + 10, y + h - 20, PAL.ink, { spacing: 1 });
    drawText(ctx, String(next.subtitle || '').toUpperCase(), x + w - 10, y + h - 19, PAL.magenta, { font: 'small', align: 'right', spacing: 1 });
  } else {
    drawText(ctx, 'THE ALBUM IS COMPLETE', SW / 2, y + h - 22, PAL.ink, { align: 'center', spacing: 1 });
  }
  if (blink(t, 1.3, 0.65)) drawText(ctx, 'PRESS ENTER', SW / 2, y + h - 9, PAL.magenta, { font: 'small', align: 'center', spacing: 2 });
}

export const Screens = { title, select, pause, map: mapScreen, notes, complete };
