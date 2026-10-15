/**
 * A tiny software 2D canvas for Node: just enough of OffscreenCanvas / ImageData for the map bake,
 * the bitmap font and the sprite atlases (fillRect, drawImage with nearest scaling, put/getImageData).
 * Integer pixels only, source-over with binary alpha: exactly what the strict-palette renderer does.
 *
 *   import { installSoftCanvas } from './helpers/softcanvas.js';
 *   installSoftCanvas();   // defines globalThis.OffscreenCanvas and ImageData when missing
 */
function parseColor(s) {
  if (typeof s !== 'string') return [0, 0, 0, 255];
  if (s[0] === '#') {
    if (s.length === 4) return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16), 255];
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0] | 0, p[1] | 0, p[2] | 0, p.length > 3 ? Math.round(p[3] * 255) : 255];
  }
  return [0, 0, 0, 255];
}

export class SoftImageData {
  constructor(a, b, c) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = c != null ? c : a.length / 4 / b; }
  }
}

class SoftContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = '#000000';
    this.imageSmoothingEnabled = false;
    this.globalAlpha = 1;
  }
  fillRect(x, y, w, h) {
    const c = this.canvas, d = c.data, W = c.width, H = c.height;
    const [r, g, b, a] = parseColor(this.fillStyle);
    if (a === 0) return;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  clearRect(x, y, w, h) {
    const c = this.canvas, d = c.data, W = c.width, H = c.height;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) d.fill(0, (yy * W + xx) * 4, (yy * W + xx) * 4 + 4);
  }
  drawImage(src, ...a) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh;
    if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh; }
    else if (a.length === 4) { [dx, dy, dw, dh] = a; }
    else { [sx, sy, sw, sh, dx, dy, dw, dh] = a; }
    const sd = src.data, SWd = src.width, c = this.canvas, d = c.data, W = c.width, H = c.height;
    dx = Math.round(dx); dy = Math.round(dy); dw = Math.round(dw); dh = Math.round(dh);
    if (dw <= 0 || dh <= 0) return;
    for (let yy = 0; yy < dh; yy++) {
      const Y = dy + yy;
      if (Y < 0 || Y >= H) continue;
      const syy = sy + Math.floor((yy * sh) / dh);
      if (syy < 0 || syy >= src.height) continue;
      for (let xx = 0; xx < dw; xx++) {
        const X = dx + xx;
        if (X < 0 || X >= W) continue;
        const sxx = sx + Math.floor((xx * sw) / dw);
        if (sxx < 0 || sxx >= SWd) continue;
        const si = (syy * SWd + sxx) * 4;
        if (sd[si + 3] < 128) continue;
        const di = (Y * W + X) * 4;
        d[di] = sd[si]; d[di + 1] = sd[si + 1]; d[di + 2] = sd[si + 2]; d[di + 3] = 255;
      }
    }
  }
  putImageData(img, x, y) {
    const c = this.canvas, d = c.data, W = c.width, H = c.height, s = img.data;
    for (let yy = 0; yy < img.height; yy++) {
      const Y = y + yy;
      if (Y < 0 || Y >= H) continue;
      for (let xx = 0; xx < img.width; xx++) {
        const X = x + xx;
        if (X < 0 || X >= W) continue;
        const si = (yy * img.width + xx) * 4, di = (Y * W + X) * 4;
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
      }
    }
  }
  getImageData(x, y, w, h) {
    const out = new SoftImageData(w, h), c = this.canvas, d = c.data, W = c.width, H = c.height;
    for (let yy = 0; yy < h; yy++) {
      const Y = y + yy;
      if (Y < 0 || Y >= H) continue;
      for (let xx = 0; xx < w; xx++) {
        const X = x + xx;
        if (X < 0 || X >= W) continue;
        const si = (Y * W + X) * 4, di = (yy * w + xx) * 4;
        out.data[di] = d[si]; out.data[di + 1] = d[si + 1]; out.data[di + 2] = d[si + 2]; out.data[di + 3] = d[si + 3];
      }
    }
    return out;
  }
  createImageData(w, h) { return new SoftImageData(w, h); }
  save() {} restore() {} setTransform() {} translate() {} scale() {}
}

export class SoftCanvas {
  constructor(w = 300, h = 150) { this._w = w; this._h = h; this.data = new Uint8ClampedArray(w * h * 4); this._ctx = null; this.style = {}; }
  get width() { return this._w; }
  set width(v) { this._w = v | 0; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  get height() { return this._h; }
  set height(v) { this._h = v | 0; this.data = new Uint8ClampedArray(this._w * this._h * 4); }
  getContext() { if (!this._ctx) this._ctx = new SoftContext(this); return this._ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this._w, height: this._h }; }
}

export function installSoftCanvas() {
  if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = SoftCanvas;
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = SoftImageData;
}

/** FNV-1a over a typed array's bytes, as an 8-digit hex string. */
export function fnvHex(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ PNG out (Node only)
let CRC_T = null;
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Encode RGBA bytes (w*h*4) as an RGB PNG Buffer, nearest-scaled by an integer factor. Needs node:zlib's deflateSync. */
export function encodePNG(w, h, rgba, scale = 1, deflateSync) {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let Y = 0; Y < H; Y++) {
    const o = Y * (W * 3 + 1);
    raw[o] = 0;
    const y = (Y / scale) | 0;
    for (let X = 0; X < W; X++) {
      const s = (y * w + ((X / scale) | 0)) * 4, d = o + 1 + X * 3;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
