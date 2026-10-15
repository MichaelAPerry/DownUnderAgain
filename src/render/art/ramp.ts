/**
 * Shading ramps for procedural sprites. Every ramp is derived from the fixed
 * game palette: each palette colour has a hand-picked darker and lighter
 * palette neighbour (hue-shifted the way 16-bit artists did it: shadows go
 * cooler/redder, highlights warmer/paler), and the six ramp tones are short
 * blends along that chain. Limited, coherent, and always on-palette.
 */
import { PALETTE, mixHex } from '../../data/palette';
import type { PaletteKey } from '../../data/palette';

/** Ramp tone indices. */
export const OUT = 0; // selective-outline tone (darkest)
export const DEEP = 1; // deep shadow / top outline
export const SHD = 2; // shadow
export const BASE = 3; // the palette colour itself
export const LIT = 4; // light
export const HI = 5; // highlight

export type Ramp = readonly [string, string, string, string, string, string];

/** Next darker palette colour (hue-shifted). */
const DARK: Record<PaletteKey, PaletteKey> = {
  ink: 'ink', charcoal: 'navy', slate: 'charcoal', silver: 'slate', white: 'silver', grey: 'darkgrey',
  darkgrey: 'charcoal', navy: 'ink', blue: 'navy', sky: 'blue', cyan: 'sky', teal: 'charcoal',
  seafoam: 'teal', lime: 'seafoam', olive: 'moss', moss: 'forest', forest: 'navy',
  yellow: 'gold', gold: 'rust', orange: 'red', red: 'crimson', crimson: 'purple', pink: 'magenta',
  magenta: 'purple', purple: 'navy', violet: 'purple', brown: 'bark', tan: 'brown', sand: 'tan',
  cream: 'sand', mud: 'bark', bark: 'ink', rust: 'brown',
};

/** Next lighter palette colour (hue-shifted). */
const LIGHT: Record<PaletteKey, PaletteKey> = {
  ink: 'charcoal', charcoal: 'slate', slate: 'silver', silver: 'white', white: 'white', grey: 'silver',
  darkgrey: 'grey', navy: 'blue', blue: 'sky', sky: 'cyan', cyan: 'white', teal: 'cyan',
  seafoam: 'lime', lime: 'yellow', olive: 'yellow', moss: 'olive', forest: 'moss',
  yellow: 'cream', gold: 'yellow', orange: 'yellow', red: 'orange', crimson: 'red', pink: 'cream',
  magenta: 'pink', purple: 'violet', violet: 'pink', brown: 'rust', tan: 'sand', sand: 'cream',
  cream: 'white', mud: 'brown', bark: 'mud', rust: 'orange',
};

const cache = new Map<string, Ramp>();

/** Six-tone ramp [outline, deep, shadow, base, light, highlight] for a palette colour. */
export function rampOf(key: PaletteKey): Ramp {
  const hit = cache.get(key);
  if (hit) return hit;
  const b = PALETTE[key];
  const d = PALETTE[DARK[key]];
  const dd = PALETTE[DARK[DARK[key]]];
  const l = PALETTE[LIGHT[key]];
  const ll = PALETTE[LIGHT[LIGHT[key]]];
  const r: Ramp = [
    mixHex(mixHex(d, dd, 0.7), PALETTE.ink, 0.35),
    mixHex(d, dd, 0.3),
    mixHex(b, d, 0.5),
    b,
    mixHex(b, l, 0.5),
    mixHex(l, ll, 0.3),
  ];
  cache.set(key, r);
  return r;
}

/** Tone-by-tone blend of two ramps (e.g. a soft blotch colour between body and accent). */
export function blendRamp(a: Ramp, b: Ramp, t: number): Ramp {
  const key = `${a[BASE]}|${b[BASE]}|${t}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = a.map((c, i) => mixHex(c, b[i] as string, t)) as unknown as Ramp;
  cache.set(key, r);
  return r;
}

/** Perceived brightness 0..255, for picking contrasting detail colours. */
export function luma(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
}
