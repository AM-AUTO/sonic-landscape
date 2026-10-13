/**
 * VIII. Ben Nevis & Glen Nevis (NN) — Britain's highest ground: a vast
 * dome-plateau with the great north-face crags, the Càrn Mòr Dearg arête
 * curving east, and Glen Nevis wrapping the south and west to the Steall gorge.
 */
const glenPath = [[255, 186], [238, 190], [220, 194], [200, 194], [178, 196], [150, 198], [120, 196], [90, 192], [62, 182], [44, 160], [28, 128], [12, 106], [0, 98]];
const ponyTrack = [[70, 186], [78, 172], [90, 160], [98, 152], [108, 140], [114, 126], [118, 114], [121, 108]];

export default {
  id: 'nevis',
  index: 7,
  name: 'Ben Nevis',
  gaelic: 'Beinn Nibheis',
  gridLetters: 'NN',
  gridOrigin: [10, 66],
  subtitle: 'VIII. Hamecomin',
  seed: 8808,
  contourInterval: 20,
  elevation: { min: 20, max: 1345 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(540);
    T.addNoise({ scale: 90, amp: 70, octaves: 3, offset: 1 });
    T.addNoise({ scale: 48, amp: 60, octaves: 3, ridged: true, warp: 20, offset: 2 });
    T.addNoise({ scale: 18, amp: 12, octaves: 3, offset: 3 });
    // the Ben: a huge flat-topped dome on a broad massif
    T.dome({ x: 126, y: 108, rx: 84, ry: 70, angle: 0.2, height: 330, steep: 0.1, warp: 0.25 });
    T.plateau({ x: 120, y: 106, rx: 54, ry: 46, angle: 0.2, height: 1290, edge: 44, rough: 0.22 });
    T.plateau({ x: 124, y: 109, rx: 17, ry: 12, angle: 0.3, height: 1332, edge: 4, rough: 0.12, keepHigher: false });   // the summit table
    T.dome({ x: 121, y: 106, radius: 6, height: 11, steep: 0.2, warp: 0.2 });
    // the long arête to Càrn Mòr Dearg and the Aonachs
    T.ridge({ points: [[158, 92, 520], [166, 89, 600], [176, 88, 640], [194, 96, 560], [210, 108, 440]], width: 11, jagged: 0.7, sharpness: 1.2, height: 560 });
    T.dome({ x: 176, y: 88, radius: 14, height: 70, steep: 0.3 });
    T.dome({ x: 232, y: 70, rx: 28, ry: 30, height: 640, steep: 0.2, warp: 0.3 });
    // Mamores to the south
    T.dome({ x: 150, y: 238, rx: 38, ry: 30, height: 620, steep: 0.2, warp: 0.3, jagged: 0.3 });
    T.dome({ x: 88, y: 244, rx: 32, ry: 28, height: 480, steep: 0.2, warp: 0.3 });
    T.dome({ x: 214, y: 242, rx: 32, ry: 28, height: 600, steep: 0.2, warp: 0.3, jagged: 0.3 });
    // the great north face: Coire Leis, Tower Ridge, Gardyloo
    T.corrie({ x: 134, y: 76, radius: 26, depth: 330, open: -Math.PI / 2 + 0.15 });
    T.ridge({ points: [[128, 78, 150], [132, 64, 120], [136, 52, 60]], width: 5, jagged: 0.7, sharpness: 1.6, height: 110 });
    T.ridge({ points: [[146, 74, 120], [152, 62, 90]], width: 4, jagged: 0.7, sharpness: 1.6, height: 90 });
    // lowlands north (Spean) and Glen Nevis
    T.carveGlen({ points: [[0, 14, 220], [100, 10, 170], [255, 18, 240]], width: 56, profile: 'U', wobble: 0.5 });
    T.carveGlen({ points: [[0, 92, 22], [14, 112, 24], [30, 140, 28], [48, 168, 34], [72, 186, 44], [100, 193, 56], [130, 196, 76], [160, 197, 104], [186, 195, 150]], width: 38, profile: 'U', flat: 0.3, wobble: 0.45 });
    T.carveGlen({ points: [[180, 195, 150], [206, 193, 200], [232, 190, 260], [255, 186, 330]], width: 34, profile: 'U', flat: 0.4, wobble: 0.4 });
    // Steall: a hanging burn dropping into the glen head
    T.carveGlen({ points: [[224, 255, 760], [222, 238, 720], [220, 222, 650], [218, 212, 600], [217, 203, 230], [217, 196, 205]], width: 10, profile: 'V', wobble: 0.3 });
    // the shelf with Lochan Meall an t-Suidhe
    T.plateau({ x: 98, y: 151, rx: 11, ry: 8, angle: 0.5, height: 690, edge: 6, rough: 0.2, keepHigher: false });
    T.smooth(1);
    T.fitMax(1345, 900);
    T.peak({ x: 121, y: 106, height: 1345, radius: 8, search: 5 });    // Ben Nevis summit
    T.peak({ x: 176, y: 88, height: 1220, radius: 10, search: 8 });    // Càrn Mòr Dearg
    T.peak({ x: 232, y: 70, height: 1234, radius: 12, search: 10 });   // Aonach Beag
    T.peak({ x: 150, y: 238, height: 1099, radius: 10, search: 8 });   // Sgùrr a' Mhàim
    T.clampTo(20, 1345);
    T.loch({ x: 98, y: 151, rx: 4.5, ry: 3.2, angle: 0.5, level: 688, depth: 3, kind: 'lochan' });

    T.path(glenPath);
    T.path(ponyTrack);
    T.path([[90, 160], [86, 144], [86, 128], [90, 118]]);                  // to the Càrn Dearg buttress
    T.path([[121, 108], [140, 100], [158, 92], [176, 88]]);                  // the arête to Càrn Mòr Dearg
    T.path([[176, 88], [186, 72], [184, 54], [176, 30], [170, 0]]);         // down to the CIC hut and north
    T.path([[214, 194], [217, 202]]);                                        // to Steall
    T.path([[121, 108], [126, 116]]);

    T.label(121, 106, 'Beinn Nibheis', 'peak');
    T.label(176, 88, 'Càrn Mòr Dearg', 'peak');
    T.label(84, 100, 'Càrn Dearg', 'peak');
    T.label(232, 70, 'Aonach Beag', 'peak');
    T.label(150, 238, 'Sgùrr a\' Mhàim', 'peak');
    T.label(134, 56, 'Coire Leis', 'glen');
    T.label(112, 202, 'Gleann Nibheis', 'glen');
    T.label(98, 151, 'Lochan Meall an t-Suidhe', 'water');
    T.label(224, 204, 'Eas an Steall', 'feature');
    T.label(60, 176, 'Abhainn Nibheis', 'water');
  },

  cover: { treeline: 340, woodDensity: 0.5, woodSlope: 0.5, bogFlatness: 0.06, bogMax: 360, bogAmount: 0.4, snowline: 1190, snowSlope: 1.0, rockline: 880, rockAmount: 0.85, cragSlope: 0.82, cragStrata: 0.25, cragJitter: 0.16, cragGap: 0.2, screeSlope: 0.6, screeBand: 3, screeMinH: 450, streamThreshold: 1500, riverThreshold: 3000, fallDrop: 40 },

  spawn: { x: 250, y: 188 },
  pois: [
    { id: 'eas-steall', type: 'waterfall', name: 'Eas an Steall', x: 217, y: 202, condition: { approach: 'descending' }, hint: 'Steall drops a hunner an twenty metre. Meet it comin doun.' },
    { id: 'steall-hut', type: 'bothy', name: 'Steall Hut', x: 150, y: 197, condition: { dwell: 3 }, hint: 'Ower the wire brig, a hut. Stop at its door for the kettle.' },
    { id: 'carn-dearg-crag', type: 'crag', name: 'Càrn Dearg Buttress', x: 90, y: 118, condition: { speed: 'fast' }, hint: 'Reid buttress on the north face. Come at a rin an it answers.' },
    { id: 'summit-nevis', type: 'summit', name: 'Beinn Nibheis', x: 121, y: 106, condition: { climb: 5, requires: 'trig' }, hint: 'Heichest grund in Britain. Wauken the pillar, syne speel five contours.' },
    { id: 'trig-observatory', type: 'trig', name: 'Observatory Ruin', x: 128, y: 114, condition: { climb: 2 }, hint: 'Weather was scrievit here ilka hour, 1883 tae 1904. Twa contours up.' },
    { id: 'lochan-suidhe', type: 'lochan', name: 'Lochan Meall an t-Suidhe', x: 98, y: 151, condition: { speed: 'slow' }, hint: 'Hauf road up the pony track. Come tae the watter canny.' },
    { id: 'cairn-cmd', type: 'cairn', name: 'Càrn Mòr Dearg', x: 176, y: 88, condition: { approach: 'descending', dwell: 2 }, hint: 'Pink granite arête, a cairn at its end. Come doun tae it an bide.' },
    { id: 'stone-coire-leis', type: 'stone', name: 'Clach na Coire Leis', x: 184, y: 52, condition: { dwell: 4 }, hint: 'A stane in Coire Leis ablow the north face. Bide by it a while.' },
  ],
  gate: { x: 0, y: 98, chain: ['waterfall', 'bothy', 'crag', 'summit'], name: 'Lairig Leacach' },

  fieldNotes: [
    'At the glen heid the watter comes doun. Come doun wi it.',
    'Cross the wire brig. The hut waukens for a walker that bides.',
    'The buttress wants speed. The tap wants the pillar first.',
    "A'thing ye've heard is on this hill. Walk it hame.",
  ],
  palette: { tint: '#5a6e8a', paper: '#eeeee6' },
};
