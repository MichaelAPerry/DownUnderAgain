/**
 * LAN guest: mirrors the host's reef from snapshots and sends inputs. The
 * mirror World is built from the host's seed, so terrain matches exactly
 * without sending it; creatures are lightweight proxies updated from each
 * snapshot and interpolated between them for smooth motion.
 */
import type { SpeciesDef } from '../data/schema';
import type { Region } from '../data/regions/florida';
import { World } from '../sim/world';
import type { Entity, PlayerInput } from '../sim/types';
import { BASE_MAX_HP } from '../sim/stats';
import {
  FLAG_FACING_RIGHT, FLAG_HIDDEN, FLAG_PLAYER, FLAG_STUNNED, INPUT_HZ, PROTOCOL_VERSION, SNAPSHOT_HZ,
  decodeSnapshot, encodeInput, parseHostMsg,
} from '../net/protocol';
import type { GuestMsg, RosterEntry, Snapshot } from '../net/protocol';
import type { PeerLink } from '../net/signal';
import type { FeedbackEvent, Toast } from './session';

export type ClientState = 'joining' | 'lobby' | 'playing' | 'dead' | 'ended' | 'lost';

export class LanClient {
  world: World | null = null;
  state: ClientState = 'joining';
  slot = 0;
  roster: RosterEntry[] = [];
  readonly toasts: Toast[] = [];
  readonly feedback: FeedbackEvent[] = [];
  deathCause: string | null = null;
  /** Why the session ended, for the UI. */
  endReason: string | null = null;
  /** The guest's own fish proxy, if alive. */
  you: Entity | null = null;
  energy = 0;
  hpPct = 0;
  parasites = 0;
  /** Codex ids seen through snapshots (merged into the save by the app). */
  readonly seen = new Set<string>();
  /** Fraction of the way from the previous snapshot to the latest (0..1). */
  alpha = 1;
  private readonly proxies = new Map<number, Entity>();
  /** Entity id -> roster slot for player fish (name tags). */
  private readonly slots = new Map<number, number>();
  /** Id of the fish we lost; snapshots still carrying it don't mean we're back. */
  private diedId = 0;
  private readonly playable: Map<string, SpeciesDef>;
  private lastSnapAt = 0;
  private lastTick = -1;
  private inputTimer = 0;
  private readonly sentInput: PlayerInput = { x: 0, y: 0, burst: false };

  constructor(readonly region: Region, readonly link: PeerLink, readonly name: string, public fish: SpeciesDef) {
    this.playable = new Map(region.species.filter((s) => s.playable).map((s) => [s.id, s]));
    link.ctl.addEventListener('message', (e) => this.onCtl(e.data));
    link.snap.addEventListener('message', (e) => {
      if (e.data instanceof ArrayBuffer) this.onSnap(e.data);
    });
    const lost = () => {
      if (this.state !== 'ended') {
        this.state = 'lost';
        this.endReason ??= 'Lost connection to the host.';
      }
    };
    link.ctl.addEventListener('close', lost);
    link.pc.addEventListener('connectionstatechange', () => {
      if (link.pc.connectionState === 'failed' || link.pc.connectionState === 'closed') lost();
    });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name, fish: fish.id });
  }

  /** Ask the host to respawn as this fish (after dying). */
  respawn(fish: SpeciesDef): void {
    this.fish = fish;
    this.deathCause = null;
    this.send({ t: 'respawn', fish: fish.id });
  }

  leave(): void {
    this.send({ t: 'bye' });
    setTimeout(() => this.link.pc.close(), 200);
    this.state = 'ended';
  }

  /** Per-frame: send input at INPUT_HZ, advance interpolation and animation. */
  update(dt: number, input: PlayerInput): void {
    for (const t of this.toasts) t.ttl -= dt;
    while (this.toasts.length && (this.toasts[0]?.ttl ?? 1) <= 0) this.toasts.shift();
    this.alpha = Math.min(1, (performance.now() - this.lastSnapAt) / (1000 / SNAPSHOT_HZ));
    for (const e of this.proxies.values()) e.age += dt;
    this.inputTimer -= dt;
    const changed = input.x !== this.sentInput.x || input.y !== this.sentInput.y || input.burst !== this.sentInput.burst;
    if (this.state === 'playing' && (this.inputTimer <= 0 || changed) && this.link.snap.readyState === 'open') {
      this.inputTimer = 1 / INPUT_HZ;
      Object.assign(this.sentInput, input);
      try {
        this.link.snap.send(encodeInput(input));
      } catch {
        // closing
      }
    }
  }

  // ---- incoming ----------------------------------------------------------

  private onCtl(raw: unknown): void {
    const msg = parseHostMsg(raw, (id) => this.playable.has(id));
    if (!msg) return;
    switch (msg.t) {
      case 'welcome':
        if (msg.v !== PROTOCOL_VERSION) {
          this.state = 'lost';
          this.endReason = 'Different game versions. Reload both devices.';
          return;
        }
        this.slot = msg.slot;
        this.world = new World(this.region, msg.seed);
        // The mirror only needs the seeded terrain; creatures come from snapshots.
        this.world.entities.length = 0;
        this.world.rebuildHash();
        this.state = msg.started ? 'playing' : 'lobby';
        return;
      case 'roster':
        this.roster = msg.players;
        return;
      case 'start':
        if (this.state === 'lobby') this.state = 'playing';
        return;
      case 'feed':
        this.toasts.push({ text: msg.text, color: msg.color, ttl: 3 });
        if (this.toasts.length > 3) this.toasts.shift();
        return;
      case 'died':
        this.deathCause = msg.cause;
        this.diedId = this.you?.id ?? this.diedId;
        this.state = 'dead';
        return;
      case 'fx':
        this.feedback.push({ kind: msg.kind, x: msg.x, y: msg.y, ...(msg.text ? { text: msg.text } : {}) });
        return;
      case 'end':
        this.roster = msg.players;
        this.state = 'ended';
        this.endReason = 'The host ended the game.';
        return;
      case 'reject':
        this.state = 'lost';
        this.endReason = msg.reason;
        return;
    }
  }

  private onSnap(buf: ArrayBuffer): void {
    const w = this.world;
    if (!w) return;
    const s: Snapshot | null = decodeSnapshot(buf, this.region.all.length);
    // Unordered channel: ignore snapshots older than the newest applied.
    if (!s || s.tick <= this.lastTick) return;
    this.lastTick = s.tick;
    this.lastSnapAt = performance.now();
    this.energy = s.energy;
    this.hpPct = s.hpPct;
    this.parasites = s.parasites;
    const keep = new Set<number>();
    for (const se of s.entities) {
      const def = this.region.all[se.def];
      if (!def) continue;
      keep.add(se.id);
      let e = this.proxies.get(se.id);
      if (!e || e.def !== def) {
        e = makeProxy(se.id, def, (se.flags & FLAG_PLAYER) !== 0, se.x, se.y);
        this.proxies.set(se.id, e);
        this.seen.add(def.id);
      } else {
        // Continue from where it is drawn right now toward the new position.
        e.px = e.px + (e.x - e.px) * this.alpha;
        e.py = e.py + (e.y - e.py) * this.alpha;
      }
      e.x = se.x;
      e.y = se.y;
      e.vx = se.vx;
      e.vy = se.vy;
      e.facing = se.flags & FLAG_FACING_RIGHT ? 1 : -1;
      e.hidden = (se.flags & FLAG_HIDDEN) !== 0;
      e.stunTimer = se.flags & FLAG_STUNNED ? 0.1 : 0;
      if (se.slot) this.slots.set(se.id, se.slot);
    }
    for (const id of [...this.proxies.keys()]) {
      if (keep.has(id)) continue;
      this.proxies.delete(id);
      this.slots.delete(id);
    }
    w.entities.length = 0;
    for (const e of this.proxies.values()) w.entities.push(e);
    const you = s.you && s.you !== this.diedId ? this.proxies.get(s.you) ?? null : null;
    this.you = you;
    w.player = you;
    if (you) {
      you.energy = s.energy;
      you.hp = (s.hpPct / 100) * you.maxHp;
      you.parasites = s.parasites;
      // A fresh fish id after dying means the respawn went through.
      if (this.state === 'dead') {
        this.state = 'playing';
        this.deathCause = null;
      }
    }
    // Snapshots restart interpolation from the current drawn position.
    this.alpha = 0;
    w.rebuildHash();
  }

  /** Roster slot (1..6) of a player fish, or 0 for wildlife. */
  slotOf(e: Entity): number {
    return this.slots.get(e.id) ?? 0;
  }

  private send(msg: GuestMsg): void {
    if (this.link.ctl.readyState !== 'open') return;
    try {
      this.link.ctl.send(JSON.stringify(msg));
    } catch {
      // closing
    }
  }
}

function makeProxy(id: number, def: SpeciesDef, isPlayer: boolean, x: number, y: number): Entity {
  return {
    id, def, stats: def.stats, maxHp: BASE_MAX_HP, homeZone: def.habitats[0]?.zone ?? 'seagrass',
    x, y, vx: 0, vy: 0, px: x, py: y, facing: 1, energy: 100, hp: BASE_MAX_HP, parasites: 0, alive: true, isPlayer,
    state: 'wander', targetId: -1, fleeX: 0, fleeY: 0, thinkTimer: 0, wanderAngle: 0, eatCooldown: 0, stunTimer: 0,
    hidden: false, age: Math.random() * 10, homeX: 0, homeY: 0, chaseTime: 0, schoolN: 0, cohX: 0, cohY: 0, aliX: 0,
    aliY: 0, sepX: 0, sepY: 0,
  };
}
