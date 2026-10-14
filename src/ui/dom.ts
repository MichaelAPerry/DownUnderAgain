/**
 * Tiny DOM builder. All text goes through textContent, never innerHTML, so
 * names from save data or the sandbox can't inject markup.
 */
type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  onClick?: (e: Event) => void;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.onClick) {
    const fn = props.onClick;
    el.addEventListener('click', (e) => fn(e));
  }
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.style) Object.assign(el.style, props.style);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** A retro button. `primary` buttons get the gold treatment. */
export function button(label: string, onClick: () => void, opts: { primary?: boolean; small?: boolean; disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  const cls = ['btn', opts.primary ? 'btn-primary' : '', opts.small ? 'btn-small' : ''].filter(Boolean).join(' ');
  const b = h('button', { class: cls, text: label, attrs: { type: 'button' }, onClick: () => onClick() });
  if (opts.disabled) b.disabled = true;
  if (opts.title) b.title = opts.title;
  return b;
}

/** Full-screen centred overlay with a bordered panel. */
export function panel(title: string, ...children: Child[]): HTMLElement {
  return h(
    'div',
    { class: 'screen' },
    h('div', { class: 'panel' }, h('h2', { class: 'panel-title', text: title }), ...children),
  );
}

/** Render a canvas sprite preview scaled up crisply. */
export function spriteImg(canvas: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = canvas.width * scale;
  c.height = canvas.height * scale;
  c.className = 'pixelated';
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
  }
  return c;
}
