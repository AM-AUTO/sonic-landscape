// Minimal PNG encoder (node:zlib) + palette-index preview helper. No dependencies.
import { deflateSync } from 'node:zlib';
import { PAL_RGB, PAL_NAMES } from '../../src/render/palette.js';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** rgb: Uint8Array w*h*3 -> PNG Buffer */
export function encodePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
/** palette-index buffer -> PNG at integer `scale` (nearest neighbour) */
export function indexPNG(idx, w, h, scale = 3) {
  const rgb = new Uint8Array(w * scale * h * scale * 3);
  const lut = PAL_NAMES.map((n) => PAL_RGB[n]);
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) {
    const c = lut[idx[((y / scale) | 0) * w + ((x / scale) | 0)]], o = (y * w * scale + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  }
  return encodePNG(w * scale, h * scale, rgb);
}
/** float lum 0..1 -> greyscale PNG (debug: see the render before quantising) */
export function lumPNG(lum, w, h, scale = 1) {
  const rgb = new Uint8Array(w * scale * h * scale * 3);
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) {
    const v = Math.max(0, Math.min(255, Math.round(lum[((y / scale) | 0) * w + ((x / scale) | 0)] * 255))), o = (y * w * scale + x) * 3;
    rgb[o] = rgb[o + 1] = rgb[o + 2] = v;
  }
  return encodePNG(w * scale, h * scale, rgb);
}
