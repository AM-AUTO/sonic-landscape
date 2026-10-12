/**
 * Hand-defined pixel art: the 12x12 hill-walker, 8x8 artefact icons, map
 * symbols, gate glyph, HUD glyphs. Every sprite is an array of equal-length
 * strings; characters index a colour map (see COLORS). '.' is transparent.
 */
import { PAL } from './palette.js';

export const COLORS = {
  k: PAL.ink, m: PAL.magenta, n: PAL.night, s: PAL.paper2, S: PAL.paper, b: PAL.waterInk, h: PAL.water,
  g: PAL.waterDeep, w: PAL.snow, c: PAL.contour, d: PAL.contourIdx, r: PAL.rock, p: PAL.paper, t: PAL.woodDark,
  l: PAL.wood, i: PAL.grid, o: PAL.bog,
};

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  return new OffscreenCanvas(w, h);
}

function check(name, art) {
  const w = art[0].length;
  art.forEach((r, i) => { if (r.length !== w) throw new Error(`sprite ${name} row ${i} is ${r.length} wide, expected ${w}: "${r}"`); });
}

const cache = new Map();

/** Paint an art array to a canvas (cached by key). cmap overrides/extends COLORS. */
export function artCanvas(key, art, { flipX = false, cmap = null, mono = null } = {}) {
  const ck = key + (flipX ? '|f' : '') + (mono ? '|' + mono : '');
  const hit = cache.get(ck);
  if (hit) return hit;
  check(key, art);
  const w = art[0].length, h = art.length;
  const c = makeCanvas(w, h);
  const x = c.getContext('2d');
  const cm = cmap ? { ...COLORS, ...cmap } : COLORS;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const ch = art[yy][flipX ? w - 1 - xx : xx];
      if (ch === '.' || ch === ' ') continue;
      const col = mono || cm[ch];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(xx, yy, 1, 1);
    }
  }
  cache.set(ck, c);
  return c;
}

/** Blit a canvas at integer position, no smoothing. */
export function blit(ctx, canvas, x, y, scale = 1) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  if (scale === 1) ctx.drawImage(canvas, Math.round(x), Math.round(y));
  else ctx.drawImage(canvas, Math.round(x), Math.round(y), canvas.width * scale, canvas.height * scale);
  ctx.imageSmoothingEnabled = prev;
}

// ------------------------------------------------------------------ walker
// k ink  m jacket  n trousers  s skin  b/c rucksack  w highlight
const W_S = {
  head: [
    '...kkkkkk...',
    '..kkwkkkkk..',
    '..kssssssk..',
    '..kskssksk..',
    '...kssssk...',
  ],
  body: [
    '..kmmmmmmk..',
    'bkmmwmmmmmkb',
    '.kmmmmmmmmk.',
    '.ksmmmmmmsk.',
    '..knnnnnnk..',
  ],
  legs: {
    0: ['..knn..nnk..', '..kkk..kkk..'],
    1: ['..knn..kkk..', '..kkk.......'],
    2: ['..kkk..nnk..', '.......kkk..'],
  },
};
const W_N = {
  head: [
    '...kkkkkk...',
    '..kkkkkkkk..',
    '..kkkkkkkk..',
    '..kkkkkkkk..',
    '...kssssk...',
  ],
  body: [
    '..kmmmmmmk..',
    '.kmbbbbbbmk.',
    '.kmbccccbmk.',
    '.ksbbbbbbsk.',
    '..knnnnnnk..',
  ],
  legs: W_S.legs,
};
const W_E = {
  head: [
    '....kkkkk...',
    '...kkwkkkkk.',
    '...kkssssk..',
    '...kkssksk..',
    '....kssssk..',
  ],
  body: [
    '.bbkmmmmk...',
    '.bckmmmmmk..',
    '.bbkmmmmss..',
    '.bbknnnnk...',
    '..knnnnnk...',
  ],
  legs: {
    0: ['..knn.nnk...', '..kkk.kkkk..'],
    1: ['.knn...nnk..', '.kkk....kkk.'],
    2: ['...knnnnk...', '...kkkkkk...'],
  },
};
const W_SLIDE = [
  '............',
  '......kkkk..',
  '.....kkwkkk.',
  '.....kssssk.',
  '..bb.ksksk..',
  '.bbbkmmmmk..',
  '.bbckmmmmmss',
  '..bbknnnk...',
  '...knnnnnkk.',
  '....kknnnnnk',
  '....kkkkkkkk',
  '.r.r.r.r.r..',
];
const W_RIPPLE = [
  [
    '..hhhhhhhh..',
    '.hwwhhhhwwh.',
    '.ghhhhhhhhg.',
    '..gggggggg..',
  ],
  [
    '..hhhhhhhh..',
    '.hhwwhhwwhh.',
    '.ghhhhhhhhg.',
    '..gggggggg..',
  ],
];
const W_MUD = [
  [
    '..oooooooo..',
    '.oddooooddo.',
    '.doooooooood',
    '..dddddddd..',
  ],
  [
    '..oooooooo..',
    '.ooddooddoo.',
    '.doooooooood',
    '..dddddddd..',
  ],
];

function walkerArt(dir, pose, frame) {
  const set = dir === 'S' ? W_S : dir === 'N' ? W_N : W_E;
  const base = [...set.head, ...set.body];
  const legIdx = pose === 'idle' ? 0 : (frame === 0 ? 1 : 2);
  return [...base, ...set.legs[legIdx]];
}

/**
 * Walker sprite canvas. dir: 'N'|'E'|'S'|'W'; pose: 'idle'|'walk'|'slide'|'wade'|'mud';
 * frame 0/1 selects the walk step (or ripple phase for wade/mud).
 */
export function walkerSprite(dir, pose = 'idle', frame = 0) {
  const flip = dir === 'W';
  const d = dir === 'W' ? 'E' : dir;
  if (pose === 'slide') return artCanvas('walker-slide', W_SLIDE, { flipX: flip });
  if (pose === 'wade' || pose === 'mud') {
    const art = walkerArt(d, 'idle', 0).slice(0, 8).concat((pose === 'wade' ? W_RIPPLE : W_MUD)[frame & 1]);
    return artCanvas(`walker-${pose}-${d}-${frame & 1}`, art, { flipX: flip });
  }
  const art = walkerArt(d, pose, frame);
  return artCanvas(`walker-${d}-${pose}-${frame}`, art, { flipX: flip });
}
export const WALKER_SIZE = 12;

// ------------------------------------------------------------- 8x8 icons
export const ICON_ART = {
  trig: [
    '...bb...',
    '..b..b..',
    '..b..b..',
    '.b....b.',
    '.b.bb.b.',
    'b......b',
    'bbbbbbbb',
    '........',
  ],
  cairn: [
    '........',
    '...kk...',
    '..kddk..',
    '..kkkk..',
    '.kddkdk.',
    '.kkkkkk.',
    'kdddkddk',
    'kkkkkkkk',
  ],
  lochan: [
    '........',
    '..bbbb..',
    '.bhhhhb.',
    'bhhwhhhb',
    'bhhhhwhb',
    '.bhhhhb.',
    '..bbbb..',
    '........',
  ],
  waterfall: [
    '...bb...',
    '...bb...',
    '.bbbbbb.',
    '...bb...',
    '..bbbb..',
    '...bb...',
    '.bbbbbb.',
    '...bb...',
  ],
  bothy: [
    '...kk...',
    '..kkkk..',
    '.kkkkkk.',
    'kkkkkkkk',
    '.kkkkkk.',
    '.kk..kk.',
    '.kk..kk.',
    '........',
  ],
  stone: [
    '...kk...',
    '..kkkk..',
    '..kkkk..',
    '..kkkk..',
    '..kkkk..',
    '..kkkk..',
    '.kkkkkk.',
    '........',
  ],
  crag: [
    'kkkkkkkk',
    'k.k.k.k.',
    'k.k.k.k.',
    '.k.k.k.k',
    '.k.k.k.k',
    'k.k.k.k.',
    'k...k...',
    '........',
  ],
  summit: [
    '...mm...',
    '..mmmm..',
    '...mm...',
    '...kk...',
    '..kkkk..',
    '.kkkkkk.',
    'kkkkkkkk',
    '........',
  ],
};
export const ICON_SIZE = 8;

/** 8x8 artefact icon. lit=false draws it as a rock-grey silhouette. */
export function iconSprite(type, lit = true) {
  const art = ICON_ART[type] || ICON_ART.cairn;
  return artCanvas('icon-' + type, art, lit ? {} : { mono: PAL.rock });
}
/** Icon in a single colour. */
export function iconMono(type, color) {
  const art = ICON_ART[type] || ICON_ART.cairn;
  return artCanvas('icon-' + type, art, { mono: color });
}

// ------------------------------------------------------------- gate glyphs
const GATE_ART = [
  '...mmmmm...',
  '..mm...mm..',
  '.mm.....mm.',
  '.m.......m.',
  'mm.......mm',
  'm.........m',
  'm.........m',
  'm.........m',
  'm.........m',
  'mmm.....mmm',
];
const GATE_OPEN_ART = [
  '...mmmmm...',
  '..mmwwwmm..',
  '.mmwwwwwmm.',
  '.mwwwwwwwm.',
  'mmwwwwwwwmm',
  'mwwwwwwwwwm',
  'mwwwwwwwwwm',
  'mwwwwwwwwwm',
  'mwwwwwwwwwm',
  'mmmwwwwwmmm',
];
export function gateSprite(open = false) {
  return artCanvas(open ? 'gate-open' : 'gate', open ? GATE_OPEN_ART : GATE_ART);
}
export const GATE_SIZE = [11, 10];

// ------------------------------------------------------------- HUD glyphs
export const PADLOCK = [
  '..kkk..',
  '.k...k.',
  '.k...k.',
  'kkkkkkk',
  'kkk.kkk',
  'kkk.kkk',
  'kkkkkkk',
];
export function padlockSprite(color = PAL.rock) { return artCanvas('padlock', PADLOCK, { mono: color }); }

const SUN = [
  '....c....',
  '.c..c..c.',
  '..ccccc..',
  '..ccccc..',
  'ccccccccc',
  '..ccccc..',
  '..ccccc..',
  '.c..c..c.',
  '....c....',
];
const SUN_HALF_LOW = [
  '.........',
  '.........',
  '.........',
  '....m....',
  '..mmmmm..',
  '.mmmmmmm.',
  'mmmmmmmmm',
  'kkkkkkkkk',
  '.........',
];
const SUN_HALF_DAWN = [
  '.........',
  '..c...c..',
  '...c.c...',
  '..ccccc..',
  '.ccccccc.',
  'ccccccccc',
  'kkkkkkkkk',
  '.........',
  '.........',
];
const MOON = [
  '...nnn...',
  '..nn.....',
  '.nn......',
  '.nn......',
  '.nn......',
  '.nn......',
  '..nn...n.',
  '...nnnn..',
  '.........',
];
export function timeSprite(phase) {
  if (phase === 'dawn') return artCanvas('t-dawn', SUN_HALF_DAWN);
  if (phase === 'dusk') return artCanvas('t-dusk', SUN_HALF_LOW);
  if (phase === 'night') return artCanvas('t-night', MOON);
  return artCanvas('t-day', SUN);
}

// ----------------------------------------------------------- map symbols
// p = paper knockout, b = waterInk, k = ink, m = magenta, h = water
export const MAP_SYMBOLS = {
  trig: [
    '...b...',
    '..bpb..',
    '.bpppb.',
    '.bpbpb.',
    'bpppppb',
    'bbbbbbb',
  ],
  cairn: [
    '..kk..',
    '.kkkk.',
    'kk.kkk',
    'kkkkkk',
  ],
  bothy: [
    '..kkk..',
    '.kkkkk.',
    'kkkkkkk',
    'kkkkkkk',
    'kkk.kkk',
    'kkk.kkk',
  ],
  stone: [
    '..kk.',
    '.kkkk',
    '.kkkk',
    '.kkkk',
    '.kkkk',
    'kkkkk',
  ],
  waterfall: [
    'bbbbbbb',
    '.......',
    '.bbbbb.',
    '.......',
    '..bbb..',
  ],
  lochan: [
    '.bbb.',
    'bhhhb',
    'bhwhb',
    'bhhhb',
    '.bbb.',
  ],
  crag: [
    'k...k',
    'kk.kk',
    '.kkk.',
    '..k..',
  ],
  summit: [
    '...k...',
    '..kkk..',
    '...k...',
    '...k...',
    '..kkk..',
    '.kkpkk.',
    'kkpkkkk',
    'kkkkkkk',
  ],
  gate: [
    '..mmmmm..',
    '.mmpppmm.',
    'mmpppppmm',
    'mpppppppm',
    'mpppppppm',
    'mpppppppm',
    'mpppppppm',
    'mmpppppmm',
  ],
};
export function symbolSprite(type) { return artCanvas('sym-' + type, MAP_SYMBOLS[type] || MAP_SYMBOLS.cairn); }
export function symbolArt(type) { return MAP_SYMBOLS[type] || MAP_SYMBOLS.cairn; }

// --------------------------------------------------------------- conifer
export const TREE_ART = [
  '..#..',
  '.###.',
  '..#..',
  '.###.',
  '#####',
  '..#..',
];
export const TREE_ART_SMALL = [
  '.#.',
  '###',
  '.#.',
];
// bog tuft (marsh)
export const TUFT_ART = [
  '#.#.#',
  '#.#.#',
  '#####',
];

// all art keys, for the specimen sheet
export function allSprites() {
  const out = [];
  for (const d of ['S', 'N', 'E', 'W']) {
    out.push(walkerSprite(d, 'idle'), walkerSprite(d, 'walk', 0), walkerSprite(d, 'walk', 1));
  }
  out.push(walkerSprite('E', 'slide'), walkerSprite('S', 'wade', 0), walkerSprite('S', 'wade', 1), walkerSprite('E', 'mud', 0));
  return out;
}
