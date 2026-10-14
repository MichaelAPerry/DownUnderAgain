/** Integrates velocity and resolves collisions with the world bounds, floor and mangrove roots. */
import { clamp } from '../../engine/math';
import { SURFACE_Y } from '../../world/terrain';
import type { Entity } from '../types';
import type { World } from '../world';

/** Creatures longer than this cannot squeeze between mangrove prop roots. */
export const ROOT_PASS_LENGTH = 20;

export function integrate(world: World, e: Entity, dt: number): void {
  const actor = e.def.kind === 'fish' || e.def.kind === 'mammal';
  if (actor) {
    e.age += dt;
    if (e.eatCooldown > 0) e.eatCooldown -= dt;
    // Hard cap so burst + lunge never exceeds ~1.2x top speed.
    const cap = e.stats.maxSpeed * 1.2;
    const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (sp > cap) {
      e.vx = (e.vx / sp) * cap;
      e.vy = (e.vy / sp) * cap;
    }
    if (Math.abs(e.vx) > 2) e.facing = e.vx > 0 ? 1 : -1;
  }
  if (e.vx === 0 && e.vy === 0 && e.def.behavior.movement === 'static') return;

  const t = world.terrain;
  const halfL = e.def.length / 2;
  const halfH = e.def.height / 2;
  let nx = e.x + e.vx * dt;
  let ny = e.y + e.vy * dt;

  if (actor && e.def.length > ROOT_PASS_LENGTH && t.rootAt(nx, ny)) {
    // Blocked: slide vertically if possible, otherwise stop.
    if (!t.rootAt(e.x, ny)) nx = e.x;
    else {
      nx = e.x;
      ny = e.y;
    }
    e.vx *= -0.3;
  }

  nx = clamp(nx, halfL, t.width - halfL);
  const top = SURFACE_Y + halfH;
  const bottom = t.floorAt(nx) - halfH - 1;
  if (e.def.behavior.movement === 'crawl') {
    ny = bottom;
  } else if (ny > bottom) {
    ny = bottom;
    if (e.vy > 0) e.vy = 0;
  }
  if (ny < top) {
    ny = top;
    if (e.vy < 0) e.vy = 0;
  }
  e.x = nx;
  e.y = ny;

  if (actor) {
    const cover = t.coverAt(e.x, e.y);
    const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    e.hidden = cover > 0 && e.def.length <= cover && sp < e.stats.maxSpeed * 0.6;
  }
}
