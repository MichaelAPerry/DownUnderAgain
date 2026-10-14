/**
 * Custom Fish Sandbox: a point-buy builder that turns a small, validated spec
 * into a full SpeciesDef. Stats drive the sprite (size sets length, shape
 * and colours are chosen), so every custom fish gets generated pixel art.
 */
import type { BodyShape, FoodTag, Pattern, SpeciesDef, ZoneId } from './schema';
import { ZONE_IDS } from './schema';
import { PALETTE_KEYS, isPaletteKey } from './palette';
import type { PaletteKey } from './palette';
import { validateSpecies } from './validate';

export const SANDBOX_POINTS = 20;
export const STAT_MAX = 5;

export const SANDBOX_STATS = ['size', 'speed', 'agility', 'senses', 'jaw', 'camo', 'spines', 'armor', 'efficiency'] as const;
export type SandboxStat = (typeof SANDBOX_STATS)[number];

export const STAT_LABELS: Record<SandboxStat, string> = {
  size: 'Size',
  speed: 'Speed',
  agility: 'Agility',
  senses: 'Senses',
  jaw: 'Jaw',
  camo: 'Camouflage',
  spines: 'Spines',
  armor: 'Armor',
  efficiency: 'Efficiency',
};

export const DIETS = ['herbivore', 'planktivore', 'omnivore', 'carnivore'] as const;
export type Diet = (typeof DIETS)[number];

export const DIET_TAGS: Record<Diet, FoodTag[]> = {
  herbivore: ['algae', 'seagrass'],
  planktivore: ['plankton', 'crustacean', 'insect'],
  omnivore: ['algae', 'plankton', 'insect', 'crustacean', 'worm'],
  carnivore: ['fish', 'crustacean', 'worm', 'mollusk', 'insect'],
};

export const CUSTOM_SHAPES: readonly BodyShape[] = ['fusiform', 'deep', 'elongate', 'shark', 'billfish', 'lionfish'];
export const CUSTOM_PATTERNS: readonly Pattern[] = ['none', 'bars', 'stripe', 'stripes-thin', 'spots', 'mottled', 'eyespot', 'saddle'];

export interface CustomFishSpec {
  name: string;
  stats: Record<SandboxStat, number>;
  diet: Diet;
  home: ZoneId;
  /** Tolerates both fresh and salt water; costs 2 points. */
  euryhaline: boolean;
  shape: BodyShape;
  pattern: Pattern;
  colors: { body: PaletteKey; belly: PaletteKey; fin: PaletteKey; accent: PaletteKey };
}

const LENGTHS = [8, 14, 22, 32, 46, 60];
const HEIGHT_RATIO: Partial<Record<BodyShape, number>> = {
  fusiform: 0.38, deep: 0.62, elongate: 0.2, shark: 0.26, billfish: 0.22, lionfish: 0.6,
};

export function defaultSpec(): CustomFishSpec {
  return {
    name: 'MY FISH',
    stats: { size: 1, speed: 2, agility: 2, senses: 2, jaw: 1, camo: 1, spines: 0, armor: 0, efficiency: 1 },
    diet: 'omnivore',
    home: 'seagrass',
    euryhaline: false,
    shape: 'fusiform',
    pattern: 'stripe',
    colors: { body: 'orange', belly: 'cream', fin: 'red', accent: 'ink' },
  };
}

/** Size costs double: being big is powerful. */
export function statCost(stat: SandboxStat, level: number): number {
  return stat === 'size' ? level * 2 : level;
}

export function pointsSpent(spec: CustomFishSpec): number {
  let n = spec.euryhaline ? 2 : 0;
  for (const s of SANDBOX_STATS) n += statCost(s, spec.stats[s]);
  return n;
}

export function sanitizeName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'MY FISH';
}

/** Strictly validate an untrusted spec (e.g. from localStorage). */
export function isValidSpec(v: unknown): v is CustomFishSpec {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== 'string' || sanitizeName(o.name) !== o.name) return false;
  const st = o.stats as Record<string, unknown> | null;
  if (typeof st !== 'object' || st === null) return false;
  for (const s of SANDBOX_STATS) {
    const n = st[s];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > STAT_MAX) return false;
  }
  if (typeof st.size === 'number' && st.size < 1) return false;
  if (!DIETS.includes(o.diet as Diet)) return false;
  if (!ZONE_IDS.includes(o.home as ZoneId)) return false;
  if (typeof o.euryhaline !== 'boolean') return false;
  if (!CUSTOM_SHAPES.includes(o.shape as BodyShape)) return false;
  if (!CUSTOM_PATTERNS.includes(o.pattern as Pattern)) return false;
  const c = o.colors as Record<string, unknown> | null;
  if (typeof c !== 'object' || c === null) return false;
  for (const k of ['body', 'belly', 'fin', 'accent']) if (!isPaletteKey(c[k])) return false;
  return pointsSpent(v as CustomFishSpec) <= SANDBOX_POINTS;
}

const ZONE_SALINITY: Record<ZoneId, number> = { spring: 0, estuary: 0.5, seagrass: 0.9, reef: 1, dropoff: 1, deep: 1 };
const ZONE_DEPTH: Record<ZoneId, [number, number]> = {
  spring: [0, 12], estuary: [0, 12], seagrass: [0, 14], reef: [0, 30], dropoff: [0, 150], deep: [150, 600],
};

export function buildCustomDef(spec: CustomFishSpec): SpeciesDef {
  const s = spec.stats;
  const length = LENGTHS[Math.max(0, Math.min(LENGTHS.length - 1, s.size - 1))] ?? 14;
  const height = Math.max(3, Math.round(length * (HEIGHT_RATIO[spec.shape] ?? 0.38)));
  const sal = ZONE_SALINITY[spec.home];
  const salinity: [number, number] = spec.euryhaline ? [0, 1] : [Math.max(0, sal - 0.3), Math.min(1, sal + 0.3)];
  const carn = spec.diet === 'carnivore';
  const def: SpeciesDef = {
    id: 'custom',
    name: spec.name,
    scientific: 'Piscis customus',
    kind: 'fish',
    tier: carn ? (s.size >= 4 ? 'apex' : 'carnivore') : spec.diet === 'herbivore' ? 'herbivore' : 'omnivore',
    playable: true,
    native: true,
    length,
    height,
    look: { shape: spec.shape, pattern: spec.pattern, colors: { ...spec.colors } },
    stats: {
      maxSpeed: Math.round(38 + s.speed * 17 + s.size * 4),
      agility: Math.min(1, 0.3 + s.agility * 0.13),
      perception: Math.round(55 + s.senses * 22 + s.size * 8),
      metabolism: +((2.2 - s.size * 0.28) * (1 - s.efficiency * 0.1)).toFixed(2),
      jaw: +((carn ? 0.35 : 0.25) + s.jaw * 0.07).toFixed(2),
      camo: +(s.camo * 0.14).toFixed(2),
      spines: +(s.spines * 0.15).toFixed(2),
      armor: +(s.armor * 0.14).toFixed(2),
    },
    diet: DIET_TAGS[spec.diet],
    foodTag: 'fish',
    salinity,
    depth: ZONE_DEPTH[spec.home],
    habitats: [{ zone: spec.home, count: 0 }],
    behavior: { schooling: 0, ambush: false, cleaner: false, respectsCleaners: true, groupSize: [1, 1], movement: 'swim' },
    codex: {
      size: `${length * 2} cm (game scale)`,
      blurb: 'A one-of-a-kind fish designed in the Custom Fish Sandbox.',
      fact: 'Every stat point you spent shaped how this fish looks and lives.',
      status: 'Imaginary',
    },
  };
  const problems = validateSpecies(def);
  if (problems.length) throw new Error(`invalid custom fish: ${problems.join('; ')}`);
  return def;
}

export const COLOR_CHOICES: readonly PaletteKey[] = PALETTE_KEYS;
