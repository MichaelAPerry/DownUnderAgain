/** LAN extras drawn over the HUD: player name tags and a compact leaderboard. */
import { PALETTE } from '../data/palette';
import { VIEW_W } from '../engine/camera';
import type { Camera } from '../engine/camera';
import type { RosterEntry } from '../net/protocol';
import type { Entity } from '../sim/types';
import { drawText } from './font';

/** Player colours by roster slot (1..6). */
export const SLOT_COLORS: readonly string[] = ['#ffcd75', '#73eff7', '#a7f070', '#f59fbf', '#ef7d57', '#7a5cc4'];

export function slotColor(slot: number): string {
  return SLOT_COLORS[(slot - 1) % SLOT_COLORS.length] ?? PALETTE.white;
}

/**
 * Name tags above other players' fish (not your own), colour-coded by slot.
 * `slotOf` maps a player entity to its roster slot.
 */
export function drawNameTags(
  ctx: CanvasRenderingContext2D,
  entities: readonly Entity[],
  you: Entity | null,
  roster: readonly RosterEntry[],
  slotOf: (e: Entity) => number,
  cam: Camera,
  alpha: number,
): void {
  const names = new Map(roster.map((r) => [r.slot, r.name]));
  for (const e of entities) {
    if (!e.isPlayer || !e.alive || e === you) continue;
    const slot = slotOf(e);
    const name = names.get(slot);
    if (!slot || !name) continue;
    const x = Math.round(e.px + (e.x - e.px) * alpha - cam.x);
    const y = Math.round(e.py + (e.y - e.py) * alpha - cam.y - e.def.height / 2 - 10);
    drawText(ctx, name, x, y, slotColor(slot), { align: 'center', shadow: PALETTE.ink });
  }
}

/** Top-right leaderboard under the score: up to 6 rows, highest score first. */
export function drawLeaderboard(ctx: CanvasRenderingContext2D, roster: readonly RosterEntry[], youSlot: number): void {
  const rows = [...roster].sort((a, b) => b.score - a.score || a.slot - b.slot).slice(0, 6);
  let y = 14;
  for (const r of rows) {
    const color = slotColor(r.slot);
    const label = `${r.slot === youSlot ? '>' : ' '}${r.name.padEnd(10)} ${String(r.score).padStart(5)}`;
    ctx.fillStyle = 'rgba(20,20,32,0.55)';
    ctx.fillRect(VIEW_W - 4 - label.length * 6 - 2, y - 1, label.length * 6 + 3, 9);
    drawText(ctx, label, VIEW_W - 4, y, r.alive ? color : PALETTE.grey, { align: 'right' });
    y += 9;
  }
}
