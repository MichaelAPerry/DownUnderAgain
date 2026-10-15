/** Shared building blocks for the LAN multiplayer screens. */
import type { AppApi } from '../../app/api';
import type { SpeciesDef, Tier } from '../../data/schema';
import { CODE_PREFIX_INVITE, CODE_PREFIX_REPLY } from '../../net/signal';
import { qrCanvas, startQrScan } from '../../net/qr';
import type { QrScan } from '../../net/qr';
import { SLOT_COLORS, slotColor } from '../../render/lanHud';
import { spriteFor } from '../../render/spriteCache';
import { button, h, spriteImg } from '../dom';

export { SLOT_COLORS, slotColor };

/** Scan filters for the two code kinds. */
export const INVITE_PREFIX = `${CODE_PREFIX_INVITE}.`;
export const REPLY_PREFIX = `${CODE_PREFIX_REPLY}.`;

export const NAME_MAX = 10;

/** Upper-case and keep only A-Z, 0-9 and single spaces (max 10 chars). */
export function cleanName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/ {2,}/g, ' ').slice(0, NAME_MAX);
}

/** Readable text from anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'Something went wrong. Try again.';
}

/** A red error line (empty and hidden until set). */
export function errorLine(): { el: HTMLElement; set(msg: string | null): void } {
  const el = h('p', { class: 'text-red text-[9px] leading-relaxed', attrs: { role: 'alert' } });
  el.hidden = true;
  return {
    el,
    set(msg) {
      el.textContent = msg ?? '';
      el.hidden = !msg;
    },
  };
}

/**
 * Run `cleanup` once `el` has been attached and then detached from the
 * document (screens are swapped out with replaceChildren). Polls, so it also
 * covers removal by any route. Gives up (and cleans up) if never attached.
 */
export function whenDetached(el: HTMLElement, cleanup: () => void): () => void {
  let seen = el.isConnected;
  let waited = 0;
  const timer = window.setInterval(() => {
    if (el.isConnected) {
      seen = true;
      return;
    }
    waited += 1;
    if (seen || waited > 10) {
      window.clearInterval(timer);
      cleanup();
    }
  }, 500);
  return () => window.clearInterval(timer);
}

/** Subscribe to LAN changes for as long as `el` stays on screen. */
export function onLanChange(app: AppApi, el: HTMLElement, fn: () => void): void {
  let unsub: (() => void) | null = null;
  const stop = () => {
    unsub?.();
    unsub = null;
  };
  unsub = app.lan.onChange(() => {
    if (!el.isConnected) {
      stop();
      return;
    }
    fn();
  });
  whenDetached(el, stop);
}

/** Small square chip in a player's slot colour. */
export function slotChip(slot: number): HTMLElement {
  return h('span', {
    class: 'inline-block w-3 h-3 shrink-0 border-2 border-ink',
    style: { background: slotColor(slot) },
    attrs: { 'aria-hidden': 'true' },
  });
}

/** Playable species, small to big within each tier (custom fish can't be validated by the host). */
export function lanFish(app: AppApi): SpeciesDef[] {
  const order: Tier[] = ['herbivore', 'omnivore', 'carnivore', 'apex', 'food'];
  return app.region.species
    .filter((s) => s.playable)
    .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || a.length - b.length);
}

export function fishById(app: AppApi, id: string): SpeciesDef | undefined {
  return app.region.species.find((s) => s.id === id) ?? app.region.all.find((d) => d.id === id) as SpeciesDef | undefined;
}

/** A crisp sprite preview that fits in roughly `px` pixels of width. */
export function fishIcon(def: SpeciesDef, px = 32): HTMLElement {
  const frame = spriteFor(def).frames[0];
  const scale = Math.max(1, Math.min(4, Math.floor(px / Math.max(1, def.length))));
  return h('span', { class: 'inline-flex items-center justify-center shrink-0', style: { minWidth: `${px}px` } }, frame ? spriteImg(frame, scale) : null);
}

const TIER_COLOR: Record<Tier, string> = {
  herbivore: 'text-lime',
  omnivore: 'text-cyan',
  carnivore: 'text-orange',
  apex: 'text-red',
  food: 'text-silver',
};

/**
 * Compact tap-friendly fish picker. `onPick` fires on every tap; the grid
 * highlights the selection itself. Returns the element plus a way to change
 * the highlighted fish and to disable all choices.
 */
export function fishGrid(
  defs: readonly SpeciesDef[],
  selectedId: string | null,
  onPick: (def: SpeciesDef) => void,
): { el: HTMLElement; select(id: string | null): void; setDisabled(off: boolean): void } {
  const buttons = new Map<string, HTMLButtonElement>();
  const select = (id: string | null) => {
    for (const [bid, b] of buttons) {
      const on = bid === id;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('border-yellow', on);
      b.classList.toggle('bg-charcoal/70', on);
    }
  };
  const el = h(
    'div',
    { class: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1' },
    ...defs.map((def) => {
      const b = h(
        'button',
        {
          class: 'card-button flex flex-col items-center gap-1 min-h-[52px] p-1',
          attrs: { type: 'button', title: def.name },
          onClick: () => {
            select(def.id);
            onPick(def);
          },
        },
        fishIcon(def, 36),
        h('span', { class: `${TIER_COLOR[def.tier]} text-[8px] text-center leading-tight`, text: def.name.toUpperCase() }),
      );
      b.dataset.sfx = 'select';
      buttons.set(def.id, b);
      return b;
    }),
  );
  select(selectedId);
  return {
    el,
    select,
    setDisabled(off) {
      for (const b of buttons.values()) b.disabled = off;
    },
  };
}

/** Text area styled like the other pixel inputs. */
export function codeArea(opts: { readonly?: boolean; placeholder?: string; label: string }): HTMLTextAreaElement {
  const t = h('textarea', {
    class: 'block w-full font-mono text-[10px] leading-snug bg-ink text-cream border-2 border-charcoal p-2 h-20 resize-none break-all',
    attrs: {
      'aria-label': opts.label,
      spellcheck: 'false',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
    },
  });
  if (opts.readonly) {
    t.readOnly = true;
    t.addEventListener('focus', () => t.select());
  }
  return t;
}

/** A code to hand over: QR, read-only text, COPY and SHARE. */
export function codeShare(code: string, title: string): HTMLElement {
  let qr: HTMLElement;
  try {
    const c = qrCanvas(code, 3);
    c.classList.add('pixelated', 'block', 'mx-auto', 'bg-white');
    c.style.width = '100%';
    c.style.maxWidth = '220px';
    c.style.height = 'auto';
    c.style.imageRendering = 'pixelated';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `${title} QR code`);
    qr = c;
  } catch {
    qr = h('p', { class: 'muted text-[8px]', text: 'This code is too long for a QR. Copy or share the text instead.' });
  }
  const text = codeArea({ readonly: true, label: title });
  text.value = code;
  const status = h('span', { class: 'text-lime text-[8px]', attrs: { 'aria-live': 'polite' } });
  const say = (msg: string) => {
    status.textContent = msg;
    window.setTimeout(() => {
      if (status.textContent === msg) status.textContent = '';
    }, 2500);
  };
  const copy = lanButton('COPY', () => {
    const fallback = () => {
      text.focus();
      text.select();
      say('Selected - copy it from the box.');
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(() => say('COPIED!'), fallback);
    } else fallback();
  }, { small: true });
  const canShare = typeof navigator.share === 'function';
  const share = canShare
    ? lanButton('SHARE', () => {
        navigator.share({ title: 'Down Under Again', text: code }).catch((e: unknown) => {
          if (!(e instanceof DOMException && e.name === 'AbortError')) say('Sharing failed - use COPY.');
        });
      }, { small: true })
    : null;
  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    qr,
    text,
    h('div', { class: 'flex flex-wrap items-center gap-2' }, copy, share, status),
  );
}

export interface Scanner {
  /** The SCAN button plus (while open) the camera view. */
  el: HTMLElement;
  stop(): void;
  setDisabled(off: boolean): void;
}

/** Camera QR scanner that accepts codes starting with `prefix` and hands the first one over. */
export function qrScanner(label: string, prefix: string, onCode: (code: string) => void): Scanner {
  const video = h('video', {
    class: 'block w-full max-w-[260px] bg-ink border-2 border-charcoal',
    attrs: { playsinline: 'true', muted: 'true', 'aria-label': 'Camera view' },
  });
  video.muted = true;
  const err = errorLine();
  const hint = h('p', { class: 'muted text-[8px]', text: 'Point the camera at the QR code.' });
  let scan: QrScan | null = null;
  let active = false;
  let unwatch: (() => void) | null = null;

  const view = h('div', { class: 'flex flex-col gap-2' });
  view.hidden = true;

  const stop = () => {
    active = false;
    scan?.stop();
    scan = null;
    unwatch?.();
    unwatch = null;
    view.hidden = true;
    startBtn.hidden = false;
  };

  const start = () => {
    if (active) return;
    active = true;
    err.set(null);
    view.hidden = false;
    startBtn.hidden = true;
    unwatch = whenDetached(el, stop);
    startQrScan(video, (s) => s.trim().startsWith(prefix), (code) => {
      stop();
      onCode(code.trim());
    }).then(
      (s) => {
        // Stopped (or left the screen) while the camera was starting up.
        if (!active || !el.isConnected) {
          s.stop();
          if (active) stop();
          return;
        }
        scan = s;
      },
      (e: unknown) => {
        stop();
        const msg = e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Camera permission was denied. Paste the code instead.'
          : errorMessage(e);
        err.set(msg);
      },
    );
  };

  const startBtn = lanButton(label, start);
  const stopBtn = lanButton('STOP', stop, { small: true });
  stopBtn.classList.add('self-start');
  view.append(video, hint, stopBtn);
  const el = h('div', { class: 'flex flex-col gap-2' }, startBtn, view, err.el);
  return {
    el,
    stop,
    setDisabled(off) {
      startBtn.disabled = off;
      if (off) stop();
    },
  };
}

/** A retro button with a phone-friendly tap target (at least 40px tall). */
export function lanButton(
  label: string,
  onClick: () => void,
  opts: { primary?: boolean; small?: boolean; disabled?: boolean; title?: string; sfx?: string } = {},
): HTMLButtonElement {
  const b = button(label, onClick, opts);
  b.classList.add('min-h-[40px]', 'min-w-[48px]');
  return b;
}

/** A section heading with a step number. */
export function stepTitle(n: number, text: string): HTMLElement {
  return h(
    'h3',
    { class: 'text-cyan text-[10px] mb-2 flex items-center gap-2' },
    h('span', { class: 'chip text-yellow', text: String(n) }),
    h('span', { text }),
  );
}
