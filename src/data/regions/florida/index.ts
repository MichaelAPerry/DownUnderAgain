import type { SpeciesDef } from '../../schema';
import { FLORIDA_FOOD } from './food';
import { FLORIDA_SPECIES } from './species';
import { FLORIDA_ZONES, WORLD_HEIGHT, WORLD_WIDTH } from './zones';

export const FLORIDA = {
  id: 'florida',
  name: 'Florida: River to Reef',
  zones: FLORIDA_ZONES,
  species: FLORIDA_SPECIES,
  food: FLORIDA_FOOD,
  all: [...FLORIDA_SPECIES, ...FLORIDA_FOOD] as readonly SpeciesDef[],
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
} as const;

export type Region = typeof FLORIDA;
