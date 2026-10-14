/**
 * Fixed-timestep game loop: the simulation always advances in SIM_DT steps,
 * rendering interpolates between the last two states. Pauses itself while
 * the tab is hidden so a backgrounded tab can't fast-forward the reef.
 */
export interface LoopHandlers {
  update(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class GameLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private readonly onVis = () => {
    if (document.hidden) this.stop();
    else this.start();
  };

  constructor(private readonly h: LoopHandlers, private readonly step: number, private readonly maxSteps = 5) {
    document.addEventListener('visibilitychange', this.onVis);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly frame = (now: number) => {
    if (!this.running) return;
    const frameDt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += frameDt;
    let n = 0;
    while (this.acc >= this.step && n < this.maxSteps) {
      this.h.update(this.step);
      this.acc -= this.step;
      n++;
    }
    if (n === this.maxSteps) this.acc = 0;
    this.h.render(this.acc / this.step, frameDt);
    this.raf = requestAnimationFrame(this.frame);
  };
}
