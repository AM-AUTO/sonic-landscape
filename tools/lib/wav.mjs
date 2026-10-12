// WAV encoding + audio statistics helpers. Browser-safe (no Node APIs) so they can also run in a page.

/** encodeWav(channels: Float32Array[], sampleRate, {bits: 16|32}) -> Uint8Array (RIFF/WAVE) */
export function encodeWav(channels, sampleRate, { bits = 16 } = {}) {
  const nCh = channels.length, len = channels[0].length;
  const bytes = bits === 32 ? 4 : 2;
  const dataSize = len * nCh * bytes;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * bytes, true);
  v.setUint16(32, nCh * bytes, true); v.setUint16(34, bits, true);
  wr(36, 'data'); v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = channels[c][i];
      if (!Number.isFinite(s)) s = 0;
      if (bits === 32) { v.setFloat32(o, s, true); o += 4; }
      else { s = Math.max(-1, Math.min(1, s)); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    }
  }
  return new Uint8Array(buf);
}

/** decode a PCM16 / float32 WAV (Uint8Array|Buffer) -> {sampleRate, channels: Float32Array[]} */
export function decodeWav(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const fmt = v.getUint16(20, true), nCh = v.getUint16(22, true), sr = v.getUint32(24, true), bits = v.getUint16(34, true);
  let off = 12, dataOff = 0, dataLen = 0;
  while (off < u8.byteLength - 8) {
    const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
    const sz = v.getUint32(off + 4, true);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz;
  }
  const bytes = bits / 8, n = Math.floor(dataLen / (bytes * nCh));
  const channels = Array.from({ length: nCh }, () => new Float32Array(n));
  let o = dataOff;
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) {
    channels[c][i] = fmt === 3 ? v.getFloat32(o, true) : v.getInt16(o, true) / 32768;
    o += bytes;
  }
  return { sampleRate: sr, channels };
}

export const toDb = (x) => 20 * Math.log10(Math.max(1e-10, x));

/**
 * Stats for [t0,t1) seconds of the given channels:
 * { peakDb, rmsDb, nan, silencePct (fraction of 20 ms windows below -70 dBFS, %), maxWinRmsDb (loudest 100 ms), centroidHz }
 */
export function analyse(channels, sr, t0 = 0, t1 = Infinity, { centroid = false } = {}) {
  const len = channels[0].length;
  const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(len, Math.floor(Math.min(t1, len / sr) * sr));
  let peak = 0, sum = 0, nan = 0, cnt = 0;
  const win = Math.max(1, Math.floor(0.02 * sr));
  let silent = 0, wins = 0;
  const w100 = Math.max(1, Math.floor(0.1 * sr));
  let maxW = 0, accW = 0, nW = 0;
  for (let i = a; i < b; i++) {
    let frame = 0;
    for (const ch of channels) {
      const s = ch[i];
      if (!Number.isFinite(s)) { nan++; continue; }
      const ab = Math.abs(s);
      if (ab > peak) peak = ab;
      sum += s * s; cnt++; frame += s * s;
    }
    accW += frame / channels.length; nW++;
    if (nW === w100) { maxW = Math.max(maxW, Math.sqrt(accW / nW)); accW = 0; nW = 0; }
  }
  for (let i = a; i + win <= b; i += win) {
    let e = 0;
    for (const ch of channels) for (let j = i; j < i + win; j++) { const s = ch[j]; e += Number.isFinite(s) ? s * s : 0; }
    if (Math.sqrt(e / (win * channels.length)) < 0.000316) silent++;
    wins++;
  }
  const res = {
    peakDb: toDb(peak), rmsDb: toDb(Math.sqrt(sum / Math.max(1, cnt))), nan,
    silencePct: wins ? (100 * silent) / wins : 100, maxWinRmsDb: toDb(maxW),
  };
  if (centroid) res.centroidHz = spectralCentroid(channels[0], sr, a, b);
  return res;
}

/** in-place radix-2 FFT */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Average spectral centroid (Hz) over Hann-windowed 2048-point frames in [a,b) samples of one channel. */
export function spectralCentroid(ch, sr, a = 0, b = ch.length) {
  const N = 2048, re = new Float64Array(N), im = new Float64Array(N);
  let num = 0, den = 0;
  for (let s = a; s + N <= b; s += N * 2) {
    for (let i = 0; i < N; i++) { re[i] = (ch[s + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      num += m * ((k * sr) / N) * m; den += m * m;           // power-weighted
    }
  }
  return den > 0 ? num / den : 0;
}

/** per-second table: [{t, peakDb, rmsDb}] */
export function perSecond(channels, sr) {
  const out = [];
  const secs = Math.floor(channels[0].length / sr);
  for (let s = 0; s < secs; s++) { const r = analyse(channels, sr, s, s + 1); out.push({ t: s, peakDb: r.peakDb, rmsDb: r.rmsDb }); }
  return out;
}
