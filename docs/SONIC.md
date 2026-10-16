# Tae Be Walkit: sonic palette

The live, commented version is the Claude Doc "Tae Be Walkit: Sonic Palette"
(https://claude.ai/code/artifact/f62dbeae-3eac-4d8a-a84d-bf89b1b36f2b). This file records what the repo holds.

- **Grammar:** one A2+E3 drone all album; the chanter collection (low G, A B C# D E F# G, high A); the third as the
  season (none through midwinter, back at Imbolc, in the drone at the Nevis summit); one ground (ùrlar) from the
  Contour Motif A C# E B D; pibroch form driven by play (ground, three variations, transformation, return);
  ornaments as syntax (cut, doubling, E-cadence, clusters, birl); strathspey, reel and pibroch time kept distinct;
  each track placed on a Fennesz (0) to Floating Points (10) axis.
- **Grounds:** the source of truth is `GROUNDS` in `tools/write-grounds.mjs`.
  - `node tools/write-grounds.mjs` writes `out/midi/ground-*.mid` (chanter + drone tracks).
  - `node tools/sketch-grounds.mjs [--only lyon,coe,album] [--just]` writes sound sketches in the album's language:
    saturated granular bowed-string drone, low-pass-gate FM plucks, re-struck sustains, kick, sub and birl ticks.
    No reed, pipe or folk timbres (the timbre rule in the doc). Direction only, not the game's final sound.
- **Status:** awaiting answers to the album-level questions A1–A7 and per-track decisions D1–D3. `src/audio` is unchanged.
