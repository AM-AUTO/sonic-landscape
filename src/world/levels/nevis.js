/**
 * VIII. Ben Nevis (NN) — the massif ring. The Ben is a great dome under a summit plateau, its gullied north
 * face standing over the Allt a' Mhuilinn and the Càrn Mòr Dearg arête curving round Coire Leis to the east.
 * Glen Nevis wraps round it: in from the sea loch on the west edge, south past the old track, east through
 * the gorge to the Steall meadow and its falls, out to the glen head on the east edge. The Mamores wall the
 * south. Bealltainn: the thaw, the burns in spate, snow left only in the north-facing gullies.
 *
 * The rite (kept): the falls at Steall, the hut below the gorge, the buttress at a run, then the summit by
 * climbing, with the pillar on Meall an t-Suidhe still ringing.
 */
// the glen: sea loch -> west side of the Ben -> Polldubh -> the gorge -> Steall meadow -> the glen head
const glenFloor = [[-6, 184, 0], [20, 192, 6], [44, 204, 16], [66, 222, 30], [88, 244, 46], [112, 264, 62], [140, 280, 80], [166, 288, 98]];
const gorge = [[166, 288, 98], [186, 291, 124], [206, 293, 152], [226, 295, 183], [244, 296, 203]];
const meadow = [[244, 296, 203], [270, 298, 209], [300, 297, 217], [330, 293, 231], [360, 289, 249], [390, 286, 265]];
const glenPath = [[383, 286], [356, 288], [328, 292], [300, 296], [272, 299], [250, 297], [230, 294], [210, 292], [190, 290], [170, 288],
  [148, 283], [124, 272], [102, 256], [82, 236], [64, 216], [46, 202], [26, 192], [10, 186], [0, 182]];
// the old pony track: zigzags up from the glen to the halfway lochan, then up the plateau
const ponyTrack = [[64, 216], [74, 204], [66, 194], [80, 184], [72, 174], [86, 164], [80, 154], [94, 146],
  [108, 146], [122, 156], [134, 150], [142, 160], [152, 152], [160, 160], [170, 154], [181, 153]];

// snow survives only on north-facing steep ground (the gullies): captured heights for the cover hook
let H = null, HS = 0;

export default {
  id: 'nevis',
  index: 7,
  name: 'Ben Nevis',
  gaelic: 'Beinn Nibheis',
  gridLetters: 'NN',
  gridOrigin: [10, 77],
  subtitle: 'VIII. Hamecomin',
  seed: 8814,
  designVersion: 2,
  contourInterval: 20,
  elevation: { min: 0, max: 1345 },

  sculpt(T) {
    const S = T.size, h = T.height;
    H = h; HS = S;
    T.fill(260);
    // the Great Glen lowland along the north, the sea loch side low in the west
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += Math.min(0, (y - 90) * 1.6) + Math.min(0, (x - 100) * 2.4) + Math.max(0, x - 210) * 1.3;
    T.addNoise({ scale: 90, amp: 70, octaves: 3, offset: 1 });
    T.addNoise({ scale: 48, amp: 55, octaves: 3, ridged: true, warp: 20, offset: 2 });
    T.addNoise({ scale: 18, amp: 10, octaves: 3, offset: 3 });
    // the Ben: a huge dome with a summit plateau; Càrn Dearg its north-west shoulder
    T.dome({ x: 170, y: 148, rx: 104, ry: 88, angle: 0.15, height: 640, steep: 0.14, warp: 0.2 });
    T.plateau({ x: 166, y: 144, rx: 46, ry: 32, angle: 0.25, height: 1270, edge: 28, rough: 0.2 });
    T.plateau({ x: 181, y: 153, rx: 13, ry: 9, angle: 0.2, height: 1328, edge: 5, rough: 0.12, keepHigher: false });   // the summit table
    T.dome({ x: 142, y: 124, rx: 14, ry: 11, height: 60, steep: 0.2 });                                                 // Càrn Dearg
    // the Càrn Mòr Dearg arête, curving round Coire Leis to the east, and the Aonachs beyond
    T.ridge({ points: [[192, 154, 300], [210, 158, 520], [226, 150, 640], [236, 132, 700], [240, 110, 760], [244, 90, 520]], width: 11, jagged: 0.7, sharpness: 1.3, meander: 2 });
    T.dome({ x: 306, y: 104, rx: 34, ry: 46, angle: 0.1, height: 700, steep: 0.2, warp: 0.3, jagged: 0.25 });
    T.ridge({ points: [[244, 92, 300], [270, 100, 380], [290, 104, 420]], width: 14, jagged: 0.3, sharpness: 1 });
    // the southern spurs of the Grey Corries close the upper glen on the north
    T.ridge({ points: [[236, 240, 200], [270, 228, 300], [310, 224, 330], [350, 228, 300], [392, 232, 240]], width: 26, jagged: 0.25, sharpness: 0.9, meander: 4 });
    // Meall an t-Suidhe and the halfway shelf
    T.dome({ x: 44, y: 162, rx: 24, ry: 20, height: 330, steep: 0.2, warp: 0.25 });
    // the Mamores along the south: one crest of peaks and cols, spurs running north into the glen, the
    // corries between the spurs biting into the north side (that is where their crags are)
    T.ridge({ points: [[24, 344, 260], [50, 338, 480], [72, 332, 660], [94, 338, 470], [118, 340, 640], [140, 338, 480], [162, 332, 760],
      [186, 338, 520], [212, 342, 700], [232, 338, 520], [252, 334, 640], [276, 340, 540], [300, 338, 720], [322, 336, 560], [342, 332, 790],
      [366, 338, 560], [392, 344, 380]], width: 26, jagged: 0.2, sharpness: 0.8, meander: 2 });
    for (const [pts, w] of [
      [[[72, 332, 380], [74, 314, 260], [78, 298, 120]], 11],        // Mullach nan Coirean's north spur
      [[[162, 332, 420], [160, 314, 300], [158, 300, 150]], 12],     // Sgùrr a' Mhàim's north spur
      [[[252, 334, 380], [258, 318, 300], [262, 306, 160]], 10],     // An Gearanach
      [[[342, 332, 420], [340, 316, 300], [338, 302, 140]], 12],     // Binnein Mòr's north spur
    ]) T.ridge({ points: pts, width: w, jagged: 0.25, sharpness: 0.9 });
    for (const [x, y, r, d] of [[118, 322, 13, 170], [210, 324, 14, 200], [300, 322, 13, 190], [366, 324, 11, 130]]) {
      T.corrie({ x, y, radius: r, depth: d, open: -Math.PI / 2, floorSlope: 2.4 });
    }
    // Càrn Dearg's north-west shoulder and the cliffs under it (the Castle, Càrn Dearg Buttress)
    T.ridge({ points: [[142, 124, 200], [126, 106, 240], [110, 90, 200], [100, 80, 80]], width: 14, jagged: 0.4, sharpness: 1.2 });
    T.corrie({ x: 120, y: 84, radius: 15, depth: 220, open: -Math.PI / 2 - 0.5, floorSlope: 2.6 });
    // the north face: corries biting into the plateau, ridges between them
    T.corrie({ x: 182, y: 116, radius: 22, depth: 240, open: -Math.PI / 2 + 0.1, floorSlope: 2.6 });   // Coire na Ciste
    T.corrie({ x: 218, y: 122, radius: 15, depth: 200, open: -Math.PI / 2 - 0.1, floorSlope: 2.6 });   // Coire Leis
    T.ridge({ points: [[172, 132, 120], [174, 116, 110], [178, 98, 60]], width: 4, jagged: 0.7, sharpness: 1.6 });   // Tower Ridge
    T.ridge({ points: [[198, 136, 100], [202, 118, 80], [204, 102, 40]], width: 4, jagged: 0.7, sharpness: 1.6 });   // North-East Buttress
    // Allt a' Mhuilinn, down from under the face to the north
    T.carveGlen({ points: [[196, 104, 640], [204, 74, 420], [210, 40, 200], [214, 0, 80]], width: 18, profile: 'U', flat: 0.3, wobble: 0.4 });
    // Glen Nevis wraps the south and west: wide below, a gorge, then the Steall meadow
    T.carveGlen({ points: [[-10, 150, 0], [0, 190, 0], [10, 260, 0], [8, 330, 0], [-6, 392, 0]], width: 26, profile: 'U', flat: 0.4, wobble: 0.4 });   // Loch Linnhe's trough
    T.carveGlen({ points: glenFloor, width: 28, profile: 'U', flat: 0.3, wobble: 0.4 });
    T.carveGlen({ points: gorge, width: 16, profile: 'V', wobble: 0.3 });
    T.carveGlen({ points: meadow, width: 26, profile: 'U', flat: 0.45, wobble: 0.4 });
    // Steall: the Allt Coire a' Mhail hangs above the meadow and falls into it
    T.carveGlen({ points: [[292, 352, 860], [284, 334, 760], [278, 318, 640], [274, 308, 360], [272, 302, 214]], width: 10, profile: 'V', wobble: 0.3 });
    T.smooth(1);
    T.plateau({ x: 96, y: 140, rx: 12, ry: 9, angle: 0.4, height: 572, edge: 6, rough: 0.2, keepHigher: false });   // the halfway shelf
    T.fitMax(1345, 940);
    T.peak({ x: 181, y: 153, height: 1345, radius: 9, search: 5 });    // Ben Nevis
    T.peak({ x: 142, y: 124, height: 1221, radius: 8, search: 6 });    // Càrn Dearg
    T.peak({ x: 240, y: 110, height: 1220, radius: 9, search: 8 });    // Càrn Mòr Dearg
    T.peak({ x: 306, y: 100, height: 1234, radius: 12, search: 10 });  // Aonach Beag
    T.peak({ x: 160, y: 334, height: 1099, radius: 10, search: 8 });   // Sgùrr a' Mhàim
    T.peak({ x: 72, y: 332, height: 939, radius: 9, search: 8 });      // Mullach nan Coirean
    T.peak({ x: 118, y: 340, height: 999, radius: 8, search: 6 });     // Stob Bàn
    T.peak({ x: 212, y: 342, height: 1032, radius: 8, search: 6 });    // Am Bodach
    T.peak({ x: 300, y: 338, height: 1056, radius: 9, search: 6 });    // Na Gruagaichean
    T.peak({ x: 342, y: 332, height: 1130, radius: 10, search: 8 });   // Binnein Mòr
    T.peak({ x: 44, y: 162, height: 711, radius: 9, search: 6 });      // Meall an t-Suidhe
    T.loch({ x: 96, y: 140, rx: 5, ry: 3.5, angle: 0.4, level: 570, depth: 3, kind: 'lochan' });
    // Loch Linnhe, the sea loch on the west edge
    T.loch({ points: [[-10, 194], [8, 210], [16, 246], [18, 290], [12, 336], [-4, 392]], width: 14, level: 0, depth: 8, sea: true, shallow: 1, wobble: 0.4 });
    T.clampTo(0, 1345);

    T.path(glenPath);
    T.path(ponyTrack);
    T.path([[94, 146], [104, 122], [110, 100], [124, 92], [150, 96], [176, 94], [200, 94]]);    // round under the north face to the hut
    T.path([[200, 94], [206, 66], [210, 36], [214, 0]]);                             // down the Allt a' Mhuilinn
    T.path([[181, 153], [196, 156], [212, 156], [228, 148], [238, 128], [240, 110]]); // the arête to Càrn Mòr Dearg
    T.path([[166, 288], [164, 312], [160, 334]]);                                    // up Sgùrr a' Mhàim

    T.label(181, 153, 'Beinn Nibheis', 'peak');
    T.label(142, 124, 'Càrn Dearg', 'peak');
    T.label(306, 100, 'Aonach Beag', 'peak');
    T.label(160, 334, "Sgùrr a' Mhàim", 'peak');
    T.label(226, 152, 'An Carn Mòr Dearg Arête', 'feature');
    T.label(218, 122, 'Coire Leis', 'glen');
    T.label(208, 50, "Allt a' Mhuilinn", 'water');
    T.label(110, 278, 'Gleann Nibheis', 'glen');
    T.label(300, 290, 'Steall', 'glen');
    T.label(14, 290, 'Loch Linnhe', 'water');
    T.label(210, 352, 'Na Màmannan', 'glen');
  },

  cover: {
    treeline: 330, woodDensity: 0.38, woodSlope: 0.55, bogFlatness: 0.06, bogMax: 420, bogAmount: 0.5, snowSlope: 2,
    rockline: 900, rockAmount: 0.8, cragSlope: 0.86, cragStrata: 0.25, cragJitter: 0.16, cragGap: 0.15, screeSlope: 0.6, screeBand: 3, screeMinH: 480,
    streamThreshold: 1100, riverThreshold: 3000, fallDrop: 30,
    // Bealltainn: snow lies on in the north-facing gullies and the north face only
    // and on the Mamores the crag keeps to the north-facing corrie walls (elsewhere it breaks to scree)
    adjust(x, y, h, sl, c) {
      if ((c !== 5 && !(c === 4 && y > 296)) || !H) return undefined;
      const up = H[Math.min(HS - 1, y + 1) * HS + x] - H[Math.max(0, y - 1) * HS + x];
      if (c === 4) return up > 45 ? undefined : 3;
      return up > 30 && sl > 0.35 ? undefined : 9;   // north-facing and steep keeps its snow, else bare rock
    },
  },
  season: { night: 0.3, dawn: 0.1, dusk: 0.08, startTime: 0.03, snowline: 1100 },

  look: {
    paper: 'paper',
    light: { az: 225, el: 40, strength: 0.7 },
    signature: ['spate', 'gullySnow', 'thawMist'],
    gullySnow: { above: 1000 },
  },
  zones: [
    { id: 'glen', name: 'Glen Nevis and Steall', x: 270, y: 298, r: 64 },
    { id: 'track', name: 'the old track', x: 88, y: 166, r: 54 },
    { id: 'northface', name: 'the north face', x: 146, y: 100, r: 50 },
    { id: 'plateau', name: 'the plateau', x: 170, y: 148, r: 28 },
    { id: 'arete', name: 'the arête', x: 230, y: 136, r: 24 },
    { id: 'mamores', name: 'the Mamores', x: 180, y: 330, r: 56 },
  ],

  spawn: { x: 378, y: 287 },
  pois: [
    // the rite
    { id: 'eas-steall', type: 'waterfall', name: 'An Steall', x: 272, y: 304, condition: { approach: 'descending' }, hint: 'The thaw\'s in it, Steall fair roarin. Meet it comin doun.' },
    { id: 'polldubh-hut', type: 'bothy', name: 'Bothan Pholl Duibh', x: 172, y: 290, condition: { dwell: 3 }, hint: 'A wee hut ablow the gorge, by the black pool. Stop at its door.' },
    { id: 'carn-dearg-crag', type: 'crag', name: 'Càrn Dearg Buttress', x: 106, y: 78, condition: { speed: 'fast' }, hint: 'The big buttress on the north face. Come at it on the rin.' },
    { id: 'summit-nevis', type: 'summit', name: 'Beinn Nibheis', x: 181, y: 153, condition: { climb: 5, requires: 'trig' }, hint: 'A\'thing ye\'ve gaithered comes hame here. Pillar first, syne speel.' },
    { id: 'trig-suidhe', type: 'trig', name: 'Meall an t-Suidhe', x: 44, y: 162, condition: { climb: 1 }, hint: 'They read the weather here an on the tap at the same hour. A thick contour up.' },
    // the rest of the sheet
    { id: 'cic-hut', type: 'bothy', name: 'CIC Hut', x: 200, y: 96, condition: { dwell: 3 }, hint: 'Climbers\' hut ablow the face. Bide in the door an hear the gullies rin.' },
    { id: 'lochan-suidhe', type: 'lochan', name: 'Lochan Meall an t-Suidhe', x: 96, y: 146, condition: { speed: 'slow' }, hint: 'Hauf road up the auld track. Come tae the watter canny.' },
    { id: 'cairn-cmd', type: 'cairn', name: 'Càrn Mòr Dearg', x: 240, y: 110, condition: { approach: 'descending', dwell: 2 }, hint: 'Pink granite at the end o the arête. Come doun tae its cairn an bide.' },
    { id: 'cairn-aonach', type: 'cairn', name: 'Aonach Beag', x: 306, y: 100, condition: { approach: 'descending' }, hint: 'Snaw lies lang on its north side. Come doun ontae the cairn.' },
    { id: 'stone-cailliche', type: 'stone', name: 'Clach na Cailliche', x: 304, y: 240, condition: { dwell: 5 }, hint: 'She flang her staff ablow a holly here an turned tae stane. Bide wi her.' },
    { id: 'cairn-coirean', type: 'cairn', name: 'Mullach nan Coirean', x: 72, y: 332, condition: { approach: 'descending' }, hint: 'West end o the Mamores. Come doun tae the cairn an see the sea.' },
  ],
  // invented names: Bothan Pholl Duibh, Clach na Cailliche, Bealach an Aiseig (descriptive Gaelic, to check)
  gate: { x: 0, y: 180, chain: ['waterfall', 'bothy', 'crag', 'summit'], name: 'Bealach an Aiseig' },

  fieldNotes: [
    'The observatory men read the sky on the tap ilka hour for twinty year. Their wa\'s are there yet.',
    'May, an snaw still in the gullies. Ilka burn in spate wi it.',
    'Aw winter she kept the spring shut in the hill. At Bealltainn it comes oot.',
    'The buttress wants speed. The tap wants the pillar first. Syne hame.',
  ],
  palette: { tint: '#5a6e8a', accent: 'flame', paper: '#eeeee6' },
};
