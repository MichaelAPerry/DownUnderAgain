/** Hunger, parasites, salinity stress, depth comfort and healing. */
import { yToMeters } from '../../world/depth';
import type { DeathCause, Entity } from '../types';
import type { World } from '../world';

/** Parasite load gained per second (reaches the 0.5 danger line in ~100 s). */
export const PARASITE_RATE = 0.005;
export const PARASITE_DANGER = 0.5;
/** Parasites shed per second while rubbing on the bottom ("flashing"). */
export const FLASH_RATE = 0.06;
/** Global pacing knob for hunger. */
export const METABOLISM_SCALE = 0.75;

/** Touching the bottom slowly enough to scrape off parasites. */
export function isFlashing(world: World, e: Entity): boolean {
  const floor = world.terrain.floorAt(e.x);
  const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
  return e.y + e.def.height / 2 >= floor - 3 && sp < e.stats.maxSpeed * 0.5;
}

export interface Stress {
  salinity: number;
  depth: number;
}

/** How far outside its tolerances a creature currently is (0 = comfortable). */
export function stressAt(world: World, e: Entity): Stress {
  const s = world.terrain.salinityAt(e.x);
  const salinity = Math.max(0, e.def.salinity[0] - s, s - e.def.salinity[1]);
  const m = yToMeters(e.y);
  const [d0, d1] = e.def.depth;
  const span = Math.max(5, d1 - d0);
  const depth = m < d0 ? (d0 - m) / span : m > d1 ? (m - d1) / span : 0;
  return { salinity, depth: Math.min(1, depth) };
}

export function metabolize(world: World, e: Entity, dt: number): void {
  if (e.def.kind !== 'fish' && e.def.kind !== 'mammal') return;
  const st = stressAt(world, e);
  let drain = 1;
  if (e.isPlayer && world.input.burst && (world.input.x !== 0 || world.input.y !== 0)) drain += 1.5;
  else if (!e.isPlayer && (e.state === 'flee' || e.state === 'hunt')) drain += 0.3;
  if (st.salinity > 0) drain += 1 + st.salinity * 4;
  drain += st.depth;

  e.energy -= e.stats.metabolism * METABOLISM_SCALE * drain * dt;
  let cause: DeathCause | null = null;
  let damage = 0;
  if (e.energy <= 0) {
    e.energy = 0;
    damage += 5 * dt;
    cause = 'starved';
  }
  if (st.salinity > 0) {
    damage += (3 + st.salinity * 25) * dt;
    cause = 'salinity';
  }
  if (e.def.kind === 'fish' && !e.def.behavior.cleaner) {
    const shed = isFlashing(world, e) ? FLASH_RATE : 0;
    e.parasites = Math.max(0, Math.min(1, e.parasites + (PARASITE_RATE * (e.isPlayer ? 1 : 0.5) - shed) * dt));
    if (e.parasites > PARASITE_DANGER) {
      damage += (e.parasites - PARASITE_DANGER) * 8 * dt;
      cause ??= 'parasites';
    }
  }
  if (damage > 0) {
    e.hp -= damage;
    if (e.hp <= 0) {
      e.hp = 0;
      world.kill(e, cause ?? 'starved', null);
    }
  } else if (e.energy > 40 && e.hp < e.maxHp) {
    e.hp = Math.min(e.maxHp, e.hp + 1.5 * dt);
  }
}
