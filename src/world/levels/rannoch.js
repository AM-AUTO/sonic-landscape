/**
 * IV. Rannoch Moor & Beinn a' Bhric (NN) — midwinter. Basin moor: a vast flat bowl of peat and granite,
 * a mosaic of frozen lochans, Loch Laidon lying long across the south-east, the whole ringed by distant
 * hills. Beinn a' Bhric, the Cailleach's deer hill, rises in the north-west above the south end of Loch
 * Treig; the West Highland line crosses the moor to the lonely halt at Corrour, and the track from there
 * runs north-east past Loch Ossian to the Bealach Dubh and the road to the Cairngorms.
 *
 * Native 384 sheet (designVersion 2, docs/LEVELS.md §IV). Route as a track:
 *   intro    spawn on the old road by the foot of Loch Laidon; open, low, quiet moor
 *   build    the lochan, slowly (dusk); the erratics field at night; the railway
 *   climax   up onto Beinn a' Bhric and down onto its shoulder cairn from above
 *   release  down to Corrour and away north-east past Loch Ossian to the gate
 * Names marked * are invented descriptive Gaelic, to be checked.
 */
// the old road north across the moor to the halt (spawn sits on it, south of the lochan)
const oldRoad = [[190, 383], [186, 350], [174, 302], [164, 258], [160, 224], [166, 190], [186, 160], [214, 128], [236, 100], [240, 76]];
// Corrour and the track north-east along Loch Ossian to the Bealach Dubh (the gate)
const ossianTrack = [[240, 76], [264, 64], [292, 50], [318, 34], [336, 16], [346, 0]];
// the drove road west to Ba Bothy
const droveRoad = [[174, 302], [134, 294], [94, 290], [56, 286]];
// the stalkers' path from the halt up the shoulder to the top of Beinn a' Bhric
const stalkers = [[240, 76], [206, 78], [170, 84], [140, 86], [118, 80], [98, 68], [82, 60]];
// the West Highland line: in from Bridge of Orchy (south), across the moor, the halt, then up by Loch Treig
const railway = [[96, 383], [110, 336], [148, 288], [194, 252], [238, 208], [262, 162], [260, 116], [246, 84], [232, 66], [206, 40], [184, 18], [176, 0]];

export default {
  id: 'rannoch',
  index: 3,
  name: 'Rannoch Moor',
  gaelic: 'Mòinteach Raineach',
  gridLetters: 'NN',
  gridOrigin: [26, 70],
  subtitle: 'IV. The Muir',
  seed: 1101,
  designVersion: 2,
  contourInterval: 10,
  elevation: { min: 288, max: 680 },

  season: { night: 0.66, dawn: 0.08, dusk: 0.08, startTime: 0.72, snowline: 450 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(322);
    T.addNoise({ scale: 130, amp: 12, octaves: 3, offset: 1 });
    T.addNoise({ scale: 42, amp: 6, octaves: 3, offset: 2 });
    T.addNoise({ scale: 14, amp: 3, octaves: 2, ridged: true, offset: 3 });   // hummocky moraine
    // the basin drains gently south-east into Loch Laidon
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += (x - 192) * -0.05 + (y - 192) * -0.045;

    // the ring of distant hills
    T.dome({ x: 80, y: 58, rx: 56, ry: 44, angle: 0.45, height: 330, steep: 0.22, warp: 0.3, jagged: 0.18 });   // Beinn a' Bhric
    T.ridge({ points: [[82, 60, 120], [104, 70, 110], [126, 82, 70], [146, 88, 25]], width: 15, sharpness: 0.6, jagged: 0.15 });  // its east shoulder
    T.dome({ x: 166, y: 50, radius: 12, height: 170, steep: 1.2, warp: 0.25, jagged: 0.4 });    // Creag Ghuanach
    T.dome({ x: 262, y: 18, rx: 40, ry: 26, angle: 0.2, height: 270, steep: 0.25, warp: 0.3 });  // Beinn na Lap
    T.dome({ x: 384, y: 92, rx: 62, ry: 54, height: 300, steep: 0.2, warp: 0.3, jagged: 0.15 }); // Càrn Dearg / Sgòr Gaibhre
    T.dome({ x: -18, y: 226, rx: 70, ry: 96, height: 290, steep: 0.2, warp: 0.35, jagged: 0.2 }); // the Black Mount
    T.dome({ x: -10, y: 120, rx: 40, ry: 40, height: 170, steep: 0.2, warp: 0.3 });
    T.dome({ x: 140, y: 398, rx: 62, ry: 40, height: 230, steep: 0.25, warp: 0.3 });            // Màm Carraigh
    T.dome({ x: 320, y: 394, rx: 96, ry: 52, height: 270, steep: 0.35, warp: 0.3, jagged: 0.15 }); // the hills south of Laidon
    T.dome({ x: 402, y: 196, rx: 56, ry: 92, height: 220, steep: 0.25, warp: 0.3, jagged: 0.15 }); // distant hills east

    // low knolls dotted over the moor
    for (let k = 0; k < 46; k++) {
      const x = T.rng.range(50, 350), y = T.rng.range(60, 350);
      T.dome({ x, y, radius: T.rng.range(5, 15), height: T.rng.range(6, 24), steep: 0.1, warp: 0.4 });
    }
    // the erratics: granite knuckles through the peat
    for (let k = 0; k < 9; k++) {
      const a = T.rng.range(0, Math.PI * 2), r = T.rng.range(6, 36);
      T.dome({ x: 294 + Math.cos(a) * r, y: 172 + Math.sin(a) * r * 0.8, radius: T.rng.range(3, 6), height: T.rng.range(5, 12), steep: 0.6, warp: 0.3 });
    }
    T.dome({ x: 150, y: 370, radius: 12, height: 26, steep: 0.3, warp: 0.25 });   // the knowe on the old road

    // Loch Treig's south end and Loch Ossian lie in glens
    T.carveGlen({ points: [[150, -6, 300], [158, 12, 306], [168, 28, 318]], width: 16, profile: 'U', flat: 0.4, wobble: 0.3 });
    T.carveGlen({ points: [[246, 92, 318], [270, 76, 316], [298, 60, 316], [326, 42, 320], [352, 14, 336], [360, -4, 344]], width: 18, profile: 'U', flat: 0.45, wobble: 0.35 });

    T.smooth(1);
    T.fitMax(680, 540);
    T.peak({ x: 80, y: 58, height: 680, radius: 14, search: 10 });     // Beinn a' Bhric
    T.peak({ x: 262, y: 18, height: 612, radius: 12, search: 10 });    // Beinn na Lap
    T.clampTo(296, 680);

    // Loch Laidon: long, south-west to north-east across the south-east of the moor
    T.loch({ points: [[214, 348], [244, 334], [278, 316], [316, 296], [352, 278], [392, 262]], width: 6.5, level: 301, depth: 10, shallow: 2, wobble: 0.6 });
    T.loch({ points: [[150, -8], [158, 10], [166, 24]], width: 5, level: 304, depth: 9, wobble: 0.4 });       // Loch Treig
    T.loch({ points: [[264, 86], [290, 70], [320, 52]], width: 4.2, level: 314, depth: 6, wobble: 0.45 });    // Loch Ossian
    T.loch({ x: 90, y: 248, rx: 13, ry: 7, angle: 0.5, depth: 5, wobble: 0.5 });                             // Loch Bà
    // named lochans
    T.loch({ x: 146, y: 216, rx: 8, ry: 5, angle: 0.3, depth: 3, kind: 'lochan' });   // Lochan Gaineamhach
    T.loch({ x: 54, y: 196, rx: 6, ry: 4, angle: 1.1, depth: 3, kind: 'lochan' });     // Lochan na Stainge
    // the countless lochans
    const keep = [
      ...T.avoidAlong(oldRoad, 4), ...T.avoidAlong(ossianTrack, 4), ...T.avoidAlong(droveRoad, 3), ...T.avoidAlong(stalkers, 4),
      ...T.avoidAlong(railway, 3),
      { x: 292, y: 172, r: 10 }, { x: 150, y: 368, r: 14 }, { x: 52, y: 284, r: 8 }, { x: 302, y: 44, r: 8 },
      { x: 80, y: 58, r: 46 }, { x: 166, y: 50, r: 16 }, { x: 262, y: 18, r: 30 },
    ];
    T.lochans({ count: 340, area: { x0: 30, y0: 40, x1: 372, y1: 368 }, rmin: 1.8, rmax: 9.5, avoid: keep, depth: 1.8, tries: 7, aspect: 2.4, spacing: 1.5 });

    T.path(oldRoad);
    T.path(ossianTrack);
    T.path(droveRoad);
    T.path(stalkers);

    T.label(80, 58, 'Beinn a\' Bhric', 'peak');
    T.label(262, 18, 'Beinn na Lap', 'peak');
    T.label(356, 92, 'Càrn Dearg', 'peak');
    T.label(20, 226, 'Clach Leathad', 'peak');
    T.label(150, 372, 'Màm Carraigh', 'peak');
    T.label(300, 304, 'Loch Laidon', 'water');
    T.label(160, 12, 'Loch Treig', 'water');
    T.label(292, 76, 'Loch Oisein', 'water');
    T.label(90, 256, 'Loch Bà', 'water');
    T.label(200, 214, 'Mòinteach Raineach', 'glen');
    T.label(300, 150, 'Na Clachan Mòra', 'feature');   // * the erratics
    T.label(128, 96, 'Gualainn na Cailliche', 'feature');   // * the hag's shoulder
    T.label(352, 22, 'Bealach Dubh', 'glen');
  },

  cover: { treeline: 380, woodDensity: 0.05, woodMin: 300, bogFlatness: 0.05, bogMax: 400, bogAmount: 0.3, snowline: 450, rockline: 540, rockAmount: 0.4, cragSlope: 0.62, cragJitter: 0.14, cragStrata: 0.2, screeMinH: 420, streamThreshold: 1900, riverThreshold: 5200, fallDrop: 16 },

  zones: [
    { id: 'laidon', name: 'Loch Laidon', x: 252, y: 330, r: 74 },
    { id: 'moor', name: 'the open moor', x: 168, y: 232, r: 66 },
    { id: 'erratics', name: 'the erratics', x: 294, y: 172, r: 42 },
    { id: 'railway', name: 'the railway', x: 232, y: 112, r: 44 },
    { id: 'bhric', name: 'Beinn a\' Bhric', x: 96, y: 70, r: 56 },
    { id: 'ba', name: 'Ba Bothy', x: 58, y: 278, r: 44 },
  ],

  spawn: { x: 188, y: 366 },
  pois: [
    // the rite: a lochan slowly, the erratic at night, her cairn from above
    { id: 'lochan-gaineamhach', type: 'lochan', name: 'Lochan Gaineamhach', x: 154, y: 218, condition: { speed: 'slow' }, hint: 'Ice on the peat-black watter. Come canny or it cracks.' },
    { id: 'clach-cailliche', type: 'stone', name: 'Clach na Cailliche', x: 292, y: 172, condition: { time: 'night', dwell: 3 }, hint: 'A granite stane fell oot her creel. It minds o her efter dark, gin ye bide.' },
    { id: 'carn-gualainn', type: 'cairn', name: 'Càrn na Gualainn', x: 124, y: 82, condition: { approach: 'descending' }, hint: 'Her cairn on the shouther. It waukens for them that come doun fae the tap.' },
    // the rest of the moor
    { id: 'trig-bhric', type: 'trig', name: 'Beinn a\' Bhric', x: 80, y: 58, condition: { climb: 2 }, hint: 'The hinds\' hill. Twa thick contours up tae the pillar.' },
    { id: 'bothy-ba', type: 'bothy', name: 'Ba Bothy', x: 54, y: 284, condition: {}, hint: 'Peat reek by the auld drove road, whaur it crosses the Bà.' },
    { id: 'bothy-ossian', type: 'bothy', name: 'Loch Ossian Boathouse', x: 304, y: 44, condition: {}, hint: 'A boathouse at the loch heid. Shelter afore the bealach.' },
    { id: 'crag-ghuanach', type: 'crag', name: 'Creag Ghuanach', x: 166, y: 42, condition: { speed: 'fast' }, hint: 'Craig abune Loch Treig. It dirls unner a rinnin fit.' },
    { id: 'lochan-stainge', type: 'lochan', name: 'Lochan na Stainge', x: 58, y: 198, condition: { speed: 'slow' }, hint: 'Lochan ablow the Black Mount. Step slaw.' },
    { id: 'trig-carraigh', type: 'trig', name: 'Màm Carraigh', x: 150, y: 368, condition: { climb: 1 }, hint: 'A pillar on the knowe abune the auld road. Ae thick contour.' },
    { id: 'eas-dubh', type: 'waterfall', name: 'Eas Dubh', x: 330, y: 330, condition: { approach: 'descending' }, hint: 'A burn faws aff the hill intae Laidon. Come doun wi it.' },   // * the black fall
    { id: 'summit-lap', type: 'summit', name: 'Beinn na Lap', x: 262, y: 18, condition: { climb: 2 }, hint: 'The hill o the bog, abune Loch Ossian. Speel wi nae step back.' },
  ],
  gate: { x: 346, y: 0, chain: ['lochan', 'stone', 'cairn'], name: 'Bealach Dubh' },

  fieldNotes: [
    'The auld wife o Beinn a\' Bhric milks her hinds on the hill. Ye see them on the skyline at the gloamin.',
    'Come tae the watter canny. The lochans hear a hasty fit.',
    'The ice set thae stanes doun on the muir. They mind o it in the mirk.',
    'A cairn waukens for the walker comin doun aff the hill.',
  ],
  palette: { tint: '#7f8f9a', accent: 'ember', paper: '#e8eef0' },

  look: {
    paper: 'frost',
    light: { az: 180, el: 7, strength: 1.1 },
    signature: ['railway', 'iceLochans', 'boulders', 'squalls', 'deer', 'frostGlint'],
    railway: { points: railway, halts: [{ x: 242, y: 80, name: 'Corrour' }] },
    boulders: { x: 294, y: 172, r: 44 },
  },
};
