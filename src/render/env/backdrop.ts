/**
 * Backdrop art: dithered water-gradient strips, the sky band, sun, clouds,
 * light-ray sprites and the two parallax layers of distant silhouettes.
 * All pre-baked; the renderer only blits them.
 */
import type { Env } from './ground';
import { Buf, P, ditherLevel, hx, ih, vnoise, word } from './pix';

function canvasFrom(buf: Buf): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = buf.w;
  c.height = buf.h;
  const ctx = c.getContext('2d');
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(buf.data.buffer.slice(0)), buf.w, buf.h), 0, 0);
  return c;
}

// ---- water ------------------------------------------------------------------

/** Depth (world y) at which each water level is centred. */
const WATER_Y = [0, 12, 30, 80, 135, 190, 260, 340, 430, 540, 700, 920];

function waterLevels(base: string): number[] {
  // Depth darkness is applied as an overlay later, so the gradient itself
  // only cools gently toward navy and the player's light pool stays blue.
  const navy = P.navy;
  const k = [0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.42, 0.48, 0.52];
  return [word(hx(base, 'white', 0.3)), word(hx(base, 'white', 0.15)), word(base), ...k.map((t) => word(hx(base, navy, t)))];
}

function waterLevelAt(y: number): number {
  if (y <= 0) return 0;
  for (let i = 1; i < WATER_Y.length; i++) {
    const a = WATER_Y[i - 1] ?? 0;
    const b = WATER_Y[i] ?? a + 1;
    if (y < b) return i - 1 + (y - a) / (b - a);
  }
  return WATER_Y.length - 1;
}

export const STRIP_W = 8;

/** 8 px wide, world-tall water gradient strips, one per water colour. */
export class WaterStrips {
  private readonly map = new Map<string, HTMLCanvasElement>();
  constructor(private readonly height: number) {}

  get(base: string): HTMLCanvasElement {
    let c = this.map.get(base);
    if (!c) {
      const lv = waterLevels(base);
      const buf = new Buf(STRIP_W, this.height);
      for (let y = 0; y < this.height; y++) {
        const L = waterLevelAt(y);
        for (let x = 0; x < STRIP_W; x++) {
          const i = Math.min(lv.length - 1, ditherLevel(L, x, y, 3));
          buf.data[y * STRIP_W + x] = lv[i] ?? 0;
        }
      }
      c = canvasFrom(buf);
      this.map.set(base, c);
    }
    return c;
  }
}

// ---- sky ----------------------------------------------------------------------

export const SKY_BAKE_H = 32;

/** Banded sky gradient, horizon at the bottom row. */
export function makeSky(width: number): HTMLCanvasElement {
  const lv = [word(hx('sky', 'white', 0.5)), word(hx('sky', 'cyan', 0.35)), word(P.sky), word(hx('sky', 'blue', 0.14)), word(hx('sky', 'blue', 0.3))];
  const stops = [0, 3, 9, 17, 26];
  const buf = new Buf(width, SKY_BAKE_H);
  for (let r = 0; r < SKY_BAKE_H; r++) {
    const k = SKY_BAKE_H - 1 - r; // rows above the horizon
    let L = lv.length - 1;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1] ?? 0;
      const b = stops[i] ?? 0;
      if (k < b) {
        L = i - 1 + (k - a) / (b - a);
        break;
      }
    }
    for (let x = 0; x < width; x++) buf.data[r * width + x] = lv[Math.min(lv.length - 1, ditherLevel(L, x, r, 3))] ?? 0;
  }
  return canvasFrom(buf);
}

export function makeSun(): HTMLCanvasElement {
  const S = 19;
  const buf = new Buf(S, S);
  const c = (S - 1) / 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - c, y - c);
      let col = 0;
      if (r <= 2.6) col = word(P.white);
      else if (r <= 4.2) col = word(hx('white', 'yellow', 0.5));
      else if (r <= 5.6) col = word(P.yellow);
      else if (r <= 6.4) col = word(P.gold);
      else if (r <= 8.6 && (x + y) % 2 === 0) col = word(P.white, r < 7.6 ? 0.35 : 0.18);
      if (col) buf.data[y * S + x] = col;
    }
  }
  return canvasFrom(buf);
}

/** Three pixel cumulus clouds: lit tops, cool flat undersides. */
export function makeClouds(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const lit = word(P.white);
  const mid = word(hx('white', 'silver', 0.35));
  const shade = word(P.silver);
  const under = word(hx('silver', 'sky', 0.35));
  for (let v = 0; v < 3; v++) {
    const W = 30 + v * 9;
    const H = 12;
    const buf = new Buf(W, H);
    const puffs: [number, number, number][] = [];
    const n = 3 + v;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const r = 3 + Math.sin(t * Math.PI) * (3 + v) + ih(v, i, 301) * 1.5;
      puffs.push([4 + t * (W - 8), H - 3 - r * 0.6, r]);
    }
    const inside = (x: number, y: number): boolean => {
      if (y > H - 3) return false;
      for (const [px, py, r] of puffs) if ((x - px) ** 2 + ((y - py) * 1.25) ** 2 <= r * r) return true;
      return false;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        let col = mid;
        if (!inside(x + 0.5, y - 0.5) || !inside(x - 0.5, y - 1.5)) col = lit;
        else if (!inside(x + 0.5, y + 1.5)) col = under;
        else if (!inside(x + 0.5, y + 2.5) || !inside(x + 1.5, y + 1.5)) col = shade;
        buf.data[y * W + x] = col;
      }
    }
    out.push(canvasFrom(buf));
  }
  return out;
}

// ---- light rays -------------------------------------------------------------

export const RAY_H = 160;
export const RAY_W = 72;

/** Slanted god-ray sprites: hard-edged, alpha stepped in dithered bands. */
export function makeRays(): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  const alphas = [0, 0.03, 0.055, 0.08, 0.1].map((a) => word(P.white, a));
  for (let v = 0; v < 3; v++) {
    const buf = new Buf(RAY_W, RAY_H);
    const slope = 0.32 + v * 0.05;
    const w0 = 10 + v * 3;
    for (let y = 0; y < RAY_H; y++) {
      const cx = 4 + w0 / 2 + y * slope;
      const wd = Math.max(3, w0 - y * 0.04);
      const fade = 3.2 - (y / RAY_H) * 3.2;
      for (let x = 0; x < RAY_W; x++) {
        const u = Math.abs(x + 0.5 - cx) / (wd / 2);
        if (u > 1) continue;
        // Ragged, shimmering edges.
        if (u > 0.75 && ih(x >> 1, y >> 2, 310 + v) < 0.5) continue;
        const L = fade + (u < 0.45 ? 0.8 : 0);
        const i = Math.min(alphas.length - 1, ditherLevel(L, x, y, 2.5));
        if (i > 0) buf.data[y * RAY_W + x] = alphas[i] ?? 0;
      }
    }
    out.push(canvasFrom(buf));
  }
  return out;
}

// ---- parallax silhouettes ---------------------------------------------------

export const PARALLAX = [0.32, 0.58] as const;

const SIL = {
  far: { rim: word(P.ink, 0.07), body: word(P.ink, 0.13), deep: word(P.ink, 0.19) },
  near: { rim: word(P.ink, 0.12), body: word(P.ink, 0.21), deep: word(P.ink, 0.29) },
};

/**
 * Bake one chunk of a parallax layer. Chunk coordinates are (parallax x,
 * world y); parallax x p maps to roughly world x (p - 192) / f + 192.
 */
export function bakeParallax(env: Env, buf: Buf, near: boolean, halfView: number): void {
  const f = near ? (PARALLAX[1] as number) : (PARALLAX[0] as number);
  const pal = near ? SIL.near : SIL.far;
  const toWorld = (p: number) => (p - halfView) / f + halfView;
  const { x0, y0 } = buf;
  const x1 = x0 + buf.w;
  const y1 = y0 + buf.h;
  if (y1 < -40) return;

  // Column mounds (hills, reef massif, mud banks, sand mounds).
  for (let p = x0; p < x1; p++) {
    const wx = toWorld(p);
    const zone = env.zone(wx);
    const sf = env.smoothF(wx);
    let top = Infinity;
    const n1 = vnoise(p / 45, near ? 2 : 1) * 0.5 + 0.5;
    const n2 = vnoise(p / 13, near ? 4 : 3);
    if (zone === 'spring') top = sf - (near ? 10 : 24) - n1 * (near ? 8 : 18) - n2 * 4;
    else if (zone === 'estuary') top = sf - (near ? 6 : 14) - n1 * 8 - n2 * 2;
    else if (zone === 'seagrass') top = sf - (near ? 8 : 14) - n1 * (near ? 6 : 10) - n2 * 2;
    else if (zone === 'reef' && wx < env.dropX - 30) top = sf - (near ? 14 : 36) - n1 * (near ? 10 : 24) - n2 * 5 + Math.max(0, wx - env.dropX + 130) * 0.5;
    if (top === Infinity) continue;
    top = Math.round(top);
    const bot = Math.min(y1, sf + 70);
    for (let y = Math.max(y0, top); y < bot; y++) {
      const k = y - top;
      buf.set(p, y, k < 2 ? pal.rim : k < 16 || ditherLevel((k - 16) / 10, p, y) === 0 ? pal.body : pal.deep);
    }
  }

  // Discrete features per cell.
  const CW = near ? 26 : 38;
  const i0 = Math.floor((x0 - 70) / CW);
  const i1 = Math.ceil((x1 + 70) / CW);
  const L = near ? 1 : 0;
  for (let i = i0; i <= i1; i++) {
    const r = ih(i, L, 401);
    const s = ih(i, L, 402);
    const p = i * CW + Math.floor(ih(i, L, 403) * CW * 0.6);
    const wx = toWorld(p);
    const zone = env.zone(wx);
    const sf = env.smoothF(wx);
    switch (zone) {
      case 'spring':
        if (near && r < 0.4) silDome(buf, p, sf - 6, 6 + s * 9, 5 + s * 7, pal);
        if (r > 0.45) silBlades(buf, p, sf - (near ? 8 : 20), 6 + Math.floor(s * 6), near ? 10 + s * 10 : 8 + s * 8, pal.body, i);
        break;
      case 'estuary':
        if (!near && r < 0.6) silMangrove(buf, p, sf - 14, 10 + s * 6, pal, i);
        else if (near && r < 0.35) silRoots(buf, p, 30 + s * 30, pal.body, i);
        break;
      case 'seagrass':
        if (r < (near ? 0.85 : 0.6)) silBlades(buf, p, sf - (near ? 6 : 12), 8 + Math.floor(s * 8), near ? 8 + s * 8 : 6 + s * 5, pal.body, i);
        break;
      case 'reef': {
        if (wx > env.dropX - 60) break;
        const top = sf - (near ? 14 : 36) - 6;
        if (!near) {
          if (r < 0.45) silSpire(buf, p, top + 8, 3 + s * 4, 10 + s * 22, pal);
          else if (r < 0.75) silDome(buf, p, top + 6, 10 + s * 10, 7 + s * 7, pal);
        } else {
          if (r < 0.3) silDome(buf, p, sf - 6, 6 + s * 8, 5 + s * 6, pal);
          else if (r < 0.6) silBranch(buf, p, sf - 4, 10 + s * 12, pal.body, i);
          else if (r < 0.8) silFan(buf, p, sf - 4, 5 + s * 4, 10 + s * 8, pal.body);
        }
        break;
      }
      default:
        if (!near ? r < 0.6 : r < 0.18) {
          const top = (near ? 300 : 230) + Math.floor(s * (near ? 380 : 420));
          silPinnacle(buf, p, top, 3 + ih(i, L, 404) * 6, near ? 0.2 : 0.14, env.height, pal, i);
        }
    }
  }
}

type Sil = { rim: number; body: number; deep: number };

function silDome(buf: Buf, cx: number, base: number, rx: number, ry: number, pal: Sil): void {
  for (let y = Math.floor(base - ry); y < base + 6; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - base) / ry;
      if (v < 0 && u * u + v * v > 1) continue;
      if (v >= 0 && Math.abs(u) > 1) continue;
      const edge = v < 0 && u * u + v * v > 0.72;
      buf.set(x, y, edge ? pal.rim : pal.body);
    }
  }
}

function silBlades(buf: Buf, x: number, base: number, n: number, h: number, c: number, seed: number): void {
  for (let k = 0; k < n; k++) {
    const bx = x + k * 2 + Math.floor(ih(seed, k, 410) * 2);
    const bh = Math.round(h * (0.5 + ih(seed, k, 411) * 0.5));
    const lean = ih(seed, k, 412) < 0.5 ? -1 : 1;
    for (let j = 0; j < bh + 8; j++) buf.set(bx + (j > bh * 0.65 + 8 ? lean : 0), base + 8 - j, c);
  }
}

function silSpire(buf: Buf, cx: number, base: number, hw: number, h: number, pal: Sil): void {
  for (let y = Math.floor(base - h); y < base + 4; y++) {
    const t = (y - (base - h)) / h;
    const wd = Math.max(1, hw * (0.45 + 0.55 * t));
    for (let x = Math.floor(cx - wd); x <= cx + wd; x++) buf.set(x, y, y < base - h + 2 ? pal.rim : pal.body);
  }
}

function silBranch(buf: Buf, cx: number, base: number, h: number, c: number, seed: number): void {
  const grow = (x: number, y: number, ang: number, len: number, depth: number, k: number): void => {
    const n = Math.ceil(len);
    for (let j = 0; j <= n; j++) {
      const px = Math.round(x + Math.sin(ang) * j);
      const py = Math.round(y - Math.cos(ang) * j);
      buf.set(px, py, c);
      if (depth > 1) buf.set(px + 1, py, c);
    }
    if (depth <= 0) return;
    const ex = x + Math.sin(ang) * len;
    const ey = y - Math.cos(ang) * len;
    grow(ex, ey, ang - 0.5 - ih(seed, k, 420) * 0.3, len * 0.7, depth - 1, k * 2);
    grow(ex, ey, ang + 0.5 + ih(seed, k, 421) * 0.3, len * 0.7, depth - 1, k * 2 + 1);
  };
  grow(cx, base, 0, h * 0.4, 2, 1);
}

function silFan(buf: Buf, cx: number, base: number, rx: number, ry: number, c: number): void {
  for (let y = Math.floor(base - ry); y <= base; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - base) / ry;
      if (v > 0 || u * u + v * v > 1) continue;
      if ((x + y) % 2 === 0 || u * u + v * v > 0.8) buf.set(x, y, c);
    }
  }
}

function silMangrove(buf: Buf, cx: number, rootY: number, hw: number, pal: Sil, seed: number): void {
  // Canopy above the surface.
  for (let y = -22; y < -4; y++) {
    for (let x = Math.floor(cx - hw * 1.6); x <= cx + hw * 1.6; x++) {
      const u = (x - cx) / (hw * 1.6);
      const v = (y + 13) / 9;
      if (u * u + v * v > 1 - ih(x >> 1, y >> 1, seed) * 0.25) continue;
      buf.set(x, y, v < -0.5 ? pal.rim : pal.body);
    }
  }
  for (let y = -6; y < 6; y++) {
    buf.set(cx, y, pal.body);
    buf.set(cx + 1, y, pal.body);
  }
  // Roots arching to the bank.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const ex = cx + Math.round((i / (n - 1) - 0.5) * hw * 2.6);
    const sy = -2 + i;
    for (let s = 0; s <= 40; s++) {
      const u = s / 40;
      const px = Math.round(cx + (ex - cx) * Math.sin(u * Math.PI * 0.5));
      const py = Math.round(sy + (rootY - sy) * (1 - Math.cos(u * Math.PI * 0.5)));
      buf.set(px, py, pal.body);
    }
  }
}

function silRoots(buf: Buf, cx: number, depth: number, c: number, seed: number): void {
  for (let i = 0; i < 4; i++) {
    const ex = cx + Math.round((ih(seed, i, 430) - 0.5) * 30);
    const sy = Math.floor(ih(seed, i, 431) * 6);
    for (let s = 0; s <= 40; s++) {
      const u = s / 40;
      const px = Math.round(cx + (ex - cx) * Math.sin(u * Math.PI * 0.5));
      const py = Math.round(sy + (depth - sy) * (1 - Math.cos(u * Math.PI * 0.5)));
      buf.set(px, py, c);
    }
  }
}

function silPinnacle(buf: Buf, cx: number, top: number, hw0: number, spread: number, bottom: number, pal: Sil, seed: number): void {
  const ya = Math.max(top, buf.y0);
  const yb = Math.min(bottom, buf.y0 + buf.h);
  for (let y = ya; y < yb; y++) {
    const k = y - top;
    // Ledged flanks: width grows in steps.
    const step = Math.floor(k / 26);
    const jag = (ih(seed, step, 440) - 0.5) * 4;
    const hwL = hw0 + k * spread + jag + vnoise(y / 9, seed) * 1.5;
    const hwR = hw0 + k * spread * 0.8 - jag + vnoise(y / 11, seed + 1) * 1.5;
    const xa = Math.round(cx - hwL);
    const xb = Math.round(cx + hwR);
    for (let x = xa; x <= xb; x++) {
      const edgeTop = k < 2 || (k % 26 === 0 && (x < cx - hw0 || x > cx + hw0));
      buf.set(x, y, edgeTop || x === xa ? pal.rim : x > xb - 2 || ditherLevel((k - 30) / 60, x, y) > 0 ? pal.deep : pal.body);
    }
  }
}
