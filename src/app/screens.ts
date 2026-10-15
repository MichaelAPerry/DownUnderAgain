/** The top-level screen state machine and its legal transitions. */
export type Screen =
  | 'title'
  | 'modeSelect'
  | 'speciesSelect'
  | 'sandbox'
  | 'briefing'
  | 'playing'
  | 'paused'
  | 'shop'
  | 'stageEnd'
  | 'results'
  | 'codex'
  | 'help'
  | 'lanMenu'
  | 'lanHost'
  | 'lanJoin'
  | 'lanRespawn'
  | 'lanResults';

export const TRANSITIONS: Readonly<Record<Screen, readonly Screen[]>> = {
  title: ['modeSelect', 'codex', 'help'],
  modeSelect: ['title', 'speciesSelect', 'briefing', 'lanMenu'],
  speciesSelect: ['modeSelect', 'sandbox', 'briefing'],
  sandbox: ['speciesSelect', 'briefing'],
  briefing: ['playing', 'title'],
  playing: ['paused', 'shop', 'stageEnd', 'results', 'lanRespawn', 'lanResults'],
  paused: ['playing', 'help', 'title', 'lanResults'],
  shop: ['playing'],
  stageEnd: ['briefing', 'results', 'title'],
  results: ['title', 'briefing', 'modeSelect'],
  codex: ['title'],
  help: ['title', 'paused'],
  lanMenu: ['modeSelect', 'lanHost', 'lanJoin', 'title'],
  lanHost: ['lanMenu', 'playing', 'lanResults', 'title'],
  lanJoin: ['lanMenu', 'playing', 'lanRespawn', 'lanResults', 'title'],
  lanRespawn: ['playing', 'lanResults', 'paused'],
  lanResults: ['title'],
};

/** Screens drawn over a live (frozen) game rather than the attract-mode reef. */
export const OVERLAY_SCREENS: ReadonlySet<Screen> = new Set(['paused', 'shop', 'stageEnd', 'results', 'lanRespawn', 'lanResults']);

export class ScreenMachine {
  private cur: Screen = 'title';
  private prev: Screen | null = null;

  get current(): Screen {
    return this.cur;
  }

  get previous(): Screen | null {
    return this.prev;
  }

  canGo(to: Screen): boolean {
    return TRANSITIONS[this.cur].includes(to);
  }

  go(to: Screen): void {
    if (!this.canGo(to)) throw new Error(`Illegal screen transition ${this.cur} -> ${to}`);
    this.prev = this.cur;
    this.cur = to;
  }
}
