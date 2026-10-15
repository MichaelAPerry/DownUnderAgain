/**
 * Keyboard + mouse. Movement: WASD / arrow keys, or hold the left mouse
 * button to swim toward the cursor. Shift = burst.
 */
import { VIEW_H, VIEW_W } from './camera';

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseX = VIEW_W / 2;
  mouseY = VIEW_H / 2;
  mouseDown = false;
  /** While true, arrow/space/tab keys are captured (no page scroll or focus moves). */
  captureGameKeys = false;
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(t, fn);
      this.cleanup.push(() => window.removeEventListener(t, fn));
    };
    on('keydown', (e) => {
      if (this.captureGameKeys && isGameKey(e.code) && !isTypingTarget(e.target)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    on('keyup', (e) => this.down.delete(e.code));
    on('blur', () => {
      this.down.clear();
      this.mouseDown = false;
    });
    on('mousemove', (e) => this.trackMouse(e));
    on('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    const md = (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.trackMouse(e);
      this.mouseDown = true;
    };
    canvas.addEventListener('mousedown', md);
    this.cleanup.push(() => canvas.removeEventListener('mousedown', md));
    const cm = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', cm);
    this.cleanup.push(() => canvas.removeEventListener('contextmenu', cm));
  }

  private trackMouse(e: MouseEvent): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.mouseX = ((e.clientX - r.left) / r.width) * VIEW_W;
    this.mouseY = ((e.clientY - r.top) / r.height) * VIEW_H;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical key press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** True if any key was pressed this frame. */
  anyPressed(): boolean {
    return this.pressed.size > 0;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  /** Keyboard movement axis, components in {-1,0,1}. */
  keyAxis(): [number, number] {
    const x = (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0);
    const y = (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0) - (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0);
    return [x, y];
  }

  get burst(): boolean {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight') || this.isDown('Space');
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
  }
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
const isGameKey = (code: string) => GAME_KEYS.has(code);
const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
