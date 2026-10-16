/**
 * Stage — the persistent channel strips and voice instances shared by the score and the artefacts.
 *
 * Bed channels (ducked by artefacts): drone pad bass bell pluck texture kmain kcym ktex ghost
 * Front channels (un-ducked, foreground): lead fore forePad foreLow fmain fcym ftex
 * Palette channels (grit; made on the first grit level, all ducked): sub beat noise res erode grain arp glimpse
 *
 * Per-level work (patches, channel colouring) is done by applyProfile(); the Drone is created per level by
 * the score (its oscillator count / waveform are fixed at start()). In the grit palette (palette.js) the kit is the
 * dirty family (the profile's kit patch made short, crushed channels) and the palette voices live in stage.g.
 */
import { Pad } from './voices/pad.js';
import { Bass } from './voices/bass.js';
import { Lead } from './voices/lead.js';
import { Bell } from './voices/bell.js';
import { Pluck } from './voices/pluck.js';
import { Texture } from './voices/texture.js';
import { Kit } from './voices/kit.js';
import { SubDrone } from './voices/subdrone.js';
import { NoiseWall } from './voices/noisewall.js';
import { ResPad } from './voices/respad.js';
import { ErodeLoop } from './voices/erode.js';
import { Grain } from './voices/grain.js';
import { Arp } from './voices/arp.js';
import { Glimpse } from './voices/glimpse.js';
import { CHANNEL_NAMES, FRONT_CHANNELS, CH_BASE, patchesFor, channelBase } from './levelmusic.js';
import { GRIT_CH, GRIT_CH_NAMES, GRIT_KIT_CH, dirtyKitPatch } from './palette.js';

export function createStage(engine) {
  const ch = {};
  for (const name of CHANNEL_NAMES) {
    ch[name] = engine.channel(name, { ...CH_BASE[name], duck: !FRONT_CHANNELS.includes(name) });
  }
  const v = {
    pad: new Pad(engine, ch.pad),
    bass: new Bass(engine, ch.bass),
    bell: new Bell(engine, ch.bell),
    pluck: new Pluck(engine, ch.pluck),
    texture: new Texture(engine, ch.texture, { fade: 3 }),
    kit: new Kit(engine, { main: ch.kmain, cymbals: ch.kcym, textural: ch.ktex }),
    ghost: new Bell(engine, ch.ghost),
    lead: new Lead(engine, ch.lead),
    // artefact / foreground voices
    aLead: new Lead(engine, ch.lead),
    aBell: new Bell(engine, ch.fore),
    aPluck: new Pluck(engine, ch.foreB),
    aPad: new Pad(engine, ch.forePad),
    cPad: new Pad(engine, ch.forePad),
    aBass: new Bass(engine, ch.foreLow),
    aKit: new Kit(engine, { main: ch.fmain, cymbals: ch.fcym, textural: ch.ftex }),
    eBell: new Bell(engine, ch.fore),
    ePluck: new Pluck(engine, ch.foreB),
  };
  return { engine, ch, v, g: null };
}

/**
 * The palette channels and voices (made once, on the first grit level; they persist across levels like the texture).
 * stage.g = { sub: SubDrone, wall: NoiseWall, res: ResPad, erode: ErodeLoop, grain: Grain, arp: Arp, glimpse: Glimpse }
 */
export function ensureGrit(stage) {
  if (stage.g) return stage.g;
  const { engine, ch } = stage;
  for (const name of GRIT_CH_NAMES) {
    const { duck, ...o } = GRIT_CH[name];
    ch[name] = engine.channel(name, { ...o, duck });
  }
  stage.g = {
    sub: new SubDrone(engine, { sub: ch.sub, beat: ch.beat }),
    wall: new NoiseWall(engine, ch.noise),
    res: new ResPad(engine, ch.res),
    erode: new ErodeLoop(engine, ch.erode),
    grain: new Grain(engine, ch.grain),
    arp: new Arp(engine, ch.arp),
    glimpse: new Glimpse(engine, ch.glimpse),
  };
  return stage.g;
}

/**
 * Apply a profile's voice patches and channel colouring. `t`/`tc` smooth the channel changes. `pal` (palette.js
 * paletteFor) selects the palette: in grit the kit takes the dirty patch family and its channels are crushed.
 */
export function applyProfile(stage, profile, t, tc = 1.2, pal = null) {
  const P = patchesFor(profile);
  const grit = !!(pal && pal.grit);
  if (grit) P.kit = { ...P.kit, ...dirtyKitPatch(P.kit) };
  const { v } = stage;
  v.pad.set({ ...P.pad });
  v.bass.set({ ...P.bass });
  v.bell.set({ ...P.bell });
  v.pluck.set({ ...P.pluck });
  v.lead.set({ ...P.lead });
  v.ghost.set({ ...P.bell, kind: profile.ghost.kind, level: 0.3, attack: 0.012 });
  v.aLead.set({ ...P.lead });
  v.aBell.set({ ...P.bell });
  v.eBell.set({ ...P.bell, level: P.bell.level * 0.8 });
  v.aPluck.set({ ...P.pluck });
  v.ePluck.set({ ...P.pluck, level: P.pluck.level * 0.8 });
  v.aPad.set({ ...P.pad, attack: Math.min(P.pad.attack, 1.2) });
  v.cPad.set({ ...P.pad, attack: Math.max(0.8, P.pad.attack * 0.6), release: P.pad.release + 2 });
  v.aBass.set({ ...P.bass });
  Object.assign(v.kit.p, P.kit);
  Object.assign(v.aKit.p, P.kit);
  v.texture.set({ motion: P.texture.motion, fade: P.texture.fade }, t);
  const base = channelBase(profile);
  if (grit) {
    for (const [name, o] of Object.entries(GRIT_KIT_CH)) if (base[name]) base[name] = { ...base[name], ...o, drive: Math.max(base[name].drive, o.drive ?? 0) };
    for (const name of GRIT_CH_NAMES) { const { duck, ...o } = GRIT_CH[name]; base[name] = { ...o, ...(profile.ch && profile.ch[name]) }; }
  }
  return { patches: P, base };
}
