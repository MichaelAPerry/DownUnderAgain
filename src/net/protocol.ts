/**
 * LAN wire protocol. Two data channels per guest:
 *  - "snap" (unreliable, unordered): binary snapshots host->guest, binary inputs guest->host
 *  - "ctl"  (reliable, ordered): small JSON control messages, both ways
 * Everything received is untrusted: decoders validate sizes, ranges and shapes
 * and return null on anything malformed rather than throwing.
 */
import type { PlayerInput } from '../sim/types';

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 6;
export const SNAPSHOT_HZ = 20;
export const INPUT_HZ = 30;
/** Half-size of the box of world around a guest's camera that their snapshots cover. */
export const INTEREST_HALF_W = 260;
export const INTEREST_HALF_H = 170;

const MSG_SNAPSHOT = 1;
const MSG_INPUT = 2;
const POS_SCALE = 8; // positions to 1/8 px
const VEL_SCALE = 0.5; // velocities to 2 px/s
const HEADER_BYTES = 1 + 4 + 4 + 1 + 1 + 1 + 2;
const ENTITY_BYTES = 4 + 1 + 2 + 2 + 1 + 1 + 1 + 1;
/** Hard cap so a hostile host can't make a guest allocate absurd amounts. */
export const MAX_SNAPSHOT_ENTITIES = 800;

export const FLAG_FACING_RIGHT = 1;
export const FLAG_HIDDEN = 2;
export const FLAG_STUNNED = 4;
export const FLAG_PLAYER = 8;

export interface SnapEntity {
  id: number;
  /** Index into the region's species list (`region.all`). */
  def: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flags: number;
  /** Roster slot 1..MAX_PLAYERS for player fish, 0 for wildlife. */
  slot: number;
}

export interface Snapshot {
  tick: number;
  /** The receiving guest's own fish id, or 0 while dead/respawning. */
  you: number;
  /** The guest's own meters, 0..100 / 0..1. */
  energy: number;
  hpPct: number;
  parasites: number;
  entities: SnapEntity[];
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export function encodeSnapshot(s: Snapshot): ArrayBuffer {
  const n = Math.min(s.entities.length, MAX_SNAPSHOT_ENTITIES);
  const buf = new ArrayBuffer(HEADER_BYTES + n * ENTITY_BYTES);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, MSG_SNAPSHOT); o += 1;
  v.setUint32(o, s.tick >>> 0, true); o += 4;
  v.setUint32(o, s.you >>> 0, true); o += 4;
  v.setUint8(o, clampInt(s.energy, 0, 100)); o += 1;
  v.setUint8(o, clampInt(s.hpPct, 0, 100)); o += 1;
  v.setUint8(o, clampInt(s.parasites * 100, 0, 100)); o += 1;
  v.setUint16(o, n, true); o += 2;
  for (let i = 0; i < n; i++) {
    const e = s.entities[i] as SnapEntity;
    v.setUint32(o, e.id >>> 0, true); o += 4;
    v.setUint8(o, clampInt(e.def, 0, 255)); o += 1;
    v.setUint16(o, clampInt(e.x * POS_SCALE, 0, 65535), true); o += 2;
    v.setUint16(o, clampInt(e.y * POS_SCALE, 0, 65535), true); o += 2;
    v.setInt8(o, clampInt(e.vx * VEL_SCALE, -127, 127)); o += 1;
    v.setInt8(o, clampInt(e.vy * VEL_SCALE, -127, 127)); o += 1;
    v.setUint8(o, e.flags & 0xff); o += 1;
    v.setUint8(o, clampInt(e.slot, 0, MAX_PLAYERS)); o += 1;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer, speciesCount: number): Snapshot | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const v = new DataView(buf);
  let o = 0;
  if (v.getUint8(o) !== MSG_SNAPSHOT) return null;
  o += 1;
  const tick = v.getUint32(o, true); o += 4;
  const you = v.getUint32(o, true); o += 4;
  const energy = v.getUint8(o); o += 1;
  const hpPct = v.getUint8(o); o += 1;
  const parasites = v.getUint8(o) / 100; o += 1;
  const n = v.getUint16(o, true); o += 2;
  if (energy > 100 || hpPct > 100 || parasites > 1) return null;
  if (n > MAX_SNAPSHOT_ENTITIES || buf.byteLength !== HEADER_BYTES + n * ENTITY_BYTES) return null;
  const entities: SnapEntity[] = [];
  for (let i = 0; i < n; i++) {
    const id = v.getUint32(o, true); o += 4;
    const def = v.getUint8(o); o += 1;
    const x = v.getUint16(o, true) / POS_SCALE; o += 2;
    const y = v.getUint16(o, true) / POS_SCALE; o += 2;
    const vx = v.getInt8(o) / VEL_SCALE; o += 1;
    const vy = v.getInt8(o) / VEL_SCALE; o += 1;
    const flags = v.getUint8(o); o += 1;
    const slot = v.getUint8(o); o += 1;
    if (def >= speciesCount || slot > MAX_PLAYERS) return null;
    entities.push({ id, def, x, y, vx, vy, flags, slot });
  }
  return { tick, you, energy, hpPct, parasites, entities };
}

export function encodeInput(inp: PlayerInput): ArrayBuffer {
  const buf = new ArrayBuffer(4);
  const v = new DataView(buf);
  v.setUint8(0, MSG_INPUT);
  v.setInt8(1, clampInt(inp.x * 127, -127, 127));
  v.setInt8(2, clampInt(inp.y * 127, -127, 127));
  v.setUint8(3, inp.burst ? 1 : 0);
  return buf;
}

export function decodeInput(buf: ArrayBuffer): PlayerInput | null {
  if (buf.byteLength !== 4) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_INPUT) return null;
  const b = v.getUint8(3);
  if (b > 1) return null;
  let x = v.getInt8(1) / 127;
  let y = v.getInt8(2) / 127;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  return { x, y, burst: b === 1 };
}

// ---- control messages (JSON over the reliable channel) ----------------------

export interface RosterEntry {
  slot: number;
  name: string;
  fish: string;
  score: number;
  deaths: number;
  alive: boolean;
}

export type GuestMsg =
  | { t: 'hello'; v: number; name: string; fish: string }
  | { t: 'respawn'; fish: string }
  | { t: 'bye' };

export type HostMsg =
  | { t: 'welcome'; v: number; seed: number; slot: number; started: boolean }
  | { t: 'roster'; players: RosterEntry[] }
  | { t: 'start' }
  | { t: 'feed'; text: string; color: string }
  | { t: 'died'; cause: string }
  | { t: 'fx'; kind: FxKind; x: number; y: number; text: string }
  | { t: 'end'; players: RosterEntry[] }
  | { t: 'reject'; reason: string };

/** Feedback effects relayed to the guest they concern (sounds + particles). */
export const FX_KINDS = ['eat', 'bigEat', 'graze', 'sting', 'hurt', 'clean', 'death', 'invasive'] as const;
export type FxKind = (typeof FX_KINDS)[number];

const MAX_MSG = 8192;
const NAME_RE = /^[A-Z0-9 ]{1,10}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;

/** Uppercase letters, digits and spaces only, max 10 chars. */
export function sanitizePlayerName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 10) || 'FISH';
}

function parseJson(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw.length > MAX_MSG) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

export function parseGuestMsg(raw: unknown, isPlayableFish: (id: string) => boolean): GuestMsg | null {
  const o = parseJson(raw);
  if (!o) return null;
  switch (o.t) {
    case 'hello':
      if (!isInt(o.v, 0, 1000) || !isStr(o.name, 40) || !isStr(o.fish, 40) || !isPlayableFish(o.fish)) return null;
      return { t: 'hello', v: o.v, name: sanitizePlayerName(o.name), fish: o.fish };
    case 'respawn':
      if (!isStr(o.fish, 40) || !isPlayableFish(o.fish)) return null;
      return { t: 'respawn', fish: o.fish };
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

function parseRoster(v: unknown, isFish: (id: string) => boolean): RosterEntry[] | null {
  if (!Array.isArray(v) || v.length > MAX_PLAYERS) return null;
  const out: RosterEntry[] = [];
  for (const r of v) {
    if (typeof r !== 'object' || r === null) return null;
    const e = r as Record<string, unknown>;
    if (!isInt(e.slot, 1, MAX_PLAYERS) || !isStr(e.name, 10) || !NAME_RE.test(e.name)) return null;
    if (!isStr(e.fish, 40) || !isFish(e.fish) || !isInt(e.score, 0, 1e9) || !isInt(e.deaths, 0, 1e6)) return null;
    if (typeof e.alive !== 'boolean') return null;
    out.push({ slot: e.slot, name: e.name, fish: e.fish, score: e.score, deaths: e.deaths, alive: e.alive });
  }
  return out;
}

export function parseHostMsg(raw: unknown, isPlayableFish: (id: string) => boolean): HostMsg | null {
  const o = parseJson(raw);
  if (!o) return null;
  switch (o.t) {
    case 'welcome':
      if (!isInt(o.v, 0, 1000) || !isInt(o.seed, 0, 0xffffffff) || !isInt(o.slot, 1, MAX_PLAYERS) || typeof o.started !== 'boolean') return null;
      return { t: 'welcome', v: o.v, seed: o.seed, slot: o.slot, started: o.started };
    case 'roster': {
      const players = parseRoster(o.players, isPlayableFish);
      return players ? { t: 'roster', players } : null;
    }
    case 'start':
      return { t: 'start' };
    case 'feed':
      if (!isStr(o.text, 80) || !isStr(o.color, 7) || !HEX_RE.test(o.color)) return null;
      return { t: 'feed', text: o.text, color: o.color };
    case 'died':
      if (!isStr(o.cause, 80)) return null;
      return { t: 'died', cause: o.cause };
    case 'fx':
      if (!FX_KINDS.includes(o.kind as FxKind) || !isNum(o.x, 0, 65535) || !isNum(o.y, 0, 65535) || !isStr(o.text, 12)) return null;
      return { t: 'fx', kind: o.kind as FxKind, x: o.x, y: o.y, text: o.text };
    case 'end': {
      const players = parseRoster(o.players, isPlayableFish);
      return players ? { t: 'end', players } : null;
    }
    case 'reject':
      if (!isStr(o.reason, 80)) return null;
      return { t: 'reject', reason: o.reason };
    default:
      return null;
  }
}
