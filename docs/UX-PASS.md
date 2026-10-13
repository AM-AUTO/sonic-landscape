# UX pass: handholding through the mystery

User playtest of track I (Rannoch) found the discovery layer too opaque:
- **A.** It wasn't clear what bothies look like or why they matter.
- **B.** There were two lakeside POIs. One "only gave a message", which was a partial nobody explained. The other completed the key, and nothing said that any lochan counts.
- **C.** The second chain icon (a cairn) was unreadable, with no way to find one.
- **D.** The map remembered nothing.
- **E.** Percussion was nearly absent on flat ground.

**Principle:** keep the mystery in *how*, never in *what* or *where*. The player should always know:
- what the key is (named symbols);
- where the nearest candidate lies (a dowsing arrow);
- what a failed attempt means (an "unwoken" banner plus a plain instruction, revealed progressively);
- what they have learned (persisted on the sheet).

## 1. Game state additions (src/game/*)

`GameState` gains:
```js
knowledge: { [poiId]: { heard: int,          // partial triggers so far
                        woken: bool,          // fully triggered at least once
                        learned: string[] } },// condition keys whose plain text has been revealed
trail: [{x, y}],              // walked route: a point every ≥1.5 cells, cap 4000 (this session)
chainProgress[i]: {
  type, resonating,           // (existing)
  remaining,                  // seconds of resonance left (0 if not resonating)
  count,                      // POIs of this type on the sheet
  nearest: { poiId, name, x, y, dist, bearing } | null,   // nearest POI of this type; dist in cells, bearing = atan2(dy, dx)
}
```
`knowledge` persists in `progress.knowledge[levelId]`, so it is serialised and survives reloads. Old saves without it must still load.

`poi` event gains:
```js
plain: string[],     // plain-language instructions for the missing conditions to show NOW (may be empty)
inChain: bool,       // type is in this sheet's gate chain
keysSounding: int,   // chain types resonating after this event
keysTotal: int,      // chain length
learnedNow: string[] // condition keys newly revealed by this event
```
**Graduated reveal.** On track I (`level.index === 0`) a partial reveals all its missing conditions on the first partial. On other tracks the poetic `hint` comes first, and the plain text comes from the second partial at that POI onward.

**Bothies are guides.** When a bothy fires (full or partial), it still reveals the next field note. It also reveals the plain condition of one chain POI that isn't learned yet: the nearest un-woken POI of the first chain type not currently resonating. Emit `{type:'bothy-guide', poi, target, text}`, where `text` is e.g. "A note pinned by the door: Càrn an Tairbh — come down to it from higher ground." Mark that key learned for that target.

New events:
- `{type:'bothy-near', poi}`: once per bothy per level, when within 14 cells and that bothy hasn't fired yet.
- `{type:'gate-near', chain:[types], open:bool}`: when within 10 cells of the gate. It re-arms after the player has gone more than 20 cells away and 30 s have passed.

`src/game/describe.js` (pure, tested):
```js
describeCondition(key, cond, level) -> string   // plain English, imperative, one short sentence, names the control
// approach:descending → "Come down to it from higher ground."
// approach:ascending  → "Climb up to it from below."
// speed:slow          → "Approach slowly: hold SPACE as you walk."
// speed:fast          → "Arrive at a run: hold SHIFT, downhill helps."
// dwell:n             → "Stand still beside it for n seconds."
// climb:n             → "Climb n thick contour lines without stepping down, then arrive."
// time:<phase>        → "Return at <phase>. Stand still holding SPACE to pass time."
// requires:<type>     → "Wake a <type name> first; it must still be sounding."
conditionGlyph(key) -> short ASCII tag for the map: 'DESC','ASC','SLOW','RUN','WAIT','CLIMB','DUSK','NIGHT','DAWN','DAY','AFTER'
TYPE_LABEL: { trig:'TRIG PILLAR', cairn:'CAIRN', lochan:'LOCHAN', waterfall:'WATERFALL', bothy:'BOTHY', stone:'STANDING STONE', crag:'CRAG', summit:'SUMMIT' }
TYPE_ROLE:  { bothy:'shelter · field notes and guidance', ...one line per type: what its artefact does }
```

## 2. Messages (src/main.js)

| Event | Banner | Sub-line | Second line |
|---|---|---|---|
| partial | `messageKind:'partial'`, title `<ARTEFACT> · UNWOKEN` | the poetic hint | `messageSub2` = plain lines joined |
| full, in chain | the artefact title | `KEY n/N SOUNDING · 90s` | |
| full, not in chain | the artefact title | `<POI name> · not part of this bealach's key` | |
| bothy-near | "A BOTHY. WALKERS LEAVE NOTES IN BOTHIES." | | |
| bothy-guide | `FIELD NOTE` plus the text (queued after the note) | | |
| gate-near, closed | "THE BEALACH STONE READS: LOCHAN · CAIRN" | "Wake them so they sound together." | |
| gate-near, open | "THE BEALACH IS OPEN. WALK THROUGH." | | |

The track I intro gains a line: "BOTHIES (the black huts) KEEP FIELD NOTES. THE ARROWS AT THE FOOT OF THE SHEET POINT TO THE NEAREST OF EACH KEY."

## 3. Render (src/render/*)

**HUD chain bar.** Each chain item shows its icon and a small-caps label from TYPE_LABEL (short form ok: "LOCHAN", "CAIRN", "TRIG", "STONE"). Then:
- not resonating: an 8-direction pixel arrow toward `nearest.bearing`, plus distance in km (`dist*0.04`, one decimal);
- resonating: a draining bar and the seconds left.

The final item is the gate ("BEALACH"), with an arrow and distance to the gate. When `count > 1`, label it "ANY LOCHAN" on the map screen; that's optional on the HUD if space is tight.

**Partial banner.** `messageKind:'partial'` is a muted (contour-brown) banner: title, poetic sub, and the plain `messageSub2` in the main font, wrapped.

**Play view marks.** Woken POIs get a small persistent ink tick beside the symbol. Heard but un-woken POIs get a small '?'. These come from `state.knowledge`.

**Sheet map (M).** The left side is the map overview with:
- every POI symbol, not just discovered ones;
- state marks: '?' heard, tick woken, a pulsing ring while resonating;
- a magenta ring round POIs whose type is in the chain;
- learned condition glyphs (e.g. "SLOW") beside heard POIs;
- the player's `trail` as a dotted magenta route ("YOUR ROUTE: THE TRACK YOU HAVE PLAYED");
- the gate.

The right side is a legend panel: 8 rows of symbol, TYPE_LABEL and the artefact name in small font, with the bothy row saying "FIELD NOTES". Below it:
- "KEY:" followed by the chain names;
- "LEARNED:" with up to ~4 lines of `<poi name>: <glyphs>`.

## 4. Percussion (src/audio/*)

Energy must answer *movement*, not only slope:
- steady walking on flat ground should reach **flow** within about 4–6 s;
- running should approach swell;
- standing still decays to ebb or drift (keep the breathing).

Rannoch gets a textural moor pulse in flow: shaker, click, rim, brushed snare ghosts, soft kick, grainBurst and breath. Crashes and swells stay on major grid lines and artefacts. Every level should have audible percussion within 10 s of steady walking on flat ground.

The check in `tools/render-audio.mjs`: kit-channel RMS in flow sections must be within 18 dB of the full mix RMS on every level (use the existing stems/meters).
