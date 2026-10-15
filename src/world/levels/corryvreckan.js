/**
 * I. Corryvreckan & Jura (NM / NR) — the teaching level, an island coast at Samhain.
 * The sea fills the west and the north; Scarba stands as a domed island in the north-west, and the Gulf of
 * Corryvreckan runs between it and the north tip of Jura with the whirlpool in it. On Jura: raised beaches
 * stepping up from the west shore, a wide wet moss of lochans inland, Loch Tarbert biting in from the west,
 * oak and birch on the sheltered east shore, and the three Paps rising conical under quartzite scree in the
 * south-east. Native 384 sheet (docs/LEVELS.md).
 *
 * Names marked * are invented descriptive Gaelic, to be checked.
 */
const S0 = 384;
// distance (cells) from the sea for every cell, filled during sculpt and read by cover.adjust (same build)
let seaDist = null, islandNoise = null;

// the track down the island: north tip, the east-side track by Barnhill, over the neck at Tarbert,
// round under the Paps and away south to the Sound of Islay
const track = [[211, 31], [214, 52], [222, 78], [236, 104], [250, 132], [268, 160], [296, 186], [326, 208], [354, 224], [366, 246], [366, 274], [358, 306], [338, 338], [302, 360], [236, 372], [174, 383]];

export default {
  id: 'corryvreckan',
  index: 0,
  name: 'Corryvreckan',
  gaelic: 'Coire Bhreacain',
  gridLetters: 'NM',
  gridOrigin: [64, 2],
  subtitle: 'I. The Plaid',
  seed: 1105,
  designVersion: 2,
  contourInterval: 10,
  elevation: { min: 0, max: 785 },
  season: { night: 0.55, dawn: 0.08, dusk: 0.09, startTime: 0.03, snowline: 610 },

  sculpt(T) {
    const S = T.size, h = T.height, ss = T.util.smoothstep;
    const lin = (a, b, v) => ss((v - a) / (b - a));
    T.fill(60);

    // ---- the sea: open water west and north, the ring round Scarba, the Gulf, the Sound of Jura, Loch Tarbert.
    // Bodies overlap, so none has a shallow rim (shallow: 0) and no seam shows where two meet.
    const sea = (o) => T.loch({ level: 0, depth: 4, sea: true, shallow: 0, ...o });
    // a ring round Scarba makes it an island; open water beyond it to the west and north
    const ring = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const r = 70 + 7 * Math.sin(2 * a + 0.7) + 5 * Math.sin(3 * a + 2.1) + 3.5 * Math.sin(5 * a + 1.3);   // an uneven coast, points and bays
      ring.push([80 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.94]);
    }
    sea({ points: ring, width: 26, wobble: 0.22 });
    sea({ x: 40, y: 78, rx: 8, ry: 5, angle: 0.4, wobble: 0.3 });     // Scarba's bays: west, north-east, south-east
    sea({ x: 104, y: 30, rx: 7, ry: 5, angle: -0.6, wobble: 0.3 });
    sea({ x: 114, y: 84, rx: 6, ry: 4, angle: 0.8, wobble: 0.3 });
    sea({ points: [[-36, 470], [-36, 200], [-36, -60]], width: 62, wobble: 0.05 });                          // far west
    sea({ points: [[-60, -42], [90, -46], [168, -26], [192, -34], [212, -48], [236, -36], [256, -10]], width: 56, wobble: 0.08 }); // north, the tip
    sea({ points: [[80, 156], [56, 210], [56, 262], [54, 312], [60, 380], [64, 460]], width: 60, wobble: 0.1 }); // west, off Jura
    sea({ points: [[152, -20], [156, 30], [150, 78], [132, 112], [100, 134]], width: 21, wobble: 0.16 });      // the Gulf
    sea({ points: [[268, -70], [326, 4], [372, 62], [420, 110], [470, 150]], width: 72, wobble: 0.08 });       // Sound of Jura
    sea({ points: [[405, 120], [430, 190], [440, 214]], width: 56, wobble: 0.08 });                             // Sound, down the east edge
    // bays: Bàgh Gleann nam Muc by the Gulf, Glengarrisdale, Shian Bay; and Loch Tarbert nearly cutting the island
    sea({ x: 176, y: 74, rx: 12, ry: 8, angle: 0.8, wobble: 0.3 });
    sea({ x: 136, y: 152, rx: 10, ry: 7, angle: 0.3, wobble: 0.3 });
    sea({ x: 122, y: 284, rx: 9, ry: 12, angle: 0.2, wobble: 0.3 });
    sea({ x: 296, y: 92, rx: 11, ry: 7, angle: 0.75, wobble: 0.3 });
    sea({ points: [[92, 262], [118, 256], [140, 244], [160, 252], [182, 250], [200, 238]], width: 8, wobble: 0.4 });                 // outer Loch Tarbert
    sea({ points: [[200, 238], [220, 244], [240, 232], [262, 242], [286, 228], [306, 240], [328, 230], [346, 240]], width: 4, wobble: 0.45 }); // the narrows
    sea({ x: 262, y: 238, rx: 10, ry: 6, angle: 0.3, wobble: 0.35 });   // the inner pools
    sea({ x: 318, y: 236, rx: 7, ry: 4.5, angle: -0.3, wobble: 0.35 });

    // ---- distance from the sea (chamfer), the frame for every coastal form
    const N = S * S, D = new Float32Array(N);
    for (let i = 0; i < N; i++) D[i] = h[i] < 0 ? 0 : 1e6;
    const R2 = Math.SQRT2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; let v = D[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, D[i - 1] + 1);
      if (y > 0) { v = Math.min(v, D[i - S] + 1); if (x > 0) v = Math.min(v, D[i - S - 1] + R2); if (x < S - 1) v = Math.min(v, D[i - S + 1] + R2); }
      D[i] = v;
    }
    for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
      const i = y * S + x; let v = D[i];
      if (v === 0) continue;
      if (x < S - 1) v = Math.min(v, D[i + 1] + 1);
      if (y < S - 1) { v = Math.min(v, D[i + S] + 1); if (x < S - 1) v = Math.min(v, D[i + S + 1] + R2); if (x > 0) v = Math.min(v, D[i + S - 1] + R2); }
      D[i] = v;
    }
    seaDist = D; islandNoise = T.noise;

    // ---- land: shingle, two raised beaches (an old sea cliff behind the upper one on the west), then the island
    const nz = T.noise;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (h[i] < 0) continue;
      const d = D[i];
      const west = lin(250, 150, x + 0.35 * y - 60);                                   // raised beaches are a west-coast thing
      const cliff = west * lin(0.05, 0.35, nz.noise2(x * 0.035 + 4, y * 0.035 - 2)); // where the upper riser is a cliff
      const w1 = 2.4 + 1.6 * west, w2 = 8 + 5 * west;
      let v = 1.2 + 0.5 * Math.min(d, 2);
      v += (5 + 3 * west) * lin(w1, w1 + 1.2, d);                                       // the low beach
      v += (12 + 32 * cliff) * lin(w2, w2 + 3.2 - 2.6 * cliff, d);                      // the high beach, a cliff in places
      const inland = Math.max(0, d - w2 - 4);
      v += 150 * (1 - Math.exp(-inland / 42)) + 0.35 * inland;
      h[i] = v;
    }
    // the island's grain: low rough ridges running NE-SW, damped on the beaches
    const rough = (x, y) => lin(9, 30, D[y * S + x]);
    T.addNoise({ scale: 70, amp: 40, octaves: 3, offset: 1, mask: rough });
    T.addNoise({ scale: 26, amp: 16, octaves: 3, ridged: true, warp: 10, offset: 2, mask: rough });

    // north Jura: a spine of rough hills down the middle of the island
    T.ridge({ points: [[206, 54, 120], [224, 96, 210], [228, 140, 170], [214, 176, 90]], width: 26, sharpness: 0.6, jagged: 0.25, height: 160, meander: 6 });
    T.dome({ x: 186, y: 110, rx: 30, ry: 22, angle: 0.9, height: 170, steep: 0.2, warp: 0.3 });          // Garrisdale's hill
    T.dome({ x: 262, y: 186, rx: 30, ry: 26, angle: 0.7, height: 130, steep: 0.2, warp: 0.3 });          // east of the moss
    // Scarba: a lumpy dome with its top off to the north-west, and a steep cliffed face to the Gulf in the south
    T.dome({ x: 80, y: 62, rx: 50, ry: 44, angle: 0.5, height: 250, steep: 0.15, warp: 0.4 });
    T.dome({ x: 68, y: 48, rx: 24, ry: 18, angle: 0.7, height: 200, steep: 0.2, warp: 0.3 });
    T.dome({ x: 86, y: 80, rx: 30, ry: 15, angle: 0.25, height: 150, steep: 1.4, warp: 0.25 });
    T.addNoise({ scale: 16, amp: 22, octaves: 3, ridged: true, offset: 7, mask: (x, y) => Math.max(0, 1 - Math.hypot(x - 80, y - 62) / 48) });
    // the moss: a broad wet hollow inland, held level
    T.plateau({ x: 164, y: 192, rx: 46, ry: 34, angle: 0.4, height: 118, edge: 22, rough: 0.25, keepHigher: false });
    // the Paps: three cones under scree, and Corra Bheinn to the north-east
    T.dome({ x: 300, y: 300, rx: 62, ry: 54, angle: 0.75, height: 180, steep: 0.1, warp: 0.25 });        // their shared footing
    T.dome({ x: 300, y: 292, radius: 30, height: 560, steep: 0.05, warp: 0.12 });                       // Beinn an Òir
    T.dome({ x: 337, y: 262, radius: 28, height: 520, steep: 0.05, warp: 0.12 });                       // Beinn Shiantaidh
    T.dome({ x: 266, y: 324, radius: 27, height: 500, steep: 0.05, warp: 0.12 });                       // Beinn a' Chaolais
    T.dome({ x: 322, y: 176, radius: 20, height: 300, steep: 0.1, warp: 0.2 });                         // Corra Bheinn
    // Sgrìob na Caillich: her slide, boulder ridges running west off Beinn an Òir
    for (const off of [-4, 0, 4]) T.ridge({ points: [[272, 286 + off], [244, 280 + off * 1.3], [212, 278 + off * 1.6], [186, 282 + off * 2]], width: 2.2, height: 7, sharpness: 1.2, jagged: 0.5 });
    // a burn falling off the island's east side through the woods
    T.carveGlen({ points: [[262, 128], [286, 130], [304, 140]], width: 6, depth: 34, profile: 'V', wobble: 0.3 });
    T.smooth(1);
    T.fitMax(785, 520);
    T.peak({ x: 300, y: 292, height: 785, radius: 12, search: 8 });   // Beinn an Òir
    T.peak({ x: 337, y: 262, height: 757, radius: 12, search: 8 });   // Beinn Shiantaidh
    T.peak({ x: 266, y: 324, height: 734, radius: 12, search: 8 });   // Beinn a' Chaolais
    T.peak({ x: 68, y: 48, height: 449, radius: 12, search: 8 });    // Cruach Scarba
    // Uamh nan Calman: an old sea cliff with its cave, a headland behind the raised beach south of Shian Bay
    T.dome({ x: 142, y: 302, rx: 14, ry: 20, angle: 0.15, height: 120, steep: 1.6, warp: 0.15 });

    // lochs and the moss lochans
    T.loch({ x: 143, y: 186, rx: 6.5, ry: 4, angle: 0.5, level: 117.6, depth: 3, kind: 'lochan' });     // Loch Righ Mòr
    T.loch({ x: 318, y: 287, rx: 5, ry: 3.2, angle: 0.9, depth: 3, kind: 'lochan' });                   // Loch an t-Siob
    const keep = [...T.avoidAlong(track, 6), { x: 143, y: 186, r: 12 }, { x: 200, y: 230, r: 12 }];
    T.lochans({ count: 46, area: { x0: 112, y0: 160, x1: 226, y1: 228 }, rmin: 1.4, rmax: 4.2, avoid: keep, depth: 1.5, prefer: 'low', tries: 8, aspect: 2 });
    T.lochans({ count: 12, area: { x0: 180, y0: 90, x1: 250, y1: 150 }, rmin: 1.3, rmax: 3, avoid: keep, depth: 1.3, prefer: 'flat', tries: 6 });
    T.clampTo(0, 785);

    T.path(track);
    T.path([[236, 104], [210, 116], [184, 130], [160, 146], [150, 158]]);              // west over to Glengarrisdale
    T.path([[268, 160], [246, 196], [224, 220], [202, 230]]);                           // down to Cruib on Loch Tarbert
    T.path([[338, 338], [300, 340], [262, 344], [232, 330], [214, 300], [212, 282]]);   // under Beinn a' Chaolais to her slide
    T.path([[250, 132], [272, 130], [292, 136]]);                                       // to the east woods

    T.label(68, 48, 'Scarba', 'peak');
    T.label(150, 60, 'Coire Bhreacain', 'water');
    T.label(300, 292, 'Beinn an Òir', 'peak');
    T.label(337, 262, 'Beinn Shiantaidh', 'peak');
    T.label(266, 324, "Beinn a' Chaolais", 'peak');
    T.label(322, 176, 'Corra Bheinn', 'peak');
    T.label(364, 238, 'An Tairbeart', 'feature');
    T.label(250, 246, 'Loch Tarbert', 'water');
    T.label(143, 186, 'Loch Righ Mòr', 'water');
    T.label(170, 210, 'A\' Mhòinteach', 'feature');     // * the moss
    T.label(228, 276, 'Sgrìob na Caillich', 'feature');
    T.label(330, 70, 'Linne Dhiùra', 'water');
    T.label(312, 130, 'Coille an Ear', 'feature');        // * the east wood
  },

  cover: {
    treeline: 140, woodDensity: 0, woodSlope: 0.5, bogFlatness: 0.075, bogMax: 230, bogAmount: 0.62,
    rockline: 520, rockAmount: 0.55, cragSlope: 0.88, cragStrata: 0.22, cragJitter: 0.12, cragGap: 0.2,
    screeSlope: 0.42, screeBand: 3, screeMinH: 330, streamThreshold: 900, riverThreshold: 3200, fallDrop: 22,
    adjust(x, y, h, slope, c) {
      const d = seaDist ? seaDist[y * S0 + x] : 99;
      // oak and birch on the sheltered east shore only
      if ((c === 0 || c === 2) && x > 236 && y < 250 && d > 2 && d < 34 && h < 150 && slope < 0.5) {
        const n = islandNoise ? islandNoise.fbm(x * 0.06 + 31, y * 0.06 - 7, 3) : 0;
        if (n > -0.25 + d * 0.022) return 6;
      }
      // Scarba's cliffs over the Gulf
      if (slope > 0.55 && y > 66 && x < 140 && Math.hypot(x - 82, y - 66) < 56) return 4;
      // the old sea cliff at Uamh nan Calman stands as crag
      if (slope > 0.5 && h < 170 && Math.hypot(x - 131, y - 302) < 24) return 4;
      // the raised beaches stay open shingle and grass, never bog
      if (c === 2 && d < 14) return 0;
      return undefined;
    },
  },

  spawn: { x: 211, y: 31 },
  pois: [
    // chain 1: the moss lochan, slowly
    { id: 'loch-righ-mor', type: 'lochan', name: 'Loch Righ Mòr', x: 144, y: 192, condition: { speed: 'slow' }, hint: 'A black lochan in the moss. Come tae it canny, a slaw step.' },
    // chain 2: the cairn on the shoulder of the Paps, from above
    { id: 'carn-an-oir', type: 'cairn', name: "Càrn Gualainn an Òir", x: 284, y: 304, condition: { approach: 'descending' }, hint: "A cairn on the Pap's shouther. Come doun tae it aff the tap." },   // * name
    { id: 'clach-na-caillich', type: 'stone', name: 'Clach na Caillich', x: 206, y: 46, condition: { dwell: 4 }, hint: 'Abune the coire. Bide here an hear her washin.' },            // * name
    { id: 'glengarrisdale', type: 'bothy', name: 'Glengarrisdale', x: 150, y: 156, condition: {}, hint: 'A bothy on the wast shore. The roar comes in at nicht.' },
    { id: 'cruib', type: 'bothy', name: 'Cruib', x: 202, y: 230, condition: {}, hint: 'A bothy on Loch Tarbert. Dry wid an a door that shuts.' },
    { id: 'eas-coille', type: 'waterfall', name: 'Eas na Coille', x: 290, y: 133, condition: {}, hint: 'A burn fa in the aik wid on the lown side.' },                    // * name
    { id: 'uamh-chalman', type: 'crag', name: 'Uamh nan Calman', x: 124, y: 300, condition: {}, hint: 'Auld sea cliff abune the raised beach. Doos in the cave.' },     // * name
    { id: 'sgriob-caillich', type: 'stone', name: 'Sgrìob na Caillich', x: 214, y: 280, condition: { dwell: 3 }, hint: 'Her slide aff the Pap, stanes in raws. Staun on it a while.' },
    { id: 'trig-an-oir', type: 'trig', name: 'Beinn an Òir', x: 300, y: 292, condition: { climb: 2 }, hint: 'The Pap o gowd, heichest on the island. Twa contours up.' },
    { id: 'summit-shiantaidh', type: 'summit', name: 'Beinn Shiantaidh', x: 337, y: 262, condition: { climb: 2 }, hint: 'The holy Pap. Speel it clean.' },
    { id: 'loch-an-t-siob', type: 'lochan', name: 'Loch an t-Siob', x: 318, y: 287, condition: {}, hint: 'A lochan atween twa Paps.' },
  ],
  gate: { x: 174, y: 383, chain: ['lochan', 'cairn'], name: 'Caolas Ìle' },

  zones: [
    { id: 'shore', name: 'the shore', x: 150, y: 128, r: 40 },
    { id: 'gulf', name: 'the gulf', x: 152, y: 62, r: 64 },
    { id: 'moss', name: 'the moss', x: 164, y: 196, r: 52 },
    { id: 'eastwoods', name: 'the east woods', x: 290, y: 132, r: 46 },
    { id: 'paps', name: 'the Paps', x: 298, y: 296, r: 58 },
  ],

  look: {
    paper: 'paper',
    light: { az: 225, el: 15, strength: 1 },
    signature: ['tidalRace', 'soundings', 'shingle', 'bracken', 'seaFret', 'whirlpool', 'firstSnow'],
    tidalRace: { x: 150, y: 62, r: 15 },
    seaFret: { from: 'W' },
  },

  fieldNotes: [
    'At Samhain she washes her plaid in the coire. Ye can hear it fae the bothy at nicht.',
    'Come canny tae the moss lochan, an come doun tae the cairn.',
    'When she lifts the plaid oot it is white. She spreads it on the Paps.',
    'Three Paps, a slide o stanes, an the sea at yer back.',
  ],
  palette: { tint: '#7a8a96', accent: 'rock', paper: '#efe6cf' },
};
