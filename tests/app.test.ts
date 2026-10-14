import { describe, expect, it } from 'vitest';
import { FLORIDA } from '../src/data/regions/florida';
import { GameSession, STAGE_GROWTH, TOURNAMENT_LIVES, buildLadder } from '../src/modes/session';
import { parseSave, defaultSave } from '../src/app/save';
import { ScreenMachine, TRANSITIONS } from '../src/app/screens';
import type { Screen } from '../src/app/screens';
import {
  SANDBOX_POINTS, SANDBOX_STATS, buildCustomDef, defaultSpec, isValidSpec, pointsSpent, sanitizeName,
} from '../src/data/sandbox';
import { ZONE_IDS } from '../src/data/schema';
import { CUSTOM_SHAPES } from '../src/data/sandbox';
import { generateFishSprite } from '../src/render/fishSprite';
import { foodSprite, FOOD_SPRITE_IDS } from '../src/render/foodSprites';
import { GLYPHS } from '../src/render/fontGlyphs';

const known = new Set<string>();
const playable = FLORIDA.species.filter((s) => s.playable);
const sp = (id: string) => {
  const d = FLORIDA.all.find((s) => s.id === id);
  if (!d) throw new Error(id);
  return d;
};

describe('species ladders', () => {
  it('tournament covers every playable fish, smallest first', () => {
    const l = buildLadder('tournament', playable, 1);
    expect(l.length).toBe(playable.length);
    for (let i = 1; i < l.length; i++) expect(l[i - 1]!.length).toBeLessThanOrEqual(l[i]!.length);
    expect(l[0]?.id).toBe('mosquitofish');
    expect(l[l.length - 1]?.id).toBe('great_hammerhead');
  });

  it('challenge picks four growing fish, reproducibly', () => {
    const a = buildLadder('challenge', playable, 42);
    const b = buildLadder('challenge', playable, 42);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(a.length).toBe(4);
    for (let i = 1; i < a.length; i++) expect(a[i]!.length).toBeGreaterThanOrEqual(a[i - 1]!.length);
  });
});

describe('game session', () => {
  it('clears a stage on growth and advances to the next fish', () => {
    const s = new GameSession({ region: FLORIDA, mode: 'tournament', seed: 3, known });
    const first = s.species.id;
    s.growth = STAGE_GROWTH;
    s.update(1 / 60);
    expect(s.outcome).toBe('stageClear');
    expect(s.score).toBeGreaterThanOrEqual(100);
    s.nextStage();
    expect(s.stage).toBe(1);
    expect(s.species.id).not.toBe(first);
    expect(s.outcome).toBe('playing');
    expect(s.player.alive).toBe(true);
  });

  it('spends tournament lives on death and ends when they run out', () => {
    const s = new GameSession({ region: FLORIDA, mode: 'tournament', seed: 4, known });
    for (let life = TOURNAMENT_LIVES; life > 0; life--) {
      s.world.kill(s.player, 'eaten', null);
      s.update(1 / 60);
      expect(s.outcome).toBe('dead');
      expect(s.lives).toBe(life - 1);
      if (s.canRetry) s.retryStage();
    }
    expect(s.canRetry).toBe(false);
    expect(s.summary().won).toBe(false);
  });

  it('records a readable cause of death', () => {
    const s = new GameSession({ region: FLORIDA, mode: 'freeSwim', seed: 5, known, species: sp('bluegill') });
    const bass = s.world.spawn(sp('largemouth_bass'), s.player.x + 50, s.player.y, 'spring');
    s.world.kill(s.player, 'eaten', bass);
    s.update(1 / 60);
    expect(s.cause).toBe('Eaten by a Florida Largemouth Bass');
  });

  it('evolution purchases spend biomass and boost stats', () => {
    const s = new GameSession({ region: FLORIDA, mode: 'evolution', seed: 6, known, species: sp('bluegill') });
    const speed = s.player.stats.maxSpeed;
    expect(s.buy('fins')).toBe(false);
    s.biomass = 100;
    expect(s.buy('fins')).toBe(true);
    expect(s.biomass).toBe(92);
    expect(s.player.stats.maxSpeed).toBeCloseTo(speed * 1.12, 5);
    expect(s.buy('nonsense')).toBe(false);
  });

  it('free swim rejects purchases', () => {
    const s = new GameSession({ region: FLORIDA, mode: 'freeSwim', seed: 6, known, species: sp('bluegill') });
    s.biomass = 999;
    expect(s.buy('fins')).toBe(false);
  });

  it('counts discoveries of nearby creatures', () => {
    const s = new GameSession({ region: FLORIDA, mode: 'freeSwim', seed: 8, known, species: sp('mosquitofish') });
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(s.discoveries).toContain('mosquitofish');
    expect(s.discoveries.length).toBeGreaterThan(1);
  });
});

describe('save data', () => {
  const ids = new Set(FLORIDA.all.map((s) => s.id));

  it('round-trips valid data', () => {
    const d = defaultSave();
    d.codex = ['bluegill'];
    d.best.freeSwim = 120;
    d.custom = defaultSpec();
    expect(parseSave(JSON.stringify(d), ids)).toEqual(d);
  });

  it('survives garbage and hostile input', () => {
    for (const raw of [null, '', 'not json', '[]', '42', '{"v":2}', 'x'.repeat(100000)]) {
      expect(parseSave(raw, ids)).toEqual(defaultSave());
    }
    const evil = parseSave(
      JSON.stringify({
        v: 1, muted: 'yes', codex: ['bluegill', '<img src=x onerror=alert(1)>', 5], best: { freeSwim: -3, evolution: 'NaN', tournament: 1e12 },
        custom: { ...defaultSpec(), name: '<script>' },
        __proto__: { polluted: true },
      }),
      ids,
    );
    expect(evil.muted).toBe(false);
    expect(evil.codex).toEqual(['bluegill']);
    expect(evil.best).toEqual({});
    expect(evil.custom).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('custom fish sandbox', () => {
  it('the default design is valid and within budget', () => {
    const spec = defaultSpec();
    expect(isValidSpec(spec)).toBe(true);
    expect(pointsSpent(spec)).toBeLessThanOrEqual(SANDBOX_POINTS);
    expect(() => buildCustomDef(spec)).not.toThrow();
  });

  it('rejects over-budget and out-of-range designs', () => {
    const spec = defaultSpec();
    for (const s of SANDBOX_STATS) spec.stats[s] = 5;
    expect(isValidSpec(spec)).toBe(false);
    expect(isValidSpec({ ...defaultSpec(), stats: { ...defaultSpec().stats, speed: 9 } })).toBe(false);
    expect(isValidSpec({ ...defaultSpec(), home: 'mars' })).toBe(false);
  });

  it('builds a valid species for every home, shape and size', () => {
    for (const home of ZONE_IDS) {
      for (const shape of CUSTOM_SHAPES) {
        for (let size = 1; size <= 5; size++) {
          const spec = { ...defaultSpec(), home, shape, stats: { ...defaultSpec().stats, size } };
          const def = buildCustomDef(spec);
          expect(def.habitats[0]?.zone).toBe(home);
          expect(def.salinity[0]).toBeLessThanOrEqual(FLORIDA.zones.find((z) => z.id === home)!.salinity);
        }
      }
    }
  });

  it('sanitises names', () => {
    expect(sanitizeName('  <b>Nemo</b>!!  ')).toBe('BNEMOB');
    expect(sanitizeName('')).toBe('MY FISH');
    expect(sanitizeName('a'.repeat(40)).length).toBe(14);
  });
});

describe('screen machine', () => {
  it('only allows declared transitions', () => {
    const m = new ScreenMachine();
    expect(m.canGo('playing')).toBe(false);
    expect(() => m.go('playing')).toThrow();
    m.go('modeSelect');
    m.go('speciesSelect');
    m.go('briefing');
    m.go('playing');
    m.go('paused');
    m.go('help');
    expect(m.previous).toBe('paused');
    m.go('paused');
    m.go('title');
  });

  it('every screen can eventually reach the title', () => {
    for (const start of Object.keys(TRANSITIONS) as Screen[]) {
      const seen = new Set<Screen>([start]);
      const queue: Screen[] = [start];
      while (queue.length) for (const n of TRANSITIONS[queue.shift()!]) if (!seen.has(n)) seen.add(n), queue.push(n);
      expect(seen.has('title')).toBe(true);
    }
  });
});

describe('sprites and font', () => {
  it('every species sprite matches its gameplay size and has two frames', () => {
    for (const d of FLORIDA.all) {
      const s = d.look ? generateFishSprite(d.look, d.length, d.height) : foodSprite(d.sprite!);
      expect(s.w).toBe(d.length);
      expect(s.h).toBe(d.height);
      expect(s.frames.length).toBe(2);
      expect(s.frames[0]!.some((c) => c !== null)).toBe(true);
    }
  });

  it('all food sprites parse', () => {
    for (const id of FOOD_SPRITE_IDS) expect(() => foodSprite(id)).not.toThrow();
  });

  it('font covers every character the game prints', () => {
    const needed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:!?-+%/()<>*▲▼♥';
    for (const ch of needed) expect(GLYPHS[ch], `glyph ${ch}`).toBeDefined();
    for (const rows of Object.values(GLYPHS)) {
      expect(rows.length).toBe(7);
      for (const r of rows) expect(r).toMatch(/^[#.]{5}$/);
    }
  });
});
