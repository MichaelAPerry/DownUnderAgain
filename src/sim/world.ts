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
const IDLE_INPUT: Readonly<PlayerInput> = Object.freeze({ x: 0, y: 0, burst: false });
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
  /** The local player's input (written by the app each frame). */
  readonly input: PlayerInput = { x: 0, y: 0, burst: false };
  /** The local player (null on a network client or in attract mode). */
  player: Entity | null = null;
  /** Input per player entity id: the local player plus any network players. */
  private readonly inputs = new Map<number, PlayerInput>();
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
    const p = this.placePlayer(def, stats, maxHp, zone, 0);
    this.player = p;
    this.inputs.set(p.id, this.input);
    return p;
  }

  /**
   * Add another player (LAN multiplayer). Returns the entity and its input
   * object, which the network layer updates as that player's inputs arrive.
   * `slot` spreads players out so friends don't spawn on top of each other.
   */
  addRemotePlayer(def: SpeciesDef, zone: ZoneId, slot: number): { entity: Entity; input: PlayerInput } {
    const p = this.placePlayer(def, def.stats, BASE_MAX_HP, zone, slot);
    const input: PlayerInput = { x: 0, y: 0, burst: false };
    this.inputs.set(p.id, input);
    return { entity: p, input };
  }

  /** The input steering a player entity (idle if none is registered). */
  inputFor(e: Entity): PlayerInput {
    return this.inputs.get(e.id) ?? IDLE_INPUT;
  }

  /** Every living player entity, local and remote. */
  livePlayers(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities) if (e.isPlayer && e.alive) out.push(e);
    return out;
  }

  /** Take an entity out of the world entirely (e.g. a player who left or respawned). */
  removeEntity(e: Entity): void {
    e.alive = false;
    this.inputs.delete(e.id);
    this.byId.delete(e.id);
    const i = this.entities.indexOf(e);
    if (i >= 0) this.entities.splice(i, 1);
    if (this.player === e) this.player = null;
    this.rebuildHash();
  }

  private placePlayer(def: SpeciesDef, stats: SpeciesStats, maxHp: number, zone: ZoneId, slot: number): Entity {
    const z = this.terrain.zoneDef(zone);
    const mid = (z.x[0] + z.x[1]) / 2;
    // Slots fan out from the zone centre: 0, +90, -90, +180, -180, ...
    const offset = slot === 0 ? 0 : Math.ceil(slot / 2) * 90 * (slot % 2 === 1 ? 1 : -1);
    const x = Math.round(Math.min(z.x[1] - 40, Math.max(z.x[0] + 40, mid + offset)));
    const y = this.spawner.pickY(def, zone, x) ?? Math.min(60, this.terrain.floorAt(x) - def.height);
    const p = this.spawn(def, x, y, zone, { isPlayer: true, stats, maxHp });
    if (!p) throw new Error('could not spawn player');
    // Clear AI predators right next to the new fish (never other players).
    for (const o of this.entities) {
      if (o === p || !o.alive || o.isPlayer) continue;
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

  /**
   * Entities within `radius` of a point, written into `out` (which is cleared
   * first). Each call site must own its buffer: never pass a buffer that an
   * enclosing loop is still iterating.
   */
  near(x: number, y: number, radius: number, out: Entity[]): Entity[] {
    out.length = 0;
    return this.hash.query(x, y, radius, out);
  }
}
