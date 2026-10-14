/**
 * CONTOURS: every on-screen string, in one place. Pure data, no DOM.
 *
 * This is the single source of truth for UI text (the Scots rewrite). Level-specific text
 * (subtitle, place hints, field notes, map labels) lives in src/world/levels/*.js because it
 * is bound to the level's puzzle data; tests/text.test.js checks both against the font and
 * the layout, and tools/export-text.mjs dumps both as a review document.
 *
 * Conventions:
 *   {curly} words are format slots, filled with fmt().
 *   Strings shown in capitals are written in capitals here; sentences are written as shown.
 *   Data keys (dawn|day|dusk|night, trig|cairn|...) stay English; only their display words are here.
 */

/** Fill {slots} in a template. Unknown slots are left as written. */
export function fmt(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m));
}

export const ROMAN = Object.freeze(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']);

// ------------------------------------------------------------------ symbols and artefacts
/** Map label: legend, bealach stane message. */
export const TYPE_LABEL = Object.freeze({
  trig: 'TRIG PILLAR', cairn: 'CAIRN', lochan: 'LOCHAN', waterfall: 'LINN',
  bothy: 'BOTHY', stone: 'STAUNIN STANE', crag: 'CRAIG', summit: 'TAP',
});

/** Short label: HUD key bar and the sheet-map key (7 characters at most, small font). */
export const SHORT_LABEL = Object.freeze({
  trig: 'TRIG', cairn: 'CAIRN', lochan: 'LOCHAN', waterfall: 'LINN',
  bothy: 'BOTHY', stone: 'STANE', crag: 'CRAIG', summit: 'TAP',
});

/** Artefact name: banners and legend. */
export const ARTEFACT_NAMES = Object.freeze({
  trig: 'Meith', cairn: 'Rickle', lochan: 'Glisk', waterfall: 'Linn',
  bothy: 'Ingle', stone: 'Sough', crag: 'Dirl', summit: 'Lift',
});

export const TYPE_ROLE = Object.freeze({
  trig: 'survey pillar, a meith for the hale glen · ae bricht chord, held',
  cairn: 'a rickle o stanes, ilka walker adds ane · an arpeggio that bigs',
  lochan: 'still watter · a glisk like gless',
  waterfall: "fa'in watter an the pool ablow · notes drappin",
  bothy: 'stane bield, never lockit · field notes an guidance',
  stone: 'stane set upricht by haun · a laich drone',
  crag: 'craig face · a hard strike that dirls',
  summit: 'the heichest grund, unner the lift · an open chord',
});

/** Lowercase noun for a type in a sentence ("Wauken a trig pillar first"). Lowercase of the map label. */
export const TYPE_NOUN = Object.freeze({
  trig: 'trig pillar', cairn: 'cairn', lochan: 'lochan', waterfall: 'linn',
  bothy: 'bothy', stone: 'staunin stane', crag: 'craig', summit: 'tap',
});

// ------------------------------------------------------------------ conditions
/** Time-of-day words. Keys are data (dayPhase()); values are what the player reads. */
export const PHASE_WORD = Object.freeze({ dawn: 'daw', day: 'day', dusk: 'gloamin', night: 'nicht' });

/** Tags on the sheet map beside places once their condition is learned. */
export const CONDITION_TAG = Object.freeze({
  descending: 'DOUN', ascending: 'UP', slow: 'CANNY', fast: 'RIN', dwell: 'BIDE', climb: 'SPEEL',
  time: Object.freeze({ dawn: 'DAW', day: 'DAY', dusk: 'GLOAMIN', night: 'NICHT' }),
  requires: 'EFTER', unknown: '?',
});

/** Plain-language instructions (the second line of a STILL SLEEPIN banner, bothy guidance). */
export const HINT = Object.freeze({
  descending: 'Come doun tae it fae the heicher grund.',
  ascending: 'Speel up tae it fae ablow.',
  slow: 'Come at it canny: haud SPACE as ye walk.',
  fast: 'Come at it at a rin: haud SHIFT. Dounhill helps.',
  dwell: 'Staun still aside it for {n} seconds.',
  climbOne: 'Speel {n} thick contour line wi nae step doun, syne arrive.',
  climbMany: 'Speel {n} thick contour lines wi nae step doun, syne arrive.',
  time: 'Come back at {phase}. Staun still an haud SPACE tae pass the time.',
  requires: 'Wauken a {type} first; it maun still be soondin.',
  fallback: 'Somethin aboot the wey ye arrive isna richt yet.',
});

// ------------------------------------------------------------------ title and menus
export const TITLE = Object.freeze({
  masthead: 'TAE BE WALKIT',
  prompt: 'PRESS ENTER',
  promptTouch: 'TAP TO START',
  controlsKeys: 'HEIDPHONES · ARROWS/WASD GANG · SHIFT RIN · SPACE HARK · M MAP · L NOTES',
  controlsTouch: 'HEIDPHONES · TOUCH: HARL TAE GANG · BUTTONS: RIN, HARK, MAP, NOTES',
});

export const SELECT = Object.freeze({
  header: 'INDEX TAE THE TRACKS',
  headerRight: 'TAE BE WALKIT',
  locked: 'LOCKIT',
  chainHeading: 'CHAIN O YETTS',
  statusOpen: 'OPEN',
  statusDone: 'WALKIT',   // not in the review doc: borrowed from "TRACK n WALKIT"
  prompt: 'ENTER TAE GANG',
  footer: '↑↓ WALE    ENTER GANG    ESC BACK',
});

/** Pause menu: ids are what main.js acts on; labels are what the player reads. */
export const PAUSE = Object.freeze({
  heading: 'BIDE A WEE',
  items: Object.freeze([
    Object.freeze({ id: 'resume', label: 'GANG ON' }),
    Object.freeze({ id: 'notes', label: 'FIELD NOTES' }),
    Object.freeze({ id: 'map', label: 'THE SHEET' }),
    Object.freeze({ id: 'tracks', label: 'THE TRACKS' }),
  ]),
  footer: 'ESC GANG ON',
});

export const NOTES = Object.freeze({
  heading: 'FIELD NOTES',
  count: '{n} FUND',
  empty: 'Yer pooch is toom. Walkers leave notes in the bothies.',
  footer: 'ESC STEEK',
});

export const COMPLETE = Object.freeze({
  banner: 'THE BEALACH STAUNS OPEN',
  line: 'TRACK {numeral} WALKIT',
  motifCounter: 'SKELF {n}/8',
  motifDone: 'GAITHERT',
  nextHeading: 'NEIST TRACK',
  lastTrack: "AUCHT GLENS WALKIT. THE ALBUM'S DUNE.",
  prompt: 'PRESS ENTER',
});

// ------------------------------------------------------------------ story panels (filmstrip captions)
/**
 * The illustrated captions: the first-launch intro, each track's opening line, the track-complete
 * and album-complete lines. Shown in grey capitals under a painted panel (src/render/panels.js),
 * typed out a letter at a time. Track captions are keyed by level id. {n} is the skelfs gaithert.
 */
export const STORY = Object.freeze({
  intro: Object.freeze([
    'THE HIELANDS ARE AN AULD SANG, AN THE SANG WAS SCATTERED ACROSS AUCHT GLENS.',
    'A WANDERER WI NAE NAME GANGS FAE GLEN TAE GLEN, GAITHERIN THE SKELFS.',
    'EVERY BEALACH IS LOCKIT. THE LAND WILL OPEN IT FOR THEM THAT HARK.',
  ]),
  track: Object.freeze({
    rannoch: 'RANNOCH MUIR. A THOOSAND LOCHANS, AN NAE ROAD BUT THE AULD TRACK.',
    affric: 'GLEN AFFRIC. THE LAST O THE AULD FIRWID, AN THE BURN RINNIN THROUGH IT.',
    coe: 'GLEN COE. THE WALLS ARE HEICH, AN THE GLEN REMEMBERS.',
    cairngorm: 'THE HEICH GRUND. SNAW LIES IN THE CORRIES TILL AUGUST.',
    torridon: 'TORRIDON. REID SANDSTANE, A THOOSAND MILLION YEAR AULD.',
    cuillin: "THE CUILLIN. BLACK GABBRO, AN THE COMPASS DISNA TRUST IT.",
    assynt: 'ASSYNT. A LAND O KNOWES AN LOCHANS, AN SUILVEN STAUNIN ALANE.',
    nevis: "BEN NEVIS. A'THING YE'VE HEARD IS ON THIS HILL. WALK IT HAME.",
  }),
  complete: 'THE BEALACH UNSTEEKS. {n}/8 SKELFS GAITHERT.',
  album: 'AUCHT GLENS WALKIT. THE SANG IS WHOLE AGAIN.',
  dayLabel: 'DAY',
  skip: 'ENTER GANG ON   ESC SKIP',
  more: 'ENTER MAIR',
  notesFooter: '\u2191\u2193 PAIGE   ESC STEEK',
  page: '{n}/{N}',
});

// ------------------------------------------------------------------ HUD and sheet map
export const HUD = Object.freeze({
  altitude: 'HEICHT {n}m',
  gate: 'BEALACH',
  gateOpen: 'OPEN',
  here: 'HERE',
  km: '{km}KM',
  seconds: '{n}S',
  resting: 'HARKENIN',
  timeSpeed: 'TIME X8',
  touchRun: 'RIN',
  touchRest: 'HARK',
  touchStick: 'HARL',
});

export const MAP = Object.freeze({
  legend: 'LEGEND',
  bothyRow: 'FIELD NOTES',
  keyHeading: 'KEY · WAUKEN THEGITHER',
  anyType: 'ONY {type}',
  gateLine: '{name} {n}/{N}',
  gateOpen: 'OPEN',
  learned: 'KENT',
  learnedEmpty: 'NAETHING YET. ILKA MISS LEARNS YE.',
  route: "YER ROAD: THE TRACK AS YE'VE PLAYED IT",
  you: 'YE {ref}',
  scaleBar: '1 KM',
  footer: 'M/ESC STEEK',
});

// ------------------------------------------------------------------ track I introduction
export const INTRO = Object.freeze([
  'THE MAP IS THE SCORE. GANG OWER IT, AN HARK.',
  'SPEEL A BRAE AN THE TUNE SPEELS WI YE. CROSS A GRID LINE AN THE HARMONY TURNS.',
  "THE SIGNS AT THE FIT O THE SHEET ARE THE BEALACH'S KEY. WAUKEN THEM A' THEGITHER.",
  'HAUD SPACE TAE HARK. STAUN STILL AN THE HOURS GANG BY. WALK AN YER FIT GOES QUATE.',
  'BOTHIES ARE THE BLACK HUTS. WALKERS LEAVE NOTES IN THEM. THE ARROWS AT THE FIT O THE SHEET POINT TAE THE NEAREST O ILKA KEY.',
  'SHIFT: RIN.   M: THE SHEET.   L: FIELD NOTES.',
]);

// ------------------------------------------------------------------ event banners
export const BANNER = Object.freeze({
  levelStart: Object.freeze({ title: '{name}', sub: '{subtitle}' }),
  keyWoken: Object.freeze({ title: '{artefact}', sub: 'KEY {n}/{N} SOONDIN · {secs}s' }),
  notKey: Object.freeze({ title: '{artefact}', sub: "{place} · nae pairt o this bealach's key" }),
  partial: Object.freeze({ title: '{artefact} · STILL SLEEPIN' }),
  together: Object.freeze({ title: 'THEGITHER', sub: '{artefacts}' }),
  bothyNear: 'A BOTHY. THE LAST BODY THROUGH LEFT A NOTE.',
  fieldNote: 'FIELD NOTE: {note}',
  bothyGuide: 'A note preened tae the door: {place} — {plain}',
  gateStone: Object.freeze({ title: 'THE BEALACH STANE READS: {keys}', sub: 'Wauken them sae they soond thegither.' }),
  gateUnlocks: Object.freeze({ title: 'THE BEALACH UNSTEEKS', sub: '{name} — gang through it' }),
  gateOpen: 'THE BEALACH STAUNS OPEN. GANG THROUGH.',
});

/** Grouped view of everything above, for tests and tools/export-text.mjs. */
export const TEXT = Object.freeze({
  title: TITLE, select: SELECT, pause: PAUSE, notes: NOTES, complete: COMPLETE,
  hud: HUD, map: MAP, intro: INTRO, story: STORY, banner: BANNER, hint: HINT, condTag: CONDITION_TAG,
  phase: PHASE_WORD, typeLabel: TYPE_LABEL, shortLabel: SHORT_LABEL, artefact: ARTEFACT_NAMES,
  typeRole: TYPE_ROLE, typeNoun: TYPE_NOUN,
});

/** Every string in a tree, flattened to [path, string] pairs (arrays and objects walked). */
export function allStrings(node = TEXT, path = 'text') {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => allStrings(v, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => allStrings(v, `${path}.${k}`));
  return [];
}
