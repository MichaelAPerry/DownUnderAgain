/**
 * WebAudio engine: context lifecycle (unlock, visibility), mix buses
 * (music / sfx -> master -> compressor), an underwater echo send, sound
 * effects, and a look-ahead music sequencer. No audio files: everything is
 * synthesised.
 */
import { SFX } from './sfx';
import type { Sfx } from './sfx';
import { compileSong, isDrumKit, midiToHz } from './songFormat';
import type { CompiledSong, DrumHit, Instrument, Song, Wave } from './songFormat';

const LOOKAHEAD = 0.15; // seconds of music scheduled ahead
const TICK_MS = 25;
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 0.7;

interface AudioSessionNav {
  audioSession?: { type: string };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private sfxBus!: GainNode;
  private echoIn!: GainNode;
  private noise!: AudioBuffer;
  private waves = new Map<Wave, PeriodicWave>();

  private muted = false;
  private musicOn = true;
  private sfxOn = true;

  private song: CompiledSong | null = null;
  private songGain: GainNode | null = null;
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingSong: Song | null = null;
  private ducked = false;
  private readonly compiled = new Map<string, CompiledSong>();
  private readonly ended = new Set<() => void>();

  /** True once the browser lets us make sound. */
  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  get currentSongId(): string | null {
    return this.song?.song.id ?? this.pendingSong?.id ?? null;
  }

  /**
   * Create/resume the context. Must run inside a user-gesture handler
   * (click, keydown, touchend, pointerup) or browsers keep it suspended.
   */
  unlock(): void {
    try {
      const nav = navigator as Navigator & AudioSessionNav;
      // Safari: play even with the iOS ringer switch on silent.
      if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback';
    } catch {
      // Not supported; harmless.
    }
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build(this.ctx);
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') void ctx.resume().then(() => this.startPending());
    // iOS needs a sound started inside the gesture; a 1-sample silent buffer does it.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start();
    this.startPending();
  }

  /** Pause all audio while the tab is hidden. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyLevels();
  }

  setMusicOn(on: boolean): void {
    this.musicOn = on;
    this.applyLevels();
  }

  setSfxOn(on: boolean): void {
    this.sfxOn = on;
    this.applyLevels();
  }

  /** Muffle and lower the music (pause / shop menus). */
  duck(on: boolean): void {
    if (this.ducked === on) return;
    this.ducked = on;
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.musicFilter.frequency.cancelScheduledValues(t);
    this.musicFilter.frequency.setTargetAtTime(on ? 700 : 18000, t, 0.08);
    this.applyLevels();
  }

  // ---- sound effects -----------------------------------------------------

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted || !this.sfxOn) return;
    const t0 = ctx.currentTime + 0.005;
    for (const n of SFX[name]) {
      const start = t0 + (n.at ?? 0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(n.v ?? 0.3, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
      g.connect(this.sfxBus);
      if (n.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = n.f;
        src.connect(bp).connect(g);
        src.start(start, Math.random() * 0.5, n.d + 0.02);
      } else {
        const osc = ctx.createOscillator();
        osc.type = n.type ?? 'square';
        osc.frequency.setValueAtTime(n.f, start);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.d);
        osc.connect(g);
        osc.start(start);
        osc.stop(start + n.d + 0.03);
      }
    }
  }

  // ---- music -------------------------------------------------------------

  /**
   * Play a song (crossfading from the current one). Calling with the song
   * already playing does nothing unless `restart` is set. If audio isn't
   * unlocked yet, the song starts as soon as it is.
   */
  playSong(song: Song, opts: { restart?: boolean; fade?: number } = {}): void {
    if (!opts.restart && this.currentSongId === song.id) return;
    this.pendingSong = song;
    if (this.ready) this.startPending(opts.fade);
  }

  stopSong(fade = 0.6): void {
    this.pendingSong = null;
    this.fadeOutCurrent(fade);
  }

  /** Called once when a non-looping song (jingle) finishes. */
  onSongEnd(fn: () => void): () => void {
    this.ended.add(fn);
    return () => this.ended.delete(fn);
  }

  private startPending(fade = 0.5): void {
    const ctx = this.ctx;
    const song = this.pendingSong;
    if (!ctx || !song || ctx.state !== 'running') return;
    this.pendingSong = null;
    this.fadeOutCurrent(fade);
    let compiled = this.compiled.get(song.id);
    if (!compiled) {
      compiled = compileSong(song);
      this.compiled.set(song.id, compiled);
    }
    this.song = compiled;
    this.songGain = ctx.createGain();
    this.songGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.songGain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + Math.max(0.05, fade));
    this.songGain.connect(this.musicFilter);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.08;
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private fadeOutCurrent(fade: number): void {
    const ctx = this.ctx;
    const g = this.songGain;
    this.song = null;
    this.songGain = null;
    if (!ctx || !g) return;
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
    setTimeout(() => g.disconnect(), (fade + 0.5) * 1000);
  }

  private tick(): void {
    const ctx = this.ctx;
    const s = this.song;
    const out = this.songGain;
    if (!ctx || !s || !out || ctx.state !== 'running') return;
    // After a long stall (tab hidden), don't try to catch up on missed notes.
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      for (const tr of s.tracks) {
        const evs = tr.byStep.get(this.step);
        if (!evs) continue;
        for (const ev of evs) {
          if (isDrumKit(tr.instrument)) this.drum(ev.note as DrumHit, this.nextTime, tr.instrument.volume, out);
          else this.note(ev.note as number, ev.length * s.stepSeconds, this.nextTime, tr.instrument, out);
        }
      }
      this.nextTime += s.stepSeconds;
      this.step++;
      if (this.step >= s.totalSteps) {
        if (s.song.loop) this.step = 0;
        else {
          const endAt = this.nextTime;
          this.song = null;
          const g = out;
          setTimeout(() => {
            if (this.songGain === g) this.songGain = null;
            g.disconnect();
            for (const fn of [...this.ended]) fn();
          }, Math.max(0, (endAt - ctx.currentTime) * 1000) + 600);
          return;
        }
      }
    }
  }

  private note(midi: number, dur: number, t: number, ins: Instrument, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const wave = this.waves.get(ins.wave);
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = ins.wave as OscillatorType;
    osc.frequency.setValueAtTime(midiToHz(midi), t);
    if (ins.detune) osc.detune.setValueAtTime(ins.detune, t);
    if (ins.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = ins.vibrato.rate;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(ins.vibrato.depth, t + (ins.vibrato.delay ?? 0.15) + 0.05);
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + ins.release + 0.05);
    }
    const g = ctx.createGain();
    const peak = Math.max(0.0002, ins.volume);
    const sus = Math.max(0.0001, peak * ins.sustain);
    const a = Math.max(0.003, ins.attack);
    const end = t + Math.max(dur, a + 0.01);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(sus, Math.min(end, t + a + Math.max(0.005, ins.decay)));
    g.gain.setValueAtTime(sus, end);
    g.gain.exponentialRampToValueAtTime(0.0001, end + Math.max(0.01, ins.release));
    osc.connect(g);
    g.connect(out);
    if (ins.echo) {
      const send = ctx.createGain();
      send.gain.value = ins.echo;
      g.connect(send).connect(this.echoIn);
    }
    osc.start(t);
    osc.stop(end + ins.release + 0.05);
  }

  private drum(hit: DrumHit, t: number, volume: number, out: AudioNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = ctx.createGain();
    g.connect(out);
    if (hit === 'K') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      g.gain.setValueAtTime(volume, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + 0.25);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    const len = hit === 'S' ? 0.16 : hit === 'O' ? 0.22 : 0.045;
    f.type = hit === 'S' ? 'bandpass' : 'highpass';
    f.frequency.value = hit === 'S' ? 1800 : 7000;
    const lvl = hit === 'S' ? volume * 0.8 : volume * 0.35;
    g.gain.setValueAtTime(lvl, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 0.5, len + 0.02);
    if (hit === 'S') {
      const body = ctx.createOscillator();
      const bg = ctx.createGain();
      body.type = 'triangle';
      body.frequency.setValueAtTime(190, t);
      bg.gain.setValueAtTime(volume * 0.5, t);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      body.connect(bg).connect(out);
      body.start(t);
      body.stop(t + 0.1);
    }
  }

  // ---- offline rendering (dev tooling) -----------------------------------

  /**
   * Render a song through the same synth graph into an AudioBuffer, faster
   * than real time. Used by `npm run music` to export previews and check
   * levels; not used during play.
   */
  static async renderOffline(song: Song, loops = 1, tail = 2): Promise<AudioBuffer> {
    const c = compileSong(song);
    const seconds = c.totalSteps * c.stepSeconds * loops + tail;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
    const eng = new AudioEngine();
    eng.ctx = ctx as unknown as AudioContext;
    eng.build(ctx as unknown as AudioContext);
    const out = ctx.createGain();
    out.connect(eng.musicFilter);
    for (let l = 0; l < loops; l++) {
      for (let step = 0; step < c.totalSteps; step++) {
        const t = 0.05 + (l * c.totalSteps + step) * c.stepSeconds;
        for (const tr of c.tracks) {
          for (const ev of tr.byStep.get(step) ?? []) {
            if (isDrumKit(tr.instrument)) eng.drum(ev.note as DrumHit, t, tr.instrument.volume, out);
            else eng.note(ev.note as number, ev.length * c.stepSeconds, t, tr.instrument, out);
          }
        }
      }
    }
    return ctx.startRendering();
  }

  // ---- setup -------------------------------------------------------------

  private build(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicBus = ctx.createGain();
    this.musicFilter.connect(this.musicBus).connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    // Underwater echo: delay with filtered feedback, into the music bus.
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    this.echoIn.connect(delay);
    delay.connect(lp).connect(fb).connect(delay);
    lp.connect(this.musicFilter);
    // Shared white-noise buffer for drums and noisy effects.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // Pulse waves for that 8-bit lead sound.
    for (const [w, duty] of [['pulse25', 0.25], ['pulse12', 0.125]] as const) {
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      this.waves.set(w, ctx.createPeriodicWave(real, imag));
    }
    this.applyLevels();
  }

  private applyLevels(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(v, t, 0.05);
    };
    set(this.master.gain, this.muted ? 0 : 0.9);
    set(this.musicBus.gain, this.musicOn ? MUSIC_LEVEL * (this.ducked ? 0.55 : 1) : 0);
    set(this.sfxBus.gain, this.sfxOn ? SFX_LEVEL : 0);
  }
}
