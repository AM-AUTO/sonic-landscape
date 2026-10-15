# Tae Be Walkit: level design brief

> The levels are instruments first. The narrative (`docs/NARRATIVE.md`) explains why each place sounds and plays the way it does. It never replaces the playing.
> Sound stays as it is in this pass. This brief sets up the hooks (zones, routes, seasons) that the sonic round will work with.

## What is wrong now
- **Too small.** A sheet is 256 cells and crosses in about a minute at walking pace. The autopilot finishes Rannoch in 86 s. That is not a track.
- **Too clustered.** Chain legs are 28–78 cells, a few seconds of walking each. A level is one and done in one corner, and most of its topography (and so most of its instrument) is never played.
- **Too alike.** The eight sheets share one paper, one light and one cartographic treatment. Only the landforms differ, and not by much.

## Global decisions

### 1. Bigger sheets
`MAP_SIZE` goes from 256 to **384 cells**: 15.4 km at 40 m a cell, about 90 s to cross on foot. The note rate per second of walking is unchanged, so the music behaves the same. There is simply more country to play.

### 2. The chain becomes a held thread
- **The problem.** Today every chain artefact must resonate at once inside 90 s. That forces chains into small areas.
- **The change.** When a chain artefact wakes, every chain artefact still resonating has its resonance renewed. The chord is held as long as you keep adding to it.
- **The result.** Only each leg has to fit inside 90 s, not the whole chain. Legs can span the sheet, and the concord (all links ringing together) builds across the walk like a crescendo.
- **Exploration is free.** Non-chain artefacts do not renew the thread.

### 3. Explorability rules
Enforced by a design test, `tests/level-design.test.js`:

| Rule | Value |
|---|---|
| POIs per level | 10–14, including at least 2 bothies |
| Spread | each cell of a 3×3 division of the sheet holds a POI, except cells that are mostly sea |
| Gate distance from spawn | at least 230 cells |
| Chain legs (spawn→1st, link→link, last→gate) | 90–260 cells each, with an autopilot-estimated walk ≤ 75 s per leg |
| Required route (spawn → chain → gate) | at least 700 cells in all |
| Elevation range covered by the required route | at least 60% of the level's range |
| Sonic zones crossed by the required route | at least 4 of the level's zones |
| Autopilot | completes the level with the season's day length |

**Target times.** The required route takes 3–5 minutes to walk. A full exploration of the sheet takes 10+ minutes.

### 4. Sonic zones
- **What a zone is.** Each level declares 4–6 zones: named regions of the sheet with a distinct terrain character (cover, slope, altitude, water). For example: *the shore*, *the moss*, *the Paps*.
- **The route arc.** The required route is laid out as a track:
  - **intro:** low, open, quiet ground
  - **build:** rougher, steeper, wetter
  - **climax:** high or hard
  - **release:** a descent to the gate
- **Hooks for later.** Zones are data on the level (`zones: [{ id, name, x, y, r }]`). The design test uses them now, and the sonic round will give each zone its own voice later.
- **Labels.** Zone names may appear on the sheet as feature labels.

### 5. Visual distinction: five levers, all within the strict palette

| Lever | What changes per level |
|---|---|
| **Season print** | Paper colour follows the season. It runs from warm paper at Samhain to frost/snow at the solstice and back to warm cream at Bealltainn |
| **Light** | Hillshade sun azimuth and elevation follow the season: a low raking winter sun gives long, hard shadows; the high May sun gives soft relief |
| **Landform archetype** | Every sheet is a different kind of country: island coast, massif and loch, trench glen, basin moor, plateau, U-glen, horseshoe, massif ring |
| **Signature cartography** | One or two drawing features that only this sheet has: tidal race, dam, railway, frozen lochans, rock drawing, field walls |
| **Atmosphere signature** | One or two weather or light effects that only this sheet has: sea fret, cloud cap, glen inversion, snow squalls with deer, white-out and aurora, storm, clearing showers, thaw mist |

Data shape on the level: `look: { paper, light: { az, el, strength }, signature: [...] }` plus `season: { night, dawn, dusk, startTime, snowline }`. Fx keep `WEATHER[id]`.

## The eight sheets

Coordinates below are rough fractions of the sheet (0–1, x east, y south). Builders turn them into cells and adjust them to the sculpted ground.

### I. Corryvreckan & Jura · Samhain · *the teaching level*
- **Archetype:** island coast.
  - The sea fills the west and north third. Scarba is a domed island in the north-west.
  - The Gulf of Corryvreckan runs between the two islands, with the whirlpool in it.
  - Inland: north Jura, with raised-beach terraces on the west coast, bog and lochans inland, and three Paps (conical quartzite hills under scree) rising in the south-east.
- **Zones:**
  - *the shore*: raised beaches and caves
  - *the gulf*: the whirlpool's roar, a sound landmark only
  - *the moss*: interior bog and lochans
  - *the east woods*: oak and birch on the sheltered coast
  - *the Paps*
- **Route:**
  - spawn at the north tip (0.55, 0.08)
  - lochan in the moss, approached **slowly** (0.45, 0.45)
  - cairn on the shoulder of the Paps, approached **from above** (0.75, 0.75)
  - gate at the south edge (0.6, 1.0)
- **Signature cartography:**
  - tidal-race symbol and *Overfalls* in the gulf
  - blue soundings at sea
  - shingle stipple on the raised beaches
  - bracken (rust) on the hillsides, still autumn
- **Atmosphere:**
  - sea-fret banks roll in from the west
  - animated foam swirl at the whirlpool
  - wind
  - **when the gate opens, the first snow starts**
- **Season and print:** paper (warm); sun SW at 15°; night 0.55; snow line ~600 m.

### II. Ben Cruachan & Loch Awe · late November
- **Archetype:** massif and loch.
  - The Cruachan horseshoe holds a high corrie with a dammed reservoir.
  - Loch Awe runs diagonally across the south and east, with islands and a ruined castle at its north-east end.
  - The Pass of Brander is a gorge leading west to a sea loch at the west edge.
- **Zones:**
  - *the loch shore*: woods and islands
  - *the Pass*: gorge, river and falls
  - *the reservoir corrie*: dam and still water
  - *the horseshoe*: ridge, scree, snow above 850 m
  - *Glen Strae*: open moor in the north
- **Route:**
  - spawn east, at the loch head (0.9, 0.55)
  - the summit at **dusk**: cap the well (0.45, 0.2)
  - rest through the night
  - the waterfall in the Pass at **dawn** (0.12, 0.55)
  - gate west/south-west (0.0, 0.7)
- **Signature cartography:**
  - dam symbol and reservoir
  - castle (ruin) symbol on the loch
  - railway along the Pass
- **Atmosphere:** rain turning to sleet; a cloud cap sits on the summits and lifts at dawn.
- **Season and print:** paper2; sun S at 12°; night 0.60; snow line ~850 m.

### III. Glen Lyon · December
- **Archetype:** trench glen. One long, narrow glen runs west–east across the whole sheet, with steep walls and hanging side glens. Loch Lyon is at its head (west). Gleann Cailliche is a high side glen in the far west, with the stone house. The Fortingall yew stands at the glen's mouth (east). Schiehallion is a cone at the south-east edge.
- **Zones:**
  - *the glen floor*: river, walled fields, old pine
  - *the Pass of Lyon*: gorge in the east
  - *the high moor*: north
  - *Gleann Cailliche*: the stone house
  - *Loch Lyon*
- **Route:**
  - spawn at the yew, east (0.95, 0.6)
  - waterfall in the Pass, approached **from above** (0.8, 0.55)
  - the stones in Gleann Cailliche, by **dwelling** (0.1, 0.25)
  - the house (bothy type) at **dusk**, shutting them in (0.15, 0.3)
  - gate north, towards Rannoch (0.4, 0.0)
- **Signature cartography:**
  - field walls on the glen floor
  - shieling ruins
  - a ribbon of scattered-pine glyphs
  - ice on the river
- **Atmosphere:**
  - hard frost glints
  - still air and stars
  - **the glen inversion**: at dawn, cloud fills the glen floor while the tops stand clear
- **Season and print:** fog paper; sun S at 9°; night 0.63; snow line ~650 m.

### IV. Rannoch Moor & Beinn a' Bhric · midwinter
- **Archetype:** basin moor. A vast flat basin, a mosaic of lochans, a long loch to the south, ringed by distant hills. Beinn a' Bhric rises in the north-west. The railway crosses the moor.
- **Zones:**
  - *the open moor*: frozen lochans
  - *the railway*: embankment and a lonely halt
  - *Loch Laidon*
  - *the erratics*: granite boulder field
  - *Beinn a' Bhric*: deer ground
  - *Ba bothy*
- **Route:**
  - spawn south, on the old road (0.5, 0.95)
  - lochan, approached **slowly** (0.4, 0.55)
  - an erratic at **night** (0.75, 0.45)
  - cairn on Beinn a' Bhric, approached **from above** (0.2, 0.15)
  - gate north-east, towards the Cairngorms (1.0, 0.1)
- **Signature cartography:**
  - railway symbol
  - ice-filled lochans
  - boulder stipple
- **Atmosphere:** snow squalls sweep across the moor; deer silhouettes move on the skyline, far from the walker.
- **Season and print:** frost paper; sun S at 7°; night 0.66; snow line ~450 m (the moor white).

### V. The Cairngorm Plateau · the solstice
- **Archetype:** plateau. A high flat plateau cut by deep northern corries and the Lairig Ghrù trench. Loch Avon sits in a deep trough with the Shelter Stone. Glenmore pinewood lies at the north foot.
- **Zones:**
  - *the plateau*: white, featureless
  - *the northern corries*: headwalls and crags
  - *Loch Avon and the Shelter Stone*
  - *the Lairig Ghrù*: boulders
  - *Glenmore*: pinewood
  - *Ben Macdui*
- **Route:**
  - spawn north, in the pines (0.5, 0.95)
  - the summit by **climbing** (0.35, 0.4)
  - a cairn (0.7, 0.25)
  - lochan at **dawn** (0.6, 0.55)
  - gate south through the Làirig Ghrù (0.2, 1.0)
- **Signature cartography:**
  - snow everywhere above ~600 m
  - boulder-field stipple
  - the Shelter Stone symbol
- **Atmosphere:**
  - **white-out by day**: visibility closes in round the walker, so the plateau is crossed by ear
  - **the merry dancers by night**: aurora bands
  - spindrift
- **Season and print:** snow paper; sun S at 5°; night 0.70; snow line everything above ~600 m.

### VI. Glen Coe · the wolf-month
- **Archetype:** U-glen. A deep glen between walls.
  - The Aonach Eagach knife-edge forms the north wall.
  - The Three Sisters stand to the south, with the hidden Lost Valley.
  - The Buachaille guards the east end, on the edge of Rannoch.
  - Loch Leven, a sea loch, lies at the glen mouth (west).
- **Zones:**
  - *the glen floor*
  - *the Aonach Eagach*
  - *the Lost Valley*
  - *the Buachaille*
  - *Loch Leven*
  - *Sgòr nam Fiannaidh*: the Fianna's peak and Ossian's Cave
- **Route:**
  - spawn east (1.0, 0.4)
  - crag at **speed** (0.75, 0.6)
  - stone by **dwelling** (0.3, 0.35)
  - trig by **climbing** (0.5, 0.8)
  - gate west by the sea loch (0.0, 0.45)
- **Signature cartography:**
  - the heaviest crag drawing of the album
  - scree fans
  - the Lost Valley does not appear on the sheet until it has been entered
- **Atmosphere:** storm, with rain bands, lightning (existing), and a low cloud cap.
- **Season and print:** fog paper, darker relief; sun S at 10°, strong; night 0.62; snow line ~800 m.

### VII. The Cuillin · Imbolc
- **Archetype:** horseshoe.
  - The black, jagged Cuillin horseshoe rings Loch Coruisk, with Loch Scavaig and the sea to the south.
  - The Red Cuillin are rounded scree cones to the east, with Beinn na Caillich and its great cairn.
  - Glen Sligachan runs north–south between the two.
- **Zones:**
  - *the black ridge*
  - *Coruisk*: water and slabs
  - *the Red Hills*
  - *Glen Sligachan*
  - *the shore*: Camasunary
- **Route:**
  - spawn north, at Sligachan (0.5, 0.0)
  - crag at **speed** on the black ridge (0.2, 0.35)
  - cairn on Beinn na Caillich, approached **from above** (0.9, 0.3)
  - lochan at Coruisk, **slowly and while the cairn resonates** (0.35, 0.75)
  - stone by **dwelling** (0.55, 0.6)
  - gate south-east by the shore (0.85, 1.0)
- **Signature cartography:** two geologies side by side. Black gabbro is drawn as heavy rock drawing; red granite as rust-tinted scree stipple.
- **Atmosphere:** clearing showers move out to sea; low raking light; long shadows.
- **Season and print:** paper2; sun SW at 20°; night 0.50; snow line ~750 m.

### VIII. Ben Nevis · Bealltainn
- **Archetype:** massif ring.
  - The Nevis massif, with Glen Nevis wrapping round it to the south.
  - The Càrn Mòr Dearg arête and the gullied north face, still holding snow.
  - The Mamores to the south, and Loch Linnhe at the west edge.
- **Zones:**
  - *Glen Nevis and Steall*: gorge, meadow, falls
  - *the old track*: zigzags
  - *the north face*: gullies and the hut
  - *the plateau*
  - *the arête*
  - *the Mamores*
- **Route:**
  - spawn east, at the glen head (1.0, 0.75)
  - waterfall at Steall (0.75, 0.8)
  - the hut, by **dwelling** (0.55, 0.85)
  - buttress at **speed** (0.35, 0.3)
  - summit, which requires every fragment and the trig, by **climbing** (0.45, 0.4)
  - gate west, to the sea loch (0.0, 0.5)
- **Signature cartography:**
  - thaw: thick burns in spate, many falls
  - snow only in the north-facing gullies
  - green returning (wood and bog)
- **Atmosphere:** mist lifts off the glen at dawn; clear, high light.
- **Season and print:** warm paper; sun SW at 40°, soft; night 0.30; snow line ~1100 m (gullies only).

## Sound in this pass
- Unchanged.
- The new ids borrow the nearest existing profiles verbatim:
  - Corryvreckan ← Assynt
  - Cruachan ← Affric
  - Lyon ← Torridon
- The seasonal modes and the circle-of-fifths order by slot (`NARRATIVE.md`) wait for the sonic round. Until then the roots do not walk in order.
