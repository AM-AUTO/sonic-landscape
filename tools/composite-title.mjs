#!/usr/bin/env node
// The real start-screen composite, in Node: runs src/render/title/<variant>.js paint (+ optional anim at time t) into a Raster, adds the two small
// lines of text (prompt + controls) with the 3x5 map font where the variant's TITLE_LAYOUT puts them, and writes a PNG.
// (The game draws those lines with canvas drawText; this approximation needs no browser.)
//
//   node tools/composite-title.mjs [variant=mentol] [--out out/title-mentol.png] [--scale 3] [--t 1.0] [--no-text] [--crop x,y,w,h]
import fs from 'node:fs';
import path from 'node:path';
import { Raster } from '../src/render/artkit.js';
import { stampSmall, smallWidth } from '../src/render/artkit.js';
import { paintTitleArt, animTitleArt, TITLE_LAYOUT, TITLE_VARIANTS } from '../src/render/title/index.js';
import { TITLE } from '../src/text.js';
import { PAL_U32, PAL_INDEX, paletteIndexOf } from '../src/render/palette.js';
import { indexPNG } from './render3d/png.mjs';

const argv = process.argv.slice(2);
const variant = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'mentol';
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
if (!TITLE_VARIANTS.includes(variant)) { console.error('unknown variant ' + variant + ' (' + TITLE_VARIANTS.join(' ') + ')'); process.exit(2); }

const W = 384, H = 216;
const r = new Raster(W, H); r.lay.fill(0);
const S = { seed: 0 };
const spec = { kind: 'title', levelIndex: 3, variant };
paintTitleArt(r, spec, S);
const t = +opt('t', 0);
if (t > 0) animTitleArt(r, spec, S, t);
if (!argv.includes('--no-text')) {
  const L = TITLE_LAYOUT[variant], col = (n) => PAL_U32[n];
  const line = (txt, cx, y, c, halo) => stampSmall(r, txt, Math.round(cx - smallWidth(txt) / 2), y, c, halo, 7);
  if (!L.hide.includes('prompt')) {
    line(TITLE.prompt, L.prompt.x, L.prompt.y, col(L.colors.prompt), col(L.colors.promptHalo));
    const w = smallWidth(TITLE.prompt);
    line('>', L.prompt.x - w / 2 - 9, L.prompt.y, col(L.colors.arrow), col(L.colors.promptHalo));
    line('<', L.prompt.x + w / 2 + 9, L.prompt.y, col(L.colors.arrow), col(L.colors.promptHalo));
  }
  if (!L.hide.includes('controls')) line(TITLE.controlsKeys, W / 2, L.controls, col(L.colors.controls), col(L.colors.halo));
}
let idx = new Uint8Array(W * H), w = W, h = H;
for (let i = 0; i < idx.length; i++) { const p = paletteIndexOf(r.d[i]); idx[i] = p === 255 ? PAL_INDEX.magenta : p; }
if (opt('crop')) {
  const [cx, cy, cw, ch] = opt('crop').split(',').map(Number);
  const o = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) o[y * cw + x] = idx[(cy + y) * W + cx + x];
  idx = o; w = cw; h = ch;
}
const out = path.resolve(opt('out', `out/title-${variant}.png`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, indexPNG(idx, w, h, +opt('scale', 3)));
console.log('wrote', out);
