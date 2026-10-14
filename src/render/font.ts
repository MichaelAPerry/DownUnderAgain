/** Draws text with the 5x7 bitmap font onto the low-res canvas. */
import { GLYPHS, GLYPH_H, GLYPH_W } from './fontGlyphs';

export const CHAR_W = GLYPH_W + 1;
export const LINE_H = GLYPH_H + 2;

const CHARS = Object.keys(GLYPHS);
const INDEX = new Map(CHARS.map((c, i) => [c, i]));
const atlases = new Map<string, HTMLCanvasElement>();

function atlas(color: string): HTMLCanvasElement {
  let a = atlases.get(color);
  if (a) return a;
  a = document.createElement('canvas');
  a.width = CHARS.length * GLYPH_W;
  a.height = GLYPH_H;
  const ctx = a.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.fillStyle = color;
  CHARS.forEach((ch, i) => {
    const rows = GLYPHS[ch] ?? [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(i * GLYPH_W + x, y, 1, 1);
    });
  });
  atlases.set(color, a);
  return a;
}

export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * CHAR_W - 1;
}

export interface TextOpts {
  align?: 'left' | 'center' | 'right';
  shadow?: string;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, opts: TextOpts = {}): void {
  const t = text.toUpperCase();
  let sx = Math.round(x);
  if (opts.align === 'center') sx = Math.round(x - textWidth(t) / 2);
  else if (opts.align === 'right') sx = Math.round(x - textWidth(t));
  const sy = Math.round(y);
  if (opts.shadow) drawRun(ctx, t, sx + 1, sy + 1, opts.shadow);
  drawRun(ctx, t, sx, sy, color);
}

function drawRun(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, color: string): void {
  const a = atlas(color);
  for (let i = 0; i < t.length; i++) {
    const idx = INDEX.get(t[i] as string) ?? INDEX.get('?');
    if (idx === undefined || t[i] === ' ') continue;
    ctx.drawImage(a, idx * GLYPH_W, 0, GLYPH_W, GLYPH_H, x + i * CHAR_W, y, GLYPH_W, GLYPH_H);
  }
}
