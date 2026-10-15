/**
 * On-screen controls for phones and tablets: a floating joystick (left ~60% of
 * the screen), BURST (hold), PAUSE and, in Evolution mode, EVOLVE.
 *
 * Touch UI is shown only while the player is using touch: it starts on when
 * the primary pointer is coarse, turns on with any finger on the screen and
 * off again as soon as a mouse moves/clicks or a physical key is pressed.
 * The joystick and each button track their own pointer ids, so the steering
 * thumb and the button thumb work independently (multi-touch).
 *
 * Everything feeds the same Input the keyboard uses: the stick sets
 * `input.stick`, BURST sets `input.touchBurst`, PAUSE/EVOLVE `press()` Escape
 * and Tab, so Game handles them exactly like the keys.
 */
import type { Screen } from '../../app/screens';
import type { Input } from '../../engine/input';
import { h } from '../dom';
import { drawStickBase, drawStickKnob } from './stickSprites';

/** Fraction of the screen width (from the left) where a touch spawns the joystick. */
export const STICK_ZONE = 0.6;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD_ZONE = 0.08;

export interface TouchFrame {
  /** Evolution mode is running (show EVOLVE). */
  evolve: boolean;
  /** An upgrade is affordable right now (EVOLVE pulses). */
  canEvolve: boolean;
}

export class TouchControls {
  /** The player is on touch: show the on-screen controls. */
  active = false;
  private screen: Screen = 'title';
  private readonly root: HTMLElement;
  private readonly stickEl: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly evolveBtn: HTMLButtonElement;
  private readonly burstBtn: HTMLButtonElement;
  private readonly rotateHint: HTMLElement;
  private rotateDismissed = false;
  private stickId: number | null = null;
  private baseX = 0;
  private baseY = 0;
  /** Joystick radius in CSS px and the size of one sprite pixel in CSS px. */
  private radius = 56;
  private px = 2;
  private base: HTMLCanvasElement | null = null;
  private knob: HTMLCanvasElement | null = null;
  private knobHot: HTMLCanvasElement | null = null;
  private lastFrame = '';
  private readonly cleanup: Array<() => void> = [];

  constructor(host: HTMLElement, private readonly input: Input) {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

    this.stickEl = h('div', { class: 'touch-stick', attrs: { 'aria-hidden': 'true' } });
    const pause = this.tapButton('touch-btn touch-pause', 'Pause', () => input.press('Escape'));
    pause.append(h('span', { class: 'touch-pause-bar' }), h('span', { class: 'touch-pause-bar' }));
    this.evolveBtn = this.tapButton('touch-btn touch-evolve', 'Evolve', () => input.press('Tab'));
    this.evolveBtn.append(h('span', { text: 'EVOLVE' }));
    this.evolveBtn.hidden = true;
    this.burstBtn = this.holdButton('touch-btn touch-burst', 'Burst', (held) => {
      input.touchBurst = held;
      this.showKnob();
    });
    this.burstBtn.append(h('span', { class: 'touch-burst-icon', text: '>>' }), h('span', { text: 'BURST' }));
    this.pad = h('div', { class: 'touch-pad' }, pause, this.evolveBtn, this.burstBtn);

    const close = h('span', { class: 'touch-rotate-x', text: 'X' });
    this.rotateHint = h(
      'button',
      {
        class: 'touch-rotate',
        attrs: { type: 'button', 'aria-label': 'Dismiss: rotate for a bigger reef', tabindex: '-1' },
        onClick: () => {
          this.rotateDismissed = true;
          this.refresh();
        },
      },
      h('span', { class: 'touch-rotate-icon', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: 'ROTATE FOR A BIGGER REEF' }),
      close,
    );
    this.root = h('div', { class: 'touch-layer' }, this.stickEl, this.rotateHint);
    host.append(this.root);

    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(t, fn, opts);
      this.cleanup.push(() => window.removeEventListener(t, fn, opts));
    };
    // Mode detection.
    on('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setActive(true);
      else if (e.pointerType === 'mouse') this.setActive(false);
    }, { capture: true });
    on('pointermove', (e) => {
      if (e.pointerType === 'mouse' && (e.movementX !== 0 || e.movementY !== 0)) this.setActive(false);
    }, { capture: true });
    on('keydown', (e) => {
      // On-screen keyboards report these; only a real keyboard switches modes.
      if (e.isComposing || e.key === 'Unidentified' || e.key === 'Process') return;
      this.setActive(false);
    }, { capture: true });

    // Joystick.
    on('pointerdown', (e) => this.stickDown(e));
    on('pointermove', (e) => this.stickMove(e));
    on('pointerup', (e) => this.stickUp(e));
    on('pointercancel', (e) => this.stickUp(e));
    // No scrolling, rubber-banding or pinch-zoom while swimming (iOS ignores touch-action for some of these).
    const noScroll = (e: Event) => {
      if (this.screen === 'playing' && e.cancelable) e.preventDefault();
    };
    on('touchmove', noScroll, { passive: false });
    document.addEventListener('gesturestart', noScroll, { passive: false });
    this.cleanup.push(() => document.removeEventListener('gesturestart', noScroll));
    on('resize', () => this.layout());

    this.active = coarse;
    this.layout();
  }

  /** Called on every screen change. */
  setScreen(screen: Screen): void {
    this.screen = screen;
    if (screen !== 'playing') this.releaseAll();
    this.refresh();
  }

  /** Per-frame state from the game (cheap: only touches the DOM when it changes). */
  frame(f: TouchFrame): void {
    const key = `${f.evolve ? 1 : 0}${f.canEvolve ? 1 : 0}`;
    if (key === this.lastFrame) return;
    this.lastFrame = key;
    this.evolveBtn.hidden = !f.evolve;
    this.evolveBtn.classList.toggle('can-evolve', f.evolve && f.canEvolve);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.root.remove();
  }

  // ---- mode / visibility -------------------------------------------------

  private setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) this.releaseAll();
    this.refresh();
  }

  private refresh(): void {
    const playing = this.screen === 'playing';
    const root = document.documentElement;
    root.classList.toggle('touch-ui', this.active);
    root.classList.toggle('is-playing', playing);
    this.root.hidden = !this.active;
    // Detached (not just hidden) when unused, so its labels never shadow menu text.
    if (playing && this.active) {
      if (!this.pad.isConnected) this.root.insertBefore(this.pad, this.rotateHint);
    } else this.pad.remove();
    const portrait = window.innerHeight > window.innerWidth;
    this.rotateHint.hidden = this.rotateDismissed || !portrait || !(playing || this.screen === 'title');
  }

  /** Size the joystick for the screen and (re)draw its sprites. */
  private layout(): void {
    const short = Math.min(window.innerWidth, window.innerHeight);
    const radius = Math.round(Math.max(44, Math.min(84, short * 0.15)));
    const px = Math.max(2, Math.round(radius / 26));
    const r = Math.round(radius / px);
    if (this.base && r * px === this.radius && px === this.px) {
      this.refresh();
      return;
    }
    this.px = px;
    this.radius = r * px;
    const k = Math.max(4, Math.round(r * 0.42));
    const size = (c: HTMLCanvasElement, cls: string) => {
      c.classList.add(cls);
      c.style.width = `${c.width * px}px`;
      c.style.height = `${c.height * px}px`;
      return c;
    };
    this.base = size(drawStickBase(r), 'touch-stick-base');
    this.knob = size(drawStickKnob(k, false), 'touch-stick-knob');
    this.knobHot = size(drawStickKnob(k, true), 'touch-stick-knob');
    this.stickEl.replaceChildren(this.base, this.knob, this.knobHot);
    this.stickEl.style.width = this.base.style.width;
    this.stickEl.style.height = this.base.style.height;
    this.showKnob();
    this.placeKnob(0, 0);
    this.refresh();
  }

  // ---- joystick ----------------------------------------------------------

  private stickDown(e: PointerEvent): void {
    if (e.pointerType !== 'touch' || this.screen !== 'playing') return;
    const t = e.target;
    if (t instanceof Element && (t.closest('.touch-pad') || t.closest('.touch-rotate'))) return;
    // Swallow the touch: no compat mouse events (mouse-steer), focus moves or text selection.
    if (e.cancelable) e.preventDefault();
    if (this.stickId !== null || e.clientX > window.innerWidth * STICK_ZONE) return;
    this.stickId = e.pointerId;
    this.baseX = e.clientX;
    this.baseY = e.clientY;
    this.input.stick.active = true;
    this.stickEl.classList.add('on');
    this.drag(e.clientX, e.clientY);
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.drag(e.clientX, e.clientY);
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.releaseStick();
  }

  private drag(fx: number, fy: number): void {
    const R = this.radius;
    let dx = fx - this.baseX;
    let dy = fy - this.baseY;
    let d = Math.sqrt(dx * dx + dy * dy);
    if (d > R) {
      // The base trails the thumb, so reversing never needs a long drag back.
      this.baseX = fx - (dx / d) * R;
      this.baseY = fy - (dy / d) * R;
      dx = fx - this.baseX;
      dy = fy - this.baseY;
      d = R;
    }
    const mag = d / R;
    const s = this.input.stick;
    if (mag < STICK_DEAD_ZONE || d === 0) {
      s.x = 0;
      s.y = 0;
    } else {
      const out = Math.min(1, (mag - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
      s.x = (dx / d) * out;
      s.y = (dy / d) * out;
    }
    const half = (this.base?.width ?? 0) * this.px / 2;
    // Snap to the sprite pixel grid so the art never lands between pixels.
    const snap = (v: number) => Math.round(v / this.px) * this.px;
    this.stickEl.style.transform = `translate(${snap(this.baseX - half)}px, ${snap(this.baseY - half)}px)`;
    // The knob travels a little less than the radius so it stays seated in the ring.
    const travel = R - (this.knob?.width ?? 0) * this.px * 0.3;
    const kd = d > travel ? travel / d : 1;
    this.placeKnob(snap(dx * kd), snap(dy * kd));
  }

  private placeKnob(dx: number, dy: number): void {
    const bw = (this.base?.width ?? 0) * this.px;
    const kw = (this.knob?.width ?? 0) * this.px;
    const off = (bw - kw) / 2;
    const t = `translate(${off + dx}px, ${off + dy}px)`;
    if (this.knob) this.knob.style.transform = t;
    if (this.knobHot) this.knobHot.style.transform = t;
  }

  private showKnob(): void {
    if (this.knob) this.knob.hidden = this.input.touchBurst;
    if (this.knobHot) this.knobHot.hidden = !this.input.touchBurst;
  }

  private releaseStick(): void {
    this.stickId = null;
    this.input.stick.active = false;
    this.input.stick.x = 0;
    this.input.stick.y = 0;
    this.stickEl.classList.remove('on');
  }

  private releaseAll(): void {
    this.releaseStick();
    this.input.releaseTouch();
    this.burstBtn.classList.remove('is-down');
    this.showKnob();
  }

  // ---- buttons -----------------------------------------------------------

  private baseButton(cls: string, label: string): HTMLButtonElement {
    const b = h('button', { class: cls, attrs: { type: 'button', 'aria-label': label, tabindex: '-1' } });
    // Taps on the pad must not turn into clicks/compat mouse events or a long-press menu.
    b.addEventListener('touchstart', (e) => e.cancelable && e.preventDefault(), { passive: false });
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  /** Fires on release over the button (like a native tap), so the menu it opens can't catch the same touch. */
  private tapButton(cls: string, label: string, fire: () => void): HTMLButtonElement {
    const b = this.baseButton(cls, label);
    let id: number | null = null;
    b.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      id = e.pointerId;
      b.classList.add('is-down');
    });
    const end = (e: PointerEvent, ok: boolean) => {
      if (e.pointerId !== id) return;
      id = null;
      b.classList.remove('is-down');
      if (!ok || this.screen !== 'playing') return;
      const r = b.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) fire();
    };
    b.addEventListener('pointerup', (e) => end(e, true));
    b.addEventListener('pointercancel', (e) => end(e, false));
    // Keyboard / assistive activation (and mouse clicks if the pad is ever shown to one).
    b.addEventListener('click', (e) => {
      if (e.detail === 0 && this.screen === 'playing') fire();
    });
    return b;
  }

  /** Held while any finger that went down on it stays down (even if it slides off). */
  private holdButton(cls: string, label: string, set: (held: boolean) => void): HTMLButtonElement {
    const b = this.baseButton(cls, label);
    const ids = new Set<number>();
    const update = () => {
      const held = ids.size > 0 && this.screen === 'playing';
      b.classList.toggle('is-down', held);
      set(held);
    };
    b.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      ids.add(e.pointerId);
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic or already-released pointer: holding still works without capture.
      }
      update();
    });
    const up = (e: PointerEvent) => {
      if (!ids.delete(e.pointerId)) return;
      update();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    this.cleanup.push(() => ids.clear());
    return b;
  }
}
