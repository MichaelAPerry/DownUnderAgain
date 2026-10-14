/**
 * Uniform-grid broadphase. Rebuilt every tick (cheap at our entity counts);
 * queries return candidates whose cell overlaps the query circle.
 */
export interface Positioned {
  x: number;
  y: number;
}

export class SpatialHash<T extends Positioned> {
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];

  constructor(private readonly cellSize: number) {}

  private key(cx: number, cy: number): number {
    // World is < 32768 cells per axis; pack into one int.
    return ((cx + 16384) << 15) | (cy + 16384);
  }

  clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.pool.push(bucket);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = this.pool.pop() ?? [];
      this.cells.set(k, bucket);
    }
    bucket.push(item);
  }

  /** Push every item within `radius` of (x,y) into `out` (exact distance check). */
  query(x: number, y: number, radius: number, out: T[]): T[] {
    const cs = this.cellSize;
    const x0 = Math.floor((x - radius) / cs);
    const x1 = Math.floor((x + radius) / cs);
    const y0 = Math.floor((y - radius) / cs);
    const y1 = Math.floor((y + radius) / cs);
    const r2 = radius * radius;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const it of bucket) {
          const dx = it.x - x;
          const dy = it.y - y;
          if (dx * dx + dy * dy <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}
