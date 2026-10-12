/**
 * II. Glen Affric (NH) — an east-west glen of lochs and Caledonian pine, high
 * ridges to the north (Sgùrr na Lapaich, Màm Sodhail), a plunging burn, bothy in the west.
 */
const glen = [[0, 152, 430], [30, 148, 368], [60, 143, 322], [92, 139, 284], [112, 134, 264], [140, 131, 263], [166, 129, 263],
  [180, 127, 252], [192, 125, 239], [215, 124, 234], [240, 122, 233], [255, 121, 229]];
const track = [[255, 112], [238, 114], [214, 116], [196, 117], [182, 120], [166, 122], [146, 124], [124, 128], [108, 130], [92, 132], [72, 135], [54, 139], [34, 143], [14, 148], [0, 150]];

export default {
  id: 'affric',
  index: 1,
  name: 'Glen Affric',
  gaelic: 'Gleann Afraig',
  gridLetters: 'NH',
  gridOrigin: [10, 18],
  subtitle: 'II. The Pinewood',
  seed: 2207,
  contourInterval: 10,
  elevation: { min: 220, max: 1180 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(640);
    // north is high country, south slopes lower
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += (128 - y) * 0.9;
    T.addNoise({ scale: 100, amp: 110, octaves: 3, offset: 1 });
    T.addNoise({ scale: 64, amp: 85, octaves: 3, ridged: true, warp: 24, offset: 2 });
    T.addNoise({ scale: 22, amp: 14, octaves: 3, offset: 3 });
    // named tops
    T.dome({ x: 70, y: 36, rx: 42, ry: 36, angle: 0.4, height: 400, steep: 0.1, warp: 0.3, jagged: 0.3 });   // Màm Sodhail
    T.dome({ x: 168, y: 30, rx: 46, ry: 30, angle: -0.2, height: 380, steep: 0.12, warp: 0.3, jagged: 0.3 }); // Sgùrr na Lapaich
    T.dome({ x: 118, y: 206, rx: 40, ry: 30, height: 190, steep: 0.1, warp: 0.3 });                        // Beinn Fhada
    T.dome({ x: 214, y: 214, rx: 34, ry: 28, height: 150, steep: 0.1, warp: 0.3 });
    T.dome({ x: 30, y: 210, rx: 36, ry: 32, height: 180, steep: 0.1, warp: 0.3 });
    T.dome({ x: 210, y: 92, radius: 16, height: 70, steep: 0.2 });                                            // wooded knoll above Loch Beinn a' Mheadhoin
    // the glen itself
    T.carveGlen({ points: glen, width: 32, profile: 'U', flat: 0.3, wobble: 0.5 });
    // Plodda-style side burn tumbling from the north
    T.carveGlen({ points: [[190, 30, 900], [184, 56, 760], [178, 76, 640], [175, 88, 560], [174, 98, 330], [175, 110, 270], [177, 122, 255]], width: 13, profile: 'V', wobble: 0.5 });
    T.carveGlen({ points: [[94, 70, 780], [98, 96, 600], [100, 112, 420], [100, 128, 300]], width: 8, profile: 'V', wobble: 0.5 });
    T.smooth(1);
    // pin the named tops to their real heights
    T.fitMax(1181, 760);
    T.peak({ x: 68, y: 26, height: 1181, radius: 12, search: 14 });    // Màm Sodhail (the true top of the massif)
    T.peak({ x: 61, y: 40, height: 1110, radius: 8, search: 3 });
    T.peak({ x: 170, y: 28, height: 1150, radius: 12, search: 8 });    // Sgùrr na Lapaich
    T.peak({ x: 118, y: 206, height: 906, radius: 10, search: 8 });    // Beinn Fhada (south)
    // corrie lochan under Màm Sodhail
    T.corrie({ x: 62, y: 62, radius: 12, depth: 75, open: Math.PI / 2 });
    T.loch({ x: 62, y: 64, rx: 5, ry: 4, angle: 0.3, depth: 3, kind: 'lochan' });
    // Loch Affric and Loch Beinn a' Mheadhoin
    T.loch({ points: [[108, 134], [124, 131], [146, 130], [166, 129]], width: 7, level: 263.5, depth: 20, wobble: 0.6 });
    T.loch({ points: [[198, 125], [216, 124], [238, 123]], width: 6.5, level: 234.5, depth: 15, wobble: 0.6 });
    T.lochans({ count: 8, area: { x0: 20, y0: 20, x1: 230, y1: 90 }, rmin: 2, rmax: 4, depth: 2, prefer: 'flat', avoid: [{ x: 62, y: 64, r: 14 }] });
    T.clampTo(224, 1180);

    T.path(track);
    T.path([[146, 124], [150, 108], [160, 96], [172, 98]]);   // spur up to the falls
    T.path([[54, 139], [58, 120], [62, 98], [66, 78]]);        // way up to the corrie

    T.label(69, 24, 'Màm Sodhail', 'peak');
    T.label(172, 28, 'Sgùrr na Lapaich', 'peak');
    T.label(118, 206, 'Beinn Fhada', 'peak');
    T.label(128, 138, 'Loch Affric', 'water');
    T.label(220, 118, 'Loch Beinn a\' Mheadhoin', 'water');
    T.label(62, 64, 'Lochan Coire Sgàil', 'water');
    T.label(60, 150, 'Gleann Afraig', 'glen');
    T.label(176, 92, 'Eas a\' Phlodda', 'feature');
    T.label(40, 134, 'Athnamulloch', 'feature');
  },

  cover: { treeline: 660, woodDensity: 0.8, woodSlope: 0.62, bogFlatness: 0.05, bogMax: 330, bogAmount: 0.4, snowline: 1150, rockline: 880, cragSlope: 0.85, cragStrata: 0.25, cragJitter: 0.16, screeMinH: 600, streamThreshold: 1300, riverThreshold: 3500, fallDrop: 40 },

  spawn: { x: 238, y: 114 },
  pois: [
    { id: 'eas-phlodda', type: 'waterfall', name: 'Eas a\' Phlodda', x: 174, y: 98, condition: { approach: 'descending' }, hint: 'Water falls only for those who fall with it.' },
    { id: 'loch-afraig', type: 'lochan', name: 'Loch Afraig shore', x: 130, y: 136, condition: { speed: 'slow' }, hint: 'The loch keeps a long silence at the shore.' },
    { id: 'athnamulloch', type: 'bothy', name: 'Athnamulloch', x: 48, y: 140, condition: { dwell: 2 }, hint: 'A hearth, warm for those who linger.' },
    { id: 'lochan-sgail', type: 'lochan', name: 'Lochan Coire Sgàil', x: 62, y: 64, condition: {}, hint: 'High water, cold as bells.' },
    { id: 'cairn-ghuibhais', type: 'cairn', name: 'Càrn a\' Ghuibhais', x: 98, y: 112, condition: {}, hint: 'A pile of old patience above the pines.' },
    { id: 'trig-fhada', type: 'trig', name: 'Beinn Fhada', x: 118, y: 206, condition: { climb: 2 }, hint: 'The pillar sings after a steady climb.' },
    { id: 'summit-sodhail', type: 'summit', name: 'Màm Sodhail', x: 69, y: 23, condition: { climb: 3 }, hint: 'Apex of the glen, earned by height alone.' },
    { id: 'stone-pinewood', type: 'stone', name: 'Clach na Giuthais', x: 204, y: 100, condition: { dwell: 4 }, hint: 'Stones remember the ones who wait.' },
  ],
  gate: { x: 0, y: 150, chain: ['waterfall', 'lochan', 'bothy'], name: 'Bealach Coire Ghaidheil' },

  fieldNotes: [
    'Where the burn leaves the hill it falls; come down with it.',
    'Loch Affric sleeps. Do not wake it by hurrying.',
    'The bothy warms the patient. Sit a while before the door.',
    'Pines hold the sound of water longer than stone does.',
  ],
  palette: { tint: '#6a8a5a', paper: '#efe8c9' },
};
