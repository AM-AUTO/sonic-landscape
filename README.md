# CONTOURS

*A playable album in eight glens. The map is the score; the walk is the track.*

CONTOURS is a sonic exploration game. Each level is a Highland landscape drawn as an
Ordnance Survey sheet rendered by an 8-bit console. You walk it, and walking it plays a
generative modular-synth score. Each level is not a fixed track but an orchestral palette.
The route you take is the piece.

```
npm start            # serves on http://localhost:3000. Use headphones.
```

Requires a modern browser with Web Audio and AudioWorklet (Chrome, Edge, Firefox, Safari).
No build step and no dependencies. Plain ES modules.

## Playing

| | |
|---|---|
| **Arrows / WASD** | walk |
| **Shift** | run |
| **Space** | rest and listen (time passes ×8) |
| **M** | the full sheet |
| **L** | field notes |
| **Esc** | pause / tracklist |
| **Touch** | drag anywhere on the left to walk; buttons on the right |

Every sheet starts locked except the first. To open a sheet's **bealach** (the pass at the
map edge) you must wake its chain of sonic artefacts. The chain is shown as OS legend
symbols at the foot of the screen, and every artefact in it must be **resonating at the same
time**.

Every POI on the map (trig pillar, cairn, lochan, waterfall, bothy, standing stone, crag,
summit) wakes only if you approach it the right way. Approach it wrongly and you hear a
muffled, detuned glimpse of what it could have been. Listen to that, read your field notes,
and work out what the land wants. The game never tells you outright.

## How the land plays

| You | The music |
|---|---|
| cross a contour line | a note. Climbing plays a rising line, descending a falling one. Index contours sound the soloed lead |
| cross a 1 km grid line | the harmony turns. Each grid square owns a chord |
| walk steep ground | percussion gathers. Flat ground is near-silent |
| speed | rhythmic subdivision |
| stand still | *Drift*: the pulse falls away and the land plays itself |
| altitude | register, filter brightness, reverb size (2 s in the glen, 14 s on the tops) |
| ground underfoot | timbre: water shimmers through the granular engine, scree crunches, pine rustles, snow hisses |
| time of day | the mode brightens at dawn and darkens at night |
| near a POI | its artefact can be heard faintly before you see it |

## The album

| | Sheet | Key | Character |
|---|---|---|---|
| I | Rannoch Moor | D dorian | vast, sparse, lochan echoes |
| II | Glen Affric | G lydian | bright pinewood, falling water |
| III | Glen Coe | A phrygian | dark walls, toms and gongs |
| IV | Cairngorm Plateau | E aeolian | arctic, frozen grains |
| V | Torridon | C mixolydian | monumental sandstone terraces |
| VI | The Cuillin | F♯ lydian ♭7 | jagged gabbro, metallic glitch |
| VII | Assynt | E♭ pentatonic | stillness, isolated peaks |
| VIII | Ben Nevis | D ionian → lydian | homecoming |

The roots walk the circle of fifths and come home to D. A five-note **Contour Motif** is
transformed in every sheet. Each completed sheet leaves its fragment of the motif as a ghost
voice in every later one, so the album accumulates. On the last summit the motif plays whole.

Terrain is procedural but sculpted to each real place: the line of the glen, lochs, ridges,
corries and named summits with real Gaelic names. It is a stylisation, not survey data.

## Architecture

```
src/core      seeded RNG, noise
src/world     heightfield sculpting toolkit, hydrology, land cover, 8 level definitions
src/game      walker physics, POI conditions, resonance, gate chains, progression, autopilot, input
src/render    384×216 strict-35-colour framebuffer: OS-sheet map bake, HUD, sprites, screens, atmosphere (mist, weather, lightning, lantern light)
src/audio     modular synth backend (see below)
src/main.js   integration: fixed-step loop, menus, event feedback
```

**Audio** is raw Web Audio with one AudioWorklet:
- **engine.** Every channel has drive, bitcrush, filter, chorus, pan and three sends. Global FX are:
  - a convolution reverb from a bank of procedural impulse responses, 1.5–15 s;
  - a modulated ping-pong delay;
  - a granular processor that records the mix into a ring buffer and re-sprays it (scale-quantised, reversible, freezable).

  The master chain has glue compression, filters and a soft-clip limiter.
- **voices.** Drone, pad, bass, soloed lead (portamento, delayed vibrato), FM bells, Karplus-Strong plucks and noise textures. There is also an envelope-synthesised kit: kick, snare, 808-style metallic hats/ride/crash, toms, timpani, gong, and a modern textural set (grain bursts, snaps, breaths, reversed swells).
- **conductor / score / artefacts.** A lookahead clock driven entirely from the game loop (so it renders identically offline). The score maps game state to every parameter. The eight artefact pieces sit on top.

## Verification

```
npm test                       # unit tests: world invariants, physics, triggers, theory, score mapping
npm run verify:play            # headless Chromium: autopilot completes every sheet; menu flow with live audio; real-time perf
npm run verify:audio           # offline render of a full traversal of every sheet → out/audio/*.wav + stats + parameter audit
node tools/spectrogram.mjs     # spectrogram sheets of those renders
node tools/world-preview.mjs   # terrain previews
node tools/render-preview.mjs  # renderer screenshots
```

`verify:audio` fails on clipping, NaN, silence, artefacts without consequence, the wrong
tonal centre, or any synth parameter that never moves across the album.

Testing hooks: `index.html?level=N` jumps to a sheet, `&autopilot=1` walks the chain, and
`&speed=N` runs the simulation N× faster.
