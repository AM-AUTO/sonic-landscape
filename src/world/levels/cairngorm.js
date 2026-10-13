/**
 * IV. Cairngorm Plateau (NH/NJ) — Britain's high arctic tableland: a vast
 * plateau at the snowline, scooped on the north by Coire an t-Sneachda and
 * Coire an Lochain, the Lairig Ghru trenching down the west, Loch Avon
 * and the Shelter Stone in the glacial trough to the south-east.
 */
const approach = [[166, 4], [168, 20], [174, 38], [178, 56], [172, 70]];
const crossing = [[172, 70], [150, 94], [128, 116], [108, 138], [90, 148], [68, 150], [60, 152]];
const ghru = [[60, 152], [58, 180], [55, 214], [52, 255]];

export default {
  id: 'cairngorm',
  index: 3,
  name: 'Cairngorm Plateau',
  gaelic: 'Am Monadh Ruadh',
  gridLetters: 'NJ',
  gridOrigin: [96, 98],
  subtitle: 'IV. The Heich Grund',
  seed: 4404,
  contourInterval: 20,
  elevation: { min: 600, max: 1309 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(935);
    T.addNoise({ scale: 100, amp: 60, octaves: 3, offset: 1 });
    T.addNoise({ scale: 46, amp: 55, octaves: 3, ridged: true, warp: 20, offset: 2 });
    T.addNoise({ scale: 18, amp: 12, octaves: 3, offset: 3 });
    // the plateau itself
    T.plateau({ x: 135, y: 116, rx: 84, ry: 64, angle: 0.15, height: 1135, edge: 34, rough: 0.32 });
    const onPlateau = (x, y, hh) => (hh > 1060 ? 1 : 0);
    T.addNoise({ scale: 42, amp: 26, octaves: 3, mask: onPlateau, offset: 5 });
    T.addNoise({ scale: 14, amp: 8, octaves: 2, mask: onPlateau, offset: 6 });
    // tops
    T.dome({ x: 172, y: 72, radius: 24, height: 130, steep: 0.2, warp: 0.3 });   // Cairn Gorm
    T.dome({ x: 106, y: 142, radius: 28, height: 185, steep: 0.2, warp: 0.3 });  // Ben Macdui
    T.dome({ x: 126, y: 66, radius: 20, height: 95, steep: 0.2, warp: 0.3 });    // Cairn Lochan
    T.dome({ x: 192, y: 138, radius: 20, height: 70, steep: 0.5, warp: 0.4 });   // Beinn Mheadhoin tors
    T.dome({ x: 20, y: 88, rx: 34, ry: 44, height: 330, steep: 0.2, warp: 0.3 });   // Braeriach
    T.dome({ x: 84, y: 208, radius: 28, height: 150, steep: 0.2, warp: 0.3 });   // Càrn a' Mhaim side
    // the Lairig Ghru: a deep N-S trench
    T.carveGlen({ points: [[78, 0, 645], [72, 40, 690], [64, 90, 770], [60, 140, 835], [57, 180, 760], [53, 220, 690], [50, 255, 635]], width: 24, profile: 'U', flat: 0.22, wobble: 0.35 });
    // Loch Avon trough
    T.carveGlen({ points: [[232, 146, 650], [214, 162, 640], [196, 176, 634], [176, 187, 636], [160, 195, 700]], width: 17, profile: 'U', flat: 0.3, wobble: 0.35 });
    // Garbh Allt tumbling into Loch Avon
    T.carveGlen({ points: [[170, 140, 1040], [172, 156, 960], [174, 168, 800], [176, 180, 640]], width: 8, profile: 'V', wobble: 0.4 });
    // Glen More: the broad trough the northern corries open into
    T.carveGlen({ points: [[0, 22, 730], [90, 28, 700], [170, 24, 670], [255, 20, 655]], width: 30, profile: 'U', flat: 0.35, wobble: 0.4 });
    // the northern corries
    T.corrie({ x: 152, y: 58, radius: 14, depth: 270, open: -Math.PI / 2 });   // Coire an t-Sneachda
    T.corrie({ x: 120, y: 56, radius: 13, depth: 280, open: -Math.PI / 2 });   // Coire an Lochain
    T.smooth(1);
    T.fitMax(1309, 1150);
    T.peak({ x: 106, y: 142, height: 1309, radius: 13, search: 8 });   // Ben Macdui
    T.peak({ x: 172, y: 72, height: 1245, radius: 12, search: 8 });    // Cairn Gorm
    T.peak({ x: 126, y: 66, height: 1215, radius: 10, search: 8 });    // Cairn Lochan
    T.peak({ x: 20, y: 88, height: 1296, radius: 14, search: 10 });    // Braeriach
    T.peak({ x: 192, y: 138, height: 1182, radius: 9, search: 8 });    // Beinn Mheadhoin
    T.loch({ x: 120, y: 60, rx: 5, ry: 4, angle: 0.2, depth: 5, kind: 'lochan' });
    T.loch({ points: [[226, 150], [210, 165], [194, 177], [178, 186]], width: 6.5, level: 636, depth: 28, wobble: 0.5 });
    T.clampTo(604, 1309);

    T.path(approach);
    T.path(crossing);
    T.path(ghru);
    T.path([[168, 36], [146, 40], [126, 46], [120, 52]]);
    T.path([[168, 72], [182, 108], [192, 146], [184, 176], [174, 192]]);
    T.path([[56, 205], [60, 190]]);

    T.label(166, 79, 'Càrn Gorm', 'peak');
    T.label(107, 139, 'Beinn Mhic Dhùbhaidh', 'peak');
    T.label(126, 74, 'Càrn Lochan', 'peak');
    T.label(152, 52, 'Coire an t-Sneachda', 'glen');
    T.label(120, 50, 'Coire an Lochain', 'glen');
    T.label(60, 120, 'Làirig Ghrù', 'glen');
    T.label(204, 168, 'Loch A\' an', 'water');
    T.label(120, 61, 'Lochan Coire', 'water');
    T.label(180, 196, 'Clach Dhian', 'feature');
    T.label(184, 133, 'Beinn Mheadhoin', 'peak');
  },

  cover: { treeline: 720, woodDensity: 0.22, woodMin: 600, woodSlope: 0.4, bogFlatness: 0.05, bogMax: 800, bogAmount: 0.3, snowline: 1125, snowSlope: 1.0, rockline: 1030, rockAmount: 0.6, cragSlope: 0.7, cragStrata: 0.25, cragJitter: 0.14, screeMinH: 700, streamThreshold: 1300, riverThreshold: 3000, fallDrop: 40 },

  spawn: { x: 166, y: 6 },
  pois: [
    { id: 'lochan-coire', type: 'lochan', name: 'Lochan Coire an Lochain', x: 120, y: 60, condition: { time: 'dawn' }, hint: 'Ice on the corrie lochan intae May. It waukens at the daw.' },
    { id: 'cairn-gorm', type: 'summit', name: 'Càrn Gorm', x: 166, y: 79, condition: { climb: 4 }, hint: 'The blue hill. Fower thick contours o granite, speeled wi nae break.' },
    { id: 'cairn-mheadhoin', type: 'cairn', name: 'Càrn Mheadhoin', x: 196, y: 112, condition: { approach: 'descending' }, hint: 'Middle cairn on the plateau. Win tae it gaun dounhill.' },
    { id: 'trig-macdui', type: 'trig', name: 'Beinn Mhic Dhùbhaidh', x: 106, y: 142, condition: { climb: 2 }, hint: 'Second heichest in Britain. Twa contours up tae the pillar.' },
    { id: 'shelter-stone', type: 'stone', name: 'Clach Dhian', x: 176, y: 195, condition: { dwell: 4 }, hint: 'Walkers sleep unner this muckle stane. Bide aside it a while.' },
    { id: 'corrour', type: 'bothy', name: 'Corrour Bothy', x: 58, y: 208, condition: {}, hint: 'A stane bothy on the flair o the Làirig Ghrù, by the Dee.' },
    { id: 'garbh-allt', type: 'waterfall', name: 'Garbh Allt Falls', x: 174, y: 168, condition: { approach: 'descending' }, hint: 'Garbh Allt: the rouch burn. It drops aff the plateau; come doun wi it.' },
    { id: 'crag-sneachda', type: 'crag', name: 'Coire an t-Sneachda Headwall', x: 152, y: 52, condition: { speed: 'fast' }, hint: 'Corrie o the snaw. Its granite dirls whan ye come at a rin.' },
  ],
  gate: { x: 52, y: 255, chain: ['lochan', 'summit', 'cairn'], name: 'Làirig Ghrù' },

  fieldNotes: [
    'The corrie lochan opens wi the sun. Be there at the daw.',
    'On the blue hill ilka contour coonts. Speel wi nae step back.',
    'The plateau cairns are met on the road doun.',
    'Granite, frost-split. Snaw in the corries intae August.',
  ],
  palette: { tint: '#8aa4c0', accent: 'ice', paper: '#eef0ea' },
};
