/** A palette-coloured pixel image with animation frames; pure data, no DOM. */
export interface PixelSprite {
  w: number;
  h: number;
  /** frames[f][y * w + x] = hex colour or null (transparent). */
  frames: (string | null)[][];
  /** Pixels drawn again above the deep-sea darkness (bioluminescence). */
  glow: { x: number; y: number; color: string }[];
}

/** Build a sprite from ASCII rows and a char->colour legend ('.' = transparent). */
export function fromRows(frames: readonly (readonly string[])[], legend: Readonly<Record<string, string>>): PixelSprite {
  const first = frames[0];
  if (!first || first.length === 0) throw new Error('empty sprite');
  const h = first.length;
  const w = first[0]?.length ?? 0;
  const out: (string | null)[][] = [];
  for (const rows of frames) {
    if (rows.length !== h) throw new Error('frame height mismatch');
    const px: (string | null)[] = [];
    for (const row of rows) {
      if (row.length !== w) throw new Error(`row width mismatch: "${row}"`);
      for (const ch of row) px.push(ch === '.' ? null : (legend[ch] ?? null));
    }
    out.push(px);
  }
  return { w, h, frames: out, glow: [] };
}
