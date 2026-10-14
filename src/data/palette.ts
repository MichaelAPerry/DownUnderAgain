/**
 * The game's fixed retro palette. Every sprite, tile and UI colour must come
 * from here so the whole game reads as one 1994-era image.
 */
export const PALETTE = {
  // neutrals
  ink: '#141420',
  charcoal: '#333c57',
  slate: '#566c86',
  silver: '#94b0c2',
  white: '#f4f4f4',
  grey: '#7d7d85',
  darkgrey: '#45454d',
  // blues
  navy: '#1a1c40',
  blue: '#3b5dc9',
  sky: '#41a6f6',
  cyan: '#73eff7',
  teal: '#257179',
  // greens
  seafoam: '#38b764',
  lime: '#a7f070',
  olive: '#7a7a2e',
  moss: '#4f6a2a',
  forest: '#25562e',
  // warms
  yellow: '#ffcd75',
  gold: '#f4b41b',
  orange: '#ef7d57',
  red: '#b13e53',
  crimson: '#7a1c2c',
  pink: '#f59fbf',
  magenta: '#c0388f',
  purple: '#5d275d',
  violet: '#7a5cc4',
  // earths
  brown: '#6e4a2f',
  tan: '#c2a173',
  sand: '#e4cf9b',
  cream: '#f7e8c3',
  mud: '#4a3a2a',
  bark: '#3d2b1f',
  rust: '#a05b2c',
} as const;

export type PaletteKey = keyof typeof PALETTE;

export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];

export function isPaletteKey(v: unknown): v is PaletteKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PALETTE, v);
}

/** Parse '#rrggbb' to [r,g,b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two hex colours, t in [0,1]. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
