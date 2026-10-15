/**
 * Renders every creature sprite (both animation frames) to a PNG contact
 * sheet for art review: `npm run sprites` -> docs/art/sprites.png
 */
import { it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FLORIDA } from '../src/data/regions/florida';
import { hexToRgb, PALETTE } from '../src/data/palette';
import { generateFishSprite } from '../src/render/fishSprite';
import { foodSprite } from '../src/render/foodSprites';
import type { PixelSprite } from '../src/render/pixelSprite';
import { encodePng } from './png';

const OUT = process.env.SPRITE_SHEET ?? 'docs/art/sprites.png';
const SCALE = Number(process.env.SPRITE_SCALE ?? 4);

it('renders the sprite sheet', () => {
  const sprites: PixelSprite[] = FLORIDA.all.map((d) =>
    d.look ? generateFishSprite(d.look, d.length, d.height) : foodSprite(d.sprite ?? 'algae'),
  );
  const gap = 6 * SCALE;
  const colW = Math.max(...sprites.map((s) => s.w)) * SCALE * 2 + gap * 3;
  const cols = 2;
  const rows = Math.ceil(sprites.length / cols);
  const rowH = sprites.map((s) => s.h * SCALE + gap);
  const H = Array.from({ length: rows }, (_, r) => Math.max(rowH[r * 2] ?? 0, rowH[r * 2 + 1] ?? 0)).reduce((a, b) => a + b, gap);
  const W = colW * cols;
  const img = new Uint8Array(W * H * 3);
  const bgA = hexToRgb(PALETTE.blue);
  const bgB = hexToRgb(PALETTE.teal);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set(Math.floor(x / colW) % 2 ? bgB : bgA, (y * W + x) * 3);
  let y0 = gap;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const s = sprites[r * cols + c];
      if (!s) continue;
      s.frames.forEach((px, f) => {
        const ox = c * colW + gap + f * (s.w * SCALE + gap);
        for (let y = 0; y < s.h; y++)
          for (let x = 0; x < s.w; x++) {
            const hex = px[y * s.w + x];
            if (!hex) continue;
            const rgb = hexToRgb(hex);
            for (let a = 0; a < SCALE; a++)
              for (let b = 0; b < SCALE; b++) img.set(rgb, ((y0 + y * SCALE + b) * W + ox + x * SCALE + a) * 3);
          }
      });
    }
    y0 += Math.max(rowH[r * 2] ?? 0, rowH[r * 2 + 1] ?? 0);
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, encodePng(W, H, img));
});
