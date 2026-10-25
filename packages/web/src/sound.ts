import type { ClearInfo } from '@line-battle/engine';
import type { HitObject } from './art';

/**
 * Sound effects, made on the fly with the Web Audio API: no files to
 * download, and nothing plays until the first key press or click (browsers
 * block audio before that anyway).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.7;

  setVolume(percent: number): void {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    if (this.master) this.master.gain.value = this.volume * 0.6;
  }

  /** Call from a user gesture: creates or wakes the audio context. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.6;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get ready(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0 ? this.ctx : null;
  }

  // ---- building blocks ------------------------------------------------------

  /** A tone sliding from `f0` to `f1` Hz with a quick attack and a decay. */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0, out?: AudioNode): void {
    const c = this.ready;
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out ?? this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A burst of filtered noise: thuds, crashes, whooshes. */
  private noise(dur: number, gain: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    const c = this.ready;
    if (!c || !this.noiseBuffer) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Several inharmonic partials: a metal clang. */
  private clang(base: number, dur: number, gain: number, delay = 0): void {
    for (const [ratio, g] of [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.2]]) this.tone('sine', base * ratio, base * ratio * 0.98, dur, gain * g, delay);
  }

  // ---- game sounds ------------------------------------------------------------

  move(): void {
    this.tone('square', 1400, 1300, 0.025, 0.02);
  }

  rotate(): void {
    this.tone('triangle', 820, 1100, 0.05, 0.05);
  }

  hold(): void {
    this.tone('triangle', 600, 600, 0.06, 0.05);
    this.tone('triangle', 900, 900, 0.07, 0.05, 0.05);
  }

  lock(): void {
    this.tone('sine', 160, 70, 0.09, 0.22);
    this.noise(0.05, 0.08, 1800);
  }

  /** Brighter and higher for bigger clears; climbs with the combo. */
  clear(info: ClearInfo): void {
    const base = 440 * Math.pow(2, Math.min(info.combo, 12) / 12);
    const notes = info.spin !== 'none' ? [0, 4, 7, 11, 14] : info.lines >= 4 ? [0, 4, 7, 12, 16] : [0, 4, 7, 12].slice(0, info.lines + 1);
    notes.forEach((n, i) => this.tone(info.b2b > 0 ? 'sawtooth' : 'triangle', base * Math.pow(2, n / 12), base * Math.pow(2, n / 12), 0.16, 0.07, i * 0.045));
    this.noise(0.18, 0.05, 5000, 0.7, 0, 'highpass');
    if (info.perfectClear) [0, 7, 12, 19, 24].forEach((n, i) => this.tone('square', 523 * Math.pow(2, n / 12), 523 * Math.pow(2, n / 12), 0.25, 0.05, 0.25 + i * 0.07));
  }

  /** Garbage rising into your board. */
  garbage(lines: number): void {
    this.noise(0.25 + lines * 0.03, 0.18, 300, 2);
    this.tone('sawtooth', 90, 55, 0.25, 0.06);
  }

  countdown(go: boolean): void {
    this.tone('square', go ? 880 : 520, go ? 880 : 520, go ? 0.22 : 0.1, 0.06);
  }

  topOut(): void {
    this.tone('sawtooth', 400, 60, 0.7, 0.08);
  }

  win(): void {
    [0, 4, 7, 12].forEach((n, i) => this.tone('square', 523 * Math.pow(2, n / 12), 523 * Math.pow(2, n / 12), i === 3 ? 0.4 : 0.12, 0.05, i * 0.11));
  }

  lose(): void {
    [7, 4, 0, -5].forEach((n, i) => this.tone('triangle', 392 * Math.pow(2, n / 12), 392 * Math.pow(2, n / 12), 0.22, 0.06, i * 0.16));
  }

  /** The object landing on a character. Quieter for the far side. */
  impact(object: HitObject, blocked: boolean, delay: number, near = true): void {
    const k = near ? 1 : 0.6;
    if (blocked) {
      // Boing off the umbrella.
      this.tone('sine', 300, 700, 0.25, 0.12 * k, delay);
      return;
    }
    switch (object) {
      case 'apple':
        this.tone('sine', 700, 220, 0.12, 0.22 * k, delay);
        break;
      case 'flowerpot':
        this.tone('sine', 500, 180, 0.1, 0.18 * k, delay);
        this.noise(0.22, 0.2 * k, 3500, 0.8, delay + 0.02, 'bandpass');
        break;
      case 'bowling':
        this.tone('sine', 140, 50, 0.3, 0.35 * k, delay);
        this.noise(0.5, 0.06 * k, 400, 1, delay + 0.05);
        break;
      case 'anvil':
        this.tone('sine', 120, 40, 0.3, 0.35 * k, delay);
        this.clang(420, 0.9, 0.08 * k, delay);
        break;
      case 'piano': {
        this.noise(0.4, 0.3 * k, 1200, 0.7, delay);
        // A messy cluster of strings ringing out.
        for (const n of [-12, -5, 0, 1, 6, 11, 13]) this.tone('triangle', 262 * Math.pow(2, n / 12), 262 * Math.pow(2, n / 12), 1.2, 0.04 * k, delay + Math.random() * 0.04);
        break;
      }
      case 'cow':
        this.tone('sine', 110, 40, 0.3, 0.35 * k, delay);
        this.moo(delay + 0.1, k);
        break;
      case 'car':
        this.noise(1.2, 0.35 * k, 2200, 0.6, delay);
        this.tone('sine', 90, 30, 0.6, 0.4 * k, delay);
        this.clang(310, 0.7, 0.06 * k, delay + 0.05);
        this.clang(470, 0.6, 0.05 * k, delay + 0.18);
        // A last sad honk.
        this.tone('square', 392, 392, 0.18, 0.04 * k, delay + 0.7);
        this.tone('square', 370, 370, 0.3, 0.04 * k, delay + 0.9);
        break;
    }
  }

  private moo(delay: number, k: number): void {
    const c = this.ready;
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(165, t + 0.25);
    osc.frequency.linearRampToValueAtTime(105, t + 0.9);
    const formant = c.createBiquadFilter();
    formant.type = 'bandpass';
    formant.Q.value = 3;
    formant.frequency.setValueAtTime(500, t);
    formant.frequency.linearRampToValueAtTime(800, t + 0.3);
    formant.frequency.linearRampToValueAtTime(400, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4 * k, t + 0.08);
    g.gain.setValueAtTime(0.4 * k, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    osc.connect(formant).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 1);
  }
}
