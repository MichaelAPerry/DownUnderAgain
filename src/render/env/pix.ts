/**
 * Low-level helpers for baking environment art into pixel buffers:
 * palette colours as packed RGBA words, integer hashing, value noise,
 * ordered (Bayer) dithering and a clipped world-space pixel buffer.
 * Everything is deterministic so baked chunks never flicker or seam.
 */
import { PALETTE, hexToRgb, mixHex } from '../../data/palette';
import type { PaletteKey } from '../../data/palette';

export const P = PALETTE;

const wordCache = new Map<string, number>();

/** Packed little-endian RGBA word for an opaque hex colour (ImageData layout). */
export function word(hex: string, alpha = 1): number {
  const key = alpha === 1 ? hex : `${hex}/${alpha}`;
  let v = wordCache.get(key);
  if (v === undefined) {
    const [r, g, b] = hexToRgb(hex);
    const a = Math.round(alpha * 255) & 255;
    v = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    wordCache.set(key, v);
  }
  return v;
}

type Col = PaletteKey | string;
const hexOf = (c: Col): string => (c.startsWith('#') ? c : P[c as PaletteKey]);

/** A palette colour or a limited derived blend of two palette colours. */
export function hx(a: Col, b?: Col, t = 0): string {
  return b === undefined || t === 0 ? hexOf(a) : mixHex(hexOf(a), hexOf(b), t);
}

/** Packed word for a palette colour / blend. */
export function w(a: Col, b?: Col, t = 0): number {
  return word(hx(a, b, t));
}

/** Build a light-to-dark ramp of packed words. Entries: key or [a, b, t]. */
export function ramp(...stops: (Col | [Col, Col, number])[]): number[] {
  return stops.map((s) => (Array.isArray(s) ? w(s[0], s[1], s[2]) : w(s)));
}

/** Integer hash of up to three ints -> [0, 1). */
export function ih(x: number, y = 0, s = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((s | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 1-D value noise in [-1, 1]. */
export function vnoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = ih(i, seed, 77) * 2 - 1;
  const b = ih(i + 1, seed, 77) * 2 - 1;
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** Ordered-dither threshold in (0,1) for a pixel. */
export function bayer(x: number, y: number): number {
  return BAYER4[((y & 3) << 2) | (x & 3)] ?? 0.5;
}

/**
 * Pick an index from a continuous level with dithered transitions: most of
 * each band stays solid, only the edge between bands is checkered.
 */
export function ditherLevel(level: number, x: number, y: number, sharp = 2.5): number {
  const i = Math.floor(level);
  const f = Math.min(1, Math.max(0, (level - i - 0.5) * sharp + 0.5));
  return f > bayer(x, y) ? i + 1 : i;
}

/** A world-space RGBA pixel buffer; all writes are clipped. */
export class Buf {
  readonly data: Uint32Array<ArrayBuffer>;
  x0 = 0;
  y0 = 0;
  used = false;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint32Array(w * h);
  }

  reset(x0: number, y0: number): void {
    this.x0 = x0;
    this.y0 = y0;
    this.data.fill(0);
    this.used = false;
  }

  /** True if the world rect [x, x+w) x [y, y+h) overlaps this buffer. */
  hits(x: number, y: number, w: number, h: number): boolean {
    return x < this.x0 + this.w && x + w > this.x0 && y < this.y0 + this.h && y + h > this.y0;
  }

  set(x: number, y: number, c: number): void {
    const lx = Math.floor(x) - this.x0;
    const ly = Math.floor(y) - this.y0;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return;
    this.data[ly * this.w + lx] = c;
    this.used = true;
  }

  get(x: number, y: number): number {
    const lx = Math.floor(x) - this.x0;
    const ly = Math.floor(y) - this.y0;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return 0;
    return this.data[ly * this.w + lx] ?? 0;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    const xa = Math.max(Math.floor(x), this.x0);
    const ya = Math.max(Math.floor(y), this.y0);
    const xb = Math.min(Math.floor(x + w), this.x0 + this.w);
    const yb = Math.min(Math.floor(y + h), this.y0 + this.h);
    if (xa >= xb || ya >= yb) return;
    for (let yy = ya; yy < yb; yy++) {
      const row = (yy - this.y0) * this.w;
      this.data.fill(c, row + xa - this.x0, row + xb - this.x0);
    }
    this.used = true;
  }
}

/**
 * A small binary mask in world space, used to build a prop's silhouette
 * before shading it with light from the top-left.
 */
export class Mask {
  readonly bits: Uint8Array;
  constructor(readonly x0: number, readonly y0: number, readonly w: number, readonly h: number) {
    this.bits = new Uint8Array(w * h);
  }

  set(x: number, y: number, v = 1): void {
    const lx = Math.floor(x) - this.x0;
    const ly = Math.floor(y) - this.y0;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return;
    this.bits[ly * this.w + lx] = v;
  }

  at(x: number, y: number): number {
    const lx = x - this.x0;
    const ly = y - this.y0;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return 0;
    return this.bits[ly * this.w + lx] ?? 0;
  }

  /** Stamp a filled disc (r=0 -> 1px, r=0.5 -> 2x2, r=1 -> plus+). */
  disc(cx: number, cy: number, r: number, v = 1): void {
    if (r <= 0.6) {
      this.set(cx, cy, v);
      if (r >= 0.5) {
        this.set(cx + 1, cy, v);
        this.set(cx, cy + 1, v);
        this.set(cx + 1, cy + 1, v);
      }
      return;
    }
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.3) this.set(cx + dx, cy + dy, v);
  }

  /** Thick line between two points with thickness tapering r0 -> r1. */
  line(x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, v = 1): void {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 1.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.disc(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), r0 + (r1 - r0) * t, v);
    }
  }

  /**
   * Shade the mask into the buffer: top/left edges lit, bottom/right edges in
   * shadow, a darker outline on the underside. ramp: [lit, light, mid, dark, outline].
   */
  shade(buf: Buf, rp: readonly number[], noise = 0, seed = 0): void {
    const [lit = 0, light = 0, mid = 0, dark = 0, line = 0] = rp;
    for (let ly = 0; ly < this.h; ly++) {
      for (let lx = 0; lx < this.w; lx++) {
        if (!this.bits[ly * this.w + lx]) continue;
        const x = lx + this.x0;
        const y = ly + this.y0;
        const up = this.at(x, y - 1);
        const dn = this.at(x, y + 1);
        const lf = this.at(x - 1, y);
        const rt = this.at(x + 1, y);
        let c: number;
        if (!dn || (!rt && !this.at(x + 1, y + 1))) c = line;
        else if (!up) c = lit;
        else if (!lf || !this.at(x - 1, y - 1)) c = light;
        else if (!rt || !this.at(x + 1, y + 2)) c = dark;
        else c = noise > 0 && ih(x, y, seed) < noise ? light : mid;
        buf.set(x, y, c);
      }
    }
  }
}
