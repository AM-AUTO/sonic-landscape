# CONTOURS — Design

> *A playable album. The map is the score; the walk is the track.*

## Ethos
Eight Highland landscapes, one record. Each level is an **orchestral palette**, not a
fixed track. You play the land by walking it: contours give melody, grid squares
give harmony, slope gives rhythm, the ground underfoot gives timbre, altitude
gives space. Leave the controls alone and the level keeps breathing (Eno drift).
Move and it becomes yours.

**What binds the album:**
1. **Roots walk the circle of fifths and come home.** D → G → A → E → C → F# → E♭ → D.
2. **The Contour Motif.** A 5-note scale-degree cell, `[0, 2, 4, 1, 3]`, is transformed per level (inverted, retrograded, augmented, rotated) and heard in every artefact. On the final summit it plays whole.
3. **Fragments.** Completing a level adds its transformed motif as a faint ghost voice to every later level. The album accumulates.
4. **Shared grammar.** The same 8 artefact types and approach conditions apply in every level, so knowledge carries forward. Later levels compound conditions.
5. **Shared sound world.** Drone foundation, a soloed lead, envelope percussion and granular/reverb/delay space. Each level re-weights these, and none drops any.

## Visual language
An Ordnance Survey Landranger sheet rendered by an 8-bit console. The internal framebuffer is 384×216, integer-scaled with no smoothing. The 21-colour palette (the original 16 OS-sheet colours plus five gothic-ballad colours):

| Name | Hex | Use |
|---|---|---|
| paper | #f2ead3 | base |
| paper2 | #e6dcbc | dither/relief tint |
| contour | #b5835a | contours |
| contourIdx | #8a5a35 | index contours, labels |
| water | #9fd3e6 | water fill |
| waterDeep | #5fa8cf | deep water / shoreline |
| waterInk | #2f6fa8 | water labels, streams |
| wood | #9cc58a | woodland fill |
| woodDark | #5d8f4e | tree glyphs |
| ink | #1d1a17 | crags, symbols, text |
| magenta | #c2357e | trig, paths, rights of way |
| grid | #6fa3c9 | 1 km grid |
| snow | #ffffff | snow |
| rock | #a39d92 | scree/rock |
| bog | #7fb3a0 | marsh tufts |
| night | #20263a | night tint / UI panels |
| lamp | #e8832a | bothy windows, lantern glow |
| flame | #f4c43c | flame cores |
| bolt | #f6c8f6 | lightning |
| ice | #8ee6e6 | cross glow, frost, blown snow |
| dusk | #4b4a7a | mist and sky at dusk/night |

Map conventions:
- 10 m contours (20 m in steep levels), with an index contour every 5th, thicker and labelled in tiny pixel digits that follow the slope.
- Crags drawn as black hatching. Scree as stipple. Marsh as blue tufts. Conifers as small tree glyphs over green.
- Water: fill, deep-blue shoreline, blue streams.
- Blue 1 km grid with OS-style 2-digit edge labels, plus the 100 km square letters in the corner.
- Gaelic place names in italic-ish blue for water and upright black for summits. Spot heights shown as "· 1150".

Symbols: trig pillar (blue triangle with dot), cairn (small black pyramid), bothy (black square with roof), standing stone (black ▲ with "Standing Stone" label in old-style text), waterfall (blue bars across the stream), gate/bealach (an arch), summit (a cross with a triangle).

The player is a 12×12 hill-walker sprite in a red jacket with a 2-frame walk cycle in 4 directions, plus slide and wade poses.

**Sound made visible:**
- A crossed contour line flashes along its visible length.
- Artefacts send expanding pixel ripples that follow contour lines.
- Resonating artefacts appear as glyphs in the HUD with draining bars.
- At night the palette tints toward ink-blue and the paper darkens.

## Score mapping (score.js)

| Input | Output |
|---|---|
| contour crossing (minor) | soft Pluck/Bell tick of the mode degree for that contour index. Quantised to the next 16th; at most 1 per 16th, extras raise brightness instead |
| contour crossing (index) | **Lead** note (soloed foreground, portamento, vibrato) of the degree for index/5 within the level's lead register. Velocity follows crossing speed. Bell double an octave up |
| sustained ascent | Lead phrase continues upward, with melodic continuation via Markov when crossings pause |
| grid-square change | chord change: the square's chord (seeded hash over the weighted vocabulary). Pad and bass voice-lead into it. A major line (every 5 km) adds a crash swell |
| slope | percussion density (Euclid fill probability), kick and tom weight, granular density |
| speed | subdivision and hat probability; running doubles the hat grid |
| still > 4 s | **Drift**: pulse percussion fades, drone opens, sparse chance bells and pad swells, reverb grows. The land plays itself |
| altitude (0..1 of the level range) | drone/pad cutoff and register shift, reverb size 2 s → 14 s, delay feedback ceiling, lead octave |
| cover | texture layer and timbre: water → granular shimmer and delay; wood → rustle and plucks; bog → darker filter and longer attacks; scree → grainBurst/snap percussion and slide noise; snow → hiss and high, glassy bells; rock → metal percussion; path → steadier, cleaner pulse (fewer chance mutations) |
| heading | lead pan (east right, west left) and chord inversion |
| POI proximity (< 25 cells) | that artefact's signature layer fades in as a pre-echo, so POIs can be found by ear |
| time of day | dawn: brighter mode variant (raise a degree); night: darker (lower a degree), more delay, slower tempo |
| footsteps | a very soft texture tick, or a crunch on scree/snow; splash in water |
| fragments | each completed level's motif plays as a ghost voice every few bars |
| chance | per-step probabilities, Markov melody, pattern mutation every 4–8 bars, fills on section changes, grain spray and reverse |

### Sections (conductor)
`energy` is a smoothed value from slope, speed, artefacts and proximity, kept in 0..1.
- **ebb** (< 0.25): drone, pad, textures, sparse bells, no kick.
- **flow** (0.25–0.65): bass on, soft Euclid kit, lead active.
- **swell** (> 0.65): full kit, crashes on phrase boundaries, ride, toms, wider granular.

Hysteresis prevents flapping. Every section change gets a transition fill or swell.

## Artefacts (artefacts.js)
Each lasts 20–45 s. On trigger:
1. duck the bed by about 6 dB;
2. play a crash or swell;
3. play the piece;
4. hand over to **resonance**: a quiet, recurring motif echo for RESONANCE_SECONDS.

A partial artefact is a 4 s muffled, detuned glimpse: low-passed to ~600 Hz and a quartertone flat, with a "missing" sigh.

| Type | Name | Piece |
|---|---|---|
| trig | Triangulation | The motif as a 3-voice canon (lead, bell, pluck) entering at 1-beat offsets, panned L/C/R. Ping-pong delay at dotted-8th. Reverb blooms to 14 s. Crash on entry, timpani on the final note |
| cairn | Accretion | Each contour crossing over the next 30 s adds a held note to a growing cluster pad. Stones stack. A gong closes it |
| lochan | Reflection | Granular freeze of the last 6 s. The lead plays the motif reversed, an octave down. Grains reverse at 0.8 probability. The surface shimmers |
| waterfall | Cascade | A falling granular pitch cloud (pitch sweeps from +24 to −12 st). Filter rises, a tom roll builds into a cymbal swell and crash, then white-noise spray |
| bothy | Hearth | A warm pad in the relative major, crackle texture, a tape-wobble delay melody, and a gentle clap on 2 and 4 |
| stone | Monolith | Sub drone, the pulse stops, gong strikes every 4 s, octatonic bells in long reverb, time-dilated granular (size 0.8 s) |
| crag | Fracture | A 2× percussion break: probabilistic Euclid, snaps and grainBursts, bitcrush sweeps on the kit channel, crash accents |
| summit | Apex | Tutti. Every layer, timpani roll, ride crescendo, the key lifts a whole tone for the duration, the motif in octaves on lead and bass, reverb at maximum |

**Concord**: when two or more artefacts resonate together, their resonance motifs interlock and an extra pad voice holds their combined pitch set. When the gate chain completes, a cadence into the level's tonic sounds (crash, gong, motif augmented) and the gate opens.

## Levels

| # | id | Name | Root | Mode | BPM | Character |
|---|---|---|---|---|---|---|
| 1 | rannoch | Rannoch Moor | D | dorian | 64 | Vast and sparse. Glass bells and long lochan delays. The teaching level |
| 2 | affric | Glen Affric | G | lydian | 72 | Bright pinewood. Pluck arpeggios, shimmering water grains |
| 3 | coe | Glen Coe | A | phrygian | 76 | Dark and dramatic. Toms, gong, crashes, low saw drones |
| 4 | cairngorm | Cairngorm Plateau | E | aeolian (sus) | 56 | Arctic and glacial. Frozen granular, snow hiss, slowest pulse |
| 5 | torridon | Torridon | C | mixolydian | 68 | Monumental. Brass-like saw pads, terraced rhythm |
| 6 | cuillin | The Cuillin | F# | octatonic / lydian ♭7 | 84 | Jagged and metallic. FM rock percussion, bitcrush glitch |
| 7 | assynt | Assynt | E♭ | major pentatonic | 60 | Stillness. Minimal, the longest delays, isolated peaks |
| 8 | nevis | Ben Nevis | D | ionian → lydian at the summit | 70 | Homecoming. Every fragment, full tutti |

Gate chains (the discovery spine):

| Level | Chain | Note |
|---|---|---|
| rannoch | lochan → cairn | teaches approaching slowly and approaching from above |
| affric | waterfall → lochan → bothy | |
| coe | crag → stone → trig | crag needs speed, stone needs dwell, trig needs a climb |
| cairngorm | lochan → summit → cairn | summit by climb, lochan at dawn |
| torridon | waterfall → crag → summit → bothy | |
| cuillin | crag → trig → lochan → stone | lochan requires the trig to be resonating |
| assynt | stone → lochan → summit | stone at night, lochan slow, summit by climb |
| nevis | waterfall → bothy → crag → summit | summit requires all fragments and the trig |
