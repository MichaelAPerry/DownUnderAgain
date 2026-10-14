/**
 * The food-web rules. Relations are derived from diet tags, body length and
 * jaw size rather than a hand-written matrix, so custom fish and upgrades
 * (e.g. Big Jaw) slot in automatically.
 */
import { GRAZE_TAGS } from '../data/schema';
import type { SpeciesDef, SpeciesStats } from '../data/schema';

export type Relation = 'eat' | 'flee' | 'ignore';

/** The minimal view of a creature the food web needs. */
export interface Feeder {
  def: SpeciesDef;
  stats: SpeciesStats;
}

const isActor = (f: Feeder): boolean => f.def.kind === 'fish' || f.def.kind === 'mammal';

export function canEat(eater: Feeder, prey: Feeder): boolean {
  if (eater === prey || !isActor(eater)) return false;
  const tag = prey.def.foodTag;
  if (tag === null || tag === 'parasite') return false;
  if (!eater.def.diet.includes(tag)) return false;
  // Cleaner truce: native reef predators leave cleaning stations alone.
  if (prey.def.behavior.cleaner && eater.def.behavior.respectsCleaners) return false;
  if (GRAZE_TAGS.includes(tag)) return true;
  return prey.def.length <= eater.def.length * eater.stats.jaw;
}

/** How `self` should regard `other`. Danger outranks opportunity unless self is bigger. */
export function relation(self: Feeder, other: Feeder): Relation {
  const threat = canEat(other, self);
  const food = canEat(self, other);
  if (threat && food) return self.def.length >= other.def.length ? 'eat' : 'flee';
  if (threat) return 'flee';
  if (food) return 'eat';
  return 'ignore';
}

/**
 * AI predators avoid well-armed prey unless they vastly outsize it (groupers
 * and sharks do eat lionfish; barracuda generally don't). The player may
 * still try, and get stung.
 */
export function isDeterred(predator: Feeder, prey: Feeder): boolean {
  return prey.stats.spines >= 0.6 && predator.def.length < prey.def.length * 3;
}

/** True if this creature is consumed without a chase or bite roll. */
export function isGrazed(prey: Feeder): boolean {
  const tag = prey.def.foodTag;
  return tag !== null && GRAZE_TAGS.includes(tag);
}

/** Lists of species ids a species can eat / be eaten by (for the Codex). */
export function foodWebFor(
  def: SpeciesDef,
  all: readonly SpeciesDef[],
): { eats: SpeciesDef[]; eatenBy: SpeciesDef[] } {
  const self: Feeder = { def, stats: def.stats };
  const eats: SpeciesDef[] = [];
  const eatenBy: SpeciesDef[] = [];
  for (const o of all) {
    if (o.id === def.id) continue;
    const other: Feeder = { def: o, stats: o.stats };
    if (canEat(self, other) && sharesHabitat(def, o)) eats.push(o);
    if (canEat(other, self) && sharesHabitat(def, o)) eatenBy.push(o);
  }
  return { eats, eatenBy };
}

function sharesHabitat(a: SpeciesDef, b: SpeciesDef): boolean {
  return a.habitats.some((h) => b.habitats.some((k) => k.zone === h.zone));
}
