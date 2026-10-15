/**
 * Lazily baked, LRU-evicted canvas chunks. Each layer has a baker that
 * paints one TILE_W x TILE_H chunk of its own coordinate space into a pixel
 * buffer; chunks that paint nothing cost no canvas. Bakes are deterministic,
 * so an evicted chunk re-bakes identically.
 */
import { Buf } from './pix';

export const TILE_W = 256;
export const TILE_H = 128;

export type Baker = (buf: Buf) => void;

/** Layers in draw order. */
export const Layer = { Far: 0, Near: 1, Back: 2, Front: 3 } as const;
export type Layer = (typeof Layer)[keyof typeof Layer];

export class TileCache {
  private readonly map = new Map<number, HTMLCanvasElement | null>();
  private readonly pool: HTMLCanvasElement[] = [];
  private readonly buf = new Buf(TILE_W, TILE_H);
  private img: ImageData | null = null;
  private canvases = 0;
  /** Bakes performed so far this frame (visible chunks always bake). */
  bakes = 0;
  totalBakes = 0;
  bakeMs = 0;

  constructor(private readonly bakers: readonly Baker[], private readonly maxCanvases = 56, private readonly maxEntries = 768) {}

  private static key(layer: number, tx: number, ty: number): number {
    return ((layer * 1024 + (tx + 256)) * 1024 + (ty + 256)) | 0;
  }

  has(layer: Layer, tx: number, ty: number): boolean {
    return this.map.has(TileCache.key(layer, tx, ty));
  }

  /** The chunk canvas (baking it on first use), or null if it is empty. */
  get(layer: Layer, tx: number, ty: number): HTMLCanvasElement | null {
    const k = TileCache.key(layer, tx, ty);
    const hit = this.map.get(k);
    if (hit !== undefined) {
      // Refresh LRU position.
      this.map.delete(k);
      this.map.set(k, hit);
      return hit;
    }
    const c = this.bake(layer, tx, ty);
    this.map.set(k, c);
    if (c) this.canvases++;
    this.evict();
    return c;
  }

  get size(): { canvases: number; entries: number } {
    return { canvases: this.canvases, entries: this.map.size };
  }

  private bake(layer: Layer, tx: number, ty: number): HTMLCanvasElement | null {
    const t0 = performance.now();
    this.bakes++;
    this.totalBakes++;
    const buf = this.buf;
    buf.reset(tx * TILE_W, ty * TILE_H);
    this.bakers[layer]?.(buf);
    let out: HTMLCanvasElement | null = null;
    if (buf.used) {
      out = this.pool.pop() ?? document.createElement('canvas');
      out.width = TILE_W;
      out.height = TILE_H;
      const ctx = out.getContext('2d');
      if (ctx) {
        this.img ??= new ImageData(new Uint8ClampedArray(buf.data.buffer), TILE_W, TILE_H);
        ctx.putImageData(this.img, 0, 0);
      }
    }
    this.bakeMs += performance.now() - t0;
    return out;
  }

  private evict(): void {
    if (this.canvases <= this.maxCanvases && this.map.size <= this.maxEntries) return;
    for (const [k, c] of this.map) {
      if (this.canvases <= this.maxCanvases && this.map.size <= this.maxEntries) break;
      this.map.delete(k);
      if (c) {
        this.canvases--;
        if (this.pool.length < 8) this.pool.push(c);
      }
    }
  }
}
