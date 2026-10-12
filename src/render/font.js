/**
 * Embedded bitmap fonts. Two faces:
 *   'main'  5x7 (descenders on an 8th row), mixed case, Gaelic grave vowels
 *   'small' 3x5, single-case (lower case maps to the capitals) for map labels
 * Glyphs are drawn through per-colour atlas canvases with drawImage, 1:1 or
 * integer-scaled with smoothing off, so there is never any anti-aliasing.
 *
 * drawText(ctx, text, x, y, color, {align, scale, font, shadow, italic, spacing, halo})
 *   y is the top of the capital letters.  Returns the drawn width in px.
 */

const MAIN_HEX = {
  ' ': '00 00 00 00 00 00 00 00',
  '!': '04 04 04 04 04 00 04 00',
  '"': '0A 0A 0A 00 00 00 00 00',
  '#': '0A 0A 1F 0A 1F 0A 0A 00',
  '$': '04 0F 14 0E 05 1E 04 00',
  '%': '18 19 02 04 08 13 03 00',
  '&': '0C 12 14 08 15 12 0D 00',
  "'": '0C 04 08 00 00 00 00 00',
  '(': '02 04 08 08 08 04 02 00',
  ')': '08 04 02 02 02 04 08 00',
  '*': '00 04 15 0E 15 04 00 00',
  '+': '00 04 04 1F 04 04 00 00',
  ',': '00 00 00 00 0C 04 08 00',
  '-': '00 00 00 1F 00 00 00 00',
  '.': '00 00 00 00 00 0C 0C 00',
  '/': '01 01 02 04 08 10 10 00',
  '0': '0E 11 13 15 19 11 0E 00',
  '1': '04 0C 04 04 04 04 0E 00',
  '2': '0E 11 01 02 04 08 1F 00',
  '3': '1F 02 04 02 01 11 0E 00',
  '4': '02 06 0A 12 1F 02 02 00',
  '5': '1F 10 1E 01 01 11 0E 00',
  '6': '06 08 10 1E 11 11 0E 00',
  '7': '1F 01 02 04 08 08 08 00',
  '8': '0E 11 11 0E 11 11 0E 00',
  '9': '0E 11 11 0F 01 02 0C 00',
  ':': '00 0C 0C 00 0C 0C 00 00',
  ';': '00 0C 0C 00 0C 04 08 00',
  '<': '02 04 08 10 08 04 02 00',
  '=': '00 00 1F 00 1F 00 00 00',
  '>': '08 04 02 01 02 04 08 00',
  '?': '0E 11 01 02 04 00 04 00',
  '@': '0E 11 17 15 17 10 0E 00',
  A: '0E 11 11 1F 11 11 11 00',
  B: '1E 11 11 1E 11 11 1E 00',
  C: '0E 11 10 10 10 11 0E 00',
  D: '1C 12 11 11 11 12 1C 00',
  E: '1F 10 10 1E 10 10 1F 00',
  F: '1F 10 10 1E 10 10 10 00',
  G: '0E 11 10 17 11 11 0F 00',
  H: '11 11 11 1F 11 11 11 00',
  I: '0E 04 04 04 04 04 0E 00',
  J: '07 02 02 02 02 12 0C 00',
  K: '11 12 14 18 14 12 11 00',
  L: '10 10 10 10 10 10 1F 00',
  M: '11 1B 15 15 11 11 11 00',
  N: '11 11 19 15 13 11 11 00',
  O: '0E 11 11 11 11 11 0E 00',
  P: '1E 11 11 1E 10 10 10 00',
  Q: '0E 11 11 11 15 12 0D 00',
  R: '1E 11 11 1E 14 12 11 00',
  S: '0F 10 10 0E 01 01 1E 00',
  T: '1F 04 04 04 04 04 04 00',
  U: '11 11 11 11 11 11 0E 00',
  V: '11 11 11 11 11 0A 04 00',
  W: '11 11 11 15 15 15 0A 00',
  X: '11 11 0A 04 0A 11 11 00',
  Y: '11 11 11 0A 04 04 04 00',
  Z: '1F 01 02 04 08 10 1F 00',
  '[': '0E 08 08 08 08 08 0E 00',
  '\\': '10 10 08 04 02 01 01 00',
  ']': '0E 02 02 02 02 02 0E 00',
  '^': '04 0A 11 00 00 00 00 00',
  _: '00 00 00 00 00 00 00 1F',
  '`': '08 04 02 00 00 00 00 00',
  a: '00 00 0E 01 0F 11 0F 00',
  b: '10 10 16 19 11 11 1E 00',
  c: '00 00 0E 10 10 11 0E 00',
  d: '01 01 0D 13 11 11 0F 00',
  e: '00 00 0E 11 1F 10 0E 00',
  f: '06 09 08 1C 08 08 08 00',
  g: '00 00 0F 11 11 0F 01 0E',
  h: '10 10 16 19 11 11 11 00',
  i: '04 00 0C 04 04 04 0E 00',
  j: '02 00 06 02 02 02 12 0C',
  k: '10 10 12 14 18 14 12 00',
  l: '0C 04 04 04 04 04 0E 00',
  m: '00 00 1A 15 15 11 11 00',
  n: '00 00 16 19 11 11 11 00',
  o: '00 00 0E 11 11 11 0E 00',
  p: '00 00 1E 11 11 1E 10 10',
  q: '00 00 0D 13 13 0D 01 01',
  r: '00 00 16 19 10 10 10 00',
  s: '00 00 0F 10 0E 01 1E 00',
  t: '08 08 1C 08 08 09 06 00',
  u: '00 00 11 11 11 13 0D 00',
  v: '00 00 11 11 11 0A 04 00',
  w: '00 00 11 11 15 15 0A 00',
  x: '00 00 11 0A 04 0A 11 00',
  y: '00 00 11 11 11 0F 01 0E',
  z: '00 00 1F 02 04 08 1F 00',
  '{': '02 04 04 08 04 04 02 00',
  '|': '04 04 04 04 04 04 04 00',
  '}': '08 04 04 02 04 04 08 00',
  '~': '00 00 08 15 02 00 00 00',
  // extras
  '·': '00 00 00 0C 0C 00 00 00',            // ·
  '←': '00 04 08 1F 08 04 00 00',            // ←
  '→': '00 04 02 1F 02 04 00 00',            // →
  '↑': '04 0E 15 04 04 04 04 00',            // ↑
  '↓': '04 04 04 04 15 0E 04 00',            // ↓
  '◦': '00 00 0E 11 11 11 0E 00',            // ◦
  '°': '06 09 09 06 00 00 00 00',            // °
  '▲': '00 04 0E 0E 1F 1F 00 00',            // ▲
  '•': '00 00 0E 1F 1F 0E 00 00',            // •
  '…': '00 00 00 00 00 00 15 00',            // …
  '–': '00 00 00 0E 00 00 00 00',            // –
  '—': '00 00 00 1F 00 00 00 00',            // —
  '✕': '00 11 0A 04 0A 11 00 00',            // ✕
  '♪': '06 05 05 04 1C 1C 18 00',            // ♪
};

// 3x5 glyphs: five rows, 3 bits each (bit 2 = left).
const SMALL_ROWS = {
  '0': [7, 5, 5, 5, 7], '1': [2, 6, 2, 2, 7], '2': [7, 1, 7, 4, 7], '3': [7, 1, 7, 1, 7], '4': [5, 5, 7, 1, 1],
  '5': [7, 4, 7, 1, 7], '6': [7, 4, 7, 5, 7], '7': [7, 1, 1, 2, 2], '8': [7, 5, 7, 5, 7], '9': [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 7, 3], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7],
  ' ': [0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 2], ',': [0, 0, 0, 2, 4], ':': [0, 2, 0, 2, 0], ';': [0, 2, 0, 2, 4],
  '-': [0, 0, 7, 0, 0], '+': [0, 2, 7, 2, 0], '/': [1, 1, 2, 4, 4], '\\': [4, 4, 2, 1, 1],
  "'": [2, 2, 0, 0, 0], '"': [5, 5, 0, 0, 0], '(': [2, 4, 4, 4, 2], ')': [2, 1, 1, 1, 2],
  '!': [2, 2, 2, 0, 2], '?': [6, 1, 2, 0, 2], '=': [0, 7, 0, 7, 0], '%': [5, 1, 2, 4, 5], '*': [0, 5, 2, 5, 0],
  '#': [5, 7, 5, 7, 5], _: [0, 0, 0, 0, 7], '<': [1, 2, 4, 2, 1], '>': [4, 2, 1, 2, 4], '[': [6, 4, 4, 4, 6],
  ']': [3, 1, 1, 1, 3], '&': [2, 5, 2, 5, 3], '@': [7, 5, 7, 4, 3], '$': [3, 6, 2, 3, 6], '^': [2, 5, 0, 0, 0],
  '~': [0, 3, 6, 0, 0], '|': [2, 2, 2, 2, 2], '{': [3, 2, 6, 2, 3], '}': [6, 2, 3, 2, 6], '`': [4, 2, 0, 0, 0],
  '·': [0, 0, 2, 0, 0], '←': [2, 4, 7, 4, 2], '→': [2, 1, 7, 1, 2], '↑': [2, 7, 2, 2, 2],
  '↓': [2, 2, 2, 7, 2], '◦': [0, 2, 5, 2, 0], '°': [2, 5, 2, 0, 0], '▲': [0, 2, 7, 7, 0],
  '•': [0, 2, 7, 2, 0], '…': [0, 0, 0, 0, 5], '–': [0, 0, 7, 0, 0], '—': [0, 0, 7, 0, 0],
  '♪': [3, 2, 2, 6, 6],
};

// accents (grave) and their bases -----------------------------------------
const GRAVE_UP = { 'À': 'A', 'È': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U' };
const GRAVE_LOW = { 'à': 'a', 'è': 'e', 'ì': 'i', 'ò': 'o', 'ù': 'u' };

function parseMain() {
  const g = {};
  for (const ch of Object.keys(MAIN_HEX)) {
    g[ch] = { rows: MAIN_HEX[ch].split(' ').map((h) => parseInt(h, 16)), above: null, w: 5 };
  }
  // lower-case accented: grave in rows 0-1 (x-height starts at row 2)
  for (const [ch, base] of Object.entries(GRAVE_LOW)) {
    const rows = g[base].rows.slice();
    rows[0] = 0x08; rows[1] = 0x04;
    g[ch] = { rows, above: null, w: 5 };
  }
  // capitals: grave sits two rows above the cap line
  for (const [ch, base] of Object.entries(GRAVE_UP)) {
    g[ch] = { rows: g[base].rows.slice(), above: [0x08, 0x04], w: 5 };
  }
  return g;
}
// M and W get a real 5px-wide glyph so they never read as n / u.
const SMALL_WIDE = {
  M: [0x11, 0x1b, 0x15, 0x11, 0x11],
  W: [0x11, 0x11, 0x15, 0x1b, 0x11],
};
function parseSmall() {
  const g = {};
  for (const ch of Object.keys(SMALL_ROWS)) g[ch] = { rows: SMALL_ROWS[ch].map((r) => r << 2), above: null, w: 3 };
  g.M = { rows: SMALL_WIDE.M, above: null, w: 5 };
  g.W = { rows: SMALL_WIDE.W, above: null, w: 5 };
  for (const [ch, base] of Object.entries({ ...GRAVE_UP, ...GRAVE_LOW })) {
    g[ch] = { rows: g[base.toUpperCase()].rows, above: [0x10], w: g[base.toUpperCase()].w };
  }
  for (let c = 97; c <= 122; c++) g[String.fromCharCode(c)] = g[String.fromCharCode(c - 32)];
  return g;
}

export const FONTS = {
  main: { w: 5, h: 7, rowsN: 8, above: 2, adv: 6, lh: 9, glyphs: parseMain(), bits: 5 },
  small: { w: 5, h: 5, rowsN: 5, above: 1, adv: 4, lh: 7, glyphs: parseSmall(), bits: 5 },
};
export const FONT_METRICS = {
  main: { glyphW: 5, capH: 7, advance: 6, lineHeight: 9 },
  small: { glyphW: 3, capH: 5, advance: 4, lineHeight: 7 },
};

function glyphOf(font, ch) {
  const g = font.glyphs[ch];
  if (g) return g;
  const up = font.glyphs[ch.toUpperCase()];
  return up || font.glyphs['?'];
}

function advOf(font, ch) {
  const g = glyphOf(font, ch);
  return (g ? g.w : font.w) + 1;
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('no canvas available');
}

// ------------------------------------------------------------------ atlases
const atlasCache = new Map();
const CHARS = Object.keys(MAIN_HEX).concat(Object.keys(GRAVE_UP), Object.keys(GRAVE_LOW));
const SMALL_CHARS = Object.keys(parseSmall());
const ALL_CHARS = Array.from(new Set(CHARS.concat(SMALL_CHARS)));
const charIndex = new Map(ALL_CHARS.map((c, i) => [c, i]));

function getAtlas(fontName, color) {
  const key = fontName + color;
  let a = atlasCache.get(key);
  if (a) return a;
  const f = FONTS[fontName];
  const cw = f.w, ch = f.above + f.rowsN;
  const canvas = makeCanvas(cw * ALL_CHARS.length, ch);
  const cx = canvas.getContext('2d');
  cx.fillStyle = color;
  ALL_CHARS.forEach((c, i) => {
    const g = glyphOf(f, c);
    if (!g) return;
    for (let r = 0; r < g.rows.length; r++) {
      const bits = g.rows[r];
      for (let b = 0; b < f.w; b++) if (bits & (1 << (f.bits - 1 - b))) cx.fillRect(i * cw + b, f.above + r, 1, 1);
    }
    if (g.above) {
      for (let r = 0; r < g.above.length; r++) {
        const bits = g.above[r];
        const rr = f.above - g.above.length + r;
        for (let b = 0; b < f.w; b++) if (bits & (1 << (f.bits - 1 - b))) cx.fillRect(i * cw + b, rr, 1, 1);
      }
    }
  });
  a = { canvas, cw, ch, above: f.above };
  atlasCache.set(key, a);
  return a;
}

function italicShift(fontName, r) {
  if (fontName === 'main') return Math.floor((6 - r) / 2.5);
  return Math.floor((4 - r) / 2.5);
}

/** Width in px of a single-line string. */
export function measureText(text, opts = {}) {
  const f = FONTS[opts.font || 'main'];
  const scale = opts.scale || 1;
  const spacing = opts.spacing || 0;
  const chars = [...String(text)];
  const n = chars.length;
  if (n === 0) return 0;
  let w = 0;
  for (const c of chars) w += advOf(f, c);
  return (w - 1 + (n - 1) * spacing) * scale + (opts.italic && (opts.font || 'main') === 'main' ? 2 * scale : 0);
}

/** Greedy word wrap -> array of lines. */
export function wrapText(text, maxWidth, opts = {}) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (measureText(t, opts) <= maxWidth || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function blit(ctx, atlas, ci, x, y, scale, italicFont) {
  const { canvas, cw, ch } = atlas;
  if (!italicFont) {
    ctx.drawImage(canvas, ci * cw, 0, cw, ch, x, y - atlas.above * scale, cw * scale, ch * scale);
    return;
  }
  for (let r = 0; r < ch; r++) {
    const logical = r - atlas.above;
    const sh = italicShift(italicFont, logical) * scale;
    ctx.drawImage(canvas, ci * cw, r, cw, 1, x + sh, y + logical * scale, cw * scale, scale);
  }
}

function drawRun(ctx, text, x, y, color, fontName, scale, spacing, italic) {
  const f = FONTS[fontName];
  const atlas = getAtlas(fontName, color);
  let cx = x;
  for (const chr of text) {
    let ci = charIndex.get(chr);
    if (ci === undefined) ci = charIndex.get('?');
    if (chr !== ' ') blit(ctx, atlas, ci, cx, y, scale, italic ? fontName : null);
    cx += (advOf(f, chr) + spacing) * scale;
  }
}

/**
 * Draw one line of text.  opts: {align:'left'|'center'|'right', scale:1,
 * font:'main'|'small', shadow:color, italic:bool, spacing:px, halo:color}
 */
export function drawText(ctx, text, x, y, color, opts = {}) {
  text = String(text);
  const fontName = opts.font || 'main';
  const scale = opts.scale || 1;
  const spacing = opts.spacing || 0;
  if (fontName !== 'main') opts = { ...opts, italic: false };   // 3x5 is too small to shear legibly
  const w = measureText(text, opts);
  let px = Math.round(x);
  if (opts.align === 'center') px = Math.round(x - w / 2);
  else if (opts.align === 'right') px = Math.round(x - w);
  const py = Math.round(y);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if (opts.halo) {
    const d = scale;
    const offs = opts.italic ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [ox, oy] of offs) drawRun(ctx, text, px + ox * d, py + oy * d, opts.halo, fontName, scale, spacing, !!opts.italic);
  }
  if (opts.shadow) drawRun(ctx, text, px + scale, py + scale, opts.shadow, fontName, scale, spacing, !!opts.italic);
  drawRun(ctx, text, px, py, color, fontName, scale, spacing, !!opts.italic);
  ctx.imageSmoothingEnabled = prev;
  return w;
}

/** Spaced capitals helper (OS-style glen names). */
export function drawSpaced(ctx, text, x, y, color, opts = {}) {
  return drawText(ctx, String(text).toUpperCase(), x, y, color, { spacing: 2, ...opts });
}

/** Does the font cover this character (after case folding)? */
export function hasGlyph(ch, font = 'main') { return !!FONTS[font].glyphs[ch]; }
