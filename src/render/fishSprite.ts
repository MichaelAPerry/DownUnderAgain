/**
 * Procedural pixel-art fish. A species' `look` (shape, colours, pattern) plus
 * its length/height fully determine the sprite, so custom fish get art for
 * free and every sprite stays on-palette. Facing right; the renderer flips.
 */
import type { BodyShape, FishLook } from '../data/schema';
import { PALETTE, mixHex } from '../data/palette';
import type { PixelSprite } from './pixelSprite';

type TailStyle = 'fork' | 'lunate' | 'round' | 'hetero' | 'paddle';

interface ShapeSpec {
  /** Fraction of length taken by the tail fin. */
  tail: number;
  /** Fraction of length where the body ends (billfish bill begins). */
  bodyEnd: number;
  /** Body half-height as a fraction of H/2. */
  half: number;
  /** Centre line as a fraction of H. */
  cy: number;
  profile: (u: number) => number;
  tailStyle: TailStyle;
  /** Eye position along the body (0 = peduncle, 1 = snout). */
  eye: number;
}

const sinP = (u: number, a: number, b: number) => Math.sin(Math.PI * (a + b * u));

const SHAPES: Record<BodyShape, ShapeSpec> = {
  fusiform: {
    tail: 0.2, bodyEnd: 1, half: 0.8, cy: 0.52, tailStyle: 'fork', eye: 0.84,
    profile: (u) => Math.pow(Math.max(0.3, sinP(u, 0.06, 0.9)), 0.7),
  },
  deep: {
    tail: 0.18, bodyEnd: 1, half: 0.86, cy: 0.5, tailStyle: 'fork', eye: 0.8,
    profile: (u) => Math.pow(Math.max(0.3, sinP(u, 0.04, 0.92)), 0.45),
  },
  elongate: {
    tail: 0.12, bodyEnd: 1, half: 0.9, cy: 0.5, tailStyle: 'round', eye: 0.86,
    profile: (u) => (u > 0.8 ? Math.max(0.35, 1 - (u - 0.8) * 3.2) : Math.min(1, 0.55 + u * 4)),
  },
  shark: {
    tail: 0.24, bodyEnd: 1, half: 0.5, cy: 0.56, tailStyle: 'hetero', eye: 0.9,
    profile: (u) => Math.pow(Math.max(0.25, sinP(u, 0.04, 0.92)), 0.6),
  },
  hammerhead: {
    tail: 0.24, bodyEnd: 0.95, half: 0.48, cy: 0.56, tailStyle: 'hetero', eye: 0.97,
    profile: (u) => Math.pow(Math.max(0.3, sinP(u, 0.04, 0.85)), 0.6),
  },
  billfish: {
    tail: 0.16, bodyEnd: 0.76, half: 0.56, cy: 0.6, tailStyle: 'lunate', eye: 0.9,
    profile: (u) => Math.pow(Math.max(0.3, sinP(u, 0.05, 0.85)), 0.6),
  },
  lionfish: {
    tail: 0.2, bodyEnd: 1, half: 0.5, cy: 0.58, tailStyle: 'round', eye: 0.82,
    profile: (u) => Math.pow(Math.max(0.35, sinP(u, 0.05, 0.9)), 0.5),
  },
  manatee: {
    tail: 0.2, bodyEnd: 1, half: 0.9, cy: 0.5, tailStyle: 'paddle', eye: 0.88,
    profile: (u) => Math.pow(Math.max(0.4, sinP(u, 0.08, 0.88)), 0.4),
  },
};

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function generateFishSprite(look: FishLook, length: number, height: number, seed = 1): PixelSprite {
  const W = Math.max(4, Math.round(length));
  const H = Math.max(2, Math.round(height));
  const spec = SHAPES[look.shape];
  const C = {
    body: PALETTE[look.colors.body],
    belly: PALETTE[look.colors.belly],
    fin: PALETTE[look.colors.fin],
    accent: PALETTE[look.colors.accent],
  };
  const px: (string | null)[] = new Array<string | null>(W * H).fill(null);
  const set = (x: number, y: number, c: string) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    px[y * W + x] = c;
  };
  const cyF = spec.cy * H;
  const half = (spec.half * H) / 2;
  const tailEnd = spec.tail;
  const bodyEnd = spec.bodyEnd;
  const hhAt = (u: number) => half * spec.profile(Math.min(1, Math.max(0, u)));
  const xToU = (t: number) => (t - tailEnd) / (bodyEnd - tailEnd);
  const uToX = (u: number) => Math.min(W - 1, Math.round((tailEnd + u * (bodyEnd - tailEnd)) * W - 0.5));
  const pedHalf = hhAt(0);

  for (let x = 0; x < W; x++) {
    const t = (x + 0.5) / W;
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - cyF;
      const ady = Math.abs(dy);
      if (t >= tailEnd && t <= bodyEnd) {
        const u = xToU(t);
        const hh = Math.max(0.5, hhAt(u));
        if (ady <= hh) {
          let c: string = dy > hh * 0.3 ? C.belly : C.body;
          c = applyPattern(look, c, C.accent, C.belly, x, y, u, dy, hh, H, seed);
          set(x, y, c);
        }
      } else if (t < tailEnd) {
        const tt = 1 - t / tailEnd; // 1 at tip, 0 at peduncle
        let on = false;
        switch (spec.tailStyle) {
          case 'fork': {
            const span = pedHalf + (half * 1.05 - pedHalf) * tt;
            on = ady <= span && ady >= span * 0.6 * tt * tt;
            break;
          }
          case 'lunate': {
            const span = pedHalf + (half * 1.4 - pedHalf) * tt;
            on = ady <= span && ady >= span * 0.85 * tt;
            break;
          }
          case 'round': {
            const span = pedHalf + (half * 0.85 - pedHalf) * Math.sqrt(tt);
            on = ady <= span;
            break;
          }
          case 'hetero': {
            const up = pedHalf + (cyF - 0.5 - pedHalf) * tt;
            const down = pedHalf * 0.8 + half * 0.9 * tt * (1 - tt) * 2;
            on = dy >= -up && dy <= down;
            break;
          }
          case 'paddle': {
            const cx = tailEnd * W * 0.45;
            const r = Math.min(tailEnd * W * 0.55, half * 0.9);
            const ddx = x + 0.5 - cx;
            on = ddx * ddx + dy * dy <= r * r || ady <= pedHalf * 0.8;
            break;
          }
        }
        if (on) set(x, y, look.shape === 'manatee' ? C.body : C.fin);
      }
    }
  }

  // Bills, fins and other silhouettes.
  if (look.shape === 'billfish') {
    const by = Math.round(cyF - 0.5 - hhAt(1) * 0.2);
    for (let x = Math.round(bodyEnd * W) - 1; x < W; x++) set(x, by, C.fin);
    // Tall crescent dorsal "sail".
    for (let u = 0.05; u <= 0.32; u += 0.5 / W) {
      const x = uToX(u);
      const top = cyF - hhAt(u);
      const rise = Math.sin(((u - 0.05) / 0.27) * Math.PI) * (top - 0.5);
      for (let y = Math.floor(top - rise); y < top; y++) set(x, y, C.fin);
    }
  }
  if (look.shape === 'shark' || look.shape === 'hammerhead') {
    for (let u = 0.4; u <= 0.62; u += 0.5 / W) {
      const x = uToX(u);
      const top = cyF - hhAt(u);
      const k = u < 0.48 ? (u - 0.4) / 0.08 : (0.62 - u) / 0.14;
      for (let y = Math.floor(top - k * (top - 0.5)); y < top; y++) set(x, y, C.fin);
    }
    for (let u = 0.6; u <= 0.76; u += 0.5 / W) {
      const x = uToX(u);
      const bot = cyF + hhAt(u);
      const k = (0.76 - u) / 0.16;
      for (let y = Math.ceil(bot); y < bot + k * (H - bot); y++) set(x, y, C.fin);
    }
  }
  if (look.shape === 'hammerhead') {
    const x0 = Math.round(bodyEnd * W) - 2;
    for (let x = x0; x < W; x++) {
      for (let y = Math.round(cyF - H * 0.46); y <= Math.round(cyF + H * 0.12); y++) set(x, y, C.body);
    }
  }
  if (look.shape === 'lionfish') {
    // Venomous dorsal spines and fan-like pectoral fins.
    for (let u = 0.15; u <= 0.8; u += 2.2 / (W * (bodyEnd - tailEnd))) {
      const x = uToX(u);
      const top = Math.floor(cyF - hhAt(u));
      for (let y = 0; y < top; y++) set(x, y, (y & 1) === 0 ? C.accent : C.fin);
    }
    const ox = uToX(0.72);
    const oy = Math.round(cyF);
    for (let k = 0; k < 4; k++) {
      const ex = ox - 4 - k * 2;
      const ey = H - 1 - (k === 3 ? 1 : 0);
      line(ox, oy, ex, ey, (x, y) => set(x, y, k % 2 ? C.fin : C.accent));
    }
  }
  if (look.shape === 'manatee') {
    const fx = uToX(0.74);
    const fy = Math.round(cyF + hhAt(0.74) * 0.6);
    for (let y = fy; y < Math.min(H, fy + 3); y++) set(fx - (y - fy), y, C.fin);
  }
  if (['fusiform', 'deep', 'elongate'].includes(look.shape) && W >= 10) {
    // Small dorsal fin peeking above the back.
    for (let u = 0.35; u <= 0.65; u += 0.5 / W) {
      const x = uToX(u);
      const top = cyF - hhAt(u);
      const rise = Math.sin(((u - 0.35) / 0.3) * Math.PI) * Math.min(2.5, H * 0.14);
      for (let y = Math.floor(top - rise); y < Math.floor(top); y++) set(x, y, C.fin);
    }
  }

  // Eye.
  const ex = uToX(spec.eye);
  const ey = Math.max(0, Math.round(cyF - 0.5 - hhAt(spec.eye) * (look.shape === 'hammerhead' ? 1.6 : 0.35)));
  set(ex, ey, PALETTE.ink);
  if (W >= 24 && H >= 8) set(ex - 1, ey, PALETTE.white);

  // Dark rim for readability on busy backgrounds.
  if (W >= 12) {
    const rim: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (px[y * W + x] === null) continue;
        const edge =
          x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
          px[y * W + x - 1] === null || px[y * W + x + 1] === null ||
          px[(y - 1) * W + x] === null || px[(y + 1) * W + x] === null;
        if (edge) rim.push(y * W + x);
      }
    }
    for (const i of rim) {
      const c = px[i];
      if (c && c !== PALETTE.ink) px[i] = mixHex(c, PALETTE.ink, 0.5);
    }
  }

  // Frame 2: flick the tail one pixel.
  const f2 = px.slice();
  const flick = Math.max(1, Math.round(tailEnd * W * 0.7));
  for (let x = 0; x < flick; x++) {
    for (let y = H - 1; y >= 0; y--) f2[y * W + x] = y > 0 ? (px[(y - 1) * W + x] ?? null) : null;
  }

  const glow: PixelSprite['glow'] = [];
  if (look.glow) {
    const g = PALETTE[look.glow];
    for (let u = 0.1; u <= 0.9; u += 2 / (W * (bodyEnd - tailEnd))) {
      const x = uToX(u);
      const y = Math.min(H - 1, Math.floor(cyF + hhAt(u) - 0.5));
      if (px[y * W + x] !== null) glow.push({ x, y, color: g });
    }
  }
  return { w: W, h: H, frames: [px, f2], glow };
}

function applyPattern(
  look: FishLook, c: string, accent: string, belly: string,
  x: number, y: number, u: number, dy: number, hh: number, H: number, seed: number,
): string {
  switch (look.pattern) {
    case 'bars': {
      const n = look.shape === 'deep' ? 5 : 4;
      return u > 0.08 && u < 0.86 && Math.floor(u * n * 2) % 2 === 1 && dy < hh * 0.6 ? accent : c;
    }
    case 'stripe':
      return u < 0.94 && (H <= 3 ? y === 0 : dy >= -1 && dy < 0.25) ? accent : c;
    case 'stripes-thin':
      return u > 0.04 && u < 0.92 && x % 2 === 0 ? accent : c;
    case 'spots':
      return hash2(x, y, seed) < 0.16 ? accent : c;
    case 'mottled': {
      const n = hash2(Math.floor(x / 3), Math.floor(y / 3), seed) * 0.7 + hash2(x, y, seed + 1) * 0.3;
      return n > 0.62 ? accent : n < 0.2 ? belly : c;
    }
    case 'eyespot': {
      const r = Math.max(1, H * 0.16);
      const du = (u - 0.06) * 40;
      return du * du + dy * dy <= r * r ? accent : c;
    }
    case 'saddle':
      return u > 0.3 && u < 0.62 && dy < -hh * 0.2 ? accent : c;
    default:
      return c;
  }
}

/** Bresenham line. */
function line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 256; i++) {
    plot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
