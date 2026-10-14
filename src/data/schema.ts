/**
 * Data contracts for everything content-driven: zones, species, food items and
 * upgrades. Region packs (e.g. data/regions/florida) export values typed by
 * these interfaces; `validate.ts` enforces the invariants the types cannot.
 */
import type { PaletteKey } from './palette';

/** Habitat zones along the river-to-sea transect (west to east, then down). */
export type ZoneId = 'spring' | 'estuary' | 'seagrass' | 'reef' | 'dropoff' | 'deep';

export const ZONE_IDS: readonly ZoneId[] = ['spring', 'estuary', 'seagrass', 'reef', 'dropoff', 'deep'];

/** Food-web tier, used for UI grouping and tournament ordering. */
export type Tier = 'apex' | 'carnivore' | 'omnivore' | 'herbivore' | 'food';

/**
 * What a creature counts as when eaten, and what a diet can contain.
 * 'parasite' is special: only cleaners eat it, by grooming other fish.
 */
export type FoodTag =
  | 'algae'
  | 'seagrass'
  | 'coral'
  | 'plankton'
  | 'insect'
  | 'crustacean'
  | 'worm'
  | 'mollusk'
  | 'fish'
  | 'parasite';

export const FOOD_TAGS: readonly FoodTag[] = [
  'algae', 'seagrass', 'coral', 'plankton', 'insect', 'crustacean', 'worm', 'mollusk', 'fish', 'parasite',
];

/** Tags that are grazed: eaten regardless of the eater's jaw size. */
export const GRAZE_TAGS: readonly FoodTag[] = ['algae', 'seagrass', 'coral', 'plankton'];

export type CreatureKind = 'fish' | 'mammal' | 'invertebrate' | 'plant' | 'plankton';

/** How a creature moves when not driven by full fish AI. */
export type Movement = 'swim' | 'drift' | 'crawl' | 'static';

export type BodyShape =
  | 'fusiform'   // torpedo: snapper, bass, drum, mullet, snook
  | 'deep'       // tall disc: bluegill, tang, sergeant major, sheepshead
  | 'elongate'   // long & thin: gar, barracuda, goby, lanternfish
  | 'shark'
  | 'hammerhead'
  | 'billfish'   // swordfish
  | 'lionfish'
  | 'manatee';

export type Pattern =
  | 'none'
  | 'bars'          // bold vertical bars
  | 'stripe'        // one horizontal lateral stripe
  | 'stripes-thin'  // many thin vertical stripes
  | 'spots'
  | 'mottled'
  | 'eyespot'       // single dark spot near the tail
  | 'saddle';       // dark patch on the back

export interface FishLook {
  shape: BodyShape;
  colors: {
    body: PaletteKey;
    belly: PaletteKey;
    fin: PaletteKey;
    accent: PaletteKey;
  };
  pattern: Pattern;
  /** Bioluminescent photophores drawn above the deep-sea darkness. */
  glow?: PaletteKey;
}

/** Ids of hand-drawn sprites for non-fish creatures (see render/foodSprites.ts). */
export type FoodSpriteId =
  | 'algae'
  | 'seagrass'
  | 'coral'
  | 'plankton'
  | 'larva'
  | 'shrimp'
  | 'crab'
  | 'worm'
  | 'clam'
  | 'krill';

export interface Habitat {
  zone: ZoneId;
  /** Target population maintained by the spawner in this zone. */
  count: number;
}

export interface SpeciesStats {
  /** Top swim speed in world px per second. */
  maxSpeed: number;
  /** Turning / acceleration responsiveness, 0..1. */
  agility: number;
  /** Radius in px within which the creature notices others. */
  perception: number;
  /** Energy drained per second, in percent of max energy. */
  metabolism: number;
  /** Largest prey length as a fraction of own length (0..1). */
  jaw: number;
  /** 0..1 reduction of the distance at which predators notice it. */
  camo: number;
  /** 0..1 chance to repel a bite and injure the attacker. */
  spines: number;
  /** 0..1 chance-reduction of a bite succeeding. */
  armor: number;
}

export interface SpeciesBehavior {
  /** 0 = solitary, 1 = tight schooling. */
  schooling: number;
  /** Lurks almost still and strikes at short range. */
  ambush: boolean;
  /** Runs a cleaning station: eats parasites off client fish. */
  cleaner: boolean;
  /** Whether this predator honours the cleaner truce (invasives may not). */
  respectsCleaners: boolean;
  /** Spawn group size range, inclusive. */
  groupSize: [number, number];
  movement: Movement;
}

export interface CodexEntry {
  /** Human-readable typical adult size, e.g. "Up to 75 cm". */
  size: string;
  blurb: string;
  fact: string;
  /** Conservation / origin status, e.g. "Native", "Invasive", "Vulnerable (IUCN)". */
  status: string;
}

export interface SpeciesDef {
  id: string;
  name: string;
  scientific: string;
  kind: CreatureKind;
  tier: Tier;
  playable: boolean;
  native: boolean;
  /** Gameplay body length in px (also sprite length). */
  length: number;
  /** Gameplay body height in px (also sprite height). */
  height: number;
  /** Fish/mammal sprites are generated from `look`; everything else uses `sprite`. */
  look?: FishLook;
  sprite?: FoodSpriteId;
  stats: SpeciesStats;
  diet: FoodTag[];
  /** What this counts as when eaten; null = nothing in the game can eat it. */
  foodTag: FoodTag | null;
  /** Tolerated salinity range, 0 = fresh, 1 = full seawater. */
  salinity: [number, number];
  /** Comfortable depth range in metres. */
  depth: [number, number];
  habitats: Habitat[];
  behavior: SpeciesBehavior;
  codex: CodexEntry;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  /** World x-range in px. 'deep' shares the drop-off x-range and is defined by depth. */
  x: [number, number];
  salinity: number;
  /** Seafloor depth below the surface in px at this zone's centre (deep: abyssal floor). */
  floor: number;
  /** Background water colour near the surface. */
  water: PaletteKey;
  /** Floor material colours. */
  ground: PaletteKey;
  groundDark: PaletteKey;
  /** Short line shown on entering the zone. */
  tagline: string;
}

export type UpgradeStat = keyof SpeciesStats | 'maxHp';

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  stat: UpgradeStat;
  /** 'add' adds `perLevel` per level; 'mul' multiplies by (1 + perLevel) per level. */
  mode: 'add' | 'mul';
  perLevel: number;
  maxLevel: number;
  baseCost: number;
  /** Cost of level n (0-based) = round(baseCost * costGrowth^n). */
  costGrowth: number;
  /** UI accent colour. */
  color: PaletteKey;
}
