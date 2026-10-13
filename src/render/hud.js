/**
 * Play-view HUD in the OS legend-margin style. Compact: the map is the star.
 */
import { PAL } from './palette.js';
import { drawText, measureText, wrapText } from './font.js';
import { rect, frame, hline, vline, pline, panel, px, clamp, pdisc, pcircle, pcircleDotted } from './draw.js';
import { iconSprite, iconMono, gateSprite, timeSprite, blit, artCanvas, touchIcon, arrowSprite, octantOf } from './sprites.js';
import { typeShort } from './glyphs.js';
import { CELL_PX, SCREEN_W, SCREEN_H, ARTEFACT_NAMES, RESONANCE_SECONDS } from '../world/codes.js';

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

export function drawStrip(ctx, st, ui, R) {
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
  // right cluster: kept clear of touch buttons, dropping the least important items if space is short
  let rEnd = SCREEN_W - 4;
  if (R && R.touchLeft) rEnd = Math.min(rEnd, R.touchLeft - 4);
  const limit = x + (sub ? measureText(sub, { font: 'small' }) : 0) + 8;
  const phase = st.phase || 'day';
  const brg = String(bearingDeg(p.heading || 0)).padStart(3, '0') + '\u00b0';
  const alt = `ALT ${Math.round(p.elevation || 0)}m`;
  const ref = gridRef(w, p.x, p.y);
  const items = {
    ref: { w: measureText(ref, {}), draw: (X) => drawText(ctx, ref, X, 3, PAL.waterInk, {}) },
    alt: { w: measureText(alt, {}), draw: (X) => drawText(ctx, alt, X, 3, PAL.ink, {}) },
    brg: { w: 9 + 2 + measureText(brg, {}), draw: (X) => { compass(ctx, X, 2, p.heading || 0); drawText(ctx, brg, X + 11, 3, PAL.ink, {}); } },
    time: { w: 9, draw: (X) => blit(ctx, timeSprite(phase), X, 2) },
  };
  const gap = 8;
  let avail = rEnd - limit, use = [];
  for (const k of ['ref', 'alt', 'brg', 'time']) {
    const need = items[k].w + (use.length ? gap : 0);
    if (need <= avail) { use.push(k); avail -= need; }
  }
  let rx = rEnd;
  for (const k of ['time', 'brg', 'alt', 'ref']) {
    if (!use.includes(k)) continue;
    rx -= items[k].w;
    items[k].draw(rx);
    rx -= gap;
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

const CELL_H = 24;
const CHAIN_W = 40, GATE_W = 46, CHEV = 5;

/** km text for a distance in cells (40 m per cell). */
function kmText(dist) {
  if (!(dist > 3)) return 'HERE';
  return (dist * 0.04).toFixed(1) + 'KM';
}

function lineTwo(ctx, x, y, oct, dist, color, clock) {
  const near = dist <= 3;
  if (!near) ctx.drawImage(arrowSprite(oct, color), x + 1, y);
  else if (Math.floor(clock * 3) % 2 === 0) { rect(ctx, x + 2, y + 2, 3, 3, color); }
  drawText(ctx, kmText(dist), x + 10, y + 1, PAL.ink, { font: 'small' });
}

function drainBar(ctx, x, y, w, frac, secs) {
  const f = clamp(frac, 0, 1);
  rect(ctx, x, y, w, 5, PAL.paper2);
  frame(ctx, x, y, w, 5, PAL.rock);
  const bw = Math.max(f > 0 ? 1 : 0, Math.round((w - 2) * f));
  rect(ctx, x + 1, y + 1, bw, 3, f > 0.25 ? PAL.magenta : PAL.contourIdx);
  drawText(ctx, Math.max(0, Math.ceil(secs)) + 'S', x + w + 2, y, PAL.ink, { font: 'small' });
}

function drawChain(ctx, st, R) {
  const w = st.world;
  const chain = st.chainProgress || [];
  const res = st.resonance || [];
  const p = st.player;
  const clock = R.clock || 0;
  let y = SCREEN_H - 3;
  if (chain.length) {
    const gate = w && w.gate;
    let total = 6;
    for (let i = 0; i < chain.length; i++) total += CHAIN_W + CHEV;
    total += GATE_W;
    y -= CELL_H;
    panel(ctx, 4, y, total, CELL_H, {});
    const allLit = chain.every((c) => c.resonating);
    let cx = 7;
    chain.forEach((c, i) => {
      const lit = !!c.resonating;
      // icon box
      rect(ctx, cx, y + 2, 10, 10, lit ? PAL.paper : PAL.paper2);
      frame(ctx, cx, y + 2, 10, 10, lit ? PAL.magenta : PAL.rock);
      ctx.drawImage(iconSprite(c.type, true), cx + 1, y + 3);
      if (lit && Math.floor(clock * 2 + i) % 2 === 0) px(ctx, cx + 9, y + 2, PAL.snow);
      drawText(ctx, typeShort(c.type), cx + 12, y + 4, lit ? PAL.ink : PAL.contourIdx, { font: 'small' });
      // line two
      const ly = y + 14;
      if (lit) {
        let secs = c.remaining;
        if (secs == null) { const r = res.find((q) => q.type === c.type); secs = r ? (r.strength == null ? 1 : r.strength) * RESONANCE_SECONDS : 0; }
        drainBar(ctx, cx + 1, ly + 1, 20, secs / RESONANCE_SECONDS, secs);
      } else if (c.nearest) {
        const n = c.nearest;
        const brg = n.bearing != null ? n.bearing : Math.atan2(n.y - p.y, n.x - p.x);
        const dist = n.dist != null ? n.dist : Math.hypot(n.x - p.x, n.y - p.y);
        lineTwo(ctx, cx, ly, octantOf(brg), dist, PAL.magenta, clock);
      } else {
        hline(ctx, cx + 2, ly + 3, 5, PAL.rock);
      }
      // connector chevron
      const nx = cx + CHAIN_W;
      const next = chain[i + 1];
      ctx.fillStyle = (lit && (next ? next.resonating : st.gateOpen)) ? PAL.magenta : PAL.rock;
      ctx.fillRect(nx, y + 6, 1, 3); ctx.fillRect(nx + 1, y + 7, 1, 1);
      cx += CHAIN_W + CHEV;
    });
    // gate cell
    const open = !!st.gateOpen;
    const gs = gateSprite(open);
    if (open && Math.floor(clock * 3) % 2 === 0) frame(ctx, cx - 1, y + 1, 13, 12, PAL.snow);
    if (!open && allLit) frame(ctx, cx - 1, y + 1, 13, 12, PAL.magenta);
    ctx.drawImage(gs, cx, y + 2);
    drawText(ctx, 'BEALACH', cx + 14, y + 4, open ? PAL.magenta : PAL.ink, { font: 'small' });
    const ly = y + 14;
    if (open) drawText(ctx, 'OPEN', cx + 3, ly + 1, PAL.magenta, { font: 'small' });
    else if (gate && p) {
      const dx = gate.x - p.x, dy = gate.y - p.y;
      lineTwo(ctx, cx, ly, octantOf(Math.atan2(dy, dx)), Math.hypot(dx, dy), allLit ? PAL.magenta : PAL.waterInk, clock);
    }
  }
  // artefacts sounding that are not part of the key: a slim row above the bar
  const extra = res.filter((r) => !chain.some((c) => c.type === r.type));
  if (extra.length) {
    const rw = 6 + extra.length * 14, rh = 14;
    y -= rh + 2;
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
    // UNWOKEN: muted contour-brown banner. Title, poetic hint (italic), plain instruction (main font, wrapped).
    const maxW = 252;
    const title = String(msg).toUpperCase();
    const poetic = ui.messageSub ? wrapText(String(ui.messageSub), maxW, { italic: true }).slice(0, 2) : [];
    const plain = ui.messageSub2 ? wrapText(String(ui.messageSub2), maxW - 8, {}).slice(0, 3) : [];
    let lw = measureText(title, { spacing: 2 });
    for (const l of poetic) lw = Math.max(lw, measureText(l, { italic: true }));
    for (const l of plain) lw = Math.max(lw, measureText(l, {}) + 8);
    const bw = Math.min(maxW + 20, Math.max(150, lw + 20));
    const bh = 15 + poetic.length * 10 + (plain.length ? plain.length * 10 + 5 : 0) + 3;
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

function drawResting(ctx, st, R) {
  const p = st.player;
  if (!p || !p.resting) return;
  const clock = R.clock || 0;
  const w = 98, h = 27;
  const x = Math.round(SCREEN_W / 2 - w / 2), y = SCREEN_H - 3 - h;
  panel(ctx, x, y, w, h, {});
  // sun / moon arc
  const tod = ((st.timeOfDay || 0) % 1 + 1) % 1;
  const cx = x + 25, base = y + 20, rx = 19, ry = 11;
  hline(ctx, cx - rx - 1, base, rx * 2 + 3, PAL.rock);
  ctx.fillStyle = PAL.grid;
  for (let i = 0; i <= 20; i++) {
    const a = (i / 20) * Math.PI;
    if (i % 2 === 0) ctx.fillRect(Math.round(cx - Math.cos(a) * rx), Math.round(base - Math.sin(a) * ry), 1, 1);
  }
  const day = tod < 0.5;
  const f = day ? tod * 2 : (tod - 0.5) * 2;
  const a = clamp(f, 0.03, 0.97) * Math.PI;
  const sx = Math.round(cx - Math.cos(a) * rx), sy = Math.round(base - Math.sin(a) * ry);
  ctx.drawImage(timeSprite(day ? 'day' : 'night'), sx - 4, sy - 5);
  // label
  const dots = '.'.repeat(1 + (Math.floor(clock * 2) % 3));
  drawText(ctx, 'LISTENING', x + 50, y + 6, PAL.ink, { font: 'small', spacing: 0 });
  drawText(ctx, dots, x + 50 + 9 * 5 + 1, y + 6, PAL.magenta, { font: 'small' });
  drawText(ctx, 'TIME X8', x + 50, y + 15, PAL.contourIdx, { font: 'small' });
  // small blinking ear tick
  if (Math.floor(clock * 3) % 2 === 0) px(ctx, x + w - 5, y + 5, PAL.magenta);
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
      drawText(ctx, 'DRAG', cx, cy + rad + 4, PAL.rock, { font: 'small', align: 'center' });
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
    if (h >= 22 && (b.id === 'run' || b.id === 'rest') && measureText(b.id === 'run' ? 'RUN' : 'LISTEN', { font: 'small' }) <= w - 4) drawText(ctx, b.id === 'run' ? 'RUN' : 'LISTEN', x + w / 2, y + h - 7, held ? PAL.snow : PAL.contourIdx, { font: 'small', align: 'center' });
  }
}

/** Full HUD. R = { mini, clock } from the renderer. */
export function drawHud(ctx, st, ui, R) {
  R.miniY = 0; R.touchLeft = 0;
  if (ui && ui.touchVisible && ui.touch && ui.touch.buttons && R.canvas && R.canvas.getBoundingClientRect) {
    const rc = R.canvas.getBoundingClientRect();
    if (rc.height) for (const b of ui.touch.buttons) {
      const bot = ((b.y + b.h) - rc.top) * (SCREEN_H / rc.height);
      if (bot < SCREEN_H * 0.4) {
        R.miniY = Math.max(R.miniY, Math.ceil(bot) + 4);
        const lx = (b.x - rc.left) * (SCREEN_W / rc.width);
        if (bot > 2 && (!R.touchLeft || lx < R.touchLeft)) R.touchLeft = Math.floor(lx);
      }
    }
  }
  drawStrip(ctx, st, ui, R);
  if (!ui || ui.showMinimap !== false) drawMinimap(ctx, st, R);
  drawChain(ctx, st, R);
  drawResting(ctx, st, R);
  drawMessage(ctx, ui, R);
  drawTouch(ctx, ui, R);
}
