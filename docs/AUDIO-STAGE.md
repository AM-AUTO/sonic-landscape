# Audio stage: the palette in the game, in stanzas

The sketches (`tools/sketch-grounds.mjs`, rounds 1–6) settled a sound. This stage moves it into the game engine
(`src/audio`). It also makes the music proceed in real time as continuous stanzas, like a recorded track, rather than as
events piling up. The sketch guardrails become checks on offline renders of the actual game.

## What the engine does today (from the code)
- **Bar-level time only.** The conductor has 16th/beat/bar/phrase time. It changes sections (ebb, flow, swell) on the
  next bar line, from smoothed energy with hysteresis (`src/audio/conductor.js`). There is no larger formal unit.
- **Artefact pieces start at the moment of firing** (`src/audio/artefacts.js`, `play()` at `t = now`), not on a bar.
  Splash and slide sounds are unquantised.
- **The palette is the old one:** supersaw pads, glass bells, kalimba plucks, add9 entry chords, a clean lead. The only
  worklet is the granular one; all other DSP is WaveShaper curves and JS-built buffers.

## Phase 1: stanza form (the time architecture)
- **A form layer above the bar.**
  - A *stanza* is N bars, set per level: 4 by default; 2 or 4 slow bars on pibroch tracks.
  - At each stanza downbeat the conductor commits an **arrangement state** (which layers play, and how hard):
    - drone, sub, wall, resonator pad, eroding loop, grains
    - contra A and B, kit pattern, arp lead, glimpse
- **What chooses the next state**, evaluated during the last bar of a stanza:
  - the level's pibroch form position (ground → variations → transformation → return, advanced by chain progress)
  - the player's energy averaged over the stanza just played (movement, slope, speed)
  - the sonic zone the player is in
  - the time-of-day phase
  - Drift (standing still) leans towards sparse stanzas.
- **Quantisation tiers.** Everything lands on a grid:

  | Tier | What lands there |
  | --- | --- |
  | 16th | footsteps, contour ticks, grain clicks, splash, slide (now quantised too) |
  | bar | chord or tuning changes, artefact pieces (see below) |
  | stanza | arrangement changes, section changes, zone changes, gate opening, hard cuts, glimpses |

- **Transition grammar.** When a stanza change is pending, a pickup is scheduled in its last bar: a stutter, a reverse
  swell landing on the downbeat, or a fill. Hard cuts happen only on stanza downbeats.
- **Artefacts, three steps:**
  1. A small acknowledgement on the next 16th (the player knows it fired).
  2. The piece enters on the next bar with a pickup.
  3. Its consequence for the arrangement arrives on the next stanza.
- **Checks:** conductor unit tests for stanza timing, plus an offline-render audit that counts arrangement changes off a
  stanza boundary. That count must be zero.

## Phase 2: the palette as engine voices and FX
- **New worklets:**
  - `erode`: records a send and loops it, degrading it on every pass (wow and flutter, dropouts, bit reduction, a
    closing filter, crackle).
  - `resonators`: comb or two-pole resonators excited by noise or input, retuned smoothly to targets.
- **New or reworked voices:**
  - sub plus beating, distorted drone
  - noise wall
  - scrapes
  - grain clicks (from the granular worklet)
  - crushed kit patches
  - two contra pattern layers on periods of 3 and 5 against 4
  - the gliding, skipping arp lead
  - glimpse: tines through a short erode
- **The old pretty voices** (glass bells, supersaw pads, kalimba, add9 entries) are retired or re-patched to the palette.
- **Level profiles** are rewritten to the palette:
  - each track's place on the axis, its practice and tension notes
  - the seasonal arc of the third
  - the drone treatment
  - stanza length, contra periods and zone voices

## Phase 3: score mapping in the new language
- **Walking performs the ground as resonance:** contour crossings advance the ground's pitch, and the resonators retune.
  The ground is never a clean lead.
- **Artefacts** become stanza-level arrangement events plus short pieces in the palette (no add9 pads or bell arpeggios).
- **The rest of the form:** concord locks the layers together; the gate opens a transformation stanza; walking out plays
  the return.

## Phase 4: verification
- **The sketch guardrails** run on `tools/render-audio.mjs` renders of real play: arc, crest, mono low end, noise share,
  no clean lead, contra periods, decay trend, and zero off-boundary changes. The existing checks also run: NaN, peaks,
  silence, artefact consequence, tonal centre, the parameter audit.
- **A listening WAV per level** for review, plus the real-time performance budget (node counts, worklet CPU).

## Open decisions (Sonic Palette doc, A1–A7)
Whether to keep one drone all album, just or equal tuning, whether the drone stops at the end. Phase 1 doesn't depend
on them.
