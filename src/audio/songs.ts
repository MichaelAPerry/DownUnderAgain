/**
 * The soundtrack: song data for the tracker engine (see songFormat.ts).
 *
 * Patterns are written with the `p()` shorthand: space-separated items
 * `TOKEN:len`, where len is the number of 16th steps (default 1). A note
 * item expands to the note followed by holds, a rest item to rests, so
 * `C5:4 _:2 E5:2` becomes `C5 . . . _ _ E5 .`. Every pattern must come to
 * exactly one bar (16 steps); `p()` throws at load time otherwise.
 */
import type { DrumKit, Instrument, Song } from './songFormat';

export const SONG_IDS = ['title', 'freshwater', 'reef', 'blue', 'abyss', 'stageClear', 'gameOver', 'victory'] as const;
export type SongId = (typeof SONG_IDS)[number];

// ---- authoring helpers ------------------------------------------------------

/** Expand `TOKEN:len` shorthand into a 16-step pattern string. */
function p(src: string): string {
  const out: string[] = [];
  for (const item of src.trim().split(/\s+/)) {
    const [tok = '_', n = '1'] = item.split(':');
    const len = Number(n);
    if (!Number.isInteger(len) || len < 1) throw new Error(`bad length in "${item}"`);
    out.push(tok);
    const fill = tok === '_' ? '_' : DRUM_TOKENS.has(tok) ? '_' : '.';
    for (let i = 1; i < len; i++) out.push(fill);
  }
  if (out.length !== 16) throw new Error(`pattern "${src}" has ${out.length} steps, expected 16`);
  return out.join(' ');
}
const DRUM_TOKENS = new Set(['K', 'S', 'H', 'O']);

/** Map each value of an object through `p()`. */
function pats(src: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) out[k] = p(v);
  return out;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SEMI: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(tok: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(tok);
  if (!m) throw new Error(`bad note ${tok}`);
  return (Number(m[3]) + 1) * 12 + (SEMI[m[1] as string] as number) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const name = (n: number): string => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

/** Transpose every note of an expanded pattern by `semis`. */
function transpose(pattern: string, semis: number): string {
  return pattern
    .split(' ')
    .map((t) => (t === '.' || t === '_' ? t : name(midi(t) + semis)))
    .join(' ');
}

/**
 * Arpeggiate one or more chords across a bar (the bar is split evenly
 * between them), one note every `rate` steps, walking `order` through the
 * chord's notes.
 */
function arp(chords: string[][], rate = 1, order = [0, 1, 2, 1]): string {
  const out: string[] = [];
  const per = 16 / chords.length;
  chords.forEach((notes) => {
    for (let i = 0; i < per; i += rate) {
      out.push(notes[(order[(i / rate) % order.length] as number) % notes.length] as string);
      for (let k = 1; k < rate; k++) out.push('.');
    }
  });
  return out.join(' ');
}

// ---- instruments -------------------------------------------------------------

const kit = (volume: number): DrumKit => ({ drums: true, volume });

const INS = {
  /** Bright pulse lead with a gentle, late vibrato. */
  heroLead: { wave: 'pulse25', attack: 0.008, decay: 0.14, sustain: 0.62, release: 0.12, volume: 0.22, echo: 0.14, vibrato: { rate: 5.5, depth: 16, delay: 0.22 } },
  /** Thin octave-below double for the reprise. */
  heroDouble: { wave: 'pulse12', attack: 0.008, decay: 0.12, sustain: 0.5, release: 0.1, volume: 0.08, detune: 7 },
  /** Bouncy triangle bass. */
  bounceBass: { wave: 'triangle', attack: 0.004, decay: 0.12, sustain: 0.75, release: 0.06, volume: 0.32 },
  /** Fast pulse12 arpeggio. */
  sparkleArp: { wave: 'pulse12', attack: 0.002, decay: 0.07, sustain: 0.28, release: 0.04, volume: 0.075, echo: 0.1 },

  rippleArp: { wave: 'triangle', attack: 0.01, decay: 0.25, sustain: 0.35, release: 0.3, volume: 0.13, echo: 0.42 },
  softLead: { wave: 'pulse12', attack: 0.03, decay: 0.22, sustain: 0.6, release: 0.25, volume: 0.15, echo: 0.28, vibrato: { rate: 5, depth: 14, delay: 0.28 } },
  roundBass: { wave: 'triangle', attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.25, volume: 0.28 },

  steelPan: { wave: 'sine', attack: 0.002, decay: 0.12, sustain: 0.15, release: 0.12, volume: 0.26, echo: 0.25 },
  panShimmer: { wave: 'triangle', attack: 0.002, decay: 0.08, sustain: 0.05, release: 0.08, volume: 0.05, detune: 9 },
  stab: { wave: 'pulse25', attack: 0.002, decay: 0.07, sustain: 0.06, release: 0.04, volume: 0.055 },

  pad: { wave: 'triangle', attack: 0.5, decay: 0.8, sustain: 0.8, release: 1.6, volume: 0.1, echo: 0.55 },
  padAir: { wave: 'sine', attack: 0.6, decay: 0.8, sustain: 0.8, release: 1.8, volume: 0.09, echo: 0.6, detune: -6 },
  lonelyLead: { wave: 'triangle', attack: 0.06, decay: 0.4, sustain: 0.75, release: 0.6, volume: 0.24, echo: 0.45, vibrato: { rate: 4.5, depth: 22, delay: 0.35 } },
  deepBass: { wave: 'sine', attack: 0.08, decay: 0.5, sustain: 0.8, release: 0.8, volume: 0.32 },

  drone: { wave: 'sine', attack: 1.2, decay: 0.8, sustain: 0.85, release: 2, volume: 0.3 },
  droneEdge: { wave: 'triangle', attack: 1.5, decay: 1, sustain: 0.8, release: 2, volume: 0.1, detune: 7 },
  droneThird: { wave: 'sine', attack: 1.5, decay: 1, sustain: 0.8, release: 2, volume: 0.07 },
  glow: { wave: 'triangle', attack: 0.6, decay: 1, sustain: 0.7, release: 1.6, volume: 0.11, echo: 0.5, vibrato: { rate: 3, depth: 20, delay: 0.5 } },
  ping: { wave: 'sine', attack: 0.002, decay: 0.35, sustain: 0.001, release: 0.9, volume: 0.12, echo: 0.75 },

  fanfare: { wave: 'pulse25', attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.35, volume: 0.24, vibrato: { rate: 6, depth: 18, delay: 0.25 } },
  brass: { wave: 'pulse12', attack: 0.005, decay: 0.1, sustain: 0.6, release: 0.35, volume: 0.1 },
  sadLead: { wave: 'pulse25', attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.5, volume: 0.22, echo: 0.2, vibrato: { rate: 4.5, depth: 30, delay: 0.15 } },
  sadPad: { wave: 'triangle', attack: 0.08, decay: 0.4, sustain: 0.7, release: 0.8, volume: 0.1 },
} satisfies Record<string, Instrument>;

// ---- 1. title: "Down Under Again" -------------------------------------------
// F major, 116 BPM. Intro 2 + A 8 + B 8 + A' 8 = 26 bars.
// The hook (bars A1-A4) climbs a broken F triad with a syncopated top note,
// repeats a third lower over Dm, then rises to D6 over Bb and falls back over C.

const titleChords = {
  F: ['F4', 'A4', 'C5'],
  Dm: ['F4', 'A4', 'D5'],
  Bb: ['F4', 'Bb4', 'D5'],
  C: ['E4', 'G4', 'C5'],
  C7: ['E4', 'Bb4', 'C5'],
  Gm: ['G4', 'Bb4', 'D5'],
  A: ['E4', 'A4', 'C#5'],
};

const titleLead = pats({
  // Intro: F | C7 (pickup into the hook)
  in2: '_:8 E4:2 G4:2 Bb4:2 G4:2',
  // A: F | Dm | Bb | C | F | Dm | Bb C | F
  h1: 'A4:2 C5:2 F5:3 E5:1 F5:2 A5:4 G5:2',
  h2: 'F5:2 E5:2 D5:3 A4:1 D5:2 F5:4 E5:2',
  h3: 'D5:2 F5:2 Bb5:3 A5:1 Bb5:2 C6:2 D6:4',
  h4: 'C6:2 Bb5:2 G5:3 A5:1 G5:2 E5:2 C5:4',
  h7: 'D5:2 F5:2 Bb5:4 C6:2 Bb5:2 G5:2 E5:2',
  h8: 'F5:3 C5:1 A4:2 C5:2 F5:4 _:4',
  h8b: 'F5:3 C5:1 A4:2 C5:2 F5:2 A5:2 C6:2 F6:2',
  // B (relative minor): Dm | Bb | Gm | A | Dm | Bb | Gm | C7
  b1: 'A5:4 F5:2 E5:2 D5:4 F5:2 A5:2',
  b2: 'Bb5:6 A5:2 F5:4 D5:4',
  b3: 'G5:4 Bb5:2 A5:2 G5:4 D5:2 E5:2',
  b4: 'E5:4 C#5:2 E5:2 A5:6 G5:2',
  b5: 'F5:4 A5:2 C6:1 D6:3 A5:2 F5:4',
  b6: 'D6:6 C6:2 Bb5:4 F5:2 G5:2',
  b7: 'Bb5:6 A5:2 G5:4 D5:2 E5:2',
  b8: 'E5:4 G5:2 Bb5:2 C6:6 Bb5:1 A5:1',
});

const TITLE_A = ['h1', 'h2', 'h3', 'h4', 'h1', 'h2', 'h7', 'h8'];
const TITLE_B = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
const TITLE_A2 = ['h1', 'h2', 'h3', 'h4', 'h1', 'h2', 'h7', 'h8b'];

const title: Song = {
  id: 'title',
  title: 'Down Under Again',
  bpm: 116,
  loop: true,
  tracks: [
    {
      name: 'lead',
      instrument: INS.heroLead,
      patterns: titleLead,
      sequence: ['-', 'in2', ...TITLE_A, ...TITLE_B, ...TITLE_A2],
    },
    {
      // In the reprise a thin pulse doubles the hook an octave down.
      name: 'double',
      instrument: INS.heroDouble,
      patterns: Object.fromEntries(Object.entries(titleLead).map(([k, v]) => [k, transpose(v, -12)])),
      sequence: ['-', '-', ...TITLE_A.map(() => '-'), ...TITLE_B.map(() => '-'), ...TITLE_A2],
    },
    {
      name: 'bass',
      instrument: INS.bounceBass,
      patterns: pats({
        // root / fifth / octave bounce; the last 8th steps into the next root
        F_C: 'F2:2 _:1 F2:1 C3:2 F2:2 A2:2 C3:2 F3:2 D3:2',
        C7_F: 'C3:2 _:1 C3:1 G2:2 Bb2:2 E3:2 C3:2 Bb2:2 G2:2',
        F_Dm: 'F2:2 _:1 F2:1 C3:2 F2:2 A2:2 C3:2 F3:2 E3:2',
        F_F: 'F2:2 _:1 F2:1 C3:2 F2:2 A2:2 C3:2 F3:2 E2:2',
        Dm_Bb: 'D3:2 _:1 D3:1 A2:2 D3:2 F3:2 D3:2 A2:2 C3:2',
        Bb_C: 'Bb2:2 _:1 Bb2:1 F2:2 Bb2:2 D3:2 Bb2:2 F2:2 B2:2',
        Bb_Gm: 'Bb2:2 _:1 Bb2:1 F2:2 Bb2:2 D3:2 Bb2:2 F2:2 A2:2',
        C_F: 'C3:2 _:1 C3:1 E3:2 C3:2 G2:2 C3:2 G2:2 E2:2',
        BbC_F: 'Bb2:2 _:1 Bb2:1 F2:2 D3:2 C3:2 _:1 C3:1 E3:2 E2:2',
        Gm_A: 'G2:2 _:1 G2:1 D3:2 G2:2 Bb2:2 D3:2 G3:2 G#2:2',
        Gm_C: 'G2:2 _:1 G2:1 D3:2 G2:2 Bb2:2 D3:2 G2:2 B2:2',
        A_Dm: 'A2:2 _:1 A2:1 E3:2 A2:2 C#3:2 E3:2 A2:2 C#3:2',
      }),
      sequence: [
        'F_C', 'C7_F',
        'F_Dm', 'Dm_Bb', 'Bb_C', 'C_F', 'F_Dm', 'Dm_Bb', 'BbC_F', 'F_Dm',
        'Dm_Bb', 'Bb_Gm', 'Gm_A', 'A_Dm', 'Dm_Bb', 'Bb_Gm', 'Gm_C', 'C7_F',
        'F_Dm', 'Dm_Bb', 'Bb_C', 'C_F', 'F_Dm', 'Dm_Bb', 'BbC_F', 'F_F',
      ],
    },
    {
      name: 'arp',
      instrument: INS.sparkleArp,
      patterns: {
        F: arp([titleChords.F]),
        Dm: arp([titleChords.Dm]),
        Bb: arp([titleChords.Bb]),
        C: arp([titleChords.C]),
        C7: arp([titleChords.C7]),
        BbC: arp([titleChords.Bb, titleChords.C]),
        Gm: arp([titleChords.Gm]),
        A: arp([titleChords.A]),
        // B section: calmer 8th-note arps for contrast
        Dm8: arp([titleChords.Dm], 2, [0, 1, 2, 1]),
        Bb8: arp([titleChords.Bb], 2, [0, 1, 2, 1]),
        Gm8: arp([titleChords.Gm], 2, [0, 1, 2, 1]),
        A8: arp([titleChords.A], 2, [0, 1, 2, 1]),
        C78: arp([titleChords.C7], 2, [0, 1, 2, 1]),
      },
      sequence: [
        'F', 'C7',
        'F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'BbC', 'F',
        'Dm8', 'Bb8', 'Gm8', 'A8', 'Dm8', 'Bb8', 'Gm8', 'C78',
        'F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'BbC', 'F',
      ],
    },
    {
      name: 'kick',
      instrument: kit(0.45),
      patterns: pats({
        intro: 'K:8 K:8',
        beat: 'K:4 S:3 K:1 K:4 S:4',
        fill: 'K:4 S:3 K:1 K:2 S:2 S S S S',
        half: 'K:6 K:2 S:8',
        halfFill: 'K:6 K:2 S:4 S:2 S S',
      }),
      sequence: [
        'intro', 'fill',
        'beat', 'beat', 'beat', 'beat', 'beat', 'beat', 'beat', 'fill',
        'half', 'half', 'half', 'half', 'half', 'half', 'half', 'halfFill',
        'beat', 'beat', 'beat', 'beat', 'beat', 'beat', 'beat', 'fill',
      ],
    },
    {
      name: 'hats',
      instrument: kit(0.4),
      patterns: pats({
        eighths: 'H:2 H:2 H:2 H:2 H:2 H:2 H:2 H:2',
        open: 'H:2 H:2 H:2 H:2 H:2 H:2 H:2 O:2',
      }),
      sequence: [
        '-', 'open',
        ...['eighths', 'eighths', 'eighths', 'open', 'eighths', 'eighths', 'eighths', 'open'],
        ...['eighths', 'eighths', 'eighths', 'open', 'eighths', 'eighths', 'eighths', 'open'],
        ...['eighths', 'eighths', 'eighths', 'open', 'eighths', 'eighths', 'eighths', 'open'],
      ],
    },
  ],
};

// ---- 2. freshwater: Spring Run & Mangrove Estuary ---------------------------
// D major (pentatonic-leaning), 92 BPM, 20 bars.
// Intro: D | G/D | D | A    A: D | G | Bm | A | D | G | Em7 | A
// B: G | A | F#m | Bm | G | A | Em | Asus4-A
// The 8th-note arps ripple; the 0.33 s echo lands almost exactly on the next 8th.

const freshwater: Song = {
  id: 'freshwater',
  title: 'Spring Run',
  bpm: 92,
  loop: true,
  tracks: [
    {
      name: 'lead',
      instrument: INS.softLead,
      patterns: pats({
        m1: 'F#5:6 E5:2 D5:4 A4:4',
        m2: 'B4:4 D5:4 G5:6 F#5:2',
        m3: 'D5:6 E5:2 F#5:4 B5:4',
        m4: 'E5:6 F#5:1 E5:1 C#5:4 A4:4',
        m5: 'A5:4 F#5:2 A5:2 D6:6 C#6:1 B5:1',
        m6: 'B5:6 A5:2 G5:4 D5:4',
        m7: 'E5:4 G5:2 B5:2 D6:4 B5:4',
        m8: 'C#6:6 B5:2 A5:8',
        n1: 'D6:4 B5:2 A5:2 G5:4 B5:4',
        n2: 'C#6:6 B5:1 A5:1 E5:8',
        n3: 'F#5:4 A5:2 C#6:2 A5:4 F#5:4',
        n4: 'D5:6 E5:2 F#5:4 B4:4',
        n5: 'G5:4 B5:2 D6:2 B5:6 A5:2',
        n6: 'A5:4 E5:2 C#5:2 E5:4 A5:4',
        n7: 'G5:6 F#5:2 E5:4 B4:4',
        n8: 'E5:4 D5:4 C#5:6 _:2',
      }),
      sequence: ['-', '-', '-', '-', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'],
    },
    {
      name: 'arp',
      instrument: INS.rippleArp,
      patterns: pats({
        D: 'D4:2 F#4:2 A4:2 D5:2 E5:2 D5:2 A4:2 F#4:2',
        GD: 'D4:2 G4:2 B4:2 D5:2 G5:2 D5:2 B4:2 G4:2',
        G: 'G3:2 B3:2 D4:2 G4:2 A4:2 G4:2 D4:2 B3:2',
        Bm: 'B3:2 D4:2 F#4:2 B4:2 C#5:2 B4:2 F#4:2 D4:2',
        A: 'A3:2 C#4:2 E4:2 A4:2 B4:2 A4:2 E4:2 C#4:2',
        Em: 'E4:2 G4:2 B4:2 D5:2 E5:2 D5:2 B4:2 G4:2',
        Fsm: 'F#3:2 A3:2 C#4:2 F#4:2 A4:2 F#4:2 C#4:2 A3:2',
        As: 'A3:2 D4:2 E4:2 A4:2 C#5:2 A4:2 E4:2 C#4:2',
      }),
      sequence: ['D', 'GD', 'D', 'A', 'D', 'G', 'Bm', 'A', 'D', 'G', 'Em', 'A', 'G', 'A', 'Fsm', 'Bm', 'G', 'A', 'Em', 'As'],
    },
    {
      name: 'bass',
      instrument: INS.roundBass,
      patterns: pats({
        D: 'D2:6 A2:2 D3:8',
        GD: 'D2:6 G2:2 B2:8',
        G: 'G2:6 D3:2 G3:8',
        Bm: 'B2:6 F#2:2 D3:8',
        A: 'A2:6 E3:2 C#3:8',
        Em: 'E2:6 B2:2 E3:8',
        Fsm: 'F#2:6 C#3:2 A2:8',
        As: 'A2:6 E3:2 A2:8',
      }),
      sequence: ['D', 'GD', 'D', 'A', 'D', 'G', 'Bm', 'A', 'D', 'G', 'Em', 'A', 'G', 'A', 'Fsm', 'Bm', 'G', 'A', 'Em', 'As'],
    },
    {
      name: 'drums',
      instrument: kit(0.3),
      patterns: pats({
        hats: '_:2 H:4 H:4 H:4 H:2',
        groove: 'K:2 H:4 H:4 K:4 H:2',
        turn: 'K:2 H:4 H:4 K:4 O:2',
      }),
      sequence: ['-', '-', 'hats', 'hats', 'groove', 'groove', 'groove', 'turn', 'groove', 'groove', 'groove', 'turn', 'groove', 'groove', 'groove', 'turn', 'groove', 'groove', 'groove', 'turn'],
    },
  ],
};

// ---- 3. reef: Seagrass Flats & Florida Keys Reef -----------------------------
// C major calypso, 108 BPM, 24 bars. Lead rhythm is 3+3+2.
// A: C | F | G7 | C | C | F | G7 | C     B: F | G7 | Em | Am | Dm7 | G7 | C | G7
// A': as A with a higher final flourish.

const reefPan = pats({
  a1: 'E5:3 G5:3 C6:2 G5:2 E5:2 G5:2 A5:2',
  a2: 'A5:3 F5:3 C5:2 F5:2 A5:2 C6:4',
  a3: 'B5:3 G5:3 D5:2 F5:2 G5:2 B5:2 D6:2',
  a4: 'C6:3 G5:3 E5:2 C5:6 _:2',
  a5: 'G5:2 G5:1 E5:2 G5:1 C6:2 _:2 C6:2 E6:2 D6:1 C6:1',
  a6: 'A5:2 A5:1 F5:2 A5:1 C6:2 _:2 C6:2 A5:2 G5:1 F5:1',
  a7: 'G5:3 B5:3 D6:2 F6:2 D6:2 B5:2 G5:2',
  a8: 'C6:3 E5:3 G5:2 C6:4 _:4',
  a8b: 'C6:3 G5:3 C6:2 E6:4 _:4',
  c1: 'C6:4 A5:2 F5:2 _:2 A5:2 C6:2 A5:2',
  c2: 'B5:4 G5:2 D5:2 _:2 F5:2 G5:2 B5:2',
  c3: 'G5:3 E5:3 B4:2 E5:2 G5:2 B5:4',
  c4: 'C6:3 A5:3 E5:2 A5:6 _:2',
  c5: 'F5:3 A5:3 C6:2 D6:2 C6:2 A5:2 F5:2',
  c6: 'G5:3 B5:3 D6:2 F6:4 D6:2 B5:2',
  c7: 'C6:3 G5:3 E5:2 G5:2 C6:2 E6:4',
  c8: 'D6:2 C6:1 B5:2 A5:1 G5:2 F5:2 D5:2 B4:2 G4:2',
});
const REEF_LEAD = [
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8',
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8',
  'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8b',
];
const REEF_CHORDS = ['C', 'F', 'G7', 'C', 'C', 'F', 'G7', 'C', 'F', 'G7', 'Em', 'Am', 'Dm7', 'G7', 'C', 'G7', 'C', 'F', 'G7', 'C', 'C', 'F', 'G7', 'C'];
/** Off-beat stab voicings, low to high, voice-led around C4-D5. */
const REEF_VOICING: Record<string, [string, string, string]> = {
  C: ['E4', 'G4', 'C5'],
  F: ['F4', 'A4', 'C5'],
  G7: ['F4', 'B4', 'D5'],
  Em: ['E4', 'G4', 'B4'],
  Am: ['E4', 'A4', 'C5'],
  Dm7: ['F4', 'A4', 'C5'],
};
const stabTrack = (voice: 0 | 1 | 2): Song['tracks'][number] => ({
  name: `stab${voice + 1}`,
  instrument: INS.stab,
  patterns: Object.fromEntries(
    Object.entries(REEF_VOICING).map(([k, v]) => [k, p(`_:2 ${v[voice]}:2 _:2 ${v[voice]}:2 _:2 ${v[voice]}:2 _:2 ${v[voice]}:1 ${v[voice]}:1`)]),
  ),
  sequence: REEF_CHORDS,
});

const reef: Song = {
  id: 'reef',
  title: 'Key Largo Calypso',
  bpm: 108,
  loop: true,
  tracks: [
    { name: 'lead', instrument: INS.steelPan, patterns: reefPan, sequence: REEF_LEAD },
    {
      // A quiet detuned octave above gives the pan its metallic overtone.
      name: 'shimmer',
      instrument: INS.panShimmer,
      patterns: Object.fromEntries(Object.entries(reefPan).map(([k, v]) => [k, transpose(v, 12)])),
      sequence: REEF_LEAD,
    },
    stabTrack(0),
    stabTrack(1),
    stabTrack(2),
    {
      name: 'bass',
      instrument: INS.bounceBass,
      patterns: pats({
        // root, fifth, octave in 3+3+2, then a step into the next root
        C_F: 'C2:3 G2:3 C3:2 C2:3 G2:3 E2:2',
        C_C: 'C2:3 E2:3 C3:2 C2:3 G2:3 D2:2',
        C_G: 'C2:3 G2:3 C3:2 C2:3 G2:3 F#2:2',
        F_G: 'F2:3 C3:3 F3:2 F2:3 F3:3 F#2:2',
        G_C: 'G2:3 D3:3 G3:2 G2:3 B2:3 D2:2',
        G_E: 'G2:3 D3:3 G3:2 G2:3 D3:3 F2:2',
        E_A: 'E2:3 B2:3 E3:2 E2:3 G2:3 G#2:2',
        A_D: 'A2:3 E3:3 A3:2 A2:3 E3:3 E2:2',
        D_G: 'D2:3 F2:3 D3:2 D2:3 C3:3 F#2:2',
      }),
      sequence: [
        'C_F', 'F_G', 'G_C', 'C_C', 'C_F', 'F_G', 'G_C', 'C_F',
        'F_G', 'G_E', 'E_A', 'A_D', 'D_G', 'G_C', 'C_G', 'G_C',
        'C_F', 'F_G', 'G_C', 'C_C', 'C_F', 'F_G', 'G_C', 'C_C',
      ],
    },
    {
      name: 'kick',
      instrument: kit(0.38),
      patterns: pats({
        beat: 'K:3 K:1 S:4 K:3 K:1 S:4',
        fill: 'K:3 K:1 S:2 S:2 K:2 S:2 S S S S',
      }),
      sequence: [...Array(7).fill('beat'), 'fill', ...Array(7).fill('beat'), 'fill', ...Array(7).fill('beat'), 'fill'],
    },
    {
      name: 'shaker',
      instrument: kit(0.32),
      patterns: pats({ shake: 'H:2 H H H:2 H H H:2 H H H:2 O:2' }),
      sequence: Array(24).fill('shake'),
    },
  ],
};

// ---- 4. blue: Gulf Stream Drop-off ------------------------------------------
// D dorian, 80 BPM, 16 bars. No drums.
// A: Dm7 | G | Dm7 | G | F | C | Em7 | Am7     B: Fmaj7 | Em7 | Dm7 | C | Fmaj7 | G | Em7 | Am7
// The major IV (G, with B natural) is the dorian colour; the lead waits two bars.

const BLUE_CHORDS = ['Dm7', 'G', 'Dm7', 'G', 'F', 'C', 'Em7', 'Am7', 'Fmaj7', 'Em7', 'Dm7', 'C', 'Fmaj7', 'G', 'Em7', 'Am7'];
const BLUE_VOICING: Record<string, [string, string, string]> = {
  Dm7: ['F3', 'A3', 'C4'],
  G: ['G3', 'B3', 'D4'],
  F: ['F3', 'A3', 'C4'],
  C: ['E3', 'G3', 'C4'],
  Em7: ['G3', 'B3', 'D4'],
  Am7: ['G3', 'C4', 'E4'],
  Fmaj7: ['A3', 'C4', 'E4'],
};
const padTrack = (voice: 0 | 1 | 2): Song['tracks'][number] => ({
  name: `pad${voice + 1}`,
  instrument: voice === 2 ? INS.padAir : INS.pad,
  patterns: Object.fromEntries(Object.entries(BLUE_VOICING).map(([k, v]) => [k, p(`${v[voice]}:16`)])),
  sequence: BLUE_CHORDS,
});

const blue: Song = {
  id: 'blue',
  title: 'Into the Blue',
  bpm: 80,
  loop: true,
  tracks: [
    {
      name: 'lead',
      instrument: INS.lonelyLead,
      patterns: pats({
        l3: 'A4:8 C5:4 D5:4',
        l4: 'D5:4 B4:8 G4:4',
        l5: 'A4:6 C5:2 F5:8',
        l6: 'E5:8 G5:4 E5:4',
        l7: 'D5:8 B4:4 G4:4',
        l8: 'E4:4 A4:12',
        m1: 'C5:4 E5:4 F5:8',
        m2: 'G5:8 E5:4 D5:4',
        m3: 'F5:6 E5:2 D5:8',
        m4: 'C5:8 _:4 G4:4',
        m5: 'A4:4 C5:4 E5:4 A5:4',
        m6: 'B5:8 G5:6 A5:2',
        m7: 'B5:6 A5:2 G5:4 E5:4',
        m8: 'E5:16',
      }),
      sequence: ['-', '-', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
    },
    padTrack(0),
    padTrack(1),
    padTrack(2),
    {
      name: 'bass',
      instrument: INS.deepBass,
      patterns: pats({
        Dm7: 'D2:12 A2:4',
        G: 'G2:12 D2:4',
        F: 'F2:12 C3:4',
        C: 'C2:12 G2:4',
        Em7: 'E2:12 B2:4',
        Am7: 'A2:12 E2:4',
        Fmaj7: 'F2:12 C3:4',
      }),
      sequence: BLUE_CHORDS,
    },
  ],
};

// ---- 5. abyss: the Twilight Zone --------------------------------------------
// E minor / phrygian, 66 BPM, 16 bars, no drums.
// Em | Em | Em | Em | C | C | Em | Em | F | F | Em | Em | Am | Am | Bb | B
// F (a minor 2nd above the tonic) and Bb (a tritone away) are the unsettling
// moves; bar 10's B over F and bar 15's E over Bb are deliberate tritones.

const abyss: Song = {
  id: 'abyss',
  title: 'Twilight Zone',
  bpm: 66,
  loop: true,
  tracks: [
    {
      name: 'glow',
      instrument: INS.glow,
      patterns: pats({
        g3: 'B3:8 E4:8',
        g4: 'G4:12 _:4',
        g5: 'E4:16',
        g6: 'G4:12 _:4',
        g7: 'B3:16',
        g9: 'A3:16',
        g10: 'C4:8 B3:8',
        g11: 'B3:16',
        g13: 'C4:8 E4:8',
        g14: 'A3:16',
        g15: 'D4:8 E4:8',
        g16: 'D#4:16',
      }),
      sequence: ['-', '-', 'g3', 'g4', 'g5', 'g6', 'g7', '-', 'g9', 'g10', 'g11', '-', 'g13', 'g14', 'g15', 'g16'],
    },
    {
      name: 'pings',
      instrument: INS.ping,
      patterns: pats({
        p1: '_:4 B6:1 _:5 E6:1 _:5',
        p2: '_:12 E7:1 _:3',
        p3: 'B5:1 _:9 G6:1 _:5',
        p4: '_:6 G6:1 _:3 B6:1 _:5',
        p5: 'E6:1 _:7 G6:1 _:3 C7:1 _:3',
        p7: '_:4 B6:1 _:11',
        p8: '_:8 E7:1 _:2 B6:1 _:4',
        p9: '_:4 C7:1 _:7 A6:1 _:3',
        p10: '_:8 E6:1 _:7',
        p11: 'G6:1 _:15',
        p12: '_:10 B6:1 _:5',
        p13: '_:4 E7:1 _:7 C7:1 _:3',
        p14: '_:8 A6:1 _:7',
        p15: '_:4 F6:1 _:7 D6:1 _:3',
        p16: '_:4 D#6:1 _:3 F#6:1 _:7',
      }),
      sequence: ['p1', 'p2', 'p3', 'p4', 'p5', '-', 'p7', 'p8', 'p9', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p16'],
    },
    {
      name: 'drone',
      instrument: INS.drone,
      patterns: pats({ E: 'E1:16', C: 'C2:16', F: 'F1:16', A: 'A1:16', Bb: 'Bb1:16', B: 'B1:16', hold: '.:16' }),
      sequence: ['E', 'hold', 'E', 'hold', 'C', 'hold', 'E', 'hold', 'F', 'hold', 'E', 'hold', 'A', 'hold', 'Bb', 'B'],
    },
    {
      name: 'droneFifth',
      instrument: INS.droneEdge,
      patterns: pats({ E: 'B1:16', C: 'G2:16', F: 'C2:16', A: 'E2:16', Bb: 'F2:16', B: 'F#2:16', hold: '.:16' }),
      sequence: ['E', 'hold', 'E', 'hold', 'C', 'hold', 'E', 'hold', 'F', 'hold', 'E', 'hold', 'A', 'hold', 'Bb', 'B'],
    },
    {
      name: 'droneThird',
      instrument: INS.droneThird,
      patterns: pats({ E: 'G2:16', C: 'E2:16', F: 'A2:16', A: 'C3:16', Bb: 'D3:16', B: 'D#3:16', hold: '.:16' }),
      sequence: ['E', 'hold', 'E', 'hold', 'C', 'hold', 'E', 'hold', 'F', 'hold', 'E', 'hold', 'A', 'hold', 'Bb', 'B'],
    },
  ],
};

// ---- 6. stageClear ------------------------------------------------------------
// F major, 126 BPM, 3 bars: F | Bb C7 | F (held)

const stageClear: Song = {
  id: 'stageClear',
  title: 'Stage Clear',
  bpm: 126,
  loop: false,
  tracks: [
    {
      name: 'lead',
      instrument: INS.fanfare,
      patterns: pats({ a: 'C5:2 F5:2 A5:2 C6:4 A5:2 C6:4', b: 'D6:4 Bb5:2 F5:2 E5:2 G5:2 Bb5:2 C6:2', c: 'F6:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'brass1',
      instrument: INS.brass,
      patterns: pats({ a: 'A4:2 _:2 A4:2 _:2 A4:4 _:4', b: 'Bb4:4 _:4 C5:4 Bb4:4', c: 'A4:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'brass2',
      instrument: INS.brass,
      patterns: pats({ a: 'C5:2 _:2 C5:2 _:2 C5:4 _:4', b: 'D5:4 _:4 E5:4 G4:4', c: 'C5:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'bass',
      instrument: INS.bounceBass,
      patterns: pats({ a: 'F2:4 C3:4 F2:4 A2:4', b: 'Bb2:4 F2:4 C3:4 C2:4', c: 'F2:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'drums',
      instrument: kit(0.45),
      patterns: pats({ a: 'K:4 S:4 K:4 S:4', b: 'K:4 S:4 K:2 S:2 S S S S', c: 'K:16' }),
      sequence: ['a', 'b', 'c'],
    },
    { name: 'crash', instrument: kit(0.5), patterns: pats({ c: 'O:16' }), sequence: ['-', '-', 'c'] },
  ],
};

// ---- 7. gameOver ----------------------------------------------------------------
// D minor, 80 BPM, 3 bars: Dm (Dm/F) | Gm A7 | Dm — descending, ends on a low D.

const gameOver: Song = {
  id: 'gameOver',
  title: 'Game Over',
  bpm: 80,
  loop: false,
  tracks: [
    {
      name: 'lead',
      instrument: INS.sadLead,
      patterns: pats({ a: 'A5:3 G5:1 F5:4 D5:4 A4:4', b: 'Bb4:3 A4:1 G4:4 E4:4 C#4:4', c: 'D4:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'pad1',
      instrument: INS.sadPad,
      patterns: pats({ a: 'F4:8 D4:8', b: 'D4:8 C#4:8', c: 'A3:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'pad2',
      instrument: INS.sadPad,
      patterns: pats({ a: 'A3:16', b: 'Bb3:8 A3:8', c: 'F3:16' }),
      sequence: ['a', 'b', 'c'],
    },
    {
      name: 'bass',
      instrument: { ...INS.deepBass, wave: 'triangle', release: 1.5 },
      patterns: pats({ a: 'D3:8 F2:8', b: 'G2:8 A2:8', c: 'D2:16' }),
      sequence: ['a', 'b', 'c'],
    },
  ],
};

// ---- 8. victory -------------------------------------------------------------------
// F major, 116 BPM, 6 bars: F | Dm | Bb | C7 | F (held two bars)
// Bars 1-3 quote the title hook; bar 4 climbs the C7 chord to G6 and lands on F6.

const victory: Song = {
  id: 'victory',
  title: 'Victory',
  bpm: 116,
  loop: false,
  tracks: [
    {
      name: 'lead',
      instrument: INS.fanfare,
      patterns: {
        h1: titleLead.h1 as string,
        h2: titleLead.h2 as string,
        h3: titleLead.h3 as string,
        ...pats({ v4: 'C6:2 Bb5:2 G5:2 E5:2 C6:2 E6:2 G6:4', end: 'F6:16', tail: '.:12 _:4' }),
      },
      sequence: ['h1', 'h2', 'h3', 'v4', 'end', 'tail'],
    },
    {
      name: 'harmony',
      instrument: INS.brass,
      patterns: pats({ end: 'A5:16', tail: '.:12 _:4' }),
      sequence: ['-', '-', '-', '-', 'end', 'tail'],
    },
    {
      name: 'arp',
      instrument: INS.sparkleArp,
      patterns: {
        F: arp([titleChords.F]),
        Dm: arp([titleChords.Dm]),
        Bb: arp([titleChords.Bb]),
        C7: arp([['E4', 'G4', 'Bb4', 'C5']], 1, [0, 1, 2, 3]),
        up: arp([['F4', 'A4', 'C5', 'F5']], 1, [0, 1, 2, 3]),
        tail: p('C5:12 _:4'),
      },
      sequence: ['F', 'Dm', 'Bb', 'C7', 'up', 'tail'],
    },
    {
      name: 'bass',
      instrument: INS.bounceBass,
      patterns: pats({
        F: 'F2:2 _:1 F2:1 C3:2 F2:2 A2:2 C3:2 F3:2 E3:2',
        Dm: 'D3:2 _:1 D3:1 A2:2 D3:2 F3:2 D3:2 A2:2 C3:2',
        Bb: 'Bb2:2 _:1 Bb2:1 F2:2 Bb2:2 D3:2 Bb2:2 F2:2 B2:2',
        C7: 'C3:2 _:1 C3:1 E3:2 G2:2 Bb2:2 C3:2 E3:2 E2:2',
        end: 'F2:16',
        tail: '.:12 _:4',
      }),
      sequence: ['F', 'Dm', 'Bb', 'C7', 'end', 'tail'],
    },
    {
      name: 'drums',
      instrument: kit(0.48),
      patterns: pats({ beat: 'K:4 S:3 K:1 K:4 S:4', fill: 'K:2 S:2 K:2 S:2 S:2 S:2 S S S S', end: 'K:16' }),
      sequence: ['beat', 'beat', 'beat', 'fill', 'end', '-'],
    },
    {
      name: 'hats',
      instrument: kit(0.45),
      patterns: pats({ eighths: 'H:2 H:2 H:2 H:2 H:2 H:2 H:2 H:2', crash: 'O:16' }),
      sequence: ['eighths', 'eighths', 'eighths', 'eighths', 'crash', '-'],
    },
  ],
};

export const SONGS: Record<SongId, Song> = { title, freshwater, reef, blue, abyss, stageClear, gameOver, victory };
