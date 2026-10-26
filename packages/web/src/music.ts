/**
 * Background music: two original chiptune loops played live with the Web
 * Audio API, like the sound effects. Notes are scheduled a little ahead of
 * time on the audio clock, so the beat stays steady even if a frame is late.
 */

export type TrackId = 'menu' | 'match';

interface Chord {
  /** MIDI note of the root, around octave 3. */
  root: number;
  minor: boolean;
}

interface Track {
  bpm: number;
  /** One chord per bar. */
  chords: Chord[];
  /** Eighth notes, one array of 8 per bar (MIDI, or null to hold or rest). Loops with the chords. */
  melody: (number | null)[][];
  lead: OscillatorType;
  arp: OscillatorType;
  /** Arpeggio notes per beat: 4 = sixteenths, 2 = eighths. */
  arpRate: number;
  drums: boolean;
}

const _ = null;
const Am = { root: 57, minor: true };
const Em = { root: 52, minor: true };
const F = { root: 53, minor: false };
const C = { root: 48, minor: false };
const G = { root: 55, minor: false };

const TRACKS: Record<TrackId, Track> = {
  menu: {
    bpm: 92,
    chords: [Am, Em, F, G, Am, Em, F, G],
    melody: [
      [76, _, _, _, 72, _, _, _],
      [71, _, _, _, 67, _, 71, _],
      [72, _, _, _, 69, _, _, _],
      [71, _, 74, _, 79, _, _, _],
      [76, _, 79, _, 81, _, _, _],
      [79, _, 76, _, 71, _, _, _],
      [72, _, 74, _, 77, _, 76, _],
      [74, _, _, _, 71, _, _, _],
    ],
    lead: 'sine',
    arp: 'triangle',
    arpRate: 2,
    drums: false,
  },
  match: {
    bpm: 138,
    chords: [Am, F, C, G, Am, F, C, G],
    melody: [
      [76, _, 72, 74, 76, _, 74, 72],
      [69, _, 72, _, 77, 76, 74, _],
      [72, _, 76, _, 79, _, 76, 74],
      [71, _, 74, _, 79, _, _, _],
      [81, _, 79, 76, 77, _, 76, 74],
      [72, _, 74, 76, 77, _, 74, _],
      [76, _, 72, _, 74, _, 71, _],
      [69, _, _, _, 67, _, 71, _],
    ],
    lead: 'square',
    arp: 'square',
    arpRate: 4,
    drums: true,
  },
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
/** How far ahead notes are scheduled, in seconds. */
const LOOKAHEAD = 0.25;

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.5;
  private track: TrackId | null = null;
  /** Gain for the track now playing, so a switch can fade it out. */
  private trackGain: GainNode | null = null;
  /** Next eighth note to schedule, counted from the track's start, and when it plays. */
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  setVolume(percent: number): void {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    if (this.out) this.out.gain.value = this.volume * 0.22;
  }

  /** Plays `track` (null for silence), starting or fading over as needed. */
  play(ctx: AudioContext | null, track: TrackId | null): void {
    if (!ctx || ctx.state !== 'running') return;
    if (!this.ctx) this.attach(ctx);
    if (track === this.track) return;
    this.fadeOut();
    this.track = track;
    if (!track) return;
    this.trackGain = ctx.createGain();
    this.trackGain.connect(this.out!);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer ??= setInterval(() => this.schedule(), 50);
    this.schedule();
  }

  private attach(ctx: AudioContext): void {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.volume * 0.22;
    this.out.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  private fadeOut(): void {
    const g = this.trackGain;
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    setTimeout(() => g.disconnect(), 1000);
    this.trackGain = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.track || !this.trackGain) return;
    const track = TRACKS[this.track];
    const eighth = 60 / track.bpm / 2;
    // After a long stall (a hidden tab), pick up from now instead of rushing to catch up.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(track, this.step, this.nextTime, eighth);
      this.step++;
      this.nextTime += eighth;
    }
  }

  /** Everything that starts on one eighth note. */
  private playStep(track: Track, step: number, t: number, eighth: number): void {
    const bars = track.chords.length;
    const bar = Math.floor(step / 8) % bars;
    const pos = step % 8;
    const chord = track.chords[bar];
    const tones = [0, chord.minor ? 3 : 4, 7, 12];

    // Bass: the root on every eighth, a little accent on the beat.
    this.note('triangle', hz(chord.root - 12), t, eighth * 0.9, pos % 2 === 0 ? 0.5 : 0.35);

    // Arpeggio through the chord, an octave up.
    for (let i = 0; i < track.arpRate / 2; i++) {
      const k = (pos * (track.arpRate / 2) + i) % tones.length;
      const dt = (eighth / (track.arpRate / 2)) * i;
      this.note(track.arp, hz(chord.root + 12 + tones[k]), t + dt, eighth / (track.arpRate / 2) * 0.8, track.drums ? 0.08 : 0.12);
    }

    // Melody: a note lasts until the next one, up to half a bar.
    const line = track.melody[bar];
    const midi = line[pos];
    if (midi !== null) {
      let len = 1;
      while (pos + len < 8 && line[pos + len] === null && len < 4) len++;
      this.note(track.lead, hz(midi), t, eighth * len * 0.95, track.drums ? 0.13 : 0.22);
    }

    if (track.drums) {
      if (pos === 0 || pos === 4) this.kick(t);
      if (pos === 2 || pos === 6) this.hit(t, 0.12, 1800, 'bandpass', 0.18);
      this.hit(t, 0.04, 8000, 'highpass', pos % 2 === 1 ? 0.07 : 0.035);
    }
  }

  private note(type: OscillatorType, freq: number, t: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.trackGain!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    osc.connect(g).connect(this.trackGain!);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  private hit(t: number, dur: number, freq: number, type: BiquadFilterType, gain: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.trackGain!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }
}
