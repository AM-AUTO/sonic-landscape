/**
 * Full-screen scenes: title, select (track list), pause, map, notes, complete.
 * Each takes an env { R, ctx, state, ui, t, since, SW, SH } from the renderer.
 */
import { PAL, PAL_U32 as U, BAYER4, BAYER8 } from './palette.js';
import { drawText, measureText, wrapText } from './font.js';
import { rect, frame, hline, vline, pline, panel, px, ditherRect, clamp, ruler, pcircle } from './draw.js';
import { typeLabel, typeShort, glyphFor } from './glyphs.js';
import { iconSprite, gateSprite, padlockSprite, symbolSprite, walkerSprite, blit, artCanvas, MAP_SYMBOLS, tickSprite } from './sprites.js';
import { ARTEFACT_NAMES, POI_TYPES, CELL_PX } from '../world/codes.js';
import { gridRef, bearingDeg } from './hud.js';
import { gatePlacement } from './mapbake.js';
import { hash2f } from '../core/rng.js';
import { ROMAN, TITLE, SELECT, PAUSE, NOTES, COMPLETE, MAP, STORY, fmt } from '../text.js';
import { PANEL, TITLE_SCENE, THUMB, drawPanel, TITLE_VARIANTS, TITLE_DEFAULT, TITLE_LAYOUT } from './panels.js';
import { revealCount } from '../story.js';
import { LEVELS } from '../world/levels/index.js';

/** Geometry the tests measure text against (kept in step with the draw code below). */
export const LAYOUT = Object.freeze({
  sw: 384,
  select: Object.freeze({ x0: 8, lw: 222, nameX: 40, panelX: 242, panelW: 134 }),
  map: Object.freeze({ rx: 234, rw: 144, ix0: 240, iw: 132, labelX: 16, nameX: 80 }),
  pause: Object.freeze({ w: 150, itemX: 26 }),
  complete: Object.freeze({ w: 262 }),
  story: Object.freeze({ capX: 42, capW: 300, capY: 176, capLines: 3, spacing: 1, bandY: 168 }),
});

const CHECK = [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]];
function check(ctx, x, y, color) { ctx.fillStyle = color; for (const [a, b] of CHECK) ctx.fillRect(x + a, y + b, 1, 1); }

function ticksBorder(ctx, SW, SH) {
  frame(ctx, 1, 1, SW - 2, SH - 2, PAL.ink);
  frame(ctx, 4, 4, SW - 8, SH - 8, PAL.grid);
}


// ------------------------------------------------------------------ the gothic frame: accent, gold sprockets, fades
/** The palette name of a track's signature hue (magenta when none). */
function accentNameOf(lv) { const a = lv && lv.palette && lv.palette.accent; return a && PAL[a] ? a : 'magenta'; }
function accentOfIndex(i) { return PAL[accentNameOf(LEVELS[clamp(i | 0, 0, LEVELS.length - 1)])]; }
function accentOfLevel(lv) { return PAL[accentNameOf(lv)]; }
/** ink or snow text, whichever reads on a fill of this colour */
function onFill(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? PAL.ink : PAL.snow;
}

const fadePats = [];
/** Ordered-dither fade to black over a rect: k = 0 clear .. 1 black (cached 8x8 patterns, so one fillRect). */
function fadeBlack(ctx, x, y, w, h, k) {
  if (k <= 0) return;
  if (k >= 1) { rect(ctx, x, y, w, h, PAL.ink); return; }
  const lvl = Math.max(1, Math.min(63, Math.round(k * 64)));
  let pat = fadePats[lvl];
  if (!pat) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext('2d');
    g.fillStyle = PAL.ink;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (BAYER8[(j << 3) | i] < lvl) g.fillRect(i, j, 1, 1);
    pat = ctx.createPattern(c, 'repeat');
    fadePats[lvl] = pat;
  }
  ctx.save();
  ctx.fillStyle = pat;
  ctx.translate(x, y);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function blink(t, rate = 1.6, duty = 0.62) { return ((t * rate) % 1) < duty; }

function levelList(ui) {
  // the tracklist is built from the level files; main.js always supplies ui.levels (= LEVELS)
  return (ui.levels || []).map((l, i) => ({
    id: l.id, name: l.name, gaelic: l.gaelic, gridLetters: l.gridLetters, accent: accentNameOf(l),
    subtitle: l.subtitle || (ROMAN[i] + '.'), chain: (l.gate && l.gate.chain) || l.chain || [],
  }));
}

// ================================================================== title
// The start screen is one full-bleed painting (panels.js 'title'; five greyscale + ember variants, src/render/title/*.js: castlerigg,
// shelter, mentol, dolmen, menhir; ui.titleVariant picks one); only the small lines of text are drawn over it, where TITLE_LAYOUT says.
const TITLE_SPECS = Object.freeze(Object.fromEntries(TITLE_VARIANTS.map((v) => [v, Object.freeze({ kind: 'title', levelIndex: 3, variant: v, warm: true })])));
const TITLE_SPEC = TITLE_SPECS[TITLE_DEFAULT];
function title(env) {
  const { ctx, t, SW, SH, ui } = env;
  const v = TITLE_SPECS[ui.titleVariant] ? ui.titleVariant : TITLE_DEFAULT;
  const L = TITLE_LAYOUT[v], K = L.colors, show = (name) => !L.hide.includes(name);
  drawPanel(ctx, TITLE_SPECS[v] || TITLE_SPEC, 0, 0, TITLE_SCENE.w, TITLE_SCENE.h, t);
  const halo = { halo: PAL[K.halo] };
  if (show('cornerLeft')) TITLE.cornerLeft.forEach((ln, i) => drawText(ctx, ln, L.cornerLeft.x, L.cornerLeft.y + i * L.cornerLeft.lh, PAL[K.corner[i]], { font: 'small', spacing: 0, ...halo }));
  if (show('cornerRight')) TITLE.cornerRight.forEach((ln, i) => drawText(ctx, ln, L.cornerRight.x, L.cornerRight.y + i * L.cornerRight.lh, PAL[K.corner[i]], { font: 'small', spacing: 0, align: 'right', ...halo }));
  if (show('subtitle')) {
    const sub = L.subtitle.maxW ? wrapText(TITLE.subtitle, L.subtitle.maxW, { italic: true, spacing: 1 }) : [TITLE.subtitle];
    sub.forEach((ln, i) => drawText(ctx, ln, L.subtitle.x, L.subtitle.y + i * (L.subtitle.lh || 11), PAL[K.subtitle], { italic: true, spacing: 1, align: L.subtitle.align, halo: PAL[K.subtitleHalo] }));
  }
  if (show('prompt') && blink(t, 1.2, 0.65)) {
    drawText(ctx, TITLE.prompt, L.prompt.x, L.prompt.y, PAL[K.prompt], { spacing: 1, align: 'center', halo: PAL[K.promptHalo] });
    const w = measureText(TITLE.prompt, { spacing: 1 });
    drawText(ctx, '→', L.prompt.x - w / 2 - 12 + (Math.floor(t * 3) & 1), L.prompt.y, PAL[K.arrow], { halo: PAL[K.promptHalo] });
    drawText(ctx, '←', L.prompt.x + w / 2 + 6 - (Math.floor(t * 3) & 1), L.prompt.y, PAL[K.arrow], { halo: PAL[K.promptHalo] });
  }
  if (show('controls')) drawText(ctx, ui.touchVisible ? TITLE.controlsTouch : TITLE.controlsKeys, SW / 2, L.controls, PAL[K.controls], { font: 'small', align: 'center', halo: PAL[K.halo] });
  if (show('strapline')) drawText(ctx, TITLE.strapline, SW / 2, L.strapline, PAL[K.strapline], { font: 'small', align: 'center', spacing: 1, halo: PAL[K.halo] });
}

// ================================================================== select
/** Tracklist thumbnail: the track's own night skyline (a ridge panel, cached in panels.js). */
function thumbSpec(index, locked) { return { kind: 'ridge', levelIndex: index, locked: !!locked }; }

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
  const accName = levels[sel] ? levels[sel].accent : 'magenta';
  const accent = PAL[accName], onAcc = onFill(accent);
  rect(ctx, 0, 0, SW, SH, PAL.ink);
  // parchment header: a scroll bar with the accent line under it
  rect(ctx, 0, 0, SW, 16, PAL.paper2);
  hline(ctx, 0, 16, SW, accent);
  hline(ctx, 0, 17, SW, PAL.ink);
  drawText(ctx, SELECT.header, 8, 4, PAL.ink, { spacing: 1 });
  drawText(ctx, SELECT.headerRight, SW - 8, 6, PAL.contourIdx, { font: 'small', spacing: 1, align: 'right' });
  ruler(ctx, 0, 16, SW, 8, PAL.grid, 3, 2, 4);

  // the list sits on a parchment sheet
  const x0 = LAYOUT.select.x0, y0 = 22, rh = 22, lw = LAYOUT.select.lw;
  rect(ctx, x0 - 1, 19, lw + 2, SH - 19 - 15, PAL.paper);
  frame(ctx, x0 - 1, 19, lw + 2, SH - 19 - 15, PAL.contourIdx);
  levels.forEach((lv, i) => {
    const y = y0 + i * rh;
    const unlocked = isUnlocked(ui, levels, i), done = isCompleted(ui, levels, i), on = i === sel;
    const acc = PAL[lv.accent || 'magenta'];
    if (on) {
      rect(ctx, x0, y, lw, rh - 2, PAL.paper2);
      rect(ctx, x0, y, 3, rh - 2, acc);
      frame(ctx, x0, y, lw, rh - 2, PAL.ink);
    } else {
      ctx.fillStyle = PAL.grid;
      for (let x = x0; x < x0 + lw; x += 2) ctx.fillRect(x, y + rh - 2, 1, 1);
    }
    const col = unlocked ? PAL.ink : PAL.rock;
    // roman numeral plate in the track's own hue
    const nx = x0 + 7, ny = y + 3;
    rect(ctx, nx, ny, 26, 15, unlocked ? (on ? acc : PAL.paper) : PAL.paper2);
    frame(ctx, nx, ny, 26, 15, unlocked ? acc : PAL.rock);
    drawText(ctx, ROMAN[i] || String(i + 1), nx + 13, ny + 4, unlocked ? (on ? onFill(acc) : PAL.ink) : PAL.rock, { align: 'center' });
    // name + gaelic
    drawText(ctx, String(lv.name).toUpperCase(), x0 + 40, y + 3, col, { spacing: 1 });
    drawText(ctx, lv.gaelic || '', x0 + 40, y + 13, unlocked ? PAL.contourIdx : PAL.rock, { font: 'small', italic: true });
    // right: grid letters box + lock / check
    const gx = x0 + lw - 26;
    rect(ctx, gx, y + 3, 18, 13, unlocked ? PAL.paper : PAL.paper2);
    frame(ctx, gx, y + 3, 18, 13, unlocked ? PAL.grid : PAL.rock);
    drawText(ctx, lv.gridLetters || '', gx + 9, y + 7, unlocked ? PAL.waterInk : PAL.rock, { align: 'center' });
    if (!unlocked) blit(ctx, padlockSprite(PAL.rock), gx - 12, y + 6);
    else if (done) check(ctx, gx - 11, y + 7, PAL.ink);
  });

  // right: a black film frame, the track's night skyline between two rows of sprocket holes, then its details
  const rx = LAYOUT.select.panelX, rw = SW - rx - 8;
  const lv = levels[sel];
  const unlocked = isUnlocked(ui, levels, sel);
  rect(ctx, rx, 19, rw, SH - 19 - 15, PAL.ink);
  frame(ctx, rx, 19, rw, SH - 19 - 15, accent);
  frame(ctx, rx + 2, 21, rw - 4, SH - 19 - 15 - 4, PAL.night);
  const tx = rx + Math.round((rw - THUMB.w) / 2), ty = 28;
  drawPanel(ctx, thumbSpec(sel, !unlocked), tx, ty, THUMB.w, THUMB.h, t);
  frame(ctx, tx - 1, ty - 1, THUMB.w + 2, THUMB.h + 2, unlocked ? accent : PAL.rock);
  rect(ctx, tx, ty, 14, 9, PAL.ink);
  drawText(ctx, lv.gridLetters || '', tx + 2, ty + 2, unlocked ? accent : PAL.rock, { font: 'small', spacing: 1 });
  if (!unlocked) {
    rect(ctx, tx + THUMB.w / 2 - 18, ty + THUMB.h / 2 - 14, 36, 28, PAL.ink);
    frame(ctx, tx + THUMB.w / 2 - 18, ty + THUMB.h / 2 - 14, 36, 28, PAL.rock);
    ctx.drawImage(padlockSprite(PAL.rock), tx + THUMB.w / 2 - 3, ty + THUMB.h / 2 - 8);
    drawText(ctx, SELECT.locked, tx + THUMB.w / 2, ty + THUMB.h / 2 + 3, PAL.rock, { font: 'small', align: 'center' });
  }
  const cx = rx + rw / 2;
  const subT = String(lv.subtitle || '').toUpperCase();
  const subFont = measureText(subT, {}) <= rw - 8 ? 'main' : 'small';
  drawText(ctx, subT, cx, subFont === 'main' ? 118 : 120, unlocked ? accent : PAL.rock, { align: 'center', font: subFont, spacing: subFont === 'small' ? 1 : 0 });
  drawText(ctx, String(lv.name).toUpperCase(), cx, 130, unlocked ? PAL.snow : PAL.rock, { align: 'center', font: 'small', spacing: 1 });
  hline(ctx, rx + 10, 141, rw - 20, PAL.dusk);
  // gate chain: the OS symbols on little paper tiles
  drawText(ctx, SELECT.chainHeading, rx + 10, 146, PAL.rock, { font: 'small', spacing: 1 });
  const chain = lv.chain || [];
  let ix = rx + 10;
  chain.forEach((type) => {
    rect(ctx, ix - 1, 154, 10, 10, unlocked ? PAL.paper : PAL.paper2);
    frame(ctx, ix - 1, 154, 10, 10, unlocked ? accent : PAL.rock);
    ctx.drawImage(iconSprite(type, unlocked), ix, 155);
    ix += 13;
  });
  rect(ctx, ix, 153, 11, 10, PAL.paper2);
  ctx.drawImage(gateSprite(false, unlocked ? null : PAL.rock), ix, 153);
  const doneNow = isCompleted(ui, levels, sel);
  const status = !unlocked ? SELECT.locked : doneNow ? SELECT.statusDone : SELECT.statusOpen;
  drawText(ctx, status, rx + 10, 172, unlocked ? PAL.snow : PAL.rock, { font: 'small', spacing: 1 });
  if (doneNow) check(ctx, rx + 10 + measureText(status, { font: 'small', spacing: 1 }) + 4, 171, accent);
  if (unlocked && blink(t, 1.4, 0.7)) drawText(ctx, SELECT.prompt, cx, 185, accent, { font: 'small', align: 'center', spacing: 1 });

  // footer: parchment bar
  rect(ctx, 0, SH - 14, SW, 14, PAL.paper2);
  hline(ctx, 0, SH - 14, SW, PAL.ink);
  hline(ctx, 0, SH - 15, SW, accent);
  drawText(ctx, SELECT.footer, SW / 2, SH - 9, PAL.contourIdx, { font: 'small', spacing: 1, align: 'center' });
}

// =================================================================== pause
function pause(env) {
  const { ctx, state, ui, t, SW, SH } = env;
  const acc = accentOfLevel(state && ((state.world && state.world.level) || state.level));
  const items = ui.items || PAUSE.items.map((it) => it.label);
  const sel = clamp(ui.selected | 0, 0, items.length - 1);
  const w = LAYOUT.pause.w, h = 34 + items.length * 13 + 14;
  const x = Math.round((SW - w) / 2), y = Math.round((SH - h) / 2);
  panel(ctx, x, y, w, h, { fill: PAL.paper, shadow: null, inner: acc });
  rect(ctx, x + 3, y + 3, w - 6, 20, acc);
  const onAcc = onFill(acc);
  drawText(ctx, PAUSE.heading, x + w / 2 + 1, y + 7 + 1, onAcc === PAL.snow ? PAL.ink : PAL.snow, { align: 'center', scale: 1, spacing: 4 });
  drawText(ctx, PAUSE.heading, x + w / 2, y + 7, onAcc, { align: 'center', spacing: 4 });
  items.forEach((it, i) => {
    const iy = y + 30 + i * 13;
    if (i === sel) {
      rect(ctx, x + 8, iy - 2, w - 16, 11, PAL.paper2);
      rect(ctx, x + 8, iy - 2, 2, 11, acc);
      drawText(ctx, '→', x + 12 + (Math.floor(t * 3) & 1), iy, PAL.ink, {});
    }
    drawText(ctx, it, x + LAYOUT.pause.itemX, iy, i === sel ? PAL.ink : PAL.contourIdx, { spacing: 1 });
  });
  drawText(ctx, PAUSE.footer, x + w / 2, y + h - 11, PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
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
  const rx = LAYOUT.map.rx, rw = SW - rx - 6, ix0 = rx + 6, iw = rw - 12;
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
  drawText(ctx, MAP.legend, ix0, 30 + ho, PAL.contourIdx, { font: 'small', spacing: 1 });
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
    drawText(ctx, typeLabel(type), ix0 + LAYOUT.map.labelX, y + 1, here ? PAL.ink : PAL.rock, { font: 'small' });
    drawText(ctx, type === 'bothy' ? MAP.bothyRow : ARTEFACT_NAMES[type].toUpperCase(), ix0 + LAYOUT.map.nameX, y + 1, here ? PAL.contourIdx : PAL.rock, { font: 'small' });
  });
  hline(ctx, rx + 5, 111 + ho, rw - 10, PAL.grid);

  // the key: what has to sound together
  let ky = 114 + ho;
  // "KEY · WAUKEN THEGITHER": the first word in magenta, the rest in the legend brown
  const [keyWord, ...keyRest] = MAP.keyHeading.split(' ');
  const keyW = drawText(ctx, keyWord, ix0, ky, PAL.magenta, { font: 'small', spacing: 1 });
  drawText(ctx, keyRest.join(' '), ix0 + keyW + 4, ky, PAL.contourIdx, { font: 'small' });
  ky += 8;
  let kx = ix0;
  chain.forEach((c, i) => {
    const count = c.count != null ? c.count : pois.filter((q) => q.type === c.type).length;
    const label = count > 1 ? fmt(MAP.anyType, { type: typeShort(c.type) }) : typeShort(c.type);
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
    ctx.drawImage(gateSprite(!!(state && state.gateOpen)), ix0, ky - 1);   // native 11x10: the ring-cross keeps every pixel
    drawText(ctx, String(w.gate.name || 'Bealach').toUpperCase(), ix0 + 12, ky + 1, PAL.magenta, { font: 'small' });
    const stat = state && state.gateOpen ? MAP.gateOpen : `${lit}/${chain.length}`;
    drawText(ctx, stat, rx + rw - 6, ky + 1, PAL.ink, { font: 'small', align: 'right' });
    ky += 9;
  }
  hline(ctx, rx + 5, ky, rw - 10, PAL.grid);

  // what has been learned, per place
  const footTop = 177;
  let ly = ky + 3;
  drawText(ctx, MAP.learned, ix0, ly, PAL.magenta, { font: 'small', spacing: 1 });
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
  if (!learnedLines.length) {
    wrapText(MAP.learnedEmpty, iw, { font: 'small' }).slice(0, 2).forEach((l, i) => drawText(ctx, l, ix0, ly + i * 7, PAL.rock, { font: 'small' }));
  }
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
  const rl = wrapText(MAP.route, iw - 16, { font: 'small' });
  rl.slice(0, 2).forEach((l, i) => drawText(ctx, l, ix0 + 16, footTop + 2 + i * 7, PAL.ink, { font: 'small' }));
  if (state && state.player) {
    const p = state.player;
    drawText(ctx, fmt(MAP.you, { ref: gridRef(w, p.x, p.y) }), ix0, 194, PAL.waterInk, { font: 'small' });
    drawText(ctx, `${Math.round(p.elevation || 0)}M`, rx + rw - 6, 194, PAL.ink, { font: 'small', align: 'right' });
  }
  // scale bar: 1 km
  const kmw = Math.round(kmPx);
  rect(ctx, ix0, 204, kmw, 2, PAL.ink); rect(ctx, ix0 + (kmw >> 1), 204, kmw >> 1, 2, PAL.paper);
  frame(ctx, ix0, 204, kmw, 2, PAL.ink);
  drawText(ctx, MAP.scaleBar, ix0 + kmw + 4, 202, PAL.ink, { font: 'small' });
  drawText(ctx, MAP.footer, rx + rw - 6, 202, PAL.contourIdx, { font: 'small', align: 'right' });
  // north arrow
  const nx = sx + sw - 12, ny = sy + 14;
  pline(ctx, nx, ny + 8, nx, ny, PAL.ink); pline(ctx, nx, ny, nx - 2, ny + 3, PAL.ink); pline(ctx, nx, ny, nx + 2, ny + 3, PAL.ink);
  drawText(ctx, 'N', nx, ny - 8, PAL.ink, { font: 'small', align: 'center' });
}

// ============================================================ story frame + notes
/** Caption lines (whole text wrapped first, so words never jump) and how many characters of each are showing. */
export function captionLines(caption) {
  const L = LAYOUT.story;
  return wrapText(String(caption).toUpperCase(), L.capW, { spacing: L.spacing });
}
export function revealLines(lines, typed) {
  let left = typed;
  return lines.map((l) => { const n = [...l].length; const shown = [...l].slice(0, Math.max(0, left)).join(''); left -= n + 1; return shown; });
}

/** A full-bleed painting with the caption set in a dithered dark band along its foot, typed out letter by letter. */
function filmFrame(env, spec, caption, typed, since, o = {}) {
  const { ctx, t, SW, SH } = env;
  const acc = accentOfIndex(spec.levelIndex);
  const L = LAYOUT.story;
  drawPanel(ctx, spec, 0, 0, SW, SH, t);
  // the band: the painting shows through a dither of ink, a fine line in the track's hue along its top
  fadeBlack(ctx, 0, L.bandY - 6, SW, 3, 0.25);
  fadeBlack(ctx, 0, L.bandY - 3, SW, 3, 0.5);
  fadeBlack(ctx, 0, L.bandY, SW, SH - L.bandY, 0.82);
  ctx.fillStyle = acc;
  for (let x = 0; x < SW; x += 2) ctx.fillRect(x, L.bandY, 1, 1);
  // caption
  const lines = captionLines(caption);
  const shown = revealLines(lines, typed);
  const total = lines.reduce((n, l) => n + [...l].length + 1, 0) - 1;
  shown.slice(0, L.capLines).forEach((l, i) => {
    if (l) drawText(ctx, l, L.capX, L.capY + i * 10, PAL.paper2, { spacing: L.spacing, shadow: PAL.ink });
  });
  const done = typed >= total;
  let li = 0, rem = typed;
  while (li < lines.length - 1 && rem > [...lines[li]].length) { rem -= [...lines[li]].length + 1; li++; }
  const lastW = measureText(shown[li] || '', { spacing: L.spacing });
  if (!done && Math.floor(t * 8) % 2 === 0) rect(ctx, L.capX + lastW + (shown[li] ? 2 : 0), L.capY + li * 10, 5, 7, PAL.rock);
  if (done && o.more !== false && blink(t, 1.6, 0.6)) {
    const mx = L.capX + L.capW + 6, my = L.capY + 2;
    for (let k = 0; k < 4; k++) rect(ctx, mx + k, my + k, 7 - 2 * k, 1, acc);
  }
  fadeBlack(ctx, 0, 0, SW, SH, 1 - clamp(since / 0.6, 0, 1));
  return { acc, done, lines };
}

function story(env) {
  const { ctx, ui, SW, SH } = env;
  const st = ui.story;
  if (!st) { rect(ctx, 0, 0, SW, SH, PAL.ink); return; }
  const acc = filmFrame(env, st.panel, st.caption, st.typed, st.t).acc;
  if (st.total > 1) for (let i = 0; i < st.total; i++) rect(ctx, 8 + i * 7, 208, 4, 2, i === st.index ? acc : PAL.dusk);
  drawText(ctx, STORY.skip, SW - 8, 208, PAL.rock, { font: 'small', align: 'right', spacing: 1 });
}

let notePage = { page: -1, t0: 0 };
function notes(env) {
  const { ctx, ui, t, SW, SH, state } = env;
  const list = ui.notes || [];
  const lv = (state && ((state.world && state.world.level) || state.level)) || null;
  const li = lv && lv.index != null ? lv.index : (state && state.levelIndex) || 0;
  const spec = { kind: 'bothy', levelIndex: li };
  const page = clamp(ui.scroll | 0, 0, Math.max(0, list.length - 1));
  if (notePage.page !== page || t < notePage.t0) notePage = { page, t0: t };
  const text = list.length ? String(list[page]) : NOTES.empty;
  const since = t - notePage.t0;
  const typed = revealCount([...text].length, since * 1000);
  const acc = accentOfIndex(li);
  filmFrame(env, spec, text, typed, since, { more: false });
  // heading and count above the picture, page marks below
  drawText(ctx, NOTES.heading, 8, 6, PAL.paper2, { font: 'small', spacing: 2, halo: PAL.ink });
  drawText(ctx, fmt(NOTES.count, { n: list.length }), SW - 8, 6, PAL.rock, { font: 'small', spacing: 1, align: 'right', halo: PAL.ink });
  if (list.length > 1) {
    drawText(ctx, fmt(STORY.page, { n: page + 1, N: list.length }), 8, 208, acc, { font: 'small', spacing: 1 });
    if (page > 0) drawText(ctx, '↑', 34, 206, acc, {});
    if (page < list.length - 1) drawText(ctx, '↓', 42, 206, acc, {});
  }
  drawText(ctx, STORY.notesFooter, SW - 8, 208, PAL.rock, { font: 'small', align: 'right', spacing: 1 });
}

// ================================================================= complete
function motifStave(ctx, cx, y, t, acc = PAL.magenta) {
  // five lines + the contour motif [0,2,4,1,3] as notes
  const w = 70;
  const x = cx - w / 2;
  for (let i = 0; i < 5; i++) hline(ctx, x, y + i * 3, w, PAL.ink);
  const motif = [0, 2, 4, 1, 3];
  motif.forEach((deg, i) => {
    const nx = x + 8 + i * 13, ny = y + 12 - deg * 1.5;
    const on = Math.floor(t * 4) % 5 === i;
    const col = on ? acc : PAL.ink;
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
  const acc = accentOfLevel(lv), onAcc = onFill(acc);
  // the banner is set at 2x when it fits on one line, otherwise it wraps (still 2x) and the card grows
  const w = LAYOUT.complete.w;
  const bannerLines = wrapText(COMPLETE.banner, (w - 24) / 2, { spacing: 2 }).slice(0, 3);
  const extra = (bannerLines.length - 1) * 17;
  const h = 146 + extra;
  const x = Math.round((SW - w) / 2);
  const y = Math.round((SH - h) / 2 - 8 + (1 - ease) * -40);
  panel(ctx, x, y, w, h, { fill: PAL.paper, shadow: null, inner: acc });
  rect(ctx, x + 4, y + 4, w - 8, 30 + extra, acc);
  bannerLines.forEach((l, i) => {
    drawText(ctx, l, SW / 2 + 2, y + 10 + 2 + i * 17, onAcc === PAL.snow ? PAL.ink : PAL.snow, { scale: 2, spacing: 2, align: 'center' });
    drawText(ctx, l, SW / 2, y + 10 + i * 17, onAcc, { scale: 2, spacing: 2, align: 'center' });
  });
  const gate = state && state.world && state.world.gate;
  drawText(ctx, gate ? gate.name : 'Bealach', SW / 2, y + 40 + extra, PAL.contourIdx, { italic: true, align: 'center' });
  ctx.drawImage(gateSprite(true), Math.round(SW / 2 - 5), y + 52 + extra);
  const num = ROMAN[idx] || String(idx + 1);
  drawText(ctx, fmt(COMPLETE.line, { numeral: num }), SW / 2, y + 68 + extra, PAL.ink, { align: 'center', spacing: 1 });
  drawText(ctx, String(lv.subtitle || lv.name || '').toUpperCase(), SW / 2, y + 79 + extra, PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
  motifStave(ctx, SW / 2 - 52, y + 92 + extra, t, acc);
  const nf = ui.fragmentCount != null ? ui.fragmentCount : ((state && state.fragments) || []).length;
  drawText(ctx, fmt(COMPLETE.motifCounter, { n: Math.max(nf, idx + 1) }), SW / 2 + 6, y + 91 + extra, PAL.ink, { font: 'small', spacing: 1 });
  drawText(ctx, COMPLETE.motifDone, SW / 2 + 6, y + 99 + extra, PAL.contourIdx, { font: 'small', spacing: 1 });
  // next track
  const next = ui.next || (ui.levels && ui.levels[idx + 1]);
  hline(ctx, x + 8, y + h - 33, w - 16, PAL.grid);
  if (next) {
    drawText(ctx, COMPLETE.nextHeading, x + 10, y + h - 27, PAL.contourIdx, { font: 'small', spacing: 1 });
    drawText(ctx, String(next.name).toUpperCase(), x + 10, y + h - 20, PAL.ink, { spacing: 1 });
    drawText(ctx, String(next.subtitle || '').toUpperCase(), x + w - 10, y + h - 19, PAL.contourIdx, { font: 'small', align: 'right', spacing: 1 });
  } else {
    const last = wrapText(COMPLETE.lastTrack, w - 20, { spacing: 1 }).slice(0, 2);
    last.forEach((l, i) => drawText(ctx, l, SW / 2, y + h - 27 + i * 9 + (last.length > 1 ? 0 : 5), PAL.ink, { align: 'center', spacing: 1 }));
  }
  if (blink(t, 1.3, 0.65)) drawText(ctx, COMPLETE.prompt, SW / 2, y + h - 9, PAL.ink, { font: 'small', align: 'center', spacing: 2 });
}

export const Screens = { title, select, pause, map: mapScreen, notes, complete, story };
