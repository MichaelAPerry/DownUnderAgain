/** Bakes PixelSprites into canvases once and caches them by species look. */
import type { SpeciesDef } from '../data/schema';
import { hashString } from '../engine/rng';
import { generateFishSprite } from './fishSprite';
import { foodSprite } from './foodSprites';
import type { PixelSprite } from './pixelSprite';
import { hexToRgb } from '../data/palette';

export interface BakedSprite {
  w: number;
  h: number;
  /** Facing right. */
  frames: HTMLCanvasElement[];
  /** Pre-mirrored, facing left. */
  framesL: HTMLCanvasElement[];
  glow: PixelSprite['glow'];
}

const cache = new Map<string, BakedSprite>();

export function pixelSpriteFor(def: SpeciesDef): PixelSprite {
  if (def.look) return generateFishSprite(def.look, def.length, def.height, hashString(def.id));
  if (def.sprite) return foodSprite(def.sprite);
  throw new Error(`${def.id} has no sprite`);
}

export function bake(sp: PixelSprite): BakedSprite {
  const frames = sp.frames.map((px) => {
    const c = document.createElement('canvas');
    c.width = sp.w;
    c.height = sp.h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    const img = ctx.createImageData(sp.w, sp.h);
    px.forEach((hex, i) => {
      if (!hex) return;
      const [r, g, b] = hexToRgb(hex);
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    });
    ctx.putImageData(img, 0, 0);
    return c;
  });
  const framesL = frames.map((f) => {
    const c = document.createElement('canvas');
    c.width = sp.w;
    c.height = sp.h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.translate(sp.w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(f, 0, 0);
    return c;
  });
  return { w: sp.w, h: sp.h, frames, framesL, glow: sp.glow };
}

/** Draw a sprite centred at (cx, cy) on the low-res canvas. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: BakedSprite, frame: number, cx: number, cy: number, facing: 1 | -1): void {
  const set = facing === 1 ? s.frames : s.framesL;
  const img = set[frame % set.length];
  if (img) ctx.drawImage(img, Math.round(cx - s.w / 2), Math.round(cy - s.h / 2));
}

export function spriteFor(def: SpeciesDef): BakedSprite {
  const key = `${def.id}:${def.length}x${def.height}:${def.look ? JSON.stringify(def.look) : (def.sprite ?? '')}`;
  let s = cache.get(key);
  if (!s) {
    s = bake(pixelSpriteFor(def));
    cache.set(key, s);
  }
  return s;
}
