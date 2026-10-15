/** In-game heads-up display, drawn on the low-res canvas with the bitmap font. */
import { PALETTE } from '../data/palette';
import { VIEW_H, VIEW_W } from '../engine/camera';
import type { Camera } from '../engine/camera';
import { clamp } from '../engine/math';
import type { Outcome, Toast } from '../modes/session';
import type { UpgradeDef } from '../data/schema';
import type { World } from '../sim/world';
import { STAGE_TIME } from '../modes/session';
import { canEat } from '../sim/foodWeb';
import { PARASITE_DANGER, stressAt } from '../sim/systems/metabolism';
import type { Entity } from '../sim/types';
import { upgradeCost } from '../sim/stats';
import { yToMeters } from '../world/depth';
import { CHAR_W, drawText, textWidth } from './font';

const P = PALETTE;
const scratch: Entity[] = [];

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number, color: string): void {
  ctx.fillStyle = P.ink;
  ctx.fillRect(x - 1, y - 1, w + 2, 7);
  ctx.fillStyle = P.charcoal;
  ctx.fillRect(x, y, w, 5);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.round(w * clamp(frac, 0, 1)), 5);
  ctx.fillStyle = 'rgba(244,244,244,0.35)';
  ctx.fillRect(x, y, Math.round(w * clamp(frac, 0, 1)), 1);
}

/**
 * Everything the HUD reads. A single-player GameSession satisfies it as-is;
 * LAN play passes a small adapter.
 */
export interface HudModel {
  readonly player: Entity;
  readonly world: World;
  readonly score: number;
  readonly toasts: readonly Toast[];
  readonly outcome: Outcome;
  readonly cause: string | null;
  readonly mode: { readonly id: string; readonly usesEvolution: boolean; readonly staged: boolean };
  readonly biomass: number;
  readonly upgrades: readonly UpgradeDef[];
  readonly levels: Readonly<Record<string, number>>;
  readonly lives: number;
  readonly stage: number;
  readonly stages: number;
  readonly stageProgress: number;
  readonly stageTime: number;
}

/** Evolution mode: can the player afford at least one more upgrade right now? */
export function canEvolve(s: HudModel): boolean {
  const costs = s.upgrades.filter((u) => (s.levels[u.id] ?? 0) < u.maxLevel).map((u) => upgradeCost(u, s.levels[u.id] ?? 0));
  return costs.length > 0 && s.biomass >= Math.min(...costs);
}

export interface HudOptions {
  /** On-screen touch controls are showing: word hints for taps, not keys. */
  touch?: boolean;
}

export function drawHud(ctx: CanvasRenderingContext2D, s: HudModel, cam: Camera, time: number, opts: HudOptions = {}): void {
  const p = s.player;
  const blink = Math.floor(time * 3) % 2 === 0;
  const sh = { shadow: P.ink };

  // Meters.
  const energy = p.energy / 100;
  drawText(ctx, 'ENERGY', 4, 4, P.cream, sh);
  bar(ctx, 46, 5, 56, energy, energy > 0.5 ? P.seafoam : energy > 0.2 ? P.gold : P.red);
  drawText(ctx, 'HEALTH', 4, 13, P.cream, sh);
  bar(ctx, 46, 14, 56, p.hp / p.maxHp, P.pink);
  if (p.def.kind === 'fish' && !p.def.behavior.cleaner) {
    drawText(ctx, 'PARAS.', 4, 22, P.cream, sh);
    bar(ctx, 46, 23, 56, p.parasites, p.parasites > PARASITE_DANGER ? P.magenta : P.violet);
  }
  drawText(ctx, p.def.name, 4, 32, P.silver, sh);

  // Score, mode extras.
  drawText(ctx, `SCORE ${String(s.score).padStart(6, '0')}`, VIEW_W - 4, 4, P.yellow, { align: 'right', shadow: P.ink });
  if (s.mode.usesEvolution) {
    drawText(ctx, `BIO ${s.biomass}`, VIEW_W - 4, 13, P.lime, { align: 'right', shadow: P.ink });
    if (canEvolve(s) && blink) drawText(ctx, opts.touch ? 'TAP EVOLVE!' : 'TAB: EVOLVE!', VIEW_W - 4, 22, P.cyan, { align: 'right', shadow: P.ink });
  }
  if (s.mode.staged) {
    const label = `STAGE ${s.stage + 1}/${s.stages}`;
    drawText(ctx, label, VIEW_W / 2, 4, P.cream, { align: 'center', shadow: P.ink });
    bar(ctx, VIEW_W / 2 - 40, 13, 80, s.stageProgress, P.cyan);
    const left = Math.max(0, Math.ceil(STAGE_TIME - s.stageTime));
    drawText(ctx, `${left}S`, VIEW_W / 2 + 46, 12, P.silver, sh);
    if (s.mode.id === 'tournament') drawText(ctx, '♥'.repeat(Math.max(0, s.lives)), VIEW_W / 2, 21, P.red, { align: 'center', shadow: P.ink });
  }

  // Location.
  const zone = s.world.terrain.zoneDef(s.world.terrain.zoneAt(p.x, p.y));
  const sal = s.world.terrain.salinityAt(p.x);
  const salLabel = sal < 0.15 ? 'FRESH' : sal < 0.8 ? 'BRACKISH' : 'SALT';
  const loc = `${zone.name}  ${Math.round(yToMeters(p.y))}M  ${salLabel}`;
  drawText(ctx, loc, 4, VIEW_H - 11, P.cream, sh);

  // Warnings, most urgent first.
  const st = stressAt(s.world, p);
  const warnings: [string, string][] = [];
  if (p.energy < 15) warnings.push(['STARVING! EAT SOMETHING', P.red]);
  if (st.salinity > 0) warnings.push([sal > p.def.salinity[1] ? 'TOO SALTY! TURN BACK' : 'TOO FRESH! TURN BACK', P.orange]);
  if (p.parasites > PARASITE_DANGER) warnings.push(['PARASITES! RUB ON SAND OR FIND A CLEANER', P.magenta]);
  if (st.depth > 0.2) warnings.push([yToMeters(p.y) > p.def.depth[1] ? 'TOO DEEP FOR YOU' : 'TOO SHALLOW FOR YOU', P.yellow]);
  const w = warnings[0];
  if (w && blink) drawText(ctx, w[0], VIEW_W / 2, 34, w[1], { align: 'center', shadow: P.ink });
  else if (!w && p.hidden) drawText(ctx, 'HIDDEN', VIEW_W / 2, 34, P.lime, { align: 'center', shadow: P.ink });

  // Off-screen threat arrows.
  const cx = cam.x;
  const cy = cam.y;
  for (const o of s.world.near(p.x, p.y, 260, scratch)) {
    if (!o.alive || o === p || !canEat(o, p)) continue;
    const sx = o.x - cx;
    const sy = o.y - cy;
    if (sx >= 0 && sx < VIEW_W && sy >= 0 && sy < VIEW_H) continue;
    const ax = clamp(sx, 6, VIEW_W - 10);
    // With touch controls up, right-edge arrows stay above the BURST/PAUSE cluster.
    const ay = clamp(sy, 44, VIEW_H - (opts.touch && ax > VIEW_W - 60 ? 70 : 22));
    const glyph = sx < 0 ? '<' : sx >= VIEW_W ? '>' : sy < 0 ? '▲' : '▼';
    if (blink) drawText(ctx, glyph, ax, ay, P.red, { shadow: P.ink });
  }

  // Toasts.
  let ty = VIEW_H - 24;
  for (let i = s.toasts.length - 1; i >= 0; i--) {
    const t = s.toasts[i];
    if (!t) continue;
    const txt = t.text.toUpperCase();
    const tw = textWidth(txt);
    ctx.fillStyle = 'rgba(20,20,32,0.7)';
    ctx.fillRect(Math.round(VIEW_W / 2 - tw / 2 - 3), ty - 2, tw + 6, 11);
    drawText(ctx, txt, VIEW_W / 2, ty, t.color, { align: 'center' });
    ty -= 12;
  }

  // Death / stage banners.
  if (s.outcome === 'dead') banner(ctx, s.cause ?? 'YOU DIED', P.red);
  else if (s.outcome === 'stageClear') banner(ctx, 'STAGE CLEAR!', P.lime);
  else if (s.outcome === 'won') banner(ctx, 'YOU CONQUERED THE FOOD CHAIN!', P.yellow);
}

function banner(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  const t = text.toUpperCase();
  const w = Math.min(VIEW_W - 8, t.length * CHAR_W + 16);
  ctx.fillStyle = 'rgba(20,20,32,0.8)';
  ctx.fillRect(Math.round(VIEW_W / 2 - w / 2), VIEW_H / 2 - 10, w, 20);
  drawText(ctx, t, VIEW_W / 2, VIEW_H / 2 - 3, color, { align: 'center', shadow: P.ink });
}
