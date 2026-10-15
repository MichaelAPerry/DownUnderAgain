/** Placeholder songs; replaced by the full soundtrack. */
import type { Song } from './songFormat';

export const SONG_IDS = ['title', 'freshwater', 'reef', 'blue', 'abyss', 'stageClear', 'gameOver', 'victory'] as const;
export type SongId = (typeof SONG_IDS)[number];

const lead = { wave: 'pulse25', attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1, volume: 0.3 } as const;
const one = (id: SongId, loop: boolean): Song => ({
  id,
  title: id,
  bpm: 100,
  loop,
  tracks: [{ name: 'lead', instrument: lead, patterns: { a: 'C4 . . . E4 . . . G4 . . . C5 . . .' }, sequence: ['a'] }],
});

export const SONGS: Record<SongId, Song> = {
  title: one('title', true),
  freshwater: one('freshwater', true),
  reef: one('reef', true),
  blue: one('blue', true),
  abyss: one('abyss', true),
  stageClear: one('stageClear', false),
  gameOver: one('gameOver', false),
  victory: one('victory', false),
};
