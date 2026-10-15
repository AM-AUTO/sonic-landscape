/**
 * V. The Cairngorm Plateau (NH/NJ) — the solstice. A high, flat, white tableland, cut on the north by
 * the deep northern corries (Coire an Lochain, Coire an t-Sneachda, Coire Cas, Coire na Ciste) and on the
 * west by the trench of the Làirig Ghrù, with Braeriach's plateau beyond it. Loch Avon lies in a deep
 * trough south of Cairn Gorm, the Shelter Stone at its head; Loch Etchachan hangs in its corrie above.
 * Glenmore's pines fill the glen at the north foot.
 *
 * Native 384 sheet (designVersion 2, docs/LEVELS.md §V). Route as a track:
 *   intro    spawn in the Glenmore pines, low and sheltered
 *   build    up past the northern corries onto the plateau (white-out by day)
 *   climax   Ben Macdui by climbing; across the plateau to the great cairn of Cairn Gorm as the longest
 *            night comes down (the merry dancers); bide it oot
 *   release  Loch Etchachan at dawn, then down Glen Derry and Glen Luibeg into the Làirig Ghrù and out south
 * Names marked * are invented descriptive Gaelic, to be checked.
 */
const upCorries = [[192, 12], [198, 36], [210, 62], [222, 86], [226, 104]];                  // Glenmore up the Fiacaill
const plateauPath = [[226, 104], [206, 120], [180, 130], [158, 146], [140, 162], [134, 168]];  // the cairned path to Macdui
const toCairnGorm = [[226, 104], [244, 102], [262, 102]];
const coireRaibeirt = [[262, 102], [256, 130], [248, 162], [242, 192], [238, 208]];            // down to the head of Loch Avon
const etchachan = [[238, 208], [232, 226], [224, 242], [228, 256], [248, 288], [270, 318], [290, 344]];  // up by the lochan, down Coire Etchachan
const luibeg = [[290, 344], [250, 352], [204, 350], [160, 346], [124, 338], [96, 334], [86, 334]];  // Glen Luibeg round to Corrour
const lairig = [[68, 0], [70, 60], [74, 130], [77, 196], [80, 262], [84, 320], [86, 334], [80, 360], [78, 383]];
const chalamain = [[192, 12], [170, 38], [140, 52], [110, 62], [84, 70], [71, 72]];             // through the Chalamain Gap
const morlich = [[68, 20], [100, 16], [130, 12], [160, 10], [192, 12]];                          // Rothiemurchus to Glenmore
const ryvoan = [[192, 12], [230, 18], [270, 24], [306, 30]];
const avon = [[238, 208], [270, 202], [306, 198], [348, 196]];

/**
 * A footpath that follows the ground: a least-effort track (slope-weighted A* on the sculpted heightfield,
 * with a little noise so it wanders) between each pair of waypoints, avoiding the given water circles.
 */
function trail(T, pts, avoid = []) {
  const S = T.size, h = T.height, out = [];
  const cl = (v) => Math.max(0, Math.min(S - 1, Math.round(v)));
  for (let k = 0; k < pts.length - 1; k++) {
    const ax = cl(pts[k][0]), ay = cl(pts[k][1]), bx = cl(pts[k + 1][0]), by = cl(pts[k + 1][1]);
    const m = 22;
    const x0 = Math.max(0, Math.min(ax, bx) - m), x1 = Math.min(S - 1, Math.max(ax, bx) + m);
    const y0 = Math.max(0, Math.min(ay, by) - m), y1 = Math.min(S - 1, Math.max(ay, by) + m);
    const W = x1 - x0 + 1, H = y1 - y0 + 1, N = W * H;
    const g = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const heap = [], hf = [];
    const push = (i, f) => {
      heap.push(i); hf.push(f);
      let c = heap.length - 1;
      while (c > 0) { const pp = (c - 1) >> 1; if (hf[pp] <= hf[c]) break; [heap[pp], heap[c]] = [heap[c], heap[pp]]; [hf[pp], hf[c]] = [hf[c], hf[pp]]; c = pp; }
    };
    const pop = () => {
      const top = heap[0], li = heap.pop(), lf = hf.pop();
      if (heap.length) {
        heap[0] = li; hf[0] = lf;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let mm = c;
          if (l < heap.length && hf[l] < hf[mm]) mm = l;
          if (r < heap.length && hf[r] < hf[mm]) mm = r;
          if (mm === c) break;
          [heap[mm], heap[c]] = [heap[c], heap[mm]]; [hf[mm], hf[c]] = [hf[c], hf[mm]]; c = mm;
        }
      }
      return top;
    };
    const s0 = (ay - y0) * W + (ax - x0), goal = (by - y0) * W + (bx - x0);
    g[s0] = 0; push(s0, 0);
    while (heap.length) {
      const c = pop();
      if (done[c]) continue;
      done[c] = 1;
      if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0, hc = h[(cy + y0) * S + cx + x0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (done[n]) continue;
        const X = nx + x0, Y = ny + y0, len = dx && dy ? 1.414 : 1;
        const sl = Math.abs(h[Y * S + X] - hc) / (len * 40);
        let cost = len * (1 + 90 * sl * sl + 0.5 * (T.noise.noise2(X * 0.13 + 3.7, Y * 0.13 - 1.1) + 1));
        for (const o of avoid) if ((X - o.x) ** 2 + (Y - o.y) ** 2 < o.r * o.r) { cost += 40; break; }
        const ng = g[c] + cost;
        if (ng < g[n]) { g[n] = ng; prev[n] = c; push(n, ng + Math.hypot(bx - X, by - Y)); }
      }
    }
    const seg = [];
    for (let c = goal; c >= 0; c = prev[c]) seg.push([(c % W) + x0, ((c / W) | 0) + y0]);
    seg.reverse();
    for (let i = k ? 1 : 0; i < seg.length; i++) out.push(seg[i]);
  }
  return out.filter((q, i) => i % 3 === 0 || i === out.length - 1);
}

export default {
  id: 'cairngorm',
  index: 4,
  name: 'Cairngorm Plateau',
  gaelic: 'Am Monadh Ruadh',
  gridLetters: 'NJ',
  gridOrigin: [96, 98],
  subtitle: 'V. The Heich Grund',
  seed: 4404,
  designVersion: 2,
  contourInterval: 20,
  elevation: { min: 300, max: 1309 },

  season: { night: 0.70, dawn: 0.07, dusk: 0.07, startTime: 0.09, snowline: 600 },

  sculpt(T) {
    T.fill(860);
    T.addNoise({ scale: 110, amp: 45, octaves: 3, offset: 1 });
    T.addNoise({ scale: 42, amp: 16, octaves: 3, ridged: true, warp: 16, offset: 2 });
    T.addNoise({ scale: 14, amp: 7, octaves: 2, offset: 3 });

    // the tableland and, over the Làirig, Braeriach's
    T.plateau({ x: 205, y: 196, rx: 150, ry: 124, angle: 0.08, height: 1135, edge: 60, rough: 0.36 });
    T.plateau({ x: 300, y: 270, rx: 60, ry: 44, angle: -0.5, height: 1100, edge: 30, rough: 0.4 });   // the Beinn Mheadhoin lobe
    T.plateau({ x: 0, y: 186, rx: 62, ry: 150, height: 1165, edge: 34, rough: 0.34 });
    const onTop = (x, y, hh) => (hh > 1060 ? 1 : 0);
    T.addNoise({ scale: 44, amp: 24, octaves: 3, mask: onTop, offset: 5 });
    T.addNoise({ scale: 13, amp: 6, octaves: 2, mask: onTop, offset: 6 });
    // the tops
    T.dome({ x: 264, y: 100, radius: 24, height: 110, steep: 0.2, warp: 0.3 });   // Cairn Gorm
    T.dome({ x: 174, y: 104, radius: 16, height: 80, steep: 0.2, warp: 0.3 });    // Cairn Lochan
    T.dome({ x: 134, y: 168, radius: 32, height: 175, steep: 0.2, warp: 0.3 });   // Ben Macdui
    T.dome({ x: 304, y: 246, radius: 20, height: 60, steep: 0.6, warp: 0.4, jagged: 0.5 });   // Beinn Mheadhoin and its tors
    T.dome({ x: 190, y: 292, radius: 22, height: 40, steep: 0.3, warp: 0.3 });    // Derry Cairngorm
    T.dome({ x: 34, y: 140, radius: 26, height: 130, steep: 0.2, warp: 0.3 });    // Braeriach
    T.ridge({ points: [[120, 248, 60], [124, 286, 40], [130, 318, 10]], width: 14, sharpness: 0.8, jagged: 0.2 });   // Càrn a' Mhaim
    T.dome({ x: 118, y: 44, radius: 22, height: 300, steep: 0.1, warp: 0.3 });   // Creag a' Chalamain

    // Glen More: the broad trough at the north foot
    T.carveGlen({ points: [[-10, 22, 340], [90, 28, 326], [180, 26, 312], [270, 22, 330], [394, 16, 370]], width: 88, profile: 'U', flat: 0.14, wobble: 0.55 });
    // the Làirig Ghrù: a deep trench north to south, its summit at the Pools of Dee
    const lairigLine = [[54, 0, 420], [64, 36, 500], [80, 76, 590], [76, 112, 670], [64, 146, 750], [70, 180, 815], [80, 200, 835], [94, 228, 790], [92, 262, 720], [80, 296, 650], [84, 330, 600], [96, 356, 560], [84, 384, 520]];
    T.carveGlen({ points: lairigLine, width: 15, profile: 'U', flat: 0.2, wobble: 0.35, meander: 4 });   // the trench, narrow at the pass
    T.carveGlen({ points: lairigLine.slice(0, 6).map(([x, y, z]) => [x, y, z + 50]), width: 32, profile: 'U', flat: 0.2, wobble: 0.45, meander: 4 });   // opening north
    T.carveGlen({ points: lairigLine.slice(8).map(([x, y, z]) => [x, y, z + 40]), width: 28, profile: 'U', flat: 0.2, wobble: 0.45, meander: 4 });    // opening south
    // Loch Avon's trough
    T.carveGlen({ points: [[230, 208, 740], [260, 202, 726], [300, 197, 722], [340, 193, 700], [384, 186, 660]], width: 24, profile: 'U', flat: 0.3, wobble: 0.3 });
    // Coire Etchachan and Glen Derry, falling south-east
    T.carveGlen({ points: [[226, 252, 915], [234, 278, 810], [250, 300, 710], [272, 314, 625], [292, 334, 560], [300, 360, 515], [318, 384, 470]], width: 19, profile: 'U', flat: 0.3, wobble: 0.45, meander: 5 });
    // Glen Luibeg, round the foot of Càrn a' Mhaim into the Làirig
    T.carveGlen({ points: [[294, 352, 525], [272, 364, 552], [244, 368, 582], [212, 360, 615], [182, 344, 650], [156, 330, 680], [130, 326, 690], [108, 336, 660], [96, 340, 610]], width: 15, profile: 'U', flat: 0.25, wobble: 0.45, meander: 4 });
    // the Chalamain Gap
    T.carveGlen({ points: [[150, 50, 520], [132, 56, 560], [112, 62, 560], [92, 68, 540]], width: 6, profile: 'V', depth: 60, wobble: 0.3 });
    // the hanging corrie of Loch Etchachan, open to the south-east
    T.corrie({ x: 222, y: 238, radius: 15, depth: 190, open: Math.PI * 0.32 });
    // the northern corries, open to Glenmore
    T.corrie({ x: 168, y: 118, radius: 16, depth: 290, open: -1.85 });   // Coire an Lochain, looking north-west
    T.corrie({ x: 158, y: 110, radius: 10, depth: 190, open: -2.2 });    // its lop-sided western lobe
    T.corrie({ x: 208, y: 112, radius: 21, depth: 330, open: -1.45 });   // Coire an t-Sneachda, the big one
    T.corrie({ x: 220, y: 102, radius: 12, depth: 230, open: -1.15 });   // its eastern bay
    T.corrie({ x: 196, y: 124, radius: 9, depth: 120, open: -1.75 });    // its western bay
    T.corrie({ x: 241, y: 98, radius: 11, depth: 190, open: -1.62 });    // Coire Cas, small and high
    T.corrie({ x: 284, y: 96, radius: 13, depth: 230, open: -1.1 });     // Coire na Ciste, opening north-east
    T.corrie({ x: 296, y: 84, radius: 8, depth: 110, open: -0.9 });
    // the spurs between them (the Fiacaills) and broken headwalls
    T.ridge({ points: [[187, 112, 40], [184, 94, 34], [189, 72, 12]], width: 7, sharpness: 1, jagged: 0.6, meander: 3 });
    T.ridge({ points: [[226, 104, 36], [229, 86, 28], [226, 64, 8]], width: 6, sharpness: 1, jagged: 0.6, meander: 3 });
    T.ridge({ points: [[262, 96, 30], [264, 78, 24], [268, 56, 6]], width: 7, sharpness: 0.9, jagged: 0.5, meander: 3 });
    const northFace = (x, y) => (x > 140 && x < 320 ? Math.max(0, 1 - Math.abs(y - 100) / 34) : 0);
    T.addNoise({ scale: 9, amp: 44, octaves: 2, ridged: true, mask: northFace, offset: 9 });
    T.smooth(1);
    T.fitMax(1309, 1180);
    T.peak({ x: 134, y: 168, height: 1309, radius: 14, search: 10 });   // Ben Macdui
    T.peak({ x: 34, y: 140, height: 1296, radius: 14, search: 10 });    // Braeriach
    T.peak({ x: 264, y: 100, height: 1245, radius: 12, search: 8 });    // Cairn Gorm
    T.peak({ x: 174, y: 100, height: 1215, radius: 10, search: 8 });    // Cairn Lochan
    T.peak({ x: 304, y: 246, height: 1182, radius: 10, search: 8 });    // Beinn Mheadhoin
    T.peak({ x: 190, y: 292, height: 1155, radius: 10, search: 8 });    // Derry Cairngorm
    T.peak({ x: 118, y: 44, height: 787, radius: 10, search: 8 });      // Creag a' Chalamain
    T.clampTo(304, 1309);

    T.loch({ x: 148, y: 26, rx: 20, ry: 9, angle: 0.1, depth: 6, wobble: 0.4 });                          // Loch Morlich
    T.loch({ x: 300, y: 18, rx: 4, ry: 3, depth: 3, kind: 'lochan' });                                    // An Lochan Uaine
    T.loch({ points: [[246, 204], [274, 200], [306, 197]], width: 5.5, level: 726, depth: 22, wobble: 0.45 });  // Loch Avon
    T.loch({ x: 222, y: 242, rx: 7, ry: 5, angle: 0.5, depth: 5, kind: 'lochan' });                       // Loch Etchachan
    T.loch({ x: 172, y: 108, rx: 4, ry: 3, depth: 3, kind: 'lochan' });                                   // the corrie lochan
    T.loch({ x: 158, y: 136, rx: 2.5, ry: 2, depth: 1.5, kind: 'lochan' });                               // Lochan Buidhe
    T.loch({ x: 78, y: 200, rx: 2.5, ry: 2, depth: 1.5, kind: 'lochan' });                                // the Pools of Dee
    T.loch({ x: 79, y: 210, rx: 2.2, ry: 1.8, depth: 1.5, kind: 'lochan' });

    const water = [{ x: 148, y: 26, r: 22 }, { x: 300, y: 18, r: 5 }, { x: 222, y: 242, r: 8 }, { x: 172, y: 108, r: 5 }, ...T.avoidAlong([[246, 204], [274, 200], [306, 197]], 7)];
    for (const p of [morlich, upCorries, plateauPath, toCairnGorm, coireRaibeirt, etchachan, luibeg, lairig, chalamain, ryvoan, avon]) T.path(trail(T, p, water));

    T.label(134, 168, 'Beinn Mhic Dhuibh', 'peak');
    T.label(264, 100, 'Càrn Gorm', 'peak');
    T.label(174, 100, 'Càrn an Lochain', 'peak');
    T.label(34, 140, 'Bràigh Riabhach', 'peak');
    T.label(304, 246, 'Beinn Mheadhoin', 'peak');
    T.label(120, 300, 'Càrn a\' Mhaim', 'peak');
    T.label(208, 122, 'Coire an t-Sneachda', 'glen');
    T.label(76, 250, 'Làirig Ghrù', 'glen');
    T.label(280, 210, 'Loch A\' an', 'water');
    T.label(148, 20, 'Loch Mhùrlaig', 'water');
    T.label(222, 234, 'Loch Eiteachan', 'water');
    T.label(246, 220, 'Shelter Stone', 'feature');   // Clach Dhìon (no symbol: the POI marks it)
    T.label(200, 48, 'Gleann Mòr', 'glen');
    T.label(270, 334, 'Gleann Doire', 'glen');
  },

  cover: { treeline: 560, woodDensity: 0.55, woodMin: 300, woodSlope: 0.45, bogFlatness: 0.05, bogMax: 600, bogAmount: 0.3, snowline: 600, snowSlope: 1.0, rockline: 720, rockAmount: 0.5, cragSlope: 0.8, cragMinH: 820, cragStrata: 0.25, cragJitter: 0.14, screeMinH: 650, streamThreshold: 2000, riverThreshold: 6500, fallDrop: 30 },

  zones: [
    { id: 'glenmore', name: 'Glenmore and the pines', x: 130, y: 30, r: 70 },
    { id: 'corries', name: 'the northern corries', x: 212, y: 100, r: 42 },
    { id: 'plateau', name: 'the plateau', x: 190, y: 152, r: 50 },
    { id: 'macdui', name: 'Ben Macdui', x: 134, y: 170, r: 32 },
    { id: 'avon', name: 'Loch Avon and the Shelter Stone', x: 262, y: 206, r: 42 },
    { id: 'lairig', name: 'the Làirig Ghrù', x: 80, y: 290, r: 70 },
  ],

  spawn: { x: 68, y: 22 },
  pois: [
    // the rite: the summit by climbing, the great cairn, then wait out the longest night for the lochan at dawn
    { id: 'summit-macdui', type: 'summit', name: 'Beinn Mhic Dhuibh', x: 134, y: 168, condition: { climb: 4 }, hint: 'The heichest grund in her hills. Fower thick contours, speeled wi nae step back.' },
    { id: 'cairn-gorm', type: 'cairn', name: 'Càrn Gorm', x: 262, y: 104, condition: {}, hint: 'The great cairn on the blue hill, abune the corries. Bide there for the licht.' },
    { id: 'lochan-etchachan', type: 'lochan', name: 'Loch Eiteachan', x: 222, y: 248, condition: { time: 'dawn', requires: 'cairn' }, hint: 'Ice on the high lochan. It waukens at the daw, while the cairn rings.' },
    // the rest of the hill
    { id: 'bothy-ryvoan', type: 'bothy', name: 'Ryvoan Bothy', x: 306, y: 30, condition: {}, hint: 'A wee bothy at the heid o the pass, by the green lochan.' },
    { id: 'bothy-corrour', type: 'bothy', name: 'Corrour Bothy', x: 86, y: 334, condition: {}, hint: 'A stane bothy on the flair o the Làirig Ghrù, by the Dee.' },
    { id: 'bothy-avon', type: 'bothy', name: 'Fords of Avon Refuge', x: 348, y: 196, condition: {}, hint: 'A refuge by the fords at the fit o Loch Avon. Nae fire, but a roof.' },
    { id: 'clach-dhion', type: 'stone', name: 'Clach Dhìon', x: 238, y: 210, condition: { dwell: 4 }, hint: 'Walkers sleep unner this muckle stane. Bide aside it a while.' },
    { id: 'crag-sneachda', type: 'crag', name: 'Coire an t-Sneachda', x: 208, y: 100, condition: { speed: 'fast' }, hint: 'Corrie o the snaw. Its granite dirls whan ye come at a rin.' },
    { id: 'trig-chalamain', type: 'trig', name: 'Creag a\' Chalamain', x: 118, y: 44, condition: { climb: 2 }, hint: 'A knowe by the stane-choked gap. Twa thick contours tae the pillar.' },
    { id: 'trig-braeriach', type: 'trig', name: 'Bràigh Riabhach', x: 34, y: 140, condition: { climb: 3 }, hint: 'The brindled hill ower the Làirig. Three contours, nae step back.' },
    { id: 'trig-derry', type: 'trig', name: 'Càrn Gorm an Doire', x: 190, y: 292, condition: { climb: 1 }, hint: 'Grey boulders abune Glen Derry. Ae thick contour tae the pillar.' },
    { id: 'eas-doire', type: 'waterfall', name: 'Eas Doire', x: 262, y: 306, condition: { approach: 'descending' }, hint: 'The burn fae Etchachan faws intae Glen Derry. Come doun wi it.' },   // * Derry fall
  ],
  gate: { x: 78, y: 383, chain: ['summit', 'cairn', 'lochan'], name: 'Làirig Ghrù' },

  fieldNotes: [
    'The langest nicht o the year. Bide it oot by the cairn, an meet the sun at the lochan.',
    'Up on the plateau the white comes doun roond ye. Walk by the soond o it.',
    'On the solstice nicht the merry dancers play abune the plateau. The hill is hers mair than onywhere.',
    'Clach Dhìon, the shelterin stane. Folk hae slept unner it lang syne.',
  ],
  palette: { tint: '#8aa4c0', accent: 'ice', paper: '#eef0ea' },

  look: {
    paper: 'snow',
    light: { az: 180, el: 5, strength: 1.15 },
    signature: ['blueContoursOnSnow', 'boulders', 'whiteout', 'aurora', 'spindrift'],
    boulders: { x: 78, y: 204, r: 58 },   // the Làirig Ghrù boulder fields
  },
};
