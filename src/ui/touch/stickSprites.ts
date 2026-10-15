/**
 * Pixel-art joystick sprites, drawn at 1 sprite pixel per canvas pixel and
 * shown scaled up by a whole number with `image-rendering: pixelated`, so they
 * stay crisp and use only the game palette.
 */
import { PALETTE } from '../../data/palette';

const P = PALETTE;

function sprite(size: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.className = 'pixelated';
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    paint(ctx);
  }
  return c;
}

/** Calls fn(x, y, dx, dy, d) for every pixel of a (2r+1)^2 grid centred on pixel (r, r). */
function eachPixel(r: number, fn: (x: number, y: number, dx: number, dy: number, d: number) => void): void {
  const n = r * 2 + 1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - r;
      const dy = y - r;
      fn(x, y, dx, dy, Math.sqrt(dx * dx + dy * dy));
    }
  }
}

/** The joystick base: an inked, bevelled ring around a translucent navy well with four cyan chevrons. */
export function drawStickBase(r: number): HTMLCanvasElement {
  return sprite(r * 2 + 1, (ctx) => {
    eachPixel(r, (x, y, dx, dy, d) => {
      let color: string | null = null;
      let alpha = 1;
      if (d > r + 0.5) return;
      if (d > r - 0.5) color = P.ink;
      else if (d > r - 2.5) color = dx + dy < 0 ? P.silver : P.slate;
      else if (d > r - 3.5) color = P.ink;
      else {
        color = P.navy;
        alpha = 0.45;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
    ctx.globalAlpha = 1;
    // Direction chevrons just inside the ring (3-pixel arrowheads with an ink shadow).
    const reach = r - 6;
    const chevron = (cx: number, cy: number, ux: number, uy: number) => {
      // ux,uy = outward unit direction; draw tip then a 3-wide and 5-wide row behind it.
      const px = -uy;
      const py = ux;
      const rows: Array<[number, number]> = [
        [0, 0],
        [-1, 1],
        [-2, 2],
      ];
      for (const pass of [0, 1]) {
        ctx.fillStyle = pass === 0 ? P.ink : P.cyan;
        const off = pass === 0 ? 1 : 0;
        rows.forEach(([back, half]) => {
          for (let k = -half; k <= half; k++) {
            ctx.fillRect(cx + ux * back + px * k + off, cy + uy * back + py * k + off, 1, 1);
          }
        });
      }
    };
    chevron(r, r - reach, 0, -1);
    chevron(r, r + reach, 0, 1);
    chevron(r - reach, r, -1, 0);
    chevron(r + reach, r, 1, 0);
  });
}

/** The thumb knob: a cream pebble with an ink outline, white glint and tan shade. */
export function drawStickKnob(k: number, hot: boolean): HTMLCanvasElement {
  return sprite(k * 2 + 1, (ctx) => {
    eachPixel(k, (x, y, dx, dy, d) => {
      if (d > k + 0.5) return;
      // Light from the top-left: a crescent of shade on the far side and a small glint.
      const sx = dx + k * 0.35;
      const sy = dy + k * 0.35;
      const gx = dx + k * 0.42;
      const gy = dy + k * 0.42;
      let color: string;
      if (d > k - 0.5) color = P.ink;
      else if (Math.sqrt(gx * gx + gy * gy) < Math.max(1, k * 0.22)) color = P.white;
      else if (Math.sqrt(sx * sx + sy * sy) > k * 1.02) color = hot ? P.rust : P.tan;
      else color = hot ? P.gold : P.cream;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
}
