/**
 * Story logic: the typewriter reveal, the queue of panels, the "seen" flags and the switches that
 * turn stories off for tools. Pure data and functions (no DOM), so tests run it in Node.
 *
 *   const q = new StoryQueue([{ panel: { kind: 'ridge', levelIndex: 0 }, caption: 'A LINE' }], () => next());
 *   q.update(dtMs);          // every frame
 *   q.press();               // ENTER / tap: first press completes the reveal, second advances (the last finishes the queue)
 *   q.skip();                // ESC: abandon the rest
 *   q.view()                 // what the renderer reads as ui.story
 *
 * ui.story = { panel:{kind,levelIndex,seed?}, caption, typed, count, index, total, complete, t }
 */

export const CHAR_MS = 28;          // typewriter speed
export const START_DELAY_MS = 250;  // a beat before the first letter, while the panel fades in
export const PRESS_GUARD_MS = 120;  // a press this soon after a panel opens is the same keypress that opened it
export const FLAGS_KEY = 'contours.flags.v1';

/** Number of characters of a caption of `len` characters showing after `elapsedMs`. */
export function revealCount(len, elapsedMs, charMs = CHAR_MS, delayMs = START_DELAY_MS) {
  if (!(elapsedMs > delayMs)) return 0;
  return Math.min(len, Math.floor((elapsedMs - delayMs) / charMs));
}

const lengthOf = (s) => [...String(s)].length;

export class StoryQueue {
  constructor(items, onDone, opts = {}) {
    this.items = (items || []).filter((it) => it && it.panel);
    this.onDone = typeof onDone === 'function' ? onDone : null;
    this.charMs = opts.charMs || CHAR_MS;
    this.delayMs = opts.delayMs != null ? opts.delayMs : START_DELAY_MS;
    this.index = 0;
    this.elapsed = 0;
    this.done = this.items.length === 0;
    this._fired = false;
    if (this.done) this._finish();
  }
  get item() { return this.items[this.index] || null; }
  get length() { return this.item ? lengthOf(this.item.caption || '') : 0; }
  get typed() { return this.item ? revealCount(this.length, this.elapsed, this.charMs, this.delayMs) : 0; }
  get complete() { return !this.item || this.typed >= this.length; }
  update(dtMs) { if (!this.done) this.elapsed += Math.max(0, dtMs); }
  /** ENTER / tap. 'complete': the text was still typing and is now whole; 'advance': next panel; 'done': queue finished; 'ignored'. */
  press() {
    if (this.done) return 'done';
    if (this.elapsed < PRESS_GUARD_MS) return 'ignored';
    if (!this.complete) { this.elapsed = this.delayMs + this.length * this.charMs; return 'complete'; }
    this.index++;
    this.elapsed = 0;
    if (this.index >= this.items.length) { this.done = true; this._finish(); return 'done'; }
    return 'advance';
  }
  /** ESC: give up the rest of the queue. */
  skip() {
    if (this.done) return 'done';
    this.index = this.items.length;
    this.done = true;
    this._finish();
    return 'done';
  }
  _finish() {
    if (this._fired) return;
    this._fired = true;
    if (this.onDone) this.onDone();
  }
  view() {
    const it = this.item;
    if (!it) return null;
    return {
      panel: it.panel, caption: it.caption || '', typed: this.typed, count: this.length,
      index: this.index, total: this.items.length, complete: this.complete, t: this.elapsed / 1000,
    };
  }
}

// ----------------------------------------------------------------------------- flags
/** Read the flags object from a storage-like ({getItem,setItem}); {} when absent, broken or unavailable. */
export function loadFlags(storage) {
  try {
    const raw = storage && storage.getItem(FLAGS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
/** Write the flags; false when the storage refuses. */
export function saveFlags(storage, flags) {
  try { storage.setItem(FLAGS_KEY, JSON.stringify(flags)); return true; } catch { return false; }
}
export const flagKey = { intro: 'intro', track: (id) => 'track.' + id };
export const hasSeen = (flags, key) => !!(flags && flags[key]);
/** Marks a story as seen and persists. Returns the (mutated) flags. */
export function markSeen(flags, key, storage) {
  flags[key] = 1;
  if (storage) saveFlags(storage, flags);
  return flags;
}

/** Stories are off for tools (autopilot, mute, nostory) unless ?story=1 forces them on. */
export function storiesEnabled(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null);
  const has = (k) => !!(params && typeof params.has === 'function' && params.has(k));
  if (has('story') && get('story') !== '0') return true;
  if (has('nostory') || has('autopilot') || has('mute')) return false;
  return true;
}

// ----------------------------------------------------------------------------- what to show
/** The three intro panels (first launch). `captions` is STORY.intro. */
export function introItems(captions) {
  const kinds = [{ kind: 'ridge', levelIndex: 7 }, { kind: 'gate', levelIndex: 0 }, { kind: 'cross', levelIndex: 0 }];
  return captions.map((caption, i) => ({ panel: kinds[i % kinds.length], caption }));
}
/** A track's first-entry panel: its own skyline, in its own hue. */
export function trackItems(levelIndex, caption) { return [{ panel: { kind: 'ridge', levelIndex }, caption }]; }
/** Track complete: the ring-cross in the lightning. */
export function completeItems(levelIndex, caption) { return [{ panel: { kind: 'cross', levelIndex }, caption }]; }
/** Album complete: Ben Nevis again, from another side. */
export function albumItems(caption) { return [{ panel: { kind: 'ridge', levelIndex: 7, seed: 5 }, caption }]; }
