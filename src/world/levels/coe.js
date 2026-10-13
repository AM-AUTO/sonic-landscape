/**
 * III. Glen Coe (NN) — a deep U-shaped glen: the knife-edge Aonach Eagach on the
 * north wall, the Three Sisters and Bidean nam Bian to the south, Buachaille
 * Etive Mòr standing guard at the east end where the glen climbs to Rannoch Moor.
 */
const glen = [[0, 106, 10], [40, 104, 14], [80, 102, 22], [112, 100, 50], [130, 99, 54], [150, 97, 56], [185, 98, 104], [210, 99, 170], [235, 100, 250], [255, 100, 300]];
const road = [[255, 91], [235, 92], [212, 92], [190, 91], [166, 88], [150, 88], [130, 89], [112, 91], [90, 94], [60, 98], [30, 100], [0, 101]];

export default {
  id: 'coe',
  index: 2,
  name: 'Glen Coe',
  gaelic: 'Gleann Comhann',
  gridLetters: 'NN',
  gridOrigin: [10, 51],
  subtitle: 'III. The Glen o Greetin',
  seed: 3303,
  contourInterval: 20,
  elevation: { min: 10, max: 1150 },

  sculpt(T) {
    const S = T.size, h = T.height;
    T.fill(470);
    T.addNoise({ scale: 90, amp: 80, octaves: 3, offset: 1 });
    T.addNoise({ scale: 60, amp: 95, octaves: 3, ridged: true, warp: 22, offset: 2 });
    T.addNoise({ scale: 20, amp: 14, octaves: 3, offset: 3 });
    // the Rannoch Moor shoulder lifts the east end
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += Math.max(0, x - 170) * 1.1;
    // Aonach Eagach: a long, very jagged ridge on the north wall
    T.ridge({ points: [[250, 54, 330], [220, 50, 380], [188, 48, 410], [156, 46, 380], [126, 44, 420], [96, 48, 360], [66, 56, 280]], width: 13, jagged: 0.55, sharpness: 1.4, height: 360, meander: 5 });
    // Bidean nam Bian and the Three Sisters
    T.dome({ x: 146, y: 172, rx: 40, ry: 36, angle: 0.3, height: 540, steep: 0.15, warp: 0.25, jagged: 0.45 });
    T.ridge({ points: [[100, 168, 380], [100, 142, 330], [102, 114, 290]], width: 8, jagged: 0.5, sharpness: 1.4, height: 300, meander: 4 });   // Aonach Dubh
    T.ridge({ points: [[132, 172, 400], [132, 146, 350], [133, 116, 300]], width: 8, jagged: 0.5, sharpness: 1.4, height: 300, meander: 4 });   // Gearr Aonach
    T.ridge({ points: [[178, 170, 420], [178, 144, 360], [180, 116, 310]], width: 8, jagged: 0.5, sharpness: 1.4, height: 300, meander: 4 });   // Beinn Fhada
    // Buachaille Etive Mòr: a pyramid at the east end
    T.dome({ x: 214, y: 152, rx: 28, ry: 26, height: 500, steep: 0.4, warp: 0.2, jagged: 0.35 });
    T.dome({ x: 238, y: 168, radius: 16, height: 220, steep: 0.3 });                     // Buachaille Etive Beag
    // glens north and south of the walls
    T.carveGlen({ points: [[0, 6, 120], [100, 4, 200], [255, 10, 300]], width: 34, profile: 'U', wobble: 0.5 });
    T.carveGlen({ points: [[0, 244, 100], [120, 240, 150], [255, 246, 250]], width: 34, profile: 'U', wobble: 0.5 });
    // Glen Coe itself
    T.carveGlen({ points: glen, width: 38, profile: 'U', flat: 0.26, wobble: 0.35 });
    // Coire Gabhail, the Lost Valley: a hanging corrie behind a gorge
    // Coire nan Lochan between Aonach Dubh and Gearr Aonach
    T.carveGlen({ points: [[116, 104, 130], [116, 126, 300], [117, 146, 520], [120, 164, 700]], width: 9, profile: 'V', wobble: 0.4 });
    T.carveGlen({ points: [[154, 96, 48], [154, 106, 92], [154, 114, 310], [154, 130, 372], [150, 150, 420]], width: 11, profile: 'U', flat: 0.4, wobble: 0.4 });
    T.smooth(1);
    T.fitMax(1150, 800);
    T.peak({ x: 140, y: 166, height: 1150, radius: 13, search: 12 });  // Bidean nam Bian
    T.peak({ x: 214, y: 152, height: 1022, radius: 11, search: 8 });   // Stob Dearg
    T.peak({ x: 82, y: 54, height: 967, radius: 10, search: 8 });      // Sgorr nam Fiannaidh
    T.peak({ x: 188, y: 48, height: 953, radius: 10, search: 8 });     // Meall Dearg
    // Lochan na Fola near the head of the glen
    T.loch({ x: 236, y: 108, rx: 5, ry: 3.5, angle: 0.4, level: 258, depth: 3, kind: 'lochan' });
    // Loch Achtriochtan on the floor
    T.loch({ points: [[114, 100], [132, 98.5], [150, 97]], width: 5.5, level: 55.5, depth: 20, wobble: 0.5 });
    T.clampTo(12, 1150);

    T.path(road);
    T.path([[168, 89], [160, 104], [156, 118], [154, 136], [150, 152]]);       // up the Lost Valley
    T.path([[206, 92], [206, 108], [210, 124], [212, 134]]);                  // to Lagangarbh and the Buachaille
    T.path([[238, 92], [242, 78], [238, 64], [232, 54]]);                      // the Devil's Staircase of this world

    T.label(134, 160, 'Bidean nam Bian', 'peak');
    T.label(214, 152, 'Stob Dearg', 'peak');
    T.label(188, 48, 'Aonach Eagach', 'peak');
    T.label(100, 146, 'Aonach Dubh', 'peak');
    T.label(132, 140, 'Gearr Aonach', 'peak');
    T.label(179, 142, 'Beinn Fhada', 'peak');
    T.label(132, 100, 'Loch Achtriochtan', 'water');
    T.label(236, 108, 'Lochan na Fola', 'water');
    T.label(70, 104, 'Gleann Comhann', 'glen');
    T.label(154, 124, 'Coire Gabhail', 'glen');
    T.label(80, 90, 'Abhainn Comhann', 'water');
  },

  cover: { treeline: 380, woodDensity: 0.3, woodSlope: 0.5, bogFlatness: 0.07, bogMax: 420, bogAmount: 0.5, snowline: 1100, rockline: 800, cragSlope: 0.88, cragStrata: 0.25, cragJitter: 0.16, screeMinH: 400, streamThreshold: 1500, riverThreshold: 3000, fallDrop: 40 },

  spawn: { x: 238, y: 92 },
  pois: [
    { id: 'buachaille-crag', type: 'crag', name: 'Buachaille Crags', x: 208, y: 124, condition: { speed: 'fast' }, hint: 'Rhyolite craigs. They dirl for a walker comin at a rin.' },
    { id: 'clachaig-stone', type: 'stone', name: 'Clach na h-Iolaire', x: 88, y: 98, condition: { dwell: 5 }, hint: "The earn's stane. Bide by it langer than feels richt." },
    { id: 'trig-bidean', type: 'trig', name: 'Bidean nam Bian', x: 134, y: 160, condition: { climb: 3 }, hint: 'Heichest in Argyll. Three thick contours up, nae step doun.' },
    { id: 'summit-stob-dearg', type: 'summit', name: 'Stob Dearg', x: 214, y: 152, condition: { climb: 3 }, hint: 'Reid peak o the Buachaille. Three contours, speeled clean.' },
    { id: 'lagangarbh', type: 'bothy', name: 'Lagangarbh', x: 207, y: 104, condition: {}, hint: 'A white hoose ablow the Buachaille. Reek in the win.' },
    { id: 'eas-gabhail', type: 'waterfall', name: 'Eas Coire Gabhail', x: 154, y: 112, condition: { approach: 'descending' }, hint: 'The Lost Valley hid stown kye. Its watter drops aff the lip; come doun tae it.' },
    { id: 'loch-achtriochtan', type: 'lochan', name: 'Loch Achtriochtan', x: 132, y: 93, condition: { speed: 'slow' }, hint: 'Black ablow the north wa o the Aonach Eagach. Gang canny.' },
    { id: 'lochan-fola', type: 'lochan', name: 'Lochan na Fola', x: 236, y: 108, condition: {}, hint: "Its name means bluid. The watter's clear." },
    { id: 'cairn-bodach', type: 'cairn', name: 'Am Bodach', x: 232, y: 54, condition: { approach: 'descending' }, hint: 'The auld man at the east end o the rig. Come doun ontae him.' },
  ],
  gate: { x: 0, y: 101, chain: ['crag', 'stone', 'trig'], name: 'Bealach nam Bò' },

  fieldNotes: [
    'The craig dirls for a rinner an naebody else.',
    "At the earn's stane, bide till the echo's oot the glen.",
    'Coont thick contours gaun up. Step doun an the coont sterts ower.',
    'Three Sisters o auld lava. The Lost Valley spills aff its lip.',
  ],
  palette: { tint: '#5a5a7a', paper: '#e9e0c4' },
};
