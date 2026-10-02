// All sound is synthesized with the Web Audio API: no audio files to download,
// so the app stays tiny and works offline.

import type { Sound } from './store';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { stop(): void } | null = null;
let currentSound: Sound = 'off';
let volume = 0.5;

function audio(): { ctx: AudioContext; master: GainNode } {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, master: master! };
}

function noiseBuffer(c: AudioContext, kind: 'white' | 'pink' | 'brown', seconds = 4): AudioBuffer {
  const len = c.sampleRate * seconds;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') data[i] = w * 0.5;
      else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      } else {
        // Paul Kellet's pink noise approximation.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
  }
  return buf;
}

function loop(c: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function lfo(c: AudioContext, freq: number, depth: number, target: AudioParam): OscillatorNode {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.frequency.value = freq;
  g.gain.value = depth;
  osc.connect(g).connect(target);
  osc.start();
  return osc;
}

function buildAmbient(sound: Sound): { stop(): void } | null {
  if (sound === 'off') return null;
  const { ctx: c, master: out } = audio();
  const bus = c.createGain();
  bus.gain.value = 0;
  bus.gain.linearRampToValueAtTime(1, c.currentTime + 1.5);
  bus.connect(out);
  const nodes: (AudioScheduledSourceNode)[] = [];

  if (sound === 'brown') {
    const src = loop(c, noiseBuffer(c, 'brown'));
    const g = c.createGain();
    g.gain.value = 0.6;
    src.connect(g).connect(bus);
    nodes.push(src);
  } else if (sound === 'rain') {
    const src = loop(c, noiseBuffer(c, 'pink'));
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 600;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const g = c.createGain();
    g.gain.value = 0.55;
    nodes.push(lfo(c, 0.13, 0.12, g.gain));
    src.connect(hp).connect(lp).connect(g).connect(bus);
    // A low rumble underneath for "rain on a window" body.
    const low = loop(c, noiseBuffer(c, 'brown'));
    const lg = c.createGain();
    lg.gain.value = 0.25;
    low.connect(lg).connect(bus);
    nodes.push(src, low);
  } else if (sound === 'waves') {
    const src = loop(c, noiseBuffer(c, 'pink', 6));
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    nodes.push(lfo(c, 0.09, 700, lp.frequency));
    const g = c.createGain();
    g.gain.value = 0.45;
    nodes.push(lfo(c, 0.09, 0.4, g.gain));
    src.connect(lp).connect(g).connect(bus);
    nodes.push(src);
  } else if (sound === 'drone') {
    // A slowly breathing, detuned A-minor-ish pad.
    const freqs = [110, 164.81, 220.5, 261.63, 329.2];
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    nodes.push(lfo(c, 0.05, 500, lp.frequency));
    const g = c.createGain();
    g.gain.value = 0.06;
    lp.connect(g).connect(bus);
    freqs.forEach((f, i) => {
      for (const detune of [-6, 6]) {
        const o = c.createOscillator();
        o.type = i % 2 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = detune;
        o.connect(lp);
        o.start();
        nodes.push(o);
      }
    });
  }

  for (const n of nodes) {
    try {
      n.start();
    } catch {
      /* already started (oscillators) */
    }
  }

  return {
    stop() {
      const t = c.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + 0.8);
      setTimeout(() => {
        nodes.forEach((n) => n.stop());
        bus.disconnect();
      }, 900);
    },
  };
}

export function setAmbient(sound: Sound, playing: boolean): void {
  const want: Sound = playing ? sound : 'off';
  if (want === currentSound) return;
  ambient?.stop();
  ambient = buildAmbient(want);
  currentSound = want;
}

export function setVolume(v: number): void {
  volume = v;
  if (master && ctx) master.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
}

/** Bell-like chime; rising for "back to work", falling for "take a break". */
export function chime(kind: 'break' | 'focus'): void {
  const { ctx: c, master: out } = audio();
  const notes = kind === 'break' ? [880, 659.25, 523.25] : [523.25, 659.25, 880];
  notes.forEach((f, i) => {
    const t = c.currentTime + i * 0.18;
    for (const [mult, amp] of [[1, 0.5], [2.76, 0.12], [5.4, 0.05]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 2.3);
    }
  });
}

export function tick(): void {
  if (!ctx || ctx.state !== 'running') return;
  const c = ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = 1800;
  g.gain.setValueAtTime(0.04, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.03);
  o.connect(g).connect(master!);
  o.start();
  o.stop(c.currentTime + 0.04);
}

/** Must be called from a user gesture so browsers allow audio later on. */
export function unlock(): void {
  audio();
}
