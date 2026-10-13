/**
 * Progress object + gate chain logic. Pure JS (no localStorage — main.js persists).
 * Progress: { unlocked:[levelIds], completed:[levelIds], fragments:[levelIds], notes:[strings],
 *              knowledge?: { [levelId]: { [poiId]: { heard:int, woken:bool, learned:string[] } } } }
 * `knowledge` is optional on disk and in memory (old saves lack it); Game creates it lazily.
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
  if (p.knowledge !== undefined) {
    const k = cleanKnowledge(p.knowledge, levels);
    if (Object.keys(k).length) p.knowledge = k; else delete p.knowledge;
  }
  return p;
}

/** Sanitise a knowledge map: drop unknown levels, bad entries and bad fields. Never throws. */
export function cleanKnowledge(k, levels) {
  const out = {};
  if (!k || typeof k !== 'object' || Array.isArray(k)) return out;
  const ids = levels && levels.length ? new Set(levels.map((l) => l.id)) : null;
  for (const lid of Object.keys(k)) {
    if (ids && !ids.has(lid)) continue;
    const lv = k[lid];
    if (!lv || typeof lv !== 'object' || Array.isArray(lv)) continue;
    const o = {};
    for (const pid of Object.keys(lv)) {
      const e = lv[pid];
      if (!e || typeof e !== 'object') continue;
      const heard = Number.isFinite(e.heard) && e.heard > 0 ? Math.floor(e.heard) : 0;
      const woken = e.woken === true;
      const learned = Array.isArray(e.learned) ? e.learned.filter((x) => typeof x === 'string') : [];
      o[pid] = { heard, woken, learned };
    }
    if (Object.keys(o).length) out[lid] = o;
  }
  return out;
}

/** The (live) knowledge map for a level, created on demand. */
export function knowledgeFor(progress, levelId) {
  if (!progress.knowledge || typeof progress.knowledge !== 'object') progress.knowledge = {};
  if (!progress.knowledge[levelId]) progress.knowledge[levelId] = {};
  return progress.knowledge[levelId];
}

export function serialize(progress) {
  return JSON.stringify({
    v: 1,
    unlocked: progress.unlocked, completed: progress.completed, fragments: progress.fragments, notes: progress.notes,
    knowledge: progress.knowledge || {},
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
  if (o && o.knowledge !== undefined) p.knowledge = o.knowledge;
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

/** [{type, resonating, remaining, count, nearest}] for the gate chain, in order (Game fills the extras). */
export function chainProgress(gate, isResonating) {
  const chain = (gate && gate.chain) || [];
  return chain.map((type) => ({ type, resonating: !!isResonating(type), remaining: 0, count: 0, nearest: null }));
}

/** True while every chain type is resonating at once. */
export function chainSatisfied(cp) {
  for (const c of cp) if (!c.resonating) return false;
  return true;
}

export function gateCentre(gate) { return { x: Math.floor(gate.x) + 0.5, y: Math.floor(gate.y) + 0.5 }; }
