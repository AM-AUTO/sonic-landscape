/**
 * Progress object + gate chain logic. Pure JS (no localStorage — main.js persists).
 * Progress: { unlocked:[levelIds], completed:[levelIds], fragments:[levelIds], notes:[strings] }
 */

export const GATE_RADIUS = 2; // cells: level completes within this of the open gate

export function createProgress(levels) {
  return { unlocked: levels && levels.length ? [levels[0].id] : [], completed: [], fragments: [], notes: [] };
}

/** Fill in / repair a progress object in place (keeps the same reference). */
export function normalizeProgress(p, levels) {
  p = p || {};
  for (const k of ['unlocked', 'completed', 'fragments', 'notes']) if (!Array.isArray(p[k])) p[k] = [];
  if (levels && levels.length && !p.unlocked.includes(levels[0].id)) p.unlocked.unshift(levels[0].id);
  return p;
}

export function serialize(progress) {
  return JSON.stringify({
    v: 1,
    unlocked: progress.unlocked, completed: progress.completed, fragments: progress.fragments, notes: progress.notes,
  });
}

/** Tolerant: bad/old/unknown data gives a fresh default progress. */
export function deserialize(str, levels) {
  let o = null;
  try { o = typeof str === 'string' ? JSON.parse(str) : str; } catch (e) { o = null; }
  const ids = levels ? new Set(levels.map((l) => l.id)) : null;
  const clean = (a, isId) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && (!isId || !ids || ids.has(x))) : []);
  const p = {
    unlocked: clean(o && o.unlocked, true), completed: clean(o && o.completed, true),
    fragments: clean(o && o.fragments, true), notes: clean(o && o.notes, false),
  };
  return normalizeProgress(p, levels);
}

/** Reveal the next unseen field note of a level. Returns the note or null. */
export function revealNote(progress, levelDef) {
  const notes = (levelDef && levelDef.fieldNotes) || [];
  for (const n of notes) {
    if (!progress.notes.includes(n)) { progress.notes.push(n); return n; }
  }
  return null;
}

/** Mark a level complete: completed + fragment + unlock the next level. Returns true if newly completed. */
export function completeLevel(progress, levels, index) {
  const id = levels[index].id;
  const fresh = !progress.completed.includes(id);
  if (fresh) progress.completed.push(id);
  if (!progress.fragments.includes(id)) progress.fragments.push(id);
  const next = levels[index + 1];
  if (next && !progress.unlocked.includes(next.id)) progress.unlocked.push(next.id);
  return fresh;
}

/** [{type, resonating}] for the gate chain, in order. */
export function chainProgress(gate, isResonating) {
  const chain = (gate && gate.chain) || [];
  return chain.map((type) => ({ type, resonating: !!isResonating(type) }));
}

/** True while every chain type is resonating at once. */
export function chainSatisfied(cp) {
  for (const c of cp) if (!c.resonating) return false;
  return true;
}

export function gateCentre(gate) { return { x: Math.floor(gate.x) + 0.5, y: Math.floor(gate.y) + 0.5 }; }
