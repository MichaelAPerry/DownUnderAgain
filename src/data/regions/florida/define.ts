/**
 * Builders for the Florida species / food tables. They fill in the repetitive
 * defaults so each entry only states what is specific to it. Optional keys are
 * only ever set when given (exactOptionalPropertyTypes).
 */
import type {
  CodexEntry,
  CreatureKind,
  FishLook,
  FoodSpriteId,
  FoodTag,
  Habitat,
  SpeciesBehavior,
  SpeciesDef,
  SpeciesStats,
  Tier,
  ZoneId,
} from '../../schema';

/** [zone, target population] pairs. */
type HabitatTuple = readonly [ZoneId, number];

const toHabitats = (list: readonly HabitatTuple[]): Habitat[] =>
  list.map(([zone, count]) => ({ zone, count }));

/** Stats a fish must state; camo / spines / armor default to a plain body. */
type FishStats = Pick<SpeciesStats, 'maxSpeed' | 'agility' | 'perception' | 'metabolism' | 'jaw'> &
  Partial<Pick<SpeciesStats, 'camo' | 'spines' | 'armor'>>;

export interface FishInput {
  id: string;
  name: string;
  scientific: string;
  /** Defaults to 'fish'. */
  kind?: CreatureKind;
  tier: Tier;
  /** Defaults to true. */
  playable?: boolean;
  /** Defaults to true. */
  native?: boolean;
  /** [length, height] in px. */
  size: readonly [number, number];
  look: FishLook;
  stats: FishStats;
  diet: FoodTag[];
  /** Defaults to 'fish'. */
  foodTag?: FoodTag | null;
  salinity: [number, number];
  depth: [number, number];
  habitats: readonly HabitatTuple[];
  behavior?: Partial<SpeciesBehavior>;
  codex: CodexEntry;
}

export function fish(f: FishInput): SpeciesDef {
  return {
    id: f.id,
    name: f.name,
    scientific: f.scientific,
    kind: f.kind ?? 'fish',
    tier: f.tier,
    playable: f.playable ?? true,
    native: f.native ?? true,
    length: f.size[0],
    height: f.size[1],
    look: f.look,
    stats: { camo: 0.1, spines: 0, armor: 0, ...f.stats },
    diet: f.diet,
    foodTag: f.foodTag === undefined ? 'fish' : f.foodTag,
    salinity: f.salinity,
    depth: f.depth,
    habitats: toHabitats(f.habitats),
    behavior: {
      schooling: 0,
      ambush: false,
      cleaner: false,
      respectsCleaners: true,
      groupSize: [1, 1],
      movement: 'swim',
      ...f.behavior,
    },
    codex: f.codex,
  };
}

export interface FoodInput {
  id: string;
  name: string;
  scientific: string;
  kind: CreatureKind;
  sprite: FoodSpriteId;
  /** Defaults to [] (food does not eat). */
  diet?: FoodTag[];
  foodTag: FoodTag;
  /** [length, height] in px. */
  size: readonly [number, number];
  /** maxSpeed is required; the rest default to an inert food item. */
  stats: Pick<SpeciesStats, 'maxSpeed'> & Partial<SpeciesStats>;
  salinity: [number, number];
  depth: [number, number];
  habitats: readonly HabitatTuple[];
  /** movement is required; the rest default to a solitary, passive item. */
  behavior: Pick<SpeciesBehavior, 'movement'> & Partial<SpeciesBehavior>;
  codex: CodexEntry;
}

export function food(f: FoodInput): SpeciesDef {
  return {
    id: f.id,
    name: f.name,
    scientific: f.scientific,
    kind: f.kind,
    tier: 'food',
    playable: false,
    native: true,
    length: f.size[0],
    height: f.size[1],
    sprite: f.sprite,
    stats: { agility: 0.3, perception: 40, metabolism: 0, jaw: 0, camo: 0.1, spines: 0, armor: 0, ...f.stats },
    diet: f.diet ?? [],
    foodTag: f.foodTag,
    salinity: f.salinity,
    depth: f.depth,
    habitats: toHabitats(f.habitats),
    behavior: {
      schooling: 0,
      ambush: false,
      cleaner: false,
      respectsCleaners: true,
      groupSize: [1, 1],
      ...f.behavior,
    },
    codex: f.codex,
  };
}
