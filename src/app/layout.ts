import { VIEW_H, VIEW_W } from '../engine/camera';

/**
 * Size the canvas to the largest whole-number multiple of the view that fits
 * the window (pixel-perfect), or shrink smoothly if the window is tinier.
 * Also publishes the canvas box as CSS variables on `ui` (--cv-top, --cv-left,
 * --cv-w, --cv-h) so DOM screens can line up with what's drawn on the canvas.
 */
export function fitCanvas(canvas: HTMLCanvasElement, ui?: HTMLElement): void {
  const raw = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const scale = raw >= 1 ? Math.floor(raw) : raw;
  const w = Math.round(VIEW_W * scale);
  const h = Math.round(VIEW_H * scale);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (ui) {
    ui.style.setProperty('--cv-w', `${w}px`);
    ui.style.setProperty('--cv-h', `${h}px`);
    ui.style.setProperty('--cv-top', `${Math.round((window.innerHeight - h) / 2)}px`);
    ui.style.setProperty('--cv-left', `${Math.round((window.innerWidth - w) / 2)}px`);
  }
}
