#!/usr/bin/env node
// Bake a 3D scene (tools/scenes/<name>.mjs) into a palette-index start-screen image.
//
//   node tools/bake-title.mjs <scene> [--ss 2] [--w 384 --h 216] [--out src/render/title/baked/<scene>.js] [--preview out/<scene>.png]
//        [--param key=value ...] [--params '{"json":1}'] [--workers N] [--gamma g] [--contrast c] [--dither d] [--sharpen s] [--outline o]
//        [--preview-scale 3] [--crop x,y,w,h] [--lum <png>]   (--lum writes the unquantised greyscale render, for tuning)
//        [--no-write]                         (render + preview only)
//
// <scene> is a name (tools/scenes/<name>.mjs) or a path. The module's build(params) gives the scene; an optional `export const quantise = {...}`
// holds that scene's default quantiser options (CLI flags override). --param values are parsed as JSON when possible (--param sun=0.4 --param night=true).
// Output module: export default { w, h, idx, layer, embers, meta }, read back with src/render/title/bakedkit.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { render } from './render3d/render.mjs';
import { quantise } from './render3d/quantise.mjs';
import { bakedModuleSource, fnv1a } from './render3d/bakefmt.mjs';
import { indexPNG, lumPNG } from './render3d/png.mjs';
import { PAL_INDEX } from '../src/render/palette.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const multi = (n) => argv.reduce((a, v, i) => (v === '--' + n ? [...a, argv[i + 1]] : a), []);

export async function bake({ scene, ss = 2, w = 384, h = 216, params = {}, workers = os.cpus().length, quant = {} }) {
  const file = fs.existsSync(scene) ? path.resolve(scene) : path.join(here, 'scenes', scene.replace(/\.mjs$/, '') + '.mjs');
  const mod = await import(pathToFileURL(file).href);
  const r = await render({ scene: file, params, w, h, ss, workers });
  const q = { ...(mod.quantise || {}), ...quant };
  const idx = quantise(r, w, h, q);
  return { ...r, idx, quant: q, file, name: path.basename(file, '.mjs') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scene = argv[0] && !argv[0].startsWith('--') ? argv[0] : null;
  if (!scene) { console.error('usage: node tools/bake-title.mjs <scene> [--ss 2] [--w 384 --h 216] [--out file] [--preview png] [--param k=v]'); process.exit(2); }
  const params = opt('params') ? JSON.parse(opt('params')) : {};
  for (const kv of multi('param')) { const [k, ...v] = kv.split('='); const s = v.join('='); try { params[k] = JSON.parse(s); } catch { params[k] = s; } }
  const quant = {};
  for (const k of ['gamma', 'contrast', 'sharpen', 'outline', 'exposure']) if (opt(k) != null) quant[k] = +opt(k);
  if (opt('dither') != null) quant.ditherScale = +opt('dither');
  const W = +opt('w', 384), H = +opt('h', 216), SS = +opt('ss', 2);
  const t0 = Date.now();
  const res = await bake({ scene, ss: SS, w: W, h: H, params, workers: +opt('workers', os.cpus().length), quant });
  const hash = fnv1a(res.idx);
  console.log(`rendered ${res.name} ${W}x${H} ss${SS} in ${(res.ms / 1000).toFixed(1)} s (${Date.now() - t0} ms total), hash ${hash}`);
  const out = path.resolve(root, opt('out', path.join('src/render/title/baked', res.name + '.js')));
  if (!flag('no-write')) {
    const { source, embers } = bakedModuleSource({ w: W, h: H, idx: res.idx, layer: res.layer, emberIdx: PAL_INDEX.ember, meta: { scene: res.name, ss: SS, hash, params } });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, source);
    console.log(`wrote ${path.relative(root, out)}  ${(source.length / 1024).toFixed(1)} KB, ${embers.length} ember pixels`);
  }
  const pv = opt('preview');
  if (pv) {
    let pi = res.idx, pw = W, ph = H, ps = +opt('preview-scale', 3);
    if (opt('crop')) {   // --crop x,y,w,h : preview only that window (use a larger --preview-scale to inspect detail)
      const [cx, cy, cw, ch] = opt('crop').split(',').map(Number);
      pi = new Uint8Array(cw * ch); pw = cw; ph = ch;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) pi[y * cw + x] = res.idx[(cy + y) * W + cx + x];
    }
    fs.mkdirSync(path.dirname(path.resolve(pv)), { recursive: true });
    fs.writeFileSync(path.resolve(pv), indexPNG(pi, pw, ph, ps));
    console.log('preview', path.resolve(pv));
  }
  if (opt('lum')) { fs.writeFileSync(path.resolve(opt('lum')), lumPNG(res.lum, W, H, +opt('preview-scale', 3))); console.log('lum', path.resolve(opt('lum'))); }
}
