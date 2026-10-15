/**
 * Title-screen layer drawn on the canvas over the attract-mode reef: a
 * shaded pixel logo with bobbing letters and a sweeping shimmer, the
 * "press any key" prompt, and big creatures swimming past in the foreground.
 */
import { PALETTE as P } from '../data/palette';
import type { SpeciesDef } from '../data/schema';
import { VIEW_H, VIEW_W } from '../engine/camera';
import { GLYPHS, GLYPH_H, GLYPH_W } from './fontGlyphs';
import { drawText } from './font';
import { drawSprite, spriteFor } from './spriteCache';

/** Colour by glyph row (top to bottom), giving each letter a lit-from-above ramp. */
type Ramp = readonly string[];
const GOLD: Ramp = [P.cream, P.yellow, P.yellow, P.gold, P.gold, P.orange, P.rust];
const AQUA: Ramp = [P.white, P.cyan, P.cyan, P.sky, P.sky, P.blue, P.navy];
const SHINE: Ramp = [P.white, P.white, P.cream, P.cream, P.yellow, P.yellow, P.gold];
const WHITE: Ramp = [P.white, P.white, P.white, P.cream, P.cream, P.silver, P.silver];

const cache = new Map<string, HTMLCanvasElement>();

/** A single glyph at integer scale with a 1-px (scaled) ink outline. */
function glyph(ch: string, scale: number, ramp: Ramp): HTMLCanvasElement | null {
  const rows = GLYPHS[ch];
  if (!rows) return null;
  const key = `${ch}|${scale}|${ramp.join()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pad = 1;
  const c = document.createElement('canvas');
  c.width = (GLYPH_W + pad * 2) * scale;
  c.height = (GLYPH_H + pad * 2) * scale;
  const g = c.getContext('2d');
  if (!g) return null;
  const on = (x: number, y: number) => (rows[y] ?? '')[x] === '#';
  // Outline: any empty cell touching a filled one (8-neighbour).
  g.fillStyle = P.ink;
  for (let y = -1; y <= GLYPH_H; y++) {
    for (let x = -1; x <= GLYPH_W; x++) {
      if (on(x, y)) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (on(x + dx, y + dy)) edge = true;
      if (edge) g.fillRect((x + pad) * scale, (y + pad) * scale, scale, scale);
    }
  }
  for (let y = 0; y < GLYPH_H; y++) {
    g.fillStyle = ramp[y] ?? ramp[ramp.length - 1] ?? P.white;
    for (let x = 0; x < GLYPH_W; x++) if (on(x, y)) g.fillRect((x + pad) * scale, (y + pad) * scale, scale, scale);
  }
  cache.set(key, c);
  return c;
}

interface WordOpts {
  scale: number;
  ramp: Ramp;
  /** Per-letter vertical bob amplitude in px. */
  bob: number;
  /** x position (px) of the shimmer band, or null. */
  shine: number | null;
}

function word(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, time: number, o: WordOpts): void {
  const adv = (GLYPH_W + 1) * o.scale;
  const width = text.length * adv - o.scale;
  const x0 = Math.round(cx - width / 2) - o.scale; // glyph canvases carry a 1-cell pad
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === ' ') continue;
    const x = x0 + i * adv;
    const y = Math.round(top - o.scale + Math.sin(time * 2.4 - i * 0.55) * o.bob);
    const shining = o.shine !== null && Math.abs(x + adv / 2 - o.shine) < adv * 0.6;
    const img = glyph(ch, o.scale, shining ? SHINE : o.ramp);
    const shadow = glyph(ch, o.scale, [P.navy]);
    if (shadow) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(shadow, x + o.scale, y + o.scale * 2);
      ctx.globalAlpha = 1;
    }
    if (img) ctx.drawImage(img, x, y);
  }
}

interface Swimmer {
  def: SpeciesDef;
  x: number;
  y: number;
  speed: number;
  facing: 1 | -1;
}

export class TitleScene {
  private swimmer: Swimmer | null = null;
  private nextSwimmer = 3;

  constructor(private readonly cast: readonly SpeciesDef[]) {}

  draw(ctx: CanvasRenderingContext2D, time: number, dt: number, showPrompt: boolean): void {
    this.drawSwimmer(ctx, time, dt);
    const period = 5;
    const phase = (time % period) / period;
    const sweep = phase < 0.45 ? -40 + (phase / 0.45) * (VIEW_W + 80) : null;
    word(ctx, 'DOWN UNDER', VIEW_W / 2, 24, time, { scale: 3, ramp: GOLD, bob: 1.5, shine: sweep });
    word(ctx, 'AGAIN', VIEW_W / 2, 50, time + 0.6, { scale: 4, ramp: AQUA, bob: 2, shine: sweep === null ? null : sweep - 30 });
    drawText(ctx, 'FLORIDA: RIVER TO REEF', VIEW_W / 2, 89, P.cream, { align: 'center', shadow: P.ink });
    if (showPrompt) {
      if (Math.floor(time * 1.6) % 2 === 0) {
        word(ctx, 'PRESS ANY KEY', VIEW_W / 2, 124, time, { scale: 2, ramp: WHITE, bob: 0, shine: null });
      }
      drawText(ctx, 'OR CLICK TO START', VIEW_W / 2, 145, P.cream, { align: 'center', shadow: P.ink });
    }
    drawText(ctx, 'A FAN-MADE TRIBUTE TO THE 1994 CLASSIC', VIEW_W / 2, VIEW_H - 10, P.silver, { align: 'center', shadow: P.ink });
  }

  /** Every so often a big creature cruises across the foreground. */
  private drawSwimmer(ctx: CanvasRenderingContext2D, time: number, dt: number): void {
    if (!this.swimmer) {
      this.nextSwimmer -= dt;
      if (this.nextSwimmer > 0 || this.cast.length === 0) return;
      const pick = this.cast[Math.floor((time * 7.3) % this.cast.length)] as SpeciesDef;
      const facing: 1 | -1 = Math.floor(time) % 2 === 0 ? 1 : -1;
      this.swimmer = {
        def: pick,
        facing,
        x: facing === 1 ? -pick.length : VIEW_W + pick.length,
        y: 112 + ((time * 13) % 60),
        speed: 26 + (pick.length % 5) * 4,
      };
      return;
    }
    const s = this.swimmer;
    s.x += s.facing * s.speed * dt;
    const spr = spriteFor(s.def);
    const frame = Math.floor(time * 3) % 2;
    drawSprite(ctx, spr, frame, Math.round(s.x), Math.round(s.y + Math.sin(time * 1.3) * 2), s.facing);
    if (s.x < -s.def.length - 10 || s.x > VIEW_W + s.def.length + 10) {
      this.swimmer = null;
      this.nextSwimmer = 6 + ((time * 3.1) % 6);
    }
  }
}
