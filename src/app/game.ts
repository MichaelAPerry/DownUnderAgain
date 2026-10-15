/**
 * The application controller: owns the canvas, loop, input, audio, save data
 * and screen state machine, and implements the AppApi the UI screens use.
 * Menus float over an "attract mode" reef that simulates on its own.
 */
import type { SpeciesDef, ZoneId } from '../data/schema';
import { FLORIDA } from '../data/regions/florida';
import type { Region } from '../data/regions/florida';
import type { CustomFishSpec } from '../data/sandbox';
import { AudioEngine } from '../audio/engine';
import type { Sfx } from '../audio/sfx';
import { SONGS } from '../audio/songs';
import type { SongId } from '../audio/songs';
import { Camera, VIEW_H, VIEW_W } from '../engine/camera';
import { Input } from '../engine/input';
import { GameLoop } from '../engine/loop';
import { GameSession, MODES } from '../modes/session';
import { canEvolve, drawHud } from '../render/hud';
import { WorldRenderer } from '../render/worldRenderer';
import { TitleScene } from '../render/titleScreen';
import { SIM_DT, World } from '../sim/world';
import type { AppApi, LanApi, LanInvite, LanJoin } from './api';
import { LanHost } from '../modes/lanHost';
import { LanClient } from '../modes/lanClient';
import { acceptInvite, createInvite } from '../net/signal';
import { sanitizePlayerName } from '../net/protocol';
import { drawLeaderboard, drawNameTags } from '../render/lanHud';
import type { HudModel } from '../render/hud';
import type { Entity, PlayerInput } from '../sim/types';
import { loadSave, writeSave } from './save';
import type { ModeId, SaveData } from './save';
import { OVERLAY_SCREENS, ScreenMachine } from './screens';
import type { Screen } from './screens';
import { SCREENS } from '../ui/screens';
import { presentFeedback } from './feedback';
import { fitCanvas } from './layout';
import { TouchControls } from '../ui/touch/touchControls';

/** Seconds the death / stage-clear banner shows before the next screen. */
const OUTCOME_DELAY = 1.6;

/** Zone -> background music while swimming there. */
const ZONE_SONG: Record<ZoneId, SongId> = {
  spring: 'freshwater',
  estuary: 'freshwater',
  seagrass: 'reef',
  reef: 'reef',
  dropoff: 'blue',
  deep: 'abyss',
};
/** Seconds a new zone must persist before the music follows (no flip-flopping at borders). */
const ZONE_MUSIC_DELAY = 1.5;

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
  /** On-screen joystick and buttons for phones and tablets. */
  readonly touch: TouchControls;
  private readonly audio = new AudioEngine();
  private readonly title: TitleScene;
  /** Past the "press any key" gate. */
  started = false;
  private lastSong: SongId | null = null;
  private zoneSong: SongId | null = null;
  private zoneSongTimer = 0;
  private lastHover = 0;
  private readonly loop: GameLoop;
  private readonly camera: Camera;
  private attract: World;
  private renderer: WorldRenderer;
  private renderedWorld: World;
  private time = 0;
  private outcomeTimer = 0;
  private lastSpecies: SpeciesDef | null = null;
  /** How many of the session's discoveries are already saved. */
  private savedDiscoveries = 0;
  // ---- LAN state ----
  private lanHost: LanHost | null = null;
  private lanClient: LanClient | null = null;
  private readonly lanListeners = new Set<() => void>();
  private lanSignature = '';
  private lanCodexTimer = 0;
  readonly lan: LanApi = this.makeLanApi();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly ui: HTMLElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    this.save = loadSave(new Set(this.region.all.map((s) => s.id)));
    this.audio.setMuted(this.save.muted);
    this.audio.setMusicOn(this.save.music);
    this.title = new TitleScene(this.region.species.filter((s) => s.length >= 30 || s.id === 'manatee'));
    this.input = new Input(canvas);
    this.touch = new TouchControls(canvas.parentElement ?? document.body, this.input);
    this.camera = new Camera(this.region.width, this.region.height);
    this.attract = new World(this.region, (Date.now() & 0x7fffffff) >>> 0);
    this.renderedWorld = this.attract;
    this.renderer = new WorldRenderer(this.attract);
    this.camera.snap(900, 60);

    // Browsers only allow audio to start inside these user-gesture events.
    const unlock = () => this.audio.unlock();
    for (const ev of ['pointerup', 'touchend', 'click', 'keydown'] as const) window.addEventListener(ev, unlock, { capture: true });
    document.addEventListener('visibilitychange', () => this.audio.setHidden(document.hidden));
    this.wireUiSounds();
    window.addEventListener('resize', () => fitCanvas(canvas, ui));
    fitCanvas(canvas, ui);
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
    this.touch.setScreen(to);
    this.mount();
  }

  sfx(name: Sfx): void {
    this.audio.play(name);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.audio.unlock();
    this.sfx('start');
    this.mount();
  }

  selectMode(mode: ModeId): void {
    this.mode = mode;
    if (MODES[mode].staged) this.startSession(null);
    else this.go('speciesSelect');
  }

  selectSpecies(def: SpeciesDef): void {
    this.startSession(def);
  }

  begin(): void {
    if (!this.session) return;
    this.audio.unlock();
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
    if (this.lanHost || this.lanClient) {
      this.lan.finish();
      return;
    }
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
    this.audio.setMuted(muted);
    writeSave(this.save);
  }

  setMusic(on: boolean): void {
    this.save.music = on;
    this.audio.setMusicOn(on);
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
    this.savedDiscoveries = 0;
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
    this.savedDiscoveries = s.discoveries.length;
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
      if (scr === 'paused' || scr === 'title') this.mount();
    }
    if (scr === 'title' && !this.started && inp.anyPressed()) this.start();

    if (this.lanHost || this.lanClient) {
      this.updateLan(dt);
      this.directMusic(dt);
      inp.endFrame();
      return;
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
        // Save new codex entries right away so closing the tab can't lose them.
        if (s.discoveries.length > this.savedDiscoveries) this.recordProgress(s);
        if (s.outcome !== 'playing') this.handleOutcome(s, dt);
      }
    } else if ((scr === 'paused' && (inp.wasPressed('Escape') || inp.wasPressed('KeyP'))) ||
      (scr === 'shop' && (inp.wasPressed('Escape') || inp.wasPressed('Tab')))) {
      this.resume();
    } else if (!OVERLAY_SCREENS.has(scr) && scr !== 'briefing') {
      // Attract mode: the reef lives on behind the menus.
      this.attract.step(dt);
      const back = ESCAPE_BACK[scr];
      if (back && inp.wasPressed('Escape')) {
        this.sfx('back');
        this.go(back);
      }
      if (scr === 'help' && inp.wasPressed('Escape')) {
        this.sfx('back');
        this.go(this.previous === 'paused' ? 'paused' : 'title');
      }
    }
    this.directMusic(dt);
    inp.endFrame();
  }

  private writePlayerInput(s: GameSession): void {
    Object.assign(s.world.input, this.readInput(s.player));
  }

  /** Current steering input from keys, the touch stick, or mouse-steer relative to `p`. */
  private readInput(p: Entity | null): PlayerInput {
    let [x, y] = this.input.keyAxis();
    const stick = this.input.stick;
    if (stick.active) {
      // Analogue: the sim scales speed by the axis length.
      x = stick.x;
      y = stick.y;
    } else if (this.input.mouseDown && p) {
      const dx = this.input.mouseX - (p.x - this.camera.x);
      const dy = this.input.mouseY - (p.y - this.camera.y);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 4) {
        x = dx / d;
        y = dy / d;
      }
    }
    return { x, y, burst: this.input.burst };
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
    if ((this.lanHost || this.lanClient) && this.renderLan(alpha, frameDt)) return;
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
      // Slow documentary pan along the transect; the title rides the surface to show the sky.
      const span = this.region.width - VIEW_W;
      const t = (this.time * 16) % (span * 2);
      this.camera.x = t < span ? t : span * 2 - t;
      this.camera.y = scr === 'title' ? -24 + Math.sin(this.time * 0.25) * 3 : 10 + Math.sin(this.time * 0.1) * 30;
      if (scr === 'title' && Math.random() < frameDt * 2.5) {
        this.renderer.bubbles(this.camera.x + Math.random() * VIEW_W, this.camera.y + VIEW_H - 4, 1 + Math.floor(Math.random() * 3));
      }
    }
    const frozen = scr !== 'playing' && live;
    this.renderer.draw(ctx, this.camera, frozen ? 1 : alpha, this.time, frozen ? 0 : frameDt, {
      cues: !!live && scr === 'playing' && this.save.cues,
      markPlayer: !!s && s.stageTime < 4,
    });
    if (live && s && scr !== 'briefing') {
      drawHud(ctx, s, this.camera, this.time, { touch: this.touch.active });
      presentFeedback(s.feedback, this.renderer, (n) => this.sfx(n));
    }
    if (s && scr === 'playing') {
      const evolve = s.mode.usesEvolution && s.outcome === 'playing';
      this.touch.frame({ evolve, canEvolve: evolve && canEvolve(s) });
    }
    if (scr === 'title') {
      this.title.draw(ctx, this.time, frameDt, !this.started, document.documentElement.classList.contains('touch-ui'));
    }
    else if (!live || scr === 'briefing') {
      ctx.fillStyle = 'rgba(20,20,32,0.25)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  // ---- LAN ---------------------------------------------------------------

  private makeLanApi(): LanApi {
    // Arrow functions keep `this` bound to the Game.
    const api: LanApi = {
      get role() {
        return self.lanHost ? 'host' : self.lanClient ? 'guest' : 'none';
      },
      get host() {
        return self.lanHost;
      },
      get client() {
        return self.lanClient;
      },
      get playerName() {
        return self.save.name;
      },
      setPlayerName: (name: string) => {
        self.save.name = sanitizePlayerName(name);
        writeSave(self.save);
      },
      hostReef: (fish: SpeciesDef) => {
        self.leaveLan();
        self.endSession();
        const seed = (Math.random() * 0x7fffffff) >>> 0;
        self.lanHost = new LanHost(self.region, seed, self.save.name, fish);
        self.showWorld(self.lanHost.world);
        self.go('lanHost');
        self.notifyLan(true);
      },
      createInvite: async (): Promise<LanInvite> => {
        const host = self.lanHost;
        if (!host) throw new Error('Not hosting a reef.');
        if (host.isFull) throw new Error('The reef is full (6 players).');
        const inv = await createInvite();
        return {
          code: inv.code,
          complete: async (reply: string) => {
            await inv.connected(reply);
            if (self.lanHost !== host) {
              inv.link.pc.close();
              throw new Error('The reef has closed.');
            }
            host.addGuest(inv.link);
            self.notifyLan(true);
          },
          cancel: () => inv.link.pc.close(),
        };
      },
      join: async (inviteCode: string, fish: SpeciesDef): Promise<LanJoin> => {
        self.leaveLan();
        self.endSession();
        const j = await acceptInvite(inviteCode);
        let cancelled = false;
        const connected = j.link.then((link) => {
          if (cancelled) {
            link.pc.close();
            throw new Error('Cancelled.');
          }
          self.lanClient = new LanClient(self.region, link, self.save.name, fish);
          self.notifyLan(true);
        });
        // Callers may ignore `connected`; never leave it as an unhandled rejection.
        connected.catch(() => undefined);
        return {
          reply: j.code,
          connected,
          cancel: () => {
            cancelled = true;
            j.close();
          },
        };
      },
      start: () => {
        const host = self.lanHost;
        if (!host) return;
        host.start();
        const me = host.local.entity;
        if (me) self.camera.snap(me.x, me.y);
        self.go('playing');
        self.notifyLan(true);
      },
      respawn: (fish: SpeciesDef) => {
        if (self.lanHost) {
          self.lanHost.respawnLocal(fish);
          const me = self.lanHost.local.entity;
          if (me) self.camera.snap(me.x, me.y);
          self.go('playing');
        } else if (self.lanClient) {
          self.lanClient.respawn(fish);
        }
        self.notifyLan(true);
      },
      finish: () => {
        if (self.lanHost) self.lanHost.end();
        else if (self.lanClient) self.lanClient.leave();
        else return;
        self.go('lanResults');
        self.notifyLan(true);
      },
      exit: () => {
        self.leaveLan();
        self.showWorld(self.attract);
        self.camera.snap(900, 60);
        self.go('title');
      },
      onChange: (fn: () => void) => {
        self.lanListeners.add(fn);
        return () => self.lanListeners.delete(fn);
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return api;
  }

  /** Close any LAN game (host or guest) without navigating. */
  private leaveLan(): void {
    if (this.lanHost) {
      this.lanHost.dispose();
      this.lanHost = null;
    }
    if (this.lanClient) {
      if (this.lanClient.state !== 'ended' && this.lanClient.state !== 'lost') this.lanClient.leave();
      this.lanClient = null;
    }
    this.lanSignature = '';
  }

  /** Tell LAN screens something changed (roster, connection, state). */
  private notifyLan(force = false): void {
    const h = this.lanHost;
    const c = this.lanClient;
    const sig = JSON.stringify([
      h ? [h.started, h.ended, h.localDeath, h.players.map((p) => [p.slot, p.name, p.ready, p.score, p.fish.id, !!p.entity])] : null,
      c ? [c.state, c.roster, c.deathCause, c.endReason] : null,
    ]);
    if (!force && sig === this.lanSignature) return;
    this.lanSignature = sig;
    for (const fn of [...this.lanListeners]) fn();
  }

  private lanWon(): boolean {
    const roster = this.lanHost?.roster() ?? this.lanClient?.roster ?? [];
    const mySlot = this.lanHost ? 1 : (this.lanClient?.slot ?? 0);
    const top = [...roster].sort((a, b) => b.score - a.score)[0];
    return !!top && top.slot === mySlot && top.score > 0;
  }

  private updateLan(dt: number): void {
    const scr = this.machine.current;
    const inp = this.input;
    const host = this.lanHost;
    const client = this.lanClient;
    // Escape toggles the pause menu, but the shared reef never stops.
    if (scr === 'playing' && (inp.wasPressed('Escape') || inp.wasPressed('KeyP'))) this.go('paused');
    else if (scr === 'paused' && (inp.wasPressed('Escape') || inp.wasPressed('KeyP'))) this.resume();
    else if (scr === 'playing' && inp.wasPressed('KeyC')) this.setCues(!this.save.cues);
    const steering = scr === 'playing';
    if (host) {
      const me = host.local.entity;
      Object.assign(host.world.input, steering && me ? this.readInput(me) : { x: 0, y: 0, burst: false });
      host.update(dt);
      if (host.localDeath && !host.local.entity && scr === 'playing') this.go('lanRespawn');
      this.lanCodex(host.world, host.local.entity, dt);
    } else if (client) {
      const me = client.you;
      client.update(dt, steering && me ? this.readInput(me) : { x: 0, y: 0, burst: false });
      if ((client.state === 'playing' || client.state === 'dead') && scr === 'lanJoin') {
        if (client.you) this.camera.snap(client.you.x, client.you.y);
        this.go(client.state === 'dead' ? 'lanRespawn' : 'playing');
      } else if (client.state === 'dead' && scr === 'playing') this.go('lanRespawn');
      else if (client.state === 'playing' && scr === 'lanRespawn' && client.you) {
        this.camera.snap(client.you.x, client.you.y);
        this.go('playing');
      } else if ((client.state === 'ended' || client.state === 'lost') && scr !== 'lanResults' && scr !== 'title') {
        this.go('lanResults');
      }
      if (client.world) this.lanCodex(client.world, client.you, dt, client.seen);
    }
    this.notifyLan();
  }

  /** Record codex discoveries from LAN play (nearby creatures, or what the host streamed us). */
  private lanCodex(world: World, me: Entity | null, dt: number, seen?: ReadonlySet<string>): void {
    this.lanCodexTimer -= dt;
    if (this.lanCodexTimer > 0) return;
    this.lanCodexTimer = 1;
    const codex = new Set(this.save.codex);
    const before = codex.size;
    if (seen) for (const id of seen) codex.add(id);
    if (me) {
      codex.add(me.def.id);
      for (const o of world.near(me.x, me.y, 90, [])) codex.add(o.def.id);
    }
    if (codex.size > before) {
      this.save.codex = [...codex];
      writeSave(this.save);
    }
  }

  /** Render a LAN game. Returns false when the regular renderer should run instead. */
  private renderLan(alpha: number, frameDt: number): boolean {
    const scr = this.machine.current;
    const host = this.lanHost;
    const client = this.lanClient;
    const world = host?.world ?? client?.world ?? null;
    const inGame = scr === 'playing' || scr === 'paused' || scr === 'lanRespawn' || scr === 'lanResults';
    if (!world || !inGame) return false;
    const ctx = this.ctx;
    const me = host ? host.local.entity : (client?.you ?? null);
    this.showWorld(world);
    if (me && me.alive) this.camera.follow(me.x, me.y, me.vx, me.vy, frameDt);
    const a = client ? client.alpha : alpha;
    this.renderer.draw(ctx, this.camera, a, this.time, frameDt, {
      cues: scr === 'playing' && this.save.cues && !!me,
      markPlayer: false,
    });
    const roster = host ? host.roster() : (client?.roster ?? []);
    const slotOf = (e: Entity) => (host ? host.slotOf(e) : (client?.slotOf(e) ?? 0));
    drawNameTags(ctx, world.entities, me, roster, slotOf, this.camera, a);
    const mySlot = host ? 1 : (client?.slot ?? 0);
    if (me && me.alive && scr !== 'lanResults') {
      const model: HudModel = {
        player: me,
        world,
        score: roster.find((r) => r.slot === mySlot)?.score ?? 0,
        toasts: host ? host.toasts : (client?.toasts ?? []),
        outcome: 'playing',
        cause: null,
        mode: { id: 'lan', usesEvolution: false, staged: false },
        biomass: 0,
        upgrades: [],
        levels: {},
        lives: 0,
        stage: 0,
        stages: 1,
        stageProgress: 0,
        stageTime: 99,
      };
      drawHud(ctx, model, this.camera, this.time, { touch: this.touch.active });
    }
    if (scr !== 'lanResults') drawLeaderboard(ctx, roster, mySlot);
    presentFeedback(host ? host.feedback : (client?.feedback ?? []), this.renderer, (n) => this.sfx(n));
    if (scr === 'playing') this.touch.frame({ evolve: false, canEvolve: false });
    return true;
  }

  // ---- audio -------------------------------------------------------------

  /** Which song fits the current screen (and, while swimming, the zone). */
  private directMusic(dt: number): void {
    const scr = this.machine.current;
    const s = this.session;
    let want: SongId | null = 'title';
    const lanWorld = this.lanHost?.world ?? this.lanClient?.world ?? null;
    const lanMe = this.lanHost?.local.entity ?? this.lanClient?.you ?? null;
    const swimming = scr === 'playing' || scr === 'paused' || scr === 'shop' || scr === 'briefing' || scr === 'lanRespawn';
    if (lanWorld && swimming && lanMe) {
      want = this.followZoneSong(ZONE_SONG[lanWorld.terrain.zoneAt(lanMe.x, lanMe.y)], dt, false);
    } else if (lanWorld && swimming) {
      want = this.zoneSong ?? 'title';
    } else if (scr === 'lanResults') {
      want = this.lanWon() ? 'victory' : 'gameOver';
    } else if (s && (scr === 'playing' || scr === 'paused' || scr === 'shop' || scr === 'briefing')) {
      const p = s.player;
      want = this.followZoneSong(ZONE_SONG[s.world.terrain.zoneAt(p.x, p.y)], dt, scr === 'briefing');
    } else if (s && scr === 'stageEnd') {
      want = s.outcome === 'stageClear' ? 'stageClear' : 'gameOver';
    } else if (s && scr === 'results') {
      want = s.outcome === 'won' ? 'victory' : 'gameOver';
    } else {
      this.zoneSong = null;
    }
    this.audio.duck(scr === 'paused' || scr === 'shop');
    if (!this.started) want = null;
    if (want !== this.lastSong) {
      this.lastSong = want;
      if (want) this.audio.playSong(SONGS[want], { restart: true, fade: 0.8 });
      else this.audio.stopSong();
    }
  }

  /** Follow the zone's song, switching only after the new zone has held for a moment. */
  private followZoneSong(zoneSong: SongId, dt: number, immediate: boolean): SongId {
    if (this.zoneSong === null || immediate) {
      this.zoneSong = zoneSong;
      this.zoneSongTimer = 0;
    } else if (zoneSong !== this.zoneSong) {
      this.zoneSongTimer += dt;
      if (this.zoneSongTimer >= ZONE_MUSIC_DELAY) {
        this.zoneSong = zoneSong;
        this.zoneSongTimer = 0;
      }
    } else this.zoneSongTimer = 0;
    return this.zoneSong;
  }

  /**
   * One sound policy for every menu: a soft tick on hover, "confirm" for
   * primary and card buttons, "back" for back buttons, "select" otherwise.
   * A button can override with data-sfx="<name>" or opt out with data-sfx="none".
   */
  private wireUiSounds(): void {
    const soundFor = (b: HTMLElement): Sfx | null => {
      const o = b.dataset.sfx;
      if (o === 'none') return null;
      if (o) return o as Sfx;
      if ((b.textContent ?? '').trim().startsWith('<')) return 'back';
      if (b.classList.contains('btn-primary') || b.classList.contains('card-button')) return 'confirm';
      return 'select';
    };
    this.ui.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      if (!b || b.disabled) return;
      const snd = soundFor(b);
      if (snd) this.sfx(snd);
    });
    this.ui.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement | null)?.closest('button');
      const from = (e.relatedTarget as HTMLElement | null)?.closest?.('button');
      if (!b || b === from || b.disabled) return;
      const now = performance.now();
      if (now - this.lastHover < 40) return;
      this.lastHover = now;
      this.sfx('hover');
    });
  }

  // ---- layout ------------------------------------------------------------

  private mount(): void {
    const view = SCREENS[this.machine.current];
    this.ui.replaceChildren(view ? view(this) : document.createElement('div'));
    const first = this.ui.querySelector<HTMLElement>('button.btn-primary, button, input');
    if (first && this.machine.current !== 'playing') first.focus({ preventScroll: true });
    else this.canvas.focus?.();
  }
}
