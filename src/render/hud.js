/**
 * Play-view HUD in the OS legend-margin style. Compact: the map is the star.
 */
import { PAL } from './palette.js';
import { drawText, measureText, wrapText } from './font.js';
import { rect, frame, hline, vline, pline, panel, px, clamp } from './draw.js';
import { iconSprite, iconMono, gateSprite, timeSprite, blit, artCanvas } from './sprites.js';
import { CELL_PX, SCREEN_W, SCREEN_H, ARTEFACT_NAMES } from '../world/codes.js';

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

export function drawStrip(ctx, st, ui) {
  const w = st.world, p = st.player, lv = (w && w.level) || st.level || {};
  rect(ctx, 0, 0, SCREEN_W, STRIP_H, PAL.paper);
  hline(ctx, 0, STRIP_H - 1, SCREEN_W, PAL.ink);
  // ruler ticks inside the border
  ctx.fillStyle = PAL.grid;
  for (let i = 0; i < SCREEN_W; i += 8) ctx.fillRect(i, STRIP_H - 3 + (i % 32 === 0 ? -1 : 0), 1, 2 + (i % 32 === 0 ? 1 : 0));
  // left: name + subtitle
  const name = String(lv.name || '').toUpperCase();
  let x = 4;
  x += drawText(ctx, name, x, 2, PAL.ink, {}) + 6;
  const sub = String(lv.subtitle || '').toUpperCase();
  if (sub) drawText(ctx, sub, x, 4, PAL.contourIdx, { font: 'small' });
  // right cluster (right to left)
  let rx = SCREEN_W - 4;
  const phase = st.phase || 'day';
  blit(ctx, timeSprite(phase), rx - 9, 2);
  rx -= 9 + 6;
  const brg = String(bearingDeg(p.heading || 0)).padStart(3, '0') + '°';
  const bw = measureText(brg, {});
  drawText(ctx, brg, rx - bw, 3, PAL.ink, {});
  rx -= bw + 2;
  compass(ctx, rx - 9, 2, p.heading || 0);
  rx -= 9 + 8;
  const alt = `ALT ${Math.round(p.elevation || 0)}m`;
  const aw = measureText(alt, {});
  drawText(ctx, alt, rx - aw, 3, PAL.ink, {});
  rx -= aw + 8;
  const ref = gridRef(w, p.x, p.y);
  const rw = measureText(ref, {});
  drawText(ctx, ref, rx - rw, 3, PAL.waterInk, {});
}

function drawMinimap(ctx, st, R) {
  const mini = R.mini;
  if (!mini) return;
  const x = SCREEN_W - MINI - 4, y = STRIP_H + 3;
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

function drawChain(ctx, st, R) {
  const w = st.world;
  const chain = st.chainProgress || [];
  const res = st.resonance || [];
  let y = SCREEN_H - 3;
  const clock = R.clock || 0;
  // gate chain panel
  if (chain.length) {
    const cw = 4 + chain.length * 14 + 11 + 3;
    const ch = 14;
    const x = 4;
    y -= ch;
    panel(ctx, x, y, cw, ch, {});
    let ix = x + 3;
    const anyLit = chain.some((c) => c.resonating);
    const allLit = chain.every((c) => c.resonating);
    chain.forEach((c, i) => {
      const lit = !!c.resonating;
      rect(ctx, ix - 1, y + 2, 10, 10, lit ? PAL.paper : PAL.paper2);
      frame(ctx, ix - 1, y + 2, 10, 10, lit ? PAL.magenta : PAL.rock);
      ctx.drawImage(iconSprite(c.type, lit), ix, y + 3);
      if (lit) { // gentle pulse tick on the corner
        if (Math.floor(clock * 2 + i) % 2 === 0) px(ctx, ix + 8, y + 2, PAL.snow);
      }
      // connector chevron
      const cx = ix + 10;
      ctx.fillStyle = (lit && (chain[i + 1] ? chain[i + 1].resonating : st.gateOpen)) ? PAL.magenta : PAL.rock;
      ctx.fillRect(cx, y + 6, 1, 3); ctx.fillRect(cx + 1, y + 7, 1, 1);
      ix += 14;
    });
    // gate glyph at the end
    const gs = gateSprite(!!st.gateOpen);
    const gx = ix - 1, gy = y + 2;
    if (st.gateOpen) {
      if (Math.floor(clock * 3) % 2 === 0) frame(ctx, gx - 1, gy - 1, 13, 12, PAL.snow);
    }
    ctx.drawImage(gs, gx, gy);
    if (!st.gateOpen && allLit) frame(ctx, gx - 1, gy - 1, 13, 12, PAL.magenta);
    void anyLit;
  }
  // resonance glyphs with draining bars
  if (res.length) {
    const rw = 4 + res.length * 11 + 1;
    const rh = 15;
    y -= rh + 2;
    panel(ctx, 4, y, rw, rh, {});
    let ix = 7;
    for (const r of res) {
      const s = clamp(r.strength == null ? 1 : r.strength, 0, 1);
      ctx.drawImage(iconSprite(r.type, true), ix, y + 2);
      rect(ctx, ix, y + 11, 8, 2, PAL.rock);
      const bw = Math.max(s > 0 ? 1 : 0, Math.round(8 * s));
      rect(ctx, ix, y + 11, bw, 2, s > 0.25 ? PAL.magenta : PAL.contourIdx);
      ix += 11;
    }
  }
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
  if (kind === 'artefact') {
    const text = String(msg).toUpperCase();
    const reveal = Math.min(text.length, Math.floor(elapsed * 40) + 1);
    const shown = text.slice(0, reveal);
    const full = measureText(text, { spacing: 3 });
    const bw = full + 28;
    const sub = ui.messageSub ? String(ui.messageSub).toUpperCase() : '';
    const bh = sub ? 27 : 18;
    const x = Math.round(SCREEN_W / 2 - bw / 2);
    panel(ctx, x, y0, bw, bh, { fill: PAL.paper, inner: null });
    rect(ctx, x + 1, y0 + 1, bw - 2, 2, fade ? PAL.rock : PAL.magenta);
    // end ticks
    rect(ctx, x + 5, y0 + 8, 3, 1, fade ? PAL.rock : PAL.magenta);
    rect(ctx, x + bw - 8, y0 + 8, 3, 1, fade ? PAL.rock : PAL.magenta);
    drawText(ctx, shown, x + 14, y0 + 5, col, { spacing: 3 });
    if (sub) {
      drawText(ctx, sub, SCREEN_W / 2, y0 + 17, fade ? PAL.rock : PAL.contourIdx, { font: 'small', align: 'center', spacing: 1 });
    }
  } else {
    const maxW = 250;
    const lines = wrapText(String(msg), maxW, { italic: false }).slice(0, 3);
    const lw = Math.max(...lines.map((l) => measureText(l, {})));
    const bw = lw + 16, bh = lines.length * 10 + 7;
    const x = Math.round(SCREEN_W / 2 - bw / 2);
    panel(ctx, x, y0, bw, bh, { fill: PAL.paper2 });
    rect(ctx, x + 1, y0 + 1, 3, bh - 2, fade ? PAL.rock : PAL.magenta);
    lines.forEach((l, i) => drawText(ctx, l, x + 9, y0 + 4 + i * 10, col, {}));
  }
}

/** Full HUD. R = { mini, clock } from the renderer. */
export function drawHud(ctx, st, ui, R) {
  drawStrip(ctx, st, ui);
  if (!ui || ui.showMinimap !== false) drawMinimap(ctx, st, R);
  drawChain(ctx, st, R);
  drawMessage(ctx, ui, R);
}
