import { describe, expect, it } from 'vitest';
import { compileSong, midiToHz, noteToMidi, STEPS_PER_BAR } from '../src/audio/songFormat';
import type { Song } from '../src/audio/songFormat';
import { SONGS, SONG_IDS } from '../src/audio/songs';
import { SFX } from '../src/audio/sfx';

describe('song format', () => {
  it('parses note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('Db4')).toBe(61);
    expect(noteToMidi('B-1')).toBe(11);
    expect(noteToMidi('H4')).toBeNull();
    expect(noteToMidi('C')).toBeNull();
    expect(midiToHz(69)).toBeCloseTo(440, 6);
  });

  it('turns holds into note lengths, across bar lines', () => {
    const song: Song = {
      id: 't', title: 't', bpm: 120, loop: true,
      tracks: [{
        name: 'x',
        instrument: { wave: 'square', attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1, volume: 0.3 },
        patterns: { a: 'C4 . _ E4 _ _ _ _ _ _ _ _ _ _ G4 .', b: '. . A4 _ _ _ _ _ _ _ _ _ _ _ _ _' },
        sequence: ['a', 'b'],
      }],
    };
    const c = compileSong(song);
    expect(c.totalSteps).toBe(32);
    expect(c.stepSeconds).toBeCloseTo(0.125, 9);
    const ev = (s: number) => c.tracks[0]!.byStep.get(s)?.[0];
    expect(ev(0)).toMatchObject({ length: 2, note: 60 });
    expect(ev(3)).toMatchObject({ length: 1, note: 64 });
    expect(ev(14)).toMatchObject({ length: 4, note: 67 });
    expect(ev(18)).toMatchObject({ length: 1, note: 69 });
  });

  it('rejects malformed songs with a useful message', () => {
    const base = (pat: string, seq = ['a']): Song => ({
      id: 'bad', title: 'b', bpm: 120, loop: true,
      tracks: [{ name: 'x', instrument: { wave: 'sine', attack: 0, decay: 0, sustain: 1, release: 0, volume: 0.2 }, patterns: { a: pat }, sequence: seq }],
    });
    expect(() => compileSong(base('C4 . .'))).toThrow(/3 steps/);
    expect(() => compileSong(base('C4 . . . . . . . . . . . . . . X9'))).toThrow(/bad note/);
    expect(() => compileSong(base('C4 . . . . . . . . . . . . . . .', ['a', 'zz']))).toThrow(/unknown pattern/);
  });
});

describe('soundtrack', () => {
  it('every song compiles, with loops long enough not to grate', () => {
    for (const id of SONG_IDS) {
      const s = SONGS[id];
      expect(s.id).toBe(id);
      const c = compileSong(s);
      expect(c.totalSteps % STEPS_PER_BAR).toBe(0);
      for (const t of s.tracks) {
        const ins = t.instrument;
        if ('drums' in ins) expect(ins.volume).toBeLessThanOrEqual(0.8);
        else {
          expect(ins.volume).toBeGreaterThan(0);
          expect(ins.volume).toBeLessThanOrEqual(0.5);
          expect(ins.attack).toBeGreaterThanOrEqual(0);
          expect(ins.release).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('sound effects are audible but not deafening', () => {
    for (const notes of Object.values(SFX)) {
      for (const n of notes) {
        expect(n.v ?? 0.3).toBeGreaterThan(0.05);
        expect(n.v ?? 0.3).toBeLessThanOrEqual(0.5);
        expect(n.d).toBeGreaterThan(0.01);
      }
    }
  });
});
