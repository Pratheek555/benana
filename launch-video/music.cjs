// Synthesizes the launch video's soundtrack to public/music.wav, scored to the cut points in src/Launch.jsx.
//   node music.cjs
// 120 BPM; the beat grid starts at the drop (DROP seconds) so every later cut lands on a beat.
const fs = require('node:fs');
const path = require('node:path');

const SR = 44100;
const BPM = 120;
const BEAT = 60 / BPM;
const T = require('./src/timeline.json'); // section start times in seconds, shared with the video
const LEN = T.end + 3;
const N = Math.ceil(LEN * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1; })();

function add(t0, buf, gain = 1, pan = 0) {
  const i0 = Math.floor(t0 * SR);
  const gl = gain * Math.min(1, 1 - pan), gr = gain * Math.min(1, 1 + pan);
  for (let i = 0; i < buf.length && i0 + i < N; i++) {
    if (i0 + i < 0) continue;
    L[i0 + i] += buf[i] * gl;
    R[i0 + i] += buf[i] * gr;
  }
}

function env(i, n, a, d, s, r) {
  const t = i / SR, dur = n / SR;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur - r) return s;
  return Math.max(0, s * (dur - t) / r);
}

// One-pole low-pass, cutoff may change per sample.
function lowpass(buf, cutoff) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    const c = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff;
    const a = 1 - Math.exp((-2 * Math.PI * c) / SR);
    y += a * (buf[i] - y);
    buf[i] = y;
  }
  return buf;
}

const kick = (() => {
  const n = Math.floor(0.45 * SR), b = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (48 + 110 * Math.exp(-t * 32))) / SR;
    b[i] = Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 7));
  }
  return b;
})();

const snare = (() => {
  const n = Math.floor(0.3 * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    b[i] = rnd() * Math.exp(-t * 16) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 25) * 0.5;
  }
  return lowpass(b, 7000);
})();

const hat = (open = false) => {
  const n = Math.floor((open ? 0.22 : 0.05) * SR), b = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const x = rnd();
    b[i] = (x - prev) * Math.exp((-i / SR) * (open ? 14 : 70)); // crude high-pass
    prev = x;
  }
  return b;
};
const HAT = hat(), OHAT = hat(true);

// Saw stack with detune, low-passed: pads, bass and leads all come from this.
function saw(freq, dur, { voices = 1, detune = 0.006, cut = 2000, a = 0.005, d = 0.1, s = 0.7, r = 0.1, sub = 0 } = {}) {
  const n = Math.floor(dur * SR), b = new Float32Array(n);
  const ph = Array.from({ length: voices }, () => Math.random());
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < voices; k++) {
      const f = freq * (1 + detune * (k - (voices - 1) / 2));
      ph[k] = (ph[k] + f / SR) % 1;
      v += 2 * ph[k] - 1;
    }
    v /= voices;
    if (sub) v += sub * Math.sin((2 * Math.PI * freq * 0.5 * i) / SR);
    b[i] = v * env(i, n, a, d, s, r);
  }
  return lowpass(b, cut);
}

function noiseSwell(dur, up = true) {
  const n = Math.floor(dur * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i / n;
    b[i] = rnd() * (up ? p * p : (1 - p) ** 2);
  }
  return lowpass(b, (t) => (up ? 400 + 9000 * (t / dur) ** 2 : 9000 - 8000 * (t / dur)));
}

function impact(t) {
  const n = Math.floor(2.2 * SR), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tt = i / SR;
    b[i] = Math.tanh(2 * Math.sin(2 * Math.PI * (40 + 60 * Math.exp(-tt * 9)) * tt) * Math.exp(-tt * 2.2)) + rnd() * Math.exp(-tt * 6) * 0.25;
  }
  add(t, b, 0.9);
}

// A minor: Am - F - C - G, one chord per bar.
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ROOTS = [45, 41, 36, 43];

function groove(from, to, { drums = true, bass = true, arp = true, pad = true, lead = false, cut = 6000, hats = true } = {}) {
  for (let t = from, beat = 0; t < to - 1e-6; t += BEAT, beat++) {
    const bar = Math.floor(Math.round((t - T.drop) / BEAT) / 4);
    const inBar = ((Math.round((t - T.drop) / BEAT) % 4) + 4) % 4;
    const ch = CHORDS[((bar % 4) + 4) % 4], root = ROOTS[((bar % 4) + 4) % 4];
    if (drums) {
      add(t, kick, 0.95);
      if (inBar === 1 || inBar === 3) add(t, snare, 0.42);
    }
    if (hats) {
      add(t + BEAT / 2, OHAT, 0.13, 0.3);
      add(t + BEAT / 4, HAT, 0.08, -0.3);
      add(t + (3 * BEAT) / 4, HAT, 0.08, -0.3);
    }
    if (bass) {
      // Off-beat pumping bass: rests on the kick, plays the 8th after it.
      add(t + BEAT / 2, saw(midi(root), BEAT / 2 - 0.01, { voices: 2, cut: 380, sub: 0.6, d: 0.05, s: 0.8, r: 0.03 }), 0.42);
    }
    if (pad && inBar === 0) {
      for (const m of ch) add(t, saw(midi(m), BEAT * 4, { voices: 3, detune: 0.01, cut: Math.min(cut, 1600), a: 0.3, d: 0.5, s: 0.6, r: 0.6 }), 0.06, (m % 3) * 0.3 - 0.3);
    }
    if (arp) {
      const notes = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 24];
      for (let k = 0; k < 4; k++) {
        add(t + (k * BEAT) / 4, saw(midi(notes[(k + inBar) % 4]), BEAT / 4, { voices: 2, cut, d: 0.07, s: 0.2, r: 0.04 }), 0.07, k % 2 ? 0.45 : -0.45);
      }
    }
    if (lead && inBar === 0) {
      const line = [ch[2] + 24, ch[1] + 24, ch[0] + 24];
      line.forEach((m, k) => add(t + k * BEAT * 1.33, saw(midi(m), BEAT * 1.2, { voices: 3, cut: 3500, a: 0.01, d: 0.2, s: 0.5, r: 0.2 }), 0.06));
    }
  }
}

// --- Score ---------------------------------------------------------------------------------------
// Beat 1 (pain): a clock ticking faster over a low drone, a dead stop at the collapse, then a held breath.
add(0, saw(midi(33), T.collapse, { voices: 3, detune: 0.004, cut: 220, a: 1.5, s: 0.9, r: 0.3 }), 0.35);
for (let t = 0.2, gap = 0.5; t < T.collapse; t += gap, gap = Math.max(0.09, gap * 0.955)) add(t, HAT, 0.22, 0.2);
for (let t = 0.5; t < T.collapse; t += 1.0) add(t, kick, 0.5); // heartbeat
add(T.collapse - 2.2, noiseSwell(2.2), 0.3);
impact(T.collapse);
// The prompt types over a soft pad, rising into the drop.
for (const m of CHORDS[0]) add(T.prompt, saw(midi(m), T.drop - T.prompt, { voices: 3, cut: 900, a: 0.4, s: 0.7, r: 0.2 }), 0.07);
add(T.drop - 1.6, noiseSwell(1.6), 0.35);

// Drop: logo + build montage.
impact(T.drop);
groove(T.drop, T.drop + 4 * BEAT * 2, { lead: false, cut: 2500 });
groove(T.drop + 8 * BEAT, T.stuck, { lead: true, cut: 6000 });

// Stuck: drums fall away, filter closes, a low warning pulse. Then it rebuilds when the fix lands.
groove(T.stuck, T.fixed, { drums: false, hats: false, arp: true, bass: false, pad: true, cut: 700 });
for (let t = T.stuck; t < T.fixed; t += BEAT * 2) add(t, saw(midi(33), 0.35, { voices: 2, cut: 300, d: 0.2, s: 0.3 }), 0.4);
add(T.fixed - 2, noiseSwell(2), 0.32);
impact(T.fixed);
groove(T.fixed, T.market, { lead: false, cut: 4500 });

// Marketplace: full groove with the lead.
groove(T.market, T.traction, { lead: true, cut: 7000 });
// Traction: a lighter break, no kick.
groove(T.traction, T.cfo, { drums: false, bass: true, lead: false, cut: 3000 });
add(T.cfo - 1, noiseSwell(1), 0.28);
// cfo.ai, then the outro hit.
groove(T.cfo, T.outro, { lead: true, cut: 7000 });
impact(T.outro);
for (const m of [...CHORDS[0], 69, 76]) add(T.outro, saw(midi(m), 3.4, { voices: 4, detune: 0.012, cut: 2400, a: 0.01, d: 0.6, s: 0.5, r: 2.2 }), 0.07);

// --- Mix: a short stereo reverb, soft clip, fade out, 16-bit WAV ------------------------------------
function reverb(ch, delays) {
  const out = Float32Array.from(ch);
  for (const d of delays) {
    const n = Math.floor(d * SR), buf = new Float32Array(n);
    for (let i = 0, k = 0; i < ch.length; i++, k = (k + 1) % n) {
      const y = buf[k];
      buf[k] = ch[i] + y * 0.72;
      out[i] += y * 0.09;
    }
  }
  return out;
}
const LL = reverb(L, [0.0297, 0.0371, 0.0411, 0.0437]);
const RR = reverb(R, [0.0311, 0.0353, 0.0427, 0.0453]);
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(LL[i]), Math.abs(RR[i]));
const pcm = Buffer.alloc(44 + N * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24);
pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (SR * 1.5));
  const s = (x) => Math.round(Math.tanh((1.4 * x) / peak) * 0.92 * fade * 32767);
  pcm.writeInt16LE(s(LL[i]), 44 + i * 4);
  pcm.writeInt16LE(s(RR[i]), 46 + i * 4);
}
fs.writeFileSync(path.join(__dirname, 'public', 'music.wav'), pcm);
console.log(`music.wav ${LEN.toFixed(1)}s`);
