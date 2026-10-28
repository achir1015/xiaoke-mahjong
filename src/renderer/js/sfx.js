// 音效（WebAudio 即時合成：麻將牌碰撞、洗牌、胡牌）
let ctx = null;
let enabled = true;
let master = null;
let level = 0.8;
const ac = () => {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = level;
    master.connect(ctx.destination);
  }
  return ctx;
};

export function setSfx(on) { enabled = !!on; }
export function setSfxVolume(v) { level = Math.max(0, Math.min(1, v)); if (master) master.gain.value = level; }
export const sfxVolume = () => level;

function tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.002, decay = dur, when = 0, slide = 0 } = {}) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.3, freq = 2000, q = 1, when = 0, decay = 0.15 } = {}) {
  const c = ac();
  const t = c.currentTime + when;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * decay));
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

// 牌敲在桌上：清脆的「喀」
function clack(pitch = 1, gain = 1, when = 0) {
  noise(0.06, { gain: 0.5 * gain, freq: 2600 * pitch, q: 2.5, when });
  noise(0.09, { gain: 0.25 * gain, freq: 900 * pitch, q: 1.2, when });
  tone(1700 * pitch, 0.05, { gain: 0.06 * gain, when });
}

export const sfx = {
  discard() { if (enabled) clack(1, 1); },
  draw() { if (enabled) clack(1.25, 0.45); },
  select() { if (enabled) clack(1.5, 0.3); },
  meld() { if (enabled) { clack(0.95, 0.9); clack(1.05, 0.9, 0.07); clack(1, 0.9, 0.14); } },
  flower() { if (enabled) { tone(1320, 0.18, { gain: 0.08 }); tone(1760, 0.22, { gain: 0.06, when: 0.08 }); } },
  shuffle() { if (enabled) for (let i = 0; i < 14; i++) clack(0.8 + Math.random() * 0.6, 0.35, i * 0.045 + Math.random() * 0.02); },
  illegal() { if (enabled) tone(220, 0.15, { type: 'square', gain: 0.05, slide: 0.8 }); },
  turn() {
    if (!enabled) return;
    tone(988, 0.12, { gain: 0.12 });
    tone(1319, 0.2, { gain: 0.1, when: 0.1 });
  },
  win() {
    if (!enabled) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.15, when: i * 0.12 }));
  },
  lose() {
    if (!enabled) return;
    [440, 392, 349, 262].forEach((f, i) => tone(f, 0.55, { type: 'triangle', gain: 0.13, when: i * 0.17 }));
  },
  draw0() { if (enabled) [392, 330].forEach((f, i) => tone(f, 0.4, { type: 'triangle', gain: 0.1, when: i * 0.2 })); },
  resume() { try { ac().resume(); } catch {} },
};
