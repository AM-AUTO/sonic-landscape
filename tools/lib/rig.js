// Shared test rig: builds the channel strip + one instance of every voice. Used by the render tool and the audio lab.
import { Drone } from '../../src/audio/voices/drone.js';
import { Pad } from '../../src/audio/voices/pad.js';
import { Bass } from '../../src/audio/voices/bass.js';
import { Lead } from '../../src/audio/voices/lead.js';
import { Bell } from '../../src/audio/voices/bell.js';
import { Pluck } from '../../src/audio/voices/pluck.js';
import { Texture } from '../../src/audio/voices/texture.js';
import { Kit } from '../../src/audio/voices/kit.js';

export function createRig(engine) {
  const ch = {
    drone:   engine.channel('drone',   { gain: 0.75, reverb: 0.35, delay: 0.08, grain: 0.12 }),
    pad:     engine.channel('pad',     { gain: 0.7,  reverb: 0.5,  delay: 0.2,  grain: 0.18, chorus: 0.35 }),
    bass:    engine.channel('bass',    { gain: 0.85, reverb: 0.06, delay: 0.0,  grain: 0.0,  drive: 0.1 }),
    lead:    engine.channel('lead',    { gain: 0.9,  reverb: 0.45, delay: 0.5,  grain: 0.2,  chorus: 0.25 }),
    bell:    engine.channel('bell',    { gain: 0.6,  reverb: 0.6,  delay: 0.45, grain: 0.3 }),
    pluck:   engine.channel('pluck',   { gain: 0.65, reverb: 0.4,  delay: 0.35, grain: 0.1 }),
    texture: engine.channel('texture', { gain: 0.6,  reverb: 0.3,  delay: 0.1,  grain: 0.25 }),
    kmain:   engine.channel('kmain',   { gain: 0.8,  reverb: 0.18, delay: 0.1,  grain: 0.05 }),
    kcym:    engine.channel('kcym',    { gain: 0.6,  reverb: 0.5,  delay: 0.15, grain: 0.08 }),
    ktex:    engine.channel('ktex',    { gain: 0.7,  reverb: 0.45, delay: 0.35, grain: 0.35 }),
  };
  return {
    engine, ch,
    drone: new Drone(engine, ch.drone, { fadeIn: 2.5, release: 3 }),
    pad: new Pad(engine, ch.pad),
    bass: new Bass(engine, ch.bass),
    lead: new Lead(engine, ch.lead),
    bell: new Bell(engine, ch.bell),
    pluck: new Pluck(engine, ch.pluck),
    texture: new Texture(engine, ch.texture, { fade: 0.6 }),
    kit: new Kit(engine, { main: ch.kmain, cymbals: ch.kcym, textural: ch.ktex }),
  };
}
