/** Tiny raster toolkit for procedural pixel art: a toned canvas, polygon fill, lines and hashing. */
import type { Ramp } from './ramp';
import { DEEP, OUT, SHD } from './ramp';

export const EMPTY = 0;
export const BODY = 1; // gets a selective outline
export const FIN = 2; // translucent, softer edge
export const DETAIL = 3; // fixed colours (eyes, teeth...), never re-shaded

/**
 * A canvas whose pixels are (ramp, tone) pairs rather than final colours, so
 * patterns and outlines can re-shade them while staying on their ramps.
 */
export class ToneCanvas {
  readonly kind: Uint8Array;
  readonly tone: Int8Array;
  readonly ramp: (Ramp | null)[];
  readonly fixed: (string | null)[];
  constructor(readonly w: number, readonly h: number) {
    this.kind = new Uint8Array(w * h);
    this.tone = new Int8Array(w * h);
    this.ramp = new Array<Ramp | null>(w * h).fill(null);
    this.fixed = new Array<string | null>(w * h).fill(null);
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  k(x: number, y: number): number {
    return this.inside(x, y) ? (this.kind[y * this.w + x] as number) : EMPTY;
  }
  put(x: number, y: number, kind: number, ramp: Ramp, tone: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.kind[i] = kind;
    this.ramp[i] = ramp;
    this.tone[i] = Math.max(0, Math.min(5, tone));
    this.fixed[i] = null;
  }
  /** Only paints transparent pixels. */
  under(x: number, y: number, kind: number, ramp: Ramp, tone: number): void {
    if (this.k(x, y) === EMPTY) this.put(x, y, kind, ramp, tone);
  }
  fix(x: number, y: number, color: string): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.kind[i] = DETAIL;
    this.fixed[i] = color;
  }
  /** Re-tone an existing ramp pixel (no-op on empty/fixed pixels). */
  setTone(x: number, y: number, tone: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    if (this.kind[i] === EMPTY || this.fixed[i]) return;
    this.tone[i] = Math.max(0, Math.min(5, tone));
  }
  getTone(x: number, y: number): number {
    return this.inside(x, y) ? (this.tone[y * this.w + x] as number) : -1;
  }
  getRamp(x: number, y: number): Ramp | null {
    return this.inside(x, y) ? (this.ramp[y * this.w + x] ?? null) : null;
  }
  erase(x: number, y: number): void {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.kind[i] = EMPTY;
    this.ramp[i] = null;
    this.fixed[i] = null;
  }

  /**
   * Selective outline: body edge pixels take a darker tone of their own ramp,
   * darkest where they face down or back (away from the light), a step
   * lighter on top. Fins get a softer shadow edge so they stay translucent.
   */
  selout(heavy: boolean): void {
    const { w, h } = this;
    const edits: [number, number][] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const kd = this.kind[i];
        if (kd === EMPTY || kd === DETAIL) continue;
        const up = this.k(x, y - 1) === EMPTY;
        const dn = this.k(x, y + 1) === EMPTY;
        const lf = this.k(x - 1, y) === EMPTY;
        const rt = this.k(x + 1, y) === EMPTY;
        if (!(up || dn || lf || rt)) continue;
        const t = this.tone[i] as number;
        let nt: number;
        if (kd === FIN) nt = Math.min(t, (dn && !up) || (lf && !rt) ? SHD : t);
        else if (!heavy) nt = dn ? Math.min(t, SHD) : t;
        else nt = dn || lf ? OUT : DEEP;
        edits.push([i, nt]);
      }
    }
    for (const [i, t] of edits) this.tone[i] = t;
  }

  colors(): (string | null)[] {
    const out = new Array<string | null>(this.w * this.h).fill(null);
    for (let i = 0; i < out.length; i++) {
      if (this.kind[i] === EMPTY) continue;
      out[i] = this.fixed[i] ?? this.ramp[i]?.[this.tone[i] as number] ?? null;
    }
    return out;
  }
}

/** Calls plot for every pixel whose centre lies inside the polygon (even-odd rule). */
export function fillPoly(pts: readonly (readonly [number, number])[], plot: (x: number, y: number) => void): void {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  for (let py = Math.floor(y0); py <= Math.ceil(y1); py++) {
    const cy = py + 0.5;
    for (let px = Math.floor(x0); px <= Math.ceil(x1); px++) {
      const cx = px + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i] as readonly [number, number];
        const [xj, yj] = pts[j] as readonly [number, number];
        if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) plot(px, py);
    }
  }
}

/** Bresenham line. */
export function line(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number, i: number) => void): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 512; i++) {
    plot(x, y, i);
    if (x === tx && y === ty) break;
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

/** Deterministic 2D hash in [0,1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on a coarse grid (for mottling and blotches). */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
