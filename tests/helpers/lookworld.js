/**
 * A small synthetic World for the map-bake / look tests: independent of the level generator (which
 * changes under its own builders), so a bake hash stays a fixed reference.
 *   sea in the west, a shingle shore, a flat glen floor with a burn and lochans, a bog, a pinewood,
 *   a ridge with crags, scree and rock, snow on the tops.
 */
import { COVER } from '../../src/world/codes.js';
import { hash2f } from '../../src/core/rng.js';

export function lookWorld({ size = 96, seed = 4242, look = undefined, season = undefined, id = 'lookworld' } = {}) {
  const N = size * size;
  const height = new Float32Array(N), cover = new Uint8Array(N), stream = new Uint8Array(N);
  const S = size;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const u = x / (S - 1), v = y / (S - 1);
      // ridge running N-S at u ~ 0.75, a glen at u ~ 0.45, sea west of u ~ 0.12
      const ridge = Math.exp(-((u - 0.76) ** 2) / 0.012) * (620 + 260 * Math.sin(v * 5.1));
      const knoll = Math.exp(-(((u - 0.32) ** 2) + ((v - 0.25) ** 2)) / 0.004) * 180;
      const base = 6 + Math.max(0, u - 0.12) * 260 + knoll;
      const n = (hash2f(x >> 2, y >> 2, seed) - 0.5) * 6;
      height[i] = Math.max(0, base + ridge + n);
      let c = COVER.MOOR;
      if (u < 0.12) c = COVER.DEEP;
      else if (u < 0.14) c = COVER.SHALLOW;
      if (u > 0.36 && u < 0.46 && v > 0.55 && v < 0.75) c = COVER.BOG;
      if (u > 0.2 && u < 0.3 && v > 0.6 && v < 0.85) c = COVER.WOOD;
      if (((u - 0.42) ** 2 + (v - 0.3) ** 2) < 0.0016) c = COVER.SHALLOW;      // a lochan
      if (((u - 0.5) ** 2 + (v - 0.86) ** 2) < 0.0009) c = COVER.DEEP;         // another
      const hh = height[i];
      if (u > 0.66 && u < 0.86) {
        if (hh > 700) c = COVER.SNOW;
        else if (Math.abs(u - 0.7) < 0.012 && v > 0.2 && v < 0.8) c = COVER.CRAG;
        else if (u > 0.7 && u < 0.73 && v > 0.2 && v < 0.8) c = COVER.SCREE;
        else if (u > 0.8 && u < 0.84 && v > 0.1 && v < 0.5) c = COVER.ROCK;
      }
      cover[i] = c;
      // a burn down the glen
      if (Math.abs(x - Math.round(S * 0.46 + Math.sin(v * 9) * 3)) === 0 && v > 0.05 && v < 0.55) stream[i] = 1;
    }
  }
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < N; i++) { if (height[i] < minH) minH = height[i]; if (height[i] > maxH) maxH = height[i]; }
  const level = { id, seed, gridLetters: 'NN', gridOrigin: [20, 60] };
  if (look !== undefined) level.look = look;
  if (season !== undefined) level.season = season;
  return {
    size: S, height, cover, stream, minH, maxH, contourInterval: 10, cellMeters: 40, level,
    features: {
      paths: [[{ x: 20, y: 10 }, { x: 30, y: 30 }, { x: 44, y: 50 }, { x: 60, y: 70 }]],
      labels: [{ x: 44, y: 40, text: 'Glen Test', kind: 'glen' }, { x: 6, y: 50, text: 'Sound of Test', kind: 'water' }],
      spotHeights: [{ x: 72, y: 30, h: 812 }],
      waterfalls: [],
    },
    pois: [{ id: 'cairn-a', type: 'cairn', x: 70, y: 40, name: 'Carn Test' }, { id: 'b', type: 'bothy', x: 40, y: 60, name: 'Bothy' }],
    gate: { x: 48, y: 95, side: 'S', name: 'Bealach', chain: ['cairn'] },
    spawn: { x: 40, y: 10 },
  };
}
