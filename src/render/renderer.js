/**
 * CONTOURS renderer. 384x216 framebuffer, integer-scaled, strict 16-colour palette.
 *
 * createRenderer(canvas) -> Renderer
 *   setWorld(world)            bake the OS-style sheet (+ minimap / sheet overview)
 *   draw(state, ui)            ui.screen: 'title'|'select'|'play'|'pause'|'map'|'notes'|'complete'
 *   flashContour(index, t[, dir])  highlight contour line `index` (see below)
 *   ripple(x, y, t, color)     expanding ring from cell (x,y); brightens contour pixels it crosses
 *   pulse(type)                artefact fired: bloom of its icon + ring around the player
 *   resize()                   integer-scale to the window, letterboxed and centred
 *
 * Lifetimes of flashes/ripples are measured on the renderer clock (driven by
 * ui.time || state.t || wall clock), so `t` arguments are accepted but not needed.
 */
import { COVER, CELL_PX, SCREEN_W, SCREEN_H, dayPhase } from '../world/codes.js';
import { PAL, PAL_U32 as U, applyTint, tintAt, BAYER8 } from './palette.js';
import { LVL_OFF, bakeMap, bakeOverview, gatePlacement } from './mapbake.js';
import { walkerSprite, iconSprite, gateSprite, blit, symbolArt, tickSprite } from './sprites.js';
import { drawText } from './font.js';
import { rect, frame, px, resolveColor, clamp, ditherRect } from './draw.js';
import { drawHud, STRIP_H } from './hud.js';
import { Screens } from './screens.js';

const FLASH_DUR = 0.6;
const RIPPLE_DUR = 1.7;
const RIPPLE_MAX = 170;
const PULSE_DUR = 0.9;
const TRAIL_MAX = 28;
const FLASH_STEPS = [U.snow, U.magenta, U.magenta, U.contourIdx];

const PULSE_COLOR = {
  trig: 'waterInk', cairn: 'contourIdx', lochan: 'waterDeep', waterfall: 'waterInk',
  bothy: 'magenta', stone: 'ink', crag: 'ink', summit: 'magenta',
};

export function createRenderer(canvas) {
  const SW = SCREEN_W, SH = SCREEN_H;
  canvas.width = SW;
  canvas.height = SH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const fbImg = ctx.createImageData(SW, SH);
  const fb = new Uint32Array(fbImg.data.buffer);

  const R = {
    canvas, ctx, SW, SH,
    world: null, baked: null, mini: null, bigMap: null,
    clock: 0, lastNow: null, wall0: null,
    cam: { x: 0, y: 0, ready: false },
    flashes: [], ripples: [], pulses: [], trail: [],
    walker: { dir: 'S', stride: 0, lastX: null, lastY: null },
    screen: null, screenSince: 0, lastState: null, bakeMs: 0,
    flashLut: new Uint32Array(1024),
    scale: 1,
  };

  // ----------------------------------------------------------- world setup
  function setWorld(world) {
    R.world = world;
    R.baked = null; R.mini = null; R.bigMap = null;
    R.cam.ready = false;
    R.flashes.length = 0; R.ripples.length = 0; R.pulses.length = 0; R.trail.length = 0;
    if (!world) return;
    R.baked = bakeMap(world);
    R.bakeMs = R.baked.bakeMs;
    R.mini = bakeOverview(world, 48, { contourEvery: (world.contourInterval || 10) * 5 });
    R.bigMap = bakeOverview(world, 188, { contourEvery: (world.contourInterval || 10) * 5, grid: true });
  }

  // ------------------------------------------------------------ feedback fx
  function flashContour(index, t, dir) {
    const level = dir != null && dir < 0 ? index + 1 : index;
    R.flashes.push({ lvl: level + LVL_OFF, t0: R.clock });
    if (R.flashes.length > 10) R.flashes.shift();
  }
  function ripple(x, y, t, color) {
    const c = resolveColor(color, 'magenta');
    R.ripples.push({ x: x * CELL_PX, y: y * CELL_PX, t0: R.clock, u32: c.u32 });
    if (R.ripples.length > 6) R.ripples.shift();
  }
  function pulse(type) {
    R.pulses.push({ type, t0: R.clock });
    if (R.pulses.length > 4) R.pulses.shift();
    const st = R.lastState;
    if (st && st.player) ripple(st.player.x, st.player.y, 0, PULSE_COLOR[type] || 'magenta');
  }

  // ----------------------------------------------------------------- clock
  function tick(state, ui) {
    let now;
    if (ui && typeof ui.time === 'number') now = ui.time;
    else if (state && typeof state.t === 'number') now = state.t;
    else {
      const w = typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000;
      if (R.wall0 == null) R.wall0 = w;
      now = w - R.wall0;
    }
    if (R.lastNow != null && now < R.lastNow - 0.5) {      // clock restarted (new session / level): drop old effects
      R.flashes.length = 0; R.ripples.length = 0; R.pulses.length = 0; R.trail.length = 0; R.cam.ready = false;
      R.lastNow = null;
    }
    let dt = R.lastNow == null ? 0 : now - R.lastNow;
    if (!(dt >= 0) || dt > 0.25) dt = dt > 0.25 ? 0.016 : 0;
    R.lastNow = now;
    R.clock = now;
    return dt;
  }

  // ---------------------------------------------------------- play pipeline
  function updateCamera(state, dt) {
    const p = state.player, mapPx = R.world.size * CELL_PX;
    const tx = clamp(p.x * CELL_PX - SW / 2, 0, mapPx - SW);
    const ty = clamp(p.y * CELL_PX - (STRIP_H + (SH - STRIP_H) / 2), 0, mapPx - SH);
    const c = R.cam;
    if (!c.ready) { c.x = tx; c.y = ty; c.ready = true; return; }
    const k = 1 - Math.exp(-Math.max(dt, 0.0001) * 7);
    c.x += (tx - c.x) * k;
    c.y += (ty - c.y) * k;
    if (Math.abs(tx - c.x) < 0.05) c.x = tx;
    if (Math.abs(ty - c.y) < 0.05) c.y = ty;
  }

  function copyMapRegion(camX, camY) {
    const MW = R.baked.W, src = R.baked.pixels;
    for (let y = 0; y < SH; y++) {
      const so = (camY + y) * MW + camX;
      fb.set(src.subarray(so, so + SW), y * SW);
    }
  }

  function applyFlashes(camX, camY) {
    const fl = R.flashes;
    if (!fl.length) return;
    const lut = R.flashLut;
    lut.fill(0);
    for (let i = fl.length - 1; i >= 0; i--) {
      const f = fl[i], a = (R.clock - f.t0) / FLASH_DUR;
      if (a >= 1) { fl.splice(i, 1); continue; }
      if (a < 0) continue;
      const step = a < 0.12 ? 0 : a < 0.4 ? 1 : a < 0.7 ? 2 : 3;
      lut[f.lvl & 1023] = FLASH_STEPS[step];
    }
    if (!fl.length) return;
    const MW = R.baked.W, lvl = R.baked.lvl;
    for (let y = 0; y < SH; y++) {
      const mo = (camY + y) * MW + camX;
      for (let x = 0; x < SW; x++) {
        const l = lvl[mo + x];
        if (l) {
          const c = lut[l & 1023];
          if (c) {
            fb[y * SW + x] = c;
            if (x + 1 < SW && !lvl[mo + x + 1]) fb[y * SW + x + 1] = c;
          }
        }
      }
    }
  }

  function applyRipples(camX, camY) {
    const rp = R.ripples;
    if (!rp.length) return;
    const MW = R.baked.W, lvl = R.baked.lvl;
    for (let i = rp.length - 1; i >= 0; i--) {
      const r = rp[i], age = R.clock - r.t0;
      if (age >= RIPPLE_DUR) { rp.splice(i, 1); continue; }
      if (age < 0) continue;
      const a = age / RIPPLE_DUR;
      const rad = RIPPLE_MAX * (1 - (1 - a) * (1 - a));
      const half = 5.5 * (1 - a * 0.6) + 1;
      const cx = r.x - camX, cy = r.y - camY;
      const x0 = Math.max(0, Math.floor(cx - rad - half)), x1 = Math.min(SW - 1, Math.ceil(cx + rad + half));
      const y0 = Math.max(0, Math.floor(cy - rad - half)), y1 = Math.min(SH - 1, Math.ceil(cy + rad + half));
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const d = Math.sqrt(dx * dx + dy * dy);
          const e = Math.abs(d - rad);
          if (e > half) continue;
          const mo = (camY + y) * MW + camX + x;
          if (lvl[mo]) {
            // contour pixel inside the annulus brightens: leading edge white, trailing ring colour
            fb[y * SW + x] = (d > rad - half * 0.35 && a < 0.7) ? U.snow : r.u32;
          } else if (e < 1.2 && ((x + y) & 1) === 0 && a < 0.85) {
            fb[y * SW + x] = r.u32;
          } else if (e < half * 0.7 && a < 0.5 && ((BAYER8[((y + camY) & 7) * 8 + ((x + camX) & 7)] / 64) > 0.78)) {
            fb[y * SW + x] = r.u32;
          }
        }
      }
    }
  }

  function updateTrail(state, dt) {
    const p = state.player;
    const X = p.x * CELL_PX, Y = p.y * CELL_PX;
    const tr = R.trail;
    for (let i = tr.length - 1; i >= 0; i--) if (R.clock - tr[i].t > 2.8) tr.splice(i, 1);
    if (p.moving) {
      const l = tr[tr.length - 1];
      if (!l || Math.hypot(l.x - X, l.y - Y) > 4.5) {
        tr.push({ x: X, y: Y, t: R.clock, cover: p.cover, side: l ? -l.side : 1 });
        if (tr.length > TRAIL_MAX) tr.shift();
      }
    }
  }

  function walkerState(state, dt) {
    const p = state.player, W = R.walker;
    const hx = Math.cos(p.heading || 0), hy = Math.sin(p.heading || 0);
    const ax = Math.abs(hx), ay = Math.abs(hy);
    let d = ax > ay ? (hx > 0 ? 'E' : 'W') : (hy > 0 ? 'S' : 'N');
    if (p.moving || !W.init) {
      const horiz = W.dir === 'E' || W.dir === 'W';
      if (Math.abs(ax - ay) < 0.18 && ((horiz && ax > ay - 0.18) || (!horiz && ay > ax - 0.18)) && W.init) d = W.dir;
      W.dir = d;
      W.init = true;
    }
    if (p.moving) W.stride += (p.speed || 0) * CELL_PX * dt / 5.5;
    return W;
  }

  function drawPlayer(state, camX, camY) {
    const p = state.player, W = R.walker;
    const sx = Math.round(p.x * CELL_PX - camX), sy = Math.round(p.y * CELL_PX - camY);
    // trail
    for (const t of R.trail) {
      const age = R.clock - t.t;
      const x = Math.round(t.x - camX + t.side), y = Math.round(t.y - camY + 1);
      if (x < 0 || y < 0 || x >= SW || y >= SH) continue;
      const col = t.cover === COVER.SNOW ? PAL.grid : t.cover === COVER.SHALLOW ? PAL.waterDeep : t.cover === COVER.BOG ? PAL.woodDark : PAL.contourIdx;
      if (age < 1.0) px(ctx, x, y, col);
      else if (age < 2.0) { if (((x + y) & 1) === 0) px(ctx, x, y, col); }
      else if (((x * 3 + y) & 3) === 0) px(ctx, x, y, col);
    }
    // shadow
    ctx.fillStyle = PAL.ink;
    for (let i = -3; i <= 2; i++) if (((i + sy) & 1) === 0) ctx.fillRect(sx + i, sy, 1, 1);
    for (let i = -2; i <= 1; i++) if (((i + sy) & 1) === 1) ctx.fillRect(sx + i, sy + 1, 1, 1);
    // pose
    const cov = p.cover;
    let pose = p.moving ? 'walk' : 'idle';
    let frame = Math.floor(W.stride) & 1;
    if (p.sliding) pose = 'slide';
    else if (cov === COVER.SHALLOW || cov === COVER.DEEP) { pose = 'wade'; frame = Math.floor(R.clock * 3) & 1; }
    else if (cov === COVER.BOG && p.moving) { pose = 'mud'; frame = Math.floor(R.clock * 3) & 1; }
    const spr = walkerSprite(W.dir, pose, frame);
    let bob = (pose === 'walk' && frame === 1) ? 0 : 0;
    const dx = sx - 6, dy = sy - 11 + bob;
    ctx.drawImage(spr, dx, dy);
    // slide dust
    if (pose === 'slide') {
      ctx.fillStyle = PAL.rock;
      for (let i = 0; i < 5; i++) {
        const ph = (R.clock * 7 + i * 1.7) % 1;
        const ox = -Math.cos(p.heading || 0) * (4 + ph * 8) + (i - 2) * 2, oy = -Math.sin(p.heading || 0) * (3 + ph * 5) - ph * 3;
        if (ph < 0.8) ctx.fillRect(Math.round(sx + ox), Math.round(sy + oy), 1, 1);
      }
    }
    return { sx, sy };
  }

  function drawPoiLayer(state, camX, camY) {
    const w = R.world;
    // discovered markers: magenta corner brackets
    const disc = new Set(state.discovered || []);
    ctx.fillStyle = PAL.magenta;
    for (const poi of w.pois || []) {
      if (!disc.has(poi.id)) continue;
      const x = Math.round(poi.x * CELL_PX + CELL_PX / 2 - camX), y = Math.round(poi.y * CELL_PX + CELL_PX / 2 - camY);
      if (x < -12 || y < -12 || x > SW + 12 || y > SH + 12) continue;
      const r = 7;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        ctx.fillRect(x + sx * r - (sx > 0 ? 2 : 0), y + sy * r, 3, 1);
        ctx.fillRect(x + sx * r, y + sy * r - (sy > 0 ? 2 : 0), 1, 3);
      }
    }
    // what the walker knows: persistent tick beside woken symbols, '?' beside heard-but-unwoken ones
    const know = state.knowledge;
    if (know) {
      for (const poi of w.pois || []) {
        const k = know[poi.id];
        if (!k || (!k.woken && !(k.heard > 0))) continue;
        const art = symbolArt(poi.type);
        const x = Math.round(poi.x * CELL_PX + CELL_PX / 2 - camX), y = Math.round(poi.y * CELL_PX + CELL_PX / 2 - camY);
        if (x < -20 || y < -20 || x > SW + 20 || y > SH + 20) continue;
        const mx = x + (art[0].length >> 1) + 3, my = y - (art.length >> 1) - 7;
        rect(ctx, mx - 2, my - 2, 9, 11, PAL.paper);
        frame(ctx, mx - 2, my - 2, 9, 11, k.woken ? PAL.magenta : PAL.rock);
        if (k.woken) ctx.drawImage(tickSprite(PAL.ink), mx, my + 2);
        else drawText(ctx, '?', mx, my, PAL.ink, {});
      }
    }
    // proximity: a gentle 2px halo round the map symbol (pixels flip every few frames) plus a few motes
    for (const pr of state.proximity || []) {
      const poi = pr.poi;
      if (!poi || !(pr.dist < 25)) continue;
      const k = 1 - pr.dist / 25;
      const x = Math.round(poi.x * CELL_PX + CELL_PX / 2 - camX), y = Math.round(poi.y * CELL_PX + CELL_PX / 2 - camY);
      if (x < -20 || y < -20 || x > SW + 20 || y > SH + 20) continue;
      const art = symbolArt(poi.type);
      const hw = (art[0].length >> 1) + 3, hh = (art.length >> 1) + 3;
      const phase = Math.floor(R.clock * 3) & 1;
      const dens = 0.25 + k * 0.5;                       // fraction of halo pixels lit
      for (let ring = 0; ring < 2; ring++) {
        const rw = hw + ring, rh = hh + ring;
        for (let i = -rw; i <= rw; i++) {
          for (let j = -rh; j <= rh; j++) {
            if (Math.abs(i) !== rw && Math.abs(j) !== rh) continue;
            if (((i + j + phase + ring) & 1) !== 0) continue;
            const th = (BAYER8[(((y + j) & 7) << 3) | ((x + i) & 7)] + 0.5) / 64;
            if (th > dens) continue;
            px(ctx, x + i, y + j, ring === 0 ? PAL.snow : PAL.magenta);
          }
        }
      }
      const n = 2 + Math.round(k * 4);
      for (let i = 0; i < n; i++) {
        const ph = (R.clock * 0.6 + i * 0.37) % 1;
        const ang = i * 2.399 + R.clock * 0.5;
        px(ctx, Math.round(x + Math.cos(ang) * (hw + 3 + ph * 5)), Math.round(y + Math.sin(ang) * (hh + 3 + ph * 5)), ph < 0.7 ? PAL.magenta : PAL.snow);
      }
    }
    // gate: open glow
    const gp = gatePlacement(w);
    if (gp) {
      const gx = gp.x - camX, gy = gp.y - camY;
      if (gx > -30 && gy > -30 && gx < SW + 30 && gy < SH + 30) {
        if (state.gateOpen) {
          blit(ctx, gateSprite(true), gx - 1, gy - 1);
          const t = R.clock;
          for (let i = 0; i < 18; i++) {
            const ang = i / 18 * Math.PI * 2 + t * 0.9;
            const rr = 9 + Math.sin(t * 3 + i) * 2;
            px(ctx, Math.round(gx + gp.w / 2 + Math.cos(ang) * rr * 1.2), Math.round(gy + gp.h / 2 + Math.sin(ang) * rr), i % 2 ? PAL.snow : PAL.magenta);
          }
          // light shaft rising into the map from the arch (dithered, drifting)
          const side = w.gate && w.gate.side;
          const vx = side === 'E' ? -1 : side === 'W' ? 1 : 0, vy = side === 'N' ? 1 : side === 'S' || !side ? -1 : 0;
          const cx0 = gx + gp.w / 2, cy0 = gy + gp.h / 2;
          for (let k = 2; k < 46; k++) {
            const dens = 1 - k / 46;
            for (let d = -5; d <= 5; d++) {
              const f = dens * (1 - Math.abs(d) / 6.5);
              if (f <= 0) continue;
              const th = (BAYER8[(((k + Math.floor(t * 18)) & 7) << 3) | ((d + 8) & 7)] + 0.5) / 64;
              if (th < f * 1.0) {
                const X = Math.round(cx0 + (vx ? vx * k : d)), Y = Math.round(cy0 + (vy ? vy * k : d));
                px(ctx, X, Y, th < f * 0.28 ? PAL.snow : PAL.magenta);
              }
            }
          }
        } else if ((state.chainProgress || []).some((c) => c.resonating)) {
          // faint pulse hint once part of the chain sings
          const on = Math.floor(R.clock * 2) % 2 === 0;
          if (on) { px(ctx, gx - 2, gy + 2, PAL.magenta); px(ctx, gx + gp.w + 1, gy + 2, PAL.magenta); }
        }
      }
    }
    // artefact pulse blooms rising above the player
    for (let i = R.pulses.length - 1; i >= 0; i--) {
      const pl = R.pulses[i], a = (R.clock - pl.t0) / PULSE_DUR;
      if (a >= 1) { R.pulses.splice(i, 1); continue; }
      if (a < 0) continue;
      const p = state.player;
      const x = Math.round(p.x * CELL_PX - camX - 4), y = Math.round(p.y * CELL_PX - camY - 16 - a * 12);
      if (a < 0.8 || Math.floor(a * 20) % 2 === 0) ctx.drawImage(iconSprite(pl.type, true), x, y);
    }
  }

  function renderWorldLayer(state, ui, dt, dim) {
    if (state.world && state.world !== R.world) setWorld(state.world);
    if (!R.baked) { rect(ctx, 0, 0, SW, SH, PAL.night); return false; }
    updateCamera(state, dt);
    const camX = Math.round(R.cam.x), camY = Math.round(R.cam.y);
    copyMapRegion(camX, camY);
    const tint = tintAt(state.timeOfDay != null ? state.timeOfDay : 0.3, state.world && state.world.level && state.world.level.palette && state.world.level.palette.tint);
    applyTint(fb, SW, SH, dim ? { night: dim, warm: 0, wash: [] } : tint, camX, camY);
    applyFlashes(camX, camY);     // after the tint so feedback stays bright at night
    applyRipples(camX, camY);
    ctx.putImageData(fbImg, 0, 0);
    updateTrail(state, dt);
    const ws = walkerState(state, dt);
    void ws;
    drawPoiLayer(state, camX, camY);
    drawPlayer(state, camX, camY);
    return true;
  }

  // ------------------------------------------------------------------ draw
  function draw(state, ui) {
    ui = ui || {};
    const screen = ui.screen || 'play';
    const dt = tick(state, ui);
    if (screen !== R.screen) { R.screen = screen; R.screenSince = R.clock; }
    ctx.imageSmoothingEnabled = false;
    if (state) R.lastState = state;
    const env = { R, ctx, state, ui, dt, t: R.clock, since: R.clock - R.screenSince, SW, SH };
    switch (screen) {
      case 'title': Screens.title(env); break;
      case 'select': Screens.select(env); break;
      case 'play':
        if (state && renderWorldLayer(state, ui, dt, 0)) drawHud(ctx, state, ui, R);
        else rect(ctx, 0, 0, SW, SH, PAL.night);
        break;
      case 'pause':
        if (state && renderWorldLayer(state, ui, dt, 0.97)) { drawHud(ctx, state, { ...ui, message: null }, R); }
        else rect(ctx, 0, 0, SW, SH, PAL.night);
        Screens.pause(env);
        break;
      case 'map': Screens.map(env); break;
      case 'notes':
        if (state && renderWorldLayer(state, ui, dt, 0.97)) { /* dimmed world behind the notebook */ } else rect(ctx, 0, 0, SW, SH, PAL.night);
        Screens.notes(env);
        break;
      case 'complete':
        if (state && renderWorldLayer(state, ui, dt, 0.8)) { drawHud(ctx, state, { ...ui, message: null }, R); } else rect(ctx, 0, 0, SW, SH, PAL.night);
        Screens.complete(env);
        break;
      default:
        rect(ctx, 0, 0, SW, SH, PAL.night);
        drawText(ctx, 'UNKNOWN SCREEN ' + screen, 8, 8, PAL.snow, {});
    }
  }

  // ---------------------------------------------------------------- resize
  function resize() {
    if (typeof window === 'undefined') return;
    const dpr = window.devicePixelRatio || 1;
    const devScale = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / SW, (window.innerHeight * dpr) / SH)));
    const cssW = (SW * devScale) / dpr, cssH = (SH * devScale) / dpr;
    const st = canvas.style;
    st.width = cssW + 'px';
    st.height = cssH + 'px';
    st.imageRendering = 'pixelated';
    st.position = 'absolute';
    st.left = Math.floor((window.innerWidth - cssW) / 2) + 'px';
    st.top = Math.floor((window.innerHeight - cssH) / 2) + 'px';
    R.scale = devScale;
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', resize);
    resize();
  }

  const renderer = { setWorld, draw, flashContour, ripple, pulse, resize, _R: R, get scale() { return R.scale; } };
  return renderer;
}
