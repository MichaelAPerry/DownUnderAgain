/**
 * The application controller: owns the canvas, loop, input, audio, save data
 * and screen state machine, and implements the AppApi the UI screens use.
 * Menus float over an "attract mode" reef that simulates on its own.
 */
import type { SpeciesDef } from '../data/schema';
import { FLORIDA } from '../data/regions/florida';
import type { Region } from '../data/regions/florida';
import type { CustomFishSpec } from '../data/sandbox';
import { Audio } from '../engine/audio';
import type { Sfx } from '../engine/audio';
import { Camera, VIEW_H, VIEW_W } from '../engine/camera';
import { Input } from '../engine/input';
import { GameLoop } from '../engine/loop';
import { GameSession, MODES } from '../modes/session';
import type { FeedbackEvent } from '../modes/session';
import { drawHud } from '../render/hud';
import { WorldRenderer } from '../render/worldRenderer';
import { SIM_DT, World } from '../sim/world';
import type { AppApi } from './api';
import { loadSave, writeSave } from './save';
import type { ModeId, SaveData } from './save';
import { OVERLAY_SCREENS, ScreenMachine } from './screens';
import type { Screen } from './screens';
import { SCREENS } from '../ui/screens';

/** Seconds the death / stage-clear banner shows before the next screen. */
const OUTCOME_DELAY = 1.6;

const ESCAPE_BACK: Partial<Record<Screen, Screen>> = {
  modeSelect: 'title',
  speciesSelect: 'modeSelect',
  sandbox: 'speciesSelect',
  codex: 'title',
};

export class Game implements AppApi {
  readonly region: Region = FLORIDA;
  readonly save: SaveData;
  session: GameSession | null = null;
  mode: ModeId = 'freeSwim';
  private readonly machine = new ScreenMachine();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly input: Input;
  private readonly audio = new Audio();
  private readonly loop: GameLoop;
  private readonly camera: Camera;
  private attract: World;
  private renderer: WorldRenderer;
  private renderedWorld: World;
  private time = 0;
  private outcomeTimer = 0;
  private lastSpecies: SpeciesDef | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly ui: HTMLElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    this.save = loadSave(new Set(this.region.all.map((s) => s.id)));
    this.audio.muted = this.save.muted;
    this.input = new Input(canvas);
    this.camera = new Camera(this.region.width, this.region.height);
    this.attract = new World(this.region, (Date.now() & 0x7fffffff) >>> 0);
    this.renderedWorld = this.attract;
    this.renderer = new WorldRenderer(this.attract);
    this.camera.snap(900, 60);

    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('resize', () => this.fit());
    this.fit();
    this.mount();
    this.loop = new GameLoop({ update: (dt) => this.update(dt), render: (a, f) => this.render(a, f) }, SIM_DT);
    this.loop.start();
  }

  // ---- AppApi ------------------------------------------------------------

  get screen(): Screen {
    return this.machine.current;
  }

  get previous(): Screen | null {
    return this.machine.previous;
  }

  go(to: Screen): void {
    if (!this.machine.canGo(to)) {
      console.warn(`Ignored illegal screen transition ${this.machine.current} -> ${to}`);
      return;
    }
    this.machine.go(to);
    this.input.captureGameKeys = to === 'playing';
    this.mount();
  }

  sfx(name: Sfx): void {
    this.audio.play(name);
  }

  selectMode(mode: ModeId): void {
    this.mode = mode;
    this.sfx('confirm');
    if (MODES[mode].staged) this.startSession(null);
    else this.go('speciesSelect');
  }

  selectSpecies(def: SpeciesDef): void {
    this.sfx('confirm');
    this.startSession(def);
  }

  begin(): void {
    if (!this.session) return;
    this.audio.unlock();
    this.sfx('confirm');
    const p = this.session.player;
    this.camera.snap(p.x, p.y);
    this.outcomeTimer = 0;
    this.go('playing');
  }

  resume(): void {
    this.go('playing');
  }

  retry(): void {
    const s = this.session;
    if (!s || !s.canRetry) return;
    s.retryStage();
    this.showWorld(s.world);
    this.go('briefing');
  }

  next(): void {
    const s = this.session;
    if (!s || s.outcome !== 'stageClear') return;
    s.nextStage();
    this.showWorld(s.world);
    this.go('briefing');
  }

  quit(): void {
    this.endSession();
    this.showWorld(this.attract);
    this.camera.snap(900, 60);
    this.go('title');
  }

  playAgain(): void {
    const species = MODES[this.mode].staged ? null : this.lastSpecies;
    this.startSession(species);
  }

  setMuted(muted: boolean): void {
    this.save.muted = muted;
    this.audio.muted = muted;
    writeSave(this.save);
  }

  setCues(cues: boolean): void {
    this.save.cues = cues;
    writeSave(this.save);
  }

  saveCustom(spec: CustomFishSpec): void {
    this.save.custom = structuredClone(spec);
    writeSave(this.save);
  }

  buy(upgradeId: string): boolean {
    return this.session?.buy(upgradeId) ?? false;
  }

  // ---- session lifecycle -------------------------------------------------

  private startSession(species: SpeciesDef | null): void {
    this.endSession();
    const seed = (Math.random() * 0x7fffffff) >>> 0;
    const opts = {
      region: this.region,
      mode: this.mode,
      seed,
      known: new Set(this.save.codex),
      ...(species ? { species } : {}),
    };
    const s = new GameSession(opts);
    this.session = s;
    this.lastSpecies = species;
    this.showWorld(s.world);
    this.camera.snap(s.player.x, s.player.y);
    this.go('briefing');
  }

  private endSession(): void {
    if (!this.session) return;
    this.recordProgress(this.session);
    this.session.dispose();
    this.session = null;
  }

  private recordProgress(s: GameSession): void {
    const codex = new Set(this.save.codex);
    for (const id of s.discoveries) codex.add(id);
    this.save.codex = [...codex];
    const best = this.save.best[s.mode.id] ?? 0;
    if (s.score > best) this.save.best[s.mode.id] = s.score;
    writeSave(this.save);
  }

  private showWorld(w: World): void {
    if (this.renderedWorld === w) return;
    this.renderedWorld = w;
    this.renderer = new WorldRenderer(w);
  }

  // ---- loop --------------------------------------------------------------

  private update(dt: number): void {
    this.time += dt;
    const scr = this.machine.current;
    const s = this.session;
    const inp = this.input;

    if (inp.wasPressed('KeyM')) {
      this.setMuted(!this.save.muted);
      if (scr === 'paused') this.mount();
    }

    if (scr === 'playing' && s) {
      if (inp.wasPressed('Escape') || inp.wasPressed('KeyP')) {
        this.go('paused');
      } else if (inp.wasPressed('Tab') && s.mode.usesEvolution && s.outcome === 'playing') {
        this.go('shop');
      } else {
        if (inp.wasPressed('KeyC')) this.setCues(!this.save.cues);
        this.writePlayerInput(s);
        s.update(dt);
        if (s.outcome !== 'playing') this.handleOutcome(s, dt);
      }
    } else if ((scr === 'paused' && (inp.wasPressed('Escape') || inp.wasPressed('KeyP'))) ||
      (scr === 'shop' && (inp.wasPressed('Escape') || inp.wasPressed('Tab')))) {
      this.resume();
    } else if (!OVERLAY_SCREENS.has(scr) && scr !== 'briefing') {
      // Attract mode: the reef lives on behind the menus.
      this.attract.step(dt);
      const back = ESCAPE_BACK[scr];
      if (back && inp.wasPressed('Escape')) this.go(back);
      if (scr === 'help' && inp.wasPressed('Escape')) this.go(this.previous === 'paused' ? 'paused' : 'title');
    }
    inp.endFrame();
  }

  private writePlayerInput(s: GameSession): void {
    const w = s.world.input;
    const p = s.player;
    let [x, y] = this.input.keyAxis();
    if (this.input.mouseDown) {
      const dx = this.input.mouseX - (p.x - this.camera.x);
      const dy = this.input.mouseY - (p.y - this.camera.y);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 4) {
        x = dx / d;
        y = dy / d;
      }
    }
    w.x = x;
    w.y = y;
    w.burst = this.input.burst;
  }

  private handleOutcome(s: GameSession, dt: number): void {
    this.outcomeTimer += dt;
    if (this.outcomeTimer < OUTCOME_DELAY) return;
    this.outcomeTimer = 0;
    if (s.outcome === 'stageClear' || (s.outcome === 'dead' && s.canRetry)) {
      this.recordProgress(s);
      this.go('stageEnd');
    } else {
      if (s.outcome === 'won') this.sfx('win');
      this.recordProgress(s);
      this.go('results');
    }
  }

  private render(alpha: number, frameDt: number): void {
    const ctx = this.ctx;
    const scr = this.machine.current;
    const s = this.session;
    const live = s && (scr === 'playing' || scr === 'briefing' || OVERLAY_SCREENS.has(scr));
    if (live && s) {
      this.showWorld(s.world);
      const p = s.player;
      if (scr === 'playing') this.camera.follow(p.x, p.y, p.vx, p.vy, frameDt);
    } else {
      this.showWorld(this.attract);
      // Slow documentary pan along the transect.
      const span = this.region.width - VIEW_W;
      const t = (this.time * 14) % (span * 2);
      this.camera.x = t < span ? t : span * 2 - t;
      this.camera.y = 10 + Math.sin(this.time * 0.1) * 30;
    }
    const frozen = scr !== 'playing' && live;
    this.renderer.draw(ctx, this.camera, frozen ? 1 : alpha, this.time, frozen ? 0 : frameDt, {
      cues: !!live && scr === 'playing' && this.save.cues,
      markPlayer: !!s && s.stageTime < 4,
    });
    if (live && s && scr !== 'briefing') {
      drawHud(ctx, s, this.camera, this.time);
      this.consumeFeedback(s.feedback);
    }
    if (!live || scr === 'briefing') {
      ctx.fillStyle = 'rgba(20,20,32,0.25)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  private consumeFeedback(list: FeedbackEvent[]): void {
    const P = { lime: '#a7f070', white: '#f4f4f4', yellow: '#ffcd75', red: '#b13e53', cyan: '#73eff7', orange: '#ef7d57' };
    for (const f of list) {
      switch (f.kind) {
        case 'eat':
        case 'bigEat':
        case 'invasive':
          this.renderer.puff(f.x, f.y, P.white);
          if (f.text) this.renderer.floatText(f.x, f.y - 6, f.text, f.kind === 'invasive' ? P.lime : P.yellow);
          this.sfx(f.kind === 'eat' ? 'eat' : 'bigEat');
          break;
        case 'graze':
          this.renderer.puff(f.x, f.y, P.lime);
          if (f.text) this.renderer.floatText(f.x, f.y - 6, f.text, P.lime);
          this.sfx('graze');
          break;
        case 'sting':
          this.renderer.puff(f.x, f.y, P.orange);
          this.sfx('sting');
          break;
        case 'hurt':
          if (f.text) this.renderer.floatText(f.x, f.y - 6, f.text, P.white);
          this.sfx('hurt');
          break;
        case 'clean':
          this.renderer.bubbles(f.x, f.y, 4);
          if (f.text) this.renderer.floatText(f.x, f.y - 6, f.text, P.cyan);
          this.sfx('clean');
          break;
        case 'death':
          this.renderer.puff(f.x, f.y, P.red);
          this.renderer.bubbles(f.x, f.y, 8);
          this.sfx('death');
          break;
        case 'discover':
          this.sfx('select');
          break;
        case 'stage':
          this.sfx('win');
          break;
      }
    }
    list.length = 0;
  }

  // ---- layout ------------------------------------------------------------

  private mount(): void {
    const view = SCREENS[this.machine.current];
    this.ui.replaceChildren(view ? view(this) : document.createElement('div'));
    const first = this.ui.querySelector<HTMLElement>('button.btn-primary, button, input');
    if (first && this.machine.current !== 'playing') first.focus({ preventScroll: true });
    else this.canvas.focus?.();
  }

  /** Scale the canvas by the largest whole number that fits the window. */
  private fit(): void {
    const sx = window.innerWidth / VIEW_W;
    const sy = window.innerHeight / VIEW_H;
    const raw = Math.min(sx, sy);
    const scale = raw >= 1 ? Math.floor(raw) : raw;
    this.canvas.style.width = `${Math.round(VIEW_W * scale)}px`;
    this.canvas.style.height = `${Math.round(VIEW_H * scale)}px`;
  }
}
