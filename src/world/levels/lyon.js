/**
 * PLACEHOLDER for III. Glen Lyon: the old Torridon sheet under the new id, until the level is rebuilt natively at 384 (docs/LEVELS.md).
 *
 * V. Torridon (NG) — red sandstone giants above a sea loch: the terraced wall
 * of Liathach, quartzite-capped Beinn Eighe with the great corrie of Mhic
 * Fhearchair behind it, Beinn Alligin to the west.
 */
const glenRoad = [[238, 160], [220, 166], [200, 172], [178, 177], [158, 182], [140, 188], [128, 192]];
const coireDubh = [[207, 168], [210, 148], [212, 126], [214, 108], [224, 96], [230, 90]];
const bealach = [[128, 192], [134, 216], [141, 238], [148, 255]];

export default {
  id: 'lyon',
  index: 2,
  name: 'Glen Lyon',
  gaelic: 'Gleann Lìomhann',
  gridLetters: 'NG',
  gridOrigin: [86, 52],
  subtitle: 'III. The Stane Hoose',
  seed: 3003,
  authoredSize: 256, // authored on the old 256 sheet; buildWorld upsamples it
  contourInterval: 20,
  elevation: { min: 0, max: 1055 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(400);
    T.addNoise({ scale: 90, amp: 70, octaves: 3, offset: 1 });
    T.addNoise({ scale: 40, amp: 50, octaves: 3, ridged: true, warp: 18, offset: 2 });
    T.addNoise({ scale: 16, amp: 10, octaves: 3, offset: 3 });
    // the great mountains
    T.ridge({ points: [[108, 168, 440], [128, 160, 580], [148, 152, 690], [172, 146, 740], [198, 144, 700], [222, 146, 600]], width: 25, jagged: 0.45, sharpness: 0.9, height: 560 });   // Liathach
    T.ridge({ points: [[214, 118, 520], [236, 112, 610], [256, 106, 570]], width: 22, jagged: 0.4, sharpness: 0.9, height: 520 });                                      // Beinn Eighe
    T.dome({ x: 70, y: 118, rx: 40, ry: 34, angle: 0.3, height: 520, steep: 0.2, warp: 0.3, jagged: 0.5 });                                                           // Beinn Alligin
    T.dome({ x: 172, y: 144, radius: 14, height: 140, steep: 0.3 });                                                                                                    // Spidean a' Choire Léith
    T.dome({ x: 238, y: 108, radius: 14, height: 120, steep: 0.3 });                                                                                                    // Ruadh-stac Mòr
    T.dome({ x: 110, y: 236, rx: 40, ry: 28, height: 260, steep: 0.2, warp: 0.3 });                                                                                     // Applecross hills
    T.dome({ x: 214, y: 236, rx: 40, ry: 30, height: 240, steep: 0.2, warp: 0.3 });                                                                                     // Beinn Damh side
    // low country: coast and Loch Maree to the north
    T.carveGlen({ points: [[0, 238, 2], [40, 228, 4], [80, 214, 6], [115, 198, 6]], width: 36, profile: 'U', flat: 0.35, wobble: 0.5 });
    T.carveGlen({ points: [[0, 18, 120], [90, 12, 80], [180, 16, 120], [255, 20, 220]], width: 32, profile: 'U', flat: 0.3, wobble: 0.5 });
    // Glen Torridon, rising east
    T.carveGlen({ points: [[115, 197, 8], [140, 190, 30], [165, 182, 62], [195, 174, 120], [225, 166, 200], [255, 162, 270]], width: 30, profile: 'U', flat: 0.3, wobble: 0.4 });
    // Coire Dubh: the gap between Liathach and Beinn Eighe, up to Coire Mhic Fhearchair
    T.carveGlen({ points: [[207, 170, 190], [210, 150, 300], [212, 128, 360], [214, 114, 410], [217, 104, 590], [226, 92, 640], [232, 86, 650]], width: 12, profile: 'U', flat: 0.4, wobble: 0.4 });
    T.corrie({ x: 232, y: 88, radius: 15, depth: 230, open: Math.PI * 0.6 });    // Coire Mhic Fhearchair (bites in from the north face)
    T.smooth(1);
    // sandstone tiers: treads and risers on every big hill
    T.terrace({ step: 105, strength: 0.9, sharp: 0.3, mask: (x, y, hh) => { const t = (hh - 230) / 220; return t <= 0 ? 0 : t >= 1 ? 1 : t; } });
    T.smooth(2);
    T.fitMax(1055, 700);
    T.peak({ x: 172, y: 144, height: 1055, radius: 12, search: 8 });   // Spidean a' Choire Léith
    T.peak({ x: 128, y: 160, height: 1023, radius: 10, search: 8 });   // Mullach an Rathain
    T.peak({ x: 238, y: 108, height: 1010, radius: 10, search: 8 });   // Ruadh-stac Mòr
    T.peak({ x: 70, y: 118, height: 986, radius: 12, search: 8 });     // Sgùrr Mhòr, Alligin
    T.clampTo(0, 1055);
    T.loch({ x: 232, y: 92, rx: 5.5, ry: 4, angle: 0.4, level: 640, depth: 4, kind: 'lochan' });
    T.loch({ points: [[-6, 244], [30, 232], [70, 218], [100, 205], [116, 198]], width: 13, level: 0, depth: 5, sea: true, shallow: 1, wobble: 0.5 });

    T.path(glenRoad);
    T.path(coireDubh);
    T.path(bealach);
    T.path([[158, 182], [160, 168], [166, 154]]);          // up onto Liathach
    T.path([[200, 172], [196, 190], [186, 208]]);
    T.path([[128, 192], [100, 160], [84, 138]]);            // toward Alligin

    T.label(172, 144, 'Spidean a\' Choire Léith', 'peak');
    T.label(238, 108, 'Ruadh-stac Mòr', 'peak');
    T.label(70, 118, 'Beinn Alluigin', 'peak');
    T.label(148, 152, 'Liathach', 'peak');
    T.label(60, 232, 'Loch Thoirbheartain', 'water');
    T.label(232, 92, 'Coire Mhic Fhearchair', 'water');
    T.label(190, 186, 'Gleann Thoirbheartain', 'glen');
    T.label(212, 130, 'Coire Dubh', 'glen');
    T.label(240, 80, 'Beinn Eighe', 'feature');
    T.label(150, 232, 'Bealach na Bà', 'feature');
  },

  cover: { treeline: 260, woodDensity: 0.45, woodSlope: 0.45, bogFlatness: 0.08, bogMax: 300, bogAmount: 0.5, snowline: null, rockline: 640, rockAmount: 0.85, cragSlope: 0.75, cragStrata: 0.25, cragJitter: 0.14, cragGap: 0.3, screeMinH: 400, streamThreshold: 1300, riverThreshold: 3000, fallDrop: 40 },

  spawn: { x: 238, y: 160 },
  pois: [
    { id: 'eas-dubh', type: 'waterfall', name: 'Eas Coire Dhuibh', x: 216, y: 100, condition: { approach: 'descending' }, hint: 'Coire Dubh, the black corrie. Its burn cowps ower a sandstane step. Come doun.' },
    { id: 'crag-eighe', type: 'crag', name: 'Sgùrr Dubh Crags', x: 224, y: 142, condition: { speed: 'fast' }, hint: 'Sandstane a thoosand million year auld. It answers a rinnin fit.' },
    { id: 'summit-liathach', type: 'summit', name: 'Spidean a\' Choire Léith', x: 172, y: 144, condition: { climb: 3 }, hint: "Liathach's tap. Three sandstane tiers, speeled wi nae step doun." },
    { id: 'torridon-bothy', type: 'bothy', name: 'Torridon Hut', x: 130, y: 192, condition: { dwell: 3 }, hint: 'A ruif at the heid o Loch Torridon. Staun at the door a wee.' },
    { id: 'lochan-fhearchair', type: 'lochan', name: 'Coire Mhic Fhearchair', x: 232, y: 92, condition: { speed: 'slow' }, hint: 'Triple Buttress: quartzite on sandstane, doubled in the watter. Gang canny.' },
    { id: 'trig-ruadh-stac', type: 'trig', name: 'Ruadh-stac Mòr', x: 238, y: 108, condition: { climb: 2 }, hint: "Beinn Eighe's heichest tap. Twa thick contours tae the pillar." },
    { id: 'stone-alligin', type: 'stone', name: 'Clach na h-Aibhne', x: 108, y: 180, condition: { dwell: 4 }, hint: 'A stane the ice brocht doun Glen Torridon. Bide wi it.' },
    { id: 'cairn-alligin', type: 'cairn', name: 'Càrn Alluigin', x: 84, y: 140, condition: { approach: 'descending' }, hint: 'Ablow the Horns o Alligin. Come doun tae the cairn fae the rig.' },
  ],
  gate: { x: 148, y: 255, chain: ['waterfall', 'crag', 'summit', 'bothy'], name: 'Bealach na Bà' },

  fieldNotes: [
    "Watter fa's here in sandstane tiers. Meet ilka lip fae abune.",
    'Come at a rin. The reid craigs answer speed.',
    'Liathach is terraced like a stair. Coont ilka step tae the tap.',
    'At the heid o the sea loch, a ruif. Staun still at its door.',
  ],
  palette: { tint: '#a0523a', accent: 'lamp', paper: '#eddcc0' },
};
