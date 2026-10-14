/**
 * Invariants for region data that TypeScript cannot express. Run by the test
 * suite over every region pack, and reused to sanity-check custom fish.
 */
import { FOOD_TAGS, GRAZE_TAGS, ZONE_IDS } from './schema';
import type { SpeciesDef, ZoneDef } from './schema';
import { isPaletteKey } from './palette';
import { yToMeters } from '../world/depth';
import { DEEP_ZONE_METERS } from '../world/depth';

const inRange = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi;

/** Water column of a zone in metres. */
export function zoneColumn(z: ZoneDef): [number, number] {
  if (z.id === 'deep') return [DEEP_ZONE_METERS, yToMeters(z.floor)];
  if (z.id === 'dropoff') return [0, DEEP_ZONE_METERS];
  return [0, yToMeters(z.floor)];
}

/** Structural checks on a single species; returns human-readable problems. */
export function validateSpecies(s: SpeciesDef): string[] {
  const e: string[] = [];
  const p = (msg: string) => e.push(`${s.id}: ${msg}`);
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(s.id)) p('bad id');
  if (!s.name || s.name.length > 32) p('bad name');
  if (!inRange(s.length, 2, 96) || !inRange(s.height, 2, 40)) p('bad size');
  const st = s.stats;
  if (!inRange(st.maxSpeed, 0, 160)) p('maxSpeed out of range');
  if (!inRange(st.agility, 0, 1)) p('agility out of range');
  if (!inRange(st.perception, 0, 240)) p('perception out of range');
  if (!inRange(st.metabolism, 0, 4)) p('metabolism out of range');
  for (const k of ['jaw', 'camo', 'spines', 'armor'] as const) if (!inRange(st[k], 0, 0.95)) p(`${k} out of range`);
  const [smin, smax] = s.salinity;
  if (!inRange(smin, 0, 1) || !inRange(smax, 0, 1) || smin > smax) p('bad salinity');
  const [dmin, dmax] = s.depth;
  if (!inRange(dmin, 0, 1000) || !inRange(dmax, 0, 1000) || dmin >= dmax) p('bad depth');
  for (const t of s.diet) if (!FOOD_TAGS.includes(t)) p(`unknown diet tag ${t}`);
  if (s.foodTag !== null && !FOOD_TAGS.includes(s.foodTag)) p('unknown foodTag');
  const actor = s.kind === 'fish' || s.kind === 'mammal';
  if (actor) {
    if (!s.look) p('fish/mammal needs look');
    if (s.diet.length === 0) p('empty diet');
  } else {
    if (!s.sprite) p('non-fish needs sprite');
    if (s.diet.length !== 0) p('food items must not eat');
    if (s.playable) p('food items cannot be playable');
  }
  if (s.look) {
    for (const c of Object.values(s.look.colors)) if (!isPaletteKey(c)) p(`colour ${String(c)} not in palette`);
    if (s.look.glow !== undefined && !isPaletteKey(s.look.glow)) p('glow not in palette');
  }
  const [gmin, gmax] = s.behavior.groupSize;
  if (!Number.isInteger(gmin) || !Number.isInteger(gmax) || gmin < 1 || gmin > gmax || gmax > 12) p('bad groupSize');
  if (!inRange(s.behavior.schooling, 0, 1)) p('bad schooling');
  if (s.behavior.cleaner && !s.diet.includes('parasite')) p('cleaner must eat parasites');
  for (const h of s.habitats) {
    if (!ZONE_IDS.includes(h.zone)) p(`unknown zone ${h.zone}`);
    if (!Number.isInteger(h.count) || h.count < 0 || h.count > 40) p(`bad count in ${h.zone}`);
  }
  for (const [k, v] of Object.entries(s.codex)) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 200) p(`bad codex.${k}`);
  }
  return e;
}

/** Cross-species checks: unique ids, habitat suitability, reachable diets. */
export function validateRegion(all: readonly SpeciesDef[], zones: readonly ZoneDef[]): string[] {
  const e: string[] = [];
  const ids = new Set<string>();
  for (const s of all) {
    if (ids.has(s.id)) e.push(`duplicate id ${s.id}`);
    ids.add(s.id);
    e.push(...validateSpecies(s));
  }
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  for (const s of all) {
    for (const h of s.habitats) {
      const z = zoneById.get(h.zone);
      if (!z) continue;
      if (z.salinity < s.salinity[0] || z.salinity > s.salinity[1]) e.push(`${s.id}: salinity cannot live in ${h.zone}`);
      const [c0, c1] = zoneColumn(z);
      if (s.depth[1] < c0 || s.depth[0] > c1) e.push(`${s.id}: depth range misses ${h.zone}`);
    }
    for (const tag of s.diet) {
      if (tag === 'parasite') continue;
      const reachable = s.habitats.some((h) =>
        all.some(
          (prey) =>
            prey.id !== s.id &&
            prey.foodTag === tag &&
            prey.habitats.some((ph) => ph.zone === h.zone && ph.count > 0) &&
            (GRAZE_TAGS.includes(tag) || prey.length <= s.length * s.stats.jaw),
        ),
      );
      if (!reachable) e.push(`${s.id}: diet '${tag}' has no reachable food in its habitats`);
    }
  }
  return e;
}
