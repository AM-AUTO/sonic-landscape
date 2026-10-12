import test from 'node:test';
import assert from 'node:assert/strict';
import { channelTarget, applyChannelMods, fxTargets, ovr } from '../src/audio/macros.js';
import { PROFILES, LEVEL_IDS, CHANNEL_NAMES, channelBase } from '../src/audio/levelmusic.js';
import { Rng } from '../src/core/rng.js';

const rand = (r) => ({ a: r.float(), e: r.float(), d: r.float(), s: r.float(), v: r.float(), sw: r.float(), n: r.float(), w: r.float(), water: r.float(), snow: r.float(), bog: r.float(), scree: r.float(), rock: r.float(), wood: r.float(), path: r.float(), glitch: r.float() * 0.5, slide: r.float(), t: r.float() * 500, leadPan: r.float() - 0.5 });

test('channel and fx targets are finite and inside engine ranges for any control state', () => {
  const r = new Rng(11);
  for (const id of LEVEL_IDS) {
    const p = PROFILES[id], base = channelBase(p);
    for (let i = 0; i < 60; i++) {
      const C = rand(r);
      for (const n of CHANNEL_NAMES) {
        const o = applyChannelMods(channelTarget(n, base[n], C, p), n, { chMul: { [n]: { cutoff: 0.5 } }, chAdd: { [n]: { crush: 0.3 } }, chSet: {} });
        for (const [k, v] of Object.entries(o)) assert.ok(Number.isFinite(v), `${id}.${n}.${k}`);
        assert.ok(o.gain >= 0 && o.gain <= 1.8 && o.pan >= -1 && o.pan <= 1 && o.cutoff >= 300 && o.crush <= 1 && o.chorus <= 0.95);
      }
      const F = fxTargets(p.fx, C, { gran: { pitch: { v: 24, w: 0.5 } }, reverbSize: { v: 14, w: 0.3 } }, 60 / p.bpm, r.pick(['ebb', 'flow', 'swell']));
      assert.ok(F.reverb.size >= 0.8 && F.reverb.size <= 16);
      assert.ok(F.delay.time >= 0.08 && F.delay.time <= 4.4 && F.delay.fb >= 0 && F.delay.fb < 0.95);
      assert.ok(F.granular.feedback <= 0.7 && F.granular.density <= 80 && F.granular.size <= 1);
      for (const g of Object.values(F)) if (typeof g === 'object') for (const v of Object.values(g)) assert.ok(typeof v === 'boolean' || Number.isFinite(v));
    }
  }
});

test('altitude spreads the reverb from the glen floor to the tops (2 → 14 s class range)', () => {
  const p = PROFILES.rannoch;
  const C = { a: 0, e: 0.2, d: 0, s: 0, v: 0, sw: 0, n: 0, w: 0, water: 0, snow: 0, bog: 0, scree: 0, rock: 0, wood: 0, path: 0, glitch: 0, slide: 0, t: 0, leadPan: 0 };
  const lo = fxTargets(p.fx, { ...C, a: 0 }, {}, 1, 'flow').reverb.size, hi = fxTargets(p.fx, { ...C, a: 1 }, {}, 1, 'flow').reverb.size;
  assert.ok(hi - lo >= 8, `${lo}..${hi}`);
  const drift = fxTargets(p.fx, { ...C, a: 0.5, d: 1 }, {}, 1, 'ebb').reverb.size;
  assert.ok(drift > fxTargets(p.fx, { ...C, a: 0.5, d: 0 }, {}, 1, 'ebb').reverb.size, 'stillness grows the room');
});

test('ovr blends', () => {
  assert.equal(ovr(5, undefined), 5);
  assert.equal(ovr(5, 9), 9);
  assert.equal(ovr(4, { v: 8, w: 0.5 }), 6);
});
