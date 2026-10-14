import { describe, expect, it } from 'vitest';
import { FLORIDA } from '../src/data/regions/florida';
import { validateRegion } from '../src/data/validate';
import { UPGRADES } from '../src/data/upgrades';
import { isPaletteKey } from '../src/data/palette';

describe('Florida region data', () => {
  it('passes every region invariant', () => {
    expect(validateRegion(FLORIDA.all, FLORIDA.zones)).toEqual([]);
  });

  it('has at least 15 playable fish across all four tiers', () => {
    const playable = FLORIDA.species.filter((s) => s.playable);
    expect(playable.length).toBeGreaterThanOrEqual(15);
    for (const tier of ['apex', 'carnivore', 'omnivore', 'herbivore'] as const) {
      expect(playable.some((s) => s.tier === tier)).toBe(true);
    }
  });

  it('includes exactly one invasive species and at least one cleaner', () => {
    expect(FLORIDA.species.filter((s) => !s.native).map((s) => s.id)).toEqual(['lionfish']);
    expect(FLORIDA.species.some((s) => s.behavior.cleaner)).toBe(true);
  });

  it('keeps the total population within the performance budget', () => {
    const total = FLORIDA.all.reduce((n, s) => n + s.habitats.reduce((m, h) => m + h.count, 0), 0);
    expect(total).toBeLessThanOrEqual(700);
  });

  it('zones tile the transect without gaps', () => {
    const surface = FLORIDA.zones.filter((z) => z.id !== 'deep').slice().sort((a, b) => a.x[0] - b.x[0]);
    expect(surface[0]?.x[0]).toBe(0);
    for (let i = 1; i < surface.length; i++) expect(surface[i]?.x[0]).toBe(surface[i - 1]?.x[1]);
    expect(surface[surface.length - 1]?.x[1]).toBe(FLORIDA.width);
  });
});

describe('upgrades', () => {
  it('are well formed', () => {
    const ids = new Set<string>();
    for (const u of UPGRADES) {
      expect(ids.has(u.id)).toBe(false);
      ids.add(u.id);
      expect(u.maxLevel).toBeGreaterThan(0);
      expect(u.baseCost).toBeGreaterThan(0);
      expect(u.costGrowth).toBeGreaterThanOrEqual(1);
      expect(isPaletteKey(u.color)).toBe(true);
      expect(u.description.length).toBeLessThanOrEqual(48);
    }
  });
});
