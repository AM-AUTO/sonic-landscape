/**
 * VII. Assynt (NC) — ancient gneiss "cnoc and lochan" country, thousands of
 * lochans between rocky knolls, and isolated sandstone inselbergs rising out of
 * it: ridge-shaped Suilven, jagged Stac Pollaidh, Cùl Mòr and Canisp.
 */
const track = [[26, 192], [48, 186], [72, 178], [94, 170], [116, 160], [140, 158], [166, 160], [194, 160], [222, 156], [255, 150]];

export default {
  id: 'assynt',
  index: 6,
  name: 'Assynt',
  gaelic: 'Asaint',
  gridLetters: 'NC',
  gridOrigin: [10, 12],
  subtitle: 'VII. Cnoc and Lochan',
  seed: 7707,
  contourInterval: 10,
  elevation: { min: 0, max: 850 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(95);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += (x - 128) * 0.34;
    T.addNoise({ scale: 70, amp: 24, octaves: 3, offset: 1 });
    // the cnoc: abundant small gneiss knolls
    T.addNoise({ scale: 17, amp: 20, octaves: 3, ridged: true, warp: 9, offset: 2 });
    T.addNoise({ scale: 7, amp: 5, octaves: 2, offset: 3 });
    // inselbergs
    T.dome({ x: 120, y: 110, rx: 36, ry: 8.5, angle: 0.12, height: 590, steep: 1.3, warp: 0.18 });            // Suilven
    T.ridge({ points: [[92, 113, 60], [108, 111, 90], [124, 109, 70], [136, 108, 90], [150, 106, 40]], width: 5, jagged: 0.6, sharpness: 1, height: 70 });
    T.dome({ x: 50, y: 130, radius: 12, height: 470, steep: 0.7, jagged: 1.0, warp: 0.25 });                   // Stac Pollaidh
    T.dome({ x: 165, y: 214, radius: 32, height: 720, steep: 0.45, warp: 0.3, jagged: 0.3 });                  // Cùl Mòr
    T.dome({ x: 206, y: 96, rx: 30, ry: 22, angle: 0.5, height: 640, steep: 0.5, warp: 0.3, jagged: 0.2 });   // Canisp
    T.dome({ x: 80, y: 218, radius: 16, height: 190, steep: 0.5, warp: 0.3 });                                  // Cùl Beag-ish
    // coast
    T.carveGlen({ points: [[0, 40, 5], [14, 100, 6], [10, 150, 5], [0, 210, 4]], width: 22, profile: 'U', flat: 0.5, wobble: 0.5 });
    // Kirkaig river: Fionn Loch tumbling west to the sea
    T.carveGlen({ points: [[100, 62, 92], [88, 68, 88], [76, 74, 80], [70, 82, 36], [60, 96, 8]], width: 6, profile: 'V', wobble: 0.3 });
    T.smooth(1);
    T.fitMax(850, 600);
    T.peak({ x: 165, y: 214, height: 849, radius: 12, search: 10 });   // Cùl Mòr
    T.peak({ x: 206, y: 96, height: 846, radius: 12, search: 10 });    // Canisp
    T.peak({ x: 104, y: 112, height: 731, radius: 8, search: 8 });     // Caisteal Liath
    T.peak({ x: 128, y: 109, height: 723, radius: 8, search: 8 });     // Meall Meadhonach
    T.peak({ x: 50, y: 130, height: 612, radius: 7, search: 6 });      // Stac Pollaidh
    // lochs
    T.loch({ points: [[98, 58], [120, 55], [142, 61]], width: 5, level: 92, depth: 10, wobble: 0.6 });                // Fionn Loch
    T.loch({ points: [[222, 14], [231, 56], [240, 98], [252, 140]], width: 6.5, level: 126, depth: 14, wobble: 0.5 }); // Loch Assynt
    T.loch({ points: [[-4, 40], [11, 98], [6, 150], [-4, 212]], width: 12, level: 0, depth: 5, sea: true, shallow: 1, wobble: 0.4 });
    T.loch({ x: 92, y: 142, rx: 7, ry: 4.5, angle: 0.5, level: 88, depth: 3, kind: 'lochan' });
    T.loch({ x: 82, y: 196, rx: 5, ry: 3.4, angle: 0.4, level: 80, depth: 2.5, kind: 'lochan' });
    const keep = [...T.avoidAlong(track, 4), { x: 120, y: 110, r: 38 }, { x: 50, y: 130, r: 14 }, { x: 165, y: 214, r: 34 }, { x: 206, y: 96, r: 26 }, { x: 92, y: 142, r: 8 }];
    T.lochans({ count: 120, area: { x0: 14, y0: 8, x1: 236, y1: 248 }, rmin: 1.5, rmax: 5.2, avoid: keep, depth: 1.8, prefer: 'low', tries: 8, aspect: 2 });
    T.clampTo(0, 850);

    T.path(track);
    T.path([[116, 160], [118, 140], [114, 124], [111, 112], [111, 109]]);                // the gully onto Suilven
    T.path([[93, 140], [98, 128], [104, 118], [108, 111], [111, 109]]);                    // the lochan gully
    T.path([[48, 186], [46, 164], [48, 144]]);                              // to Stac Pollaidh
    T.path([[166, 160], [166, 184], [164, 204]]);                           // to Cùl Mòr
    T.path([[194, 160], [200, 136], [204, 112]]);                           // to Canisp
    T.path([[72, 178], [68, 140], [70, 108], [70, 86]]);                    // north to the Kirkaig falls

    T.label(111, 110, 'Caisteal Liath', 'peak');
    T.label(123, 110, 'Meall Meadhonach', 'peak');
    T.label(52, 131, 'Stac Pollaidh', 'peak');
    T.label(165, 214, 'Cùl Mòr', 'peak');
    T.label(206, 96, 'Canisp', 'peak');
    T.label(120, 58, 'Fionn Loch', 'water');
    T.label(236, 66, 'Loch Assainte', 'water');
    T.label(92, 142, 'Loch Dhruim Suardalain', 'water');
    T.label(70, 86, 'Allt Chàrcaig', 'water');
    T.label(110, 184, 'Gleann Chanaisp', 'glen');
    T.label(10, 172, 'Loch an Inbhir', 'feature');
  },

  cover: { treeline: 180, woodDensity: 0.1, woodSlope: 0.4, bogFlatness: 0.10, bogMax: 260, bogAmount: 0.6, snowline: null, rockline: 140, rockAmount: 0.45, cragSlope: 0.85, cragStrata: 0.25, cragJitter: 0.14, cragGap: 0.15, screeSlope: 0.6, screeBand: 3, screeMinH: 150, streamThreshold: 1100, riverThreshold: 3000, fallDrop: 30 },

  spawn: { x: 28, y: 192 },
  pois: [
    { id: 'clach-oidhche', type: 'stone', name: 'Clach na h-Oidhche', x: 64, y: 184, condition: { time: 'night', dwell: 3 }, hint: 'Stones remember the ones who wait, and who wait in the dark.' },
    { id: 'lochan-suardalain', type: 'lochan', name: 'Loch Dhruim Suardalain', x: 92, y: 142, condition: { speed: 'slow' }, hint: 'The gneiss lochans tolerate only quiet steps.' },
    { id: 'summit-suilven', type: 'summit', name: 'Caisteal Liath', x: 111, y: 110, condition: { climb: 3 }, hint: 'Suilven: the whole sky stands on its back.' },
    { id: 'trig-canisp', type: 'trig', name: 'Canisp', x: 206, y: 96, condition: { climb: 2 }, hint: 'A pillar on the far white hill.' },
    { id: 'crag-pollaidh', type: 'crag', name: 'Stac Pollaidh', x: 50, y: 138, condition: { speed: 'fast' }, hint: 'The small jagged hill rattles under hurrying feet.' },
    { id: 'suileag', type: 'bothy', name: 'Suileag', x: 112, y: 162, condition: {}, hint: 'A bothy under the great loaf of Suilven.' },
    { id: 'cairn-mor', type: 'cairn', name: 'Càrn Chùil Mhòir', x: 166, y: 190, condition: { approach: 'descending' }, hint: 'Cairn on the long shoulder south of the track.' },
    { id: 'eas-chairceig', type: 'waterfall', name: 'Falls of Kirkaig', x: 70, y: 84, condition: { approach: 'descending' }, hint: 'The river drops all at once, then runs to the sea.' },
  ],
  gate: { x: 255, y: 150, chain: ['stone', 'lochan', 'summit'], name: 'Bealach an Easain' },

  fieldNotes: [
    'There are more lochans than lies. Count only the ones that listen.',
    'Some stones wake only in the dark.',
    'Suilven is a wall until you find its gully.',
    'The track is the longest sentence in the language of the moor.',
  ],
  palette: { tint: '#8a8f9c', paper: '#ebe4d0' },
};
