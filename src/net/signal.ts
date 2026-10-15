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

/** Encode a session description as a share-friendly code. */
export async function encodeCode(prefix: string, sdp: string): Promise<string> {
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
  const body = code.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('The code has invalid characters.');
  let sdp: string;
  try {
    sdp = await decompress(fromBase64Url(body));
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
