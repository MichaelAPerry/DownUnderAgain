import type { SpeciesDef, SpeciesStats, UpgradeDef } from '../data/schema';
import { clamp } from '../engine/math';

export const BASE_MAX_HP = 100;

/** Upper bound for 0..1 probability-style stats so nothing becomes invulnerable. */
const PROB_CAP = 0.9;

export type UpgradeLevels = Readonly<Record<string, number>>;

export function upgradeCost(u: UpgradeDef, level: number): number {
  return Math.round(u.baseCost * Math.pow(u.costGrowth, level));
}

/**
 * Apply upgrade levels to a species' base stats. Probability stats are capped,
 * multiplicative stats never drop below 25% of base.
 */
export function effectiveStats(
  def: SpeciesDef,
  upgrades: readonly UpgradeDef[],
  levels: UpgradeLevels,
): { stats: SpeciesStats; maxHp: number } {
  const s: SpeciesStats = { ...def.stats };
  let maxHp = BASE_MAX_HP;
  for (const u of upgrades) {
    const lv = clamp(Math.floor(levels[u.id] ?? 0), 0, u.maxLevel);
    if (lv === 0) continue;
    if (u.stat === 'maxHp') {
      maxHp = u.mode === 'add' ? maxHp + u.perLevel * lv : maxHp * Math.pow(1 + u.perLevel, lv);
      continue;
    }
    const base = s[u.stat];
    const next = u.mode === 'add' ? base + u.perLevel * lv : base * Math.pow(1 + u.perLevel, lv);
    s[u.stat] = Math.max(next, base * 0.25);
  }
  s.jaw = clamp(s.jaw, 0, PROB_CAP);
  s.camo = clamp(s.camo, 0, PROB_CAP);
  s.spines = clamp(s.spines, 0, PROB_CAP);
  s.armor = clamp(s.armor, 0, PROB_CAP);
  s.agility = clamp(s.agility, 0.05, 1);
  return { stats: s, maxHp: Math.round(maxHp) };
}

/** Body area in px^2; the currency of nutrition and score. */
export function biomass(def: SpeciesDef): number {
  return def.length * def.height;
}
