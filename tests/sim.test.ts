import { describe, expect, it } from 'vitest';
import { FLORIDA } from '../src/data/regions/florida';
import type { SpeciesDef } from '../src/data/schema';
import { canEat, isDeterred, relation } from '../src/sim/foodWeb';
import { World } from '../src/sim/world';
import { Rng } from '../src/engine/rng';
import { metersToY, yToMeters } from '../src/world/depth';
import { effectiveStats } from '../src/sim/stats';
import { UPGRADES } from '../src/data/upgrades';

const sp = (id: string): SpeciesDef => {
  const d = FLORIDA.all.find((s) => s.id === id);
  if (!d) throw new Error(id);
  return d;
};
const f = (id: string) => ({ def: sp(id), stats: sp(id).stats });

describe('food web', () => {
  it('derives eat / flee / ignore from diet and size', () => {
    expect(relation(f('largemouth_bass'), f('bluegill'))).toBe('eat');
    expect(relation(f('bluegill'), f('largemouth_bass'))).toBe('flee');
    expect(relation(f('mosquitofish'), f('mosquito_larva'))).toBe('eat');
    expect(relation(f('manatee'), f('bull_shark'))).toBe('ignore');
    expect(relation(f('bull_shark'), f('manatee'))).toBe('ignore');
  });

  it('plants and invertebrates never eat anything', () => {
    for (const food of FLORIDA.food) for (const o of FLORIDA.all) expect(canEat(f(food.id), f(o.id))).toBe(false);
  });

  it('honours the cleaner truce, except for invasive lionfish', () => {
    expect(canEat(f('gray_snapper'), f('neon_goby'))).toBe(false);
    expect(canEat(f('lionfish'), f('neon_goby'))).toBe(true);
  });

  it('deters mid-size predators from lionfish but not giants', () => {
    expect(isDeterred(f('great_barracuda'), f('lionfish'))).toBe(true);
    expect(isDeterred(f('goliath_grouper'), f('lionfish'))).toBe(false);
  });

  it('Big Jaw upgrades widen what the player can eat', () => {
    const bass = sp('largemouth_bass');
    const big = effectiveStats(bass, UPGRADES, { jaw: 4 });
    expect(big.stats.jaw).toBeGreaterThan(bass.stats.jaw);
    expect(canEat({ def: bass, stats: bass.stats }, f('striped_mullet'))).toBe(false);
    expect(canEat({ def: bass, stats: big.stats }, f('striped_mullet'))).toBe(true);
  });
});

describe('depth mapping', () => {
  it('is monotonic and invertible', () => {
    let prev = -1;
    for (let y = 0; y <= FLORIDA.height; y += 7) {
      const m = yToMeters(y);
      expect(m).toBeGreaterThan(prev);
      prev = m;
      expect(metersToY(m)).toBeCloseTo(y, 6);
    }
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

function fingerprint(w: World): string {
  let h = 0;
  for (const e of w.entities) h = (h * 31 + Math.round(e.x * 10) + Math.round(e.y * 10) * 7 + e.id) | 0;
  return `${w.entities.length}:${h}`;
}

describe('world simulation', () => {
  it('populates every zone and keeps creatures inside the water', () => {
    const w = new World(FLORIDA, 7);
    const zones = new Set(w.entities.map((e) => e.homeZone));
    for (const z of FLORIDA.zones) expect(zones.has(z.id)).toBe(true);
    for (let i = 0; i < 600; i++) w.step();
    for (const e of w.entities) {
      expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
      expect(e.y).toBeLessThanOrEqual(w.terrain.floorAt(e.x) + 0.01);
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThanOrEqual(w.terrain.width);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = new World(FLORIDA, 1234);
    const b = new World(FLORIDA, 1234);
    a.addPlayer(sp('bluegill'), sp('bluegill').stats, 100, 'spring');
    b.addPlayer(sp('bluegill'), sp('bluegill').stats, 100, 'spring');
    for (let i = 0; i < 900; i++) {
      a.step();
      b.step();
    }
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('runs a living ecosystem: predation happens and populations persist', () => {
    const w = new World(FLORIDA, 99);
    let eaten = 0;
    w.events.on('eat', () => eaten++);
    const start = w.entities.length;
    for (let i = 0; i < 60 * 60; i++) w.step();
    expect(eaten).toBeGreaterThan(20);
    expect(w.entities.length).toBeGreaterThan(start * 0.6);
    expect(w.entities.length).toBeLessThan(900);
  });

  it('starts the player safely', () => {
    const w = new World(FLORIDA, 5);
    const p = w.addPlayer(sp('mosquitofish'), sp('mosquitofish').stats, 100, 'spring');
    for (let i = 0; i < 60; i++) w.step();
    expect(p.alive).toBe(true);
  });

  it('a player who never eats eventually starves', () => {
    const w = new World(FLORIDA, 11);
    const def = sp('swordfish');
    const p = w.addPlayer(def, def.stats, 100, 'deep');
    let cause = '';
    w.events.on('death', (e) => {
      if (e.entity === p) cause = e.cause;
    });
    // Park the player far from everything at the end of the world.
    for (let i = 0; i < 60 * 600 && p.alive; i++) {
      p.x = w.terrain.width - 40;
      p.y = 700;
      p.vx = 0;
      p.vy = 0;
      w.step();
    }
    expect(p.alive).toBe(false);
    expect(['starved', 'parasites', 'eaten']).toContain(cause);
  });

  it('a freshwater fish suffers in the sea', () => {
    const w = new World(FLORIDA, 3);
    const def = sp('bluegill');
    const p = w.addPlayer(def, def.stats, 100, 'spring');
    p.x = 4200;
    p.y = 60;
    const hp0 = p.hp;
    for (let i = 0; i < 120; i++) {
      p.x = 4200;
      w.step();
    }
    expect(p.hp).toBeLessThan(hp0);
  });
});
