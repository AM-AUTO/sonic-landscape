/**
 * On-screen text: coverage, glyph coverage and fit.
 *
 * The words themselves belong to the author (src/text.js and the level files); these tests only
 * check that every string can be drawn (every character has a glyph) and fits the box the
 * renderer puts it in. A failure here means the layout has to give, not the words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POI_TYPES } from '../src/world/codes.js';
import { LEVELS } from '../src/world/levels/index.js';
import { buildWorld } from '../src/world/terrain.js';
import { conditionKeys } from '../src/game/pois.js';
import { describeCondition } from '../src/game/describe.js';
import { hasGlyph, measureText, wrapText } from '../src/render/font.js';
import {
  TEXT, TITLE, SELECT, PAUSE, NOTES, COMPLETE, HUD, MAP, INTRO, BANNER, HINT,
  TYPE_LABEL, SHORT_LABEL, ARTEFACT_NAMES, TYPE_ROLE, TYPE_NOUN, PHASE_WORD, CONDITION_TAG, ROMAN, allStrings, fmt,
} from '../src/text.js';
import {
  BANNER_BOX, CHAIN_W, GATE_W, DRAIN_W, STRIP_H, RESTING_W, RESTING_LABEL_X, artefactLayout, noteLayout, partialLayout, stripLayout,
} from '../src/render/hud.js';
import { LAYOUT } from '../src/render/screens.js';

const SW = 384;
const MINIMAP_LEFT = 330;                 // frame of the minimap, top right; centred banners must stop short of it
const SUBTITLES = ['I. The Muir', 'II. The Firwid', 'III. The Glen o Greetin', 'IV. The Heich Grund', 'V. The Reid Giants', 'VI. The Black Rig', 'VII. Knowe an Lochan', 'VIII. Hamecomin'];
const small = { font: 'small' };

/** Every condition key of a POI as the plain sentences the game would show (all missing at once = worst case). */
function plainOf(poi, level) { return conditionKeys(poi.condition).map((k) => describeCondition(k, poi.condition, level)); }

// ------------------------------------------------------------------ (c) coverage
test('coverage: eight types and eight tracks have every string', () => {
  assert.equal(POI_TYPES.length, 8);
  for (const t of POI_TYPES) {
    for (const [name, table] of Object.entries({ TYPE_LABEL, SHORT_LABEL, ARTEFACT_NAMES, TYPE_ROLE, TYPE_NOUN })) {
      assert.ok(typeof table[t] === 'string' && table[t].trim(), `${name}.${t}`);
    }
    assert.equal(TYPE_LABEL[t], TYPE_LABEL[t].toUpperCase(), `${t} map label is capitals`);
    assert.equal(TYPE_NOUN[t], TYPE_LABEL[t].toLowerCase(), `${t} noun is the lowercase map label`);
  }
  assert.equal(Object.keys(TYPE_LABEL).length, 8);
  for (const ph of ['dawn', 'day', 'dusk', 'night']) {
    assert.ok(PHASE_WORD[ph] && CONDITION_TAG.time[ph], ph);
    assert.equal(CONDITION_TAG.time[ph], PHASE_WORD[ph].toUpperCase(), `${ph}: tag is the capitalised word`);
  }
  assert.equal(PAUSE.items.length, 4);
  assert.equal(ROMAN.length, 8);

  assert.equal(LEVELS.length, 8);
  LEVELS.forEach((lv, i) => {
    assert.equal(lv.subtitle, SUBTITLES[i], `${lv.id} subtitle`);
    assert.ok(lv.subtitle.startsWith(ROMAN[i] + '.'), `${lv.id} subtitle carries its numeral`);
    assert.ok(lv.name && lv.gaelic && lv.gate && lv.gate.name, lv.id);
    assert.equal(lv.fieldNotes.length, 4, `${lv.id} has four field notes`);
    for (const n of lv.fieldNotes) assert.ok(typeof n === 'string' && n.trim().length > 10, `${lv.id} note`);
    assert.equal(new Set(lv.fieldNotes).size, 4, `${lv.id} notes are distinct`);
    assert.ok(lv.pois.length >= 7, lv.id);
    for (const p of lv.pois) {
      assert.ok(POI_TYPES.includes(p.type), `${p.id} type`);
      assert.ok(typeof p.hint === 'string' && p.hint.trim().length > 10, `${lv.id}/${p.id} hint`);
      assert.ok(p.name, `${p.id} name`);
    }
    for (const t of lv.gate.chain) assert.ok(lv.pois.some((p) => p.type === t), `${lv.id}: a ${t} exists for the key`);
  });
  assert.equal(LEVELS[5].gaelic, 'An Cuilthionn');
});

test('fmt fills {slots} and leaves unknown ones alone', () => {
  assert.equal(fmt('KEY {n}/{N} SOONDIN', { n: 1, N: 3 }), 'KEY 1/3 SOONDIN');
  assert.equal(fmt('{a} {b}', { a: 'x' }), 'x {b}');
  assert.equal(fmt('HEICHT {n}m', { n: 0 }), 'HEICHT 0m');
  assert.equal(fmt('plain'), 'plain');
});

test('placeholders in text.js are the ones the game fills', () => {
  const known = new Set(['n', 'N', 'secs', 'name', 'subtitle', 'artefact', 'artefacts', 'place', 'note', 'plain', 'keys', 'phase', 'type', 'numeral', 'km', 'ref']);
  for (const [path, s] of allStrings()) for (const m of s.matchAll(/\{(\w+)\}/g)) assert.ok(known.has(m[1]), `${path}: {${m[1]}}`);
  assert.deepEqual(INTRO.length, 6);
});

// ------------------------------------------------------------------ (a) glyph coverage
const worlds = LEVELS.map((lv) => buildWorld(lv));

function levelStrings() {
  const out = [];
  LEVELS.forEach((lv, i) => {
    out.push([`${lv.id}.name`, lv.name], [`${lv.id}.gaelic`, lv.gaelic], [`${lv.id}.subtitle`, lv.subtitle], [`${lv.id}.gate`, lv.gate.name]);
    for (const p of lv.pois) out.push([`${lv.id}.${p.id}.name`, p.name], [`${lv.id}.${p.id}.hint`, p.hint]);
    lv.fieldNotes.forEach((n, k) => out.push([`${lv.id}.fieldNotes[${k}]`, n]));
    for (const l of worlds[i].features.labels) out.push([`${lv.id}.label`, l.text]);
  });
  return out;
}

test('glyph coverage: every character of every string exists in both fonts', () => {
  const all = [...allStrings(), ...levelStrings()];
  assert.ok(all.length > 300);
  const missing = new Map();
  for (const [where, text] of all) {
    for (const face of ['main', 'small']) {
      // strings are drawn as written, or upper-cased (banners, labels): check both forms
      for (const ch of new Set([...text, ...text.toUpperCase()])) {
        if (!hasGlyph(ch, face)) {
          const k = `${face}:${ch} (U+${ch.codePointAt(0).toString(16).padStart(4, '0')})`;
          if (!missing.has(k)) missing.set(k, []);
          missing.get(k).push(where);
        }
      }
    }
  }
  const report = [...missing].map(([k, w]) => `${k} in ${w.slice(0, 3).join(', ')}`);
  assert.deepEqual(report, [], 'characters with no glyph; add them to src/render/font.js');
});

test('glyph coverage: the Gaelic and Scots letters the text relies on', () => {
  for (const ch of 'àèìòùÀÈÌÒÙéêÉÊ—·↑↓→') for (const face of ['main', 'small']) assert.ok(hasGlyph(ch, face), `${face} ${ch}`);
});

// ------------------------------------------------------------------ (b) fit
test('fit: note banners (intro, field notes, bothy guidance, gate) wrap within the box', () => {
  const lines = [];
  for (const s of INTRO) lines.push(['intro', s]);
  lines.push(['bothyNear', BANNER.bothyNear], ['gateOpen', BANNER.gateOpen]);
  for (const lv of LEVELS) {
    for (const n of lv.fieldNotes) lines.push([`${lv.id} field note`, fmt(BANNER.fieldNote, { note: n })]);
    for (const p of lv.pois) {
      for (const k of conditionKeys(p.condition)) {
        const plain = describeCondition(k, p.condition, lv);
        lines.push([`${lv.id}/${p.id} guide ${k}`, fmt(BANNER.fieldNote, { note: fmt(BANNER.bothyGuide, { place: p.name, plain: plain.charAt(0).toLowerCase() + plain.slice(1) }) })]);
      }
    }
  }
  const bad = [];
  for (const [where, s] of lines) {
    const L = noteLayout(s);
    if (L.lines.length > BANNER_BOX.noteLines) bad.push(`${where}: ${L.lines.length} lines > ${BANNER_BOX.noteLines}`);
    for (const l of L.shown) if (measureText(l, {}) > BANNER_BOX.noteW) bad.push(`${where}: line wider than ${BANNER_BOX.noteW}`);
    // the box is centred; it must leave the minimap corner alone
    const bw = Math.max(...L.shown.map((l) => measureText(l, {}))) + 16;
    if (SW / 2 + bw / 2 >= MINIMAP_LEFT) bad.push(`${where}: box ${bw}px reaches the minimap`);
  }
  assert.deepEqual(bad, []);
});

test('fit: STILL SLEEPIN banners show the whole hint and every plain instruction', () => {
  const bad = [];
  for (const lv of LEVELS) for (const p of lv.pois) {
    const title = fmt(BANNER.partial.title, { artefact: ARTEFACT_NAMES[p.type] });
    const L = partialLayout(title, p.hint, plainOf(p, lv).join(' '));
    const where = `${lv.id}/${p.id}`;
    if (L.poeticAll.length > BANNER_BOX.poeticLines) bad.push(`${where}: hint needs ${L.poeticAll.length} lines (max ${BANNER_BOX.poeticLines})`);
    if (L.plainAll.length > BANNER_BOX.plainLines) bad.push(`${where}: plain text needs ${L.plainAll.length} lines (max ${BANNER_BOX.plainLines})`);
    if (L.titleW + 16 > L.bw) bad.push(`${where}: title wider than box`);
    if (SW / 2 + L.bw / 2 >= MINIMAP_LEFT) bad.push(`${where}: box reaches the minimap`);
  }
  assert.deepEqual(bad, []);
});

test('fit: artefact banners (level start, key woken, together, bealach stane) fit one box', () => {
  const cases = [];
  for (const lv of LEVELS) {
    cases.push([`${lv.id} start`, fmt(BANNER.levelStart.title, { name: lv.name.toUpperCase() }), fmt(BANNER.levelStart.sub, { subtitle: lv.subtitle })]);
    cases.push([`${lv.id} unlocks`, BANNER.gateUnlocks.title, fmt(BANNER.gateUnlocks.sub, { name: lv.gate.name })]);
    const keys = lv.gate.chain.map((t) => TYPE_LABEL[t]).join(' · ');
    cases.push([`${lv.id} stane`, fmt(BANNER.gateStone.title, { keys }), BANNER.gateStone.sub]);
    for (const p of lv.pois) {
      cases.push([`${lv.id}/${p.id} key`, ARTEFACT_NAMES[p.type], fmt(BANNER.keyWoken.sub, { n: lv.gate.chain.length, N: lv.gate.chain.length, secs: 90 })]);
      cases.push([`${lv.id}/${p.id} notKey`, ARTEFACT_NAMES[p.type], fmt(BANNER.notKey.sub, { place: p.name })]);
    }
  }
  cases.push(['together (all eight)', BANNER.together.title, fmt(BANNER.together.sub, { artefacts: POI_TYPES.map((t) => ARTEFACT_NAMES[t]).join(' · ') })]);
  const bad = [];
  for (const [where, title, sub] of cases) {
    const L = artefactLayout(title, sub);
    if (L.bw > BANNER_BOX.artefactMax) bad.push(`${where}: box ${L.bw}px > ${BANNER_BOX.artefactMax}`);
    if (L.lines.length > 3) bad.push(`${where}: title needs ${L.lines.length} lines`);
    if (L.subLinesAll.length > BANNER_BOX.artefactSubLines) bad.push(`${where}: sub-line needs ${L.subLinesAll.length} lines`);
    if (SW / 2 + L.bw / 2 >= MINIMAP_LEFT) bad.push(`${where}: box reaches the minimap`);
    for (const l of L.lines) if (measureText(l, { spacing: L.spacing }) > BANNER_BOX.artefactMax - 28) bad.push(`${where}: title line too wide`);
  }
  assert.deepEqual(bad, []);
});

test('fit: HUD key bar (short labels, km, seconds, bealach cell)', () => {
  // scroll layout: a cell is CHAIN_W wide; the label is centred under the icon, and row three holds the km or the seconds bar
  const bad = [];
  for (const t of POI_TYPES) {
    const s = SHORT_LABEL[t];
    if (s.length > 7) bad.push(`${t}: short label "${s}" is ${s.length} chars (max 7)`);
    if (measureText(s, small) > CHAIN_W) bad.push(`${t}: "${s}" ${measureText(s, small)}px > ${CHAIN_W}`);
  }
  if (measureText(HUD.gate, small) > GATE_W) bad.push(`BEALACH ${measureText(HUD.gate, small)}px > ${GATE_W}`);
  if (measureText(HUD.gateOpen, small) > GATE_W) bad.push('OPEN too wide');
  for (const s of [HUD.here, fmt(HUD.km, { km: '9.9' }), fmt(HUD.km, { km: '10.2' })]) {
    if (measureText(s, small) > CHAIN_W) bad.push(`"${s}" overflows the cell`);
    if (measureText(s, small) > GATE_W) bad.push(`"${s}" overflows the bealach cell`);
  }
  // drain bar: framed bar at +1, label 3 px after it
  if (1 + DRAIN_W + 1 + 3 + measureText(fmt(HUD.seconds, { n: 90 }), small) > CHAIN_W) bad.push('seconds label overflows the cell');
  assert.deepEqual(bad, []);
});

test('fit: HUD top strip shows all four items for every level (desktop width)', () => {
  const bad = [];
  LEVELS.forEach((lv, i) => {
    const w = worlds[i];
    const st = { world: w, level: lv, player: { x: 120, y: 120, heading: 0, elevation: lv.elevation.max } };
    const L = stripLayout(st, null);
    if (L.use.length < 4) bad.push(`${lv.id}: strip drops ${['ref', 'alt', 'brg', 'time'].filter((k) => !L.use.includes(k))} (needs ${L.widths.ref + L.widths.alt + L.widths.brg + L.widths.time + 24}px of ${L.rEnd - L.limit})`);
  });
  assert.deepEqual(bad, []);
  assert.ok(STRIP_H > 0);
});

test('fit: resting panel and touch captions', () => {
  const lab = measureText(HUD.resting, small);
  // the dots are single pixels, one glyph advance apart; the last must clear the ear tick at panel width - 5
  const lastDot = RESTING_LABEL_X + lab + 1 + 2 * 4 + 1;
  assert.ok(lastDot < RESTING_W - 6, `HARKENIN dots end at ${lastDot} of ${RESTING_W - 6}`);
  assert.ok(RESTING_LABEL_X + measureText(HUD.timeSpeed, small) <= RESTING_W - 6, 'TIME X8');
  // touch captions are guarded in code (hidden when the button is too narrow); they must at least fit a 44 px-ish button
  for (const s of [HUD.touchRun, HUD.touchRest]) assert.ok(measureText(s, small) <= 20, s);
});

test('fit: title cover', () => {
  const band = SW - 24;
  const mast = measureText(TITLE.masthead, { scale: 4, spacing: 1 });
  const bad = [];
  const mastL = SW / 2 - mast / 2, mastR = SW / 2 + mast / 2;
  TITLE.cornerLeft.forEach((s) => { const e = 12 + measureText(s, small); if (e > mastL - 8) bad.push(`left corner "${s}" ends ${e} vs masthead ${mastL}`); });
  TITLE.cornerRight.forEach((s) => { const b = SW - 12 - measureText(s, small); if (b < mastR + 8) bad.push(`right corner "${s}" starts ${b} vs masthead ${mastR}`); });
  if (measureText(TITLE.subtitle, { italic: true, spacing: 1 }) > band) bad.push('subtitle');
  if (measureText(TITLE.prompt, { spacing: 1 }) + 40 > band) bad.push('prompt');
  for (const s of [TITLE.controlsKeys, TITLE.controlsTouch]) if (measureText(s, small) > band) bad.push(`controls ${measureText(s, small)}px`);
  if (measureText(TITLE.strapline, { ...small, spacing: 1 }) > band) bad.push('strapline');
  assert.deepEqual(bad, []);
});

test('fit: tracklist rows, side panel and footer', () => {
  const S = LAYOUT.select, bad = [];
  const gx = S.x0 + S.lw - 26;
  for (const lv of LEVELS) {
    const nameEnd = S.x0 + S.nameX + measureText(lv.name.toUpperCase(), { spacing: 1 });
    if (nameEnd > gx - 14) bad.push(`${lv.id}: name ends ${nameEnd} (padlock at ${gx - 12})`);
    const gaEnd = S.x0 + S.nameX + measureText(lv.gaelic, { ...small, italic: true });
    if (gaEnd > gx - 14) bad.push(`${lv.id}: gaelic ends ${gaEnd}`);
    // right panel: subtitle falls back from main to small, then must fit
    const sub = lv.subtitle.toUpperCase();
    if (measureText(sub, { ...small, spacing: 1 }) > S.panelW - 8) bad.push(`${lv.id}: subtitle too wide even in small`);
    if (measureText(lv.name.toUpperCase(), { ...small, spacing: 1 }) > S.panelW - 8) bad.push(`${lv.id}: panel name`);
  }
  for (const s of [SELECT.locked, SELECT.statusOpen, SELECT.statusDone, SELECT.prompt]) if (measureText(s, { ...small, spacing: 1 }) > S.panelW - 20) bad.push(`panel "${s}"`);
  if (measureText(SELECT.chainHeading, { ...small, spacing: 1 }) > S.panelW - 20) bad.push('chain heading');
  if (measureText(SELECT.locked, small) > 34) bad.push('LOCKIT inside the padlock plate');
  if (measureText(SELECT.footer, { ...small, spacing: 1 }) > SW - 16) bad.push('footer');
  const header = 8 + measureText(SELECT.header, { spacing: 1 }), headerR = SW - 8 - measureText(SELECT.headerRight, { ...small, spacing: 1 });
  if (header > headerR - 6) bad.push('header and right header collide');
  assert.deepEqual(bad, []);
});

test('fit: pause menu', () => {
  const P = LAYOUT.pause, bad = [];
  if (measureText(PAUSE.heading, { spacing: 4 }) > P.w - 12) bad.push('heading');
  for (const it of PAUSE.items) if (P.itemX + measureText(it.label, { spacing: 1 }) > P.w - 10) bad.push(it.label);
  if (measureText(PAUSE.footer, { ...small, spacing: 1 }) > P.w - 10) bad.push('footer');
  assert.deepEqual(bad, []);
});

test('fit: field notes screen', () => {
  const w = SW - 60, maxW = w - 48 - 10;
  assert.ok(wrapText(NOTES.empty, maxW, { italic: true }).length <= 4, 'empty state');
  assert.ok(30 + measureText(NOTES.heading, { spacing: 2 }) + measureText(fmt(NOTES.count, { n: 99 }), { ...small, spacing: 1 }) + 16 < w, 'heading and count');
  assert.ok(measureText(NOTES.footer, { ...small, spacing: 1 }) < w);
  // the longest field note, as wrapped on the page, must stay a few lines (it scrolls, but should not sprawl)
  for (const lv of LEVELS) for (const n of lv.fieldNotes) assert.ok(wrapText(n, maxW, { italic: true }).length <= 3, `${lv.id}: ${n}`);
});

test('fit: track complete card', () => {
  const w = LAYOUT.complete.w, bad = [];
  const lines = wrapText(COMPLETE.banner, (w - 24) / 2, { spacing: 2 });
  if (lines.length > 2) bad.push(`banner needs ${lines.length} lines`);
  for (const l of lines) if (measureText(l, { scale: 2, spacing: 2 }) > w - 16) bad.push(`banner line "${l}"`);
  if (wrapText(COMPLETE.lastTrack, w - 20, { spacing: 1 }).length > 2) bad.push('last track line');
  for (let i = 0; i < LEVELS.length; i++) {
    const line = fmt(COMPLETE.line, { numeral: ROMAN[i] });
    if (measureText(line, { spacing: 1 }) > w - 16) bad.push(`line ${i}`);
    const lv = LEVELS[i];
    if (measureText(lv.subtitle.toUpperCase(), { ...small, spacing: 1 }) > w - 16) bad.push(`${lv.id} subtitle`);
    const nxt = LEVELS[i + 1];
    if (nxt) {
      const used = 10 + measureText(nxt.name.toUpperCase(), { spacing: 1 }) + 8 + measureText(nxt.subtitle.toUpperCase(), { ...small, spacing: 1 }) + 10;
      if (used > w) bad.push(`next track row ${nxt.id}: ${used} of ${w}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('fit: sheet map side panel (legend, key, gate, learned, footer)', () => {
  const M = LAYOUT.map, bad = [];
  const right = M.ix0 + M.iw;                                   // right text edge
  for (const t of POI_TYPES) {
    if (measureText(TYPE_LABEL[t], small) > M.nameX - M.labelX - 2) bad.push(`legend label ${t}`);
    const nm = t === 'bothy' ? MAP.bothyRow : ARTEFACT_NAMES[t].toUpperCase();
    if (M.ix0 + M.nameX + measureText(nm, small) > right) bad.push(`legend artefact ${t}`);
  }
  const [kw, ...kr] = MAP.keyHeading.split(' ');
  if (measureText(kw, { ...small, spacing: 1 }) + 4 + measureText(kr.join(' '), small) > M.iw) bad.push('key heading');
  for (const t of POI_TYPES) {
    const label = fmt(MAP.anyType, { type: SHORT_LABEL[t] });
    if (12 + measureText(label, small) + 1 > M.iw) bad.push(`key cell ${label}`);
  }
  for (const lv of LEVELS) {
    const left = 12 + measureText(lv.gate.name.toUpperCase(), small);
    const stat = measureText(`${lv.gate.chain.length}/${lv.gate.chain.length}`, small);
    if (left + 4 + stat > M.iw) bad.push(`gate line ${lv.id}`);
    if (left + 4 + measureText(MAP.gateOpen, small) > M.iw) bad.push(`gate line open ${lv.id}`);
    // name + gaelic + subtitle share the header; the code drops to two lines when they collide, then each must fit
    if (measureText(lv.subtitle.toUpperCase(), small) > M.iw) bad.push(`${lv.id}: map subtitle`);
    if (measureText(lv.gaelic, small) > M.iw) bad.push(`${lv.id}: map gaelic`);
    if (measureText(lv.name.toUpperCase(), { spacing: 1 }) > M.iw) bad.push(`${lv.id}: map name`);
  }
  if (wrapText(MAP.learnedEmpty, M.iw, small).length > 2) bad.push('learned empty');
  if (wrapText(MAP.route, M.iw - 16, small).length > 2) bad.push('route legend');
  if (measureText(MAP.learned, { ...small, spacing: 1 }) > M.iw) bad.push('KENT');
  // footer row: scale bar text (about 18 px bar) on the left, close hint on the right
  const barEnd = M.ix0 + 18 + 4 + measureText(MAP.scaleBar, small);
  const closeStart = right - measureText(MAP.footer, small);
  if (barEnd > closeStart - 4) bad.push(`scale bar and footer collide (${barEnd} vs ${closeStart})`);
  // YE {ref} and the altitude share a line
  const you = measureText(fmt(MAP.you, { ref: 'NN 999 999' }), small) + measureText('1345M', small);
  if (you + 6 > M.iw) bad.push('YE ref and altitude');
  assert.deepEqual(bad, []);
});

test('fit: plain hints stay one short sentence', () => {
  const samples = [];
  for (const lv of LEVELS) for (const p of lv.pois) for (const k of conditionKeys(p.condition)) samples.push(describeCondition(k, p.condition, lv));
  samples.push(HINT.fallback);
  for (const s of samples) assert.ok(s.endsWith('.') && s.length < 90, s);
  // the whole text tree is reachable for the review export
  assert.ok(Object.keys(TEXT).length > 10);
});
