/**
 * Mouth-contact resolution: eating, failed bites, venomous stings and
 * cleaning-station grooming. Contact is measured from the eater's mouth, so
 * swimming behind a predator is safe.
 */
import { canEat, isGrazed } from '../foodWeb';
import { biomass } from '../stats';
import type { Entity } from '../types';
import type { World } from '../world';

const scratch: Entity[] = [];
/** Maximum energy (percent) a single meal can restore. */
export const MAX_MEAL_GAIN = 60;

export function mealGain(eater: Entity, prey: Entity): number {
  return Math.min(MAX_MEAL_GAIN, (150 * biomass(prey.def)) / biomass(eater.def));
}

export function mealPoints(prey: Entity): number {
  const base = Math.max(1, Math.round(Math.sqrt(biomass(prey.def))));
  return prey.def.native ? base : base * 2;
}

export function mouthOf(e: Entity): [number, number] {
  return [e.x + e.facing * e.def.length * 0.4, e.y];
}

export function resolveContacts(world: World, _dt: number): void {
  for (const e of world.entities) {
    if (!e.alive || e.eatCooldown > 0 || e.stunTimer > 0) continue;
    if (e.def.kind !== 'fish' && e.def.kind !== 'mammal') continue;
    // Sated AI fish stop eating; the player always can.
    if (!e.isPlayer && e.energy > 95 && !e.def.behavior.cleaner) continue;
    const [mx, my] = mouthOf(e);
    const reach = Math.max(2, e.def.length * 0.12);
    for (const o of world.near(mx, my, reach + 24, scratch)) {
      if (o === e || !o.alive) continue;
      const r = Math.max(2.5, o.def.length * 0.35) + reach;
      const dx = o.x - mx;
      const dy = o.y - my;
      if (dx * dx + dy * dy > r * r) continue;

      if (e.def.behavior.cleaner && o.def.kind === 'fish' && o.parasites > 0.15 && !canEat(e, o) && !canEat(o, e)) {
        const gain = Math.min(MAX_MEAL_GAIN, 10 + o.parasites * 40);
        e.energy = Math.min(100, e.energy + gain);
        o.parasites = 0;
        e.eatCooldown = 0.8;
        world.events.emit('clean', { cleaner: e, client: o, gain });
        break;
      }
      if (canEat(e, o)) {
        bite(world, e, o);
        break;
      }
    }
  }
}

function bite(world: World, e: Entity, o: Entity): void {
  if (!isGrazed(o)) {
    const bigger = e.def.length >= o.def.length * 3;
    if (o.stats.spines > 0 && world.rng.chance(o.stats.spines * (bigger ? 0.25 : 1))) {
      const damage = Math.round(15 + 30 * o.stats.spines);
      e.hp -= damage;
      e.stunTimer = 1.2;
      e.eatCooldown = 1.5;
      o.thinkTimer = 0;
      world.events.emit('sting', { attacker: e, prey: o, damage });
      if (e.hp <= 0) world.kill(e, 'stung', o);
      return;
    }
    if (o.stats.armor > 0 && world.rng.chance(o.stats.armor * 0.6)) {
      e.eatCooldown = 0.7;
      o.thinkTimer = 0;
      world.events.emit('biteFail', { eater: e, prey: o });
      return;
    }
  }
  const gain = mealGain(e, o);
  const points = mealPoints(o);
  e.energy = Math.min(100, e.energy + gain);
  e.eatCooldown = isGrazed(o) ? 0.5 : 0.35;
  e.chaseTime = 0;
  world.kill(o, 'eaten', e);
  world.events.emit('eat', { eater: e, prey: o, gain, points });
}
