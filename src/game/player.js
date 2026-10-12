/**
 * Walker physics. Pure JS, no DOM.
 *
 *   a = input·accel(cover)·(run?1.7:1) − G(cover)·∇h·grip − friction(cover)·v
 *
 * Drag is integrated implicitly (v = (v + (A − g)·dt) / (1 + f·dt)), so the model is stable
 * for any dt. Flat-ground terminal speed = accel/friction (× 1.7 running).
 * The player is a small box (radius PLAYER_RADIUS cells); collision is resolved axis by axis
 * (slides along walls) with substeps so that no substep moves more than MAX_SUBSTEP cells.
 */
import { COVER } from '../world/codes.js';

export const PLAYER_RADIUS = 0.3;
export const MAX_SUBSTEP = 0.25;
export const MAX_SPEED = 14;
export const RUN_MULT = 1.7;
export const MOVING_SPEED = 0.3;      // speed > this => moving
export const SLOPE_CAP = 1.0;         // slope used by the gravity term is capped here (steeper ground is scrambled, not blocked)
export const VZ_TAU = 0.3;            // seconds, smoothing of vertical velocity

/**
 * Per-cover physics. topWalk = accel/friction = flat top speed (cells/s) walking.
 * G: gravity coupling (cells/s² per unit slope); the slope shifts the terminal speed by G·slope/friction.
 * lat: fraction of the CROSS-slope pull felt while walking (the slope along your heading is felt in
 *      full; loose scree/snow also drift sideways, firm ground barely does). Keeps the walker from being
 *      pinned against walls by sideways gravity in gullies.
 * repose/slideG: with NO input, slopes steeper than `repose` start to slide the walker with coupling
 * slideG (only scree and snow are loose enough to matter).
 */
function mk(topWalk, friction, G, repose, slideG = G, lat = 0.15) {
  return { accel: topWalk * friction, friction, G, repose, topWalk, slideG, lat };
}
export const COVER_PHYS = Object.freeze({
  [COVER.PATH]:    mk(5.0, 9,   22, 1.5, 22, 0.1),   // fast, low friction, low gravity coupling
  [COVER.MOOR]:    mk(4.4, 10,  30, 1.2),
  [COVER.BOG]:     mk(2.4, 14,  20, 3.0, 20, 0.1),   // sticky and slow
  [COVER.SCREE]:   mk(3.8, 2.5, 10, 0.22, 40, 0.6),  // slippery: long glide; hard uphill, loose underfoot when you stop
  [COVER.SNOW]:    mk(3.6, 6,   24, 0.55, 24, 0.4),  // moderate drag
  [COVER.WOOD]:    mk(4.1, 10,  30, 1.2),   // slightly slow
  [COVER.SHALLOW]: mk(3.0, 12,  20, 3.0),   // wading
  [COVER.ROCK]:    mk(4.6, 10,  28, 1.2),
  [COVER.CRAG]:    mk(4.0, 10,  30, 1.2),   // never stood on; fallback
  [COVER.DEEP]:    mk(2.0, 12,  20, 3.0),
});
const FALLBACK = COVER_PHYS[COVER.MOOR];

export function physFor(cover) { return COVER_PHYS[cover] || FALLBACK; }

/** Terminal speed on flat ground for a cover (cells/s). */
export function topSpeed(cover, run = false, mag = 1) {
  return physFor(cover).topWalk * (run ? RUN_MULT : 1) * mag;
}

export function createPlayer(x, y) {
  return {
    x, y, vx: 0, vy: 0, speed: 0, heading: Math.PI / 2,
    elevation: 0, vz: 0, slope: 0, cover: COVER.MOOR,
    moving: false, still: 0, running: false, resting: false, sliding: false,
    contourIndex: 0, climb: 0,
    // internals
    _stride: 0, _foot: 0, _prevElev: 0,
  };
}

/** Is the player's box clear at (x,y)? `pass(cx,cy)` -> bool. */
function boxClear(pass, x, y) {
  const r = PLAYER_RADIUS;
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  return pass(x0, y0) && pass(x1, y0) && pass(x0, y1) && pass(x1, y1);
}
export { boxClear };

/**
 * Advance the walker by dt. `events` (array) receives step / splash / slide-start / slide-end.
 * `pass(cx, cy)` decides walkability (world.passable plus the gate rule from the sim).
 */
export function stepPlayer(p, world, input, dt, pass, events) {
  // --- intent
  let ix = +input.x || 0, iy = +input.y || 0;
  let mag = Math.hypot(ix, iy);
  if (mag > 1) { ix /= mag; iy /= mag; mag = 1; }
  const run = !!input.run && mag > 0.05;
  const cover = world.coverAt(p.x, p.y);
  const ph = physFor(cover);
  const g = world.gradientAt(p.x, p.y);
  let gdx = g.gx, gdy = g.gy, gmag = Math.hypot(gdx, gdy);
  if (gmag > SLOPE_CAP) { gdx *= SLOPE_CAP / gmag; gdy *= SLOPE_CAP / gmag; gmag = SLOPE_CAP; } // steep ground is scrambled, not blocked

  // gravity pull. With intent the walker feels the full slope; without it only slopes beyond the
  // angle of repose (loose scree/snow) pull the walker, so you can stand still on a hillside.
  let gScale = 1;
  if (mag < 0.05) gScale = gmag > ph.repose ? 1 - ph.repose / gmag : 0;
  let gx, gy;
  if (mag < 0.05) { gx = ph.slideG * gdx * gScale; gy = ph.slideG * gdy * gScale; }
  else {
    const along = gdx * ix / mag + gdy * iy / mag;
    const ax = along * ix / mag, ay = along * iy / mag;
    gx = ph.G * (ax + ph.lat * (gdx - ax)); gy = ph.G * (ay + ph.lat * (gdy - ay));
  }

  const acc = ph.accel * (run ? RUN_MULT : 1); // (ix, iy) already carry the input magnitude
  const denom = 1 + ph.friction * dt;
  let vx = (p.vx + (ix * acc - gx) * dt) / denom;
  let vy = (p.vy + (iy * acc - gy) * dt) / denom;
  let sp = Math.hypot(vx, vy);
  if (sp > MAX_SPEED) { vx *= MAX_SPEED / sp; vy *= MAX_SPEED / sp; }
  if (mag < 0.05 && sp < 0.05) { vx = 0; vy = 0; }

  // --- move with substeps, axis by axis
  const dist = Math.hypot(vx, vy) * dt;
  const n = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  const h = dt / n;
  let x = p.x, y = p.y;
  const x0 = x, y0 = y;
  for (let i = 0; i < n; i++) {
    const nx = x + vx * h;
    if (boxClear(pass, nx, y)) x = nx; else vx = 0;
    const ny = y + vy * h;
    if (boxClear(pass, x, ny)) y = ny; else vy = 0;
  }
  p.x = x; p.y = y; p.vx = vx; p.vy = vy;
  const moved = Math.hypot(x - x0, y - y0);
  p.speed = Math.hypot(vx, vy);

  // --- derived
  const prevCover = p.cover;
  p.cover = world.coverAt(x, y);
  const elev = world.heightAt(x, y);
  const gg = world.gradientAt(x, y);
  p.slope = Math.hypot(gg.gx, gg.gy);
  if (dt > 0) {
    const raw = (elev - p._prevElev) / dt;
    const k = 1 - Math.exp(-dt / VZ_TAU);
    p.vz += (raw - p.vz) * k;
  }
  p._prevElev = elev;
  p.elevation = elev;
  p.running = run;
  p.moving = p.speed > MOVING_SPEED;
  if (p.moving) { p.still = 0; p.heading = Math.atan2(vy, vx); } else p.still += dt;

  // --- sliding (scree, moving downhill faster than intended)
  const intended = topSpeed(p.cover, run, mag);
  let downhill = 0;
  if (gmag > 1e-6) downhill = -(vx * gg.gx + vy * gg.gy) / Math.hypot(gg.gx, gg.gy);
  let sliding = p.sliding;
  if (p.cover === COVER.SCREE && p.slope > 0.1) {
    if (!sliding) sliding = downhill > Math.max(2.0, intended * 1.3);
    else sliding = downhill > Math.max(1.2, intended * 1.05);
  } else sliding = false;
  if (sliding !== p.sliding) { p.sliding = sliding; events.push({ type: sliding ? 'slide-start' : 'slide-end' }); }

  // --- cover-driven events
  if (p.cover === COVER.SHALLOW && prevCover !== COVER.SHALLOW && p.speed > 0.8) events.push({ type: 'splash' });

  // --- footsteps: stride grows a little with speed; alternate foot
  if (p.moving && !p.sliding) {
    p._stride += moved;
    const stride = 0.9 + 0.12 * p.speed;
    if (p._stride >= stride) {
      p._stride -= stride;
      p._foot ^= 1;
      events.push({ type: 'step', foot: p._foot });
      if (p.cover === COVER.SHALLOW) events.push({ type: 'splash' });
    }
  } else if (!p.moving) p._stride = 0;
}
