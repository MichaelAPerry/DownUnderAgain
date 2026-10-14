import type { SpeciesDef, SpeciesStats, ZoneId } from '../data/schema';

export type AIState = 'wander' | 'forage' | 'hunt' | 'flee' | 'seekCleaner' | 'stunned';

export interface Entity {
  readonly id: number;
  readonly def: SpeciesDef;
  /** Effective stats (base species stats plus any upgrades). */
  stats: SpeciesStats;
  maxHp: number;
  readonly homeZone: ZoneId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Position at the start of the last tick, for render interpolation. */
  px: number;
  py: number;
  facing: 1 | -1;
  /** 0..100 */
  energy: number;
  hp: number;
  /** 0..1 parasite load (fish only). */
  parasites: number;
  alive: boolean;
  readonly isPlayer: boolean;
  state: AIState;
  /** Entity id being hunted / approached, or -1. */
  targetId: number;
  /** Accumulated flee direction from the last think. */
  fleeX: number;
  fleeY: number;
  thinkTimer: number;
  wanderAngle: number;
  eatCooldown: number;
  stunTimer: number;
  /** In cover and small enough to be hard to spot. */
  hidden: boolean;
  /** Seconds alive; also drives animation. */
  age: number;
  /** Anchor point for cleaners / static creatures. */
  homeX: number;
  homeY: number;
  /** Seconds spent chasing the current target; long chases are abandoned. */
  chaseTime: number;
  /** Schooling forces cached at think time: cohesion offset, mean velocity, separation. */
  schoolN: number;
  cohX: number;
  cohY: number;
  aliX: number;
  aliY: number;
  sepX: number;
  sepY: number;
}

export type DeathCause = 'eaten' | 'starved' | 'parasites' | 'salinity' | 'stung';

export interface SimEvents {
  eat: { eater: Entity; prey: Entity; gain: number; points: number };
  biteFail: { eater: Entity; prey: Entity };
  sting: { attacker: Entity; prey: Entity; damage: number };
  clean: { cleaner: Entity; client: Entity; gain: number };
  death: { entity: Entity; cause: DeathCause; by: Entity | null };
}

export interface PlayerInput {
  /** Desired direction, components in [-1,1]. Zero vector = coast. */
  x: number;
  y: number;
  burst: boolean;
}
