#!/usr/bin/env node
/**
 * Check a level against the explorability rules (docs/LEVELS.md §3, src/world/design.js).
 * Prints every rule pass/fail with numbers, the legs with distances and estimated times. Writes nothing.
 *
 *   node tools/check-level.mjs <id|index> [more ids...] [--run]
 *     --run   also drive the autopilot through the headless sim and print measured leg times
 *             (seconds between the fires of consecutive route artefacts, and to the gate)
 *   node tools/check-level.mjs --all   every level
 *
 * Exit code 1 when any checked level fails a rule (or, with --run, is not completed).
 */
import { LEVELS } from '../src/world/levels/index.js';
import { buildWorld } from '../src/world/terrain.js';
import { checkLevel, DESIGN_RULES } from '../src/world/design.js';
import { seasonOf } from '../src/world/codes.js';
import { Game } from '../src/game/sim.js';
import { Autopilot } from '../src/game/autopilot.js';

const args = process.argv.slice(2);
const RUN = args.includes('--run');
let ids = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all')) ids = LEVELS.map((l) => l.id);
if (!ids.length) {
  console.log('usage: node tools/check-level.mjs <id|index> [...] [--run] | --all');
  console.log('levels: ' + LEVELS.map((l, i) => `${i}:${l.id}${l.designVersion === 2 ? ' (v2)' : ''}`).join('  '));
  process.exit(2);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '-');
let failed = false;

for (const key of ids) {
  const index = /^\d+$/.test(key) ? +key : LEVELS.findIndex((l) => l.id === key);
  const level = LEVELS[index];
  if (!level) { console.log(`no such level: ${key}`); failed = true; continue; }
  const t0 = performance.now();
  const world = buildWorld(level);
  const tb = performance.now();
  const { rules, route, pass } = checkLevel(world, level);
  const tp = performance.now();
  const q = seasonOf(level);
  console.log(`\n== ${level.id} (#${index}${level.designVersion === 2 ? ', designVersion 2' : ', old brief: rules not enforced'})  sheet ${world.size}${world.scale !== 1 ? ` (authored ${level.authoredSize}, ×${world.scale})` : ''}`);
  console.log(`   build ${num(tb - t0)} ms, route plan ${num(tp - tb)} ms; season dawn ${num(q.dawn, 2)} day ${num(q.day, 2)} dusk ${num(q.dusk, 2)} night ${num(q.night, 2)}`);
  for (const r of rules) {
    console.log(`   ${r.pass ? 'PASS' : 'FAIL'}  ${pad(r.label, 42)} ${r.value}   [want ${r.want}]${r.detail ? '  ' + r.detail : ''}`);
  }
  console.log(`   route order: spawn > ${route.order.join(' > ')} > gate; walked ${num(route.length)} cells; planner leg max ${num(route.waypoints.estimate.leg)} s, last fire ~${num(route.waypoints.estimate.end)} s`);
  console.log(`   legs (straight / walked cells, estimated s; want ${DESIGN_RULES.legMin}-${DESIGN_RULES.legMax} cells, <= ${DESIGN_RULES.legTimeMax} s):`);
  for (const l of route.legs) {
    const okD = l.straight >= DESIGN_RULES.legMin && l.straight <= DESIGN_RULES.legMax, okT = l.time <= DESIGN_RULES.legTimeMax;
    console.log(`     ${pad(l.from + ' > ' + l.to, 34)} ${num(l.straight).padStart(4)} / ${num(l.dist).padStart(4)} cells  ${num(l.time, 1).padStart(6)} s  ${okD && okT ? '' : '<-- ' + [okD ? '' : 'distance', okT ? '' : 'time'].filter(Boolean).join(', ')}`);
  }
  if (route.warnings.length) console.log('   planner warnings: ' + route.warnings.join(' | '));
  if (level.designVersion === 2 && !pass) failed = true;

  if (RUN) {
    const game = new Game({ levels: LEVELS, buildWorld: () => world });
    game.loadLevel(index);
    const ap = new Autopilot(game.world, route.waypoints);
    const fires = [];
    let t = 0;
    const DT = 1 / 60;
    while (t < 15 * 60 && !game.state.levelComplete) {
      game.step(ap.input(game.state), DT); t += DT;
      for (const e of game.state.events) if (e.type === 'poi' && e.full && route.order.includes(e.poi.id) && !fires.some((f) => f.id === e.poi.id)) fires.push({ id: e.poi.id, t });
      if (ap.done && !game.state.levelComplete) break;
    }
    const done = game.state.levelComplete;
    let prev = 0;
    const meas = fires.map((f) => { const s = `${f.id} ${num(f.t - prev, 1)} s`; prev = f.t; return s; });
    if (done) meas.push(`gate ${num(t - prev, 1)} s`);
    console.log(`   autopilot run: ${done ? 'complete' : 'NOT COMPLETE'} in ${num(t, 1)} s sim time; measured legs: ${meas.join(', ')}`);
    if (!done) failed = true;
  }
}
process.exit(failed ? 1 : 0);
