/**
 * The simulation: a deterministic fixed-step world of creatures on a static
 * terrain. Knows nothing about rendering, input devices or the DOM.
 */
import type { SpeciesDef, SpeciesStats, ZoneId } from '../data/schema';
import type { Region } from '../data/regions/florida';
import { EventBus } from '../engine/eventBus';
import { Rng, hashString } from '../engine/rng';
import { SpatialHash } from '../engine/spatialHash';
import { Terrain } from '../world/terrain';
import { BASE_MAX_HP } from './stats';
import type { DeathCause, Entity, PlayerInput, SimEvents } from './types';
import { aiThink, steerActor, steerFood } from './systems/ai';
import { integrate } from './systems/movement';
import { resolveContacts } from './systems/feeding';
import { metabolize } from './systems/metabolism';
import { Spawner } from './systems/spawner';

export const SIM_DT = 1 / 60;
const MAX_ENTITIES = 900;

export interface SpawnOptions {
  isPlayer?: boolean;
  stats?: SpeciesStats;
  maxHp?: number;
}

export class World {
  readonly region: Region;
  readonly seed: number;
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly events = new EventBus<SimEvents>();
  readonly entities: Entity[] = [];
  readonly hash = new SpatialHash<Entity>(64);
  readonly spawner: Spawner;
  readonly input: PlayerInput = { x: 0, y: 0, burst: false };
  player: Entity | null = null;
  time = 0;
  /** Lionfish removed by anyone; feeds the invasive-pressure model. */
  invasivesRemoved = 0;
  private readonly byId = new Map<number, Entity>();
  private nextId = 1;

  constructor(region: Region, seed: number) {
    this.region = region;
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.terrain = new Terrain(region.zones, region.width, region.height, hashString(`terrain:${this.seed}`));
    this.spawner = new Spawner(this);
    this.spawner.fillInitial();
    this.rebuildHash();
  }

  get(id: number): Entity | undefined {
    const e = this.byId.get(id);
    return e && e.alive ? e : undefined;
  }

  spawn(def: SpeciesDef, x: number, y: number, homeZone: ZoneId, opts: SpawnOptions = {}): Entity | null {
    if (this.entities.length >= MAX_ENTITIES && !opts.isPlayer) return null;
    const e: Entity = {
      id: this.nextId++,
      def,
      stats: opts.stats ? { ...opts.stats } : { ...def.stats },
      maxHp: opts.maxHp ?? BASE_MAX_HP,
      homeZone,
      x,
      y,
      vx: 0,
      vy: 0,
      px: x,
      py: y,
      facing: this.rng.chance(0.5) ? 1 : -1,
      energy: opts.isPlayer ? 80 : this.rng.range(55, 85),
      hp: opts.maxHp ?? BASE_MAX_HP,
      parasites: opts.isPlayer || def.kind !== 'fish' || def.behavior.cleaner ? 0 : this.rng.range(0, 0.3),
      alive: true,
      isPlayer: opts.isPlayer ?? false,
      state: 'wander',
      targetId: -1,
      fleeX: 0,
      fleeY: 0,
      thinkTimer: this.rng.range(0, 0.2),
      wanderAngle: this.rng.range(0, Math.PI * 2),
      eatCooldown: 0,
      stunTimer: 0,
      hidden: false,
      age: this.rng.range(0, 10),
      homeX: x,
      homeY: y,
      chaseTime: 0,
      schoolN: 0,
      cohX: 0,
      cohY: 0,
      aliX: 0,
      aliY: 0,
      sepX: 0,
      sepY: 0,
    };
    this.entities.push(e);
    this.byId.set(e.id, e);
    this.hash.insert(e);
    return e;
  }

  /**
   * Place the player in their home zone and clear any immediate predators so
   * a run never starts with an unavoidable death.
   */
  addPlayer(def: SpeciesDef, stats: SpeciesStats, maxHp: number, zone: ZoneId): Entity {
    const z = this.terrain.zoneDef(zone);
    const x = Math.round((z.x[0] + z.x[1]) / 2);
    const y = this.spawner.pickY(def, zone, x) ?? Math.min(60, this.terrain.floorAt(x) - def.height);
    const p = this.spawn(def, x, y, zone, { isPlayer: true, stats, maxHp });
    if (!p) throw new Error('could not spawn player');
    this.player = p;
    for (const o of this.entities) {
      if (o === p || !o.alive) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      if (dx * dx + dy * dy < 160 * 160 && o.def.diet.includes('fish') && o.def.length > def.length) {
        this.kill(o, 'eaten', null, true);
      }
    }
    this.removeDead();
    this.rebuildHash();
    return p;
  }

  /** Swap the player's stats (used after an evolution purchase). */
  setPlayerStats(stats: SpeciesStats, maxHp: number): void {
    const p = this.player;
    if (!p) return;
    const ratio = p.hp / p.maxHp;
    p.stats = { ...stats };
    p.maxHp = maxHp;
    p.hp = Math.max(1, Math.round(maxHp * ratio));
  }

  kill(e: Entity, cause: DeathCause, by: Entity | null, silent = false): void {
    if (!e.alive) return;
    e.alive = false;
    if (!e.def.native && (cause === 'eaten' || cause === 'stung')) this.invasivesRemoved++;
    if (!silent) this.events.emit('death', { entity: e, cause, by });
  }

  step(dt: number = SIM_DT): void {
    this.time += dt;
    const ents = this.entities;
    for (const e of ents) {
      e.px = e.x;
      e.py = e.y;
    }
    for (const e of ents) {
      if (!e.alive) continue;
      const actor = e.def.kind === 'fish' || e.def.kind === 'mammal';
      if (actor && !e.isPlayer) {
        e.thinkTimer -= dt;
        if (e.thinkTimer <= 0) {
          e.thinkTimer = 0.12 + this.rng.next() * 0.12;
          aiThink(this, e);
        }
      }
      if (actor) steerActor(this, e, dt);
      else steerFood(this, e, dt);
      integrate(this, e, dt);
    }
    this.rebuildHash();
    resolveContacts(this, dt);
    for (const e of ents) if (e.alive) metabolize(this, e, dt);
    this.removeDead();
    this.spawner.update(dt);
  }

  private removeDead(): void {
    const ents = this.entities;
    let w = 0;
    for (let r = 0; r < ents.length; r++) {
      const e = ents[r] as Entity;
      if (e.alive || e.isPlayer) ents[w++] = e;
      else this.byId.delete(e.id);
    }
    ents.length = w;
  }

  rebuildHash(): void {
    this.hash.clear();
    for (const e of this.entities) if (e.alive) this.hash.insert(e);
  }

  /** Alive entities within radius of a point (excluding none). */
  near(x: number, y: number, radius: number, out: Entity[]): Entity[] {
    out.length = 0;
    return this.hash.query(x, y, radius, out);
  }
}
