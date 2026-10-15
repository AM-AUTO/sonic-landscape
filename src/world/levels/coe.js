/**
 * VI. Glen Coe (NN) — the wolf-month. A deep U-glen between black walls: the knife-edge Aonach Eagach along the
 * north, the Three Sisters thrust out from Bidean nam Bian on the south with the Lost Valley (Coire Gabhail) hidden
 * between two of them, the Buachaille standing guard at the east end where the glen climbs onto Rannoch, and Loch
 * Leven, a sea loch, at the glen mouth in the west and round behind the north wall.
 *
 * Names marked * are invented descriptive Gaelic, to be checked.
 */
// the glen, east (Rannoch) to west (the sea loch); [x, y, floor m]
const glen = [[392, 152, 330], [352, 154, 305], [318, 155, 270], [284, 152, 170], [252, 150, 96], [222, 148, 62], [196, 148, 56], [166, 149, 50], [134, 148, 34], [104, 144, 16], [74, 136, 6], [40, 130, 0], [-8, 128, -4]];
const road = [[383, 152], [352, 150], [324, 150], [300, 151], [272, 149], [244, 146], [214, 142], [186, 141], [158, 143], [130, 145], [104, 149], [80, 156], [52, 164], [24, 170], [0, 173]];
const lostValley = [[214, 146], [213, 166], [214, 186], [214, 206], [213, 226]];
const toBidean = [[172, 145], [170, 172], [172, 204], [176, 238], [186, 270], [198, 292]];

export default {
  id: 'coe',
  index: 5,
  name: 'Glen Coe',
  gaelic: 'Gleann Comhann',
  gridLetters: 'NN',
  gridOrigin: [8, 62],
  subtitle: 'VI. The Glen o Greetin',
  seed: 3303,
  designVersion: 2,
  contourInterval: 20,
  elevation: { min: 0, max: 1150 },

  // the Faoilleach: storm, short days; start by day so the walls are seen before the dark comes down
  season: { night: 0.62, dawn: 0.08, dusk: 0.08, startTime: 0.12, snowline: 800 },

  look: {
    paper: 'fog',
    light: { az: 180, el: 10, strength: 1.45 },
    signature: ['gabbro', 'hiddenValley', 'storm', 'cloudCap'],
    gabbro: { x: 220, y: 170, r: 150 },                                          // the heaviest rock drawing: both walls
    hidden: { x: 213, y: 216, r: 24, key: 'gabhail', name: 'Coire Gabhail' },     // the Lost Valley
    cloudCap: { above: 0.7, lift: false },
  },

  zones: [
    { id: 'floor', name: 'the glen floor', x: 225, y: 150, r: 72 },
    { id: 'eagach', name: 'the Aonach Eagach', x: 225, y: 92, r: 42 },
    { id: 'lost', name: 'the Lost Valley', x: 213, y: 214, r: 26 },
    { id: 'buachaille', name: 'the Buachaille', x: 318, y: 226, r: 44 },
    { id: 'leven', name: 'Loch Leven', x: 30, y: 138, r: 48 },
    { id: 'fianna', name: 'Sgòr nam Fiannaidh', x: 125, y: 130, r: 46 },
  ],

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(470);
    T.addNoise({ scale: 135, amp: 80, octaves: 3, offset: 1 });
    T.addNoise({ scale: 90, amp: 95, octaves: 3, ridged: true, warp: 30, offset: 2 });
    T.addNoise({ scale: 30, amp: 14, octaves: 3, offset: 3 });
    // the Rannoch shoulder lifts the east end
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += Math.max(0, x - 255) * 0.75;
    // Aonach Eagach: a long knife-edge on the north wall, Sgòr nam Fiannaidh at the west end, Am Bodach at the east
    T.ridge({ points: [[78, 112, 300], [108, 100, 440], [138, 96, 380], [170, 93, 380], [210, 91, 420], [250, 89, 390], [290, 91, 370], [330, 94, 300], [362, 104, 180]], width: 17, jagged: 0.65, sharpness: 1.6, height: 380, meander: 6 });
    // Bidean nam Bian and the Three Sisters thrust north from it
    T.dome({ x: 200, y: 284, rx: 66, ry: 56, angle: 0.2, height: 560, steep: 0.18, warp: 0.25, jagged: 0.5 });
    T.ridge({ points: [[164, 246, 380], [152, 212, 360], [140, 186, 330]], width: 16, jagged: 0.5, sharpness: 1.2, height: 340, meander: 3 });   // Aonach Dubh
    T.ridge({ points: [[194, 244, 400], [193, 212, 360], [195, 184, 320]], width: 11, jagged: 0.55, sharpness: 1.5, height: 320, meander: 3 });   // Gearr Aonach
    T.ridge({ points: [[228, 252, 420], [242, 216, 380], [258, 186, 330]], width: 15, jagged: 0.5, sharpness: 1.2, height: 330, meander: 3 });   // Beinn Fhada
    // Buachaille Etive Mòr: a pyramid at the east end; Buachaille Etive Beag behind it
    T.dome({ x: 322, y: 228, rx: 40, ry: 36, height: 560, steep: 0.05, warp: 0.2, jagged: 0.45 });
    T.dome({ x: 282, y: 266, radius: 22, height: 260, steep: 0.35, jagged: 0.3 });
    // Sgòr na h-Ulaidh in the south-west
    T.dome({ x: 70, y: 300, rx: 40, ry: 32, height: 400, steep: 0.25, warp: 0.3, jagged: 0.4 });
    // Glen Etive, south-west from Rannoch round the back of the Buachaille
    T.carveGlen({ points: [[392, 246, 300], [352, 288, 190], [320, 330, 110], [292, 370, 50], [272, 392, 30]], width: 28, profile: 'U', flat: 0.3, wobble: 0.4 });
    // the Lairig Gartain between the two Buachailles
    T.carveGlen({ points: [[300, 178, 330], [298, 222, 440], [298, 262, 380], [310, 304, 160]], width: 9, profile: 'V', wobble: 0.3 });

    // the sea loch's trough, so Loch Leven lies in a glen of its own and not in a pit
    T.carveGlen({ points: [[-10, 132, -6], [20, 129, -6], [50, 124, -6], [80, 108, -6], [112, 86, -6], [150, 66, -6], [196, 52, -6], [244, 42, -6], [296, 36, -6], [330, 34, -4], [360, 36, 60]], width: 46, profile: 'U', flat: 0.22, wobble: 0.4 });
    // Glen Coe itself: deep, wide-floored, walled
    T.carveGlen({ points: glen, width: 40, profile: 'U', flat: 0.24, wobble: 0.3 });
    // Coire nan Lochan between Aonach Dubh and Gearr Aonach
    T.carveGlen({ points: [[170, 182, 160], [172, 210, 400], [172, 240, 640], [176, 262, 800]], width: 10, profile: 'V', wobble: 0.4 });
    // Coire Gabhail, the Lost Valley: a gorge, then a flat hanging floor behind the boulder barrier
    T.carveGlen({ points: [[213, 150, 90], [214, 170, 230], [214, 188, 400]], width: 7, profile: 'V', wobble: 0.3 });
    T.carveGlen({ points: [[214, 192, 420], [214, 214, 440], [212, 240, 560]], width: 14, profile: 'U', flat: 0.5, wobble: 0.3 });
    T.smooth(1);

    T.fitMax(1150, 820);
    T.peak({ x: 200, y: 292, height: 1150, radius: 14, search: 12 });   // Bidean nam Bian
    T.peak({ x: 178, y: 270, height: 1115, radius: 10, search: 8 });    // Stob Coire nan Lochan
    T.peak({ x: 322, y: 228, height: 1022, radius: 12, search: 10 });   // Stob Dearg
    T.peak({ x: 70, y: 300, height: 994, radius: 12, search: 10 });     // Sgòr na h-Ulaidh
    T.peak({ x: 108, y: 100, height: 967, radius: 10, search: 8 });      // Sgòr nam Fiannaidh
    T.peak({ x: 250, y: 89, height: 953, radius: 10, search: 8 });      // Meall Dearg
    T.peak({ x: 318, y: 94, height: 943, radius: 10, search: 8 });      // Am Bodach
    T.clampTo(0, 1150);

    // Loch Leven: the sea loch at the glen mouth, running east behind the Aonach Eagach
    T.loch({ points: [[-10, 132], [20, 129], [50, 124], [80, 108], [112, 86], [150, 66], [196, 52], [244, 42], [296, 36], [330, 34]], width: 11, level: 0, depth: 6, sea: true, shallow: 1, wobble: 0.5 });
    // Loch Achtriochtan on the floor, Lochan na Fola near the head of the glen
    T.loch({ points: [[184, 148], [198, 147.5], [212, 147]], width: 5, depth: 6, wobble: 0.5 });
    T.loch({ x: 354, y: 168, rx: 5, ry: 3.5, angle: 0.4, depth: 3, kind: 'lochan' });
    // Rannoch lochans at the east edge
    T.lochans({ count: 5, area: { x0: 346, y0: 176, x1: 380, y1: 236 }, rmin: 1.5, rmax: 3, avoid: [{ x: 354, y: 168, r: 9 }] });

    T.path(road);
    T.path(lostValley);
    T.path(toBidean);
    T.path([[306, 150], [306, 166], [310, 190], [316, 212]]);                  // Lagangarbh and the Buachaille
    T.path([[356, 151], [360, 128], [352, 110], [342, 92], [338, 70]]);        // the Devil's Staircase, over to Kinlochleven
    T.path([[100, 148], [102, 126], [106, 106]]);                              // up onto Sgòr nam Fiannaidh
    T.path([[383, 244], [352, 288], [322, 328], [302, 360]]);                  // down Glen Etive

    T.label(200, 292, 'Bidean nam Bian', 'peak');
    T.label(322, 228, 'Stob Dearg', 'peak');
    T.label(108, 100, 'Sgòr nam Fiannaidh', 'peak');
    T.label(230, 82, 'Aonach Eagach', 'peak');
    T.label(150, 210, 'Aonach Dubh', 'peak');
    T.label(192, 206, 'Gearr Aonach', 'peak');
    T.label(244, 210, 'Beinn Fhada', 'peak');
    T.label(70, 300, 'Sgòr na h-Ulaidh', 'peak');
    T.label(198, 140, 'Loch Achadh nan Truachan', 'water');
    T.label(60, 116, 'Loch Lìobhann', 'water');
    T.label(354, 160, 'Lochan na Fola', 'water');
    T.label(110, 160, 'Gleann Comhann', 'glen');
    T.label(213, 216, 'Coire Gabhail', 'glen');
    T.label(330, 300, 'Gleann Eite', 'glen');
    T.label(372, 200, 'Mòinteach Raineach', 'feature');
  },

  cover: {
    treeline: 220, woodDensity: 0.08, woodSlope: 0.45, bogFlatness: 0.07, bogMax: 420, bogAmount: 0.5, snowline: null,
    rockline: 720, rockAmount: 0.75, cragSlope: 0.8, cragMinH: 40, cragStrata: 0.22, cragJitter: 0.16, cragGap: 0.12,
    screeSlope: 0.55, screeBand: 5, screeMinH: 260, streamThreshold: 1800, riverThreshold: 5000, fallDrop: 30,
  },

  spawn: { x: 382, y: 152 },
  pois: [
    // the rite: the crag at a run, the stone by dwelling, the trig by climbing
    { id: 'buachaille-crag', type: 'crag', name: 'Buachaille Crags', x: 298, y: 214, condition: { speed: 'fast' }, hint: 'Black craigs on the herd\'s west face. They dirl for a walker comin at a rin.' },
    { id: 'tom-a-ghrianain', type: 'stone', name: 'Tom a\' Ghrianain', x: 112, y: 140, condition: { dwell: 5 }, hint: 'The signal stane. Bide by it langer than feels richt.' },
    { id: 'trig-bidean', type: 'trig', name: 'Bidean nam Bian', x: 200, y: 292, condition: { climb: 3 }, hint: 'Heichest in Argyll. Three thick contours up, nae step doun.' },
    // the rest of the glen
    { id: 'lagangarbh', type: 'bothy', name: 'Lagangarbh', x: 306, y: 160, condition: {}, hint: 'A white hoose ablow the Buachaille. Reek in the win.' },
    { id: 'coileitir', type: 'bothy', name: 'Coileitir', x: 306, y: 344, condition: {}, hint: 'Doun Glen Etive, a door oot the storm.' },
    { id: 'loch-achtriochtan', type: 'lochan', name: 'Loch Achadh nan Truachan', x: 198, y: 140, condition: { speed: 'slow' }, hint: 'Black ablow the north wa. Gang canny.' },
    { id: 'lochan-fola', type: 'lochan', name: 'Lochan na Fola', x: 354, y: 164, condition: {}, hint: 'Its name means bluid. The watter\'s clear.' },
    { id: 'summit-stob-dearg', type: 'summit', name: 'Stob Dearg', x: 322, y: 228, condition: { climb: 3 }, hint: 'Reid peak o the Buachaille. Three contours, speeled clean.' },
    { id: 'eas-gabhail', type: 'waterfall', name: 'Eas Choire Ghabhail', x: 214, y: 186, condition: { approach: 'descending' }, hint: 'The Lost Valley hid stown kye. Its watter drops aff the lip; come doun tae it.' },
    { id: 'uamh-oisein', type: 'crag', name: 'Uamh Oisein', x: 146, y: 176, condition: { approach: 'ascending' }, hint: 'Ossian\'s cave, a black slot in the Sister\'s face. Speel up tae it.' },
    { id: 'sgor-fiannaidh', type: 'summit', name: 'Sgòr nam Fiannaidh', x: 106, y: 100, condition: { climb: 2 }, hint: 'The Fianna\'s peak. Twa thick contours, nae step doun.' },
    { id: 'meall-dearg', type: 'cairn', name: 'Meall Dearg', x: 250, y: 92, condition: { approach: 'descending' }, hint: 'Mid-rig on the Eagach. Come doun ontae the cairn.' },
    { id: 'am-bodach', type: 'cairn', name: 'Am Bodach', x: 318, y: 96, condition: { approach: 'descending' }, hint: 'The auld man at the east end o the rig. Come doun ontae him.' },
    { id: 'sgor-ulaidh', type: 'summit', name: 'Sgòr na h-Ulaidh', x: 70, y: 300, condition: { climb: 2 }, hint: 'The peak o the treasure, oot on its ain. Twa contours up.' },
  ],
  gate: { x: 0, y: 173, chain: ['crag', 'stone', 'trig'], name: 'Bealach a\' Chaolais' },   // * invented name: the pass by the narrows (Caolas mhic Phàdraig)

  fieldNotes: [
    'The Faoilleach. The wolf-month storms are hers. The craig dirls for a rinner an naebody else.',
    'At the signal stane, bide till the thunner\'s oot the glen.',
    'Coont thick contours gaun up. Step doun an the coont sterts ower.',
    'The Fianna hunted here. Somewhere atween the Sisters a glen is no on the map.',
  ],
  palette: { tint: '#5a5a7a', accent: 'magenta', paper: '#e9e0c4' },
};
