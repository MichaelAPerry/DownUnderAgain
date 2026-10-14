/**
 * One play-through. Owns the World, applies the mode's rules (goals, stages,
 * lives, Evolution biomass) and turns sim events into score, toasts and
 * codex discoveries. Pure logic: no DOM, so it is unit-testable.
 */
import type { SpeciesDef, UpgradeDef } from '../data/schema';
import type { Region } from '../data/regions/florida';
import type { ModeId } from '../app/save';
import { UPGRADES } from '../data/upgrades';
import { Rng } from '../engine/rng';
import { World } from '../sim/world';
import type { DeathCause, Entity } from '../sim/types';
import { effectiveStats, upgradeCost } from '../sim/stats';
import type { UpgradeLevels } from '../sim/stats';
import { isGrazed } from '../sim/foodWeb';

export interface ModeInfo {
  id: ModeId;
  title: string;
  blurb: string;
  usesEvolution: boolean;
  staged: boolean;
}

export const MODES: Record<ModeId, ModeInfo> = {
  freeSwim: {
    id: 'freeSwim',
    title: 'Free Swim',
    blurb: 'Pick any fish and survive as long as you can on the living reef.',
    usesEvolution: false,
    staged: false,
  },
  evolution: {
    id: 'evolution',
    title: 'Evolution',
    blurb: 'Eat to earn Biomass, then mutate mid-run: faster fins, bigger jaws, spines and more.',
    usesEvolution: true,
    staged: false,
  },
  tournament: {
    id: 'tournament',
    title: 'Tournament',
    blurb: 'Climb the whole food chain, from a tiny mosquitofish to the great hammerhead. 3 lives.',
    usesEvolution: false,
    staged: true,
  },
  challenge: {
    id: 'challenge',
    title: 'Challenge',
    blurb: 'Four random fish, smallest to largest. One life. How far can you get?',
    usesEvolution: false,
    staged: true,
  },
};

/** Stage goal: gain this much energy in meals (300% = three full bellies)... */
export const STAGE_GROWTH = 300;
/** ...or survive this many seconds. */
export const STAGE_TIME = 120;
export const TOURNAMENT_LIVES = 3;
const CODEX_RADIUS = 90;
const CODEX_TOAST = 'Codex: ';

export type Outcome = 'playing' | 'dead' | 'stageClear' | 'won';

export interface Toast {
  text: string;
  color: string;
  ttl: number;
}

export interface FeedbackEvent {
  kind: 'eat' | 'graze' | 'bigEat' | 'sting' | 'hurt' | 'clean' | 'death' | 'discover' | 'stage' | 'invasive';
  x: number;
  y: number;
  text?: string;
}

export interface RunSummary {
  mode: ModeId;
  speciesName: string;
  score: number;
  time: number;
  meals: number;
  stage: number;
  stages: number;
  cause: string | null;
  won: boolean;
  invasivesRemoved: number;
  discoveries: string[];
}

/** Build the species ladder for staged modes. */
export function buildLadder(mode: ModeId, playable: readonly SpeciesDef[], seed: number): SpeciesDef[] {
  const bySize = playable.slice().sort((a, b) => a.length * a.height - b.length * b.height || a.id.localeCompare(b.id));
  if (mode === 'tournament') return bySize;
  if (mode === 'challenge') {
    const rng = new Rng(seed ^ 0x5eed);
    // One random fish from each size quartile, so the four always grow.
    const q = Math.ceil(bySize.length / 4);
    const out: SpeciesDef[] = [];
    for (let i = 0; i < 4; i++) {
      const band = bySize.slice(i * q, Math.min(bySize.length, (i + 1) * q));
      if (band.length) out.push(rng.pick(band));
    }
    return out;
  }
  return [];
}

export function describeCause(cause: DeathCause, by: Entity | null): string {
  switch (cause) {
    case 'eaten':
      return by ? `Eaten by a ${by.def.name}` : 'Eaten';
    case 'starved':
      return 'Starved: find food sooner';
    case 'parasites':
      return 'Overrun by parasites';
    case 'salinity':
      return 'The water was too salty or too fresh';
    case 'stung':
      return by ? `Stung by a ${by.def.name}` : 'Stung by venomous spines';
  }
}

export interface SessionOptions {
  region: Region;
  mode: ModeId;
  seed: number;
  /** Species for unstaged modes. */
  species?: SpeciesDef;
  /** Codex ids already discovered (not toasted again). */
  known: ReadonlySet<string>;
  upgrades?: readonly UpgradeDef[];
}

export class GameSession {
  readonly mode: ModeInfo;
  readonly region: Region;
  readonly ladder: SpeciesDef[];
  readonly upgrades: readonly UpgradeDef[];
  world!: World;
  player!: Entity;
  species!: SpeciesDef;
  stage = 0;
  lives: number;
  score = 0;
  /** Energy gained from meals this stage (stage goal). */
  growth = 0;
  stageTime = 0;
  totalTime = 0;
  meals = 0;
  biomass = 0;
  levels: Record<string, number> = {};
  outcome: Outcome = 'playing';
  cause: string | null = null;
  readonly toasts: Toast[] = [];
  readonly feedback: FeedbackEvent[] = [];
  readonly discoveries: string[] = [];
  private readonly known: Set<string>;
  private seed: number;
  private codexTimer = 0;
  private unsub: Array<() => void> = [];
  /** Invasive lionfish eaten by the player this run. */
  invasivesEaten = 0;

  constructor(opts: SessionOptions) {
    this.mode = MODES[opts.mode];
    this.region = opts.region;
    this.seed = opts.seed >>> 0;
    this.known = new Set(opts.known);
    this.upgrades = opts.upgrades ?? UPGRADES;
    this.lives = opts.mode === 'tournament' ? TOURNAMENT_LIVES : 1;
    const playable = opts.region.species.filter((s) => s.playable);
    this.ladder = buildLadder(opts.mode, playable, this.seed);
    const first = this.mode.staged ? this.ladder[0] : opts.species;
    if (!first) throw new Error('no species for session');
    this.beginStage(first);
  }

  get stages(): number {
    return this.mode.staged ? this.ladder.length : 1;
  }

  get stageProgress(): number {
    return Math.min(1, Math.max(this.growth / STAGE_GROWTH, this.stageTime / STAGE_TIME));
  }

  private beginStage(def: SpeciesDef): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.species = def;
    this.world = new World(this.region, (this.seed + this.stage * 7919) >>> 0);
    const { stats, maxHp } = effectiveStats(def, this.upgrades, this.levels);
    const home = def.habitats[0]?.zone ?? 'seagrass';
    this.player = this.world.addPlayer(def, stats, maxHp, home);
    this.growth = 0;
    this.stageTime = 0;
    this.outcome = 'playing';
    this.markSeen(def.id, false);
    const ev = this.world.events;
    this.unsub.push(ev.on('eat', (e) => this.onEat(e.eater, e.prey, e.gain, e.points)));
    this.unsub.push(ev.on('sting', (e) => {
      if (e.attacker === this.player) {
        this.toast(`Ouch! ${e.prey.def.name} spines -${e.damage}`, '#ef7d57');
        this.feedback.push({ kind: 'sting', x: this.player.x, y: this.player.y });
      }
    }));
    this.unsub.push(ev.on('biteFail', (e) => {
      if (e.eater === this.player) this.feedback.push({ kind: 'hurt', x: e.prey.x, y: e.prey.y, text: 'MISS' });
    }));
    this.unsub.push(ev.on('clean', (e) => {
      if (e.client === this.player) {
        this.toast('Cleaned! Parasites removed', '#73eff7');
        this.feedback.push({ kind: 'clean', x: this.player.x, y: this.player.y });
      } else if (e.cleaner === this.player) {
        this.addScore(Math.round(5 + e.gain / 4));
        this.growth += e.gain;
        this.meals++;
        this.feedback.push({ kind: 'clean', x: e.client.x, y: e.client.y, text: 'CLEAN!' });
      }
    }));
    this.unsub.push(ev.on('death', (e) => {
      if (e.entity === this.player) {
        this.cause = describeCause(e.cause, e.by);
        this.feedback.push({ kind: 'death', x: this.player.x, y: this.player.y });
      }
    }));
  }

  private onEat(eater: Entity, prey: Entity, gain: number, points: number): void {
    if (eater !== this.player) return;
    this.meals++;
    this.growth += gain;
    this.addScore(points);
    if (this.mode.usesEvolution) this.biomass += Math.max(1, Math.round(gain / 8));
    const grazed = isGrazed(prey);
    const kind = !prey.def.native ? 'invasive' : grazed ? 'graze' : gain >= 30 ? 'bigEat' : 'eat';
    this.feedback.push({ kind, x: prey.x, y: prey.y, text: `+${points}` });
    if (!prey.def.native) {
      this.invasivesEaten++;
      this.toast(`Invasive ${prey.def.name} removed! x2`, '#a7f070');
    }
  }

  private addScore(n: number): void {
    this.score += n;
  }

  toast(text: string, color: string): void {
    this.toasts.push({ text, color, ttl: 2.6 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  private markSeen(id: string, announce: boolean): void {
    if (this.known.has(id)) return;
    this.known.add(id);
    this.discoveries.push(id);
    // Stay quiet for the first seconds of a dive, when everything is new.
    if (announce && this.stageTime > 3) {
      const def = this.region.all.find((s) => s.id === id);
      if (def) {
        // Only one codex toast at a time; the newest replaces the last.
        const i = this.toasts.findIndex((t) => t.text.startsWith(CODEX_TOAST));
        if (i >= 0) this.toasts.splice(i, 1);
        this.toast(`${CODEX_TOAST}${def.name}`, '#ffcd75');
        this.feedback.push({ kind: 'discover', x: this.player.x, y: this.player.y });
      }
    }
  }

  /** Advance one fixed step. Input must already be written to world.input. */
  update(dt: number): void {
    for (const t of this.toasts) t.ttl -= dt;
    while (this.toasts.length && (this.toasts[0]?.ttl ?? 1) <= 0) this.toasts.shift();
    if (this.outcome !== 'playing') return;

    this.world.step(dt);
    this.totalTime += dt;
    this.stageTime += dt;

    this.codexTimer -= dt;
    if (this.codexTimer <= 0 && this.player.alive) {
      this.codexTimer = 0.5;
      const scratch: Entity[] = [];
      for (const o of this.world.near(this.player.x, this.player.y, CODEX_RADIUS, scratch)) {
        if (o.alive && o !== this.player) this.markSeen(o.def.id, true);
      }
    }

    if (!this.player.alive) {
      this.lives--;
      this.outcome = 'dead';
      return;
    }
    if (this.mode.staged && this.stageProgress >= 1) {
      this.addScore(100 * (this.stage + 1));
      this.outcome = this.stage + 1 >= this.ladder.length ? 'won' : 'stageClear';
      this.feedback.push({ kind: 'stage', x: this.player.x, y: this.player.y });
    }
  }

  get canRetry(): boolean {
    return this.outcome === 'dead' && this.mode.staged && this.lives > 0;
  }

  /** Retry the same stage after a death (staged modes with lives left). */
  retryStage(): void {
    if (!this.canRetry) return;
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.cause = null;
    this.beginStage(this.species);
  }

  nextStage(): void {
    if (this.outcome !== 'stageClear') return;
    this.stage++;
    const next = this.ladder[this.stage];
    if (!next) {
      this.outcome = 'won';
      return;
    }
    this.beginStage(next);
  }

  /** Evolution Mode purchase. Returns false if not allowed or unaffordable. */
  buy(upgradeId: string): boolean {
    if (!this.mode.usesEvolution || this.outcome !== 'playing') return false;
    const u = this.upgrades.find((x) => x.id === upgradeId);
    if (!u) return false;
    const lv = this.levels[u.id] ?? 0;
    if (lv >= u.maxLevel) return false;
    const cost = upgradeCost(u, lv);
    if (this.biomass < cost) return false;
    this.biomass -= cost;
    this.levels[u.id] = lv + 1;
    const { stats, maxHp } = effectiveStats(this.species, this.upgrades, this.levels as UpgradeLevels);
    this.world.setPlayerStats(stats, maxHp);
    return true;
  }

  summary(): RunSummary {
    return {
      mode: this.mode.id,
      speciesName: this.species.name,
      score: this.score,
      time: this.totalTime,
      meals: this.meals,
      stage: this.stage + 1,
      stages: this.stages,
      cause: this.cause,
      won: this.outcome === 'won',
      invasivesRemoved: this.invasivesEaten,
      discoveries: this.discoveries.slice(),
    };
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }
}
