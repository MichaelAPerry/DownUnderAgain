import { describe, expect, it } from 'vitest';
import { FLORIDA } from '../src/data/regions/florida';
import type { SpeciesDef } from '../src/data/schema';
import { World } from '../src/sim/world';

const sp = (id: string): SpeciesDef => {
  const d = FLORIDA.all.find((s) => s.id === id);
  if (!d) throw new Error(id);
  return d;
};

describe('multiplayer simulation', () => {
  it('steers each player by its own input', () => {
    const w = new World(FLORIDA, 21);
    const host = w.addPlayer(sp('bluegill'), sp('bluegill').stats, 100, 'spring');
    const guest = w.addRemotePlayer(sp('bluegill'), 'spring', 1);
    w.input.x = 1;
    guest.input.x = -1;
    const hx = host.x;
    const gx = guest.entity.x;
    for (let i = 0; i < 60; i++) w.step();
    expect(host.x).toBeGreaterThan(hx + 10);
    expect(guest.entity.x).toBeLessThan(gx - 10);
    expect(w.livePlayers()).toHaveLength(2);
  });

  it('spreads players apart and never culls another player when spawning', () => {
    const w = new World(FLORIDA, 22);
    const big = w.addPlayer(sp('bull_shark'), sp('bull_shark').stats, 100, 'estuary');
    const small = w.addRemotePlayer(sp('mosquitofish'), 'estuary', 1);
    expect(big.alive).toBe(true);
    expect(small.entity.alive).toBe(true);
    expect(Math.abs(big.x - small.entity.x)).toBeGreaterThanOrEqual(60);
  });

  it('applies the food web between players', () => {
    const w = new World(FLORIDA, 23);
    const shark = w.addPlayer(sp('bull_shark'), sp('bull_shark').stats, 100, 'estuary');
    const prey = w.addRemotePlayer(sp('striped_mullet'), 'estuary', 1);
    let eaten = false;
    w.events.on('eat', (e) => {
      if (e.eater === shark && e.prey === prey.entity) eaten = true;
    });
    // Put the mullet right in front of the shark's mouth.
    prey.entity.x = shark.x + shark.facing * shark.def.length * 0.4;
    prey.entity.y = shark.y;
    shark.eatCooldown = 0;
    w.step();
    expect(eaten).toBe(true);
    expect(prey.entity.alive).toBe(false);
  });

  it('burst drains only the player who bursts', () => {
    const w = new World(FLORIDA, 24);
    const a = w.addPlayer(sp('bluegill'), sp('bluegill').stats, 100, 'spring');
    const b = w.addRemotePlayer(sp('bluegill'), 'spring', 1);
    a.energy = b.entity.energy = 100;
    w.input.x = 1;
    w.input.burst = true;
    b.input.x = 1;
    for (let i = 0; i < 120; i++) {
      a.energy = Math.max(a.energy, 0);
      w.step();
    }
    expect(a.energy).toBeLessThan(b.entity.energy);
  });

  it('removes a player who leaves', () => {
    const w = new World(FLORIDA, 25);
    w.addPlayer(sp('bluegill'), sp('bluegill').stats, 100, 'spring');
    const g = w.addRemotePlayer(sp('bluegill'), 'spring', 1);
    w.removeEntity(g.entity);
    expect(w.entities.includes(g.entity)).toBe(false);
    expect(w.get(g.entity.id)).toBeUndefined();
    expect(w.inputFor(g.entity)).toEqual({ x: 0, y: 0, burst: false });
    for (let i = 0; i < 30; i++) w.step();
  });
});
