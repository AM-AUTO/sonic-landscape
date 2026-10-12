// Dev page: audition every voice and kit hit, tweak the global FX. Serve the repo root (npm start) and open /tools/audio-lab.html
import { createEngine } from '../src/audio/engine.js';
import { createRig } from './lib/rig.js';
import { clips, playTutti } from './lib/demo.js';
import { KIT_NAMES } from '../src/audio/voices/kit.js';
import { MODES, chordFromDegree, degreeToMidi, CONTOUR_MOTIF } from '../src/audio/theory.js';

const $ = (id) => document.getElementById(id);
let ctx, engine, rig;

$('start').onclick = async () => {
  if (ctx) return;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  engine = await createEngine(ctx, { seed: Date.now() & 0xffff });
  rig = createRig(engine);
  window.lab = { ctx, engine, rig };
  $('status').textContent = `running @ ${ctx.sampleRate} Hz — window.lab = {ctx, engine, rig}`;
  $('start').disabled = true;
  $('ui').hidden = false;
  build();
  draw();
};

const now = () => ctx.currentTime + 0.05;
function btn(parent, label, fn, cls) {
  const b = document.createElement('button');
  b.textContent = label; if (cls) b.className = cls;
  b.onclick = () => { try { fn(b); } catch (e) { console.error(e); } };
  $(parent).appendChild(b);
  return b;
}
function slider(parent, label, min, max, step, value, fn) {
  const l = document.createElement('label');
  const s = document.createElement('input'); s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
  const v = document.createElement('span'); v.className = 'v'; v.textContent = value;
  s.oninput = () => { v.textContent = (+s.value).toFixed(step < 0.01 ? 3 : 2); fn(+s.value); };
  l.append(label, s, v);
  $(parent).appendChild(l);
  return s;
}
function check(parent, label, value, fn) {
  const l = document.createElement('label');
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = value;
  c.onchange = () => fn(c.checked);
  l.append(label, c);
  $(parent).appendChild(l);
}

function build() {
  const E = engine, r = rig;
  // ---- voices
  btn('voices', 'Drone on', () => { r.drone.start(now()); r.drone.setChord([38, 45, 50, 57], now()); });
  btn('voices', 'Drone → G', () => r.drone.setChord([43, 50, 55, 62], now(), 4));
  btn('voices', 'Drone → D', () => r.drone.setChord([38, 45, 50, 57], now(), 4));
  btn('voices', 'Drone off', () => r.drone.stop(now()));
  btn('voices', 'Pad Dm9', () => r.pad.chord(chordFromDegree(50, MODES.dorian, 0, { size: 5 }), now(), 5, 0.8));
  btn('voices', 'Pad G', () => r.pad.chord(chordFromDegree(50, MODES.dorian, 3, { size: 4, spread: 1 }), now(), 5, 0.7));
  btn('voices', 'Bass', () => { r.bass.note(38, now(), 0.6, 0.9); r.bass.note(45, now() + 0.7, 0.5, 0.7); });
  btn('voices', 'Lead note', () => r.lead.note(74, now(), 1.5, 0.8));
  btn('voices', 'Lead phrase', () => clips.lead.play(r, now()));
  for (const k of ['glass', 'bowl', 'tine']) btn('voices', 'Bell ' + k, () => { r.bell.set({ kind: k }); r.bell.note(k === 'bowl' ? 62 : 84, now(), 3, 0.8); });
  for (const k of ['string', 'harp', 'kalimba']) btn('voices', 'Pluck ' + k, () => { r.pluck.set({ kind: k }); [64, 67, 71, 76].forEach((n, i) => r.pluck.note(n, now() + i * 0.18, 1.5, 0.8)); });
  for (const k of ['wind', 'water', 'rustle', 'crackle', 'hiss']) {
    btn('voices', 'Tex ' + k, (b) => {
      if (b.classList.toggle('on')) { r.texture.set({ kind: k, level: 0.7 }, now()); r.texture.start(now()); }
      else r.texture.stop(now());
    });
  }
  // ---- kit
  const opt = { vel: 0.85, pitch: 1, decay: 0, tone: 0.5, pan: 0, length: 0 };
  for (const n of KIT_NAMES) btn('kit', n, () => {
    const o = { pitch: opt.pitch, tone: opt.tone, pan: opt.pan };
    if (opt.decay > 0) o.decay = opt.decay;
    if (opt.length > 0) o.length = opt.length;
    r.kit.hit(n, now(), opt.vel, o);
  });
  slider('kitopts', 'velocity', 0, 1.2, 0.01, opt.vel, (v) => (opt.vel = v));
  slider('kitopts', 'pitch ×', 0.4, 2.5, 0.01, 1, (v) => (opt.pitch = v));
  slider('kitopts', 'decay s (0=default)', 0, 8, 0.01, 0, (v) => (opt.decay = v));
  slider('kitopts', 'tone', 0, 1, 0.01, 0.5, (v) => (opt.tone = v));
  slider('kitopts', 'pan', -1, 1, 0.01, 0, (v) => (opt.pan = v));
  slider('kitopts', 'length s (swells/clouds)', 0, 8, 0.01, 0, (v) => (opt.length = v));
  // ---- reverb / delay
  const rv = E.fx.reverb, dl = E.fx.delay;
  slider('fxrd', 'reverb size s', 0.8, 16, 0.1, 4, (v) => rv.setSize(v, 2.5));
  slider('fxrd', 'reverb wet', 0, 2, 0.01, 0.9, (v) => rv.setWet(v));
  slider('fxrd', 'reverb damp Hz', 500, 16000, 10, 7500, (v) => rv.setDamp(v));
  slider('fxrd', 'reverb pre-delay s', 0, 0.3, 0.001, 0.025, (v) => rv.setPreDelay(v));
  slider('fxrd', 'delay time s', 0.05, 2, 0.001, 0.5, (v) => dl.setTime(v));
  slider('fxrd', 'delay feedback', 0, 0.94, 0.01, 0.45, (v) => dl.setFeedback(v));
  slider('fxrd', 'delay tone Hz', 300, 12000, 10, 3200, (v) => dl.setTone(v));
  slider('fxrd', 'delay wet', 0, 1.5, 0.01, 0.55, (v) => dl.setWet(v));
  slider('fxrd', 'delay mod depth', 0, 1, 0.01, 0.15, (v) => dl.setModDepth(v));
  check('fxrd', 'ping-pong', true, (on) => dl.setPingPong(on));
  // ---- granular
  const g = E.fx.granular;
  const gp = { density: 14, size: 0.18, pitch: 0, pitchSpread: 0, spray: 1.5, reverse: 0.1, mix: 0.7, feedback: 0.2 };
  const rangeOf = { density: [0, 80, 1], size: [0.01, 1, 0.005], pitch: [-24, 24, 1], pitchSpread: [0, 24, 0.5], spray: [0, 5.5, 0.05], reverse: [0, 1, 0.01], mix: [0, 1.2, 0.01], feedback: [0, 0.7, 0.01] };
  for (const k of Object.keys(gp)) slider('fxg', k, rangeOf[k][0], rangeOf[k][1], rangeOf[k][2], gp[k], (v) => g.set({ [k]: v }));
  check('fxg', 'freeze', false, (on) => g.freeze(on));
  btn('fxgb', 'grain send: pad', () => rig.ch.pad.set({ grain: 1 }));
  btn('fxgb', 'grain send: pad off', () => rig.ch.pad.set({ grain: 0.18 }));
  btn('fxgb', 'scale: dorian', () => g.setScale(MODES.dorian));
  btn('fxgb', 'scale: pentatonic', () => g.setScale(MODES.pentMajor));
  btn('fxgb', 'scale: none', () => g.setScale([]));
  // ---- master + channel
  const m = E.fx.master;
  slider('fxm', 'master drive', 0, 1, 0.01, 0, (v) => m.setDrive(v));
  slider('fxm', 'master low-cut Hz', 10, 400, 1, 28, (v) => m.setLowCut(v));
  slider('fxm', 'master high-cut Hz', 1000, 20000, 10, 17500, (v) => m.setHighCut(v));
  slider('fxm', 'master gain', 0, 1.2, 0.01, 0.95, (v) => m.setGain(v));
  btn('fxm', 'duck 50%', () => m.duck(0.5, 0.05, 0.6, 1.5, now()));
  const sel = document.createElement('select'); sel.id = 'chsel';
  for (const name of Object.keys(rig.ch)) sel.add(new Option(name, name));
  $('fxm').appendChild(sel);
  for (const [k, lo, hi, st, def] of [['gain', 0, 1.5, 0.01, 0.8], ['pan', -1, 1, 0.01, 0], ['reverb', 0, 1.5, 0.01, 0.3], ['delay', 0, 1.5, 0.01, 0.15], ['grain', 0, 1.5, 0.01, 0.1], ['cutoff', 100, 18000, 10, 18000], ['resonance', 0.1, 14, 0.1, 0.7], ['drive', 0, 1, 0.01, 0], ['crush', 0, 1, 0.01, 0], ['chorus', 0, 1, 0.01, 0]])
    slider('fxm', 'channel ' + k, lo, hi, st, def, (v) => rig.ch[sel.value].set({ [k]: v }));
  // ---- sequences
  btn('seqs', 'Play tutti (10 s)', () => playTutti(rig, now()));
  btn('seqs', 'Motif on lead', () => CONTOUR_MOTIF.forEach((d, i) => rig.lead.note(degreeToMidi(62, MODES.dorian, d + 7), now() + i * 0.6, 0.55, 0.8)));
  btn('seqs', 'Crash + gong', () => { r.kit.hit('crash', now(), 0.9); r.kit.hit('gong', now(), 0.8); });
  btn('seqs', 'Swell → crash', () => { r.kit.hit('reverseSwell', now(), 0.9, { length: 3 }); r.kit.hit('crash', now() + 3, 0.9); });
  btn('seqs', 'Timpani roll', () => { for (let i = 0; i < 14; i++) r.kit.hit('timp', now() + i * 0.09, 0.3 + i * 0.05); });
  $('audit').onclick = () => console.log(engine.auditReport());
}

// ---- meter
const cv = $('meter'), c2 = cv.getContext('2d');
function draw() {
  requestAnimationFrame(draw);
  const a = engine.analyser, w = cv.width, h = cv.height;
  const td = new Float32Array(a.fftSize), fd = new Uint8Array(a.frequencyBinCount);
  a.getFloatTimeDomainData(td); a.getByteFrequencyData(fd);
  c2.fillStyle = '#0e1014'; c2.fillRect(0, 0, w, h);
  c2.fillStyle = '#e3a85755';
  const bins = 400;
  for (let i = 0; i < bins; i++) { const v = fd[Math.floor(Math.pow(i / bins, 2) * fd.length * 0.7)] / 255; c2.fillRect((i / bins) * w, h - v * h, w / bins, v * h); }
  c2.strokeStyle = '#e6e1d3'; c2.beginPath();
  let pk = 0, sum = 0;
  for (let i = 0; i < td.length; i++) { const y = h / 2 - td[i] * h * 0.45; if (i === 0) c2.moveTo(0, y); else c2.lineTo((i / td.length) * w, y); pk = Math.max(pk, Math.abs(td[i])); sum += td[i] * td[i]; }
  c2.stroke();
  c2.fillStyle = '#e3a857'; c2.fillText(`peak ${(20 * Math.log10(pk + 1e-9)).toFixed(1)} dB   rms ${(10 * Math.log10(sum / td.length + 1e-12)).toFixed(1)} dB`, 8, 12);
}
