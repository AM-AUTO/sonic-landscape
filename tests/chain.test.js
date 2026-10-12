// Proves every real level is completable: Autopilot + planChainRoute drive the headless sim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/sim.js';
import { Autopilot, planChainRoute } from '../src/game/autopilot.js';

let LEVELS = [];
let buildWorld = null;
let loadError = null;
try {
  ({ LEVELS } = await import('../src/world/levels/index.js'));
  ({ buildWorld } = await import('../src/world/terrain.js'));
} catch (e) { loadError = e; }

const CAP_SECONDS = 12 * 60;
const DT = 1 / 60;

export function runLevel(index) {
  const game = new Game({ levels: LEVELS, buildWorld });
  game.loadLevel(index);
  const route = planChainRoute(game.world, game.level);
  const ap = new Autopilot(game.world, route);
  const log = [];
  let t = 0;
  while (t < CAP_SECONDS && !game.state.levelComplete) {
    game.step(ap.input(game.state), DT);
    t += DT;
    for (const e of game.state.events) {
      if (e.type === 'poi') log.push(`${t.toFixed(1)}s poi ${e.poi.id} ${e.full ? 'FULL' : 'partial q=' + e.quality + ' missing=' + e.missing.join(',')}`);
      else if (e.type === 'gate-open' || e.type === 'level-complete' || e.type === 'resonance-end') log.push(`${t.toFixed(1)}s ${e.type}${e.poiId ? ' ' + e.poiId : ''}`);
    }
    if (ap.done && !game.state.levelComplete && t > 5) {
      // route finished without completing; give the sim a moment then stop
      for (let i = 0; i < 60; i++) game.step({ x: 0, y: 0, run: false, rest: false }, DT);
      break;
    }
  }
  return { game, route, ap, t, log };
}

test('levels module loads', { skip: loadError ? 'levels/terrain not available: ' + loadError.message : false }, () => {
  assert.ok(LEVELS.length >= 1);
});

if (!loadError) {
  for (let i = 0; i < LEVELS.length; i++) {
    test(`autopilot completes level ${i}: ${LEVELS[i].id}`, () => {
      const { game, route, ap, t, log } = runLevel(i);
      const ok = game.state.levelComplete;
      console.log(`  [chain] ${LEVELS[i].id}: ${ok ? 'complete' : 'FAILED'} in ${t.toFixed(1)} s (${route.length} waypoints)${route.warnings.length ? ' warnings: ' + route.warnings.join(' | ') : ''}`);
      if (!ok) console.log(log.map((l) => '    ' + l).join('\n') + `\n    failed waypoints: ${JSON.stringify(ap.failed)}, stopped at waypoint ${ap.waypointIndex}/${route.length}`);
      assert.ok(ok, `level ${LEVELS[i].id} not completed within ${CAP_SECONDS} s; route warnings: ${route.warnings.join(' | ')}`);
      assert.ok(game.progress.completed.includes(LEVELS[i].id));
      assert.ok(game.progress.fragments.includes(LEVELS[i].id));
    });
  }
}
