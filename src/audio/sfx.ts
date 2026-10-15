/** Sound effect definitions: short synthesised blips, sweeps and noise bursts. */
export type Sfx =
  | 'eat' | 'bigEat' | 'graze' | 'sting' | 'hurt' | 'death' | 'clean'
  | 'select' | 'hover' | 'confirm' | 'back' | 'upgrade' | 'warn' | 'win' | 'start' | 'discover';

export interface SfxNote {
  f: number;
  /** Slide to this frequency over the note. */
  to?: number;
  d: number;
  type?: OscillatorType;
  v?: number;
  at?: number;
  /** Use filtered noise instead of an oscillator. */
  noise?: boolean;
}

const arp = (freqs: number[], step: number, d: number, type: OscillatorType = 'square', v = 0.3): SfxNote[] =>
  freqs.map((f, i) => ({ f, d, type, v, at: i * step }));

export const SFX: Record<Sfx, SfxNote[]> = {
  eat: [{ f: 520, to: 1040, d: 0.09, type: 'square', v: 0.35 }],
  bigEat: [{ f: 330, to: 660, d: 0.1, type: 'square', v: 0.4 }, { f: 660, to: 1320, d: 0.12, type: 'square', v: 0.35, at: 0.09 }],
  graze: [{ f: 760, to: 900, d: 0.06, type: 'triangle', v: 0.35 }],
  sting: [{ f: 200, to: 60, d: 0.3, type: 'sawtooth', v: 0.4 }, { f: 3000, d: 0.12, noise: true, v: 0.25 }],
  hurt: [{ f: 240, to: 110, d: 0.18, type: 'square', v: 0.4 }],
  death: [{ f: 440, to: 55, d: 1.0, type: 'square', v: 0.4 }, { f: 1200, d: 0.5, noise: true, v: 0.15, at: 0.1 }],
  clean: arp([1046, 1318, 1568, 2093], 0.06, 0.08, 'triangle', 0.35),
  select: [{ f: 880, d: 0.05, type: 'square', v: 0.22 }],
  hover: [{ f: 1320, d: 0.02, type: 'triangle', v: 0.12 }],
  confirm: arp([523, 784, 1046], 0.06, 0.08, 'square', 0.28),
  back: [{ f: 660, to: 440, d: 0.08, type: 'square', v: 0.22 }],
  upgrade: arp([523, 659, 784, 1046, 1318], 0.06, 0.09, 'square', 0.3),
  warn: [{ f: 160, d: 0.14, type: 'square', v: 0.35 }, { f: 160, d: 0.14, type: 'square', v: 0.35, at: 0.18 }],
  win: arp([523, 659, 784, 659, 784, 1046], 0.09, 0.11, 'square', 0.3),
  start: [...arp([392, 523, 659, 784, 1046], 0.05, 0.12, 'square', 0.28), { f: 2000, to: 400, d: 0.4, noise: true, v: 0.12 }],
  discover: arp([1568, 2093], 0.07, 0.08, 'triangle', 0.25),
};
