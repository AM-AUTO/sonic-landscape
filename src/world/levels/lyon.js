/**
 * III. Glen Lyon (NN) — December. A trench glen: one long, narrow glen runs the whole sheet west to east under
 * steep wooded walls, from the Loch Lyon reservoir at its head to the Fortingall yew at its mouth. Hanging side
 * glens fall into it from the high moor to the north; the Pass of Lyon is a wooded gorge near the mouth.
 * Gleann Cailliche, far up in the west, holds Tigh nam Bodach, the stone family's wee house. Schiehallion stands
 * as a cone at the south-east corner.
 *
 * Names marked * are invented descriptive Gaelic, to be checked.
 */
// the glen, west (Loch Lyon) to east (the mouth at Fortingall); [x, y, floor m]
const glenHead = [[-6, 205, 330], [30, 202, 332], [70, 207, 334], [110, 210, 334], [130, 212, 330]];
const glenMid = [[124, 212, 326], [160, 220, 300], [200, 214, 262], [236, 219, 228], [258, 222, 204]];
const pass = [[252, 221, 206], [268, 224, 188], [284, 226, 170], [300, 230, 152], [316, 233, 138]];
const mouth = [[308, 232, 142], [336, 236, 128], [362, 238, 118], [392, 241, 110]];
// Gleann Cailliche: a long side glen curling up from the west end of the loch to a corrie head on the moor
const caillicheLow = [[30, 202, 352], [24, 180, 384], [30, 156, 420], [44, 132, 456], [54, 108, 490], [54, 88, 512]];
const caillicheHigh = [[54, 92, 508], [48, 70, 540], [52, 48, 584], [64, 30, 636]];
const lairig = [[196, 212, 268], [204, 190, 330], [202, 160, 400], [190, 130, 445], [180, 100, 480], [182, 70, 505], [194, 36, 528], [198, -6, 545]];

// roads and tracks
const road = [[383, 238], [362, 236], [336, 234], [314, 230], [296, 227], [280, 224], [264, 221], [240, 217], [214, 213], [196, 213], [176, 217], [156, 217], [136, 211], [124, 208]];
const lochTrack = [[124, 208], [104, 200], [80, 198], [56, 197], [36, 196], [18, 206], [8, 218]];
const caillicheTrack = [[34, 197], [25, 180], [30, 156], [44, 132], [54, 108], [54, 88], [49, 74]];
const lairigTrack = [[196, 213], [204, 190], [202, 160], [190, 130], [180, 100], [182, 70], [194, 36], [198, 0]];

export default {
  id: 'lyon',
  index: 2,
  name: 'Glen Lyon',
  gaelic: 'Gleann Lìomhann',
  gridLetters: 'NN',
  gridOrigin: [44, 50],
  subtitle: 'III. The Stane Hoose',
  seed: 3141,
  designVersion: 2,
  contourInterval: 20,
  elevation: { min: 110, max: 1083 },

  // December: hard frost, still air, stars; the rite ends at dusk, so the walk starts at first light
  season: { night: 0.63, dawn: 0.08, dusk: 0.08, startTime: 0.02, snowline: 650 },

  look: {
    paper: 'fog',
    light: { az: 180, el: 9, strength: 0.95 },
    signature: ['fieldWalls', 'shieling', 'pineRibbon', 'riverIce', 'iceLochans', 'inversion', 'frostGlint'],
    fieldWalls: { x: 270, y: 228, r: 128 },          // the glen floor, from Bridge of Balgie to the mouth
    shielings: [[40, 160], [47, 120], [61, 70], [24, 188]],
    shielingLabel: 'Shielings',
    pineRibbon: { x: 200, y: 222, r: 110 },          // the old pine along the walls
    inversion: { top: 0.27 },                         // cloud fills the glen floor at dawn, the moor stands clear
  },

  zones: [
    { id: 'floor', name: 'the glen floor', x: 205, y: 217, r: 62 },
    { id: 'pass', name: 'the Pass of Lyon', x: 290, y: 228, r: 30 },
    { id: 'moor', name: 'the high moor', x: 118, y: 60, r: 62 },
    { id: 'cailliche', name: 'Gleann Cailliche', x: 46, y: 118, r: 44 },
    { id: 'loch', name: 'Loch Lyon', x: 70, y: 205, r: 40 },
  ],

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(600);
    // the high moor: a broad, warped swell north of the glen (rolling, boggy, no hard edge)
    T.dome({ x: 150, y: 58, rx: 215, ry: 125, angle: 0.06, height: 165, steep: 0.25, warp: 0.4 });
    T.dome({ x: 300, y: 70, rx: 110, ry: 80, height: 50, steep: 0.1, warp: 0.4 });
    T.addNoise({ scale: 150, amp: 60, octaves: 3, offset: 1 });
    T.addNoise({ scale: 52, amp: 34, octaves: 4, ridged: true, warp: 14, offset: 2 });
    T.addNoise({ scale: 14, amp: 7, octaves: 3, offset: 3 });
    // the north wall: a long rampart of rounded tops (Càrn Mairg in the east, Stùc an Lochain* in the west)
    T.ridge({ points: [[60, 180, 120], [100, 174, 190], [150, 168, 230], [206, 164, 210], [262, 158, 280], [318, 150, 330], [364, 160, 200]], width: 30, jagged: 0.2, sharpness: 0.6, height: 240 });
    // the south wall: Meall Ghaordaidh and the hills towards Glen Lochay
    T.ridge({ points: [[-6, 292, 280], [50, 278, 360], [100, 290, 400], [150, 280, 300], [196, 288, 330], [244, 274, 240], [296, 268, 170]], width: 32, jagged: 0.3, sharpness: 0.6, height: 300, meander: 8 });
    // Schiehallion: a cone at the south-east corner, long east-west
    T.dome({ x: 338, y: 340, rx: 36, ry: 24, angle: 0.08, height: 560, steep: 0.45, warp: 0.12 });
    // Creag na Caillich: a craggy face biting into the south hills
    T.corrie({ x: 212, y: 300, radius: 13, depth: 150, open: Math.PI / 2 });
    // Glen Lochay along the south edge, west half
    T.carveGlen({ points: [[-6, 372, 260], [80, 368, 300], [170, 376, 360], [240, 392, 420]], width: 26, profile: 'U', flat: 0.3, wobble: 0.4 });
    // strath of the Lyon at the mouth: the ground opens out round Fortingall
    T.carveGlen({ points: [[300, 232, 300], [340, 238, 240], [392, 242, 200]], width: 46, profile: 'U', flat: 0.2, wobble: 0.5 });
    // the Pass: two wooded shoulders close in on the river (the gorge is cut through them below)
    T.ridge({ points: [[244, 202, 120], [264, 206, 230], [290, 210, 260], [318, 216, 180], [336, 220, 60]], width: 14, jagged: 0.15, sharpness: 0.7, height: 220 });
    T.ridge({ points: [[244, 244, 100], [266, 244, 240], [292, 250, 270], [318, 252, 190], [336, 254, 60]], width: 14, jagged: 0.15, sharpness: 0.7, height: 220 });

    // hanging side glens from the high moor: each starts in a corrie, tapers, bends, and ends at a lip above the trench
    const sideGlen = (head, low, lip, wHead, wLow) => {
      T.carveGlen({ points: head, width: wHead, profile: 'V', wobble: 0.55, meander: 2 });
      T.carveGlen({ points: low, width: wLow, profile: 'U', flat: 0.25, wobble: 0.55, meander: 2 });
      T.carveGlen({ points: lip, width: 5, profile: 'V', wobble: 0.4 });   // the notch the burn falls through
    };
    T.carveGlen({ points: caillicheLow, width: 15, profile: 'U', flat: 0.38, wobble: 0.5 });                                         // Gleann Cailliche
    T.carveGlen({ points: caillicheHigh, width: 10, profile: 'U', flat: 0.25, wobble: 0.55 });
    T.carveGlen({ points: lairig, width: 13, profile: 'U', flat: 0.32, wobble: 0.5 });                                               // the Làirig Ghallabhaich
    sideGlen([[214, 100, 700], [220, 120, 655], [230, 142, 610]], [[228, 138, 615], [238, 160, 570], [244, 180, 515], [246, 192, 470]], [[246, 190, 470], [249, 204, 300]], 7, 10);   // Invervar burn
    sideGlen([[304, 92, 690], [300, 112, 650], [292, 132, 610]], [[294, 128, 615], [284, 150, 570], [276, 172, 500], [273, 190, 430]], [[273, 188, 430], [272, 204, 250]], 6, 9);    // Allt Easain*, into the Pass
    sideGlen([[362, 104, 680], [356, 124, 640], [348, 144, 590]], [[350, 140, 595], [340, 162, 540], [334, 184, 450], [332, 198, 390]], [[332, 196, 390], [331, 214, 250]], 7, 10);   // Allt Coire Chearcaill*
    // corrie heads
    T.corrie({ x: 64, y: 28, radius: 13, depth: 60, open: 1.9 });
    T.corrie({ x: 214, y: 100, radius: 12, depth: 70, open: 1.25 });
    T.corrie({ x: 304, y: 92, radius: 11, depth: 65, open: 1.75 });
    T.corrie({ x: 362, y: 104, radius: 12, depth: 65, open: 1.85 });
    // spurs and gullies on every wall
    T.addNoise({ scale: 24, amp: 32, octaves: 3, ridged: true, offset: 7,
      mask: (x, y, hh) => Math.min(1, Math.max(0, (hh - 300) / 120)) * Math.min(1, Math.max(0, (880 - hh) / 140)) });

    // the trench itself: long, narrow, steep-walled
    T.carveGlen({ points: glenHead, width: 22, profile: 'U', flat: 0.32, wobble: 0.3 });
    T.carveGlen({ points: glenMid, width: 21, profile: 'U', flat: 0.3, wobble: 0.3, meander: 4 });
    T.carveGlen({ points: pass, width: 13, profile: 'V', wobble: 0.2 });
    T.carveGlen({ points: mouth, width: 24, profile: 'U', flat: 0.35, wobble: 0.35 });
    T.smooth(2);

    T.fitMax(1083, 820);
    T.peak({ x: 338, y: 340, height: 1083, radius: 18, search: 10 });   // Schiehallion
    T.peak({ x: 318, y: 150, height: 1042, radius: 14, search: 10 });   // Càrn Mairg
    T.peak({ x: 100, y: 284, height: 1039, radius: 14, search: 10 });   // Meall Ghaordaidh
    T.peak({ x: 262, y: 158, height: 1029, radius: 12, search: 10 });   // Càrn Gorm
    T.peak({ x: 150, y: 168, height: 960, radius: 12, search: 10 });    // Stùc an Lochain*
    T.clampTo(110, 1083);

    // Loch Lyon: the reservoir filling the head of the glen
    T.loch({ points: [[-6, 205], [24, 202], [56, 206], [92, 209], [122, 211]], width: 8, level: 352, depth: 9, wobble: 0.45, shallow: 2 });
    // moor lochans
    T.loch({ x: 140, y: 104, rx: 6, ry: 3.5, angle: 0.3, depth: 2, kind: 'lochan' });
    T.lochans({ count: 7, area: { x0: 80, y0: 20, x1: 240, y1: 120 }, rmin: 1.6, rmax: 3.4, avoid: [{ x: 140, y: 104, r: 12 }, ...T.avoidAlong(lairig, 9), ...T.avoidAlong(caillicheLow, 9), ...T.avoidAlong(caillicheHigh, 9)] });

    T.path(road);
    T.path(lochTrack);
    T.path(caillicheTrack);
    T.path(lairigTrack);
    T.path([[338, 236], [344, 262], [338, 300], [330, 326]]);         // up Schiehallion from the strath
    T.path([[160, 217], [150, 246], [128, 272]]);                     // over to Meall Ghaordaidh

    T.label(338, 340, 'Sìdh Chailleann', 'peak');
    T.label(318, 150, 'Càrn Mairg', 'peak');
    T.label(100, 284, 'Meall Ghaordaidh', 'peak');
    T.label(262, 158, 'Càrn Gorm', 'peak');
    T.label(60, 214, 'Loch Lìomhann', 'water');
    T.label(140, 98, 'Lochan nan Damh', 'water');
    T.label(205, 226, 'Gleann Lìomhann', 'glen');
    T.label(40, 140, 'Gleann Cailliche', 'glen');
    T.label(290, 240, 'Pass of Lyon', 'feature');
    T.label(372, 228, 'Fortingall Yew', 'feature');
    T.label(170, 70, 'Làirig Ghallabhaich', 'glen');
    T.label(120, 370, 'Gleann Lòchaidh', 'glen');
  },

  cover: {
    treeline: 560, woodDensity: 0.58, woodSlope: 0.75, bogFlatness: 0.07, bogMax: 780, bogAmount: 0.55, snowline: null,
    rockline: 960, rockAmount: 0.5, cragSlope: 1.05, cragStrata: 0.2, cragJitter: 0.14, screeSlope: 0.85, screeMinH: 760,
    streamThreshold: 1800, riverThreshold: 5200, fallDrop: 30,
    // fields on the flat glen floor, old pine on the walls above them
    adjust: (x, y, hh, sl, c) => {
      if ((c === 6 /* WOOD */ || c === 2 /* BOG */) && sl < 0.07 && hh < 420) return 0;   // MOOR: the in-bye fields
      if (c === 6 && x < 96 && y < 192) return 0;                                             // Gleann Cailliche: bare, high
      if (sl > 0.5 && (x - 212) ** 2 + (y - 296) ** 2 < 15 * 15) return 4;                  // CRAG: Creag na Caillich
      return undefined;
    },
  },

  spawn: { x: 368, y: 237 },
  pois: [
    // the rite: the fall in the Pass from above, the stones by dwelling, their house at dusk
    { id: 'eas-easain', type: 'waterfall', name: 'Eas Easain', x: 273, y: 204, condition: { approach: 'descending' }, hint: 'A burn draps aff the hingin glen intae the Pass. Come doun tae it.' },   // * invented name
    { id: 'na-clachan', type: 'stone', name: 'Na Clachan', x: 40, y: 186, condition: { dwell: 5 }, hint: 'The Cailleach, the Bodach an their bairns. Bide wi them a while.' },
    { id: 'tigh-nam-bodach', type: 'bothy', name: 'Tigh nam Bodach', x: 50, y: 78, condition: { time: 'dusk' }, hint: 'Their wee hoose. Come at the gloamin an shut them in for the winter.' },
    // the rest of the glen
    { id: 'invermearan', type: 'bothy', name: 'Invermearan', x: 8, y: 226, condition: {}, hint: 'An auld lodge at the heid o the loch. Reek frae the lum.' },
    { id: 'eas-ghallabhaich', type: 'waterfall', name: 'Eas Ghallabhaich', x: 196, y: 204, condition: {}, hint: 'The Làirig burn comes ower its lip at Innerwick.' },   // * invented name
    { id: 'carn-nam-marbh', type: 'cairn', name: 'Càrn nam Marbh', x: 336, y: 244, condition: { approach: 'descending' }, hint: 'The plague stane in the field. Come doun tae it.' },
    { id: 'lochan-nan-damh', type: 'lochan', name: 'Lochan nan Damh', x: 140, y: 104, condition: { speed: 'slow' }, hint: 'Ice on the moss. Gang canny ower it.' },   // * invented name
    { id: 'carn-mairg', type: 'cairn', name: 'Càrn Mairg', x: 318, y: 120, condition: { approach: 'descending' }, hint: 'Grey stanes on the north rig. Come on the cairn fae abune.' },
    { id: 'trig-ghaordaidh', type: 'trig', name: 'Meall Ghaordaidh', x: 100, y: 284, condition: { climb: 2 }, hint: 'Twa thick contours up the sooth wa, nae step doun.' },
    { id: 'creag-na-caillich', type: 'crag', name: 'Creag na Caillich', x: 210, y: 300, condition: { speed: 'fast' }, hint: 'The auld wife\'s craig. It answers a rinnin fit.' },
    { id: 'schiehallion', type: 'summit', name: 'Sìdh Chailleann', x: 338, y: 340, condition: { climb: 3 }, hint: 'The cone ye see fae the haill glen. Three thick contours tae the tap.' },
  ],
  gate: { x: 198, y: 0, chain: ['waterfall', 'stone', 'bothy'], name: 'Làirig Ghallabhaich' },

  fieldNotes: [
    'Twa strangers cam in a snawstorm. The glen took them in, an it was aye guid tae the glen efter.',
    'The stanes gang oot at Bealltainn an come in at Samhain. Big yin, wee yins. Bide wi them.',
    'Naebody kens wha keeps them, but they\'re aye keepit. Shut the door at the gloamin.',
    'The burns hing ower the glen. Meet the fa\'s fae abune.',
  ],
  palette: { tint: '#6a7f94', accent: 'lamp', paper: '#d8d6d0' },
};
