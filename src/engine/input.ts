/**
 * Keyboard + mouse (+ touch). Movement: WASD / arrow keys, or hold the left
 * mouse button to swim toward the cursor. Shift = burst. On touch screens the
 * on-screen controls (ui/touch) feed `stick`, `touchBurst` and `press()`.
 */
import { VIEW_H, VIEW_W } from './camera';

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  mouseX = VIEW_W / 2;
  mouseY = VIEW_H / 2;
  mouseDown = false;
  /** Virtual joystick: analogue axis (each component in [-1,1]) while a finger holds it. */
  readonly stick = { active: false, x: 0, y: 0 };
  /** The on-screen BURST button is held. */
  touchBurst = false;
  /** Last time (performance.now) a finger touched the screen; compat mouse events after it are ignored. */
  private lastTouchAt = -Infinity;
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
      this.releaseTouch();
    });
    const touched = () => {
      this.lastTouchAt = performance.now();
    };
    on('touchstart', touched);
    on('touchend', touched);
    on('pointerdown', (e) => {
      if (e.pointerType === 'touch') touched();
    });
    on('mousemove', (e) => this.trackMouse(e));
    on('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    const md = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Browsers synthesise mouse events after a tap; touches must never mouse-steer.
      if (performance.now() - this.lastTouchAt < TOUCH_MOUSE_GUARD_MS) return;
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

  /** Simulate a key press (on-screen buttons): seen by wasPressed() this frame. */
  press(code: string): void {
    this.pressed.add(code);
  }

  /** Let go of every touch control (finger lifted, screen changed, window blurred). */
  releaseTouch(): void {
    this.stick.active = false;
    this.stick.x = 0;
    this.stick.y = 0;
    this.touchBurst = false;
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
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight') || this.isDown('Space') || this.touchBurst;
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
  }
}

const TOUCH_MOUSE_GUARD_MS = 1000;
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
const isGameKey = (code: string) => GAME_KEYS.has(code);
const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
