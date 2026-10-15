/**
 * Terrain baking: the seafloor body with per-zone materials, a lit lip,
 * dithered strata bands and embedded pebbles / rubble / twigs / rock blocks.
 * Painted per pixel into a chunk buffer, once per chunk.
 */
import type { Terrain } from '../../world/terrain';
import type { ZoneDef } from '../../data/schema';
import { Buf, bayer, ih, ramp, vnoise, w } from './pix';

/** Ground materials. */
export const Mat = { Spring: 0, Estuary: 1, Seagrass: 2, Reef: 3, Wall: 4, Abyss: 5 } as const;
export type Mat = (typeof Mat)[keyof typeof Mat];

/** Shared, precomputed view of the world for the bakers. */
export class Env {
  readonly width: number;
  readonly height: number;
  /** Integer floor surface y per world x. */
  private readonly floor: Int16Array;
  /** Floor smoothed over +-24 px, for distant silhouettes. */
  private readonly smoothFloor: Int16Array;
  /** Right edges of the surface zones, west to east (last = drop-off). */
  readonly bounds: number[];
  readonly zoneIds: string[];
  readonly dropX: number;

  constructor(readonly terrain: Terrain, zones: readonly ZoneDef[]) {
    this.width = terrain.width;
    this.height = terrain.height;
    this.floor = new Int16Array(this.width + 1);
    for (let x = 0; x <= this.width; x++) this.floor[x] = Math.round(terrain.floorAt(x));
    this.smoothFloor = new Int16Array(this.width + 1);
    const R = 24;
    for (let x = 0; x <= this.width; x += 8) {
      let s = 0;
      for (let k = -R; k <= R; k += 4) s += this.F(x + k);
      const v = Math.round(s / (Math.floor((2 * R) / 4) + 1));
      for (let j = 0; j < 8 && x + j <= this.width; j++) this.smoothFloor[x + j] = v;
    }
    const surface = zones.filter((z) => z.id !== 'deep').slice().sort((a, b) => a.x[0] - b.x[0]);
    this.bounds = surface.map((z) => z.x[1]);
    this.zoneIds = surface.map((z) => z.id);
    this.dropX = surface.find((z) => z.id === 'dropoff')?.x[0] ?? this.width;
  }

  F(x: number): number {
    const i = x < 0 ? 0 : x > this.width ? this.width : x | 0;
    return this.floor[i] ?? this.height;
  }

  smoothF(x: number): number {
    const i = x < 0 ? 0 : x > this.width ? this.width : x | 0;
    return this.smoothFloor[i] ?? this.height;
  }

  /** Surface-zone id at world x. */
  zone(x: number): string {
    for (let i = 0; i < this.bounds.length; i++) if (x < (this.bounds[i] ?? 0)) return this.zoneIds[i] ?? 'reef';
    return this.zoneIds[this.zoneIds.length - 1] ?? 'dropoff';
  }

  /** Ground material at (x, y), with a ragged hand-off between zones. */
  mat(x: number, y: number, floorY: number): Mat {
    if (x >= this.dropX - 4) return floorY > this.height - 60 ? Mat.Abyss : Mat.Wall;
    const j = (ih(x >> 2, y >> 2, 5) - 0.5) * 36 + vnoise(y / 14, 3) * 10;
    const z = this.zone(Math.min(this.dropX - 5, x + j));
    switch (z) {
      case 'spring':
        return Mat.Spring;
      case 'estuary':
        return Mat.Estuary;
      case 'seagrass':
        return Mat.Seagrass;
      case 'reef':
        return Mat.Reef;
      default:
        return floorY > this.height - 60 ? Mat.Abyss : Mat.Wall;
    }
  }
}

// ---- material ramps (light -> dark) -------------------------------------

const SPR = ramp('white', 'cream', 'sand', ['sand', 'tan', 0.45], 'tan', ['tan', 'grey', 0.4], ['tan', 'grey', 0.62], ['grey', 'brown', 0.45], ['darkgrey', 'brown', 0.45], ['darkgrey', 'bark', 0.5]);
const EST = ramp(['mud', 'tan', 0.42], ['mud', 'tan', 0.2], 'mud', ['mud', 'bark', 0.5], 'bark', ['bark', 'ink', 0.3], ['bark', 'ink', 0.52], ['bark', 'ink', 0.7]);
const SGR = ramp('white', 'cream', 'sand', ['sand', 'tan', 0.5], 'tan', ['tan', 'brown', 0.3], ['tan', 'brown', 0.55], ['tan', 'brown', 0.78], ['brown', 'bark', 0.4]);
const REF = ramp('white', 'cream', ['cream', 'sand', 0.5], 'sand', ['sand', 'tan', 0.5], 'tan', ['tan', 'slate', 0.4], ['tan', 'charcoal', 0.5], ['tan', 'charcoal', 0.68], ['charcoal', 'ink', 0.3]);
const ROCK = ramp('silver', ['silver', 'slate', 0.5], 'slate', ['slate', 'charcoal', 0.5], 'charcoal', ['charcoal', 'navy', 0.45], ['charcoal', 'ink', 0.45], ['charcoal', 'ink', 0.7], 'ink');
const ABY = ramp(['charcoal', 'slate', 0.4], ['charcoal', 'slate', 0.15], ['charcoal', 'ink', 0.25], ['charcoal', 'ink', 0.5], ['charcoal', 'ink', 0.72], 'ink');

const LITTER = [w('rust'), w('olive'), w('brown'), w('moss'), w('rust', 'orange', 0.4), w('olive', 'tan', 0.4)];
const ENCRUST = [w('orange'), w('violet'), w('red'), w('rust'), w('pink', 'violet', 0.4)];

/** Pebble colour sets [light, mid, dark]. */
const PEB_SPRING = [ramp('white', 'silver', 'grey'), ramp('silver', 'grey', 'darkgrey'), ramp('cream', 'sand', 'tan'), ramp('sand', 'tan', 'brown')];
const PEB_MUD = [ramp(['silver', 'mud', 0.35], ['grey', 'mud', 0.4], ['darkgrey', 'bark', 0.4]), ramp(['tan', 'mud', 0.3], 'brown', 'bark'), ramp(['tan', 'mud', 0.5], ['brown', 'mud', 0.4], 'bark')];
const PEB_SAND = [ramp('white', 'cream', 'tan'), ramp('pink', ['pink', 'tan', 0.5], 'rust'), ramp('cream', 'sand', 'tan'), ramp('silver', 'grey', 'darkgrey')];
const PEB_REEF = [ramp('white', 'cream', 'tan'), ramp('white', 'cream', 'sand'), ramp('cream', 'sand', 'tan'), ramp(['pink', 'cream', 0.4], ['pink', 'tan', 0.45], ['rust', 'tan', 0.4]), ramp('white', ['silver', 'cream', 0.5], 'grey'), ramp('cream', 'tan', 'brown')];
const PEB_ABY = [ramp('slate', 'charcoal', ['charcoal', 'ink', 0.5])];

/** Embedded stone in a jittered grid cell; returns 0 when none covers (x,y). */
function pebble(x: number, y: number, cw: number, chh: number, prob: number, sets: readonly number[][], seed: number): number {
  const cx = Math.floor(x / cw);
  const cy = Math.floor(y / chh);
  if (ih(cx, cy, seed) > prob) return 0;
  const pw = 2 + Math.floor(ih(cx, cy, seed + 1) * (cw - 4));
  const ph = 1 + Math.floor(ih(cx, cy, seed + 2) * Math.min(3, chh - 2));
  const px = cx * cw + 1 + Math.floor(ih(cx, cy, seed + 3) * (cw - pw - 1));
  const py = cy * chh + 1 + Math.floor(ih(cx, cy, seed + 4) * Math.max(1, chh - ph - 1));
  const u = x - px;
  const v = y - py;
  if (u < 0 || v < 0 || u >= pw || v >= ph) return 0;
  if (pw >= 3 && ph >= 2 && (u === 0 || u === pw - 1) && (v === 0 || v === ph - 1)) return 0;
  const set = sets[Math.floor(ih(cx, cy, seed + 5) * sets.length)] ?? sets[0] ?? [0, 0, 0];
  if (v === ph - 1 && ph > 1) return set[2] ?? 0;
  if (u === pw - 1 && pw > 2) return set[2] ?? 0;
  if (v === 0 || u === 0) return set[0] ?? 0;
  return set[1] ?? 0;
}

const pick = (r: readonly number[], i: number): number => r[i < 0 ? 0 : i >= r.length ? r.length - 1 : i] ?? 0;

/** Dithered strata band index for depth d below the lip (wob: per-column wobble). */
function bands(d: number, th: readonly number[], wob: Float32Array, x: number, y: number): number {
  for (let i = 0; i < th.length; i++) {
    const t = (th[i] ?? 0) + (wob[i] ?? 0);
    if (d >= t + 2) continue;
    if (d > t - 2) return (d - (t - 2)) / 4 > bayer(x, y) ? i + 1 : i;
    return i;
  }
  return th.length;
}

const TH_SPRING = [5, 13, 26, 44, 70, 104];
const TH_MUD = [6, 17, 32, 54, 84];
const TH_SAND = [7, 18, 33, 54, 82, 118];
const TH_REEF = [5, 15, 29, 48, 74, 108];
const TH_ABY = [4, 12, 26, 48];

/** Paint the ground (everything at or below the floor line) into buf. */
export function bakeGround(env: Env, buf: Buf): void {
  const { x0, y0, w: bw, h: bh, data } = buf;
  const M = 4;
  const FF = new Int32Array(bw + M * 2);
  for (let i = 0; i < FF.length; i++) FF[i] = env.F(x0 - M + i);
  const wob = new Float32Array(8);
  for (let lx = 0; lx < bw; lx++) {
    const x = x0 + lx;
    const f = FF[lx + M] ?? 0;
    if (y0 + bh <= f) continue;
    for (let i = 0; i < wob.length; i++) wob[i] = vnoise(x / 19 + i * 7.31, 11) * 3 + vnoise(x / 5.3 + i * 3.1, 12) * 0.8;
    const ys = Math.max(y0, f);
    let used = false;
    for (let y = ys; y < y0 + bh; y++) {
      const d = y - f;
      // Sideways exposure: nearest column (within M) whose floor is below this row.
      let es = 99;
      let side = 0;
      for (let k = 1; k <= M; k++) {
        if ((FF[lx + M - k] ?? 0) > y) {
          es = k;
          side = -1;
          break;
        }
        if ((FF[lx + M + k] ?? 0) > y) {
          es = k;
          side = 1;
          break;
        }
      }
      const e = d <= es ? d : es;
      if (e === d) side = 0;
      const m = env.mat(x, y, f);
      let c: number;
      switch (m) {
        case Mat.Spring:
          c = spring(x, y, d, e, side, wob);
          break;
        case Mat.Estuary:
          c = estuary(x, y, d, e, side, wob);
          break;
        case Mat.Seagrass:
          c = seagrass(x, y, d, e, side, wob);
          break;
        case Mat.Reef:
          c = reef(x, y, d, e, side, wob);
          break;
        case Mat.Wall:
          c = wall(x, y, e, side);
          break;
        default:
          c = abyss(x, y, d, e, wob);
      }
      data[(y - y0) * bw + lx] = c;
      used = true;
    }
    if (used) buf.used = true;
  }
}

function spring(x: number, y: number, d: number, e: number, side: number, wob: Float32Array): number {
  if (e === 0) return ih(x, y, 1) < 0.35 ? SPR[0]! : SPR[1]!;
  if (e === 1) return side !== 0 ? SPR[3]! : ih(x, y, 2) < 0.2 ? SPR[1]! : SPR[2]!;
  if (d > 2) {
    const p = pebble(x, y, 9, 7, d < 12 ? 0.42 : 0.22, PEB_SPRING, 21);
    if (p) return p;
  }
  let L = 2 + bands(d, TH_SPRING, wob, x, y);
  if (side !== 0 && e < 3) L += 1;
  // Layered limestone bedrock: bedding cracks and pits.
  if (L >= 5) {
    const bed = y + Math.round(vnoise(x / 26, 6) * 2);
    if (bed % 8 === 0 && ih(x >> 3, bed, 34) < 0.85) return pick(SPR, L + 2);
    if (bed % 8 === 1 && ih(x >> 3, bed - 1, 34) < 0.85) return pick(SPR, L - 1);
    if (bed % 8 > 1 && (x + (bed >> 3) * 11) % 23 === 0) return pick(SPR, L + 1);
    const cx = Math.floor(x / 6);
    const cy = Math.floor(y / 5);
    if (ih(cx, cy, 31) < 0.3) {
      const hx0 = cx * 6 + 1 + Math.floor(ih(cx, cy, 32) * 3);
      const hy0 = cy * 5 + 1 + Math.floor(ih(cx, cy, 33) * 2);
      if (y === hy0 && (x === hx0 || x === hx0 + 1)) return pick(SPR, L + 2);
      if (y === hy0 + 1 && x === hx0 + 1) return pick(SPR, L - 2);
    }
  }
  const s = ih(x, y, 3);
  if (s < 0.05) L -= 1;
  else if (s > 0.96) L += 1;
  return pick(SPR, L);
}

function estuary(x: number, y: number, d: number, e: number, side: number, wob: Float32Array): number {
  if (e <= 1 && side === 0) {
    const lc = Math.floor(x / 2);
    if (ih(lc, d, 9) < (e === 0 ? 0.28 : 0.12)) return LITTER[Math.floor(ih(lc, d, 10) * LITTER.length)] ?? EST[0]!;
    return e === 0 ? EST[0]! : EST[1]!;
  }
  if (e <= 1) return EST[2]!;
  if (d < 6) {
    const r = (x + d * 2 + Math.floor(vnoise(x / 30, 4) * 4) + 90) % 9;
    if (r < 2) return EST[1]!;
    if (r === 2) return EST[3]!;
  }
  const p = pebble(x, y, 11, 8, d < 14 ? 0.16 : 0.07, PEB_MUD, 41);
  if (p) return p;
  // Buried twigs and roots.
  const cx = Math.floor(x / 14);
  const cy = Math.floor(y / 9);
  if (d > 5 && ih(cx, cy, 43) < 0.1) {
    const tx = cx * 14 + 2;
    const ty = cy * 9 + 4;
    const s = ih(cx, cy, 44) < 0.5 ? -0.5 : 0.5;
    const u = x - tx;
    if (u >= 0 && u < 9 && Math.round(ty + s * u) === y) return u < 2 ? EST[0]! : ih(cx, cy, 45) < 0.5 ? w('brown') : EST[1]!;
  }
  let L = 2 + bands(d, TH_MUD, wob, x, y);
  if (side !== 0 && e < 3) L += 1;
  const s = ih(x, y, 3);
  if (s < 0.04) L -= 1;
  else if (s > 0.985) return w('silver', 'mud', 0.55);
  return pick(EST, L);
}

function seagrass(x: number, y: number, d: number, e: number, side: number, wob: Float32Array): number {
  if (e === 0) return ih(x, y, 1) < 0.3 ? SGR[0]! : SGR[1]!;
  if (side !== 0 && e < 2) return SGR[3]!;
  if (d < 7) {
    const off = Math.floor(vnoise(x / 40, 3) * 5) + 50;
    const r = (x + d * 3 + off) % 10;
    if (r < 3) return d < 3 ? SGR[1]! : SGR[2]!;
    if (r === 3) return SGR[3]!;
    return SGR[2]!;
  }
  const p = pebble(x, y, 8, 6, d < 14 ? 0.3 : 0.12, PEB_SAND, 51);
  if (p) return p;
  let L = 2 + bands(d, TH_SAND, wob, x, y);
  if (side !== 0 && e < 3) L += 1;
  const s = ih(x, y, 3);
  if (s < 0.05) L -= 1;
  else if (s > 0.97) L += 1;
  return pick(SGR, L);
}

function reef(x: number, y: number, d: number, e: number, side: number, wob: Float32Array): number {
  if (e === 0) return ih(x, y, 1) < 0.45 ? REF[0]! : REF[1]!;
  if (d > 1 || side !== 0) {
    const p = pebble(x, y, 7, 5, d < 12 ? 0.5 : d < 30 ? 0.18 : 0.06, PEB_REEF, 61);
    if (p) return p;
  }
  let L = 2 + bands(d, TH_REEF, wob, x, y);
  if (side !== 0 && e < 3) L += 1;
  // Fossil coral cross-sections in the reef rock.
  if (L >= 5) {
    const cx = Math.floor(x / 12);
    const cy = Math.floor(y / 10);
    if (ih(cx, cy, 63) < 0.25) {
      const ox = cx * 12 + 6;
      const oy = cy * 10 + 5;
      const r2 = (x - ox) * (x - ox) + (y - oy) * (y - oy);
      if (r2 >= 4 && r2 <= 7) return pick(REF, L - 2);
      if (r2 <= 1) return pick(REF, L + 1);
    }
  }
  const s = ih(x >> 1, y, 3);
  if (s < 0.08) L -= 1;
  else if (s > 0.95) L += 1;
  return pick(REF, L);
}

function wall(x: number, y: number, e: number, side: number): number {
  // Deeper rock is darker, in dithered steps.
  let shift = 0;
  const g = (y - 380) / 140;
  if (g > 0) shift = Math.min(3, Math.floor(g) + (g - Math.floor(g) > bayer(x, y) ? 1 : 0));
  if (e === 0) {
    if (side === 0) {
      if (ih(x >> 1, y, 3) < 0.12) return ENCRUST[Math.floor(ih(x >> 1, y, 4) * ENCRUST.length)] ?? ROCK[1]!;
      return pick(ROCK, 1 + shift);
    }
    return pick(ROCK, (side > 0 ? 2 : 4) + shift);
  }
  if (e === 1) return pick(ROCK, (side === 0 ? 2 : 3) + shift);
  // Irregular rock facets: a horizontally stretched Voronoi field, each facet
  // lit on its upper-left and shadowed on its lower-right, cracks between.
  const SX = 15;
  const SY = 10;
  const gx = Math.floor(x / SX);
  const gy = Math.floor(y / SY);
  let d1 = 1e9;
  let d2 = 1e9;
  let fx = 0;
  let fy = 0;
  let fid = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i;
      const cy = gy + j;
      const px = (cx + 0.1 + ih(cx, cy, 47) * 0.8) * SX;
      const py = (cy + 0.1 + ih(cx, cy, 48) * 0.8) * SY;
      const dx = (x - px) * 0.7;
      const dy = y - py;
      const dd = dx * dx + dy * dy;
      if (dd < d1) {
        d2 = d1;
        d1 = dd;
        fx = px;
        fy = py;
        fid = cx * 7 + cy * 131;
      } else if (dd < d2) d2 = dd;
    }
  }
  const edge = Math.sqrt(d2) - Math.sqrt(d1);
  let base = 4 + (ih(fid, 0, 49) < 0.3 ? 1 : 0) + (ih(fid, 0, 50) < 0.15 ? -1 : 0) + shift - (e === 2 ? 1 : 0);
  if (edge < 1.0) return pick(ROCK, base + 2);
  const s = (-(x - fx) * 0.45 - (y - fy) * 0.9) / SY;
  if (edge < 2.1) return pick(ROCK, s < 0 ? base + 1 : base - 1);
  if (s > 0.55) base -= 1;
  else if (s < -0.5) base += 1;
  const sp = ih(x, y, 7);
  if (sp < 0.05) return pick(ROCK, base + 1);
  if (sp > 0.975) return pick(ROCK, base - 1);
  return pick(ROCK, base);
}

function abyss(x: number, y: number, d: number, e: number, wob: Float32Array): number {
  if (e === 0) return ih(x, y, 1) < 0.2 ? w('slate', 'charcoal', 0.3) : ABY[0]!;
  if (e < 3) return ABY[1]!;
  const p = pebble(x, y, 10, 7, 0.12, PEB_ABY, 71);
  if (p) return p;
  let L = 1 + bands(d, TH_ABY, wob, x, y);
  const s = ih(x, y, 3);
  if (s < 0.03) return w('slate', 'charcoal', 0.5);
  if (s > 0.97) L += 1;
  return pick(ABY, L);
}
