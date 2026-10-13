/**
 * I. Rannoch Moor (NN) — vast peat plateau pocked with lochans, the Black Mount
 * rising on the west edge, Loch Laidon in the south-east. The teaching level.
 */
const track = [[138, 0], [134, 28], [127, 62], [121, 96], [122, 132], [113, 172], [104, 214], [96, 255]];

export default {
  id: 'rannoch',
  index: 0,
  name: 'Rannoch Moor',
  gaelic: 'Mòinteach Raineach',
  gridLetters: 'NN',
  gridOrigin: [32, 51],
  subtitle: 'I. The Muir',
  seed: 1101,
  contourInterval: 10,
  elevation: { min: 290, max: 640 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(322);
    T.addNoise({ scale: 90, amp: 22, octaves: 3, offset: 1 });
    T.addNoise({ scale: 30, amp: 9, octaves: 3, offset: 2 });
    T.addNoise({ scale: 11, amp: 3.2, octaves: 3, offset: 3 });
    // the Moor tilts gently east toward Loch Laidon / Rannoch Station
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += (x - 128) * -0.12 + (y - 128) * -0.05;
    // the Black Mount: Meall a' Bhùiridh and friends along the west edge
    T.dome({ x: 4, y: 58, rx: 70, ry: 62, angle: 0.3, height: 330, steep: 0.2, warp: 0.35, jagged: 0.25 });
    T.dome({ x: -6, y: 150, rx: 50, ry: 46, height: 160, steep: 0.1, warp: 0.3 });
    T.dome({ x: 12, y: 18, rx: 30, ry: 28, height: 110, steep: 0.1, warp: 0.3 });
    // low knolls dotted over the moor
    for (let k = 0; k < 22; k++) {
      const x = T.rng.range(45, 245), y = T.rng.range(8, 248);
      T.dome({ x, y, radius: T.rng.range(6, 13), height: T.rng.range(10, 32), steep: 0.1, warp: 0.4 });
    }
    // trig knoll (north-east of spawn) and cairn knoll
    T.dome({ x: 198, y: 58, radius: 15, height: 62, steep: 0.25, warp: 0.25 });
    T.dome({ x: 172, y: 92, radius: 9, height: 24, steep: 0.1, warp: 0.3 });
    T.dome({ x: 80, y: 90, radius: 8, height: 20, steep: 0.2 });
    T.smooth(1);
    T.fitMax(640, 460);
    T.clampTo(296, 640);

    // Loch Laidon: long, NE-SW, in the south-east
    T.loch({ points: [[150, 226], [172, 212], [196, 196], [220, 182], [243, 166]], width: 6, level: 301, depth: 14, shallow: 2, wobble: 0.6 });
    // Loch Bà in the west
    T.loch({ x: 58, y: 126, rx: 11, ry: 7, angle: 0.6, level: 330, depth: 7, wobble: 0.5 });
    // named lochans near the start
    T.loch({ x: 152, y: 108, rx: 7, ry: 5, angle: 0.4, level: 318, depth: 3, kind: 'lochan' });
    T.loch({ x: 74, y: 168, rx: 6, ry: 4, angle: 1.2, level: 322, depth: 3, kind: 'lochan' });
    // the countless lochans
    const avoid = [...T.avoidAlong(track, 4), { x: 198, y: 58, r: 14 }, { x: 172, y: 92, r: 9 }];
    T.lochans({ count: 150, area: { x0: 26, y0: 6, x1: 250, y1: 250 }, rmin: 1.7, rmax: 7.5, avoid, depth: 1.8, tries: 6, aspect: 2.2 });

    T.path(track);
    // the old drove road west to Loch Bà
    T.path([[121, 112], [100, 118], [80, 126], [66, 138]]);

    T.label(8, 54, 'Meall a\' Bhùiridh', 'peak');
    T.label(14, 150, 'Beinn a\' Chrulaiste', 'peak');
    T.label(196, 190, 'Loch Laidon', 'water');
    T.label(58, 126, 'Loch Bà', 'water');
    T.label(150, 112, 'Lochan na h-Achlaise', 'water');
    T.label(128, 30, 'Mòinteach Raineach', 'glen');
    T.label(198, 58, 'Cnoc an Tairbh', 'feature');
    T.label(100, 226, 'Raineach Dhubh', 'feature');
  },

  cover: { treeline: 380, woodDensity: 0.12, woodMin: 280, bogFlatness: 0.11, bogMax: 420, bogAmount: 0.7, snowline: null, rockline: 520, cragSlope: 0.9, screeMinH: 450, streamThreshold: 900 },

  spawn: { x: 126, y: 74 },
  pois: [
    { id: 'achlaise', type: 'lochan', name: 'Lochan na h-Achlaise', x: 152, y: 108, condition: { speed: 'slow' }, hint: 'Peat-black watter hauds the hale lift. Come canny or it shivers.' },
    { id: 'cairn-tairbh', type: 'cairn', name: 'Càrn an Tairbh', x: 186, y: 66, condition: { approach: 'descending' }, hint: 'A rickle o stanes on the brae. It waukens for them that come doun.' },
    { id: 'trig-tairbh', type: 'trig', name: 'Cnoc an Tairbh', x: 198, y: 58, condition: { climb: 1 }, hint: 'A pillar ae thick contour abune the moss. Speel tae it.' },
    { id: 'bothy-ba', type: 'bothy', name: 'Ba Bothy', x: 124, y: 132, condition: {}, hint: 'Peat reek by the auld road, whaur it crosses the Bà.' },
    { id: 'stone-mhoine', type: 'stone', name: 'Clach na Mòine', x: 82, y: 98, condition: { dwell: 3 }, hint: 'A granite stane the ice set doun. Bide wi it a wee.' },
    { id: 'lochan-ba', type: 'lochan', name: 'Lochan Bà', x: 66, y: 128, condition: { speed: 'slow' }, hint: 'Bog-cotton at the edge. Step slaw or the moss gies way.' },
    { id: 'lochan-fhuar', type: 'lochan', name: 'Lochan Fuar', x: 76, y: 168, condition: {}, hint: 'Fuar means cauld. Nae path gangs near it.' },
  ],
  gate: { x: 98, y: 255, chain: ['lochan', 'cairn'], name: 'Bealach na Mòintich' },

  fieldNotes: [
    'Come tae the watter canny. The lochans hear a hasty fit.',
    'A cairn waukens for the walker comin doun aff the hill.',
    'Ower mony lochans tae coont. Thae by the auld road sing.',
    'Unner the peat, granite. The muir harks through the rock.',
  ],
  palette: { tint: '#7f8f6a', accent: 'magenta', paper: '#eee6c8' },
};
