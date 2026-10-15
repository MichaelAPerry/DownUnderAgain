import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS, decodeInput, decodeSnapshot, encodeInput, encodeSnapshot, parseGuestMsg, parseHostMsg, sanitizePlayerName,
} from '../src/net/protocol';
import type { Snapshot } from '../src/net/protocol';
import { CODE_PREFIX_INVITE, CODE_PREFIX_REPLY, decodeCode, encodeCode } from '../src/net/signal';

const fish = (id: string) => ['bluegill', 'bull_shark'].includes(id);

const SDP = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 3f1c5b1e-2a2f-4b61-9d3b-6f7e1b2a9c10.local 54400 typ host generation 0',
  'a=ice-ufrag:abcd', 'a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

describe('snapshot codec', () => {
  const snap: Snapshot = {
    tick: 1234, you: 77, energy: 64, hpPct: 90, parasites: 0.25,
    entities: [
      { id: 77, def: 3, x: 4200.125, y: 101.5, vx: 40, vy: -12, flags: 1 | 8, slot: 2 },
      { id: 9, def: 33, x: 0, y: 1375.875, vx: -254, vy: 254, flags: 0, slot: 0 },
    ],
  };

  it('round-trips with 1/8 px precision', () => {
    const d = decodeSnapshot(encodeSnapshot(snap), 34);
    expect(d).toEqual(snap);
  });

  it('rejects malformed or hostile buffers', () => {
    const good = encodeSnapshot(snap);
    expect(decodeSnapshot(good.slice(0, good.byteLength - 1), 34)).toBeNull(); // truncated
    expect(decodeSnapshot(good, 10)).toBeNull(); // species index out of range
    const bad = good.slice(0);
    new DataView(bad).setUint8(0, 9);
    expect(decodeSnapshot(bad, 34)).toBeNull(); // wrong message type
    const huge = new ArrayBuffer(14);
    const v = new DataView(huge);
    v.setUint8(0, 1);
    v.setUint16(12, 60000, true); // claims 60000 entities
    expect(decodeSnapshot(huge, 34)).toBeNull();
    expect(decodeSnapshot(new ArrayBuffer(0), 34)).toBeNull();
  });
});

describe('input codec', () => {
  it('round-trips and clamps to the unit circle', () => {
    expect(decodeInput(encodeInput({ x: 1, y: 0, burst: true }))).toEqual({ x: 1, y: 0, burst: true });
    const diag = decodeInput(encodeInput({ x: 1, y: 1, burst: false }));
    expect(Math.hypot(diag!.x, diag!.y)).toBeLessThanOrEqual(1.0001);
    expect(decodeInput(new ArrayBuffer(3))).toBeNull();
  });
});

describe('control messages', () => {
  it('accepts valid messages and sanitises names', () => {
    expect(parseGuestMsg(JSON.stringify({ t: 'hello', v: 1, name: '<b>alex</b>!', fish: 'bluegill' }), fish))
      .toEqual({ t: 'hello', v: 1, name: 'BALEXB', fish: 'bluegill' });
    expect(parseHostMsg(JSON.stringify({ t: 'feed', text: 'ALEX ATE SAM', color: '#ffcd75' }), fish))
      .toEqual({ t: 'feed', text: 'ALEX ATE SAM', color: '#ffcd75' });
  });

  it('rejects unknown fish, bad shapes and oversized input', () => {
    expect(parseGuestMsg(JSON.stringify({ t: 'hello', v: 1, name: 'A', fish: 'manatee' }), fish)).toBeNull();
    expect(parseGuestMsg('{"t":"nope"}', fish)).toBeNull();
    expect(parseGuestMsg('not json', fish)).toBeNull();
    expect(parseGuestMsg('x'.repeat(10000), fish)).toBeNull();
    expect(parseHostMsg(JSON.stringify({ t: 'feed', text: 'x', color: 'red;}' }), fish)).toBeNull();
    const tooMany = Array.from({ length: MAX_PLAYERS + 1 }, (_, i) => ({ slot: 1, name: 'A', fish: 'bluegill', score: i, deaths: 0, alive: true }));
    expect(parseHostMsg(JSON.stringify({ t: 'roster', players: tooMany }), fish)).toBeNull();
    expect(parseHostMsg(JSON.stringify({ t: 'roster', players: [{ slot: 1, name: '<img>', fish: 'bluegill', score: 1, deaths: 0, alive: true }] }), fish)).toBeNull();
  });

  it('sanitizePlayerName never returns empty', () => {
    expect(sanitizePlayerName('')).toBe('FISH');
    expect(sanitizePlayerName('a very long player name')).toBe('A VERY LON');
  });
});

describe('pairing codes', () => {
  it('round-trips an SDP through a compact code', async () => {
    const code = await encodeCode(CODE_PREFIX_INVITE, SDP);
    expect(code.startsWith(`${CODE_PREFIX_INVITE}.`)).toBe(true);
    expect(code.length).toBeLessThan(SDP.length);
    expect(await decodeCode(CODE_PREFIX_INVITE, code)).toBe(SDP);
    // Whitespace from copy/paste or line wrapping is ignored.
    expect(await decodeCode(CODE_PREFIX_INVITE, ` ${code.slice(0, 20)}\n${code.slice(20)} `)).toBe(SDP);
  });

  it('explains wrong or broken codes', async () => {
    const invite = await encodeCode(CODE_PREFIX_INVITE, SDP);
    await expect(decodeCode(CODE_PREFIX_REPLY, invite)).rejects.toThrow(/invite code/);
    await expect(decodeCode(CODE_PREFIX_INVITE, 'hello')).rejects.toThrow(/isn.t a Down Under Again code/);
    await expect(decodeCode(CODE_PREFIX_INVITE, `${CODE_PREFIX_INVITE}.AAAA`)).rejects.toThrow(/damaged/);
    await expect(decodeCode(CODE_PREFIX_INVITE, `${CODE_PREFIX_INVITE}.<script>`)).rejects.toThrow(/invalid characters/);
    // A decompression bomb is refused.
    const bomb = await encodeCode(CODE_PREFIX_INVITE, `v=0\r\nm=application${' '.repeat(100000)}`);
    await expect(decodeCode(CODE_PREFIX_INVITE, bomb)).rejects.toThrow();
  });
});
