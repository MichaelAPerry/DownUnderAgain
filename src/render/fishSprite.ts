/**
 * Procedural pixel-art fish. A species' `look` (shape, colours, pattern) plus
 * its length/height fully determine the sprite, so custom fish get art for
 * free and every sprite stays on-palette. Facing right; the renderer flips.
 *
 * Painted the way a mid-90s sprite artist would: light from above, a short
 * hue-shifted ramp per colour (see art/ramp.ts), a dithered belly transition,
 * selective outlines, fin rays, gill covers, glinting eyes and a sparse scale
 * lattice, with species character keyed off the body shape and pattern.
 */
import type { BodyShape, FishLook } from '../data/schema';
import { PALETTE } from '../data/palette';
import type { PixelSprite } from './pixelSprite';
import { BASE, DEEP, HI, LIT, OUT, SHD, blendRamp, luma, rampOf } from './art/ramp';
import type { Ramp } from './art/ramp';
import { BODY, EMPTY, FIN, ToneCanvas, fillPoly, hash2, line, valueNoise } from './art/raster';

type TailStyle = 'fork' | 'lunate' | 'round' | 'hetero' | 'paddle';
type Pt = readonly [number, number];

interface ShapeSpec {
  /** Fraction of length taken by the tail fin. */
  tail: number;
  /** Fraction of length where the body ends (billfish bill begins). */
  bodyEnd: number;
  /** Body half-height as a fraction of H/2. */
  half: number;
  /** Centre line as a fraction of H. */
  cy: number;
  profile: (u: number) => number;
  tailStyle: TailStyle;
  /** Eye position along the body (0 = peduncle, 1 = snout). */
  eye: number;
  /** Back / belly extent multipliers (asymmetric profiles). */
  at: number;
  ab: number;
  /** Where the belly colour starts, in body-relative v (-1 back .. 1 belly). */
  belly: number;
  /** Countershading with a hard line instead of a dithered blend. */
  crisp: boolean;
}

const sinP = (u: number, a: number, b: number) => Math.sin(Math.PI * (a + b * u));

const SHAPES: Record<BodyShape, ShapeSpec> = {
  fusiform: {
    tail: 0.2, bodyEnd: 1, half: 0.72, cy: 0.52, tailStyle: 'fork', eye: 0.86, at: 1.05, ab: 0.95, belly: 0.3, crisp: false,
    profile: (u) => Math.pow(Math.max(0.32, sinP(u, 0.06, 0.9)), 0.62),
  },
  deep: {
    tail: 0.18, bodyEnd: 1, half: 0.74, cy: 0.5, tailStyle: 'fork', eye: 0.8, at: 1.05, ab: 0.95, belly: 0.35, crisp: false,
    profile: (u) => Math.pow(Math.max(0.3, sinP(u, 0.04, 0.92)), 0.45),
  },
  elongate: {
    tail: 0.12, bodyEnd: 1, half: 0.9, cy: 0.5, tailStyle: 'round', eye: 0.86, at: 1, ab: 1, belly: 0.25, crisp: false,
    profile: (u) => (u > 0.8 ? Math.max(0.35, 1 - (u - 0.8) * 3.2) : Math.min(1, 0.55 + u * 4)),
  },
  shark: {
    tail: 0.24, bodyEnd: 1, half: 0.56, cy: 0.56, tailStyle: 'hetero', eye: 0.87, at: 1.12, ab: 0.88, belly: 0.2, crisp: true,
    // Torpedo with a blunt, rounded snout.
    profile: (u) => Math.pow(Math.max(0.22, sinP(u, 0.04, 0.8)), 0.6) * (u > 0.84 ? 0.3 + 0.7 * Math.sqrt(Math.max(0, 1 - ((u - 0.84) / 0.16) ** 2)) : 1),
  },
  hammerhead: {
    tail: 0.24, bodyEnd: 0.94, half: 0.52, cy: 0.56, tailStyle: 'hetero', eye: 0.97, at: 1.12, ab: 0.88, belly: 0.2, crisp: true,
    profile: (u) => Math.pow(Math.max(0.3, sinP(u, 0.04, 0.85)), 0.6),
  },
  billfish: {
    tail: 0.16, bodyEnd: 0.78, half: 0.62, cy: 0.62, tailStyle: 'lunate', eye: 0.9, at: 1.1, ab: 0.9, belly: 0.15, crisp: false,
    profile: (u) => Math.pow(Math.max(0.28, sinP(u, 0.05, 0.85)), 0.6),
  },
  lionfish: {
    tail: 0.2, bodyEnd: 1, half: 0.46, cy: 0.5, tailStyle: 'round', eye: 0.82, at: 1.05, ab: 0.95, belly: 0.45, crisp: false,
    profile: (u) => Math.pow(Math.max(0.35, sinP(u, 0.05, 0.9)), 0.5),
  },
  manatee: {
    tail: 0.2, bodyEnd: 1, half: 0.84, cy: 0.48, tailStyle: 'paddle', eye: 0.86, at: 1.02, ab: 0.98, belly: 0.4, crisp: false,
    profile: (u) => Math.pow(Math.max(0.4, sinP(u, 0.08, 0.88)), 0.4) * (u > 0.88 ? 1 - (u - 0.88) * 2.2 : 1),
  },
};

interface Frame {
  c: ToneCanvas;
  /** Body column extents (inclusive), -1 where no body. */
  top: Int16Array;
  bot: Int16Array;
  uToX: (u: number) => number;
}

export function generateFishSprite(look: FishLook, length: number, height: number, seed = 1): PixelSprite {
  const W = Math.max(4, Math.round(length));
  const H = Math.max(2, Math.round(height));
  const a = drawFish(look, W, H, seed, 0);
  const b = drawFish(look, W, H, seed, 1);
  const px = a.c.colors();
  const f2 = b.c.colors();
  if (!f2.some((c) => c !== null)) f2.splice(0, f2.length, ...px);

  const glow: PixelSprite['glow'] = [];
  if (look.glow) {
    // Photophores: a dotted row along the lower flank plus one under the eye.
    const g = PALETTE[look.glow];
    const x0 = a.uToX(0.08);
    const x1 = a.uToX(0.8);
    const step = W >= 24 ? 3 : 2;
    for (let x = x1; x >= x0; x -= step) {
      const bt = a.bot[x] ?? -1;
      const tp = a.top[x] ?? -1;
      if (bt < 0) continue;
      const y = bt - (bt - tp >= 3 ? 1 : 0);
      if (px[y * W + x] !== null) glow.push({ x, y, color: g });
    }
    const ex = a.uToX(SHAPES[look.shape].eye);
    const ey = a.bot[ex] ?? -1;
    if (ey >= 0 && W >= 12 && !glow.some((p) => p.x === ex)) glow.push({ x: ex, y: ey, color: g });
  }
  return { w: W, h: H, frames: [px, f2], glow };
}

function drawFish(look: FishLook, W: number, H: number, seed: number, phase: 0 | 1): Frame {
  const shape = look.shape;
  const base = SHAPES[shape];
  const pattern = look.pattern;
  const R = {
    body: rampOf(look.colors.body),
    belly: rampOf(look.colors.belly),
    fin: rampOf(look.colors.fin),
    accent: rampOf(look.colors.accent),
  };
  const tiny = W <= 8 || H <= 3;
  const heavy = W >= 12 && H >= 5;
  const sharkish = shape === 'shark' || shape === 'hammerhead';
  const grouper = shape === 'fusiform' && pattern === 'mottled' && H >= 12;
  const gar = shape === 'elongate' && pattern === 'spots' && W >= 16;
  const cuda = shape === 'elongate' && !gar && W >= 20;
  const bigElongate = shape === 'elongate' && W >= 16;

  const spec: ShapeSpec = { ...base };
  if (grouper) {
    spec.tailStyle = 'round';
    spec.half = 0.8;
    spec.tail = 0.17;
    spec.profile = (u) => Math.pow(Math.max(0.42, sinP(u, 0.08, 0.86)), 0.5);
  }
  if (bigElongate) spec.half = gar ? 0.92 : 0.74;
  if (cuda) {
    spec.tailStyle = 'fork';
    spec.belly = 0.5;
  }
  if (gar) {
    spec.eye = 0.68;
    spec.belly = 0.55;
    spec.profile = (u) => (u > 0.76 ? 0.5 : u > 0.6 ? 1 - (u - 0.6) * 3 : Math.min(1, 0.55 + u * 2.5));
  }
  if (tiny && shape === 'fusiform') spec.half = 0.9;
  if (tiny && shape === 'elongate') spec.half = 1;

  const c = new ToneCanvas(W, H);
  const cy = spec.cy * H;
  const half = (spec.half * H) / 2;
  const tailW = Math.max(1, Math.round(spec.tail * W));
  const x1 = Math.max(tailW, Math.min(W - 1, Math.round(spec.bodyEnd * W) - 1));
  const bodyLen = x1 - tailW + 1;
  const uToX = (u: number) => Math.max(tailW, Math.min(x1, tailW + Math.round(u * bodyLen - 0.5)));
  const top = new Int16Array(W).fill(-1);
  const bot = new Int16Array(W).fill(-1);
  const colU = new Float32Array(W);
  const clampY = (y: number) => Math.max(0, Math.min(H - 1, y));

  // ---- Body silhouette ----------------------------------------------------
  for (let x = tailW; x <= x1; x++) {
    const u = (x - tailW + 0.5) / bodyLen;
    const hh = Math.max(0.5, half * spec.profile(u));
    let yT = clampY(Math.ceil(cy - hh * spec.at - 0.5));
    let yB = clampY(Math.floor(cy + hh * spec.ab - 0.5));
    // Manatee: sloping forehead down to a heavy, drooping muzzle.
    if (shape === 'manatee' && u > 0.8) yT = Math.min(yB, clampY(yT + Math.round(Math.pow((u - 0.8) / 0.2, 2) * H * 0.3)));
    if (yT > yB) yT = yB = clampY(Math.floor(cy));
    top[x] = yT;
    bot[x] = yB;
    colU[x] = u;
  }
  const eyeU = spec.eye;
  const exBase = tiny ? Math.max(tailW, x1 - 1) : uToX(eyeU);

  // Barracuda underbite: the upper jaw stops short of the lower one.
  if (cuda) {
    const my = Math.round(cy);
    for (let x = x1 - 1; x <= x1; x++) top[x] = Math.max(top[x] as number, Math.min(bot[x] as number, my + (x === x1 ? 1 : 0)));
  }

  const blotch = blendRamp(R.body, R.accent, 0.42);
  const paleBody = luma(R.body[BASE]) > 160;
  const contrast = Math.abs(luma(R.body[BASE]) - luma(R.belly[BASE]));
  const crisp = spec.crisp || contrast > 110;

  for (let x = tailW; x <= x1; x++) {
    const yT = top[x] as number;
    const yB = bot[x] as number;
    const n = yB - yT;
    const u = colU[x] as number;
    const bLine = yT + ((spec.belly + 1) / 2) * n;
    for (let y = yT; y <= yB; y++) {
      const v = n > 0 ? ((y - yT) / n) * 2 - 1 : 0;
      // Body vs belly, with a checker-dithered transition row on larger fish.
      let isBelly = false;
      if (tiny) isBelly = n >= 2 && y === yB;
      else if (n >= 2) {
        const d = y + 0.5 - bLine;
        if (crisp || n < 6) isBelly = d >= 0;
        else isBelly = d >= 0.5 ? true : d < -0.5 ? false : ((x + y) & 1) === 0;
      }
      let ramp = isBelly ? R.belly : R.body;
      // Light from above: lit back, base flank, shaded belly.
      let tone = BASE;
      if (sharkish) {
        // Countershading: darker back, lit flank, pale belly below a hard line.
        tone = v < -0.35 ? SHD : BASE;
        if (y === yT + 1 && u > 0.3 && u < 0.85) tone = LIT;
        if (isBelly) tone = v > 0.75 ? BASE : LIT;
      } else if (n >= 4) {
        if (cuda) tone = v < -0.55 ? DEEP : v < -0.1 ? SHD : v > 0.8 ? SHD : BASE;
        else if (paleBody || gar) tone = v > 0.55 ? SHD : BASE;
        else if (v < -0.5 || y === yT + 1) tone = LIT;
        else if (v > 0.62) tone = SHD;
        if (!crisp && !paleBody && !cuda && shape !== 'manatee' && n >= 9 && Math.abs(v + 0.42) < 0.08 && ((x + y) & 1) === 0) tone = LIT; // dithered band edge
        if (n >= 7 && y === yT + 1 && u > 0.42 && u < 0.84 && !isBelly) tone = HI;
        if (n >= 4 && n < 7 && y === yT + 1 && u > 0.5 && u < 0.8 && !isBelly && (paleBody || cuda)) tone = LIT;
      } else if (n >= 1) {
        if (y === yT) tone = LIT;
        else if (y === yB && n >= 2) tone = SHD;
      }
      if (isBelly && tone > BASE && !sharkish) tone = BASE;

      // Pattern overlay keeps the pixel's tone, so markings are shaded too.
      const p = patternAt(x, y, u, v, n, yT, isBelly);
      if (cuda && v > -0.1 && v < 0.6 && u > 0.15 && u < 0.62 && hash2(x, y, seed + 9) < 0.12) ramp = R.accent;
      if (p === 1) ramp = R.accent;
      else if (p === 2) tone = Math.min(HI, tone + 1);
      else if (p === 3) ramp = blotch;
      c.put(x, y, BODY, ramp, tone);
    }
  }

  function patternAt(x: number, y: number, u: number, v: number, n: number, yT: number, isBelly: boolean): number {
    switch (pattern) {
      case 'bars': {
        const bx0 = uToX(0.1);
        const bx1 = Math.min(uToX(eyeU - (tiny ? 0.02 : 0.1)), tiny ? x1 : exBase - 2);
        const span = bx1 - bx0 + 1;
        let nb = shape === 'deep' ? 5 : 4;
        if (span / nb < 3 && span >= 9) nb = Math.floor(span / 3);
        if (span / nb < 2) nb = Math.max(1, Math.floor(span / 2));
        const p = span / nb;
        const xx = x - (n >= 8 ? v * v * 1.2 : 0) - bx0;
        if (xx < 0) return 0;
        const ph = xx / p;
        if (Math.floor(ph) >= nb || ph - Math.floor(ph) < 0.45) return 0;
        const lim = shape === 'deep' ? 0.62 : 0.4;
        if (n >= 6 && Math.abs(v - lim) < 0.12) return ((x + y) & 1) === 0 ? 1 : 0;
        return v < lim ? 1 : 0;
      }
      case 'stripe': {
        if (H <= 3 || n <= 1) return y === yT && u < 0.97 ? 1 : 0;
        if (u > (n >= 4 ? eyeU - 0.04 : 0.97)) return 0;
        const sw = n >= 10 ? 2 : 1;
        const sy = Math.round(yT + n * 0.45 - sw / 2);
        if (y >= sy && y < sy + sw) return 1;
        // Ragged edge on big fish so the band looks painted, not ruled.
        if (n >= 10 && (y === sy - 1 || y === sy + sw) && hash2(x, y, seed) < 0.25) return 1;
        return 0;
      }
      case 'stripes-thin': {
        if (u < 0.03 || u > 0.97) return 0;
        const xx = Math.round(x + (n >= 6 ? v * v * 1.5 : 0));
        if (W < 14) return xx % 2 === 0 ? 1 : 0;
        const m = ((xx % 5) + 5) % 5;
        return m === 0 || m === 1 || m === 3 ? 1 : 0;
      }
      case 'spots': {
        if (isBelly && v > 0.6 && !gar) return 0;
        return spotAt(x, y) ? 1 : 0;
      }
      case 'mottled': {
        const val = valueNoise(x, y, Math.max(3, H / 5), seed) * 0.8 + hash2(x, y, seed + 7) * 0.2;
        if (val > 0.8 && !isBelly) return 1;
        if (val > 0.6) return 3;
        if (val < 0.26) return 2;
        return 0;
      }
      case 'eyespot': {
        const ex0 = uToX(0.08);
        const t0 = top[ex0] as number;
        const n0 = (bot[ex0] as number) - t0;
        const ey0 = t0 + n0 * 0.4 + 0.5;
        const r = Math.max(0.75, n0 * 0.3);
        const d = Math.hypot(x + 0.5 - (ex0 + 0.5), y + 0.5 - ey0);
        if (d <= r) return 1;
        if (r >= 1.4 && d <= r + 1) return 2;
        return 0;
      }
      case 'saddle': {
        const lo = 0.32 + (v + 1) * 0.05;
        const hi = 0.66 - (v + 1) * 0.05;
        if (u < lo || u > hi) return 0;
        if (n >= 6 && Math.abs(v + 0.1) < 0.12) return ((x + y) & 1) === 0 ? 1 : 0;
        return v < -0.1 ? 1 : 0;
      }
      default:
        return 0;
    }
  }

  function spotAt(x: number, y: number): boolean {
    const s = H >= 12 ? 4 : 3;
    const gx = Math.floor(x / s);
    const gy = Math.floor(y / s);
    if (hash2(gx, gy, seed + 3) > (gar ? 1 : 0.8)) return false;
    const sx = gx * s + Math.floor(hash2(gx, gy, seed + 4) * (s - 1));
    const sy = gy * s + Math.floor(hash2(gx, gy, seed + 5) * (s - 1));
    if (x === sx && y === sy) return true;
    return s === 4 && x === sx + 1 && y === sy;
  }

  // ---- Tail ---------------------------------------------------------------
  const pT = top[tailW] as number;
  const pB = bot[tailW] as number;
  const pcy = (pT + pB + 1) / 2;
  const ped = Math.max(0.5, (pB - pT + 1) / 2 - (heavy ? 0.5 : 0));
  const bendAmp = phase ? Math.max(1, Math.round(H * 0.09)) : 0;
  const bend = (x: number) => bendAmp * Math.pow(Math.max(0, (tailW - x) / tailW), 1.4);
  const P = (x: number, y: number): Pt => [x, y - bend(x)];
  const tailRamp = shape === 'manatee' || sharkish ? R.body : grouper ? blendRamp(R.fin, R.body, 0.7) : R.fin;
  const tailKind = shape === 'manatee' || sharkish ? BODY : FIN;
  const tailSet = new Set<number>();
  const plotTail = (x: number, y: number) => {
    if (x < 0 || x >= tailW + 1 || !c.inside(x, y)) return;
    if (x === tailW && c.k(x, y) !== EMPTY) return;
    tailSet.add(y * W + x);
  };
  const tw = tailW + 0.6;
  if (tailW <= 2 || tiny) {
    const span = Math.max(ped, Math.min(H / 2, half * (spec.tailStyle === 'round' ? 0.8 : 1.05)));
    for (let x = 0; x < tailW; x++) {
      for (let y = 0; y < H; y++) {
        const dy = y + 0.5 - pcy + bend(x);
        const ady = Math.abs(dy);
        if (ady > span + 0.01) continue;
        if (spec.tailStyle !== 'round' && x === 0 && span >= 1.5 && ady < 0.6) continue;
        plotTail(x, y);
      }
    }
  } else {
    let poly: Pt[] = [];
    switch (spec.tailStyle) {
      case 'fork': {
        const span = Math.max(ped + 1, half * 1.08);
        poly = [
          P(tw, pcy - ped), P(tailW * 0.55, pcy - span * 0.72), P(0, pcy - span), P(tailW * 0.28, pcy - span * 0.42),
          P(tailW * 0.62, pcy), P(tailW * 0.28, pcy + span * 0.42), P(0, pcy + span), P(tailW * 0.55, pcy + span * 0.72),
          P(tw, pcy + ped),
        ];
        break;
      }
      case 'lunate': {
        const span = Math.max(ped + 1, half * 1.45);
        poly = [
          P(tw, pcy - ped), P(tailW * 0.5, pcy - span * 0.72), P(tailW * 0.12, pcy - span * 0.97), P(0, pcy - span),
          P(tailW * 0.2, pcy - span * 0.7), P(tailW * 0.85, pcy),
          P(tailW * 0.2, pcy + span * 0.7), P(0, pcy + span), P(tailW * 0.12, pcy + span * 0.97), P(tailW * 0.5, pcy + span * 0.72),
          P(tw, pcy + ped),
        ];
        break;
      }
      case 'round': {
        const span = Math.max(ped + 0.5, half * (grouper ? 0.82 : 0.85));
        // A fan (circular sector) hinged at the peduncle: narrow root, rounded trailing edge.
        const A = (62 * Math.PI) / 180;
        const r = tw;
        const ky = span / (r * Math.sin(A));
        poly.push(P(tw, pcy - ped));
        for (let k = 0; k <= 12; k++) {
          const t = -A + (2 * A * k) / 12;
          poly.push(P(tw - r * Math.cos(t), pcy + r * Math.sin(t) * ky));
        }
        poly.push(P(tw, pcy + ped));
        break;
      }
      case 'hetero': {
        const upT = Math.max(0.3, pcy - H * 0.52);
        const dn = Math.min(H - 0.3, pcy + H * 0.3);
        poly = [
          P(tw, pcy - ped), P(tailW * 0.5, pcy - (pcy - upT) * 0.55), P(0, upT), P(tailW * 0.1, upT + (pcy - upT) * 0.42),
          P(tailW * 0.04, upT + (pcy - upT) * 0.62), P(tailW * 0.45, pcy + ped * 0.2), P(tailW * 0.38, dn),
          P(tailW * 0.72, pcy + ped * 1.4), P(tw, pcy + ped),
        ];
        break;
      }
      case 'paddle': {
        const r = Math.min(tailW * 0.75, H * 0.5);
        const ccx = tailW * 0.6;
        const pts: Pt[] = [];
        for (let k = 0; k < 24; k++) {
          const a = (Math.PI * 2 * k) / 24;
          pts.push(P(ccx + Math.cos(a) * r * 0.8, pcy + Math.sin(a) * r * 0.9));
        }
        fillPoly(pts, plotTail);
        poly = [P(ccx, pcy - ped * 0.7), P(tw, pcy - ped), P(tw, pcy + ped), P(ccx, pcy + ped * 0.7)];
        break;
      }
    }
    fillPoly(poly, plotTail);
  }
  // Ray shading: rays fan out from the peduncle, alternating light/base.
  for (const i of tailSet) {
    const x = i % W;
    const y = (i - x) / W;
    let tone: number;
    if (tailKind === BODY) {
      const dy = y + 0.5 - pcy + bend(x);
      tone = dy > 1.5 ? SHD : BASE;
      if (shape === 'manatee' && dy < -1) tone = LIT;
      if (shape === 'manatee' && hash2(x, y, seed + 11) < 0.08) tone = SHD;
    } else {
      const s = (y + 0.5 - pcy + bend(x)) / (tailW - x + 0.5);
      const ray = Math.floor((s * tailW) / (spec.tailStyle === 'round' ? 3 : 2) + 100);
      tone = ray % 2 === 0 ? LIT : BASE;
      if (x >= tailW - Math.max(1, Math.round(tailW * 0.15))) tone = grouper ? BASE : SHD;
      if (spec.tailStyle === 'lunate') tone = ray % 2 === 0 ? HI : LIT;
      if (grouper && x < tailW - 1) tone = ray % 2 === 0 ? LIT : SHD;
      if (tiny) tone = BASE;
    }
    let ramp = tailRamp;
    if (pattern === 'spots' && tailKind === FIN && spotAt(x, y)) ramp = R.accent;
    if (pattern === 'mottled' && tailKind === FIN && valueNoise(x, y, Math.max(3, H / 5), seed) > 0.64) ramp = blotch;
    c.put(x, y, tailKind, ramp, tone);
  }

  // ---- Fins -----------------------------------------------------------------
  /** Fin rising above the back (dir -1) or hanging below the belly (dir 1). */
  const fin = (
    uA: number, uB: number, hMax: number, dir: -1 | 1,
    prof: (s: number) => number, spiny: boolean, ramp: Ramp = R.fin, kind = FIN,
  ) => {
    const xa = uToX(uA);
    const xb = uToX(uB);
    for (let x = xa; x <= xb; x++) {
      const s = xb === xa ? 0.5 : (x - xa) / (xb - xa);
      const h = Math.round(hMax * prof(s));
      const edge = dir < 0 ? (top[x] as number) : (bot[x] as number);
      if (edge < 0) continue;
      for (let k = 1; k <= h; k++) {
        const y = edge + dir * k;
        const ray = (x + Math.floor(k / 2)) % 2;
        let tone = spiny ? (ray ? SHD : LIT) : ray ? BASE : LIT;
        if (k === 1 && !spiny) tone = BASE;
        let rr = ramp;
        if (pattern === 'spots' && kind === FIN && spotAt(x, y)) rr = R.accent;
        if (pattern === 'mottled' && kind === FIN && valueNoise(x, y, 3, seed) > 0.66) rr = blotch;
        c.under(x, y, kind, rr, tone);
      }
    }
  };
  const tri = (s: number) => Math.min(1, s * 2.2) * Math.min(1, (1 - s) * 4);
  const rounded = (s: number) => Math.pow(Math.max(0, Math.sin(Math.PI * s)), 0.6);
  const spinyProf = (s: number) => Math.min(1, (1 - s) * 5) * (0.6 + 0.4 * s) * Math.min(1, s * 6 + 0.3);
  const hFin = (k: number) => Math.max(1, Math.round(H * k));

  if (!tiny) {
    switch (shape) {
      case 'fusiform': {
        if (grouper) {
          // One long continuous dorsal: low spiny front rising to a rounded soft lobe at the rear.
          fin(0.08, 0.72, hFin(0.11), -1, (s) => Math.min(1, (1 - s) * 7) * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, s * 2.2))) * Math.min(1, s * 5 + 0.25), false);
          fin(0.06, 0.24, hFin(0.13), 1, rounded, false);
          fin(0.55, 0.66, hFin(0.1), 1, tri, false);
        } else if (W >= 14) {
          fin(0.42, 0.74, hFin(0.17), -1, spinyProf, true);
          fin(0.14, 0.42, hFin(0.13), -1, rounded, false);
          fin(0.1, 0.3, hFin(0.13), 1, rounded, false);
          fin(0.55, 0.66, hFin(0.1), 1, tri, false);
        } else {
          fin(0.3, 0.65, hFin(0.15), -1, rounded, false);
          fin(0.15, 0.3, hFin(0.12), 1, rounded, false);
        }
        break;
      }
      case 'deep': {
        fin(0.48, 0.82, hFin(0.11), -1, spinyProf, true);
        fin(0.06, 0.48, hFin(0.14), -1, (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.85 + 0.15)), 0.5), false);
        fin(0.06, 0.42, hFin(0.14), 1, (s) => Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.8 + 0.2)), 0.5), false);
        if (W >= 14) fin(0.56, 0.66, hFin(0.1), 1, tri, false);
        break;
      }
      case 'elongate': {
        if (gar) {
          fin(0.04, 0.16, hFin(0.18), -1, rounded, false);
          fin(0.04, 0.18, hFin(0.18), 1, rounded, false);
          fin(0.42, 0.5, hFin(0.14), 1, tri, false);
        } else if (cuda) {
          fin(0.58, 0.68, hFin(0.22), -1, (s) => Math.min(1, (1 - s) * 3) * Math.min(1, s * 4), true);
          fin(0.12, 0.22, hFin(0.16), -1, tri, false);
          fin(0.12, 0.22, hFin(0.16), 1, tri, false);
          fin(0.5, 0.58, hFin(0.14), 1, tri, false);
        } else if (W >= 10) {
          fin(0.1, 0.5, 1, -1, () => 1, false);
        }
        break;
      }
      case 'shark':
      case 'hammerhead':
        sharkFins();
        break;
      case 'billfish':
        billfishFins();
        break;
      case 'lionfish':
        lionfishFins();
        break;
      case 'manatee':
        break;
    }
  }

  function sharkFins() {
    const k = (u: number) => uToX(u);
    const tY = (u: number) => (top[k(u)] as number) + 1;
    const bY = (u: number) => bot[k(u)] as number;
    const fr = R.fin;
    const solid = (pts: Pt[], toneFn: (x: number, y: number) => number, ramp = fr) =>
      fillPoly(pts, (x, y) => c.under(x, y, BODY, ramp, toneFn(x, y)));
    // First dorsal: tall, apex leaning back, convex leading and concave trailing edge.
    const xF = k(0.7);
    const xA = k(0.5);
    const xB = k(0.45);
    const baseF = (top[xF] as number) + 1;
    const baseB = (top[xB] as number) + 1;
    const apexY = Math.max(0, (top[xA] as number) - Math.max(2, H * 0.4));
    const dset = new Set<number>();
    fillPoly(
      [[xF + 0.5, baseF], [xF - (xF - xA) * 0.45, apexY + (baseF - apexY) * 0.3], [xA, apexY],
        [xA + 1.6, apexY + (baseB - apexY) * 0.62], [xB, baseB]],
      (x, y) => dset.add(y * W + x),
    );
    for (const i of dset) {
      const x = i % W;
      const y = (i - x) / W;
      const lead = !dset.has(i + 1) || !dset.has(i - W + 1);
      c.under(x, y, BODY, R.body, lead ? LIT : x <= xA + 1 ? SHD : BASE);
    }
    // Second dorsal and anal: small nubs near the tail.
    if (W >= 30) {
      solid([[k(0.14), tY(0.13)], [k(0.08), tY(0.1) - H * 0.12], [k(0.07), tY(0.08)]], () => BASE, R.body);
      solid([[k(0.16), bY(0.15)], [k(0.09), bY(0.1) + H * 0.12], [k(0.07), bY(0.1)]], () => SHD, R.body);
    }
    // Pectoral: big swept-back wing below the gills (flutters on frame 2).
    const pA = k(0.8);
    const pB = k(0.66);
    const tipY = H - 0.2 - phase;
    const tipX = k(0.58);
    solid([[pA + 1, bY(0.8) - 1], [k(0.74), bY(0.74) + (tipY - bY(0.74)) * 0.75], [tipX, tipY], [tipX + 1.2, tipY - 1], [pB, bY(0.66) - 1]],
      (x, y) => (y <= bY(0.7) + 1 ? BASE : x > tipX + 2 ? BASE : SHD));
    // Pelvic.
    if (W >= 30) solid([[k(0.34), bY(0.34)], [k(0.27), bY(0.3) + H * 0.14], [k(0.25), bY(0.26)]], () => SHD);
  }

  function billfishFins() {
    const k = (u: number) => uToX(u);
    const tY = (u: number) => (top[k(u)] as number) + 1;
    const bY = (u: number) => bot[k(u)] as number;
    // Tall sickle dorsal "sail": steep leading edge, apex swept back, concave trailing edge.
    const fA = k(0.86);
    const fB = k(0.62);
    const set = new Set<number>();
    fillPoly(
      [[fA + 1, tY(0.86) + 1], [k(0.82), tY(0.82) * 0.45], [k(0.76), tY(0.76) * 0.12], [k(0.7), -0.2], [k(0.68), 0.9],
        [k(0.71), tY(0.7) * 0.55], [fB, tY(0.62) + 1]],
      (x, y) => set.add(y * W + x),
    );
    for (const i of set) {
      const x = i % W;
      const y = (i - x) / W;
      const lead = !set.has(y * W + x + 1);
      c.under(x, y, BODY, R.fin, lead ? HI : (x + (y >> 1)) % 3 === 0 ? SHD : BASE);
    }
    // Small finlets near the tail.
    fin(0.06, 0.12, hFin(0.12), -1, tri, false);
    fin(0.06, 0.12, hFin(0.12), 1, tri, false);
    // Long sickle pectoral.
    const tipY = Math.min(H - 0.3, bY(0.8) + H * 0.32) - phase;
    fillPoly([[k(0.84), bY(0.84) - 1], [k(0.7), tipY], [k(0.69), tipY - 0.8], [k(0.78), bY(0.8) - 1]], (x, y) =>
      c.put(x, y, FIN, R.fin, y > bY(0.8) ? BASE : LIT),
    );
    // Caudal keel.
    const ky = Math.round(pcy - 0.5);
    for (let x = tailW; x < tailW + Math.max(2, Math.round(W * 0.04)); x++) c.setTone(x, ky, DEEP);
  }

  function lionfishFins() {
    const k = (u: number) => uToX(u);
    // Venomous dorsal spines: banded, separated, with a low membrane between them.
    for (let u = 0.2; u <= 0.86; u += 2 / bodyLen) {
      const x = k(u);
      const t = top[x] as number;
      const s = (u - 0.2) / 0.66;
      const h = Math.max(1, Math.round(t * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, s * 1.4)))));
      for (let j = 1; j <= h; j++) {
        const y = t - j;
        c.put(x, y, FIN, (j + x) % 3 === 0 ? R.body : R.fin, (j + x) % 3 === 0 ? LIT : BASE);
        if (j <= Math.max(1, Math.round(h * 0.3))) c.under(x - 1, y, FIN, R.fin, LIT);
      }
    }
    // Soft rear dorsal + anal.
    fin(0.04, 0.2, hFin(0.16), -1, rounded, false);
    fin(0.06, 0.24, hFin(0.16), 1, rounded, false);
    // Huge fan pectorals: banded rays radiating back and down.
    // They spread like wings below and behind the body, in front of everything.
    const ox = k(0.68);
    const oy = Math.min(H - 2, Math.round(cy + half * 0.4));
    const len = Math.max(5, Math.round(W * 0.62));
    const rays = W >= 30 ? 7 : W >= 20 ? 6 : 5;
    const ends: Pt[] = [];
    for (let r = 0; r < rays; r++) {
      const f = r / (rays - 1);
      ends.push([ox - len * (0.3 + 0.7 * f) + phase, oy + (H - 0.5 - oy) * (1 - 0.6 * f * f) - phase * f]);
    }
    fillPoly([[ox, oy], ...ends], (x, y) => c.under(x, y, FIN, R.fin, LIT));
    ends.forEach(([ex, ey], r) => {
      line(ox, oy, ex, Math.min(H - 1, ey), (x, y, i) => {
        if (i < 1) return;
        const band = Math.floor((i + r) / (W >= 30 ? 3 : 2)) % 2 === 0;
        c.put(x, y, FIN, band ? R.fin : R.body, band ? (r % 2 ? SHD : BASE) : HI);
      });
    });
    // Pelvic spines.
    line(k(0.6), (bot[k(0.6)] as number) + 1, k(0.5), H - 1, (x, y, i) => c.under(x, y, FIN, i % 2 ? R.body : R.fin, BASE));
  }

  // Bills and heads.
  if (shape === 'billfish') {
    const by = Math.max(0, Math.round((top[x1] as number) + ((bot[x1] as number) - (top[x1] as number)) * 0.35));
    const thick = x1 + Math.max(2, Math.round((W - x1) * 0.45));
    for (let x = x1 + 1; x < W; x++) {
      c.put(x, by, BODY, R.body, LIT);
      if (x <= thick && H >= 6) c.put(x, by + 1, BODY, R.body, DEEP);
    }
  }
  if (shape === 'hammerhead' && !tiny) {
    const hw = Math.max(2, Math.round(W * 0.04));
    const yA = Math.max(0, Math.round(cy - H * 0.47));
    const yB = Math.min(H - 1, Math.round(cy + H * 0.33));
    for (let x = W - hw; x < W; x++) {
      for (let y = yA; y <= yB; y++) {
        const corner = (y === yA || y === yB) && x === W - 1;
        if (corner) continue;
        const fx = x - (W - hw);
        c.put(x, y, BODY, y + 0.5 > cy + 1 ? R.belly : R.body, fx === hw - 1 ? LIT : fx === 0 ? SHD : BASE);
      }
    }
    // Neck joining the hammer.
    for (let x = x1 + 1; x < W - hw; x++) {
      for (let y = Math.round(cy - H * 0.2); y <= Math.round(cy + H * 0.18); y++) c.put(x, y, BODY, y + 0.5 > cy + 1 ? R.belly : R.body, BASE);
    }
  }
  if (gar) {
    // Long toothy snout: upper jaw, tooth-lined mouth, lower jaw.
    const xs = uToX(0.77);
    const my = Math.round(cy - 0.5);
    for (let x = xs; x < W; x++) {
      const rem = W - 1 - x;
      c.put(x, my - 1, BODY, R.body, LIT);
      c.put(x, my + 1, BODY, R.belly, rem < 2 ? SHD : BASE);
      if (rem >= 1) c.put(x, my, BODY, R.body, BASE);
      if (x > xs) {
        for (let y = 0; y < H; y++) if (y < my - 1 || y > my + 1) c.erase(x, y);
      }
    }
    top[W - 1] = my - 1;
  }

  // ---- Pectoral fin on the flank (bony fish) -------------------------------
  const xMid = exBase;
  const nEye = (bot[xMid] as number) - (top[xMid] as number);
  const opX = exBase - Math.max(2, Math.round(nEye * 0.38));

  // ---- Outline ----------------------------------------------------------------
  if (!gar && !cuda && heavy && !sharkish && shape !== 'manatee' && shape !== 'billfish') {
    // Mouth notch at the snout.
    const ft = top[x1] as number;
    const fb = bot[x1] as number;
    if (fb - ft >= 3) c.erase(x1, Math.round(ft + (fb - ft) * 0.6));
  }
  c.selout(heavy);

  // ---- Surface detail -------------------------------------------------------
  const bony = shape === 'fusiform' || shape === 'deep' || shape === 'lionfish' || (shape === 'elongate' && W >= 16);
  // Scale lattice: sparse lit pixels on base-toned flank.
  if (bony && W >= 18 && H >= 6) {
    const xEnd = uToX(eyeU - 0.14);
    for (let x = tailW + 1; x < xEnd; x++) {
      for (let y = (top[x] as number) + 2; y < (bot[x] as number) - 1; y++) {
        if (c.k(x, y) !== BODY || c.getTone(x, y) !== BASE) continue;
        const lattice = gar ? (x + y) % 3 === 0 && y % 2 === 0 : y % 2 === 0 && (x + (y % 4 === 0 ? 0 : 2)) % 4 === 0;
        if (lattice) c.setTone(x, y, gar ? SHD : LIT);
      }
    }
  }
  // Wrinkles and scars for the manatee.
  if (shape === 'manatee') {
    for (let x = tailW; x <= x1; x++) {
      for (let y = (top[x] as number) + 1; y < (bot[x] as number); y++) {
        // Short skin creases (shadow with a lit lip above) scattered on a jittered grid.
        const gx = Math.floor(x / 5);
        const gy = Math.floor(y / 4);
        const cx0 = gx * 5 + Math.floor(hash2(gx, gy, seed + 21) * 3);
        const cy0 = gy * 4 + 1 + Math.floor(hash2(gx, gy, seed + 22) * 2);
        if (hash2(gx, gy, seed + 23) < 0.6 && y === cy0 && x >= cx0 && x < cx0 + 3) {
          if (c.getTone(x, y) >= BASE) c.setTone(x, y, SHD);
          if (x === cx0 + 1 && c.getTone(x, y - 1) === BASE) c.setTone(x, y - 1, LIT);
        } else if (hash2(x, y, seed + 24) < 0.035 && c.getTone(x, y) === BASE) c.setTone(x, y, SHD);
      }
    }
    // Neck folds.
    for (const u of [0.77]) {
      const x = uToX(u);
      const t = top[x] as number;
      const n = (bot[x] as number) - t;
      for (let y = t + Math.round(n * 0.25); y < t + n * 0.85; y++) {
        const xx = x + (Math.abs(y - (t + n * 0.55)) < n * 0.15 ? -1 : 0);
        c.setTone(xx, y, SHD);
      }
    }
    // Front flipper hanging below the chest, with pale nails (flaps on frame 2).
    const fx = uToX(0.78);
    const fy = bot[fx] as number;
    const fl = Math.max(3, Math.round(H * 0.34));
    const fset = new Set<number>();
    fillPoly(
      [[fx + 2, fy - 2], [fx + 0.5 - fl * 0.3 + phase, fy + fl * 0.9], [fx - fl * 0.5 + phase, fy + fl], [fx - fl * 0.95 + phase, fy + fl * 0.75], [fx - 2.5, fy - 2]],
      (x, y) => fset.add(y * W + x),
    );
    for (const i of fset) {
      const x = i % W;
      const y = (i - x) / W;
      const edge = !fset.has(i + W) || !fset.has(i - 1);
      c.put(x, y, BODY, R.body, edge ? DEEP : !fset.has(i - W + 1) ? LIT : BASE);
      if (!fset.has(i + W) && x % 2 === 0 && y > fy + 1) c.fix(x, y, R.belly[HI]);
    }
  }

  // Operculum: a curved gill-cover edge behind the head with a lit rim.
  if (bony && !tiny && nEye >= 4) {
    const bulge = nEye >= 10 ? 2 : 1;
    const t = top[opX] as number;
    const b = bot[opX] as number;
    for (let y = t + 1; y < b; y++) {
      const v = ((y - t) / Math.max(1, b - t)) * 2 - 1;
      if (v < -0.55 || v > 0.75) continue;
      const x = opX - Math.round((1 - v * v) * bulge);
      if (c.k(x, y) !== BODY) continue;
      c.setTone(x, y, DEEP);
      if (nEye >= 8 && c.k(x + 1, y) === BODY) c.setTone(x + 1, y, LIT);
    }
  }

  // Pectoral fin overlaying the flank.
  if ((shape === 'fusiform' || shape === 'deep' || bigElongate) && !tiny && nEye >= 4 && W >= 12 && H >= 11 && !(pattern === 'bars' && H < 16)) {
    const L = Math.max(2, Math.round(nEye * (shape === 'deep' ? 0.45 : 0.4)));
    const ox = opX - 1;
    const t = top[ox] as number;
    const oy = t + ((bot[ox] as number) - t) * 0.5;
    const set = new Set<number>();
    fillPoly(
      [[ox + 0.6, oy - 0.4], [ox - L, oy + L * 0.3 + phase * 0.6], [ox - L + 0.8, oy + L * 0.62 + phase * 0.6], [ox + 0.6, oy + Math.max(1.2, L * 0.45)]],
      (x, y) => set.add(y * W + x),
    );
    for (const i of set) {
      const x = i % W;
      const y = (i - x) / W;
      if (c.k(x, y) === EMPTY) continue;
      const edge = !set.has(i - W);
      c.put(x, y, FIN, R.fin, edge ? DEEP : !set.has(i - 1) ? SHD : y % 2 ? LIT : BASE);
    }
  }

  // Shark gill slits.
  if (sharkish && W >= 20) {
    const count = W >= 56 ? 5 : W >= 32 ? 4 : 3;
    const gx = uToX(eyeU - (shape === 'hammerhead' ? 0.1 : 0.06));
    const gap = W >= 40 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const x = gx - i * gap - (gap === 1 ? i : 0);
      const t = top[x] as number;
      const n = (bot[x] as number) - t;
      const y0 = t + Math.round(n * 0.22);
      const y1 = t + Math.round(n * 0.68);
      for (let y = y0; y <= y1; y++) {
        const xx = x + (y - y0 < (y1 - y0) / 2 ? 1 : 0);
        if (c.k(xx, y) === BODY) c.setTone(xx, y, DEEP);
      }
    }
  }

  // ---- Mouth --------------------------------------------------------------------
  if (!tiny) {
    const ft = top[x1] as number;
    const fb = bot[x1] as number;
    if (sharkish && shape === 'shark') {
      // Underslung mouth beneath the pointed snout.
      const my = Math.min(H - 1, fb);
      const mlen = Math.max(2, Math.round(W * 0.05));
      for (let x = x1 - 1 - mlen; x <= x1 - 1; x++) if (c.k(x, my) === BODY) c.setTone(x, my, OUT);
    } else if (shape === 'manatee') {
      const my = Math.round(ft + (fb - ft) * 0.7);
      for (let x = x1 - 2; x <= x1; x++) c.setTone(x, my, OUT);
      // Whiskered snout: bristle dots and a few hairs.
      for (let x = x1 - 3; x <= x1; x++) {
        for (let y = Math.round(ft + (fb - ft) * 0.25); y < my; y++) if ((x + y) % 2 === 0) c.setTone(x, y, SHD);
      }
      c.fix(Math.min(W - 1, x1), my + 1, R.body[HI]);
    } else if (shape === 'billfish' || shape === 'hammerhead') {
      // no visible mouth from the side
    } else if (cuda) {
      const my = Math.round(cy);
      const mlen = Math.max(3, Math.round(W * 0.12));
      for (let x = x1 - mlen; x < x1; x++) if (c.k(x, my) !== EMPTY) c.setTone(x, my, OUT);
      // A couple of fangs showing over the jutting lower jaw.
      for (const x of [x1 - 2, x1 - 4]) if (c.k(x, my + 1) !== EMPTY) c.fix(x, my + 1, PALETTE.white);
    } else if (gar) {
      // Paint the beak after outlining so the thin jaws keep their colour.
      const my = Math.round(cy - 0.5);
      const xs = uToX(0.77);
      for (let x = xs + 1; x < W; x++) {
        const rem = W - 1 - x;
        c.fix(x, my - 1, rem === 0 ? R.body[OUT] : R.body[x % 3 === 0 ? DEEP : SHD]);
        if (rem >= 1) c.fix(x, my, rem <= 1 || (x & 1) ? R.body[OUT] : PALETTE.white);
        c.fix(x, my + 1, R.belly[rem < 2 ? DEEP : SHD]);
      }
    } else if (heavy && fb - ft >= 2) {
      const my = Math.round(ft + (fb - ft) * 0.6);
      const mlen = grouper ? Math.round((fb - ft) * 0.55) : Math.max(1, Math.round((fb - ft) * 0.22));
      for (let x = x1 - mlen; x < x1; x++) {
        // Grouper gape slopes down toward the back of the jaw.
        const yy = my + (grouper && x < x1 - mlen / 2 ? 1 : 0);
        if (c.k(x, yy) === BODY) c.fix(x, yy, R.body[OUT]);
        if (grouper && c.k(x, yy + 1) === BODY) c.fix(x, yy + 1, R.belly[LIT]);
        if (grouper && c.k(x, yy - 1) === BODY && x > x1 - mlen + 1) c.setTone(x, yy - 1, SHD);
      }
      if (grouper) {
        // Jutting lower jaw.
        c.put(x1, my + 1, BODY, R.belly, BASE);
        c.put(x1, my + 2, BODY, R.belly, SHD);
      }
    }
  }

  // ---- Eye ----------------------------------------------------------------------
  {
    let ex = exBase;
    const t = top[ex] as number;
    const n = (bot[ex] as number) - t;
    let ey = t + Math.max(0, Math.floor(n * (sharkish ? 0.3 : 0.32)));
    if (tiny) ey = t + (n >= 2 ? 1 : 0);
    if (shape === 'hammerhead' && !tiny) {
      const hw = Math.max(2, Math.round(W * 0.04));
      ex = W - hw;
      const yA = Math.max(0, Math.round(cy - H * 0.47));
      const yB = Math.min(H - 1, Math.round(cy + H * 0.33));
      c.fix(ex, yA + 1, PALETTE.ink);
      c.fix(ex, yB - 1, PALETTE.ink);
      if (hw >= 3) {
        c.fix(ex + 1, yA + 1, PALETTE.white);
        c.fix(ex + 1, yB - 1, R.belly[SHD]);
      }
    } else {
      let size = H < 5 || W < 12 ? 1 : H < 8 ? 1.5 : H < 16 ? 2 : 3;
      if (sharkish) size = Math.min(size, H >= 12 ? 2 : 1.5);
      if (shape === 'manatee') {
        // Small but clear: set high and forward on the head, dark with one glint.
        ex = Math.min(x1 - 3, uToX(0.9));
        const mt = top[ex] as number;
        ey = mt + Math.max(2, Math.floor(((bot[ex] as number) - mt) * 0.2));
        c.fix(ex, ey, PALETTE.ink);
        c.fix(ex + 1, ey, PALETTE.white);
        c.fix(ex, ey + 1, PALETTE.ink);
        c.fix(ex + 1, ey + 1, PALETTE.ink);
        c.setTone(ex - 1, ey, SHD);
        c.setTone(ex - 1, ey + 1, SHD);
        c.setTone(ex, ey - 1, LIT);
        c.setTone(ex + 1, ey - 1, LIT);
        size = 0;
      }
      const iris = luma(PALETTE[look.colors.body]) > 170 ? PALETTE.yellow : PALETTE.cream;
      // Keep the eye (and its glint) inside the head, clear of the snout tip.
      if (size >= 2) ex = Math.max(tailW, Math.min(ex, x1 - (size === 3 ? 3 : 2)));
      const darkBody = luma(PALETTE[look.colors.body]) < 70;
      if (size === 0) {
        // drawn above
      } else if (size === 1) {
        c.fix(ex, ey, darkBody ? PALETTE.silver : PALETTE.ink);
      } else if (size === 1.5) {
        c.fix(ex, ey, PALETTE.ink);
        c.fix(ex - 1, ey, sharkish ? R.body[SHD] : iris);
      } else {
        if (size === 3) {
          for (let k = -1; k <= 1; k++) {
            c.fix(ex - 1, ey + k, iris);
            c.fix(ex + k, ey - 1, iris);
          }
          c.setTone(ex + 2, ey, DEEP);
          c.setTone(ex + 2, ey + 1, DEEP);
          c.setTone(ex, ey + 2, DEEP);
          c.setTone(ex + 1, ey + 2, DEEP);
        }
        c.fix(ex, ey, PALETTE.ink);
        c.fix(ex + 1, ey, PALETTE.white);
        c.fix(ex, ey + 1, PALETTE.ink);
        c.fix(ex + 1, ey + 1, PALETTE.ink);
      }
    }
    // Lionfish: feathery tentacle over the eye.
    if (shape === 'lionfish' && !tiny) {
      for (let k = 1; k <= Math.max(1, Math.round(H * 0.15)); k++) c.under(ex - 1 + (k > 1 ? 1 : 0), t - k, FIN, R.fin, BASE);
    }
  }

  return { c, top, bot, uToX };
}
