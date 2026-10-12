/**
 * Browser input mapper (DOM). Not imported by the simulation.
 *
 *   const input = createInput(window or an element);
 *   input.state()    -> { x, y, run, rest }     held controls, diagonals normalised (|v| <= 1)
 *   input.consume()  -> ['map','notes','pause','confirm','up','down','left','right','back', ...]  edge-triggered, drained
 *   input.touch      -> { stick:{active,cx,cy,x,y,radius}, buttons:[{id,x,y,w,h,held}], layout() }  (client px; nothing is drawn here)
 *   input.dispose()
 *
 * Keys: WASD/arrows move, Shift run, Space rest/listen (held while walking: tread softly), M map, L notes, Esc pause, Enter confirm,
 *       Backspace back. Arrows/WASD (and gamepad d-pad) also emit up/down/left/right actions for menus.
 * Touch: floating stick in the left 45 % of the target; buttons on the right: run (hold), rest (hold),
 *        map / notes / pause (tap). Any other tap emits 'confirm'.
 * Gamepad (optional): left stick, A confirm, B back, X rest, Y notes, RB/RT run, Start pause, Select map.
 */

const KEY_ACTIONS = {
  KeyM: 'map', KeyL: 'notes', Escape: 'pause', Enter: 'confirm', Backspace: 'back', NumpadEnter: 'confirm',
};
const NAV_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space']);
const STICK_RADIUS = 56;
const DEADZONE = 0.18;
export const SOFT_TREAD = 0.35; // input magnitude while walking with listen held (≈1.5–1.8 cells/s)

export function createInput(target) {
  const root = target || (typeof window !== 'undefined' ? window : null);
  const keys = new Set();
  let queue = [];
  const pad = { prev: {} };
  const touch = {
    stick: { active: false, id: -1, cx: 0, cy: 0, x: 0, y: 0, radius: STICK_RADIUS },
    buttons: [],
    layout: null,
  };
  const heldButtons = new Set();   // touch button ids currently held (by pointer id -> id)
  const pointerButton = new Map(); // pointerId -> button id

  const rectOf = () => {
    if (root && root.getBoundingClientRect) return root.getBoundingClientRect();
    return { left: 0, top: 0, width: typeof innerWidth !== 'undefined' ? innerWidth : 800, height: typeof innerHeight !== 'undefined' ? innerHeight : 600 };
  };
  touch.layout = () => {
    const r = rectOf();
    const s = Math.max(44, Math.min(72, Math.min(r.width, r.height) * 0.13));
    const R = r.left + r.width, B = r.top + r.height, g = s * 0.25;
    const btn = (id, x, y, w = s, h = s, hold = false) => ({ id, x, y, w, h, hold, held: heldButtons.has(id) });
    touch.buttons = [
      btn('run', R - s - g, B - s - g, s, s, true),
      btn('rest', R - 2 * s - 2 * g, B - s - g, s, s, true),
      btn('map', R - s - g, r.top + g, s * 0.8, s * 0.6),
      btn('notes', R - 2 * s * 0.8 - 2 * g, r.top + g, s * 0.8, s * 0.6),
      btn('pause', R - 3 * s * 0.8 - 3 * g, r.top + g, s * 0.8, s * 0.6),
    ];
    return touch.buttons;
  };
  touch.layout();

  const push = (a) => { if (queue.length < 32) queue.push(a); };

  // ---- keyboard
  const onKeyDown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const c = e.code;
    if (MOVE_KEYS.has(c) || KEY_ACTIONS[c]) e.preventDefault();
    if (!e.repeat) {
      if (KEY_ACTIONS[c]) push(KEY_ACTIONS[c]);
      if (NAV_KEYS[c]) push(NAV_KEYS[c]);
    } else if (NAV_KEYS[c] && (c === 'ArrowUp' || c === 'ArrowDown')) push(NAV_KEYS[c]);
    keys.add(c);
  };
  const onKeyUp = (e) => { keys.delete(e.code); };
  const onBlur = () => { keys.clear(); touch.stick.active = false; heldButtons.clear(); pointerButton.clear(); };

  // ---- touch / pointer (only touch & pen are treated as virtual controls)
  const hitButton = (px, py) => {
    touch.layout();
    for (const b of touch.buttons) if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
    return null;
  };
  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse') return;
    const b = hitButton(e.clientX, e.clientY);
    if (b) {
      if (b.hold) { heldButtons.add(b.id); pointerButton.set(e.pointerId, b.id); } else push(b.id);
      return;
    }
    const r = rectOf();
    if (!touch.stick.active && e.clientX < r.left + r.width * 0.45 && e.clientY > r.top + r.height * 0.25) {
      const s = touch.stick;
      s.active = true; s.id = e.pointerId; s.cx = e.clientX; s.cy = e.clientY; s.x = 0; s.y = 0;
    } else push('confirm');
  };
  const onPointerMove = (e) => {
    const s = touch.stick;
    if (!s.active || e.pointerId !== s.id) return;
    let dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    const d = Math.hypot(dx, dy);
    if (d > s.radius) { // drag the base along so the thumb never leaves the stick
      const k = (d - s.radius) / d; s.cx += dx * k; s.cy += dy * k; dx = e.clientX - s.cx; dy = e.clientY - s.cy;
    }
    s.x = Math.max(-1, Math.min(1, dx / s.radius)); s.y = Math.max(-1, Math.min(1, dy / s.radius));
  };
  const onPointerUp = (e) => {
    const s = touch.stick;
    if (s.active && e.pointerId === s.id) { s.active = false; s.x = 0; s.y = 0; }
    const id = pointerButton.get(e.pointerId);
    if (id) { heldButtons.delete(id); pointerButton.delete(e.pointerId); }
  };

  if (root && root.addEventListener) {
    const kt = typeof window !== 'undefined' ? window : root;
    kt.addEventListener('keydown', onKeyDown);
    kt.addEventListener('keyup', onKeyUp);
    kt.addEventListener('blur', onBlur);
    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
  }

  // ---- gamepad
  function readPad() {
    const out = { x: 0, y: 0, run: false, rest: false };
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return out;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp) continue;
      let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
      const m = Math.hypot(x, y);
      if (m < DEADZONE) { x = 0; y = 0; } else { const k = (Math.min(1, m) - DEADZONE) / (1 - DEADZONE) / m; x *= k; y *= k; }
      const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      const edge = (i, action) => { const now = b(i); if (now && !pad.prev[i]) push(action); pad.prev[i] = now; };
      edge(0, 'confirm'); edge(1, 'back'); edge(3, 'notes'); edge(9, 'pause'); edge(8, 'map');
      edge(12, 'up'); edge(13, 'down'); edge(14, 'left'); edge(15, 'right');
      if (!pad.prev.axisUp && y < -0.7) push('up');
      if (!pad.prev.axisDown && y > 0.7) push('down');
      pad.prev.axisUp = y < -0.7; pad.prev.axisDown = y > 0.7;
      out.x = x; out.y = y; out.run = b(5) || b(7); out.rest = b(2);
      break;
    }
    return out;
  }

  return {
    touch,
    state() {
      let x = 0, y = 0;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
      let run = keys.has('ShiftLeft') || keys.has('ShiftRight');
      let rest = keys.has('Space');
      const s = touch.stick;
      if (s.active) { x += s.x; y += s.y; }
      if (heldButtons.has('run')) run = true;
      if (heldButtons.has('rest')) rest = true;
      const g = readPad();
      x += g.x; y += g.y; run = run || g.run; rest = rest || g.rest;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      // Listen while walking = tread softly: a keyboard has no analogue magnitude, and some
      // places only answer a slow approach. (Standing still with listen held rests instead.)
      if (rest && !run && m > 0.05) { x *= SOFT_TREAD; y *= SOFT_TREAD; }
      return { x, y, run, rest };
    },
    consume() { if (!queue.length) return queue; const q = queue; queue = []; return q; },
    dispose() {
      if (root && root.removeEventListener) {
        const kt = typeof window !== 'undefined' ? window : root;
        kt.removeEventListener('keydown', onKeyDown);
        kt.removeEventListener('keyup', onKeyUp);
        kt.removeEventListener('blur', onBlur);
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerup', onPointerUp);
        root.removeEventListener('pointercancel', onPointerUp);
      }
    },
  };
}
