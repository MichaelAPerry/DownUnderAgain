/**
 * Draws the world onto the 384x216 low-res canvas: sky, water, light rays,
 * parallax silhouettes, baked terrain and props, creatures, food-web cues,
 * depth darkness, bioluminescence and particles. Render-only state
 * (particles, baked chunks) lives here; the simulation is read, never written.
 *
 * Static scenery is painted once into world-space chunks (see env/tiles.ts)
 * and blitted each frame; only grass sway, caustics, rays, the surface and
 * particles are drawn live.
 */
import { PALETTE, mixHex } from '../data/palette';
import { Camera, VIEW_H, VIEW_W } from '../engine/camera';
import { clamp } from '../engine/math';
import { yToMeters } from '../world/depth';
import { SALINITY_BLEND } from '../world/terrain';
import type { Decor } from '../world/terrain';
import type { World } from '../sim/world';
import type { Entity } from '../sim/types';
import { relation } from '../sim/foodWeb';
import { noticeRange } from '../sim/systems/ai';
import { drawSprite, spriteFor } from './spriteCache';
import { drawText } from './font';
import { Env, bakeGround } from './env/ground';
import { makeDecorations, paintDeco, paintDecor, paintMangrove } from './env/props';
import type { Deco } from './env/props';
import { Layer, TILE_H, TILE_W, TileCache } from './env/tiles';
import type { Buf } from './env/pix';
import { ih, vnoise } from './env/pix';
import { PARALLAX, RAY_H, SKY_BAKE_H, STRIP_W, WaterStrips, bakeParallax, makeClouds, makeRays, makeSky, makeSun } from './env/backdrop';

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

const mod = (a: number, m: number): number => ((a % m) + m) % m;

export interface DrawOptions {
  /** Show eat/danger cues around the player. */
  cues: boolean;
  /** Blink the player marker (e.g. at spawn). */
  markPlayer: boolean;
}

/** Radii (px) of the stepped light pool around the player in dark water. */
const LIGHT_RINGS = [78, 60, 44, 30];

/** Margin (px) by which props can overhang their decor x when baking chunks. */
const PROP_MARGIN = 48;

/** One live, swaying grass blade. */
interface Blade {
  x: number;
  base: number;
  h: number;
  wide: boolean;
  phase: number;
  amp: number;
  front: boolean;
  /** Palette set index: 0 eelgrass, 1 turtle grass, 2 front (shadowed), 3 turtle with epiphyte tip. */
  set: number;
}

const BLADE_SETS: readonly (readonly string[])[] = [
  // dark base, mid, light, tip
  [P.forest, mixHex(P.seafoam, P.forest, 0.45), P.seafoam, P.lime],
  [P.forest, P.seafoam, mixHex(P.seafoam, P.lime, 0.45), P.lime],
  [mixHex(P.forest, P.ink, 0.3), P.forest, P.moss, P.olive],
  [P.forest, P.seafoam, mixHex(P.seafoam, P.lime, 0.45), P.tan],
];

export class WorldRenderer {
  private readonly waterCols: string[] = [];
  private readonly particles: Particle[] = [];
  private readonly scratch: Entity[] = [];
  private ventTimer = 0;
  private readonly decor: Decor[];
  private darkLayer: HTMLCanvasElement | null = null;
  private readonly env: Env;
  private readonly tiles: TileCache;
  private readonly strips: WaterStrips;
  private readonly decos: Deco[];
  private readonly mangroves: Decor[];
  private readonly blades: Blade[] = [];
  private sky: HTMLCanvasElement | null = null;
  private sun: HTMLCanvasElement | null = null;
  private clouds: HTMLCanvasElement[] = [];
  private rays: HTMLCanvasElement[] = [];

  constructor(private readonly world: World) {
    const t = world.terrain;
    const surface = world.region.zones.filter((z) => z.id !== 'deep').slice().sort((a, b) => a.x[0] - b.x[0]);
    const half = SALINITY_BLEND / 2;
    for (let x = 0; x < t.width; x += STRIP_W) {
      let color: string = P.blue;
      for (let i = 0; i < surface.length; i++) {
        const z = surface[i];
        if (!z) continue;
        const next = surface[i + 1];
        if (next && x >= z.x[1] - half && x <= z.x[1] + half) {
          // Quantised blend so only a handful of gradient strips get baked.
          const k = Math.round(((x - (z.x[1] - half)) / SALINITY_BLEND) * 6) / 6;
          color = mixHex(P[z.water], P[next.water], k);
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
    this.env = new Env(t, world.region.zones);
    this.strips = new WaterStrips(t.height);
    this.decos = makeDecorations(this.env).sort((a, b) => a.x - b.x);
    this.mangroves = this.decor.filter((d) => d.type === 'mangrove');
    this.buildBlades();
    const env = this.env;
    const half2 = VIEW_W / 2;
    this.tiles = new TileCache([
      (buf) => bakeParallax(env, buf, false, half2),
      (buf) => bakeParallax(env, buf, true, half2),
      (buf) => this.bakeBack(buf),
      (buf) => this.bakeFront(buf),
    ]);
  }

  /** Baked-chunk stats (for profiling / tests). */
  get cacheStats(): { canvases: number; entries: number; bakes: number; bakeMs: number } {
    return { ...this.tiles.size, bakes: this.tiles.totalBakes, bakeMs: Math.round(this.tiles.bakeMs) };
  }

  private buildBlades(): void {
    for (const d of this.decor) {
      if (d.type !== 'grass') continue;
      const turtle = this.env.zone(d.x) === 'seagrass';
      const front = d.variant === 2;
      const n = 2 + (ih(d.x, 0, 501) < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const x = d.x + (turtle ? k * 2 - 1 : k - 1) + (ih(d.x, k, 502) < 0.3 ? 1 : 0);
        const h = Math.max(4, Math.round(d.h * (0.6 + ih(d.x, k, 503) * 0.45)));
        let set = turtle ? 1 : 0;
        if (front) set = 2;
        else if (turtle && ih(d.x, k, 504) < 0.3) set = 3;
        this.blades.push({ x, base: this.env.F(x) + 1, h, wide: turtle, phase: d.x * 0.3 + k * 0.9, amp: 1.2 + ih(d.x, k, 505) * 1.4, front, set });
      }
    }
    this.blades.sort((a, b) => a.x - b.x);
  }

  // ---- chunk bakers --------------------------------------------------------

  private bakeBack(buf: Buf): void {
    const lo = buf.x0 - PROP_MARGIN;
    const hi = buf.x0 + buf.w + PROP_MARGIN;
    for (let i = lowerBound(this.decos, lo); i < this.decos.length; i++) {
      const d = this.decos[i] as Deco;
      if (d.x > hi) break;
      paintDeco(buf, this.env, d);
    }
    for (let i = lowerBound(this.decor, lo); i < this.decor.length; i++) {
      const d = this.decor[i] as Decor;
      if (d.x > hi) break;
      if (d.type !== 'mangrove') paintDecor(buf, this.env, d);
    }
  }

  private bakeFront(buf: Buf): void {
    for (const m of this.mangroves) paintMangrove(buf, m);
    bakeGround(this.env, buf);
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
    this.tiles.bakes = 0;
    this.drawBackdrop(ctx, cx, cy, time, frameDt);
    this.drawLayer(ctx, Layer.Back, cx, cy);
    this.drawGrass(ctx, cx, cy, time, false);
    this.drawEntities(ctx, cx, cy, alpha, time, opts);
    this.drawGrass(ctx, cx, cy, time, true);
    this.drawLayer(ctx, Layer.Front, cx, cy);
    this.drawCaustics(ctx, cx, cy, time);
    this.drawSurface(ctx, cx, cy, time);
    this.drawDarkness(ctx, cx, cy, alpha);
    this.drawGlow(ctx, cx, cy, alpha);
    this.drawSnow(ctx, cy, time);
    this.updateParticles(ctx, cx, cy, frameDt, time);
    if (opts.cues) this.drawCues(ctx, cx, cy, alpha, time);
    this.prefetch(cx, cy);
  }

  /** Layer-space origin of the screen for a layer. */
  private origin(layer: Layer, cx: number): number {
    if (layer === Layer.Far) return Math.round(cx * PARALLAX[0]);
    if (layer === Layer.Near) return Math.round(cx * PARALLAX[1]);
    return cx;
  }

  private layerWidth(layer: Layer): number {
    const W = this.env.width;
    if (layer === Layer.Far) return (W - VIEW_W) * PARALLAX[0] + VIEW_W;
    if (layer === Layer.Near) return (W - VIEW_W) * PARALLAX[1] + VIEW_W;
    return W;
  }

  private tileInRange(layer: Layer, tx: number, ty: number): boolean {
    return tx >= 0 && tx * TILE_W < this.layerWidth(layer) && ty >= -1 && ty * TILE_H < this.env.height;
  }

  private drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, cx: number, cy: number): void {
    const ox = this.origin(layer, cx);
    const tx0 = Math.floor(ox / TILE_W);
    const tx1 = Math.floor((ox + VIEW_W - 1) / TILE_W);
    const ty0 = Math.floor(cy / TILE_H);
    const ty1 = Math.floor((cy + VIEW_H - 1) / TILE_H);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!this.tileInRange(layer, tx, ty)) continue;
        const c = this.tiles.get(layer, tx, ty);
        if (c) ctx.drawImage(c, tx * TILE_W - ox, ty * TILE_H - cy);
      }
    }
  }

  /** Bake at most one off-screen neighbour chunk per idle frame, so scrolling never hitches. */
  private prefetch(cx: number, cy: number): void {
    if (this.tiles.bakes > 0) return;
    const ty0 = Math.floor(cy / TILE_H);
    const ty1 = Math.floor((cy + VIEW_H - 1) / TILE_H);
    for (const layer of [Layer.Front, Layer.Back, Layer.Near, Layer.Far]) {
      const ox = this.origin(layer, cx);
      const tx0 = Math.floor((ox - 48) / TILE_W);
      const tx1 = Math.floor((ox + VIEW_W + 48) / TILE_W);
      for (let ty = ty0 - (cy % TILE_H < 40 ? 1 : 0); ty <= ty1 + ((cy + VIEW_H) % TILE_H > TILE_H - 40 ? 1 : 0); ty++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          if (!this.tileInRange(layer, tx, ty) || this.tiles.has(layer, tx, ty)) continue;
          this.tiles.get(layer, tx, ty);
          return;
        }
      }
    }
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, frameDt: number): void {
    const surf = -cy; // screen y of the water surface
    if (surf > 0) this.drawSky(ctx, cx, surf, time);
    // Water: world-anchored dithered gradient strips.
    const top = Math.max(0, surf);
    if (top < VIEW_H) {
      const startCol = Math.floor(cx / STRIP_W);
      const h = VIEW_H - top;
      for (let i = 0; i <= VIEW_W / STRIP_W + 1; i++) {
        const col = startCol + i;
        const base = this.waterCols[clamp(col, 0, this.waterCols.length - 1)] ?? P.blue;
        ctx.drawImage(this.strips.get(base), 0, top + cy, STRIP_W, h, col * STRIP_W - cx, top, STRIP_W, h);
      }
    }
    // Distant silhouettes, two parallax planes.
    this.drawLayer(ctx, Layer.Far, cx, cy);
    this.drawLayer(ctx, Layer.Near, cx, cy);
    // Light rays in the sunlit band.
    if (cy < 150) {
      if (this.rays.length === 0) this.rays = makeRays();
      for (let r = 0; r < 7; r++) {
        const base = Math.floor(hash(r + 100) * 1700);
        const x0 = mod(base - cx * 0.7 + Math.sin(time * 0.3 + r) * 10, 1700) - 220;
        if (x0 > VIEW_W || x0 < -80) continue;
        const img = this.rays[r % this.rays.length];
        if (!img) continue;
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(time * 0.6 + r * 1.7);
        ctx.drawImage(img, Math.round(x0), surf, img.width, Math.min(RAY_H, 90 + Math.floor(hash(r + 7) * 70)) );
      }
      ctx.globalAlpha = 1;
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

  private drawSky(ctx: CanvasRenderingContext2D, cx: number, surf: number, time: number): void {
    if (!this.sky) {
      this.sky = makeSky(VIEW_W);
      this.sun = makeSun();
      this.clouds = makeClouds();
    }
    ctx.drawImage(this.sky, 0, surf - SKY_BAKE_H);
    if (surf > SKY_BAKE_H) {
      ctx.fillStyle = mixHex(P.sky, P.blue, 0.3);
      ctx.fillRect(0, 0, VIEW_W, surf - SKY_BAKE_H);
    }
    if (this.sun) ctx.drawImage(this.sun, Math.round(252 - cx * 0.012) - 9, surf - 31);
    for (let i = 0; i < 6; i++) {
      const img = this.clouds[i % this.clouds.length];
      if (!img) continue;
      const x = Math.round(mod(hash(i + 50) * 1500 - cx * 0.12 + time * 1.5, 1500)) - 100;
      const y = surf - img.height - 4 - Math.floor(hash(i + 9) * 14);
      if (x > -img.width && x < VIEW_W && y + img.height < surf - 2) ctx.drawImage(img, x, y);
    }
    // Hazy far shore (hammock treeline) behind the spring run and estuary.
    const body = mixHex(P.forest, P.sky, 0.5);
    const lit = mixHex(P.moss, P.sky, 0.38);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? body : lit;
      for (let sx = 0; sx < VIEW_W; sx += 2) {
        const wx = cx + sx;
        const fade = clamp((2500 - wx) / 300, 0, 1);
        if (fade <= 0) continue;
        const px = Math.floor((cx * 0.1 + sx) / 2);
        const h = Math.round((3 + 3 * (vnoise(px / 5, 9) * 0.5 + 0.5) + 1.5 * vnoise(px / 1.7, 10)) * fade);
        if (h <= 0) continue;
        if (pass === 0) ctx.fillRect(sx, surf - h, 2, h);
        else ctx.fillRect(sx, surf - h, 2, 1);
      }
    }
  }

  /** Live grass: eelgrass ribbons and turtle-grass blades swaying in segments. */
  private drawGrass(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number, front: boolean): void {
    const lo = cx - 6;
    const hi = cx + VIEW_W + 6;
    const a = lowerBound(this.blades, lo);
    for (let pass = 0; pass < 4; pass++) {
      let style = '';
      for (let i = a; i < this.blades.length; i++) {
        const b = this.blades[i] as Blade;
        if (b.x > hi) break;
        if (b.front !== front) continue;
        const sy = b.base - cy;
        if (sy - b.h > VIEW_H || sy < 0) continue;
        const set = BLADE_SETS[b.set] ?? BLADE_SETS[0]!;
        const c = set[pass] ?? P.forest;
        if (c !== style) {
          ctx.fillStyle = c;
          style = c;
        }
        const sway = Math.sin(time * 1.6 + b.phase) * b.amp;
        const sx = b.x - cx;
        const bw = b.wide ? 2 : 1;
        if (pass === 3) {
          const off = Math.round(sway);
          ctx.fillRect(sx + off, sy - b.h, 1, 1);
          continue;
        }
        // Segment k of 4 (0 = base); pass 0 draws seg 0, pass 1 segs 1-2, pass 2 seg 3 / the lit edge.
        const k0 = pass === 0 ? 0 : pass === 1 ? 1 : 3;
        const k1 = pass === 1 ? 2 : k0;
        for (let k = k0; k <= k1; k++) {
          const ya = Math.round(sy - (b.h * (k + 1)) / 4);
          const yb = Math.round(sy - (b.h * k) / 4);
          const off = Math.round(sway * ((k + 0.5) / 4) ** 1.5);
          ctx.fillRect(sx + off, ya, bw, yb - ya);
        }
        if (pass === 2 && b.wide) {
          // Lit left edge along the middle of turtle-grass blades.
          const ya = Math.round(sy - (b.h * 3) / 4);
          const yb = Math.round(sy - b.h / 4);
          ctx.fillRect(sx + Math.round(sway * 0.3), ya, 1, yb - ya);
        }
      }
    }
  }

  /** Dancing caustic light on the sunlit sand. */
  private drawCaustics(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    if (cy > 120) return;
    ctx.fillStyle = 'rgba(244,244,244,0.26)';
    for (let sx = 0; sx < VIEW_W; sx += 2) {
      const wx = cx + sx;
      const f = this.env.F(wx);
      if (f > 240) continue;
      const sy = f - cy;
      if (sy < 0 || sy >= VIEW_H) continue;
      const murky = wx > 1200 && wx < 2400;
      const thr = murky ? 1.75 : 1.3;
      for (let k = 0; k < 6; k += 2) {
        const y = f + k;
        const v = Math.sin(wx * 0.19 + time * 1.3 + Math.sin(y * 0.5 + time * 0.6 + wx * 0.05) * 1.8) + Math.sin(wx * 0.083 - time * 0.9 + k * 0.7);
        if (v > thr + k * 0.08) ctx.fillRect(sx, sy + k, 2, 1);
      }
    }
  }

  /** The water surface seen from below: highlight line, wave crests, glints. */
  private drawSurface(ctx: CanvasRenderingContext2D, cx: number, cy: number, time: number): void {
    const surf = -cy;
    if (surf < -2 || surf >= VIEW_H) return;
    ctx.fillStyle = 'rgba(244,244,244,0.3)';
    ctx.fillRect(0, surf, VIEW_W, 1);
    ctx.fillStyle = 'rgba(244,244,244,0.1)';
    ctx.fillRect(0, surf + 1, VIEW_W, 2);
    ctx.fillStyle = P.white;
    const x0 = Math.floor(cx / 3) * 3;
    for (let wx = x0; wx < cx + VIEW_W; wx += 3) {
      const v = Math.sin(wx * 0.13 + time * 2.1) + 0.6 * Math.sin(wx * 0.31 - time * 1.4);
      if (v > 0.85) ctx.fillRect(wx - cx, surf - 1, 3, 1);
      else if (v > 0.2) ctx.fillRect(wx - cx, surf, 2, 1);
      else if (v < -1.25) ctx.fillRect(wx - cx + 1, surf + 2, 1, 1);
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
}

/** First index whose x >= v in a list sorted by x. */
function lowerBound(list: readonly { x: number }[], v: number): number {
  let a = 0;
  let b = list.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if ((list[m] as { x: number }).x < v) a = m + 1;
    else b = m;
  }
  return a;
}
