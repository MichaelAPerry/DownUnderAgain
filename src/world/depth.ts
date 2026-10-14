/**
 * World-y (px below the surface) <-> real depth (metres).
 *
 * The shallow band is stretched so reef life gets screen room; below
 * SHALLOW_PX each pixel covers more water, so the abyss reaches ~600 m
 * without an absurdly tall world.
 */
export const SHALLOW_PX = 200;
export const SHALLOW_M_PER_PX = 0.1;
export const DEEP_M_PER_PX = 0.5;
const SHALLOW_M = SHALLOW_PX * SHALLOW_M_PER_PX; // 20 m

export function yToMeters(y: number): number {
  if (y <= 0) return 0;
  if (y <= SHALLOW_PX) return y * SHALLOW_M_PER_PX;
  return SHALLOW_M + (y - SHALLOW_PX) * DEEP_M_PER_PX;
}

export function metersToY(m: number): number {
  if (m <= 0) return 0;
  if (m <= SHALLOW_M) return m / SHALLOW_M_PER_PX;
  return SHALLOW_PX + (m - SHALLOW_M) / DEEP_M_PER_PX;
}

/** Depth at which open water counts as the 'deep' zone. */
export const DEEP_ZONE_METERS = 150;
export const DEEP_ZONE_Y = metersToY(DEEP_ZONE_METERS);
