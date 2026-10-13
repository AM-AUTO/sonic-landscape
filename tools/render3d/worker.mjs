// worker_threads entry for render.mjs: builds the scene itself (scenes hold closures, so they are rebuilt per worker, deterministically).
import { parentPort, workerData } from 'node:worker_threads';
import { prepare, renderRows } from './render.mjs';

const { url, params, w, h, ss } = workerData;
const mod = await import(url);
const ctx = prepare(mod.build(params), w, h, ss);
parentPort.postMessage({ ready: true });
parentPort.on('message', ({ y0, y1 }) => {
  const r = renderRows(ctx, y0, y1);
  parentPort.postMessage({ y0, y1, ...r }, [r.lum.buffer, r.emis.buffer, r.depth.buffer, r.layer.buffer]);
});
