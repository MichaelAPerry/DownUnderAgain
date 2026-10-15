/**
 * Tracker-style song format, compiled to timed note events.
 *
 * A song is a set of tracks. Each track has named one-bar patterns of 16
 * steps (16th notes) and a `sequence` of pattern ids, one per bar; every
 * track's sequence must be the same length. Pattern tokens, space separated:
 *   C4, F#3, Bb5   start a note (sharps or flats, octave -1..8)
 *   .              hold the previous note one more step
 *   _              rest
 *   K S H O        drums (kick, snare, closed hat, open hat) on drum tracks
 * The pattern id "-" is a silent bar.
 */
export type Wave = 'square' | 'pulse25' | 'pulse12' | 'triangle' | 'sine' | 'sawtooth';

export interface Instrument {
  wave: Wave;
  /** Seconds. */
  attack: number;
  decay: number;
  /** 0..1 level held after decay. */
  sustain: number;
  release: number;
  /** Peak level 0..1 before the music bus. */
  volume: number;
  /** Echo send 0..1 (the underwater delay). */
  echo?: number;
  /** Vibrato: rate in Hz and depth in cents, starting after `delay` s. */
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Detune in cents (a slightly detuned layer thickens leads). */
  detune?: number;
}

export interface DrumKit {
  drums: true;
  volume: number;
}

export interface Track {
  name: string;
  instrument: Instrument | DrumKit;
  patterns: Record<string, string>;
  sequence: string[];
}

export interface Song {
  id: string;
  title: string;
  bpm: number;
  loop: boolean;
  tracks: Track[];
}

export const STEPS_PER_BAR = 16;
export type DrumHit = 'K' | 'S' | 'H' | 'O';

export interface NoteEvent {
  step: number;
  /** Length in steps. */
  length: number;
  /** MIDI note number, or a drum hit. */
  note: number | DrumHit;
}

export interface CompiledTrack {
  name: string;
  instrument: Instrument | DrumKit;
  /** Events indexed by global step. */
  byStep: Map<number, NoteEvent[]>;
}

export interface CompiledSong {
  song: Song;
  totalSteps: number;
  stepSeconds: number;
  tracks: CompiledTrack[];
}

const NOTE_RE = /^([A-G])([#b]?)(-?\d)$/;
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DRUMS = new Set(['K', 'S', 'H', 'O']);

export const isDrumKit = (i: Instrument | DrumKit): i is DrumKit => 'drums' in i;

/** MIDI number for a note token like "C#4" (C4 = 60), or null if invalid. */
export function noteToMidi(tok: string): number | null {
  const m = NOTE_RE.exec(tok);
  if (!m) return null;
  const [, letter, acc, oct] = m;
  const base = SEMITONE[letter as string];
  if (base === undefined) return null;
  const midi = (Number(oct) + 1) * 12 + base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
  return midi >= 0 && midi <= 127 ? midi : null;
}

export const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Validate and flatten a song. Throws with a precise message on bad data. */
export function compileSong(song: Song): CompiledSong {
  if (!(song.bpm >= 40 && song.bpm <= 240)) throw new Error(`${song.id}: bpm out of range`);
  if (song.tracks.length === 0) throw new Error(`${song.id}: no tracks`);
  const bars = song.tracks[0]?.sequence.length ?? 0;
  if (bars === 0) throw new Error(`${song.id}: empty sequence`);
  const tracks: CompiledTrack[] = [];
  for (const t of song.tracks) {
    const where = `${song.id}/${t.name}`;
    if (t.sequence.length !== bars) throw new Error(`${where}: sequence has ${t.sequence.length} bars, expected ${bars}`);
    const drums = isDrumKit(t.instrument);
    // Flatten the track into one token stream.
    const tokens: string[] = [];
    for (const id of t.sequence) {
      if (id === '-') {
        for (let i = 0; i < STEPS_PER_BAR; i++) tokens.push('_');
        continue;
      }
      const pat = t.patterns[id];
      if (pat === undefined) throw new Error(`${where}: unknown pattern "${id}"`);
      const toks = pat.trim().split(/\s+/);
      if (toks.length !== STEPS_PER_BAR) throw new Error(`${where}: pattern "${id}" has ${toks.length} steps, expected ${STEPS_PER_BAR}`);
      tokens.push(...toks);
    }
    const byStep = new Map<number, NoteEvent[]>();
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i] as string;
      if (tok === '.' || tok === '_') continue;
      let note: number | DrumHit;
      if (drums) {
        if (!DRUMS.has(tok)) throw new Error(`${where}: bad drum token "${tok}" at step ${i}`);
        note = tok as DrumHit;
      } else {
        const midi = noteToMidi(tok);
        if (midi === null) throw new Error(`${where}: bad note token "${tok}" at step ${i}`);
        note = midi;
      }
      let length = 1;
      while (!drums && tokens[i + length] === '.') length++;
      byStep.set(i, [...(byStep.get(i) ?? []), { step: i, length, note }]);
    }
    if (!drums) {
      // A hold with nothing to hold is almost certainly a typo.
      const firstReal = tokens.findIndex((x) => x !== '.' && x !== '_');
      if (tokens[0] === '.' && (firstReal === -1 || firstReal > 0)) throw new Error(`${where}: track starts with a hold`);
    }
    tracks.push({ name: t.name, instrument: t.instrument, byStep });
  }
  return { song, totalSteps: bars * STEPS_PER_BAR, stepSeconds: 60 / song.bpm / 4, tracks };
}
