import { VIEW_H, VIEW_W } from '../engine/camera';

/**
 * Size the canvas: on desktop the largest whole-number multiple of the view
 * that fits (pixel-perfect); on touch devices or windows under 2x, fill the
 * available space with fractional nearest-neighbour scaling.
 * Also publishes the canvas box as CSS variables on `ui` (--cv-top, --cv-left,
 * --cv-w, --cv-h) so DOM screens can line up with what's drawn on the canvas.
 */
export function fitCanvas(canvas: HTMLCanvasElement, ui?: HTMLElement): void {
  const raw = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  // Desktop: exact whole-number scaling once 2x fits. Phones/tablets (coarse
  // pointer) and small windows: fill the screen; nearest-neighbour keeps it crisp.
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const scale = !coarse && raw >= 2 ? Math.floor(raw) : raw;
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
