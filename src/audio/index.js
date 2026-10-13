/**
 * CONTOURS audio — public facade.
 *
 *   const audio = await createAudio(ctx, { seed });
 *   audio.setLevel(levelDef);      // optional: update() also switches level when state.level changes
 *   audio.update(state);           // every frame (real-time) or every ~50 ms of audio time (offline render)
 *
 * IMPORTANT — events: update(state) consumes `state.events` and nothing else carries them. GameState.events holds
 * only the events of the LAST sim step, so a caller that steps the simulation several times between audio
 * updates (fixed-step accumulator, or an offline renderer stepping 1/60 s between 50 ms updates) must pass a
 * state whose `events` is the CONCATENATION of all events emitted since the previous update(). Use
 * `withEvents(state, events)` below, or accumulate yourself:
 *
 *     const merged = [];
 *     while (acc >= dt) { game.step(input, dt); merged.push(...game.state.events); acc -= dt; }
 *     audio.update(withEvents(game.state, merged));
 *
 * There are no timers inside the audio layer: all scheduling happens inside update() against
 * ctx.currentTime with a 0.15 s lookahead, so it behaves identically under an OfflineAudioContext driven by
 * ctx.suspend(t) steps.
 */
import { createEngine } from './engine.js';
import { Score } from './score.js';
import { TEXTURE_NOISE } from './voices/texture.js';

/** shallow copy of a GameState with a replaced `events` array */
export function withEvents(state, events) {
  return { ...state, events };
}

export async function createAudio(ctx, { seed = 1 } = {}) {
  const engine = await createEngine(ctx, { seed });
  // the noise buffers the percussion and the texture layers loop: made once, here, while the caller is still loading (~150 ms),
  // so the first updates of a level never have to synthesise them
  engine.noiseBuffer('white', 12); engine.noiseBuffer('pink', 12);
  for (const [k, sec] of TEXTURE_NOISE) engine.noiseBuffer(k, sec);
  const score = new Score(engine);
  let volume = 1;
  const seen = new Set();
  const audio = {
    ctx, engine, score,
    /** exceptions caught inside update() (the game must never die because the music layer hit a bug); each is also console.error'd once */
    errors: [],
    /** swap the music profile; crossfades the bed over ~4 s. Safe to call repeatedly (same level id is a no-op). */
    setLevel(levelDef) { score.setLevel(levelDef); },
    /** per-frame: consume state.events + continuous state, schedule music up to ctx.currentTime + 0.15 s */
    update(state) {
      try { score.update(state); } catch (e) {
        const msg = String((e && e.stack) || e);
        if (!seen.has(msg)) { seen.add(msg); console.error('[audio] update failed:', msg); }
        if (audio.errors.length < 20) audio.errors.push(msg);
      }
    },
    setMasterVolume(v) {
      volume = Math.max(0, Math.min(1.5, Number.isFinite(v) ? v : 1));
      score.volume = volume;
      engine.fx.master.setGain(volume * 0.95);
    },
    /** parameter audit: { params: {name: {min,max,count}}, dead: [names] } — dead = never moved over the session */
    audit() { return engine.auditReport(); },
    /** debugging / verification summary of what the score has played */
    inspect() { return { stats: score.stats, timeline: score.timeline, section: score.cond.section, energy: score.cond.energy, controls: { ...score.C } }; },
    dispose() {
      try {
        const t = ctx.currentTime;
        if (score.drone) score.drone.stop(t);
        score.stage.v.texture.stop(t);
        score.stage.v.kit.dispose(); score.stage.v.aKit.dispose();
      } catch (e) { /* already gone */ }
      engine.dispose();
    },
  };
  return audio;
}

export default createAudio;
