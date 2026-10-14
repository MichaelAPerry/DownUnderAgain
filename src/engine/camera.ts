import { clamp } from './math';

export const VIEW_W = 384;
export const VIEW_H = 216;
/** How much sky the camera may show above the surface. */
export const SKY_H = 28;

export class Camera {
  x = 0;
  y = 0;

  constructor(private readonly worldW: number, private readonly worldH: number) {}

  /** Centre on a point immediately. */
  snap(tx: number, ty: number): void {
    this.x = this.clampX(tx - VIEW_W / 2);
    this.y = this.clampY(ty - VIEW_H / 2);
  }

  /** Ease toward a point, with a little look-ahead in the direction of travel. */
  follow(tx: number, ty: number, vx: number, vy: number, dt: number): void {
    const gx = this.clampX(tx + vx * 0.35 - VIEW_W / 2);
    const gy = this.clampY(ty + vy * 0.2 - VIEW_H / 2);
    const k = Math.min(1, dt * 4);
    this.x += (gx - this.x) * k;
    this.y += (gy - this.y) * k;
  }

  private clampX(x: number): number {
    return clamp(x, 0, this.worldW - VIEW_W);
  }

  private clampY(y: number): number {
    return clamp(y, -SKY_H, this.worldH - VIEW_H);
  }
}
