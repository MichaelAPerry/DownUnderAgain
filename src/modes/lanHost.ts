/**
 * LAN host: runs the authoritative reef for everyone. Guests send inputs; the
 * host simulates, scores, and streams each guest a snapshot of the reef
 * around them. The normal food web applies between players (PvP).
 */
import type { SpeciesDef } from '../data/schema';
import type { Region } from '../data/regions/florida';
import { PALETTE } from '../data/palette';
import { World } from '../sim/world';
import { isGrazed } from '../sim/foodWeb';
import type { Entity, PlayerInput } from '../sim/types';
import {
  FLAG_FACING_RIGHT, FLAG_HIDDEN, FLAG_PLAYER, FLAG_STUNNED, INTEREST_HALF_H, INTEREST_HALF_W, MAX_PLAYERS,
  PROTOCOL_VERSION, SNAPSHOT_HZ, decodeInput, encodeSnapshot, parseGuestMsg,
} from '../net/protocol';
import type { FxKind, HostMsg, RosterEntry, SnapEntity } from '../net/protocol';
import type { PeerLink } from '../net/signal';
import { describeCause } from './session';
import type { FeedbackEvent, Toast } from './session';

/** Bonus multiplier for eating another player. */
export const PLAYER_KILL_MULTIPLIER = 3;

export interface LanPlayer {
  slot: number;
  name: string;
  fish: SpeciesDef;
  entity: Entity | null;
  input: PlayerInput;
  score: number;
  deaths: number;
  /** Null for the host's own player. */
  link: PeerLink | null;
  /** Centre of this player's interest area (last known position). */
  lookX: number;
  lookY: number;
  /** Has said hello (guests only). */
  ready: boolean;
}

export class LanHost {
  readonly world: World;
  readonly players: LanPlayer[] = [];
  readonly toasts: Toast[] = [];
  readonly feedback: FeedbackEvent[] = [];
  started = false;
  ended = false;
  /** Cause of the host's own last death, while waiting to respawn. */
  localDeath: string | null = null;
  readonly local: LanPlayer;
  private readonly defIndex = new Map<string, number>();
  private readonly playable: Map<string, SpeciesDef>;
  private snapTimer = 0;
  private rosterDirty = true;
  private tick = 0;
  private readonly deadQueue: Entity[] = [];
  /** Entity id -> player; kept until the entity leaves the world (death fires before eat). */
  private readonly byEntity = new Map<number, LanPlayer>();
  private readonly unsub: Array<() => void> = [];

  constructor(readonly region: Region, readonly seed: number, name: string, fish: SpeciesDef) {
    this.world = new World(region, seed);
    region.all.forEach((d, i) => this.defIndex.set(d.id, i));
    this.playable = new Map(region.species.filter((s) => s.playable).map((s) => [s.id, s]));
    this.local = {
      slot: 1, name, fish, entity: null, input: this.world.input, score: 0, deaths: 0, link: null,
      lookX: 0, lookY: 0, ready: true,
    };
    this.players.push(this.local);
    const ev = this.world.events;
    this.unsub.push(ev.on('eat', (e) => this.onEat(e.eater, e.prey, e.points, e.gain)));
    this.unsub.push(ev.on('death', (e) => this.onDeath(e.entity, describeCause(e.cause, e.by), e.by)));
    this.unsub.push(ev.on('sting', (e) => this.fx(e.attacker, 'sting', e.attacker.x, e.attacker.y, '')));
    this.unsub.push(ev.on('clean', (e) => {
      this.fx(e.client, 'clean', e.client.x, e.client.y, '');
      this.fx(e.cleaner, 'clean', e.client.x, e.client.y, 'CLEAN!');
    }));
    this.unsub.push(ev.on('biteFail', (e) => this.fx(e.eater, 'hurt', e.prey.x, e.prey.y, 'MISS')));
  }

  get isFull(): boolean {
    return this.players.filter((p) => p.ready).length >= MAX_PLAYERS;
  }

  /**
   * Attach a connected guest. Their hello message completes the join (and is
   * where a full reef is refused: only then is the guest listening for replies).
   */
  addGuest(link: PeerLink): void {
    const slot = this.freeSlot();
    const p: LanPlayer = {
      slot, name: `P${slot}`, fish: this.local.fish, entity: null, input: { x: 0, y: 0, burst: false },
      score: 0, deaths: 0, link, lookX: 0, lookY: 0, ready: false,
    };
    this.players.push(p);
    link.ctl.addEventListener('message', (e) => this.onCtl(p, e.data));
    link.snap.addEventListener('message', (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const inp = decodeInput(e.data);
      if (inp) Object.assign(p.input, inp);
    });
    const gone = () => this.dropPlayer(p, 'left');
    link.ctl.addEventListener('close', gone);
    link.pc.addEventListener('connectionstatechange', () => {
      if (link.pc.connectionState === 'failed' || link.pc.connectionState === 'closed') gone();
    });
  }

  /** Begin the match: everyone spawns. Guests can still join later. */
  start(): void {
    if (this.started) return;
    this.started = true;
    for (const p of this.players) if (p.ready) this.spawn(p, p.fish);
    this.broadcast({ t: 'start' });
    this.rosterDirty = true;
  }

  /** Host chooses a fish after dying (or before the start). */
  respawnLocal(fish: SpeciesDef): void {
    this.local.fish = fish;
    this.localDeath = null;
    if (this.started) this.spawn(this.local, fish);
    this.rosterDirty = true;
  }

  end(): RosterEntry[] {
    const roster = this.roster();
    this.ended = true;
    this.broadcast({ t: 'end', players: roster });
    return roster;
  }

  update(dt: number): void {
    for (const t of this.toasts) t.ttl -= dt;
    while (this.toasts.length && (this.toasts[0]?.ttl ?? 1) <= 0) this.toasts.shift();
    if (this.rosterDirty) {
      this.rosterDirty = false;
      this.broadcast({ t: 'roster', players: this.roster() });
    }
    if (!this.started || this.ended) return;
    this.world.step(dt);
    // Players eaten this step leave the world now that iteration is over.
    for (const e of this.deadQueue.splice(0)) {
      this.byEntity.delete(e.id);
      this.world.removeEntity(e);
    }
    for (const p of this.players) {
      if (p.entity && p.entity.alive) {
        p.lookX = p.entity.x;
        p.lookY = p.entity.y;
      }
    }
    this.snapTimer -= dt;
    if (this.snapTimer <= 1e-6) {
      this.snapTimer = Math.max(0, this.snapTimer) + 1 / SNAPSHOT_HZ;
      this.tick++;
      for (const p of this.players) if (p.link && p.ready) this.sendSnapshot(p);
    }
  }

  roster(): RosterEntry[] {
    return this.players
      .filter((p) => p.ready)
      .map((p) => ({ slot: p.slot, name: p.name, fish: p.fish.id, score: p.score, deaths: p.deaths, alive: !!p.entity?.alive }));
  }

  slotOf(e: Entity): number {
    return this.playerOf(e)?.slot ?? 0;
  }

  dispose(): void {
    for (const u of this.unsub) u();
    for (const p of this.players) {
      if (!p.link) continue;
      this.sendTo(p.link, { t: 'end', players: this.roster() });
      setTimeout(() => p.link?.pc.close(), 300);
    }
  }

  // ---- internals ---------------------------------------------------------

  private freeSlot(): number {
    for (let s = 1; s <= MAX_PLAYERS; s++) if (!this.players.some((p) => p.slot === s)) return s;
    // No slot free: this guest will be refused on hello.
    return MAX_PLAYERS + 1;
  }

  private playerOf(e: Entity): LanPlayer | undefined {
    return e.isPlayer ? this.byEntity.get(e.id) : undefined;
  }

  private spawn(p: LanPlayer, fish: SpeciesDef): void {
    if (p.entity) {
      this.byEntity.delete(p.entity.id);
      this.world.removeEntity(p.entity);
    }
    p.fish = fish;
    const zone = fish.habitats[0]?.zone ?? 'seagrass';
    if (p === this.local) {
      p.entity = this.world.addPlayer(fish, fish.stats, 100, zone);
    } else {
      const r = this.world.addRemotePlayer(fish, zone, p.slot - 1);
      p.entity = r.entity;
      p.input = r.input;
    }
    this.byEntity.set(p.entity.id, p);
    p.lookX = p.entity.x;
    p.lookY = p.entity.y;
    this.rosterDirty = true;
  }

  private onCtl(p: LanPlayer, raw: unknown): void {
    const msg = parseGuestMsg(raw, (id) => this.playable.has(id));
    if (!msg) return;
    switch (msg.t) {
      case 'hello': {
        if (p.ready) return;
        if (this.isFull || this.ended) {
          if (p.link) this.sendTo(p.link, { t: 'reject', reason: this.ended ? 'This game has ended.' : 'This reef is full.' });
          this.dropPlayer(p, 'version');
          return;
        }
        if (msg.v !== PROTOCOL_VERSION) {
          if (p.link) this.sendTo(p.link, { t: 'reject', reason: 'Different game versions. Reload both devices.' });
          this.dropPlayer(p, 'version');
          return;
        }
        p.name = this.uniqueName(msg.name, p);
        p.fish = this.playable.get(msg.fish) ?? p.fish;
        p.ready = true;
        if (p.link) this.sendTo(p.link, { t: 'welcome', v: PROTOCOL_VERSION, seed: this.seed, slot: p.slot, started: this.started });
        if (this.started) this.spawn(p, p.fish);
        this.feed(`${p.name} joined the reef`, PALETTE.cyan);
        this.rosterDirty = true;
        return;
      }
      case 'respawn': {
        if (!this.started || (p.entity && p.entity.alive)) return;
        const fish = this.playable.get(msg.fish);
        if (fish) this.spawn(p, fish);
        return;
      }
      case 'bye':
        this.dropPlayer(p, 'left');
        return;
    }
  }

  private uniqueName(name: string, self: LanPlayer): string {
    let n = name;
    let k = 2;
    while (this.players.some((o) => o !== self && o.ready && o.name === n)) n = `${name.slice(0, 8)}${k++}`;
    return n;
  }

  private dropPlayer(p: LanPlayer, why: 'left' | 'version'): void {
    // 'version' drops are silent (refused joins); 'left' announces it.
    const i = this.players.indexOf(p);
    if (i < 0 || p === this.local) return;
    this.players.splice(i, 1);
    if (p.entity) {
      this.byEntity.delete(p.entity.id);
      this.world.removeEntity(p.entity);
    }
    p.entity = null;
    if (why === 'left' && p.ready) this.feed(`${p.name} left the reef`, PALETTE.silver);
    try {
      p.link?.pc.close();
    } catch {
      // already closed
    }
    this.rosterDirty = true;
  }

  private onEat(eater: Entity, prey: Entity, points: number, gain: number): void {
    const pe = this.playerOf(eater);
    const pp = this.playerOf(prey);
    if (pe) {
      const pts = pp ? points * PLAYER_KILL_MULTIPLIER : points;
      pe.score += pts;
      const kind: FxKind = !prey.def.native ? 'invasive' : isGrazed(prey) ? 'graze' : gain >= 30 || pp ? 'bigEat' : 'eat';
      this.fx(eater, kind, prey.x, prey.y, `+${pts}`);
      this.rosterDirty = true;
    }
    if (pp) {
      const by = pe ? `${pe.name}’s ${eater.def.name}` : `a ${eater.def.name}`;
      this.feed(pe ? `${pe.name} ate ${pp.name}!` : `${pp.name} was eaten by ${by}`, pe ? PALETTE.orange : PALETTE.silver);
    }
  }

  private onDeath(e: Entity, cause: string, by: Entity | null): void {
    const p = this.playerOf(e);
    if (!p) return;
    p.deaths++;
    const killer = by ? this.playerOf(by) : undefined;
    const text = killer ? `Eaten by ${killer.name}’s ${by?.def.name ?? 'fish'}` : cause;
    this.fx(e, 'death', e.x, e.y, '');
    if (!by) this.feed(`${p.name}: ${cause}`, PALETTE.silver);
    if (p === this.local) this.localDeath = text;
    else if (p.link) this.sendTo(p.link, { t: 'died', cause: text.slice(0, 80) });
    p.entity = null;
    this.deadQueue.push(e);
    this.rosterDirty = true;
  }

  private fx(e: Entity, kind: FxKind, x: number, y: number, text: string): void {
    const p = this.playerOf(e);
    if (!p) return;
    if (p === this.local) this.feedback.push({ kind, x, y, ...(text ? { text } : {}) });
    else if (p.link) this.sendTo(p.link, { t: 'fx', kind, x: Math.max(0, x), y: Math.max(0, y), text: text.slice(0, 12) });
  }

  private feed(text: string, color: string): void {
    const t = text.slice(0, 80);
    this.toasts.push({ text: t, color, ttl: 3 });
    if (this.toasts.length > 3) this.toasts.shift();
    this.broadcast({ t: 'feed', text: t, color });
  }

  private sendSnapshot(p: LanPlayer): void {
    const link = p.link;
    if (!link || link.snap.readyState !== 'open') return;
    // Drop snapshots rather than queue them if the guest's link is congested.
    if (link.snap.bufferedAmount > 64 * 1024) return;
    const ents: SnapEntity[] = [];
    for (const e of this.world.entities) {
      if (!e.alive) continue;
      if (Math.abs(e.x - p.lookX) > INTEREST_HALF_W || Math.abs(e.y - p.lookY) > INTEREST_HALF_H) continue;
      let flags = 0;
      if (e.facing === 1) flags |= FLAG_FACING_RIGHT;
      if (e.hidden) flags |= FLAG_HIDDEN;
      if (e.stunTimer > 0) flags |= FLAG_STUNNED;
      if (e.isPlayer) flags |= FLAG_PLAYER;
      ents.push({ id: e.id, def: this.defIndex.get(e.def.id) ?? 0, x: e.x, y: e.y, vx: e.vx, vy: e.vy, flags, slot: this.slotOf(e) });
    }
    const me = p.entity && p.entity.alive ? p.entity : null;
    const buf = encodeSnapshot({
      tick: this.tick,
      you: me ? me.id : 0,
      energy: me ? me.energy : 0,
      hpPct: me ? (me.hp / me.maxHp) * 100 : 0,
      parasites: me ? me.parasites : 0,
      entities: ents,
    });
    try {
      link.snap.send(buf);
    } catch {
      // Channel closing; the close handler will drop the player.
    }
  }

  private sendTo(link: PeerLink, msg: HostMsg): void {
    if (link.ctl.readyState !== 'open') return;
    try {
      link.ctl.send(JSON.stringify(msg));
    } catch {
      // ignore: closing
    }
  }

  private broadcast(msg: HostMsg): void {
    for (const p of this.players) if (p.link && p.ready) this.sendTo(p.link, msg);
  }
}
