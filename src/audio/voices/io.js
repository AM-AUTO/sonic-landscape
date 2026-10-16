/**
 * The palette voices' interface to the engine's grit FX (the `erode` and `resonators` worklets built in phase 2A),
 * by duck typing. Everything here no-ops (returns false) when the engine has no such FX — 2A not merged, the worklet
 * failed to load (the engine then holds a stub marked `stub: true`), or old fake audio — and the voices then use their
 * own fallbacks (a JS-rendered eroding loop, a biquad resonator bank).
 *
 * Contract (2A's engine as of this build; one place to adapt if it changes):
 *   engine.erode.captureAt(time, seconds, {age, passesToFull})   record `seconds` of the erode input from `time`, loop it, ageing
 *   engine.erode.setAge(age 0..1, time) · setPassesToFull(n, time) · set({return, mix, ageRate, reverb, grain}, t, tc)
 *   engine.erode.input                                           the recorder's input (a source fed here is never heard dry)
 *   engine.res.setTargets([{f, g, gain 0..4, damp?, pan?}], glideSec, atTime)   ≤ 6 noise-excited combs, glided
 *   engine.noiseSource.set(level, t, tc)  (or engine.res.set({noise}))         the pink noise exciting the resonators
 *   channel.set({erode, res}, t, tc)                             per-channel sends (made by the engine on first use)
 */

export const hasErode = (engine) => !!(engine && engine.erode && !engine.erode.stub && typeof engine.erode.captureAt === 'function');
export const hasRes = (engine) => !!(engine && engine.res && !engine.res.stub && typeof engine.res.setTargets === 'function');

const isParam = (p) => !!(p && typeof p.setTargetAtTime === 'function');

/** set a channel's send `name` ('erode' | 'res') to v; false when the engine has no such FX */
export function setSend(engine, ch, name, v, t, tc = 0.05) {
  if (!Number.isFinite(v) || !(name === 'erode' ? hasErode(engine) : hasRes(engine))) return false;
  if (ch && typeof ch.set === 'function') { try { ch.set({ [name]: v }, t, tc); return true; } catch (e) { return false; } }
  const s = ch && ch.sends && ch.sends[name];
  if (!s) return false;
  try {
    if (typeof s.set === 'function' && !isParam(s.gain)) { s.set(v, t, tc); return true; }
    const p = isParam(s.gain) ? s.gain : isParam(s) ? s : null;
    if (!p) return false;
    p.cancelScheduledValues(t); p.setTargetAtTime(v, t, Math.max(0.001, tc));
    return true;
  } catch (e) { return false; }
}

/** the node a source is connected to so that only the erode recorder hears it (null when there is none) */
export function erodeInput(engine) {
  if (!hasErode(engine)) return null;
  const e = engine.erode;
  return e.input || (engine.sends && engine.sends.erode) || null;
}

/**
 * arm a capture of `sec` seconds at time t, starting at age `age` and reaching full age after `passes` loop passes;
 * false when there is no erode FX (or it refused)
 */
export function erodeCapture(engine, t, sec, { age = 0.1, passes = 16 } = {}) {
  if (!hasErode(engine)) return false;
  try { engine.erode.captureAt(t, sec, { age, passesToFull: passes }); return true; } catch (e) { return false; }
}

/** set the captured loop's age (0..1) at t; false when unsupported */
export function erodeAge(engine, age, t) {
  if (!hasErode(engine)) return false;
  const e = engine.erode;
  try {
    if (typeof e.setAge === 'function') { e.setAge(age, t); return true; }
    if (typeof e.set === 'function') { e.set({ age }, t); return true; }
  } catch (e2) { /* fall through */ }
  return false;
}

/** the erode return's level (0..2); false when unsupported */
export function erodeLevel(engine, v, t, tc = 0.1) {
  if (!hasErode(engine)) return false;
  const e = engine.erode;
  try {
    if (typeof e.set === 'function') { e.set({ return: v }, t, tc); return true; }
    if (e.output && isParam(e.output.gain)) { e.output.gain.cancelScheduledValues(t); e.output.gain.setTargetAtTime(v, t, tc); return true; }
  } catch (e2) { /* fall through */ }
  return false;
}

/** the level of the pink noise exciting the engine resonators (0..2); false when unsupported */
export function resNoise(engine, level, t, tc = 0.2) {
  if (!hasRes(engine)) return false;
  try {
    if (engine.noiseSource && typeof engine.noiseSource.set === 'function') { engine.noiseSource.set(level, t, tc); return true; }
    if (typeof engine.res.set === 'function') { engine.res.set({ noise: level }, t, tc); return true; }
  } catch (e) { /* fall through */ }
  return false;
}

/** retune the engine resonators; false when there are none */
export function resTargets(engine, targets, glide, t) {
  if (!hasRes(engine)) return false;
  try { engine.res.setTargets(targets, glide, t); return true; } catch (e) { return false; }
}
