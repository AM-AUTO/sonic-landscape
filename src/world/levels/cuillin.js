/**
 * VII. The Cuillin (NG), Skye — Imbolc. Two geologies side by side: the black gabbro horseshoe, jagged and
 * crag-bound, ringing Loch Coruisk, which drains a few hundred metres south into the sea at Loch Scavaig; and
 * east of Glen Sligachan the Red Hills, rounded granite cones under pink scree, with Beinn na Caillich and her
 * great cairn. Glen Sligachan runs north to south between them, from the inn to the shore at Camasunary.
 * Native 384 sheet (docs/LEVELS.md).
 *
 * Names marked * are invented descriptive Gaelic, to be checked.
 */
// the black horseshoe: the west arm from Gars-bheinn over Alasdair to Sgùrr nan Gillean, the lower east arm
// (Druim nan Ràmh) back down to a col at Druim Hain and Sgùrr na Strì above the sea
const westArm = [[80, 334, 420], [62, 300, 560], [56, 252, 700], [62, 214, 680], [74, 182, 660], [90, 156, 650], [114, 130, 640], [138, 114, 610], [160, 104, 680]];
const eastArm = [[160, 104, 600], [184, 128, 520], [202, 166, 470], [212, 208, 400], [214, 240, 230], [208, 268, 130], [198, 300, 300], [192, 326, 120]];
const glen = [[192, -4, 10], [206, 40, 24], [226, 92, 48], [240, 140, 72], [248, 190, 86], [252, 240, 66], [258, 290, 34], [266, 338, 2]];
const glenPath = [[192, 4], [204, 40], [222, 90], [236, 138], [244, 188], [248, 238], [254, 288], [264, 332]];

export default {
  id: 'cuillin',
  index: 6,
  name: 'The Cuillin',
  gaelic: 'An Cuilthionn',
  gridLetters: 'NG',
  gridOrigin: [40, 31],
  subtitle: 'VII. The Black Rig',
  seed: 6616,
  designVersion: 2,
  contourInterval: 20,
  elevation: { min: 0, max: 992 },
  season: { night: 0.5, dawn: 0.09, dusk: 0.09, startTime: 0.1, snowline: 750 },

  sculpt(T) {
    const S = T.size, h = T.height, ss = T.util.smoothstep;
    const lin = (a, b, v) => ss((v - a) / (b - a));
    T.fill(210);
    T.addNoise({ scale: 90, amp: 50, octaves: 3, offset: 1 });
    T.addNoise({ scale: 34, amp: 26, octaves: 3, ridged: true, warp: 14, offset: 2 });
    T.addNoise({ scale: 12, amp: 6, octaves: 3, offset: 3 });
    // Skye falls to the sea in the south, and to Glen Brittle in the west
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      h[y * S + x] -= 200 * lin(262, 345, y) + 120 * lin(70, 10, x) * lin(100, 230, y) + 60 * lin(60, 0, y);
    }

    // ---- the black ridge: very jagged gabbro, its tops as teeth
    T.ridge({ points: westArm, width: 17, jagged: 1.0, sharpness: 1.4, height: 640, wobble: 0.35 });
    T.ridge({ points: eastArm, width: 14, jagged: 0.9, sharpness: 1.3, height: 500, wobble: 0.35 });
    T.dome({ x: 56, y: 250, radius: 13, height: 130, steep: 0.5, jagged: 0.7 });      // Sgùrr Alasdair
    T.dome({ x: 160, y: 104, radius: 12, height: 110, steep: 0.5, jagged: 0.7 });     // Sgùrr nan Gillean
    T.dome({ x: 114, y: 130, radius: 11, height: 80, steep: 0.4, jagged: 0.4 });      // Bruach na Frìthe
    T.dome({ x: 198, y: 300, radius: 12, height: 90, steep: 0.3, jagged: 0.5 });      // Sgùrr na Strì
    // corries biting out of the ridge on both sides
    T.corrie({ x: 52, y: 220, radius: 12, depth: 140, open: Math.PI });              // Coire Lagan, west
    T.corrie({ x: 74, y: 160, radius: 13, depth: 140, open: Math.PI + 0.4 });        // Coire na Creiche, west

    // ---- the Red Hills: rounded granite cones east of the glen, scree to the tops
    const red = [[270, 44, 330, 26], [296, 94, 300, 24], [282, 156, 320, 26], [338, 124, 320, 28], [350, 60, 220, 26], [330, 190, 200, 24]];
    for (const [x, y, ht, r] of red) T.dome({ x, y, radius: r, height: ht, steep: 0.02, warp: 0.12 });
    T.dome({ x: 300, y: 120, rx: 70, ry: 90, angle: 0.2, height: 120, steep: 0.1, warp: 0.25 });   // their shared footing
    // Blà Bheinn: a black outlier beyond the glen's south end
    T.ridge({ points: [[290, 222, 420], [304, 250, 520], [312, 282, 380]], width: 14, jagged: 0.55, sharpness: 1.3, height: 480 });

    // ---- glens: Sligachan between the two hills, Brittle to the west, Coruisk's ice-scoured basin
    T.carveGlen({ points: glen, width: 26, profile: 'U', flat: 0.3, wobble: 0.4 });
    T.carveGlen({ points: [[14, 90, 60], [22, 150, 50], [26, 210, 34], [30, 280, 12], [26, 340, 2]], width: 22, profile: 'U', wobble: 0.5 });
    T.carveGlen({ points: [[126, 172, 170], [128, 196, 90], [134, 226, 40], [138, 244, 30], [152, 278, 24], [164, 306, 14], [166, 326, 2]], width: 30, profile: 'U', flat: 0.4, wobble: 0.6 });
    // Druim Hain: the low col on the east arm, the walkers' way into Coruisk
    T.carveGlen({ points: [[244, 238, 110], [228, 250, 230], [212, 258, 250], [196, 266, 150], [176, 276, 60]], width: 9, profile: 'U', wobble: 0.3, raise: false });
    // break up the ice-scoured floor inside the horseshoe: knolls and slabs
    T.addNoise({ scale: 18, amp: 16, octaves: 3, ridged: true, warp: 8, offset: 5, mask: (x, y) => Math.max(0, 1 - Math.hypot((x - 140) / 46, (y - 236) / 76)) });
    T.smooth(1);
    T.fitMax(992, 640);
    T.peak({ x: 56, y: 250, height: 992, radius: 10, search: 8 });     // Sgùrr Alasdair
    T.peak({ x: 160, y: 104, height: 964, radius: 10, search: 8 });    // Sgùrr nan Gillean
    T.peak({ x: 114, y: 130, height: 958, radius: 9, search: 8 });     // Bruach na Frìthe
    T.peak({ x: 304, y: 250, height: 928, radius: 11, search: 8 });    // Blà Bheinn
    T.peak({ x: 270, y: 44, height: 775, radius: 12, search: 8 });     // Glamaig
    T.peak({ x: 282, y: 156, height: 736, radius: 12, search: 8 });    // Marsco
    T.peak({ x: 338, y: 124, height: 732, radius: 12, search: 8 });    // Beinn na Caillich
    T.peak({ x: 198, y: 300, height: 494, radius: 9, search: 8 });     // Sgùrr na Strì
    // small summit tables so the tops can be stood on
    for (const [x, y, ht] of [[270, 44, 772], [56, 250, 984], [114, 130, 950], [160, 104, 956], [304, 250, 920], [338, 124, 726]]) T.plateau({ x, y, rx: 5, ry: 5, height: ht, edge: 2.2, rough: 0.1, keepHigher: false });
    // the shoulder of Beinn na Caillich where her cairn stands, below the top
    T.plateau({ x: 326, y: 130, rx: 6, ry: 4.5, angle: 0.4, height: 650, edge: 3, rough: 0.15, keepHigher: false });
    // Coire a' Ghrunnda: a high shelf of slabs holding its lochan
    T.plateau({ x: 82, y: 284, rx: 9, ry: 7, angle: 0.5, height: 640, edge: 5, rough: 0.2, keepHigher: false });

    // ---- water: the sea in the south with Loch Scavaig and Camasunary bay, Loch Brittle, Coruisk, the high lochans
    const sea = (o) => T.loch({ level: 0, depth: 4, sea: true, shallow: 0, ...o });
    sea({ points: [[-60, 418], [60, 412], [150, 410], [226, 414], [262, 432], [280, 470]], width: 66, wobble: 0.08 });
    sea({ x: 162, y: 330, rx: 22, ry: 13, angle: -0.25, wobble: 0.3 });            // Loch Scavaig
    sea({ x: 268, y: 350, rx: 15, ry: 9, angle: 0.1, wobble: 0.3 });               // Camas Fhionnairigh
    sea({ x: 14, y: 338, rx: 20, ry: 13, angle: -1.2, wobble: 0.3 });              // Loch Brittle
    T.loch({ points: [[118, 214], [130, 240], [146, 270], [158, 296]], width: 6, level: 26, depth: 20, wobble: 0.45 });   // Loch Coruisg
    T.loch({ x: 82, y: 284, rx: 4.5, ry: 3.2, angle: 0.5, level: 639, depth: 4, kind: 'lochan' });                                  // Loch Coire a' Ghrunnda
    T.loch({ x: 254, y: 268, rx: 6, ry: 3.4, angle: 1.2, depth: 3, kind: 'lochan' });                                    // Loch an Athain
    T.loch({ x: 232, y: 226, rx: 3.6, ry: 2.4, angle: 0.4, depth: 2, kind: 'lochan' });                                  // Lochan Dubha
    T.clampTo(0, 992);

    T.path(glenPath);
    T.path([[192, 4], [168, 30], [140, 54], [110, 82], [74, 112], [44, 150], [30, 200], [30, 250]]);     // round the north end to Glen Brittle
    T.path([[192, 4], [228, 18], [262, 22], [300, 40], [322, 70], [330, 100]]);                         // east under Glamaig towards Beinn na Caillich
    T.path([[246, 226], [228, 248], [212, 258], [194, 268], [174, 282], [160, 300]]);                   // over Druim Hain to Coruisk
    T.path([[160, 300], [166, 318], [178, 330], [202, 338], [226, 342], [252, 340], [264, 334]]);       // the shore path, the Bad Step on it
    T.path([[264, 334], [284, 344], [298, 362], [304, 383]]);                                           // out over Am Màm
    T.path([[110, 82], [112, 100], [113, 116], [114, 128]]);                                            // up Fionn Choire to Bruach na Frìthe
    T.path([[30, 250], [40, 248], [48, 250], [55, 250]]);                                               // the Stone Shoot to Alasdair
    T.path([[270, 330], [288, 304], [298, 276], [303, 254]]);                                           // Blà Bheinn's south ridge

    T.label(56, 250, 'Sgùrr Alasdair', 'peak');
    T.label(160, 104, 'Sgùrr nan Gillean', 'peak');
    T.label(114, 130, 'Bruach na Frìthe', 'peak');
    T.label(304, 250, 'Blà Bheinn', 'peak');
    T.label(270, 44, 'Glamaig', 'peak');
    T.label(282, 156, 'Marsco', 'peak');
    T.label(338, 124, 'Beinn na Caillich', 'peak');
    T.label(198, 300, 'Sgùrr na Strì', 'peak');
    T.label(138, 254, 'Loch Coruisg', 'water');
    T.label(150, 350, 'Loch Sgàbhaig', 'water');
    T.label(242, 160, 'Gleann Sligeachan', 'glen');
    T.label(24, 184, 'Gleann Breatail', 'glen');
    T.label(204, 182, 'Druim nan Ràmh', 'feature');
    T.label(92, 290, "Coire a' Ghrunnda", 'glen');
  },

  cover: {
    treeline: 120, woodDensity: 0.1, woodSlope: 0.4, woodMin: 0, bogFlatness: 0.06, bogMax: 140, bogAmount: 0.45,
    snowSlope: 1.3, rockline: 420, rockAmount: 0.9, cragSlope: 0.84, cragStrata: 0.2, cragJitter: 0.2, cragGap: 0.18, gullyT: 3.2,
    screeSlope: 0.5, screeBand: 4, screeMinH: 160, streamThreshold: 1300, riverThreshold: 3200, fallDrop: 34,
    // the granite of the Red Hills weathers to scree, not crag
    adjust(x, y, h, slope, c) {
      if (c === 4 && x > 250 && y < 210 && Math.hypot(x - 300, y - 110) < 92) return 3;
      return undefined;
    },
  },

  spawn: { x: 192, y: 4 },
  pois: [
    // the rite: crag at speed, the cairn from above, Coruisk slowly while the cairn still sounds, the stone
    { id: 'crag-pinnacle', type: 'crag', name: 'Pinnacle Ridge', x: 158, y: 90, condition: { speed: 'fast' }, hint: 'Gabbro, rouch eneuch tae grip a buit. It dirls for a walker at a rin.' },
    { id: 'cairn-caillich', type: 'cairn', name: 'Beinn na Caillich', x: 326, y: 130, condition: { approach: 'descending' }, hint: "The auld wife's cairn, a muckle heap. Come doun tae it aff the tap." },
    { id: 'loch-coruisg', type: 'lochan', name: 'Loch Coruisg', x: 162, y: 292, condition: { speed: 'slow', requires: 'cairn' }, hint: "Black watter in the rig. Come canny, while her cairn's still soundin." },
    { id: 'clach-choruisg', type: 'stone', name: 'Clach Choruisg', x: 132, y: 198, condition: { dwell: 4 }, hint: 'The compass birls by this stane. Staun still an let it settle.' },   // * name
    { id: 'trig-bruach', type: 'trig', name: 'Bruach na Frìthe', x: 114, y: 130, condition: { climb: 3 }, hint: 'A trig pillar on the rig. Three contours up, speeled clean.' },
    { id: 'summit-alasdair', type: 'summit', name: 'Sgùrr Alasdair', x: 56, y: 250, condition: { climb: 4 }, hint: 'Heichest on Skye. Fower contours o gabbro, unbroken.' },
    { id: 'summit-glamaig', type: 'summit', name: 'Glamaig', x: 270, y: 44, condition: { climb: 3 }, hint: 'A Gurkha ran up it barefit an back in under the hour. Speel it clean.' },
    { id: 'summit-bla-bheinn', type: 'summit', name: 'Blà Bheinn', x: 304, y: 250, condition: { climb: 3 }, hint: 'Black rock ower the reid. Three contours tae the tap.' },
    { id: 'eas-allt-dearg', type: 'waterfall', name: 'Allt Dearg Mòr', x: 96, y: 92, condition: {}, hint: 'Pools an fa\'s on the burn doun fae Fionn Choire.' },
    { id: 'eas-mor', type: 'waterfall', name: 'Eas Mòr', x: 34, y: 230, condition: { approach: 'descending' }, hint: 'The big fa in Glen Brittle. Come doun tae it.' },
    { id: 'loch-ghrunnda', type: 'lochan', name: "Loch Coire a' Ghrunnda", x: 82, y: 290, condition: { speed: 'slow' }, hint: 'A heich lochan in a bowl o slabs. Gang canny.' },
    { id: 'coruisk-hut', type: 'bothy', name: 'Coruisk Hut', x: 170, y: 322, condition: {}, hint: 'A hut at Scavaig, a step fae the sea.' },
    { id: 'crag-stri', type: 'crag', name: 'Sgùrr na Strì', x: 200, y: 310, condition: {}, hint: 'The hill o strife. Its craigs look doun on Coruisk an the sea.' },
    { id: 'camasunary', type: 'bothy', name: 'Camasunary', x: 268, y: 334, condition: {}, hint: 'A bothy on the bay at Camasunary, a lang gate fae the road.' },
  ],
  gate: { x: 304, y: 383, chain: ['crag', 'cairn', 'lochan', 'stone'], name: 'Am Màm' },   // the col on the Kilmarie track (check)

  zones: [
    { id: 'blackridge', name: 'the black ridge', x: 88, y: 170, r: 66 },
    { id: 'coruisk', name: 'Coruisk', x: 146, y: 272, r: 42 },
    { id: 'redhills', name: 'the Red Hills', x: 306, y: 106, r: 66 },
    { id: 'sligachan', name: 'Glen Sligachan', x: 236, y: 150, r: 46 },
    { id: 'shore', name: 'the shore', x: 262, y: 340, r: 44 },
  ],

  look: {
    paper: 'paper2',
    light: { az: 225, el: 20, strength: 1.25 },
    signature: ['gabbro', 'redScree', 'soundings', 'clearing'],
    gabbro: { x: 128, y: 214, r: 128 },
    redScree: { x: 304, y: 108, r: 96 },
    clearing: { to: 'S' },
  },

  fieldNotes: [
    "On Brìghde's day the auld wife gangs oot for firewid. A bricht day, an winter's lang yet.",
    'Rin at the gabbro. Come doun tae her cairn. Syne walk canny tae Coruisk afore it fades.',
    "The compass winna settle on the black rock. Trust yer feet.",
    'Black rig tae the wast, reid hills tae the east, an the glen atween.',
  ],
  palette: { tint: '#4a4f66', accent: 'heather', paper: '#e4dcc6' },
};
