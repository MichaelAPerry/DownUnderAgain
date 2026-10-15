import { describe, expect, it } from 'vitest';
import { FLORIDA } from '../src/data/regions/florida';
import type { SpeciesDef } from '../src/data/schema';
import { LanHost, PLAYER_KILL_MULTIPLIER } from '../src/modes/lanHost';
import { LanClient } from '../src/modes/lanClient';
import type { PeerLink } from '../src/net/signal';
import { SIM_DT } from '../src/sim/world';

const sp = (id: string): SpeciesDef => {
  const d = FLORIDA.all.find((s) => s.id === id);
  if (!d) throw new Error(id);
  return d;
};

/** In-memory stand-in for an RTCDataChannel pair (synchronous delivery). */
class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  binaryType = 'arraybuffer';
  peer!: FakeChannel;
  sent = 0;
  constructor(readonly label: string) {
    super();
  }
  send(data: string | ArrayBuffer): void {
    if (this.readyState !== 'open') throw new Error('closed');
    this.sent++;
    this.peer.dispatchEvent(new MessageEvent('message', { data }));
  }
  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
    this.peer.close();
  }
}

class FakePc extends EventTarget {
  connectionState: RTCPeerConnectionState = 'connected';
  close(): void {
    this.connectionState = 'closed';
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}

function linkPair(): [PeerLink, PeerLink] {
  const mk = () => ({ ctl: new FakeChannel('ctl'), snap: new FakeChannel('snap'), pc: new FakePc() });
  const a = mk();
  const b = mk();
  a.ctl.peer = b.ctl;
  b.ctl.peer = a.ctl;
  a.snap.peer = b.snap;
  b.snap.peer = a.snap;
  const cast = (x: typeof a) => x as unknown as PeerLink;
  return [cast(a), cast(b)];
}

function setup(hostFish = 'bull_shark', guestFish = 'striped_mullet') {
  const host = new LanHost(FLORIDA, 4242, 'HOST', sp(hostFish));
  const [hostSide, guestSide] = linkPair();
  host.addGuest(hostSide);
  const guest = new LanClient(FLORIDA, guestSide, 'ALEX', sp(guestFish));
  return { host, guest, hostSide, guestSide };
}

const run = (host: LanHost, guest: LanClient, steps: number, input = { x: 0, y: 0, burst: false }) => {
  for (let i = 0; i < steps; i++) {
    host.update(SIM_DT);
    guest.update(SIM_DT, input);
  }
};

describe('LAN host + guest', () => {
  it('handshakes: welcome with the seed, roster, lobby then start', () => {
    const { host, guest } = setup();
    expect(guest.state).toBe('lobby');
    expect(guest.slot).toBe(2);
    expect(guest.world?.seed).toBe(4242);
    run(host, guest, 2);
    expect(guest.roster.map((r) => r.name)).toEqual(['HOST', 'ALEX']);
    host.start();
    expect(guest.state).toBe('playing');
  });

  it('mirrors the reef around the guest from snapshots', () => {
    const { host, guest } = setup();
    host.start();
    run(host, guest, 10);
    expect(guest.you).not.toBeNull();
    expect(guest.world!.entities.length).toBeGreaterThan(5);
    // Terrain is rebuilt from the seed, identical to the host's.
    expect(guest.world!.terrain.floorAt(1234)).toBe(host.world.terrain.floorAt(1234));
    // Every mirrored creature is within the guest's interest area of the host world.
    const hostIds = new Set(host.world.entities.map((e) => e.id));
    for (const e of guest.world!.entities) expect(hostIds.has(e.id)).toBe(true);
  });

  it("moves the guest's fish by the guest's input", () => {
    const { host, guest } = setup();
    host.start();
    run(host, guest, 5);
    const me = host.players.find((p) => p.name === 'ALEX')!.entity!;
    const x0 = me.x;
    run(host, guest, 60, { x: -1, y: 0, burst: false });
    expect(me.x).toBeLessThan(x0 - 10);
    // The mirror trails the host by at most one snapshot interval of motion.
    const maxLag = (me.stats.maxSpeed * 1.2) / 20 + 1;
    expect(Math.abs(guest.you!.x - me.x)).toBeLessThanOrEqual(maxLag);
  });

  it('PvP: a player eaten by another scores a bonus, notifies the victim, who can respawn', () => {
    const { host, guest } = setup('bull_shark', 'striped_mullet');
    host.start();
    run(host, guest, 3);
    const shark = host.local.entity!;
    const alex = host.players.find((p) => p.name === 'ALEX')!;
    const mullet = alex.entity!;
    mullet.x = shark.x + shark.facing * shark.def.length * 0.4;
    mullet.y = shark.y;
    shark.eatCooldown = 0;
    run(host, guest, 2);
    expect(mullet.alive).toBe(false);
    expect(host.local.score).toBeGreaterThan(0);
    expect(host.local.score % PLAYER_KILL_MULTIPLIER).toBe(0);
    expect(guest.state).toBe('dead');
    expect(guest.deathCause).toMatch(/HOST/);
    expect(guest.toasts.some((t) => t.text.includes('HOST ate ALEX'))).toBe(true);
    expect(host.world.entities.includes(mullet)).toBe(false);
    // Respawn as a different fish.
    guest.respawn(sp('bluegill'));
    run(host, guest, 8); // a snapshot carrying the new fish arrives within 1/20 s
    expect(guest.state).toBe('playing');
    expect(alex.entity?.def.id).toBe('bluegill');
    expect(guest.you?.def.id).toBe('bluegill');
  });

  it('removes a guest who disconnects and tells guests when the host ends', () => {
    const { host, guest, guestSide } = setup();
    host.start();
    run(host, guest, 3);
    const alexEntity = host.players.find((p) => p.name === 'ALEX')!.entity!;
    guestSide.ctl.close();
    expect(host.players.map((p) => p.name)).toEqual(['HOST']);
    expect(host.world.entities.includes(alexEntity)).toBe(false);
    expect(guest.state).toBe('lost');

    const s2 = setup();
    s2.host.start();
    run(s2.host, s2.guest, 3);
    const final = s2.host.end();
    expect(final).toHaveLength(2);
    expect(s2.guest.state).toBe('ended');
    expect(s2.guest.roster).toHaveLength(2);
  });

  it('rejects guests once the reef is full and ignores malformed traffic', () => {
    const host = new LanHost(FLORIDA, 7, 'HOST', sp('bluegill'));
    const guests: LanClient[] = [];
    for (let i = 0; i < 6; i++) {
      const [h, g] = linkPair();
      host.addGuest(h);
      guests.push(new LanClient(FLORIDA, g, `G${i}`, sp('bluegill')));
    }
    expect(host.players).toHaveLength(6);
    expect(guests[5]!.state).toBe('lost');
    expect(guests[5]!.endReason).toMatch(/full/);
    // Garbage on both channels is ignored, not fatal.
    const [h, g] = linkPair();
    const host2 = new LanHost(FLORIDA, 8, 'HOST', sp('bluegill'));
    host2.addGuest(h);
    g.ctl.send('{"t":"hello","v":1,"name":"X","fish":"manatee"}');
    g.ctl.send('not json');
    g.snap.send(new ArrayBuffer(3));
    expect(host2.players.filter((p) => p.ready)).toHaveLength(1);
    for (let i = 0; i < 5; i++) host2.update(SIM_DT);
  });

  it('keeps names unique', () => {
    const host = new LanHost(FLORIDA, 9, 'ALEX', sp('bluegill'));
    const [h, g] = linkPair();
    host.addGuest(h);
    new LanClient(FLORIDA, g, 'ALEX', sp('bluegill'));
    expect(host.roster().map((r) => r.name)).toEqual(['ALEX', 'ALEX2']);
  });
});
