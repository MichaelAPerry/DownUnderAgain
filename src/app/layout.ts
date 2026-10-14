import { VIEW_H, VIEW_W } from '../engine/camera';

/**
 * Size the canvas to the largest whole-number multiple of the view that fits
 * the window (pixel-perfect), or shrink smoothly if the window is tinier.
 */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const raw = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const scale = raw >= 1 ? Math.floor(raw) : raw;
  canvas.style.width = `${Math.round(VIEW_W * scale)}px`;
  canvas.style.height = `${Math.round(VIEW_H * scale)}px`;
}
