import type { ZoneDef } from '../../schema';

/**
 * Florida river-to-sea transect, west (inland) to east (offshore).
 * x-ranges tile the world without gaps; 'deep' sits beneath the drop-off.
 * Floors are in world px below the surface (see world/depth.ts for metres).
 */
export const FLORIDA_ZONES: readonly ZoneDef[] = [
  {
    id: 'spring',
    name: 'Spring Run',
    x: [0, 1200],
    salinity: 0,
    floor: 150,
    water: 'cyan',
    ground: 'sand',
    groundDark: 'tan',
    tagline: 'Crystal-clear 22 C water bubbling up from the aquifer.',
  },
  {
    id: 'estuary',
    name: 'Mangrove Estuary',
    x: [1200, 2400],
    salinity: 0.5,
    floor: 152,
    water: 'teal',
    ground: 'mud',
    groundDark: 'bark',
    tagline: 'Brackish water among the roots: the nursery of the coast.',
  },
  {
    id: 'seagrass',
    name: 'Seagrass Flats',
    x: [2400, 3600],
    salinity: 0.9,
    floor: 160,
    water: 'seafoam',
    ground: 'sand',
    groundDark: 'tan',
    tagline: 'Turtle grass meadows sway over the white sand.',
  },
  {
    id: 'reef',
    name: 'Florida Keys Reef',
    x: [3600, 4800],
    salinity: 1,
    floor: 196,
    water: 'sky',
    ground: 'cream',
    groundDark: 'tan',
    tagline: 'The only living barrier reef in the continental US.',
  },
  {
    id: 'dropoff',
    name: 'Gulf Stream Drop-off',
    x: [4800, 6400],
    salinity: 1,
    floor: 1360,
    water: 'blue',
    ground: 'slate',
    groundDark: 'charcoal',
    tagline: 'The reef wall falls away into the blue.',
  },
  {
    id: 'deep',
    name: 'Twilight Zone',
    x: [4800, 6400],
    salinity: 1,
    floor: 1360,
    water: 'navy',
    ground: 'charcoal',
    groundDark: 'ink',
    tagline: 'Below 150 m sunlight fades. Here, fish make their own light.',
  },
];

export const WORLD_WIDTH = 6400;
export const WORLD_HEIGHT = 1376;
