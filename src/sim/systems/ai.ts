/**
 * Creature behaviour. `aiThink` runs a few times per second and picks a state
 * by scoring threats, food and schoolmates; `steerActor` runs every tick and
 * turns the state into a desired velocity.
 */
import { clamp } from '../../engine/math';
import { metersToY, yToMeters, DEEP_ZONE_Y } from '../../world/depth';
import { SURFACE_Y } from '../../world/terrain';
import { canEat, isDeterred, isGrazed, relation } from '../foodWeb';
import { biomass } from '../stats';
import type { Entity } from '../types';
import type { World } from '../world';

// One query buffer per call site: world.near() clears its buffer, so a buffer
// must never be shared between a loop and anything that runs inside it.
const thinkBuf: Entity[] = [];
const foodBuf: Entity[] = [];

/** Fraction of max speed used when cruising. */
export const CRUISE = 0.35;
export const AMBUSH_CRUISE = 0.12;
/** Give up a chase after this many seconds. */
const MAX_CHASE = 5;
const SCHOOL_RADIUS = 44;
const PARASITE_SEEK = 0.35;

const speedOf = (e: Entity) => Math.sqrt(e.vx * e.vx + e.vy * e.vy);

/** Distance at which `observer` can notice `target`. */
export function noticeRange(observer: Entity, target: Entity): number {
  let r = observer.stats.perception * (1 - target.stats.camo * 0.6);
  if (target.hidden) r *= 0.35;
  if (target.def.behavior.ambush && speedOf(target) < target.stats.maxSpeed * 0.2) r *= 0.6;
  return r;
}

export function aiThink(world: World, e: Entity): void {
  if (e.stunTimer > 0) {
    e.state = 'stunned';
    return;
  }
  const near = world.near(e.x, e.y, e.stats.perception, thinkBuf);
  const hunger = 1 - e.energy / 100;
  const ambush = e.def.behavior.ambush;
  const isCleaner = e.def.behavior.cleaner;
  let fx = 0;
  let fy = 0;
  let threat = 0;
  let best: Entity | null = null;
  let bestScore = 0;
  let cleaner: Entity | null = null;
  let cleanerD = Infinity;
  let n = 0;
  let cx = 0;
  let cy = 0;
  let ax = 0;
  let ay = 0;
  let sx = 0;
  let sy = 0;

  for (const o of near) {
    if (o === e || !o.alive) continue;
    const dx = e.x - o.x;
    const dy = e.y - o.y;
    const d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy));
    const oActor = o.def.kind === 'fish' || o.def.kind === 'mammal';

    if (oActor) {
      const rel = relation(e, o);
      if (rel === 'flee') {
        const r = noticeRange(e, o);
        if (d < r) {
          const w = 1 - d / r;
          threat = Math.max(threat, w);
          fx += (dx / d) * w;
          fy += (dy / d) * w;
        }
        continue;
      }
      if (rel === 'eat' && !isDeterred(e, o)) {
        const r = noticeRange(e, o);
        if (d < r) {
          const score = (1 - d / r) * Math.sqrt(biomass(o.def)) * (o.isPlayer ? 1.15 : 1);
          if (score > bestScore) {
            bestScore = score;
            best = o;
          }
        }
      }
      if (isCleaner && o.def.kind === 'fish' && o.parasites > 0.2 && !canEat(o, e) && d < e.stats.perception) {
        const score = o.parasites * (1 - d / e.stats.perception) * 6;
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
      if (o.def.behavior.cleaner && !isCleaner && e.parasites > PARASITE_SEEK && !canEat(e, o) && d < cleanerD) {
        cleaner = o;
        cleanerD = d;
      }
      if (o.def.id === e.def.id && e.def.behavior.schooling > 0 && d < SCHOOL_RADIUS) {
        n++;
        cx += o.x;
        cy += o.y;
        ax += o.vx;
        ay += o.vy;
        if (d < 8 + e.def.length * 0.6) {
          sx += dx / d;
          sy += dy / d;
        }
      }
    } else if (canEat(e, o)) {
      const r = noticeRange(e, o);
      if (d < r) {
        const score = (1 - d / r) * Math.sqrt(biomass(o.def)) * (isGrazed(o) ? 0.8 : 1);
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
    }
  }

  e.schoolN = n;
  if (n > 0) {
    e.cohX = cx / n - e.x;
    e.cohY = cy / n - e.y;
    e.aliX = ax / n;
    e.aliY = ay / n;
  }
  e.sepX = sx;
  e.sepY = sy;

  const prevTarget = e.targetId;
  if (threat > 0) {
    e.state = 'flee';
    e.fleeX = fx;
    e.fleeY = fy;
    e.targetId = -1;
  } else if (cleaner) {
    e.state = 'seekCleaner';
    e.targetId = cleaner.id;
  } else if (
    e.def.kind === 'fish' &&
    !isCleaner &&
    e.parasites > PARASITE_SEEK + 0.1 &&
    hunger < 0.6 &&
    yToMeters(world.terrain.floorAt(e.x)) <= e.def.depth[1] + 10
  ) {
    // No cleaner around: rub on the bottom to shed parasites.
    e.state = 'seekCleaner';
    e.targetId = -1;
  } else if (best && e.eatCooldown <= 0 && (hunger > 0.2 || isCleaner)) {
    const d = Math.sqrt((best.x - e.x) ** 2 + (best.y - e.y) ** 2);
    if (ambush && !isGrazed(best) && d > e.stats.perception * 0.45) {
      e.state = 'wander';
      e.targetId = -1;
    } else {
      e.state = isGrazed(best) ? 'forage' : 'hunt';
      e.targetId = best.id;
    }
  } else {
    e.state = 'wander';
    e.targetId = -1;
  }
  if (e.targetId !== prevTarget) e.chaseTime = 0;
}

/** Desired velocity for an actor (AI or player); applied by movement. */
export function steerActor(world: World, e: Entity, dt: number): void {
  if (e.stunTimer > 0) {
    e.stunTimer -= dt;
    e.state = 'stunned';
    accelerate(e, 0, 0, dt);
    return;
  }
  if (e.isPlayer) {
    const inp = world.inputFor(e);
    const m = Math.sqrt(inp.x * inp.x + inp.y * inp.y);
    const speed = e.stats.maxSpeed * (inp.burst ? 1.15 : 0.8);
    if (m > 0.01) accelerate(e, (inp.x / m) * speed * Math.min(1, m), (inp.y / m) * speed * Math.min(1, m), dt);
    else accelerate(e, 0, 0, dt * 0.5);
    return;
  }

  const max = e.stats.maxSpeed;
  let dx = 0;
  let dy = 0;
  let speed = max * CRUISE;

  if (e.state === 'seekCleaner' && e.targetId === -1) {
    // Flashing: settle on the bottom until parasites are scraped off.
    if (e.parasites < 0.05) e.state = 'wander';
    else {
      const gap = world.terrain.floorAt(e.x) - (e.y + e.def.height / 2);
      const sp = gap < 6 ? max * 0.08 : max * 0.4;
      accelerate(e, Math.cos(e.wanderAngle) * sp * 0.3, sp, dt);
      return;
    }
  }

  switch (e.state) {
    case 'flee': {
      const m = Math.sqrt(e.fleeX * e.fleeX + e.fleeY * e.fleeY) || 1;
      dx = e.fleeX / m;
      dy = e.fleeY / m;
      speed = max;
      break;
    }
    case 'seekCleaner':
    case 'hunt':
    case 'forage': {
      const t = world.get(e.targetId);
      e.chaseTime += dt;
      if (!t || e.chaseTime > MAX_CHASE) {
        if (t && e.state === 'hunt') e.eatCooldown = 2;
        e.state = 'wander';
        e.targetId = -1;
        return steerActor(world, e, dt);
      }
      const lead = e.state === 'hunt' ? 0.25 : 0;
      // Aim so that the mouth (front of the body) meets the target.
      const tx = t.x + t.vx * lead - Math.sign(t.x - e.x) * e.def.length * 0.3;
      const ty = t.y + t.vy * lead;
      const ddx = tx - e.x;
      const ddy = ty - e.y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      dx = ddx / d;
      dy = ddy / d;
      if (e.state === 'forage') speed = max * 0.5;
      else if (e.state === 'seekCleaner') speed = d < 10 ? max * 0.05 : max * 0.5;
      else if (e.def.behavior.ambush) speed = d < e.stats.perception * 0.45 ? max * 1.1 : max * AMBUSH_CRUISE;
      else speed = max * 0.95;
      // Slow on approach so small grazers don't overshoot their food.
      if (d < 12) speed = Math.min(speed, Math.max(max * 0.3, d * 4));
      break;
    }
    default: {
      e.wanderAngle += (world.rng.next() - 0.5) * 4 * dt;
      dx = Math.cos(e.wanderAngle);
      dy = Math.sin(e.wanderAngle) * 0.5;
      speed = max * (e.def.behavior.ambush ? AMBUSH_CRUISE : CRUISE);
      const sch = e.def.behavior.schooling;
      if (sch > 0 && e.schoolN > 0) {
        const am = Math.sqrt(e.aliX * e.aliX + e.aliY * e.aliY) || 1;
        dx += (e.cohX / SCHOOL_RADIUS) * sch * 1.2 + (e.aliX / am) * sch * 1.5 + e.sepX * 1.5;
        dy += (e.cohY / SCHOOL_RADIUS) * sch * 1.2 + (e.aliY / am) * sch * 1.5 + e.sepY * 1.5;
      }
      const [hx, hy] = homeForce(world, e);
      dx += hx;
      dy += hy;
      break;
    }
  }

  // Keep off the floor and out of the surface film unless chasing food there.
  if (e.state === 'wander' || e.state === 'flee') {
    const floor = world.terrain.floorAt(e.x + e.facing * 8);
    if (e.y + e.def.height / 2 > floor - 8) dy -= 1.2;
    if (e.y - e.def.height / 2 < SURFACE_Y + 4 && e.def.depth[0] > 0.5) dy += 1;
  }

  const m = Math.sqrt(dx * dx + dy * dy);
  if (m < 0.001) accelerate(e, 0, 0, dt);
  else accelerate(e, (dx / m) * speed, (dy / m) * speed, dt);
}

/** Pull back toward the home zone, preferred depth band and tolerable salinity. */
function homeForce(world: World, e: Entity): [number, number] {
  const z = world.terrain.zoneDef(e.homeZone);
  let fx = 0;
  let fy = 0;
  const margin = 80;
  if (e.x < z.x[0] + margin) fx += clamp((z.x[0] + margin - e.x) / margin, 0, 2);
  if (e.x > z.x[1] - margin) fx -= clamp((e.x - (z.x[1] - margin)) / margin, 0, 2);
  const sal = world.terrain.salinityAt(e.x);
  if (sal < e.def.salinity[0] || sal > e.def.salinity[1]) fx += Math.sign((z.x[0] + z.x[1]) / 2 - e.x) * 2;
  let yMin = metersToY(e.def.depth[0]);
  let yMax = metersToY(e.def.depth[1]);
  if (e.homeZone === 'deep') yMin = Math.max(yMin, DEEP_ZONE_Y + 10);
  if (e.homeZone === 'dropoff') yMax = Math.min(yMax, DEEP_ZONE_Y - 10);
  if (e.y < yMin) fy += clamp((yMin - e.y) / 30, 0, 1.5);
  if (e.y > yMax) fy -= clamp((e.y - yMax) / 30, 0, 1.5);
  return [fx, fy];
}

/** Ease velocity toward a desired velocity at a rate set by agility. */
export function accelerate(e: Entity, tvx: number, tvy: number, dt: number): void {
  const k = Math.min(1, (1.5 + e.stats.agility * 6) * dt);
  e.vx += (tvx - e.vx) * k;
  e.vy += (tvy - e.vy) * k;
}

/** Simple motion for non-fish life: drifting plankton, crawling crabs, darting shrimp. */
export function steerFood(world: World, e: Entity, dt: number): void {
  const b = e.def.behavior;
  const max = e.stats.maxSpeed;
  e.age += dt;
  switch (b.movement) {
    case 'static':
      e.vx = 0;
      e.vy = 0;
      return;
    case 'drift': {
      const ph = e.id * 1.7;
      e.vx = Math.sin(e.age * 0.6 + ph) * max;
      e.vy = Math.cos(e.age * 0.45 + ph) * max * 0.5 + (e.homeY - e.y) * 0.05;
      return;
    }
    case 'crawl': {
      e.thinkTimer -= dt;
      if (e.thinkTimer <= 0) {
        e.thinkTimer = world.rng.range(1, 4);
        e.vx = world.rng.chance(0.3) ? 0 : (world.rng.chance(0.5) ? 1 : -1) * max;
        if (Math.abs(e.x - e.homeX) > 60) e.vx = Math.sign(e.homeX - e.x) * max;
      }
      e.vy = 0;
      return;
    }
    case 'swim': {
      e.thinkTimer -= dt;
      if (e.thinkTimer <= 0) {
        e.thinkTimer = world.rng.range(0.3, 1.2);
        let fx = 0;
        let fy = 0;
        for (const o of world.near(e.x, e.y, 28, foodBuf)) {
          if (o !== e && o.alive && canEat(o, e)) {
            fx += e.x - o.x;
            fy += e.y - o.y;
          }
        }
        const fm = Math.sqrt(fx * fx + fy * fy);
        if (fm > 0) {
          e.vx = (fx / fm) * max * 1.5;
          e.vy = (fy / fm) * max * 1.5;
        } else {
          const a = world.rng.range(0, Math.PI * 2);
          const hx = (e.homeX - e.x) / 40;
          const hy = (e.homeY - e.y) / 40;
          e.vx = (Math.cos(a) + hx) * max * 0.5;
          e.vy = (Math.sin(a) * 0.5 + hy) * max * 0.5;
        }
      }
      return;
    }
  }
}
