/**
 * VI. The Cuillin (NG), Skye — a jagged gabbro horseshoe around Loch Coruisk,
 * which drains a short river south into the sea at Loch Scavaig. Sgùrr Alasdair
 * on the west arm, Sgùrr nan Gillean at the north; bealachs let you through.
 */
const horseshoe = [[96, 224, 540], [85, 204, 650], [82, 182, 710], [85, 160, 730], [88, 140, 690], [94, 118, 650], [108, 98, 640], [122, 80, 590],
  [137, 68, 720], [155, 72, 620], [174, 86, 580], [190, 104, 610], [200, 130, 650], [204, 160, 620], [202, 190, 560], [198, 212, 490]];
const approach = [[150, 4], [148, 28], [146, 48], [152, 62], [164, 76], [172, 92], [166, 110], [152, 128], [143, 148], [142, 168]];

export default {
  id: 'cuillin',
  index: 5,
  name: 'The Cuillin',
  gaelic: 'An Cuilthionn',
  gridLetters: 'NG',
  gridOrigin: [40, 18],
  subtitle: 'VI. The Black Rig',
  seed: 6606,
  contourInterval: 20,
  elevation: { min: 0, max: 992 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(250);
    T.addNoise({ scale: 90, amp: 60, octaves: 3, offset: 1 });
    T.addNoise({ scale: 36, amp: 42, octaves: 3, ridged: true, warp: 16, offset: 2 });
    T.addNoise({ scale: 14, amp: 9, octaves: 3, offset: 3 });
    // coastward lowering: Skye falls away to the sea in the south
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] -= Math.max(0, y - 190) * 2.2;
    // the horseshoe: very jagged gabbro
    T.ridge({ points: horseshoe, width: 14, jagged: 0.95, sharpness: 1.3, height: 640, wobble: 0.35 });
    T.dome({ x: 86, y: 160, radius: 12, height: 110, steep: 0.5, jagged: 0.6 });   // Sgùrr Alasdair
    T.dome({ x: 137, y: 68, radius: 12, height: 90, steep: 0.5, jagged: 0.6 });    // Sgùrr nan Gillean
    T.dome({ x: 238, y: 118, rx: 34, ry: 40, height: 340, steep: 0.2, warp: 0.3 }); // Red Cuillin: Marsco, Glamaig
    T.dome({ x: 24, y: 70, rx: 30, ry: 40, height: 180, steep: 0.2, warp: 0.3 });
    // Glen Brittle on the west, Glen Sligachan on the east
    T.carveGlen({ points: [[0, 90, 50], [34, 140, 70], [48, 190, 40], [64, 238, 4]], width: 22, profile: 'U', wobble: 0.5 });
    T.carveGlen({ points: [[222, 4, 90], [226, 60, 110], [224, 130, 90], [224, 190, 30], [214, 226, 3]], width: 18, profile: 'U', wobble: 0.5 });
    // Coruisk's glaciated basin
    T.carveGlen({ points: [[138, 112, 300], [140, 140, 130], [141, 165, 40], [150, 190, 24], [159, 212, 14], [164, 232, 2]], width: 30, profile: 'U', flat: 0.4, wobble: 0.35 });
    // bealachs: notches cut through the ridge
    T.carveGlen({ points: [[84, 200, 460], [100, 194, 400]], width: 5, profile: 'V', wobble: 0.2 });
    T.carveGlen({ points: [[170, 90, 400], [176, 80, 520]], width: 5, profile: 'V', wobble: 0.2 });
    T.carveGlen({ points: [[200, 140, 440], [214, 142, 300]], width: 5, profile: 'V', wobble: 0.2 });
    T.corrie({ x: 98, y: 184, radius: 11, depth: 120, open: 0.15 });     // Coire a' Ghrunnda
    // fairy-pool burn on the west flank
    T.carveGlen({ points: [[84, 178, 560], [74, 176, 380], [66, 172, 160], [58, 170, 70]], width: 6, profile: 'V', wobble: 0.3 });
    T.smooth(1);
    T.fitMax(992, 600);
    T.peak({ x: 86, y: 160, height: 992, radius: 9, search: 8 });      // Sgùrr Alasdair
    T.peak({ x: 137, y: 68, height: 964, radius: 9, search: 8 });      // Sgùrr nan Gillean
    T.peak({ x: 104, y: 102, height: 958, radius: 9, search: 8 });     // Bruach na Frìthe
    T.peak({ x: 200, y: 130, height: 895, radius: 9, search: 8 });     // Garsbheinn
    T.clampTo(0, 992);
    T.loch({ x: 100, y: 186, rx: 5, ry: 3.5, angle: 0.3, depth: 5, kind: 'lochan' });
    T.loch({ points: [[138, 150], [142, 168], [150, 190], [158, 210]], width: 6, level: 25, depth: 30, wobble: 0.5 });
    T.loch({ points: [[56, 268], [120, 252], [180, 246], [250, 254]], width: 18, level: 0, depth: 6, sea: true, shallow: 1, wobble: 0.45 });

    T.path(approach);
    T.path([[142, 168], [150, 188], [158, 208], [160, 220]]);          // Coruisk shore to the sea
    T.path([[160, 220], [180, 218], [200, 220], [214, 222]]);          // coast path to Camasunary
    T.path([[214, 222], [222, 200], [224, 170], [236, 148], [255, 142]]);
    T.path([[142, 168], [128, 175], [112, 186], [100, 190]]);          // to Coire a' Ghrunnda
    T.path([[100, 190], [92, 174], [88, 164], [86, 160]]);             // up to Alasdair
    T.path([[100, 192], [84, 200], [68, 190], [62, 176], [58, 172]]);  // bealach west to the fairy pools
    T.path([[152, 128], [128, 118], [112, 108], [104, 102]]);          // to the north-west ridge

    T.label(85, 166, 'Sgùrr Alasdair', 'peak');
    T.label(139, 67, 'Sgùrr nan Gillean', 'peak');
    T.label(98, 110, 'Bruach na Frìthe', 'peak');
    T.label(199, 128, 'Garsbheinn', 'peak');
    T.label(238, 118, 'Marsco', 'peak');
    T.label(148, 186, 'Loch Coruisg', 'water');
    T.label(140, 250, 'Loch Sgabhsaig', 'water');
    T.label(100, 178, 'Coire a\' Ghrunnda', 'glen');
    T.label(62, 150, 'Glen Bhreatail', 'glen');
    T.label(222, 100, 'Gleann Sligeachan', 'glen');
    T.label(60, 168, 'Allt Coire na Creiche', 'feature');
  },

  cover: { treeline: 140, woodDensity: 0.12, woodSlope: 0.4, woodMin: 0, bogFlatness: 0.07, bogMax: 160, bogAmount: 0.5, snowline: null, rockline: 420, rockAmount: 0.9, cragSlope: 0.85, cragStrata: 0.2, cragJitter: 0.22, cragGap: 0.2, gullyT: 3.2, screeSlope: 0.55, screeBand: 4, screeMinH: 120, streamThreshold: 1300, riverThreshold: 2600, fallDrop: 36 },

  spawn: { x: 150, y: 6 },
  pois: [
    { id: 'gillean-crag', type: 'crag', name: 'Pinnacle Ridge', x: 146, y: 56, condition: { speed: 'fast' }, hint: 'Gabbro, rouch eneuch tae grip a buit. It dirls for a walker at a rin.' },
    { id: 'trig-bruach', type: 'trig', name: 'Bruach na Frìthe', x: 104, y: 102, condition: { climb: 3 }, hint: 'A trig pillar on the rig. Three contours up, speeled clean.' },
    { id: 'lochan-ghrunnda', type: 'lochan', name: 'Lochan Coire a\' Ghrunnda', x: 100, y: 186, condition: { requires: 'trig', speed: 'slow' }, hint: 'Wauken the pillar first. Syne come canny tae the heich lochan.' },
    { id: 'stone-coruisk', type: 'stone', name: 'Clach Choruisg', x: 162, y: 200, condition: { dwell: 4 }, hint: 'Aside Coruisk the compass needle stravaigs. Staun still a while.' },
    { id: 'summit-alasdair', type: 'summit', name: 'Sgùrr Alasdair', x: 86, y: 160, condition: { climb: 4 }, hint: 'Heichest on Skye. Fower contours o gabbro, unbroken.' },
    { id: 'camasunary', type: 'bothy', name: 'Camasunary', x: 214, y: 220, condition: {}, hint: 'A bothy on the bay at Camasunary, a lang gate fae the road.' },
    { id: 'cairn-sligachan', type: 'cairn', name: 'Càrn Sligeachan', x: 224, y: 168, condition: { approach: 'descending' }, hint: 'Cairn abune the Sligachan flair. Come doun tae it.' },
    { id: 'eas-creiche', type: 'waterfall', name: 'Allt Coire na Creiche', x: 64, y: 172, condition: {}, hint: "Blue pools ablow the rig, fa'in in steps." },
  ],
  gate: { x: 255, y: 142, chain: ['crag', 'trig', 'lochan', 'stone'], name: 'Bealach a\' Garbh-choire' },

  fieldNotes: [
    'The rig is gabbro an basalt. The slaps in it are bealachs.',
    'Wauken the pillar first. The heich lochan answers efter it.',
    'Rin at the rock. Walk canny tae the watter.',
    "The stane's on Coruisk's sooth shore. Compasses drift near it.",
  ],
  palette: { tint: '#4a4f66', accent: 'heather', paper: '#e4dcc6' },
};
