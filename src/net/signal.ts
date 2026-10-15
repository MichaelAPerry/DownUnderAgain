/**
 * Serverless WebRTC pairing for LAN play. There is no signalling server: the
 * host shows an invite code (its SDP offer, compressed), the guest answers
 * with a reply code, and the host enters that. No STUN/TURN servers are used,
 * so traffic stays on the local network; ICE uses host (often mDNS .local)
 * candidates, which work between devices on the same Wi-Fi unless the
 * network isolates clients ("AP isolation").
 */

export const CODE_PREFIX_INVITE = 'DUA1I';
export const CODE_PREFIX_REPLY = 'DUA1R';
const MAX_CODE = 6000;
const MAX_SDP = 20000;
const ICE_TIMEOUT_MS = 4000;
const CONNECT_TIMEOUT_MS = 20000;

export interface PeerLink {
  pc: RTCPeerConnection;
  /** Reliable, ordered JSON control channel. */
  ctl: RTCDataChannel;
  /** Unreliable, unordered binary channel for snapshots and inputs. */
  snap: RTCDataChannel;
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    // Host candidates arrive almost instantly on a LAN; don't hang on slow interfaces.
    const timer = setTimeout(done, ICE_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

async function compress(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    // Refuse decompression bombs.
    if (total > MAX_SDP) {
      await reader.cancel();
      throw new Error('code too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(out);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- compact codes ---------------------------------------------------------
//
// A data-channel SDP is mostly random keys, which don't compress. Instead we
// pack only what a LAN connection needs (ICE credentials, the DTLS
// fingerprint and role, UDP host candidates, SCTP settings) into ~100 bytes
// and rebuild a minimal SDP on the other side. Codes in this form have a '~'
// after the prefix; anything we can't pack falls back to deflated SDP.

const COMPACT_MARK = '~';
const COMPACT_VERSION = 1;
const SETUPS = ['actpass', 'active', 'passive'] as const;
const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
const ICE_CHARS = /^[A-Za-z0-9+/]{1,64}$/;
const MAX_CANDIDATES = 8;

interface Cand {
  /** 0 = IPv4, 1 = IPv6, 2 = mDNS uuid.local */
  kind: number;
  addr: Uint8Array;
  port: number;
  priority: number;
}

function parseAddr(a: string): { kind: number; addr: Uint8Array } | null {
  const v4 = a.split('.');
  if (v4.length === 4 && v4.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return { kind: 0, addr: Uint8Array.from(v4.map(Number)) };
  const m = UUID_LOCAL.exec(a);
  if (m) {
    const hex = m.slice(1).join('');
    return { kind: 2, addr: Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16)) };
  }
  if (a.includes(':') && /^[0-9a-f:]+$/i.test(a)) {
    const [head = '', tail = ''] = a.split('::');
    const h = head ? head.split(':') : [];
    const t = a.includes('::') ? (tail ? tail.split(':') : []) : [];
    const groups = a.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : a.split(':');
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
    const out = new Uint8Array(16);
    groups.forEach((g, i) => {
      const v = parseInt(g, 16);
      out[i * 2] = v >> 8;
      out[i * 2 + 1] = v & 255;
    });
    return { kind: 1, addr: out };
  }
  return null;
}

function formatAddr(kind: number, b: Uint8Array): string {
  if (kind === 0) return Array.from(b).join('.');
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  if (kind === 2) return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  return (hex.match(/..../g) ?? []).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
}

/** Pack an SDP into compact bytes, or null if it has anything we don't model. */
export function packSdp(sdp: string): Uint8Array | null {
  const lines = sdp.split(/\r?\n/);
  const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
  const ufrag = get('a=ice-ufrag:');
  const pwd = get('a=ice-pwd:');
  const fp = get('a=fingerprint:sha-256 ');
  const setup = get('a=setup:');
  const sctpPort = Number(get('a=sctp-port:') ?? 5000);
  const maxMsg = Number(get('a=max-message-size:') ?? 262144);
  if (!ufrag || !pwd || !ICE_CHARS.test(ufrag) || !ICE_CHARS.test(pwd) || !fp || !setup) return null;
  const setupIdx = SETUPS.indexOf(setup as (typeof SETUPS)[number]);
  if (setupIdx < 0 || !Number.isInteger(sctpPort) || sctpPort < 1 || sctpPort > 65535) return null;
  if (!Number.isInteger(maxMsg) || maxMsg < 0 || maxMsg > 0xffffffff) return null;
  const fpBytes = fp.split(':');
  if (fpBytes.length !== 32 || fpBytes.some((b) => !/^[0-9A-F]{2}$/i.test(b))) return null;
  const cands: Cand[] = [];
  for (const l of lines) {
    if (!l.startsWith('a=candidate:')) continue;
    const f = l.slice('a=candidate:'.length).split(' ');
    // foundation component transport priority address port 'typ' type ...
    if (f[1] !== '1' || f[2]?.toLowerCase() !== 'udp' || f[7] !== 'host') continue;
    const a = parseAddr(f[4] ?? '');
    const port = Number(f[5]);
    const priority = Number(f[3]);
    if (!a || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(priority) || priority < 0 || priority > 0xffffffff) continue;
    if (cands.length < MAX_CANDIDATES) cands.push({ ...a, port, priority });
  }
  if (cands.length === 0) return null;
  const size = 1 + 1 + 1 + ufrag.length + 1 + pwd.length + 32 + 2 + 4 + 1 + cands.reduce((n, c) => n + 1 + c.addr.length + 2 + 4, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let o = 0;
  out[o++] = COMPACT_VERSION;
  out[o++] = setupIdx;
  out[o++] = ufrag.length;
  for (const ch of ufrag) out[o++] = ch.charCodeAt(0);
  out[o++] = pwd.length;
  for (const ch of pwd) out[o++] = ch.charCodeAt(0);
  for (const b of fpBytes) out[o++] = parseInt(b, 16);
  v.setUint16(o, sctpPort);
  o += 2;
  v.setUint32(o, maxMsg);
  o += 4;
  out[o++] = cands.length;
  for (const c of cands) {
    out[o++] = c.kind;
    out.set(c.addr, o);
    o += c.addr.length;
    v.setUint16(o, c.port);
    o += 2;
    v.setUint32(o, c.priority);
    o += 4;
  }
  return out;
}

/** Rebuild a minimal, valid data-channel SDP from compact bytes. Throws on malformed input. */
export function unpackSdp(b: Uint8Array): string {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const need = (n: number) => {
    if (o + n > b.length) throw new Error('truncated');
  };
  need(3);
  if (b[o++] !== COMPACT_VERSION) throw new Error('version');
  const setup = SETUPS[b[o++] ?? 99];
  if (!setup) throw new Error('setup');
  const str = () => {
    need(1);
    const n = b[o++] ?? 0;
    need(n);
    const s = String.fromCharCode(...b.subarray(o, o + n));
    o += n;
    if (!ICE_CHARS.test(s)) throw new Error('ice chars');
    return s;
  };
  const ufrag = str();
  const pwd = str();
  need(32 + 2 + 4 + 1);
  const fp = Array.from(b.subarray(o, o + 32), (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  o += 32;
  const sctpPort = v.getUint16(o);
  o += 2;
  const maxMsg = v.getUint32(o);
  o += 4;
  const count = b[o++] ?? 0;
  if (count < 1 || count > MAX_CANDIDATES || sctpPort === 0) throw new Error('fields');
  const cand: string[] = [];
  for (let i = 0; i < count; i++) {
    need(1);
    const kind = b[o++] ?? 99;
    const len = kind === 0 ? 4 : kind === 1 || kind === 2 ? 16 : -1;
    if (len < 0) throw new Error('kind');
    need(len + 6);
    const addr = formatAddr(kind, b.subarray(o, o + len));
    o += len;
    const port = v.getUint16(o);
    o += 2;
    const prio = v.getUint32(o);
    o += 4;
    if (port === 0) throw new Error('port');
    cand.push(`a=candidate:${i + 1} 1 udp ${prio} ${addr} ${port} typ host generation 0`);
  }
  if (o !== b.length) throw new Error('trailing bytes');
  return [
    'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    ...cand,
    `a=ice-ufrag:${ufrag}`, `a=ice-pwd:${pwd}`, `a=fingerprint:sha-256 ${fp}`, `a=setup:${setup}`,
    'a=mid:0', `a=sctp-port:${sctpPort}`, `a=max-message-size:${maxMsg}`, '',
  ].join('\r\n');
}

/** Encode a session description as a share-friendly code (compact when possible). */
export async function encodeCode(prefix: string, sdp: string): Promise<string> {
  const packed = packSdp(sdp);
  if (packed) return `${prefix}.${COMPACT_MARK}${toBase64Url(packed)}`;
  return `${prefix}.${toBase64Url(await compress(sdp))}`;
}

/** Decode and sanity-check a pasted/scanned code. Throws a user-readable Error. */
export async function decodeCode(expectPrefix: string, raw: string): Promise<string> {
  const code = raw.replace(/\s+/g, '');
  if (code.length === 0) throw new Error('The code is empty.');
  if (code.length > MAX_CODE) throw new Error('That code is too long.');
  const dot = code.indexOf('.');
  const prefix = dot > 0 ? code.slice(0, dot) : '';
  if (prefix !== expectPrefix) {
    if (prefix === CODE_PREFIX_INVITE || prefix === CODE_PREFIX_REPLY) {
      throw new Error(expectPrefix === CODE_PREFIX_INVITE ? 'That is a reply code. Paste the host’s invite code.' : 'That is an invite code. Paste the guest’s reply code.');
    }
    throw new Error('That isn’t a Down Under Again code.');
  }
  let body = code.slice(dot + 1);
  const compact = body.startsWith(COMPACT_MARK);
  if (compact) body = body.slice(1);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('The code has invalid characters.');
  let sdp: string;
  try {
    sdp = compact ? unpackSdp(fromBase64Url(body)) : await decompress(fromBase64Url(body));
  } catch {
    throw new Error('The code is damaged. Copy it again.');
  }
  if (!sdp.startsWith('v=0') || !sdp.includes('m=application')) throw new Error('The code is damaged. Copy it again.');
  return sdp;
}

function waitOpen(link: PeerLink): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      if (link.ctl.readyState === 'open' && link.snap.readyState === 'open') {
        clearTimeout(timer);
        resolve();
      }
    };
    const timer = setTimeout(() => reject(new Error('Could not connect. Are both devices on the same Wi-Fi?')), CONNECT_TIMEOUT_MS);
    link.ctl.addEventListener('open', ok);
    link.snap.addEventListener('open', ok);
    link.pc.addEventListener('connectionstatechange', () => {
      if (link.pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error('Connection failed. Some networks block devices from talking to each other.'));
      }
    });
    ok();
  });
}

/** Host: create a connection for one guest and its invite code. */
export async function createInvite(): Promise<{ link: PeerLink; code: string; connected: (replyCode: string) => Promise<void> }> {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const ctl = pc.createDataChannel('ctl', { ordered: true });
  const snap = pc.createDataChannel('snap', { ordered: false, maxRetransmits: 0 });
  snap.binaryType = 'arraybuffer';
  const link: PeerLink = { pc, ctl, snap };
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  const offer = pc.localDescription?.sdp;
  if (!offer) throw new Error('Could not create an invite.');
  const code = await encodeCode(CODE_PREFIX_INVITE, offer);
  const connected = async (replyCode: string) => {
    const sdp = await decodeCode(CODE_PREFIX_REPLY, replyCode);
    await pc.setRemoteDescription({ type: 'answer', sdp });
    await waitOpen(link);
  };
  return { link, code, connected };
}

/** Guest: accept an invite code, returning the reply code and a promise for the open link. */
export async function acceptInvite(inviteCode: string): Promise<{ code: string; link: Promise<PeerLink>; close: () => void }> {
  const sdp = await decodeCode(CODE_PREFIX_INVITE, inviteCode);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const channels = new Map<string, RTCDataChannel>();
  const gotChannels = new Promise<PeerLink>((resolve, reject) => {
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') reject(new Error('Connection failed. Some networks block devices from talking to each other.'));
    });
    pc.addEventListener('datachannel', (e) => {
      const ch = e.channel;
      if (ch.label !== 'ctl' && ch.label !== 'snap') {
        ch.close();
        return;
      }
      if (ch.label === 'snap') ch.binaryType = 'arraybuffer';
      channels.set(ch.label, ch);
      const ctl = channels.get('ctl');
      const snap = channels.get('snap');
      if (ctl && snap) resolve({ pc, ctl, snap });
    });
  });
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  const answer = pc.localDescription?.sdp;
  if (!answer) throw new Error('Could not create a reply.');
  const code = await encodeCode(CODE_PREFIX_REPLY, answer);
  const link = gotChannels.then(async (l) => {
    await waitOpen(l);
    return l;
  });
  return { code, link, close: () => pc.close() };
}
