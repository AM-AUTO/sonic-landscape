# Parked ideas

Things that were built, then taken out of the game, with enough detail to bring them back.

## Between-track story beats (parked)

**What they were.** Short illustrated interstitials between tracks:

- on first launch, a filmstrip intro of three captioned panels between the title and the tracklist;
- on the first entry to each track, one panel of that track's own skyline with an opening line;
- on track complete, a panel of a Pictish symbol stone at dawn ("THE BEALACH UNSTEEKS. n/8 SKELFS GAITHERT.") before the complete card;
- on album complete, a wide dawn over all eight ridges.

Each was a full-bleed, red, impressionistic painting made in code (sky bleeding blood, rust and ember into heather; dithered
ridges traced with contour lines), with the caption typed out a letter at a time in a dark band along the foot. ENTER completed
the caption, then advanced; ESC skipped the rest. A seen-flag in localStorage (`contours.flags.v1`) made each beat play once.
They were off under `?autopilot`, `?mute` and `?nostory`, and forced on by `?story=1`. The field-notes screen reused the same
frame over a painted bothy panel.

**Why parked.** They were never approved, and the narrative is being reworked around the Cailleach's winter (see
docs/NARRATIVE.md), so the captions and the red dusk paintings no longer fit. The field-notes screen is now a plain dark page.

**How to restore.** Last present at commit `7c23441`. The pieces:

- `src/story.js`: the `StoryQueue` (typewriter, press/skip), the seen-flags, `storiesEnabled`, and `introItems` / `trackItems` /
  `completeItems` / `albumItems`;
- `src/main.js`: `startStory` / `storyOnce`, the `'story'` screen in `handleActions`, and the calls at title confirm, `enterLevel`,
  `level-complete` and the last track's complete card;
- `src/render/panels.js`: the bothy, stone and dawn painters (`paintBothy` / `animBothy`, `paintStone` / `animStone`,
  `paintDawn` / `animDawn`) and their `PAINTERS` entries;
- `src/render/screens.js`: `LAYOUT.story`, `captionLines`, `revealLines`, `filmFrame`, `story()`, `fadeBlack`, and the old `notes()`;
- `src/render/renderer.js`: the `'story'` case;
- `src/text.js`: `STORY` (intro, per-track lines, complete, album, skip and page strings) and `TEXT.story`;
- `tests/story.test.js`: queue, flag, caption-fit and painter tests;
- `tools/verify-play.mjs`: stage 3, the story flow in a fresh browser profile; `tools/render-preview.mjs`: the story frames.

`git show 7c23441:src/story.js` and friends recover each file. New captions would come from docs/NARRATIVE.md, and the paintings
would likely want repainting to suit the current palette direction (greys and blues).
