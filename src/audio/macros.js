/**
 * Macros — pure functions that turn the smoothed gameplay controls C (and artefact modifiers A) into
 * parameter targets for every mixer channel and every global FX. Kept free of Web Audio so the mapping is
 * easy to read, test and tune. This is where altitude, drift, slope, cover, time of day and artefacts reach
 * the whole parameter surface: channel gain/pan/sends/cutoff/resonance/drive/crush/chorus, reverb size/wet/
 * damp/pre-delay, delay time/feedback/tone/wet/mod/ping-pong/spread, granular density…feedback, master
 * drive/cuts/gain.
 *
 * Controls C (all 0..1 unless noted): a altitude, e energy, d drift, s slope, v speed, sw swell factor,
 * n night, w dawn, water, snow, bog, scree, rock, wood, path, glitch, slide, t (seconds, unbounded).
 */

const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
const sin = (t, period, ph = 0) => Math.sin((TAU * t) / period + ph);

/** which role's formulas each channel follows */
export const ROLE = {
  drone: 'drone', pad: 'pad', bass: 'bass', bell: 'bell', pluck: 'pluck', texture: 'texture', kmain: 'kit', kcym: 'kcym', ktex: 'ktex',
  ghost: 'ghost', lead: 'lead', fore: 'bell', foreB: 'pluck', forePad: 'pad', foreLow: 'bass', fmain: 'kit', fcym: 'kcym', ftex: 'ktex',
};
const FRONT = new Set(['lead', 'fore', 'foreB', 'forePad', 'foreLow', 'fmain', 'fcym', 'ftex']);

/**
 * Target channel parameters for `name` given its baseline `b` and controls C.
 * Front (un-ducked) channels respond less to energy so artefact solos keep their level.
 */
export function channelTarget(name, b, C, prof) {
  const role = ROLE[name];
  const front = FRONT.has(name);
  const e = front ? C.e * 0.5 : C.e;
  const { a, d, s, sw, n, w, water, snow, bog, scree, rock, wood, glitch, t } = C;
  const ph = name.length * 0.9;
  let o;
  switch (role) {
    case 'drone':
      o = {
        gain: b.gain * (0.92 + 0.28 * d - 0.12 * sw) * (1 + 0.1 * a),
        pan: b.pan + 0.12 * sin(t, 53, ph),
        reverb: b.reverb * (0.8 + 0.45 * a + 0.5 * d),
        delay: b.delay * (0.8 + 0.8 * d + 0.5 * water),
        grain: b.grain * (0.7 + 1.2 * d + 0.8 * water),
        cutoff: b.cutoff * (0.55 + 0.5 * a) * (1 - 0.3 * bog) * (1 + 0.3 * snow),
        resonance: b.resonance + 3.5 * d + 1.5 * sw,
        drive: b.drive + 0.12 * sw,
        crush: b.crush + glitch * 0.25,
        chorus: b.chorus * (0.6 + 0.9 * d + 0.5 * a),
      };
      break;
    case 'pad':
      o = {
        gain: b.gain * (0.82 + 0.22 * e + 0.15 * d) * (1 - 0.1 * sw),
        pan: b.pan + 0.18 * sin(t, 41, ph),
        reverb: b.reverb * (0.75 + 0.5 * a + 0.4 * d - 0.1 * sw),
        delay: b.delay * (0.7 + 0.7 * d + 0.5 * n + 0.5 * water),
        grain: b.grain * (0.8 + 0.9 * s + 1.0 * d + 0.7 * water),
        cutoff: b.cutoff * (0.5 + 0.6 * a) * (1 - 0.5 * bog) * (1 + 0.25 * w - 0.3 * n) * (1 + 0.2 * snow),
        resonance: b.resonance + 2 * e + 3 * d,
        drive: b.drive + 0.1 * sw + 0.1 * s,
        crush: b.crush + glitch * 0.3,
        chorus: b.chorus * (0.7 + 0.8 * d + 0.5 * a) + 0.1 * n,
      };
      break;
    case 'bass':
      o = {
        gain: b.gain * (0.85 + 0.3 * e) * (1 - 0.7 * d),
        pan: b.pan + 0.04 * sin(t, 31, ph),
        reverb: b.reverb * (0.8 + 0.5 * d),
        delay: b.delay + 0.02 * d,
        grain: b.grain + 0.01 * d,
        cutoff: b.cutoff * (0.7 + 0.9 * e) * (1 + 0.3 * a),
        resonance: b.resonance + 2 * e + 2 * s,
        drive: b.drive + 0.2 * sw + 0.15 * s,
        crush: b.crush + glitch * 0.35,
        chorus: b.chorus + 0.05 * d,
      };
      break;
    case 'bell':
      o = {
        gain: b.gain * (0.9 + 0.35 * d + 0.25 * snow) * (1 - 0.15 * sw),
        pan: b.pan + 0.35 * sin(t, 29, ph),
        reverb: b.reverb * (0.8 + 0.45 * a + 0.4 * d),
        delay: b.delay * (0.7 + 0.9 * d + 0.8 * water + 0.4 * n),
        grain: b.grain * (0.7 + 0.9 * snow + 0.8 * water + 0.5 * d + 0.6 * s),
        cutoff: b.cutoff * (0.5 + 0.6 * a + 0.3 * snow) * (1 - 0.45 * bog),
        resonance: b.resonance + 1.5 * snow + 1.5 * d,
        drive: b.drive + 0.05 * sw,
        crush: b.crush + glitch * 0.35 + 0.08 * scree * s,
        chorus: b.chorus + 0.2 * d,
      };
      break;
    case 'pluck':
      o = {
        gain: b.gain * (0.85 + 0.3 * wood + 0.1 * e),
        pan: b.pan - 0.3 * sin(t, 23, ph),
        reverb: b.reverb * (0.8 + 0.4 * a + 0.4 * d),
        delay: b.delay * (0.7 + 0.8 * d + 0.7 * water + 0.3 * n),
        grain: b.grain * (0.8 + 0.6 * wood + 0.6 * d + 0.5 * s),
        cutoff: b.cutoff * (0.5 + 0.6 * a) * (1 - 0.5 * bog) * (1 + 0.2 * w),
        resonance: b.resonance + 1.5 * e + 2 * rock,
        drive: b.drive + 0.06 * sw + 0.08 * rock,
        crush: b.crush + glitch * 0.3 + 0.1 * scree,
        chorus: b.chorus * (0.8 + 0.8 * d) + 0.1 * wood,
      };
      break;
    case 'texture':
      o = {
        gain: b.gain * (0.8 + 0.5 * d + 0.2 * (1 - e)),
        pan: b.pan + 0.25 * sin(t, 37, ph),
        reverb: b.reverb * (0.8 + 0.6 * d + 0.3 * water),
        delay: b.delay * (0.8 + 1.0 * water + 0.5 * d),
        grain: b.grain * (0.7 + 1.0 * water + 0.7 * s + 0.6 * d),
        cutoff: b.cutoff * (0.5 + 0.7 * a) * (1 - 0.5 * bog) * (1 + 0.3 * snow),
        resonance: b.resonance + 3 * water + 2 * snow,
        drive: b.drive + 0.04 * scree + 0.03 * e,
        crush: b.crush + glitch * 0.3 + 0.15 * C.slide,
        chorus: b.chorus * (0.8 + 0.6 * d) + 0.1 * water,
      };
      break;
    case 'kit':
      o = {
        gain: b.gain * (0.8 + 0.35 * sw + 0.15 * s) * (1 - 0.3 * d),
        pan: b.pan + 0.05 * sin(t, 47, ph),
        reverb: b.reverb * (0.9 + 0.5 * d - 0.3 * sw),
        delay: b.delay * (0.7 + 0.6 * (1 - e)),
        grain: b.grain * (0.6 + 1.2 * s),
        cutoff: b.cutoff * (0.7 + 0.6 * e + 0.2 * a) * (1 - 0.4 * bog),
        resonance: b.resonance + 3 * s,
        drive: b.drive + 0.25 * sw + 0.2 * s,
        crush: b.crush + glitch * 0.5 + 0.06 * scree,
        chorus: b.chorus + 0.06 * d,
      };
      break;
    case 'kcym':
      o = {
        gain: b.gain * (0.85 + 0.3 * sw) * (1 - 0.3 * d),
        pan: b.pan + 0.25 * sin(t, 33, ph),
        reverb: b.reverb * (0.85 + 0.5 * a + 0.4 * d),
        delay: b.delay * (0.7 + 0.8 * d + 0.4 * n),
        grain: b.grain * (0.7 + 0.9 * s + 0.5 * snow),
        cutoff: b.cutoff * (0.6 + 0.5 * a + 0.3 * e) * (1 - 0.4 * bog) * (1 + 0.15 * w - 0.2 * n),
        resonance: b.resonance + 1.5 * snow + 1 * rock + 1.2 * e,
        drive: b.drive + 0.04 * sw,
        crush: b.crush + glitch * 0.45,
        chorus: b.chorus + 0.1 * d,
      };
      break;
    case 'ktex':
      o = {
        gain: b.gain * (0.85 + 0.25 * d + 0.2 * scree),
        pan: b.pan + 0.4 * sin(t, 27, ph),
        reverb: b.reverb * (0.85 + 0.4 * a + 0.5 * d),
        delay: b.delay * (0.7 + 0.9 * d + 0.9 * water),
        grain: b.grain * (0.8 + 1.0 * scree + 0.8 * water + 0.5 * s),
        cutoff: b.cutoff * (0.55 + 0.5 * a + 0.3 * e) * (1 - 0.35 * bog),
        resonance: b.resonance + 2.5 * rock + 1.5 * scree + 1.0 * s,
        drive: b.drive + 0.05 * sw,
        crush: b.crush + glitch * 0.6 + 0.2 * C.slide + 0.04 * scree,
        chorus: b.chorus + 0.1 * water,
      };
      break;
    case 'ghost':
      o = {
        gain: b.gain * (0.9 + 0.3 * d),
        pan: b.pan + 0.5 * sin(t, 23, ph),
        reverb: b.reverb * (0.9 + 0.2 * a),
        delay: b.delay * (0.8 + 0.5 * d + 0.3 * n),
        grain: b.grain * (0.8 + 0.6 * d + 0.4 * water),
        cutoff: b.cutoff * (0.6 + 0.5 * a) * (1 + 0.2 * w - 0.25 * n),
        resonance: b.resonance + 1.5 * d,
        drive: b.drive + 0.05 * e,
        crush: b.crush + glitch * 0.5,
        chorus: b.chorus * (0.8 + 0.5 * d),
      };
      break;
    case 'lead':
    default:
      o = {
        gain: b.gain * (0.95 + 0.1 * e),
        pan: b.pan + C.leadPan,
        reverb: b.reverb * (0.75 + 0.5 * a + 0.4 * d),
        delay: b.delay * (0.6 + 0.8 * d + 0.6 * water + 0.5 * n),
        grain: b.grain * (0.7 + 0.6 * s + 0.6 * d + 0.5 * water),
        cutoff: b.cutoff * (0.6 + 0.6 * a) * (1 + 0.3 * w - 0.3 * n) * (1 - 0.3 * bog),
        resonance: b.resonance + 2 * e + 1.5 * snow,
        drive: b.drive + 0.1 * sw,
        crush: b.crush + glitch * 0.15,
        chorus: b.chorus * (0.7 + 0.7 * d + 0.5 * a),
      };
  }
  // sanitise to channel ranges
  o.gain = clamp(o.gain, 0, 1.6); o.pan = clamp(o.pan, -1, 1);
  o.reverb = clamp(o.reverb, 0, 1.4); o.delay = clamp(o.delay, 0, 1.2); o.grain = clamp(o.grain, 0, 1.2);
  o.cutoff = clamp(o.cutoff, 500, 19000); o.resonance = clamp(o.resonance, -6, 10);
  o.drive = clamp(o.drive, 0, 0.9); o.crush = clamp(o.crush, 0, 1); o.chorus = clamp(o.chorus, 0, 0.95);
  return o;
}

/** apply artefact modifiers (mul / add / set maps) for a channel */
export function applyChannelMods(o, name, A) {
  if (!A) return o;
  if (A.frontGain !== undefined && FRONT.has(name)) o.gain *= A.frontGain;
  const m = A.chMul && A.chMul[name], ad = A.chAdd && A.chAdd[name], st = A.chSet && A.chSet[name];
  if (m) for (const k of Object.keys(m)) if (o[k] !== undefined) o[k] *= m[k];
  if (ad) for (const k of Object.keys(ad)) if (o[k] !== undefined) o[k] += ad[k];
  if (st) for (const k of Object.keys(st)) o[k] = st[k];
  o.gain = clamp(o.gain, 0, 3.2); o.pan = clamp(o.pan, -1, 1);
  o.reverb = clamp(o.reverb, 0, 1.6); o.delay = clamp(o.delay, 0, 1.4); o.grain = clamp(o.grain, 0, 1.4);
  o.cutoff = clamp(o.cutoff, 300, 19500); o.resonance = clamp(o.resonance, -6, 14);
  o.drive = clamp(o.drive, 0, 0.95); o.crush = clamp(o.crush, 0, 1); o.chorus = clamp(o.chorus, 0, 0.95);
  return o;
}

const ease = (x) => x * x * (3 - 2 * x);
/** how much of the top end the mix lets through: dark in ebb and drift, open in swell */
const smoothAir = (e, d) => ease(clamp(e / 0.6, 0, 1)) * (1 - 0.7 * d);

/** reverb sizes are quantised to a coarse ladder: each new size costs a convolver rebuild, so the room changes in few, deliberate steps */
const SIZE_LADDER = [1.5, 2.5, 4, 6, 8.5, 11, 13.5, 16];
export function snapSize(s) {
  let best = SIZE_LADDER[0], bd = Infinity;
  for (const v of SIZE_LADDER) { const d = Math.abs(v - s); if (d < bd) { bd = d; best = v; } }
  return best;
}

/** artefact override: undefined → base; number → that value; {v, w} → base blended toward v by weight w */
export function ovr(base, spec) {
  if (spec === undefined || spec === null) return base;
  if (typeof spec === 'number') return spec;
  return base + (spec.v - base) * clamp(spec.w, 0, 1);
}

/**
 * Global FX targets for a profile given controls and artefact mods.
 * Returns { reverb:{size,wet,damp,pre}, delay:{time,fb,tone,wet,mod,pingPong,spread}, granular:{...}, master:{drive,lowCut,highCut,gain} }
 */
export function fxTargets(fx, C, A, beatSec, section) {
  A = A || {};
  const { a, e, d, s, sw, n, w, water, snow, bog, t } = C;
  const rv = fx.reverb, dl = fx.delay, g = fx.granular, m = fx.master;

  // reverb: altitude sets the room (2 s on the floor of the glen, up to ~14 s on the tops); stillness lets it grow
  let size = lerp(rv.min, rv.max, a);
  size += (rv.max - size) * 0.55 * d;
  size -= 0.35 * sw * (size - rv.min);
  // an artefact's bloom jumps once (the convolver crossfades over its ramp) instead of passing through every size on the way
  if (A.reverbSize !== undefined) {
    const o = A.reverbSize;
    size = typeof o === 'number' ? o : (o.w > 0.35 ? o.v : size);
  }
  const reverb = {
    size: snapSize(clamp(size, 0.8, 16)),
    wet: rv.wet * (0.85 + 0.25 * d + 0.15 * (1 - e)) * (A.reverbWet ?? 1),
    damp: ovr(lerp(rv.damp[1], rv.damp[0], clamp(n * 0.6 + bog * 0.5 + (1 - a) * 0.3 - snow * 0.3, 0, 1)), A.reverbDamp),
    pre: ovr(lerp(rv.pre[0], rv.pre[1], clamp(d * 0.7 + a * 0.3, 0, 1)), A.preDelay),
  };

  // delay: tempo-locked time, altitude raises the feedback ceiling, stillness / water / night feed it
  const fbCeil = lerp(lerp(dl.fb[0], dl.fb[1], 0.55), dl.fb[1], a);
  const fbMix = clamp(0.3 + 0.7 * (d * 0.7 + water * 0.45 + (1 - e) * 0.3 + n * 0.2) - 0.3 * sw, 0, 1);
  const delay = {
    time: clamp(ovr(dl.beats * beatSec * (1 + 0.04 * n), A.delayTime), 0.08, 4.4),
    fb: ovr(lerp(dl.fb[0], fbCeil, fbMix), A.delayFb),
    tone: ovr(lerp(dl.tone[0], dl.tone[1], clamp(a * 0.5 + w * 0.3 - n * 0.3 + e * 0.2 + 0.1, 0, 1)), A.delayTone),
    wet: dl.wet * (0.8 + 0.4 * n + 0.3 * d + 0.3 * water) * (A.delayWet ?? 1),
    mod: ovr(lerp(dl.mod[0], dl.mod[1], clamp(n * 0.5 + water * 0.4 + d * 0.4, 0, 1)), A.delayMod),
    pingPong: A.pingPong !== undefined ? !!A.pingPong : (dl.pingPong ? section !== 'ebb' : section === 'swell'),
    spread: ovr(lerp(dl.spread[0], dl.spread[1], clamp(water * 0.6 + sw * 0.4 + 0.2 * Math.max(0, sin(t, 97)), 0, 1)), A.delaySpread),
  };

  // granular: slope drives the cloud density, cover and stillness its colour
  const granular = {
    density: clamp(g.density * (0.5 + 1.2 * s + 0.5 * d + 0.5 * water), 0, 70),
    size: clamp(g.size * (1 - 0.4 * s + 0.3 * d), 0.015, 1),
    pitch: lerp(0, g.pitch, 0.25 + 0.75 * a),
    pitchSpread: clamp(g.pitchSpread * (0.6 + 0.8 * s), 0, 30),
    spray: clamp(g.spray * (0.7 + 0.4 * d + 0.3 * a), 0.05, 5.4),
    reverse: clamp(g.reverse + 0.3 * sw + 0.15 * d, 0, 1),
    mix: clamp(g.mix * (0.7 + 0.5 * water + 0.4 * d + 0.3 * s), 0, 1.4),
    feedback: clamp(g.feedback * (0.7 + 0.5 * d) , 0, 0.65),
  };
  if (A.gran) for (const k of Object.keys(A.gran)) if (granular[k] !== undefined) granular[k] = ovr(granular[k], A.gran[k]);
  const freeze = !!A.freeze;

  const master = {
    drive: Math.min(0.3, lerp(m.drive[0], m.drive[1], sw) + (A.masterDrive || 0)),
    lowCut: lerp(lerp(m.lowCut[0], m.lowCut[1], clamp(e * 0.6 + 0.2, 0, 1)), m.lowCut[0], d),
    highCut: ovr(lerp(m.highCut[0], m.highCut[1], clamp(0.3 + a * 0.35 + w * 0.25 - n * 0.25 + snow * 0.1 - bog * 0.2, 0, 1)) * lerp(m.dark ?? 0.5, 1, smoothAir(e, d)), A.highCut),
    gain: (1 + 0.05 * e - 0.1 * d) * (A.gain ?? 1),
  };
  master.lowCut = ovr(master.lowCut, A.lowCut);
  return { reverb, delay, granular, freeze, master };
}

export { ease };
