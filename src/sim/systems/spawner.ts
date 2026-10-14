/**
 * Keeps each species' population near its per-zone target by spawning
 * groups out of the player's sight. Also models invasive lionfish pressure:
 * left unchecked, lionfish targets grow and small native reef fish decline.
 */
import type { SpeciesDef, ZoneId } from '../../data/schema';
import { DEEP_ZONE_Y, metersToY, yToMeters } from '../../world/depth';
import { SALINITY_BLEND, SURFACE_Y } from '../../world/terrain';
import type { World } from '../world';

const PASS_INTERVAL = 0.5;
/** Spawns stay this far (px) from the player so nothing pops in on screen. */
const HIDE_DX = 230;
const HIDE_DY = 150;
/** Lionfish targets grow by this factor over time, up to INVASIVE_MAX. */
const INVASIVE_GROWTH_SECONDS = 150;
const INVASIVE_MAX = 3;

const isActor = (d: SpeciesDef) => d.kind === 'fish' || d.kind === 'mammal';
const isFloorDweller = (d: SpeciesDef) => d.behavior.movement === 'static' || d.behavior.movement === 'crawl';

export class Spawner {
  private readonly cooldown = new Map<string, number>();
  private passTimer = 0;
  private readonly counts = new Map<string, number>();

  constructor(private readonly world: World) {}

  /** Population target for a species in a zone right now. */
  target(def: SpeciesDef, zone: ZoneId, base: number): number {
    if (!def.native) {
      const removedRelief = Math.min(1, this.world.invasivesRemoved * 0.1);
      const growth = Math.min(INVASIVE_MAX, 1 + this.world.time / INVASIVE_GROWTH_SECONDS - removedRelief);
      return Math.round(base * Math.max(1, growth));
    }
    if (zone === 'reef' && isActor(def) && def.length <= 14) {
      const lions = this.counts.get(this.key('lionfish', 'reef')) ?? 0;
      return Math.round(base * Math.max(0.5, 1 - 0.03 * lions));
    }
    return base;
  }

  fillInitial(): void {
    this.recount();
    for (const def of this.world.region.all) {
      for (const h of def.habitats) {
        let guard = 0;
        while ((this.counts.get(this.key(def.id, h.zone)) ?? 0) < h.count && guard++ < 40) {
          const n = this.spawnGroup(def, h.zone, false);
          if (n === 0) break;
          this.bump(def.id, h.zone, n);
        }
      }
    }
  }

  update(dt: number): void {
    for (const [k, v] of this.cooldown) if (v > 0) this.cooldown.set(k, v - dt);
    this.passTimer -= dt;
    if (this.passTimer > 0) return;
    this.passTimer = PASS_INTERVAL;
    this.recount();
    const rng = this.world.rng;
    for (const def of this.world.region.all) {
      for (const h of def.habitats) {
        if (h.count <= 0) continue;
        const k = this.key(def.id, h.zone);
        if ((this.cooldown.get(k) ?? 0) > 0) continue;
        const have = this.counts.get(k) ?? 0;
        if (have >= this.target(def, h.zone, h.count)) continue;
        // Plants and small invertebrates regrow quickly so grazers can keep up.
        const groups = isActor(def) ? 1 : 3;
        for (let g = 0; g < groups && (this.counts.get(k) ?? 0) < this.target(def, h.zone, h.count); g++) {
          this.bump(def.id, h.zone, this.spawnGroup(def, h.zone, true));
        }
        this.cooldown.set(k, isActor(def) ? rng.range(2, 5) : rng.range(0.6, 1.8));
      }
    }
  }

  /** A valid spawn y for `def` at column x in `zone`, or null. */
  pickY(def: SpeciesDef, zone: ZoneId, x: number): number | null {
    const t = this.world.terrain;
    const floor = t.floorAt(x);
    const halfH = def.height / 2;
    if (isFloorDweller(def)) {
      const y = floor - halfH - 1;
      const m = yToMeters(y);
      if (m < def.depth[0] || m > def.depth[1]) return null;
      if (zone === 'deep' ? y < DEEP_ZONE_Y : zone === 'dropoff' && y >= DEEP_ZONE_Y) return null;
      return y;
    }
    let lo = Math.max(metersToY(def.depth[0]), SURFACE_Y + halfH + 1);
    let hi = Math.min(metersToY(def.depth[1]), floor - halfH - 2);
    if (zone === 'deep') lo = Math.max(lo, DEEP_ZONE_Y + 4);
    if (zone === 'dropoff') hi = Math.min(hi, DEEP_ZONE_Y - 4);
    if (hi < lo) return null;
    return lo + (hi - lo) * this.world.rng.next();
  }

  private spawnGroup(def: SpeciesDef, zone: ZoneId, hidden: boolean): number {
    const w = this.world;
    const rng = w.rng;
    const z = w.terrain.zoneDef(zone);
    const inset = SALINITY_BLEND / 2 + 10;
    const x0 = z.x[0] === 0 ? 20 : z.x[0] + inset;
    const x1 = z.x[1] >= w.terrain.width ? z.x[1] - 20 : z.x[1] - inset;
    const p = w.player;
    for (let attempt = 0; attempt < 8; attempt++) {
      const cx = rng.range(x0, x1);
      const cy = this.pickY(def, zone, cx);
      if (cy === null) continue;
      if (hidden && p && p.alive && Math.abs(cx - p.x) < HIDE_DX && Math.abs(cy - p.y) < HIDE_DY) continue;
      const [gmin, gmax] = def.behavior.groupSize;
      const size = rng.int(gmin, gmax);
      let made = 0;
      for (let i = 0; i < size; i++) {
        const x = i === 0 ? cx : cx + rng.range(-16, 16);
        const y = i === 0 ? cy : (this.pickY(def, zone, x) ?? cy);
        const yy = isFloorDweller(def) ? y : Math.min(y, cy + 12);
        if (w.spawn(def, x, yy, zone)) made++;
      }
      return made;
    }
    return 0;
  }

  private key(id: string, zone: ZoneId): string {
    return `${id}|${zone}`;
  }

  private bump(id: string, zone: ZoneId, n: number): void {
    const k = this.key(id, zone);
    this.counts.set(k, (this.counts.get(k) ?? 0) + n);
  }

  private recount(): void {
    this.counts.clear();
    for (const e of this.world.entities) {
      if (!e.alive || e.isPlayer) continue;
      this.bump(e.def.id, e.homeZone, 1);
    }
  }
}
