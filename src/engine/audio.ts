/** Tiny WebAudio chiptune SFX synth. No assets; created on first user gesture. */
export type Sfx = 'eat' | 'bigEat' | 'graze' | 'sting' | 'hurt' | 'death' | 'clean' | 'select' | 'confirm' | 'upgrade' | 'warn' | 'win';

interface Note {
  f: number;
  to?: number;
  d: number;
  type?: OscillatorType;
  v?: number;
  at?: number;
}

const SFX: Record<Sfx, Note[]> = {
  eat: [{ f: 520, to: 880, d: 0.07, type: 'square', v: 0.12 }],
  bigEat: [{ f: 330, to: 660, d: 0.08, type: 'square' }, { f: 660, to: 990, d: 0.1, type: 'square', at: 0.08 }],
  graze: [{ f: 700, to: 760, d: 0.04, type: 'triangle', v: 0.1 }],
  sting: [{ f: 180, to: 60, d: 0.25, type: 'sawtooth', v: 0.18 }],
  hurt: [{ f: 220, to: 110, d: 0.15, type: 'square', v: 0.14 }],
  death: [{ f: 440, to: 55, d: 0.9, type: 'square', v: 0.16 }],
  clean: [{ f: 1046, d: 0.06, type: 'triangle' }, { f: 1318, d: 0.06, type: 'triangle', at: 0.06 }, { f: 1568, d: 0.1, type: 'triangle', at: 0.12 }],
  select: [{ f: 660, d: 0.04, type: 'square', v: 0.08 }],
  confirm: [{ f: 523, d: 0.06, type: 'square' }, { f: 784, d: 0.1, type: 'square', at: 0.06 }],
  upgrade: [523, 659, 784, 1046].map((f, i) => ({ f, d: 0.08, type: 'square' as OscillatorType, at: i * 0.07 })),
  warn: [{ f: 150, d: 0.12, type: 'square', v: 0.12 }],
  win: [523, 659, 784, 659, 784, 1046].map((f, i) => ({ f, d: 0.1, type: 'square' as OscillatorType, at: i * 0.09 })),
};

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  play(name: Sfx): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    for (const n of SFX[name]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const start = t0 + (n.at ?? 0);
      osc.type = n.type ?? 'square';
      osc.frequency.setValueAtTime(n.f, start);
      if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.d);
      g.gain.setValueAtTime(n.v ?? 0.12, start);
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(start + n.d + 0.02);
    }
  }
}
