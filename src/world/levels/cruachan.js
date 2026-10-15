/**
 * II. Ben Cruachan & Loch Awe (NN) — massif and loch. The Cruachan horseshoe holds a high corrie with a
 * dammed reservoir; Loch Awe runs from its head under the hill (Kilchurn on its island) diagonally away
 * south-west, its arm pushing west into the Pass of Brander, the gorge that carries the River Awe out to
 * Loch Etive, the sea loch on the west edge. Glen Strae is open moor to the north-east.
 *
 * The legend: she kept a well on the summit, capped it every sundown and opened it every sunrise. One night
 * she slept, the water burst down through the Pass and made the loch. The rite: the summit at dusk, rest
 * the night, the falls in the Pass at dawn.
 */
// Loch Awe as one body: from the Pass mouth east along the arm to the head (round Kilchurn's island), back
// to the junction, south-west down the main loch to the edge and back up its west side (round Inishail).
// Loch Awe as one body: long and fairly straight from its head (north-east, Kilchurn) south-west to the
// edge, with the short arm leaving near the north end for the Pass of Brander. One polyline: Pass mouth ->
// junction -> up to the head and back down the same line -> south-west down the main loch.
const lochHead = [[294, 188], [300, 176], [305, 164]];
const lochAwe = [
  [178, 190], [204, 193], [232, 196], [260, 198], [288, 200],
  ...lochHead, ...lochHead.slice(0, -1).reverse(),
  [288, 200], [281, 222], [272, 246], [262, 272], [250, 298], [238, 324], [226, 350], [214, 376], [204, 398],
];
const lochIslands = [
  { x: 301, y: 172, r: 3.2, height: 6 },   // Kilchurn's island, at the head
  { x: 262, y: 274, r: 4.5, height: 8 },   // Inishail, mid-loch
  { x: 279, y: 230, r: 2.2, height: 5 },   // Fraoch Eilean
];
// the River Awe through the Pass of Brander: floor falls from the loch to the sea
const passRiver = [[180, 189, 30], [160, 186, 26], [138, 183, 20], [114, 181, 13], [90, 180, 8], [66, 179, 4], [46, 178, 1]];
// road and railway share the north shore and the Pass
const shoreRoad = [[383, 150], [366, 152], [350, 156], [336, 150], [318, 144], [300, 144], [286, 156], [270, 170], [252, 176], [238, 178], [214, 180], [194, 178],
  [174, 176], [152, 175], [130, 173], [108, 172], [88, 172], [66, 172], [52, 182], [44, 204], [34, 232], [24, 262], [16, 292], [8, 324], [2, 352], [0, 372]];
const railway = [[383, 144], [364, 146], [348, 150], [332, 144], [314, 139], [296, 140], [282, 152], [266, 166], [250, 171], [232, 173], [208, 175], [186, 173],
  [166, 170], [146, 169], [124, 168], [102, 167], [82, 167], [62, 168], [46, 178], [34, 194], [16, 206], [0, 212]];

export default {
  id: 'cruachan',
  index: 1,
  name: 'Ben Cruachan',
  gaelic: 'Cruachan Beann',
  gridLetters: 'NN',
  gridOrigin: [0, 34],
  subtitle: 'II. The Well',
  seed: 2207,
  designVersion: 2,
  contourInterval: 20,
  elevation: { min: 0, max: 1126 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(150);
    // the north (Glen Strae, Glen Noe) stands higher; the loch country falls away south-east
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += (190 - y) * 0.4 + (190 - x) * 0.12;
    T.addNoise({ scale: 96, amp: 70, octaves: 3, offset: 1 });
    T.addNoise({ scale: 52, amp: 55, octaves: 3, ridged: true, warp: 20, offset: 2 });
    T.addNoise({ scale: 18, amp: 10, octaves: 3, offset: 3 });
    // the massif: a broad base reaching down to the Pass, then the horseshoe on it
    T.dome({ x: 186, y: 104, rx: 118, ry: 76, angle: -0.05, height: 430, steep: 0.15, warp: 0.22 });
    T.ridge({ points: [[96, 112, 200], [118, 100, 380], [138, 92, 500], [154, 89, 520], [170, 86, 580], [188, 82, 500], [206, 80, 470], [228, 78, 470], [242, 92, 440], [248, 112, 400], [254, 134, 340], [262, 158, 160]], width: 20, sharpness: 1.1, jagged: 0.35, meander: 3 });
    // Meall Cuanail: the west arm, south from the summit down to the Pass
    T.ridge({ points: [[170, 90, 380], [168, 108, 340], [167, 126, 300], [165, 148, 200], [163, 170, 70]], width: 15, sharpness: 1.1, jagged: 0.3 });
    // Beinn Eunaich and Beinn a' Chochuill across Glen Noe to the north-east
    T.dome({ x: 292, y: 44, rx: 34, ry: 24, angle: 0.3, height: 450, steep: 0.2, warp: 0.2 });
    T.dome({ x: 244, y: 24, rx: 30, ry: 16, angle: -0.2, height: 280, steep: 0.15, warp: 0.3 });
    // Creag an Aonaidh and the south wall of the Pass
    T.ridge({ points: [[40, 214, 160], [70, 206, 300], [100, 204, 340], [130, 206, 320], [160, 210, 240], [180, 214, 120]], width: 14, sharpness: 1.3, jagged: 0.3 });
    // the hills south of the Pass (Loch Nant country) and between the loch's arms
    T.dome({ x: 104, y: 270, rx: 86, ry: 62, height: 300, steep: 0.12, warp: 0.35, jagged: 0.2 });
    T.dome({ x: 200, y: 268, rx: 42, ry: 40, angle: 0.8, height: 230, steep: 0.12, warp: 0.3 });
    T.dome({ x: 336, y: 292, rx: 46, ry: 56, angle: 0.4, height: 210, steep: 0.1, warp: 0.3 });
    // Coire Cruachan: the corrie the horseshoe holds, open to the south
    T.corrie({ x: 206, y: 114, radius: 30, depth: 170, open: Math.PI / 2, floorSlope: 2.2 });
    // Glen Strae: a wide moor glen from the north-east edge down to the loch head
    T.carveGlen({ points: [[318, -6, 300], [326, 40, 240], [334, 90, 170], [330, 130, 90], [312, 166, 40]], width: 42, profile: 'U', flat: 0.45, wobble: 0.5 });
    // Glen Noe: under the north side of the hill, out to Loch Etive
    T.carveGlen({ points: [[240, 46, 380], [200, 42, 280], [160, 44, 170], [120, 52, 80], [80, 66, 10], [44, 76, 0]], width: 20, profile: 'U', flat: 0.3, wobble: 0.4 });
    // the Loch Awe trough: the arm, and the main loch
    T.carveGlen({ points: [[178, 190, 20], [232, 196, 20], [288, 200, 20], [300, 176, 20], [306, 162, 24]], width: 22, profile: 'U', flat: 0.4, wobble: 0.4 });
    T.carveGlen({ points: [[296, 186, 20], [281, 222, 18], [266, 262, 16], [248, 300, 14], [228, 344, 12], [204, 398, 12]], width: 32, profile: 'U', flat: 0.4, wobble: 0.4 });
    // the Pass of Brander: a gorge, steep on the Cruachan side
    T.carveGlen({ points: passRiver, width: 13, profile: 'V', wobble: 0.25 });
    // Loch Etive's trench along the north-west
    T.carveGlen({ points: [[-6, 60, 0], [16, 96, 0], [32, 130, 0], [40, 160, 0], [42, 180, 0]], width: 30, profile: 'U', flat: 0.4, wobble: 0.4 });
    T.smooth(1);
    T.fitMax(1126, 780);
    T.peak({ x: 170, y: 86, height: 1126, radius: 11, search: 8 });   // Ben Cruachan
    T.peak({ x: 138, y: 92, height: 1104, radius: 9, search: 6 });    // Stob Dearg (the Taynuilt Peak)
    T.peak({ x: 228, y: 78, height: 998, radius: 9, search: 6 });     // Stob Diamh
    T.peak({ x: 167, y: 124, height: 918, radius: 8, search: 6 });    // Meall Cuanail
    T.peak({ x: 292, y: 44, height: 989, radius: 10, search: 8 });    // Beinn Eunaich
    // the reservoir behind its dam, high in the corrie: level the corrie floor first
    T.plateau({ x: 206, y: 110, rx: 25, ry: 21, angle: -0.15, height: 412, edge: 9, rough: 0.12, keepHigher: false });
    T.loch({ x: 206, y: 118, rx: 15, ry: 10, angle: -0.15, level: 402, depth: 22, shore: 6 });
    // Loch Awe, Loch Etive (the sea) and Loch Nant
    T.loch({ points: lochAwe, width: 10, level: 36, depth: 30, wobble: 0.4, shore: 4, islands: lochIslands });
    T.loch({ points: [[-8, 56], [8, 90], [24, 124], [32, 150], [38, 170], [36, 182]], width: 15, level: 0, depth: 8, sea: true, shallow: 1, wobble: 0.45 });
    T.loch({ x: 96, y: 296, rx: 11, ry: 6, angle: 0.5, depth: 6, wobble: 0.4 });
    T.lochans({ count: 7, area: { x0: 300, y0: 40, x1: 370, y1: 150 }, rmin: 2, rmax: 4, depth: 1.5, prefer: 'flat' });
    T.clampTo(0, 1126);

    T.path(shoreRoad);
    T.path([[383, 262], [372, 246], [366, 226], [364, 200], [362, 176], [352, 156]]);              // the east shore road, round the loch head
    T.path([[214, 180], [212, 160], [208, 146], [206, 136]]);                           // the dam road
    T.path([[206, 136], [194, 130], [188, 114], [180, 100], [172, 89]]);                            // up the corrie to the top
    T.path([[170, 86], [154, 89], [138, 92]]);                                          // along to Stob Dearg
    T.path([[350, 156], [340, 140], [334, 120], [328, 80], [322, 40], [318, 0]]);       // Glen Strae track
    T.path([[56, 174], [52, 150], [56, 124], [66, 96], [96, 70], [136, 54]]);           // Loch Etive shore, into Glen Noe
    T.path([[130, 173], [124, 200], [116, 230], [100, 270], [96, 288]]);                            // over to Loch Nant

    T.label(228, 78, 'Stob Diamh', 'peak');
    T.label(167, 124, 'Meall Cuanail', 'peak');
    T.label(250, 312, 'Loch Obha', 'water');
    T.label(22, 120, 'Loch Eite', 'water');
    T.label(110, 172, 'Pass of Brander', 'glen');
    T.label(346, 96, 'Gleann Sreith', 'glen');
    T.label(150, 40, 'Gleann Nodha', 'glen');
  },

  cover: { treeline: 260, woodDensity: 0.32, woodSlope: 0.55, bogFlatness: 0.05, bogMax: 360, bogAmount: 0.45, rockline: 760, rockAmount: 0.6, cragSlope: 0.95, cragStrata: 0.25, cragJitter: 0.16, screeSlope: 0.62, screeMinH: 450, streamThreshold: 1500, riverThreshold: 3600, fallDrop: 36 },
  season: { night: 0.6, dawn: 0.07, dusk: 0.08, startTime: 0.09, snowline: 850 },

  look: {
    paper: 'paper2',
    light: { az: 180, el: 12, strength: 1.1 },
    signature: ['dam', 'castle', 'railway', 'cloudCap'],
    dam: { x0: 194, y0: 132, x1: 221, y1: 131 },
    castle: { x: 301, y: 172, name: 'Kilchurn Castle' },
    railway: { points: railway, halts: [{ x: 276, y: 160, name: 'Lochawe' }, { x: 140, y: 168, name: 'Falls of Cruachan' }] },
    cloudCap: { above: 0.64, lift: true },
  },
  zones: [
    { id: 'shore', name: 'the loch shore', x: 318, y: 216, r: 64 },
    { id: 'pass', name: 'the Pass', x: 118, y: 186, r: 56 },
    { id: 'corrie', name: 'the reservoir corrie', x: 206, y: 128, r: 34 },
    { id: 'horseshoe', name: 'the horseshoe', x: 180, y: 86, r: 46 },
    { id: 'strae', name: 'Glen Strae', x: 330, y: 80, r: 56 },
  ],

  spawn: { x: 364, y: 252 },
  pois: [
    // the rite
    { id: 'summit-cruachan', type: 'summit', name: 'Cruachan Beann', x: 170, y: 86, condition: { time: 'dusk' }, hint: 'She capped her well up here at sundoun. Be on the tap as the licht gangs.' },
    { id: 'eas-cruachan', type: 'waterfall', name: "Eas a' Bhrannraidh", x: 138, y: 185, condition: { time: 'dawn' }, hint: 'The nicht she sleepit, the watter cam doun here. Be at it first licht.' },
    // the rest of the sheet
    { id: 'bothy-glennoe', type: 'bothy', name: 'Gleann Nodha', x: 60, y: 90, condition: { dwell: 3 }, hint: 'A roof on the sea loch, at the fit o Glen Noe. Bide at the door.' },
    { id: 'bothy-strae', type: 'bothy', name: 'Àirigh Shreith', x: 336, y: 140, condition: { dwell: 3 }, hint: 'Shieling hoose in Glen Strae. Somebody aye leaves the kindlin.' },
    { id: 'lochan-reservoir', type: 'lochan', name: 'Cruachan Reservoir', x: 192, y: 112, condition: { speed: 'slow' }, hint: 'Watter held ahint a wa. Come tae it canny, it\'s listenin.' },
    { id: 'cairn-stob-dearg', type: 'cairn', name: 'Stob Dearg', x: 138, y: 92, condition: { approach: 'descending' }, hint: 'The Taynuilt peak. Come doun ontae its cairn aff the ridge.' },
    { id: 'trig-eunaich', type: 'trig', name: 'Beinn Eunaich', x: 292, y: 44, condition: { climb: 2 }, hint: 'Hill o the birds, ower Glen Strae. Twa thick contours up, nae step doun.' },
    { id: 'crag-aonaidh', type: 'crag', name: 'Creag an Aonaidh', x: 84, y: 194, condition: { speed: 'fast' }, hint: 'Craigs ower the Pass. Rin by them an they ring.' },
    { id: 'lochan-nant', type: 'lochan', name: 'Loch Nant', x: 96, y: 290, condition: {}, hint: 'A wee loch in the hills, oot the road o the win.' },
    { id: 'stone-inishail', type: 'stone', name: 'Clach Innis Sèil', x: 290, y: 268, condition: { dwell: 4 }, hint: 'Folk say there were hooses whaur the loch is noo. Staun a while an hear them.' },
    { id: 'cairn-cailliche', type: 'cairn', name: 'Cnoc na Cailliche', x: 200, y: 268, condition: { approach: 'descending' }, hint: 'Her knowe atween the loch\'s twa airms. Come doun tae it.' },
  ],
  // invented names: Eas a' Bhrannraidh, Àirigh Shreith, Clach Innis Sèil, Cnoc na Cailliche, Bealach Mhucairn (descriptive Gaelic, to check)
  gate: { x: 0, y: 372, chain: ['summit', 'waterfall'], name: 'Bealach Mhucairn' },

  fieldNotes: [
    'She laid a slab on the well at sundoun an lifted it at sunrise. Ae nicht she sleepit.',
    'The watter took the glen an the toons in it. That is Loch Awe.',
    'Bothy book: cam ower the tap at the gloamin. Lay till the licht. Naethin tae dae but wait.',
    'Rest when the dark comes in. The nicht\'s lang this time o year.',
  ],
  palette: { tint: '#5a6a7a', accent: 'rust', paper: '#e8e2cc' },
};
