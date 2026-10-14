/**
 * Static world geometry, generated once from a seed: the seafloor profile,
 * decorative props, cover (where small fish can hide) and mangrove-root
 * obstacles. Pure data, no rendering.
 */
import type { ZoneDef, ZoneId } from '../data/schema';
import { Rng } from '../engine/rng';
import { clamp, lerp, smooth } from '../engine/math';
import { DEEP_ZONE_Y } from './depth';

export const COL_W = 4;
/** Fish can't rise above this (the surface film). */
export const SURFACE_Y = 3;

export type DecorType =
  | 'rock'
  | 'vent'
  | 'grass'
  | 'mangrove'
  | 'brainCoral'
  | 'elkhorn'
  | 'seaFan'
  | 'log';

export interface Decor {
  type: DecorType;
  x: number;
  /** Base (bottom) y for floor props; top y for mangroves (canopy). */
  y: number;
  w: number;
  h: number;
  variant: number;
}

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface CoverRect extends Rect {
  /** Only creatures at most this long can hide here. */
  maxLength: number;
}

/** Width of the salinity transition band straddling each zone boundary. */
export const SALINITY_BLEND = 240;
const DROP_START = 4800;
const DROP_END = 5360;

export class Terrain {
  readonly width: number;
  readonly height: number;
  private readonly floor: Float32Array;
  readonly decor: Decor[] = [];
  readonly cover: CoverRect[] = [];
  /** Mangrove prop roots: impassable to big fish. */
  readonly roots: Rect[] = [];
  private readonly zones: readonly ZoneDef[];
  private readonly surfaceZones: ZoneDef[];

  constructor(zones: readonly ZoneDef[], width: number, height: number, seed: number) {
    this.zones = zones;
    this.width = width;
    this.height = height;
    this.surfaceZones = zones.filter((z) => z.id !== 'deep').slice().sort((a, b) => a.x[0] - b.x[0]);
    this.floor = new Float32Array(Math.ceil(width / COL_W) + 1);
    const rng = new Rng(seed);
    this.buildFloor(rng);
    this.buildDecor(rng);
  }

  // ---- queries -----------------------------------------------------------

  floorAt(x: number): number {
    const fx = clamp(x, 0, this.width) / COL_W;
    const i = Math.floor(fx);
    const a = this.floor[i] ?? this.height;
    const b = this.floor[i + 1] ?? a;
    return lerp(a, b, fx - i);
  }

  zoneAt(x: number, y: number): ZoneId {
    if (x >= DROP_START) return y >= DEEP_ZONE_Y ? 'deep' : 'dropoff';
    for (const z of this.surfaceZones) if (x < z.x[1]) return z.id;
    return 'dropoff';
  }

  zoneDef(id: ZoneId): ZoneDef {
    const z = this.zones.find((d) => d.id === id);
    if (!z) throw new Error(`Unknown zone ${id}`);
    return z;
  }

  /**
   * Salinity is constant inside a zone and blends linearly across a
   * SALINITY_BLEND-wide band centred on each zone boundary.
   */
  salinityAt(x: number): number {
    const zs = this.surfaceZones;
    const half = SALINITY_BLEND / 2;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i] as ZoneDef;
      const next = zs[i + 1];
      if (next && x >= z.x[1] - half && x <= z.x[1] + half) {
        return lerp(z.salinity, next.salinity, (x - (z.x[1] - half)) / SALINITY_BLEND);
      }
      if (x < z.x[1] || !next) return z.salinity;
    }
    return 1;
  }

  /** Largest creature length that can hide at (x,y), or 0 if no cover. */
  coverAt(x: number, y: number): number {
    let best = 0;
    for (const c of this.cover) {
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && c.maxLength > best) best = c.maxLength;
    }
    return best;
  }

  /** Root rect containing the point, if any. */
  rootAt(x: number, y: number): Rect | null {
    for (const r of this.roots) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r;
    return null;
  }

  // ---- generation --------------------------------------------------------

  private buildFloor(rng: Rng): void {
    const zs = this.surfaceZones.filter((z) => z.id !== 'dropoff');
    const reef = this.zones.find((z) => z.id === 'reef');
    const drop = this.zones.find((z) => z.id === 'dropoff');
    const reefFloor = reef?.floor ?? 160;
    const abyss = drop?.floor ?? this.height - 16;
    // Low-frequency value noise for gentle undulation.
    const knots: number[] = [];
    const KNOT = 96;
    for (let i = 0; i <= Math.ceil(this.width / KNOT) + 1; i++) knots.push(rng.range(-1, 1));
    const noise = (x: number) => {
      const k = x / KNOT;
      const i = Math.floor(k);
      return lerp(knots[i] ?? 0, knots[i + 1] ?? 0, smooth(k - i));
    };
    const c = (z: ZoneDef) => (z.x[0] + z.x[1]) / 2;
    for (let i = 0; i < this.floor.length; i++) {
      const x = i * COL_W;
      let base: number;
      if (x >= DROP_START) {
        const t = smooth((x - DROP_START) / (DROP_END - DROP_START));
        // Stepped wall: quantise the slope into ledges.
        const stepped = Math.round(t * 9) / 9;
        base = lerp(reefFloor + 10, abyss, stepped * 0.7 + t * 0.3);
      } else {
        base = zs[0]?.floor ?? 100;
        for (let j = 0; j < zs.length; j++) {
          const a = zs[j] as ZoneDef;
          const b = zs[j + 1];
          if (!b) {
            if (x >= c(a)) base = lerp(a.floor, reefFloor + 10, smooth((x - c(a)) / (DROP_START - c(a))));
            break;
          }
          if (x < c(a) && j === 0) {
            base = a.floor;
            break;
          }
          if (x >= c(a) && x < c(b)) {
            base = lerp(a.floor, b.floor, smooth((x - c(a)) / (c(b) - c(a))));
            break;
          }
        }
      }
      const amp = x >= DROP_END ? 12 : x >= DROP_START ? 0 : 6;
      this.floor[i] = clamp(Math.round(base + noise(x) * amp), 40, this.height - 8);
    }
  }

  private addFloorProp(type: DecorType, x: number, w: number, h: number, variant: number): Decor {
    const d: Decor = { type, x, y: Math.round(this.floorAt(x)) + 2, w, h, variant };
    this.decor.push(d);
    return d;
  }

  private buildDecor(rng: Rng): void {
    for (const z of this.surfaceZones) {
      const [x0, x1] = z.x;
      switch (z.id) {
        case 'spring': {
          for (let x = x0 + 40; x < x1 - 20; x += rng.int(50, 110)) {
            this.addFloorProp('rock', x, rng.int(10, 22), rng.int(6, 12), rng.int(0, 2));
          }
          for (let k = 0; k < 2; k++) this.addFloorProp('vent', rng.int(x0 + 200, x1 - 200), 12, 4, 0);
          this.addFloorProp('log', rng.int(x0 + 300, x1 - 300), 40, 8, 0);
          this.addGrassBeds(rng, x0, x1, 4, 14, 16);
          break;
        }
        case 'estuary': {
          for (let x = x0 + 120; x < x1 - 80; x += rng.int(170, 240)) {
            const w = rng.int(40, 60);
            const floorY = Math.round(this.floorAt(x + w / 2));
            this.decor.push({ type: 'mangrove', x, y: -22, w, h: floorY + 22, variant: rng.int(0, 2) });
            const rootTop = SURFACE_Y;
            const rootBottom = Math.min(floorY, 70);
            this.roots.push({ x0: x, x1: x + w, y0: rootTop, y1: rootBottom });
            this.cover.push({ x0: x, x1: x + w, y0: rootTop, y1: rootBottom, maxLength: 20 });
          }
          for (let x = x0 + 60; x < x1; x += rng.int(80, 160)) {
            this.addFloorProp('rock', x, rng.int(8, 14), rng.int(4, 7), 2);
          }
          break;
        }
        case 'seagrass': {
          this.addGrassBeds(rng, x0, x1, 7, 24, 18);
          for (let x = x0 + 90; x < x1; x += rng.int(160, 260)) {
            this.addFloorProp('rock', x, rng.int(8, 14), rng.int(4, 8), 1);
          }
          break;
        }
        case 'reef': {
          for (let x = x0 + 20; x < x1 - 10; x += rng.int(28, 60)) {
            const r = rng.next();
            if (r < 0.4) {
              const w = rng.int(14, 26);
              this.addFloorProp('brainCoral', x, w, Math.round(w * 0.6), rng.int(0, 2));
            } else if (r < 0.75) {
              this.addFloorProp('elkhorn', x, rng.int(16, 26), rng.int(14, 22), rng.int(0, 2));
            } else {
              this.addFloorProp('seaFan', x, rng.int(8, 12), rng.int(14, 20), rng.int(0, 2));
            }
          }
          // Crevices in the reef framework.
          for (let x = x0; x < x1; x += 120) {
            const fy = this.floorAt(x + 60);
            this.cover.push({ x0: x + 20, x1: x + 100, y0: fy - 22, y1: fy, maxLength: 14 });
          }
          break;
        }
        case 'dropoff': {
          for (let x = x0 + 10; x < DROP_START + 520; x += rng.int(30, 70)) {
            this.addFloorProp('seaFan', x, rng.int(8, 12), rng.int(12, 18), rng.int(0, 2));
          }
          for (let x = DROP_END + 40; x < x1; x += rng.int(140, 260)) {
            this.addFloorProp('rock', x, rng.int(16, 30), rng.int(8, 14), 0);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private addGrassBeds(rng: Rng, x0: number, x1: number, beds: number, minW: number, height: number): void {
    const span = (x1 - x0) / beds;
    for (let b = 0; b < beds; b++) {
      const bx = Math.round(x0 + span * b + rng.range(20, span - 80));
      const bw = rng.int(minW * 2, minW * 5);
      for (let x = bx; x < bx + bw; x += rng.int(3, 5)) {
        this.addFloorProp('grass', x, 1, rng.int(Math.round(height * 0.5), height), rng.int(0, 2));
      }
      const fy = this.floorAt(bx + bw / 2);
      this.cover.push({ x0: bx, x1: bx + bw, y0: fy - height, y1: fy + 2, maxLength: 16 });
    }
  }
}
