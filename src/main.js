/**
 * CONTOURS — integration.
 *
 * title → select (album tracklist) → play ⇄ pause / map / notes → complete → next track.
 * Fixed-step simulation (1/60 s) with an accumulator; audio and renderer are fed
 * once per animation frame. Because the sim may step several times per frame,
 * the audio receives a state whose `events` is every event since the last frame.
 *
 * Query params (for testing): ?level=N jumps into track N (0-based, unlocks it),
 * ?autopilot=1 walks the gate chain automatically, ?mute=1 skips audio,
 * ?fresh=1 ignores saved progress, ?speed=N runs the simulation N× faster.
 */
import { LEVELS } from './world/levels/index.js';
import { ARTEFACT_NAMES, RESONANCE_SECONDS } from './world/codes.js';
import { Game } from './game/sim.js';
import { serialize, deserialize, revealNote } from './game/progression.js';
import { TYPE_LABEL } from './game/describe.js';
import { Autopilot, planChainRoute } from './game/autopilot.js';
import { createInput } from './game/input.js';
import { createRenderer } from './render/renderer.js';

const STEP = 1 / 60;
const SPEED = Math.max(1, Math.min(16, parseFloat(new URLSearchParams(location.search).get('speed')) || 1)); // test time-scale
const SAVE_KEY = 'contours.progress.v1';
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('screen');
const renderer = createRenderer(canvas);
const input = createInput(window);

// ---------------------------------------------------------------- progress
function loadProgress() {
  if (params.has('fresh')) return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? deserialize(raw, LEVELS) : null;
  } catch { return null; }
}
let lastSave = -1e9;
let saveTimer = null;
function saveProgress() {
  lastSave = performance.now();
  try { localStorage.setItem(SAVE_KEY, serialize(game.progress)); } catch { /* storage unavailable */ }
}
/** Debounced save for knowledge changes: at most one write per 2 s, with a trailing write. */
function saveSoon() {
  const wait = 2000 - (performance.now() - lastSave);
  if (wait <= 0) { saveProgress(); return; }
  if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; saveProgress(); }, wait);
}

const game = new Game({ levels: LEVELS, progress: loadProgress() });

// ---------------------------------------------------------------- audio
let audio = null;
let audioCtx = null;
let audioStarting = null;
const muted = params.has('mute');

/** Create/resume the AudioContext. Must run inside a user-gesture handler. */
function startAudio() {
  if (muted) return;
  if (audioCtx) { if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC({ latencyHint: 'playback' });
  audioStarting = import('./audio/index.js')
    .then((m) => m.createAudio(audioCtx, { seed: (Date.now() >>> 0) ^ 0x5eed }))
    .then((a) => {
      audio = a;
      if (ui.screen !== 'title' && ui.screen !== 'select' && game.level) audio.setLevel(game.level);
    })
    .catch((err) => { console.error('audio failed to start', err); });
}
window.addEventListener('pointerdown', startAudio, { passive: true });
window.addEventListener('keydown', startAudio);

// ---------------------------------------------------------------- ui state
const ui = {
  screen: 'title',
  selected: 0,
  time: 0,
  message: '', messageT: 0, messageDur: 4, messageKind: 'note', messageSub: '', messageSub2: '',
  items: ['RESUME', 'FIELD NOTES', 'SHEET MAP', 'TRACKLIST'],
  notes: [],
  scroll: 0,
  next: null,
  fragmentCount: 0,
};
let autopilot = null;
let pendingEvents = [];
let accumulator = 0;
let lastFrame = null;

// Messages are queued and shown one after another. Artefact banners pre-empt whatever is showing
// (the queued lines resume afterwards), so a field note is never lost under an artefact.
const messageQueue = [];
function show(m) {
  ui.message = m.text; ui.messageKind = m.kind; ui.messageSub = m.sub; ui.messageSub2 = m.sub2 || '';
  ui.messageDur = m.dur; ui.messageT = m.dur;
}
function say(text, { kind = 'note', sub = '', sub2 = '', dur = 4.5, now = false } = {}) {
  const m = { text, kind, sub, sub2, dur };
  if (now || ui.messageT <= 0) show(m);
  else messageQueue.push(m);
}
function clearMessages() { messageQueue.length = 0; ui.messageT = 0; ui.messageSub2 = ''; }

const INTRO = [
  'THE MAP IS THE SCORE. WALK, AND LISTEN.',
  'CLIMB AND THE MELODY CLIMBS. CROSS THE GRID AND THE HARMONY TURNS.',
  'THE SYMBOLS AT THE FOOT OF THE SHEET ARE THE BEALACH\'S KEY. WAKE THEM ALL AT ONCE.',
  'HOLD SPACE TO LISTEN: STAND STILL AND TIME PASSES; WALK AND YOU TREAD SOFTLY.',
  'BOTHIES (the black huts) KEEP FIELD NOTES. THE ARROWS AT THE FOOT OF THE SHEET POINT TO THE NEAREST OF EACH KEY.',
  'SHIFT: RUN.   M: THE SHEET.   L: FIELD NOTES.',
];

function unlockedIndex(i) {
  const id = LEVELS[i] && LEVELS[i].id;
  return game.progress.unlocked.includes(id);
}

function enterLevel(index) {
  game.loadLevel(index);
  renderer.setWorld(game.world);
  pendingEvents = [];
  accumulator = 0;
  ui.screen = 'play';
  ui.selected = index;
  const lvl = game.level;
  clearMessages();
  say(lvl.name.toUpperCase(), { kind: 'artefact', sub: lvl.subtitle || '', dur: 5, now: true });
  if (index === 0 && !game.progress.completed.includes(lvl.id)) for (const line of INTRO) say(line, { dur: 5.5 });
  // every sheet arrives with one field note already in the walker's pocket
  const hasNote = (lvl.fieldNotes || []).some((n) => game.progress.notes.includes(n));
  if (!hasNote) {
    const n = revealNote(game.progress, lvl);
    if (n) { say('FIELD NOTE: ' + n, { dur: 7 }); saveProgress(); }
  }
  if (audio) audio.setLevel(lvl);
  autopilot = null;
  if (params.has('autopilot')) {
    const route = planChainRoute(game.world, lvl);
    autopilot = new Autopilot(game.world, route);
  }
}

// ---------------------------------------------------------------- events → feedback
function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'contour':
        renderer.flashContour(ev.index, game.state.t, ev.dir);
        break;
      case 'poi': {
        const p = ev.poi;
        if (ev.full) {
          renderer.pulse(p.type);
          renderer.ripple(p.x + 0.5, p.y + 0.5, game.state.t, 'magenta');
          const sub = ev.inChain
            ? `KEY ${ev.keysSounding}/${ev.keysTotal} SOUNDING · ${RESONANCE_SECONDS}s`
            : `${p.name || ''} · not part of this bealach's key`;
          say(ARTEFACT_NAMES[p.type].toUpperCase(), { kind: 'artefact', sub, dur: 5, now: true });
        } else {
          renderer.ripple(p.x + 0.5, p.y + 0.5, game.state.t, 'contour');
          say(ARTEFACT_NAMES[p.type].toUpperCase() + ' · UNWOKEN', {
            kind: 'partial', sub: ev.hint || '', sub2: (ev.plain || []).join(' '),
            dur: ev.plain && ev.plain.length ? 8 : 5, now: !ui.messageT || ui.messageKind !== 'artefact',
          });
        }
        if (ev.note) {
          // field note found at a bothy — queued behind the artefact banner
          say('FIELD NOTE: ' + ev.note, { dur: 7 });
          saveProgress();
        } else saveSoon();   // knowledge (heard / woken / learned) changed
        break;
      }
      case 'bothy-guide':
        say('FIELD NOTE: ' + ev.text, { dur: 8 });
        saveSoon();
        break;
      case 'bothy-near':
        say('A BOTHY. WALKERS LEAVE NOTES IN BOTHIES.', { dur: 5 });
        break;
      case 'gate-near':
        if (ev.open) say('THE BEALACH IS OPEN. WALK THROUGH.', { dur: 5 });
        else {
          say('THE BEALACH STONE READS: ' + ev.chain.map((t) => TYPE_LABEL[t] || t.toUpperCase()).join(' · '),
            { kind: 'artefact', sub: 'Wake them so they sound together.', dur: 6 });
        }
        break;
      case 'chain':
        if (ev.types && ev.types.length >= 2) say('CONCORD', { kind: 'artefact', sub: ev.types.map((t) => ARTEFACT_NAMES[t]).join(' · '), dur: 3.5, now: true });
        break;
      case 'gate-open': {
        const g = game.world.gate;
        renderer.ripple(g.x + 0.5, g.y + 0.5, game.state.t, 'magenta');
        say('THE BEALACH OPENS', { kind: 'artefact', sub: (g.name || '') + ' — walk through it', dur: 6, now: true });
        break;
      }
      case 'level-complete': {
        saveProgress();
        const idx = game.levelIndex;
        ui.next = LEVELS[idx + 1] ? { name: LEVELS[idx + 1].name, subtitle: LEVELS[idx + 1].subtitle } : null;
        ui.fragmentCount = game.progress.fragments.length;
        // let the cadence ring before the card appears
        setTimeout(() => { if (ui.screen === 'play') ui.screen = 'complete'; }, 2500);
        break;
      }
      default: break;
    }
  }
}

// ---------------------------------------------------------------- menu actions
function handleActions(actions) {
  for (const a of actions) {
    switch (ui.screen) {
      case 'title':
        if (a === 'confirm') { ui.screen = 'select'; ui.selected = Math.max(0, lastUnlocked()); }
        break;
      case 'select':
        if (a === 'up') ui.selected = (ui.selected + LEVELS.length - 1) % LEVELS.length;
        else if (a === 'down') ui.selected = (ui.selected + 1) % LEVELS.length;
        else if (a === 'confirm' && unlockedIndex(ui.selected)) enterLevel(ui.selected);
        else if (a === 'back' || a === 'pause') ui.screen = 'title';
        break;
      case 'play':
        if (a === 'pause') { ui.screen = 'pause'; ui.selected = 0; }
        else if (a === 'map') ui.screen = 'map';
        else if (a === 'notes') openNotes('play');
        break;
      case 'pause':
        if (a === 'up') ui.selected = (ui.selected + ui.items.length - 1) % ui.items.length;
        else if (a === 'down') ui.selected = (ui.selected + 1) % ui.items.length;
        else if (a === 'pause' || a === 'back') ui.screen = 'play';
        else if (a === 'confirm') {
          const item = ui.items[ui.selected];
          if (item === 'RESUME') ui.screen = 'play';
          else if (item === 'FIELD NOTES') openNotes('pause');
          else if (item === 'SHEET MAP') ui.screen = 'map';
          else if (item === 'TRACKLIST') { ui.screen = 'select'; ui.selected = game.levelIndex; }
        }
        break;
      case 'map':
        if (a === 'map' || a === 'back' || a === 'pause' || a === 'confirm') ui.screen = 'play';
        break;
      case 'notes':
        if (a === 'up') ui.scroll = Math.max(0, ui.scroll - 1);
        else if (a === 'down') ui.scroll += 1;
        else if (a === 'notes' || a === 'back' || a === 'pause' || a === 'confirm') ui.screen = 'play';
        break;
      case 'complete':
        if (a === 'confirm') {
          const nxt = game.levelIndex + 1;
          if (nxt < LEVELS.length) enterLevel(nxt);
          else { ui.screen = 'select'; ui.selected = game.levelIndex; }
        } else if (a === 'back' || a === 'pause') { ui.screen = 'select'; ui.selected = game.levelIndex; }
        break;
      default: break;
    }
  }
}

function openNotes() {
  ui.notes = game.progress.notes.length ? game.progress.notes.slice() : ['No field notes yet. Bothies keep them.'];
  ui.scroll = 0;
  ui.screen = 'notes';
}

function lastUnlocked() {
  let last = 0;
  LEVELS.forEach((l, i) => { if (game.progress.unlocked.includes(l.id)) last = i; });
  return last;
}

let touchSeen = false;
window.addEventListener('touchstart', () => { touchSeen = true; }, { passive: true, once: true });

// ---------------------------------------------------------------- loop
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = lastFrame == null ? STEP : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  ui.time += dtReal;

  handleActions(input.consume());

  const playing = ui.screen === 'play' || ui.screen === 'complete';
  if (playing && game.state) {
    accumulator += dtReal * SPEED;
    let steps = 0;
    const maxSteps = 8 * SPEED;
    while (accumulator >= STEP && steps < maxSteps) {
      const held = autopilot && !autopilot.done ? autopilot.input(game.state) : input.state();
      const inp = ui.screen === 'complete' ? null : held;
      game.step(inp, STEP);
      if (game.state.events.length) {
        handleEvents(game.state.events);
        for (const e of game.state.events) pendingEvents.push(e);
      }
      accumulator -= STEP;
      steps++;
    }
    if (steps >= maxSteps) accumulator = 0;
  }

  if (ui.messageT > 0) ui.messageT = Math.max(0, ui.messageT - dtReal);
  if (ui.messageT <= 0 && messageQueue.length && ui.screen === 'play') show(messageQueue.shift());

  if (audio && game.state && ui.screen !== 'title' && ui.screen !== 'select') {
    const evs = pendingEvents;
    pendingEvents = [];
    try { audio.update(Object.assign({}, game.state, { events: evs })); }
    catch (err) { console.error('audio.update', err); }
  } else {
    pendingEvents.length = 0;
  }

  ui.levels = LEVELS;
  ui.touch = input.touch;
  ui.touchVisible = touchSeen;
  ui.unlocked = game.progress.unlocked;
  ui.completed = game.progress.completed;
  renderer.draw(ui.screen === 'title' || ui.screen === 'select' ? null : game.state, ui);
}

// ---------------------------------------------------------------- boot
if (params.has('level')) {
  const n = Math.max(0, Math.min(LEVELS.length - 1, parseInt(params.get('level'), 10) || 0));
  for (let i = 0; i <= n; i++) if (!game.progress.unlocked.includes(LEVELS[i].id)) game.progress.unlocked.push(LEVELS[i].id);
  enterLevel(n);
}

window.addEventListener('blur', () => { if (ui.screen === 'play') ui.screen = 'pause'; });
document.addEventListener('visibilitychange', () => {
  if (!audioCtx) return;
  if (document.hidden) audioCtx.suspend().catch(() => {});
  else audioCtx.resume().catch(() => {});
});

window.__contours = { game, get audio() { return audio; }, get audioReady() { return audioStarting; }, renderer, ui, enterLevel, startAudio };
requestAnimationFrame(frame);
