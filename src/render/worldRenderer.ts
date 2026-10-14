/**
 * Draws the world onto the 384x216 low-res canvas: sky, water, light rays,
 * parallax ridge, terrain, props, creatures, food-web cues, depth darkness,
 * bioluminescence and particles. Render-only state (particles) lives here;
 * the simulation is read, never written.
 */
import { PALETTE, mixHex } from '../data/palette';
import { Camera, VIEW_H, VIEW_W } from '../engine/camera';
import { clamp } from '../engine/math';
import { yToMeters } from '../world/depth';
import { COL_W, SALINITY_BLEND } from '../world/terrain';
import type { Decor } from '../world/terrain';
import type { World } from '../sim/world';
import type { Entity } from '../sim/types';
import { relation } from '../sim/foodWeb';
import { noticeRange } from '../sim/systems/ai';
import { drawSprite, spriteFor } from './spriteCache';
import { drawText } from './font';

const P = PALETTE;
const DARK_STEPS = 32;
const DARKNESS = Array.from({ length: DARK_STEPS + 1 }, (_, i) => `rgba(8,10,28,${((i / DARK_STEPS) * 0.9).toFixed(3)})`);

interface Particle {
  kind: 'bubble' | 'puff' | 'text';
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  text?: string;
}

const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export interface DrawOptions {
  /** Show eat/danger cues around the player. */
  cues: boolean;
  /** Blink the player marker (e.g. at spawn). */
  markPlayer: boolean;
}

/** Radii (px) of the stepped light pool around the player in dark water. */
const LIGHT_RINGS = [78, 60, 44, 30];

export class WorldRenderer {
  private readonly waterCols: string[] = [];
  private readonly particles: Particle[] = [];
  private readonly scratch: Entity[] = [];
  private ventTimer = 0;
  private readonly decor: Decor[];
  private darkLayer: HTMLCanvasElement | null = null;

  constructor(private readonly world: World) {
    const t = world.terrain;
    const surface = world.region.zones.filter((z) => z.id !== 'deep').slice().sort((a, b) => a.x[0] - b.x[0]);
    const half = SALINITY_BLEND / 2;
    for (let x = 0; x < t.width; x += 8) {
      let color: string = P.blue;
      for (let i = 0; i < surface.length; i++) {
        const z = surface[i];
        if (!z) continue;
        const next = surface[i + 1];
        if (next && x >= z.x[1] - half && x <= z.x[1] + half) {
          color = mixHex(P[z.water], P[next.water], (x - (z.x[1] - half)) / SALINITY_BLEND);
          break;
        }
        if (x < z.x[1] || !next) {
          color = P[z.water];
          break;
        }
      }
      this.waterCols.push(color);
    }
    this.decor = t.decor.slice().sort((a, b) => a.x - b.x);
  }

  // ---- particles ---------------------------------------------------------

  bubbles(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.particles.push({ kind: 'bubble', x: x + (Math.random() - 0.5) * 6, y, vx: 0, vy: -12 - Math.random() * 14, life: 0, max: 3 + Math.random() * 2, color: P.white });
    }
  }

  puff(x: number, y: number, color: string): void {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.particles.push({ kind: 'puff', x, y, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, life: 0, max: 0.35, color });
    }
  }

  floatText(x: number, y: number, text: string, color: string): void {
    this.particles.push({ kind: 'text', x, y, vx: 0, vy: -14, life: 0, max: 1.1, color, text });
  }

  // ---- main draw ---------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, cam: Camera, alpha: number, time: number, frameDt: number, opts: DrawOptions): void {
    const cx = Math.round(cam.x);
    const cy = Math.round(cam.y);
    this.drawBackdrop(ctx, cx, cy, time, frameDt);
    this.drawDecor(ctx, cx, cy, time, false);
    this.drawEntities(ctx, cx, cy, alpha, time, opts);
    this.drawDecor(ctx, cx, cy, time, true);
    this.drawTerrain(ctx, cx, cy);
    this.drawDarkness(ctx, cx, cy, alpha);
    this.drawGlow(ctx, cx, cy, alpha);
    this.drawSnow(ctx, cy, time);
    this.updateParticles(ctx, cx, cy, frameDt, time);
    if (opts.cues) this.drawCues(ctx, cx, cy, alpha, time);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, frameDt: number): void {
    const t = this.world.terrain;
    const surf = -cy; // screen y of the water surface
    if (surf > 0) {
      ctx.fillStyle = P.sky;
      ctx.fillRect(0, 0, VIEW_W, surf);
      ctx.fillStyle = P.white;
      for (let i = 0; i < 6; i++) {
        const w = 18 + Math.floor(hash(i) * 30);
        const x = Math.round((hash(i + 50) * 1400 - cx * 0.2 + time * 2) % 1400) - 100;
        const y = 3 + Math.floor(hash(i + 9) * Math.max(1, surf - 12));
        if (x > -w && x < VIEW_W && y < surf - 4) {
          ctx.fillRect(x, y, w, 3);
          ctx.fillRect(x + 4, y - 2, w - 10, 2);
        }
      }
    }
    // Water columns.
    const top = Math.max(0, surf);
    const startCol = Math.floor(cx / 8);
    for (let i = 0; i <= VIEW_W / 8 + 1; i++) {
      const col = startCol + i;
      ctx.fillStyle = this.waterCols[clamp(col, 0, this.waterCols.length - 1)] ?? P.blue;
      ctx.fillRect(col * 8 - cx, top, 8, VIEW_H - top);
    }
    // Light rays in the sunlit band.
    if (cy < 140) {
      ctx.fillStyle = 'rgba(244,244,244,0.07)';
      for (let r = 0; r < 6; r++) {
        const base = Math.floor(hash(r + 100) * 1600);
        const x0 = ((base - cx * 0.7 + Math.sin(time * 0.3 + r) * 10) % 1600) - 200;
        const len = 90 + Math.floor(hash(r + 7) * 60);
        for (let k = 0; k < len; k += 2) {
          const y = surf + k;
          if (y < 0 || y >= VIEW_H) continue;
          ctx.fillRect(Math.round(x0 + k * 0.45), y, 10 - Math.floor(k / 24), 2);
        }
      }
    }
    // Distant ridge (parallax).
    for (let sx = 0; sx < VIEW_W; sx += 4) {
      const wx = cx * 0.6 + sx + 300;
      const ry = t.floorAt(wx) - 26 + Math.sin(wx * 0.021) * 7 + Math.sin(wx * 0.007) * 10;
      const sy = Math.round(ry - cy);
      if (sy >= VIEW_H) continue;
      const base = this.waterCols[clamp(Math.floor((cx + sx) / 8), 0, this.waterCols.length - 1)] ?? P.blue;
      ctx.fillStyle = mixHex(base, P.ink, 0.22);
      ctx.fillRect(sx, Math.max(top, sy), 4, VIEW_H - Math.max(top, sy));
    }
    // Surface shimmer.
    if (surf >= 0 && surf < VIEW_H) {
      ctx.fillStyle = P.white;
      for (let x = 0; x < VIEW_W; x += 3) {
        const wy = Math.round(Math.sin((x + cx) * 0.15 + time * 2) * 0.8);
        ctx.fillRect(x, surf + wy, 2, 1);
      }
    }
    // Spring vents bubble.
    this.ventTimer -= frameDt;
    if (this.ventTimer <= 0) {
      this.ventTimer = 0.25;
      for (const d of this.decor) {
        if (d.type === 'vent' && d.x > cx - 20 && d.x < cx + VIEW_W + 20) this.bubbles(d.x + 6, d.y - 4, 1);
      }
    }
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const t = this.world.terrain;
    const x0 = Math.floor(cx / COL_W) * COL_W;
    for (let wx = x0; wx < cx + VIEW_W + COL_W; wx += COL_W) {
      const fy = t.floorAt(wx);
      const sy = Math.round(fy - cy);
      if (sy >= VIEW_H) continue;
      const z = t.zoneDef(t.zoneAt(wx, fy - 1));
      const sx = wx - cx;
      ctx.fillStyle = P[z.groundDark];
      ctx.fillRect(sx, sy, COL_W, VIEW_H - sy);
      // Deeper strata get darker, in hard retro bands.
      const s1 = sy + 18 + (Math.floor(wx / 16) % 2);
      if (s1 < VIEW_H) {
        ctx.fillStyle = this.strata(z.groundDark, 1);
        ctx.fillRect(sx, s1, COL_W, VIEW_H - s1);
      }
      const s2 = sy + 46 + (Math.floor(wx / 24) % 3);
      if (s2 < VIEW_H) {
        ctx.fillStyle = this.strata(z.groundDark, 2);
        ctx.fillRect(sx, s2, COL_W, VIEW_H - s2);
      }
      ctx.fillStyle = P[z.ground];
      ctx.fillRect(sx, sy, COL_W, 3);
      const k = Math.floor(wx / COL_W);
      for (let j = 0; j < 3; j++) {
        if (hash(k * 7 + j) < 0.5) ctx.fillRect(sx + Math.floor(hash(k * 13 + j) * COL_W), sy + 4 + j * 3, 1, 1);
      }
    }
  }

  private drawDecor(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, front: boolean): void {
    const lo = cx - 80;
    const hi = cx + VIEW_W + 10;
    // Binary search for the first prop in view.
    let a = 0;
    let b = this.decor.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if ((this.decor[m] as Decor).x < lo) a = m + 1;
      else b = m;
    }
    for (let i = a; i < this.decor.length; i++) {
      const d = this.decor[i] as Decor;
      if (d.x > hi) break;
      const isFront = d.type === 'grass' ? d.variant === 2 : d.type === 'mangrove';
      if (isFront !== front) continue;
      drawProp(ctx, d, d.x - cx, d.y - cy, time);
    }
  }

  private drawEntities(ctx: CanvasRenderingContext2D, cx: number, cy: number, alpha: number, time: number, opts: DrawOptions): void {
    const list: Entity[] = [];
    for (const e of this.world.entities) {
      if (!e.alive) continue;
      if (e.x < cx - 60 || e.x > cx + VIEW_W + 60 || e.y < cy - 40 || e.y > cy + VIEW_H + 40) continue;
      list.push(e);
    }
    const isActor = (e: Entity) => e.def.kind === 'fish' || e.def.kind === 'mammal';
    list.sort((p, q) => {
      const ap = isActor(p) ? 1 : 0;
      const aq = isActor(q) ? 1 : 0;
      if (ap !== aq) return ap - aq;
      if (p.isPlayer !== q.isPlayer) return p.isPlayer ? 1 : -1;
      return q.def.length - p.def.length;
    });
    for (const e of list) {
      const x = e.px + (e.x - e.px) * alpha - cx;
      const y = e.py + (e.y - e.py) * alpha - cy;
      const spr = spriteFor(e.def);
      let frame: number;
      if (isActor(e)) {
        const sp = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        frame = Math.floor(e.age * (2 + sp * 0.1)) % 2;
      } else {
        frame = Math.floor(time * 1.5 + e.id * 0.37) % 2;
      }
      const facing = isActor(e) ? e.facing : 1;
      if (e.isPlayer && e.hidden) ctx.globalAlpha = 0.55;
      drawSprite(ctx, spr, frame, x, y, facing);
      ctx.globalAlpha = 1;
      if (e.stunTimer > 0) drawText(ctx, '*', x, y - spr.h / 2 - 8, Math.floor(time * 8) % 2 ? P.yellow : P.white, { align: 'center' });
      if (e.isPlayer && (opts.markPlayer || e.hidden) && Math.floor(time * 4) % 2 === 0) {
        drawText(ctx, '▼', x, y - spr.h / 2 - 9, P.yellow, { align: 'center', shadow: P.ink });
      }
    }
  }

  /**
   * Depth darkness in 4px bands, with a stepped pool of light around the
   * player so the twilight zone stays playable.
   */
  private drawDarkness(ctx: CanvasRenderingContext2D, cx: number, cy: number, alpha: number): void {
    if (yToMeters(cy + VIEW_H) < 7) return;
    if (!this.darkLayer) {
      this.darkLayer = document.createElement('canvas');
      this.darkLayer.width = VIEW_W;
      this.darkLayer.height = VIEW_H;
    }
    const d = this.darkLayer.getContext('2d');
    if (!d) return;
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, VIEW_W, VIEW_H);
    for (let sy = Math.max(0, -cy); sy < VIEW_H; sy += 4) {
      const m = yToMeters(cy + sy);
      const i = Math.round(clamp((m - 6) / 240, 0, 1) * DARK_STEPS);
      if (i === 0) continue;
      d.fillStyle = DARKNESS[i] ?? DARKNESS[DARK_STEPS] ?? 'black';
      d.fillRect(0, sy, VIEW_W, 4);
    }
    const p = this.world.player;
    if (p && p.alive) {
      const px = Math.round(p.px + (p.x - p.px) * alpha - cx);
      const py = Math.round(p.py + (p.y - p.py) * alpha - cy);
      d.globalCompositeOperation = 'destination-out';
      d.fillStyle = 'rgba(0,0,0,0.32)';
      for (const r of LIGHT_RINGS) {
        d.beginPath();
        d.arc(px, py, r, 0, Math.PI * 2);
        d.fill();
      }
    }
    ctx.drawImage(this.darkLayer, 0, 0);
  }

  private drawGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, alpha: number): void {
    for (const e of this.world.entities) {
      if (!e.alive || !e.def.look?.glow) continue;
      if (e.x < cx - 40 || e.x > cx + VIEW_W + 40 || e.y < cy - 20 || e.y > cy + VIEW_H + 20) continue;
      const spr = spriteFor(e.def);
      const ox = Math.round(e.px + (e.x - e.px) * alpha - cx - spr.w / 2);
      const oy = Math.round(e.py + (e.y - e.py) * alpha - cy - spr.h / 2);
      for (const g of spr.glow) {
        ctx.fillStyle = g.color;
        ctx.fillRect(ox + (e.facing === 1 ? g.x : spr.w - 1 - g.x), oy + g.y, 1, 1);
      }
    }
  }

  private drawSnow(ctx: CanvasRenderingContext2D, cy: number, time: number): void {
    if (cy < 260) return;
    ctx.fillStyle = 'rgba(148,176,194,0.5)';
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(hash(i) * VIEW_W + Math.sin(time * 0.5 + i) * 3);
      const y = Math.floor((hash(i + 200) * VIEW_H + time * (3 + hash(i + 400) * 4)) % VIEW_H);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  private updateParticles(ctx: CanvasRenderingContext2D, cx: number, cy: number, dt: number, time: number): void {
    const ps = this.particles;
    let w = 0;
    for (const p of ps) {
      p.life += dt;
      if (p.life >= p.max) continue;
      if (p.kind === 'bubble') {
        p.x += Math.sin(time * 6 + p.max * 10) * 6 * dt;
        if (p.y <= 2) continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ps[w++] = p;
      const sx = Math.round(p.x - cx);
      const sy = Math.round(p.y - cy);
      if (sx < -40 || sx > VIEW_W + 40 || sy < -10 || sy > VIEW_H + 10) continue;
      if (p.kind === 'text' && p.text) {
        drawText(ctx, p.text, sx, sy, p.color, { align: 'center', shadow: P.ink });
      } else if (p.kind === 'bubble') {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx, sy, 1, 1);
        if (p.max > 4) ctx.fillRect(sx + 1, sy - 1, 1, 1);
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx, sy, 1, 1);
      }
    }
    ps.length = w;
  }

  /** Food-web cues: green marks on things the player can eat, red on threats that have noticed them. */
  private drawCues(ctx: CanvasRenderingContext2D, cx: number, cy: number, alpha: number, time: number): void {
    const p = this.world.player;
    if (!p || !p.alive) return;
    const blink = Math.floor(time * 3) % 2 === 0;
    for (const o of this.world.near(p.x, p.y, 150, this.scratch)) {
      if (o === p || !o.alive) continue;
      const actor = o.def.kind === 'fish' || o.def.kind === 'mammal';
      const rel = relation(p, o);
      const x = Math.round(o.px + (o.x - o.px) * alpha - cx);
      const y = Math.round(o.py + (o.y - o.py) * alpha - cy - o.def.height / 2 - 3);
      if (rel === 'flee' && actor) {
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        if (dx * dx + dy * dy < noticeRange(o, p) ** 2 && blink) drawText(ctx, '!', x, y - 6, P.red, { align: 'center', shadow: P.ink });
      } else if (rel === 'eat' && actor) {
        ctx.fillStyle = P.lime;
        ctx.fillRect(x - 1, y, 3, 1);
        ctx.fillRect(x, y + 1, 1, 1);
      } else if (o.def.behavior.cleaner && p.parasites > 0.3 && blink) {
        drawText(ctx, '+', x, y - 6, P.cyan, { align: 'center', shadow: P.ink });
      }
    }
  }

  private readonly strataCache = new Map<string, string>();

  private strata(key: keyof typeof P, level: number): string {
    const k = `${key}:${level}`;
    let c = this.strataCache.get(k);
    if (!c) {
      c = mixHex(P[key], P.ink, level * 0.16);
      this.strataCache.set(k, c);
    }
    return c;
  }

}

// ---- props ---------------------------------------------------------------

function drawProp(ctx: CanvasRenderingContext2D, d: Decor, sx: number, sy: number, time: number): void {
  switch (d.type) {
    case 'rock': {
      const shades = [P.slate, P.grey, P.darkgrey] as const;
      ctx.fillStyle = shades[d.variant % 3] ?? P.slate;
      for (let y = 0; y < d.h; y++) {
        const t = y / d.h;
        const w = Math.round(d.w * Math.sqrt(1 - (1 - t) * (1 - t)));
        ctx.fillRect(sx + Math.round((d.w - w) / 2), sy - d.h + y, w, 1);
      }
      ctx.fillStyle = P.silver;
      ctx.fillRect(sx + Math.round(d.w * 0.35), sy - d.h + 1, Math.max(1, Math.round(d.w * 0.25)), 1);
      break;
    }
    case 'vent': {
      ctx.fillStyle = P.cream;
      ctx.fillRect(sx, sy - 2, d.w, 2);
      ctx.fillRect(sx + 2, sy - 4, d.w - 4, 2);
      ctx.fillStyle = P.tan;
      ctx.fillRect(sx + 5, sy - 4, 2, 2);
      break;
    }
    case 'grass': {
      const sway = Math.round(Math.sin(time * 1.6 + d.x * 0.3) * 1.5);
      ctx.fillStyle = d.variant === 1 ? P.forest : d.variant === 2 ? P.moss : P.seafoam;
      const half = Math.floor(d.h / 2);
      ctx.fillRect(sx, sy - half, 1, half);
      ctx.fillRect(sx + sway, sy - d.h, 1, d.h - half);
      break;
    }
    case 'log': {
      ctx.fillStyle = P.bark;
      ctx.fillRect(sx, sy - d.h, d.w, d.h);
      ctx.fillStyle = P.brown;
      ctx.fillRect(sx, sy - d.h, d.w, 2);
      ctx.fillStyle = P.moss;
      for (let i = 0; i < d.w; i += 5) ctx.fillRect(sx + i, sy - d.h - 1, 2, 1);
      break;
    }
    case 'mangrove': {
      // d.y is the canopy top in world space (above the surface); sy is its screen y.
      const trunkX = sx + Math.floor(d.w / 2);
      const surf = sy - d.y; // screen y of the water surface
      ctx.fillStyle = P.forest;
      ctx.fillRect(sx - 6, sy + 4, d.w + 12, 10);
      ctx.fillStyle = P.moss;
      ctx.fillRect(sx - 2, sy, d.w + 4, 6);
      ctx.fillStyle = P.seafoam;
      for (let i = 0; i < d.w + 8; i += 6) ctx.fillRect(sx - 4 + i, sy + ((i / 6) % 2), 3, 1);
      ctx.fillStyle = P.bark;
      ctx.fillRect(trunkX - 2, sy + 12, 4, surf - sy - 10);
      // Prop roots arch from the trunk down into the mud.
      const bottom = sy + d.h;
      const len = bottom - surf;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const bx = sx + Math.round((i / (n - 1)) * (d.w - 1));
        for (let k = 0; k <= len; k++) {
          const y = surf + k;
          if (y < 0 || y >= VIEW_H) continue;
          const t = k / len;
          ctx.fillRect(Math.round(trunkX + (bx - trunkX) * Math.sin(t * Math.PI * 0.5)), y, 1, 1);
        }
      }
      break;
    }
    case 'brainCoral': {
      const c = d.variant === 0 ? P.yellow : d.variant === 1 ? P.tan : P.olive;
      for (let y = 0; y < d.h; y++) {
        const t = 1 - y / d.h;
        const w = Math.round(d.w * Math.sqrt(1 - t * t));
        ctx.fillStyle = c;
        ctx.fillRect(sx + Math.round((d.w - w) / 2), sy - y - 1, w, 1);
        if (y % 2 === 0 && w > 4) {
          ctx.fillStyle = P.brown;
          ctx.fillRect(sx + Math.round((d.w - w) / 2) + 1 + (y % 4), sy - y - 1, Math.max(1, w - 4), 1);
        }
      }
      break;
    }
    case 'elkhorn': {
      const c = d.variant === 1 ? P.rust : P.orange;
      ctx.fillStyle = c;
      const mid = sx + Math.floor(d.w / 2);
      ctx.fillRect(mid - 1, sy - d.h, 3, d.h);
      for (let k = 0; k < 3; k++) {
        const by = sy - Math.round(d.h * (0.35 + k * 0.2));
        const len = Math.round(d.w / 2 - k * 2);
        const dir = k % 2 === 0 ? -1 : 1;
        for (let i = 0; i < len; i++) ctx.fillRect(mid + dir * i, by - Math.floor(i / 2), 2, 2);
      }
      ctx.fillStyle = P.yellow;
      ctx.fillRect(mid, sy - d.h, 1, 1);
      break;
    }
    case 'seaFan': {
      ctx.fillStyle = d.variant === 1 ? P.violet : P.magenta;
      const mid = sx + Math.floor(d.w / 2);
      ctx.fillRect(mid, sy - 3, 1, 3);
      for (let y = 3; y < d.h; y++) {
        const t = y / d.h;
        const w = Math.round(d.w * Math.sin(t * Math.PI * 0.85));
        for (let x = 0; x < w; x++) {
          if ((x + y) % 2 === 0) ctx.fillRect(mid - Math.floor(w / 2) + x, sy - y, 1, 1);
        }
      }
      break;
    }
  }
}
