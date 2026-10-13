# CONTOURS — Module Contracts

The authoritative interface spec. Every module must conform exactly. All code is
vanilla ES modules (`import`/`export`), no dependencies, no build step. Code
that doesn't touch the DOM or Web Audio must run in Node 22 (tests use
`node --test`). Shared constants live in `src/world/codes.js`; seeded randomness in
`src/core/rng.js` (`mulberry32`, `hash2`, `hash2f`, `Rng`). Never use
`Math.random()` in world generation; audio "chance" uses an `Rng` seeded per
session.

Coordinates: **cells**. The map is `MAP_SIZE`×`MAP_SIZE` (256²) cells, each
`CELL_METERS` (40 m). x grows east, y grows south (screen convention). North is up.
Heights in **meters**. Speeds in **cells/second**. Slope is dimensionless
(rise/run, both meters).

---------------------------------------------------------------------------

## 1. World  (`src/world/*`, `src/core/noise.js`)

```js
// src/world/terrain.js
export function buildWorld(levelDef) -> World
```

`World`:
```js
{
  level: LevelDef,
  size: 256, cellMeters: 40,
  height: Float32Array(size*size),      // meters, index y*size+x
  cover:  Uint8Array(size*size),        // COVER codes
  stream: Uint8Array(size*size),        // 1 where a burn/river flows (also cover SHALLOW where wide)
  contourInterval: number,              // meters (levelDef.contourInterval, 10 or 20)
  minH, maxH,                           // actual range
  pois: ResolvedPOI[],                  // levelDef.pois with {elevation} added, positions snapped to passable cells
  gate: { x, y, chain:[types], name, side:'N'|'E'|'S'|'W' },
  spawn: { x, y },
  features: {
    waterfalls: [{x,y}],                // stream cells on steep drops (render symbol)
    spotHeights: [{x,y,h}],             // local maxima for labels
    labels: [{x,y,text,kind:'peak'|'water'|'glen'|'feature'}],   // Gaelic names rendered on map
    paths: [[{x,y},...], ...],          // polylines (also burned into cover as PATH)
  },
  heightAt(x, y),     // bilinear, float cell coords, clamps to edge
  gradientAt(x, y),   // -> {gx, gy} dimensionless slope components (dh/dx_m, dh/dy_m)
  slopeAt(x, y),      // magnitude of gradient
  coverAt(x, y),      // COVER code of containing cell (floor), out-of-bounds -> CRAG
  passable(x, y),     // false for CRAG, DEEP, out-of-bounds (except an *open* gate handled by game)
}
```

Invariants (tested):
- deterministic for a given levelDef (same seed → identical arrays);
- every POI, the spawn and the gate lie on passable cells, and are mutually reachable
  through passable 8-connected cells;
- no NaN; heights within [levelDef.elevation.min - 5, levelDef.elevation.max + 5];
- POIs of type `lochan` sit on the shore of a water body (adjacent within 2 cells),
  `waterfall` next to a stream on a steep drop, `crag` adjacent to CRAG cells,
  `summit`/`trig` at local high points, `bothy` on low/flat ground near a path.

### LevelDef  (`src/world/levels/<id>.js`, default export; `src/world/levels/index.js` exports `LEVELS` array in album order)
```js
{
  id: 'rannoch',                 // rannoch | affric | coe | cairngorm | torridon | cuillin | assynt | nevis
  index: 0,
  name: 'Rannoch Moor',
  gaelic: 'Mòinteach Raineach',
  gridLetters: 'NN',             // OS 100km square letters for grid labels
  gridOrigin: [32, 51],          // km easting/northing of map's NW corner within that square (labels only)
  subtitle: 'I. The Moor',       // album track title
  seed: 1101,
  contourInterval: 10,
  elevation: { min: 290, max: 640 },
  sculpt: (T) => void,           // T = sculpt toolkit (see below), builds the heightfield
  cover: { treeline: 450, woodDensity: 0.3, bogFlatness: 0.04, snowline: null, ... }, // landcover params
  spawn: { x, y },
  pois: [ { id, type, name, x, y, condition: Condition, hint?: string } ],
  gate: { x, y, chain: ['lochan','cairn'], name: 'Bealach ...' },
  fieldNotes: [ 'cryptic hint string', ... ],
  palette: { tint: '#...', paper: '#...' },   // optional per-level tint
}
```

### Condition (how a POI must be approached to fire its full artefact)
All fields optional. A POI fires when the player is within **3 cells**.
```js
{
  approach: 'descending' | 'ascending' | 'any',  // sign of mean vertical velocity over the last 2 s
  speed: 'slow' | 'fast' | 'any',                // slow: < 2.2 cells/s on arrival; fast: > 6 cells/s
  dwell: 0,                                      // seconds standing still (< 0.3 cells/s) within radius
  climb: 0,                                      // index contours crossed upward without an index crossing downward in between
  time: null | 'dawn' | 'day' | 'dusk' | 'night',
  requires: null | <poi type>,                   // that artefact must be resonating
}
```
`quality` = met conditions / total conditions (an empty condition always gives 1).
Full trigger when quality == 1, partial otherwise. Partial artefacts are short,
muffled and detuned, so the player hears they are close. POI cooldown is 20 s after
a full trigger and 6 s after a partial.

### Sculpt toolkit `T` (passed to `levelDef.sculpt`)
`terrain.js` provides it. Primitives operate on the height array in place and compose:
```js
T.size, T.rng (Rng), T.noise  // {fbm(x,y,oct,lac,gain), ridged(x,y,oct), warp(x,y,amt)}
T.fill(h)                             // set base height
T.addNoise({scale, amp, octaves, ridged?, warp?, mask?})
T.carveGlen({points:[[x,y],...], width, depth, floor, profile:'U'|'V'})  // along a polyline
T.ridge({points, width, height, sharpness, jagged})                      // raised spine
T.dome({x, y, radius, height, steep})                                    // inselberg / summit
T.plateau({x, y, rx, ry, height, edge})                                  // flat-topped high ground
T.corrie({x, y, radius, depth, open: angleRad})                          // bowl biting into a slope, open toward angle
T.loch({points | x,y,rx,ry, level, depth})                               // basin flooded to a level → water
T.lochans({count, area:{x0,y0,x1,y1}, rmin, rmax})                       // many small water bodies (Rannoch, Assynt)
T.terrace({step, strength, mask?})                                       // Torridon sandstone steps
T.path(points)                                                           // registers a footpath polyline
T.label(x, y, text, kind)
T.smooth(passes)
T.clampTo(min, max)
```
Water is decided after sculpting: cells inside a declared loch/lochan at or below its
level become DEEP, or SHALLOW within 1–2 cells of the shore. Streams come from D8 flow
accumulation (`hydro.js`) and empty into lochs or off the map edge.

---------------------------------------------------------------------------

## 2. Game simulation  (`src/game/*`) — pure, no DOM, runs in Node

```js
// src/game/sim.js
export class Game {
  constructor({ levels, progress? })  // progress: {unlocked:[ids], completed:[ids], fragments:[ids], notes:[...]}
  loadLevel(index)                    // builds world (buildWorld), places player at spawn
  step(input, dt)                     // input: {x:-1..1, y:-1..1, run:bool, rest:bool}; dt fixed 1/60
  state                               // GameState (below), updated each step
  world, level, progress
}
```

`GameState` (read by audio `update()` and renderer `draw()`):
```js
{
  t, dt,
  levelIndex, level, world,
  player: {
    x, y, vx, vy,            // cells, cells/s
    speed,                   // cells/s
    heading,                 // radians, 0 = east, π/2 = south (atan2(vy,vx)); retains last when stopped
    elevation,               // m
    vz,                      // m/s vertical velocity (smoothed)
    slope,                   // dimensionless, under player
    cover,                   // COVER code under player
    moving,                  // speed > 0.3
    still,                   // seconds continuously not moving
    running, resting,
    sliding,                 // on scree and moving downhill faster than intended
    contourIndex,            // floor(elevation / contourInterval)
  },
  timeOfDay,                 // [0,1), advances 1/DAY_SECONDS per s (×8 while resting)
  phase,                     // dayPhase(timeOfDay)
  events: Event[],           // emitted during the LAST step only (cleared each step)
  proximity: [{ poi, dist }],// up to 3 nearest POIs, dist in cells, sorted
  resonance: [{ poiId, type, t0, strength }], // active full artefacts; strength 1→0 over RESONANCE_SECONDS
  gateOpen: bool,
  chainProgress: [{type, resonating:bool}],   // for the gate chain, in order
  fragments: [levelIds],     // album motif fragments collected (completed levels)
  discovered: [poiIds],      // POIs fully triggered at least once in this level
  levelComplete: bool,
}
```

`Event` types:
```js
{ type:'contour', dir:+1|-1, index, major:bool, elevation, speed }   // major = index contour (every 5th)
{ type:'grid', axis:'x'|'y', line, gx, gy, major:bool }                // gx,gy = new 1km square; major = line%5==0
{ type:'cover', from, to }
{ type:'poi', poi, full:bool, quality, missing:[conditionKeys] }
{ type:'resonance-end', poiId, type }
{ type:'chain', types:[...] }            // two+ distinct artefacts now resonating together (concord)
{ type:'gate-open' }  { type:'gate-close' }
{ type:'level-complete', levelId }
{ type:'step', foot:0|1 }                // footstep cadence while moving (~speed-dependent)
{ type:'splash' } { type:'slide-start' } { type:'slide-end' }
```

Physics (fixed dt): `a = input·accel(cover)·(running?1.7:1) − G·∇h − friction(cover)·v`, where
G scales gravity coupling (scree high, path low). Approximate top speeds: walk 5, run 8.5
cells/s. Moving into an impassable cell resolves the collision axis-by-axis, sliding
along the wall. Gate: once open, walking within 2 cells of the gate fires level-complete.
A mid-level edge gate is otherwise treated as a wall.

```js
// src/game/autopilot.js  — for verification tools & attract mode
export function findPath(world, from, to) -> [{x,y}] | null     // A* on passable 8-connected cells, slope-cost weighted
export class Autopilot { constructor(world, waypoints, opts); input(state) -> input; done }
// waypoints: [{x,y, mode?:'walk'|'run'|'slow', dwell?:sec, rest?:bool}]
```

---------------------------------------------------------------------------

## 3. Audio  (`src/audio/*`)

**No internal timers.** All scheduling happens inside `update(state)` and uses
`ctx.currentTime` plus a lookahead. That keeps it identical under
`OfflineAudioContext`, which the verification tool drives with `ctx.suspend(t)`
steps.

```js
// src/audio/index.js
export async function createAudio(ctx, { seed }) -> Audio
Audio = {
  ctx, engine,
  setLevel(levelDef),         // swaps the music profile; crossfades the bed over ~4 s
  update(state),              // call every frame (real-time) or every 50 ms (offline); consumes state.events
  setMasterVolume(v),
  audit(),                    // -> { params: {name: {min,max,count}}, dead: [names] }
  dispose(),
}
```

### Engine  (`src/audio/engine.js`) — owned by the Audio-Core builder
```js
export async function createEngine(ctx, { seed }) -> Engine
Engine = {
  ctx, rng,                                 // Rng
  out,                                      // master input GainNode
  sends: { reverb, delay, grain },          // GainNode inputs of the global FX
  fx: {
    reverb:  { setSize(seconds, rampSec), setWet(v, t?), setDamp(hz, t?), setPreDelay(sec) },  // dual convolver crossfade, procedural stereo IRs 0.8–16 s
    delay:   { setTime(sec, t?), setFeedback(v, t?), setTone(hz, t?), setWet(v, t?), setModDepth(v), setPingPong(bool) },
    granular:{ set({density, size, pitch, pitchSpread, spray, reverse, mix, feedback}, t?), freeze(bool), setScale(semitoneArray) },
    master:  { setDrive(v), setLowCut(hz), setHighCut(hz), duck(amount, attack, hold, release, time) },
  },
  channel(name, { gain=0.8, pan=0, reverb=0.3, delay=0.15, grain=0.1, filter? }) -> Channel,
  param(name, audioParam) -> ParamHandle,   // registers for the audit
  record(name, value),                      // audit hook for per-note params
  noiseBuffer(kind='white'|'pink'|'brown', seconds) -> AudioBuffer (cached),
  ready: Promise,                           // worklet loaded
}
Channel = { name, input (GainNode), set({gain, pan, reverb, delay, grain, cutoff, resonance, drive, crush, chorus}, t?, tc?) }
ParamHandle = { set(value, t, timeConstant=0.1), ramp(value, t), param }
```
Channel chain: `input → drive (WaveShaper) → bitcrush (WaveShaper quantize, bypassable) → filter (Biquad LP) → chorus (modulated short delay, wet mix) → pan → gain`, which feeds `out` plus 3 send gains.
Master: `out → glue DynamicsCompressor → lowcut/highcut → soft-clip WaveShaper → final gain → analyser → destination`.
Global FX returns (reverb, delay, granular) go into the master after `out`, parallel to it. Delay output feeds the reverb send a little. Granular output feeds delay and reverb.

The granular worklet `src/audio/worklets/granular.js` registers `granular-fx`:
- it holds a 6 s stereo ring buffer, recording continuously unless frozen;
- grains are Hann-windowed, read from a random point up to `spray` seconds back, played at `pitch` semitones (± `pitchSpread`, quantised to the scale set via `port.postMessage({scale})`), reversed with probability `reverse`;
- AudioParams: `density` (grains/s 0–80), `size` (0.01–1.0 s), `pitch`, `pitchSpread`, `spray` (0–5.5 s), `reverse` (0–1), `freeze` (0/1), `feedback` (0–0.7).
Load it with `ctx.audioWorklet.addModule(new URL('./worklets/granular.js', import.meta.url))`.

### Voices  (`src/audio/voices/*.js`) — per-note node graphs, auto-disconnect on end
```js
new Drone(engine, channel, patch)   .start(t) .setChord(midis[], t, glideSec) .set(patch, t) .stop(t)
new Pad(engine, channel, patch)     .chord(midis[], t, dur, vel) .set(patch)
new Bass(engine, channel, patch)    .note(midi, t, dur, vel) .glideTo(midi, t)
new Lead(engine, channel, patch)    .note(midi, t, dur, vel) .set(patch)   // mono, portamento, vibrato
new Bell(engine, channel, patch)    .note(midi, t, dur, vel)              // 2-op FM, inharmonic ratios
new Pluck(engine, channel, patch)   .note(midi, t, dur, vel)              // Karplus-Strong via DelayNode feedback
new Texture(engine, channel, patch) .start(t) .set({kind:'wind'|'water'|'rustle'|'crackle'|'hiss', level, tone}, t) .stop(t)
new Kit(engine, channels, patch)    .hit(name, t, vel, opts)
   // names: kick, snare, rim, clap, hatC, hatO, ride, crash, tomL, tomM, tomH, timp, gong,
   //        click, snap, grainBurst, breath, reverseSwell, metal, shaker
```
`patch` = plain object of synthesis params (waveforms, detune, filter env, ADSR,
mod index...). Every numeric patch value a voice uses must go through
`engine.record('<voice>.<param>', value)` so the audit can see it.

### Theory  (`src/audio/theory.js`)
```js
export const MODES = { ionian, dorian, phrygian, lydian, mixolydian, aeolian, locrian, lydianDom, octatonic, pentMajor, pentMinor, wholeTone, ... } // semitone arrays
export function noteName(midi), midiToHz(midi)
export function degreeToMidi(rootMidi, mode, degree, octave=0)   // degree may be negative / > length
export function chordFromDegree(rootMidi, mode, degree, { size=3|4|5, spread, inversion })
export function voiceLead(prevMidis, nextMidis) -> nextMidis (minimal motion re-voicing)
export function quantize(midi, rootMidi, mode)
export const CONTOUR_MOTIF = [0, 2, 4, 1, 3]   // scale degrees
export function transformMotif(motif, op)        // 'invert'|'retro'|'augment'|'rotate:n'|...
```

### Conductor / Score / Artefacts — owned by the Score builder
- `conductor.js` is the lookahead clock, called from `update()`. It schedules 16th steps up to `now + 0.15` s, tracks bars and sections (`ebb`/`flow`/`swell`), and holds the pattern generators: probabilistic Euclid, Markov melodies and fills, all driven by the engine `Rng`.
- `score.js` maps GameState to parameters and turns events into notes. The mapping table is in docs/DESIGN.md.
- `artefacts.js` has 8 artefact pieces plus a partial variant of each: `play(type, {quality, t, profile, level})`.
- `levelmusic.js` holds the music profile for each of the 8 level ids: root, mode, chord vocabulary, BPM, patches, FX ranges, motif transform and percussion palette.

---------------------------------------------------------------------------

## 4. Render  (`src/render/*`)

```js
// src/render/renderer.js
export function createRenderer(canvas) -> Renderer
Renderer = {
  setWorld(world),               // bakes OS-style map (mapbake.js) at CELL_PX px/cell
  draw(state, ui),               // ui: {screen:'title'|'select'|'play'|'pause'|'map'|'notes'|'complete', ...}
  flashContour(index, t), ripple(x, y, t, color), pulse(type)   // visual sound feedback, called by main on events
  resize(),                      // integer-scale the 384×216 framebuffer to fit the window, letterboxed
}
// src/render/font.js  — drawText(ctx, text, x, y, color, {align, scale}) with an embedded 5×7 bitmap font (ASCII + accented Gaelic vowels à è ì ò ù)
// src/render/palette.js — PAL (21 named colours) + tintFor(phase, levelTint)
//   original 16 + lamp #e8832a, flame #f4c43c, bolt #f6c8f6, ice #8ee6e6, dusk #4b4a7a (PAL.lamp etc.)
//   applyTint(buf,w,h,tint,ox,oy,y0,y1,lightMap?) — optional per-pixel light map scales the night dither
// src/render/sprites.js — walkerSprite(dir,pose,frame) (12x12 ragged wanderer with a lit lantern),
//   lanternAnchor(dir,pose,frame[,out]) -> {x,y} of the flame inside the sprite, gateSprite(open) (Celtic ring-cross)
// src/render/fx.js — atmosphere, all dithered palette colours, no Math.random (seeded from world.level.seed / .id):
//   createFx() -> fx; fx.setWorld(world); fx.onLightning(cb) -> unsubscribe  (cb({index,time,x}); also renderer.onLightning)
//   fx.update(state, clock, dt) (strike schedule, callbacks, fx.shake {x,y} +-2px for ~0.25 s)
//   fx.prepare/paintGround/paintAir/paintLantern — called by renderer.js's world layer, never by screens
//   pure, unit-tested: WEATHER (by level id), buildMistField, makeNoiseTex, LightningSchedule, boltPoints, shakeAt,
//   flashDensity, stampLight, precipitationFor, smokePuff, visibleBothies, darknessAt, effectiveNight
// renderer.fx / renderer.onLightning expose the same fx instance (tools/render-preview uses fx.strikeTime(i))
```

---------------------------------------------------------------------------

## 5. Main  (`src/main.js`) — integration
The flow is title → album track list (select) → play. A fixed-step loop runs `game.step(input, 1/60)` with an accumulator. Each frame:
- `audio.update(game.state)`;
- `renderer.draw(game.state, ui)`;
- on events, call renderer feedback (`flashContour`, `ripple`).

The AudioContext is created and resumed on the first user gesture. Progress is saved to localStorage inside try/catch.
`window.__contours = { game, audio, renderer }` is exposed for verification tools.
`?level=N&autopilot=1` query params jump straight in for tests.
