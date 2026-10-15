/**
 * Static scenery painted into chunk buffers: the terrain's decor props
 * (rocks, corals, fans, logs, vents, mangroves) plus purely decorative
 * renderer-only details placed deterministically from world x (sponges,
 * star corals, sea rods, shells, urchins, oysters, seedlings, black coral...).
 */
import type { Decor } from '../../world/terrain';
import type { Env } from './ground';
import { Buf, Mask, P, bayer, ditherLevel, ih, ramp, w, word } from './pix';

// ---- shared shading -------------------------------------------------------

const LX = -0.45;
const LY = -0.72;
const LZ = 0.53;
const LN = Math.hypot(LX, LY, LZ);

const at = (r: readonly number[], i: number): number => r[i < 0 ? 0 : i >= r.length ? r.length - 1 : i] ?? 0;

interface DomeOpts {
  seed: number;
  rough?: number;
  /** Optional per-pixel texture: receives the shaded ramp index. */
  tex?: (x: number, y: number, idx: number, u: number, v: number) => number;
  /** Skip the dark outline. */
  noLine?: boolean;
}

/**
 * A lumpy half-dome resting on `base`, shaded by a fake normal with light
 * from the top-left and ordered dithering between ramp steps.
 * ramp: light -> dark, the last entry is the outline colour.
 */
function dome(buf: Buf, x0: number, base: number, wd: number, h: number, rp: readonly number[], o: DomeOpts): void {
  const cx = x0 + wd / 2;
  const rx = wd / 2;
  const rough = o.rough ?? 0.1;
  const s1 = ih(o.seed, 1, 9) * 6.28;
  const s2 = ih(o.seed, 2, 9) * 6.28;
  const q = (x: number, y: number): number => {
    const u = (x + 0.5 - cx) / rx;
    const v = (y + 0.5 - base) / h;
    if (v > 0) return -1;
    const a = Math.atan2(v, u);
    const r = 1 + rough * (0.6 * Math.sin(3 * a + s1) + 0.4 * Math.sin(7 * a + s2));
    const d = (u * u + v * v) / (r * r);
    return d <= 1 ? d : -1;
  };
  const n = rp.length - 1;
  const ya = Math.floor(base - h * (1 + rough) - 1);
  const xa = Math.floor(x0 - rx * rough - 1);
  const xb = Math.ceil(x0 + wd + rx * rough + 1);
  if (!buf.hits(xa, ya, xb - xa + 1, base - ya + 1)) return;
  for (let y = ya; y < base; y++) {
    for (let x = xa; x <= xb; x++) {
      const d = q(x, y);
      if (d < 0) continue;
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - base) / h;
      const nz = Math.sqrt(Math.max(0, 1 - d));
      const nl = Math.hypot(u, v, nz) || 1;
      const I = (u * LX + v * LY + nz * LZ) / (nl * LN);
      const lvl = Math.min(n - 1, Math.max(0, (0.92 - I) * 0.95 * (n - 1)));
      let idx = Math.min(n - 1, ditherLevel(lvl, x, y, 3));
      let c: number;
      if (!o.noLine && (q(x + 1, y) < 0 || q(x, y + 1) < 0) && (u > -0.2 || v > -0.25)) {
        c = at(rp, n);
      } else {
        if (q(x, y - 1) < 0 && v < -0.4 && idx > 0) idx -= 1;
        c = o.tex ? o.tex(x, y, idx, u, v) : at(rp, idx);
      }
      buf.set(x, y, c);
    }
  }
}

/** Fill the gap under a prop on sloping ground down into the terrain. */
function skirt(buf: Buf, env: Env, x0: number, x1: number, base: number, c: number): void {
  for (let x = x0; x < x1; x++) {
    const f = env.F(x);
    if (f + 2 > base) buf.rect(x, base, 1, f + 2 - base, c);
  }
}

// ---- colour ramps ---------------------------------------------------------

const LIME_STONE = [
  ramp('white', ['cream', 'silver', 0.5], 'silver', ['silver', 'grey', 0.55], 'grey', ['darkgrey', 'charcoal', 0.3]),
  ramp('cream', ['cream', 'grey', 0.35], ['tan', 'grey', 0.45], ['grey', 'brown', 0.3], ['darkgrey', 'brown', 0.3], ['darkgrey', 'bark', 0.4]),
  ramp('white', 'silver', ['silver', 'slate', 0.5], 'slate', ['slate', 'charcoal', 0.55], 'charcoal'),
];
const BASALT = ramp('slate', ['slate', 'charcoal', 0.5], 'charcoal', ['charcoal', 'ink', 0.4], ['charcoal', 'ink', 0.7], 'ink');
const OYSTER = ramp(['grey', 'mud', 0.35], ['grey', 'mud', 0.55], ['darkgrey', 'mud', 0.5], 'mud', ['mud', 'bark', 0.5], 'bark');
const BRAIN = [
  ramp('cream', 'yellow', ['yellow', 'gold', 0.5], ['gold', 'rust', 0.45], 'rust', 'brown'),
  ramp(['tan', 'yellow', 0.45], 'tan', ['tan', 'rust', 0.45], 'rust', ['rust', 'brown', 0.55], 'bark'),
  ramp(['lime', 'yellow', 0.45], ['olive', 'lime', 0.35], 'olive', ['olive', 'moss', 0.5], 'moss', 'forest'),
];
const ELK = [ramp(['yellow', 'orange', 0.3], 'orange', ['orange', 'rust', 0.5], 'rust', ['rust', 'brown', 0.6]), ramp('orange', ['orange', 'rust', 0.5], 'rust', ['rust', 'brown', 0.55], 'bark')];
const ELK_TIP = [w('cream'), w('yellow')];
const STAG = ramp('sand', 'tan', ['tan', 'brown', 0.35], ['tan', 'brown', 0.65], 'bark');
const FAN = [
  { lit: w('pink'), a: w('magenta'), b: w('magenta', 'purple', 0.45), dark: w('purple') },
  { lit: w('pink', 'violet', 0.5), a: w('violet'), b: w('violet', 'purple', 0.5), dark: w('purple') },
  { lit: w('yellow'), a: w('gold', 'orange', 0.3), b: w('orange', 'rust', 0.4), dark: w('rust') },
];
const SPONGE = [
  ramp(['violet', 'pink', 0.35], 'violet', ['violet', 'purple', 0.5], 'purple', ['purple', 'ink', 0.45]),
  ramp('yellow', 'orange', ['orange', 'rust', 0.5], 'rust', ['rust', 'bark', 0.5]),
  ramp('pink', ['red', 'pink', 0.4], 'red', 'crimson', ['crimson', 'ink', 0.4]),
  ramp(['yellow', 'cream', 0.3], 'gold', ['gold', 'rust', 0.4], ['rust', 'brown', 0.3], 'brown'),
];
const STARCORAL = [ramp(['lime', 'olive', 0.55], ['olive', 'yellow', 0.25], 'olive', ['olive', 'moss', 0.55], 'moss', 'forest'), ramp('sand', 'tan', ['tan', 'brown', 0.4], ['tan', 'brown', 0.7], 'brown', 'bark')];
const ROD = [
  { lit: w('pink'), mid: w('violet', 'purple', 0.3), dark: w('purple') },
  { lit: w('tan'), mid: w('rust', 'brown', 0.3), dark: w('brown') },
  { lit: w('yellow'), mid: w('olive', 'tan', 0.3), dark: w('olive', 'brown', 0.5) },
];
const BARK = ramp(['brown', 'tan', 0.25], 'brown', ['brown', 'bark', 0.5], 'bark', ['bark', 'ink', 0.45]);
const ROOT_LIT = w('brown', 'tan', 0.2);
const ROOT_MID = w('brown', 'bark', 0.45);
const ROOT_DARK = w('bark', 'ink', 0.35);
const LEAF = ramp(['lime', 'seafoam', 0.4], 'seafoam', ['seafoam', 'moss', 0.5], 'moss', 'forest', ['forest', 'ink', 0.4]);

// ---- decor props (terrain.ts) ---------------------------------------------

/** Paint one terrain decor prop (not grass / mangrove) into buf. */
export function paintDecor(buf: Buf, env: Env, d: Decor): void {
  const cxw = Math.round(d.x + d.w / 2);
  const base = env.F(cxw) + 1;
  if (!buf.hits(d.x - 30, base - d.h - 30, d.w + 60, d.h + 40)) return;
  const zone = env.zone(d.x);
  switch (d.type) {
    case 'rock':
      rock(buf, env, d.x, base, d.w, d.h, zone, d.variant);
      break;
    case 'vent':
      vent(buf, env, d.x, base, d.w);
      break;
    case 'log':
      log(buf, env, d.x, base, d.w, d.h);
      break;
    case 'brainCoral':
      brain(buf, env, d.x, base, d.w, d.h, d.variant);
      break;
    case 'elkhorn':
      elkhorn(buf, cxw, base, d.w, d.h, d.variant);
      break;
    case 'seaFan':
      seaFan(buf, cxw, base, d.w, d.h, d.variant + (d.x % 7 === 0 ? 1 : 0));
      break;
    case 'grass':
      grassTuft(buf, d.x - 1 + (ih(d.x, 0, 3) < 0.5 ? -1 : 2), base, Math.max(3, Math.round(d.h * 0.35)), zone === 'seagrass', d.x);
      break;
    default:
      break;
  }
}

function rock(buf: Buf, env: Env, x: number, base: number, wd: number, h: number, zone: string, variant: number): void {
  if (zone === 'estuary') {
    oysterMound(buf, env, x, base, wd, h + 1, x);
    return;
  }
  if (zone === 'dropoff') {
    dome(buf, x, base, wd, h, BASALT, { seed: x, rough: 0.16 });
    skirt(buf, env, x, x + wd, base, at(BASALT, 4));
    return;
  }
  const rp = LIME_STONE[variant % LIME_STONE.length] ?? LIME_STONE[0]!;
  const algae = zone === 'seagrass' ? [w('olive'), w('moss'), w('olive', 'tan', 0.4)] : [w('moss'), w('forest'), w('seafoam', 'moss', 0.5)];
  dome(buf, x, base, wd, h, rp, {
    seed: x,
    rough: 0.14,
    tex: (px, py, idx, u, v) => {
      // Pitted limestone: dark holes with a lit lower lip.
      const cx = Math.floor(px / 4);
      const cy = Math.floor(py / 3);
      if (ih(cx, cy, 81) < 0.22 && v < -0.15) {
        const hx0 = cx * 4 + 1 + Math.floor(ih(cx, cy, 82) * 2);
        const hy0 = cy * 3 + Math.floor(ih(cx, cy, 83) * 2);
        if (px === hx0 && py === hy0) return at(rp, idx + 3);
        if (px === hx0 + 1 && py === hy0) return at(rp, idx + 2);
        if (px === hx0 && py === hy0 + 1) return at(rp, Math.max(0, idx - 1));
      }
      // Algae fuzz on the sunlit crown.
      if (v < -0.62 && Math.abs(u) < 0.75 && ih(px, py, 84) < 0.32) return algae[Math.floor(ih(px, py, 85) * algae.length)] ?? 0;
      return at(rp, idx);
    },
  });
  skirt(buf, env, x, x + wd, base, at(rp, 4));
}

function oysterMound(buf: Buf, env: Env, x: number, base: number, wd: number, h: number, seed: number): void {
  const shell = [w('white'), w('silver'), w('grey'), w('darkgrey')];
  dome(buf, x, base, wd, h, OYSTER, {
    seed,
    rough: 0.2,
    tex: (px, py, idx, _u, v) => {
      const row = Math.floor(py / 3);
      const off = (row & 1) * 2;
      const cx = Math.floor((px + off) / 4);
      const u = px + off - cx * 4;
      const vv = py - row * 3;
      if (ih(cx, row, seed) < 0.78 && v < -0.05) {
        if (u === 3) return at(OYSTER, idx + 2);
        if (vv === 0) return at(shell, (u === 0 ? 0 : 1) + (idx > 2 ? 1 : 0));
        if (vv === 1) return at(shell, 1 + (idx > 1 ? 1 : 0));
        return at(shell, 3);
      }
      return at(OYSTER, idx);
    },
  });
  skirt(buf, env, x, x + wd, base, at(OYSTER, 4));
}

function vent(buf: Buf, env: Env, x: number, base: number, wd: number): void {
  // A sand boil: twin rims of churned white sand around a dark throat.
  const c = x + wd / 2;
  const rim = ramp('white', 'cream', 'sand', ['sand', 'tan', 0.5], 'tan');
  for (let px = x - 2; px < x + wd + 2; px++) {
    const t = Math.abs(px + 0.5 - c) / (wd / 2 + 2);
    const hgt = Math.round(t < 0.3 ? 1 : 4.2 * Math.sin(Math.min(1, (t - 0.3) / 0.7) * Math.PI));
    for (let k = 0; k < hgt; k++) {
      const y = base - 1 - k;
      const lit = px < c ? k === hgt - 1 : k === hgt - 1 && px > c + 3;
      buf.set(px, y, lit ? at(rim, px < c ? 0 : 1) : at(rim, 1 + Math.floor(ih(px, y, 5) * 2) + (px > c ? 1 : 0)));
    }
    if (t < 0.3) {
      buf.set(px, base - 1, w('brown'));
      buf.set(px, base, w('bark'));
    }
  }
  buf.set(Math.round(c) - 4, base - 3, w('silver'));
  buf.set(Math.round(c) + 4, base - 2, w('grey'));
  skirt(buf, env, x - 2, x + wd + 2, base, at(rim, 3));
}

function log(buf: Buf, env: Env, x: number, base: number, wd: number, h: number): void {
  const top = base - h;
  for (let px = x; px < x + wd - 2; px++) {
    for (let y = top; y < base; y++) {
      const v = (y - top) / h;
      let idx = v < 0.2 ? 0 : v < 0.45 ? 1 : v < 0.75 ? 2 : 3;
      // Bark furrows: long horizontal grooves broken at random.
      const groove = (y - top) % 3 === 2 && ih(Math.floor(px / 5), y, 91) < 0.7;
      if (groove) idx += 1;
      if (ih(px, y, 92) < 0.05) idx = Math.max(0, idx - 1);
      if (y === base - 1) idx = 4;
      buf.set(px, y, at(BARK, idx));
    }
  }
  // Knot hole.
  const kx = x + 8 + Math.floor(ih(x, 1, 93) * (wd - 20));
  buf.set(kx, top + 3, at(BARK, 4));
  buf.set(kx + 1, top + 3, at(BARK, 4));
  buf.set(kx, top + 2, at(BARK, 0));
  // Sawn end with growth rings.
  const ex = x + wd - 3;
  const rings = [w('tan'), w('sand'), w('tan'), w('rust', 'tan', 0.5), w('brown')];
  for (let y = top; y < base; y++) {
    const r = Math.abs(y + 0.5 - (top + h / 2));
    for (let k = 0; k < 3; k++) {
      const rr = Math.round(r + k * 0.7);
      buf.set(ex + k, y, k === 2 || rr >= h / 2 - 0.5 ? at(BARK, 3) : at(rings, rr));
    }
  }
  // Branch stub.
  const sx = x + 4 + Math.floor(ih(x, 2, 93) * 8);
  for (let k = 1; k <= 4; k++) {
    buf.set(sx + k, top - k, at(BARK, 1));
    buf.set(sx + k + 1, top - k, at(BARK, 3));
  }
  // Moss and algae.
  const moss = [w('moss'), w('forest'), w('seafoam', 'moss', 0.5), w('lime', 'moss', 0.5)];
  for (let px = x; px < x + wd - 3; px++) {
    if (ih(px, 0, 94) < 0.55) buf.set(px, top - (ih(px, 1, 94) < 0.3 ? 1 : 0), at(moss, Math.floor(ih(px, 2, 94) * 4)));
    if (ih(px, 0, 95) < 0.18) buf.set(px, top - 1, at(moss, 0));
    if (ih(px, 0, 96) < 0.1) buf.set(px, top - 2, at(moss, 3));
  }
  skirt(buf, env, x, x + wd, base, at(BARK, 4));
}

function brain(buf: Buf, env: Env, x: number, base: number, wd: number, h: number, variant: number): void {
  const rp = BRAIN[variant % BRAIN.length] ?? BRAIN[0]!;
  const s = ih(x, 0, 7) * 6.28;
  const s2 = ih(x, 1, 7) * 6.28;
  dome(buf, x, base, wd, h, rp, {
    seed: x,
    rough: 0.05,
    tex: (px, py, idx) => {
      // Meandering valleys: a warped stripe field.
      const lx = px - x;
      const ly = py - base;
      const ph = (a: number, b: number) => (a * 0.8 + b * 0.3 + 1.7 * Math.sin(b * 0.62 + s) + 1.3 * Math.sin(a * 0.41 + s2)) * 1.9;
      const g = Math.sin(ph(lx, ly));
      if (g > 0.5) return at(rp, idx + 2);
      if (g < -0.65) return at(rp, Math.max(0, idx - 1));
      return at(rp, idx);
    },
  });
  skirt(buf, env, x, x + wd, base, at(rp, 4));
}

/** Branching coral grown into a mask then shaded. */
function elkhorn(buf: Buf, cx: number, base: number, wd: number, h: number, variant: number): void {
  const m = new Mask(cx - wd, base - h - 6, wd * 2 + 2, h + 8);
  const tips: [number, number][] = [];
  const midY = base - Math.round(h * 0.38);
  const lean = (ih(cx, 0, 11) - 0.5) * 4;
  m.line(cx, base, cx + lean, midY, 1.6, 1.3);
  const n = 3 + (ih(cx, 1, 11) < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = (-0.95 + 1.9 * t + (ih(cx, i, 12) - 0.5) * 0.3) * 1.05;
    const len = h * (0.55 + ih(cx, i, 13) * 0.3);
    const sx = cx + lean;
    const sy = midY + (i % 2);
    // Flattened, upswept antlers: go out, then curve up.
    const mx = sx + Math.sin(ang) * len * 0.55;
    const my = sy - Math.cos(ang) * len * 0.35;
    const ex = sx + Math.sin(ang) * len * 0.8;
    const ey = sy - len * 0.85;
    m.line(sx, sy, mx, my, 1.3, 1.1);
    m.line(mx, my, ex, ey, 1.1, 0.5);
    tips.push([Math.round(ex), Math.round(ey)]);
    // Palmate side tip.
    const fx = mx + Math.sin(ang) * 3 + (ang > 0 ? 2 : -2);
    const fy = my - 4;
    m.line(mx, my, fx, fy, 0.5, 0);
    tips.push([Math.round(fx), Math.round(fy)]);
  }
  const rp = ELK[variant % ELK.length] ?? ELK[0]!;
  m.shade(buf, rp, 0.06, cx);
  for (const [tx, ty] of tips) {
    buf.set(tx, ty, at(ELK_TIP, 0));
    if (m.at(tx, ty + 1)) buf.set(tx, ty + 1, at(ELK_TIP, 1));
    if (m.at(tx + 1, ty)) buf.set(tx + 1, ty, at(ELK_TIP, 1));
  }
}

function staghorn(buf: Buf, cx: number, base: number, h: number, seed: number): void {
  const m = new Mask(cx - h, base - h - 4, h * 2 + 2, h + 6);
  const tips: [number, number][] = [];
  const grow = (x: number, y: number, ang: number, len: number, depth: number, k: number): void => {
    const ex = x + Math.sin(ang) * len;
    const ey = y - Math.cos(ang) * len;
    m.line(x, y, ex, ey, 0.5, 0.5);
    if (depth <= 0 || len < 3) {
      tips.push([Math.round(ex), Math.round(ey)]);
      return;
    }
    const spread = 0.45 + ih(seed, k, 14) * 0.35;
    grow(ex, ey, ang - spread, len * 0.72, depth - 1, k * 2 + 1);
    grow(ex, ey, ang + spread * 0.8, len * 0.68, depth - 1, k * 2 + 2);
  };
  grow(cx, base, (ih(seed, 0, 15) - 0.5) * 0.4, h * 0.42, 2, 1);
  m.shade(buf, STAG, 0, seed);
  for (const [tx, ty] of tips) {
    buf.set(tx, ty, w('white'));
    buf.set(tx + 1, ty, w('cream'));
  }
}

function seaFan(buf: Buf, cx: number, base: number, wd: number, h: number, variant: number): void {
  const pal = FAN[variant % FAN.length] ?? FAN[0]!;
  const oy = base - 3;
  const rx = wd / 2 + 1;
  const ry = h - 3;
  const lean = (ih(cx, 0, 21) - 0.5) * 0.3;
  // Stalk.
  for (let y = oy; y < base; y++) {
    buf.set(cx, y, pal.dark);
    buf.set(cx + 1, y, pal.b);
  }
  for (let y = Math.floor(oy - ry - 1); y <= oy; y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      const u = (x + 0.5 - cx - lean * (oy - y)) / rx;
      const v = (y + 0.5 - oy) / ry;
      const r = u * u + v * v;
      if (v > 0.02 || r > 1) continue;
      const edge = r > 0.8;
      const rib = Math.abs(Math.atan2(u, -v) * 3.2 - Math.round(Math.atan2(u, -v) * 3.2)) < 0.11 * (1.4 - r);
      const mesh = (x + y) % 3 === 0 || (x - y + 300) % 3 === 0;
      if (!(edge || rib || mesh)) continue;
      let c = rib ? pal.a : edge ? pal.a : pal.b;
      if (u < -0.2 && v < -0.3 && (edge || rib)) c = pal.lit;
      if (u > 0.35 && !rib) c = pal.dark;
      if (edge && v < -0.85 && ih(x, y, 22) < 0.5) c = pal.lit;
      buf.set(x, y, c);
    }
  }
}

// ---- decorations (renderer only) -----------------------------------------

export type DecoKind =
  | 'pebbles'
  | 'shell'
  | 'starfish'
  | 'urchin'
  | 'starCoral'
  | 'barrel'
  | 'tubes'
  | 'rod'
  | 'staghorn'
  | 'brain'
  | 'tuft'
  | 'oysters'
  | 'propagule'
  | 'twig'
  | 'blackCoral'
  | 'seaPen'
  | 'glassSponge'
  | 'fan'
  | 'boulder';

export interface Deco {
  kind: DecoKind;
  x: number;
  w: number;
  h: number;
  v: number;
}

/** Deterministic decorative scatter along the floor, from a hash of world x. */
export function makeDecorations(env: Env): Deco[] {
  const out: Deco[] = [];
  const CELL = 12;
  for (let i = 1; i < env.width / CELL - 1; i++) {
    const x = i * CELL + Math.floor(ih(i, 0, 201) * 8);
    const r = ih(i, 1, 201);
    const v = Math.floor(ih(i, 2, 201) * 4);
    const s = ih(i, 3, 201);
    const zone = env.zone(x);
    const add = (kind: DecoKind, wd: number, h: number) => out.push({ kind, x, w: wd, h, v });
    switch (zone) {
      case 'spring':
        if (r < 0.07) add('boulder', 10 + Math.floor(s * 12), 6 + Math.floor(s * 6));
        else if (r < 0.2) add('pebbles', 6 + Math.floor(s * 6), 3);
        else if (r < 0.27) add('shell', 3, 2);
        else if (r < 0.42) add('tuft', 4, 4 + Math.floor(s * 5));
        break;
      case 'estuary':
        if (r < 0.14) add('oysters', 6 + Math.floor(s * 6), 3 + Math.floor(s * 2));
        else if (r < 0.26) add('propagule', 3, 6 + Math.floor(s * 5));
        else if (r < 0.36) add('twig', 8 + Math.floor(s * 6), 4);
        else if (r < 0.44) add('pebbles', 5, 2);
        break;
      case 'seagrass':
        if (r < 0.1) add('shell', 3, 2);
        else if (r < 0.15) add('starfish', 5, 3);
        else if (r < 0.2) add('urchin', 5, 4);
        else if (r < 0.46) add('tuft', 5, 4 + Math.floor(s * 6));
        else if (r < 0.51) add('pebbles', 5, 2);
        else if (r < 0.54) add('tubes', 6, 5 + Math.floor(s * 4));
        break;
      case 'reef':
        if (r < 0.17) add('starCoral', 10 + Math.floor(s * 10), 6 + Math.floor(s * 5));
        else if (r < 0.28) add('barrel', 8 + Math.floor(s * 5), 11 + Math.floor(s * 8));
        else if (r < 0.4) add('tubes', 7, 8 + Math.floor(s * 9));
        else if (r < 0.53) add('rod', 9, 14 + Math.floor(s * 10));
        else if (r < 0.64) add('staghorn', 10, 12 + Math.floor(s * 8));
        else if (r < 0.69) add('urchin', 5, 4);
        else if (r < 0.79) add('brain', 9 + Math.floor(s * 6), 6 + Math.floor(s * 3));
        else if (r < 0.86) add('fan', 9, 12 + Math.floor(s * 6));
        else add('pebbles', 6, 3);
        break;
      default: {
        const f = env.F(x);
        if (f > env.height - 60) {
          if (r < 0.07) add('seaPen', 3, 8 + Math.floor(s * 6));
          else if (r < 0.11) add('glassSponge', 6, 8 + Math.floor(s * 5));
          else if (r < 0.2) add('pebbles', 6, 2);
        } else if (Math.abs(env.F(x - 5) - env.F(x + 5)) <= 3) {
          // Ledges on the wall.
          if (r < 0.22) add('barrel', 7 + Math.floor(s * 4), 8 + Math.floor(s * 6));
          else if (r < 0.42) add('blackCoral', 12, 12 + Math.floor(s * 8));
          else if (r < 0.58) add('tubes', 6, 5 + Math.floor(s * 6));
          else if (r < 0.68 && f < 520) add('fan', 9, 12 + Math.floor(s * 4));
        }
      }
    }
  }
  return out;
}

export function paintDeco(buf: Buf, env: Env, d: Deco): void {
  const cx = d.x + (d.w >> 1);
  const base = env.F(cx) + 1;
  if (!buf.hits(d.x - 16, base - d.h - 16, d.w + 32, d.h + 24)) return;
  switch (d.kind) {
    case 'pebbles': {
      const sets = env.zone(d.x) === 'dropoff' ? [BASALT] : LIME_STONE;
      let px = d.x;
      for (let k = 0; px < d.x + d.w; k++) {
        const pw = 2 + Math.floor(ih(d.x, k, 31) * 3);
        const ph = Math.min(d.h, 1 + Math.floor(ih(d.x, k, 32) * 2));
        dome(buf, px, env.F(px + 1) + 1, pw, ph + 0.5, sets[Math.floor(ih(d.x, k, 33) * sets.length)] ?? BASALT, { seed: px, rough: 0 });
        px += pw + Math.floor(ih(d.x, k, 34) * 3);
      }
      break;
    }
    case 'shell':
      shell(buf, d.x, base, d.v);
      break;
    case 'starfish':
      starfish(buf, cx, base, d.v);
      break;
    case 'urchin':
      urchin(buf, cx, base);
      break;
    case 'starCoral':
      starCoral(buf, env, d.x, base, d.w, d.h, d.v);
      break;
    case 'barrel':
      barrel(buf, d.x, base, d.w, d.h, SPONGE[[0, 2, 0, 3][d.v % 4] ?? 0] ?? SPONGE[0]!);
      break;
    case 'tubes':
      tubes(buf, d.x, base, d.h, SPONGE[(d.v + 1) % SPONGE.length] ?? SPONGE[0]!, d.x);
      break;
    case 'rod':
      seaRod(buf, cx, base, d.h, ROD[d.v % ROD.length] ?? ROD[0]!, d.x);
      break;
    case 'staghorn':
      staghorn(buf, cx, base, d.h, d.x);
      break;
    case 'brain':
      brain(buf, env, d.x, base, d.w, d.h, d.v);
      break;
    case 'tuft':
      grassTuft(buf, d.x, base, d.h, env.zone(d.x) === 'seagrass', d.x);
      break;
    case 'oysters':
      oysterMound(buf, env, d.x, base, d.w, d.h, d.x);
      break;
    case 'propagule':
      propagule(buf, cx, base, d.h, d.x);
      break;
    case 'twig':
      twig(buf, d.x, base, d.w, d.x);
      break;
    case 'blackCoral':
      blackCoral(buf, cx, base, d.h, d.x);
      break;
    case 'seaPen':
      seaPen(buf, cx, base, d.h);
      break;
    case 'glassSponge':
      glassSponge(buf, d.x, base, d.w, d.h);
      break;
    case 'fan':
      seaFan(buf, cx, base, d.w, d.h, env.zone(d.x) === 'reef' ? d.v : 2);
      break;
    case 'boulder':
      rock(buf, env, d.x, base, d.w, d.h, env.zone(d.x), d.v);
      break;
  }
}

function shell(buf: Buf, x: number, base: number, v: number): void {
  if (v % 2 === 0) {
    // Scallop: ribbed fan.
    const c = v === 0 ? [w('white'), w('pink'), w('pink', 'rust', 0.4)] : [w('cream'), w('tan'), w('rust')];
    buf.set(x + 1, base - 3, at(c, 0));
    buf.set(x, base - 2, at(c, 0));
    buf.set(x + 1, base - 2, at(c, 1));
    buf.set(x + 2, base - 2, at(c, 1));
    buf.set(x, base - 1, at(c, 1));
    buf.set(x + 1, base - 1, at(c, 2));
    buf.set(x + 2, base - 1, at(c, 2));
  } else {
    // Conch / snail: spiral cone.
    const c = [w('cream'), w('sand'), w('tan'), w('brown')];
    buf.set(x, base - 1, at(c, 1));
    buf.set(x + 1, base - 1, at(c, 2));
    buf.set(x + 2, base - 1, at(c, 3));
    buf.set(x + 3, base - 1, at(c, 2));
    buf.set(x + 1, base - 2, at(c, 0));
    buf.set(x + 2, base - 2, at(c, 1));
    buf.set(x + 2, base - 3, at(c, 0));
  }
}

function starfish(buf: Buf, cx: number, base: number, v: number): void {
  const body = v % 2 ? w('orange') : w('red', 'orange', 0.4);
  const lit = w('yellow');
  const dark = v % 2 ? w('rust') : w('crimson');
  const px: [number, number, number][] = [
    [0, -3, 0], [-1, -2, 1], [0, -2, 0], [1, -2, 1], [-2, -1, 1], [-1, -1, 1], [0, -1, 2], [1, -1, 1], [2, -1, 2], [-3, -1, 2], [3, -1, 2],
  ];
  for (const [dx, dy, k] of px) buf.set(cx + dx, base + dy, k === 0 ? lit : k === 1 ? body : dark);
}

function urchin(buf: Buf, cx: number, base: number): void {
  const k = w('ink');
  const c = w('charcoal');
  const hi = w('violet', 'charcoal', 0.4);
  const y = base - 2;
  buf.rect(cx - 1, y - 1, 3, 2, c);
  buf.set(cx - 1, y - 1, hi);
  buf.rect(cx - 1, y + 1, 3, 1, k);
  const spines: [number, number][] = [[-3, -3], [0, -4], [3, -3], [-3, 0], [3, 0], [-2, -2], [2, -2], [0, -3], [-4, -1], [4, -1]];
  for (const [dx, dy] of spines) buf.set(cx + dx, y + dy, Math.abs(dx) + Math.abs(dy) > 3 ? c : k);
}

function starCoral(buf: Buf, env: Env, x: number, base: number, wd: number, h: number, v: number): void {
  const rp = STARCORAL[v % STARCORAL.length] ?? STARCORAL[0]!;
  const n = 2 + Math.floor(ih(x, 0, 41) * 2);
  for (let k = 0; k < n; k++) {
    const bw = Math.max(4, Math.round(wd * (0.45 + ih(x, k, 42) * 0.4)));
    const bh = Math.max(3, Math.round(h * (0.6 + ih(x, k, 43) * 0.4)));
    const bx = x + Math.round((wd - bw) * (k / Math.max(1, n - 1)));
    const bb = env.F(bx + (bw >> 1)) + 1;
    dome(buf, bx, Math.max(base, bb), bw, bh, rp, {
      seed: bx,
      rough: 0.08,
      tex: (px, py, idx) => {
        // Polyp cups in a staggered grid.
        const row = Math.floor(py / 2);
        if ((px + (row & 1) * 2) % 3 === 0 && py % 2 === 0) return idx > 2 ? at(rp, 1) : w('cream', 'lime', 0.3);
        if ((px + (row & 1) * 2) % 3 === 1 && py % 2 === 1 && idx < 3) return at(rp, idx + 1);
        return at(rp, idx);
      },
    });
  }
}

function barrel(buf: Buf, x: number, base: number, wd: number, h: number, rp: readonly number[]): void {
  const top = base - h;
  for (let y = top; y < base; y++) {
    const t = (base - y) / h; // 0 at base, 1 at rim
    const hw = (wd / 2) * (0.38 + 0.52 * Math.pow(t, 0.7)) + (t > 0.86 ? 1 : 0);
    const cx = x + wd / 2;
    const xa = Math.round(cx - hw);
    const xb = Math.round(cx + hw);
    for (let px = xa; px < xb; px++) {
      const u = (px - xa) / Math.max(1, xb - xa - 1);
      let idx = u < 0.2 ? 0 : u < 0.5 ? 1 : u < 0.8 ? 2 : 3;
      if ((px - xa) % 3 === 2 && px < xb - 1) idx += 1; // vertical ridges
      if (y >= top + 2 && (y - top) % 4 === 0 && ih(px, y, 51) < 0.4) idx = Math.max(0, idx - 1);
      if (px === xb - 1 || y === base - 1) idx = 4;
      buf.set(px, y, at(rp, idx));
    }
    // Rim and dark osculum.
    if (y === top) {
      for (let px = xa + 1; px < xb - 1; px++) buf.set(px, y, at(rp, 0));
    } else if (y === top + 1) {
      for (let px = xa + 1; px < xb - 1; px++) buf.set(px, y, px === xa + 1 ? at(rp, 1) : w('ink', undefined, 0));
      buf.set(xb - 2, y, at(rp, 2));
    } else if (y === top + 2 && xb - xa > 5) {
      for (let px = xa + 2; px < xb - 2; px++) buf.set(px, y, at(rp, 4));
    }
  }
}

function tubes(buf: Buf, x: number, base: number, h: number, rp: readonly number[], seed: number): void {
  const n = 2 + Math.floor(ih(seed, 0, 61) * 3);
  let px = x;
  for (let k = 0; k < n; k++) {
    const th = Math.max(4, Math.round(h * (0.5 + ih(seed, k, 62) * 0.5)));
    const tw = 2 + (ih(seed, k, 63) < 0.6 ? 1 : 0);
    const top = base - th;
    for (let y = top; y < base; y++) {
      for (let i = 0; i < tw; i++) {
        let idx = i === 0 ? 1 : i === tw - 1 ? 3 : 2;
        if (y === top) idx = 0;
        if ((y - top) % 5 === 4) idx = Math.min(4, idx + 1);
        buf.set(px + i, y, at(rp, idx));
      }
    }
    if (tw === 3) buf.set(px + 1, top, w('ink', 'purple', 0.3));
    buf.set(px, top, at(rp, 0));
    px += tw + (ih(seed, k, 64) < 0.5 ? 0 : 1);
  }
}

function seaRod(buf: Buf, cx: number, base: number, h: number, pal: { lit: number; mid: number; dark: number }, seed: number): void {
  const branch = (x: number, y: number, len: number, lean: number, depth: number, k: number): void => {
    let px = x;
    for (let i = 0; i < len; i++) {
      const y1 = y - i;
      if (ih(seed, k * 31 + i, 71) < 0.18) px += lean;
      buf.set(px, y1, i < 2 && depth === 2 ? pal.dark : pal.mid);
      buf.set(px + 1, y1, pal.dark);
      if (depth > 0 && i > 2 && i % 4 === 3 && ih(seed, k * 7 + i, 72) < 0.75) {
        const dir = (i >> 2) % 2 ? 1 : -1;
        // A short horizontal elbow, then up: the candelabra look.
        buf.set(px + dir, y1, pal.mid);
        buf.set(px + dir * 2, y1, pal.mid);
        branch(px + dir * 2, y1 - 1, Math.round((len - i) * 0.75), dir * 0.5, depth - 1, k * 3 + i);
      }
    }
    buf.set(px, y - len, pal.lit);
  };
  branch(cx, base - 1, h, 0, 2, 1);
}

/** Short static grass blades (density layer under the swaying blades). */
function grassTuft(buf: Buf, x: number, base: number, h: number, turtle: boolean, seed: number): void {
  const cols = turtle ? [w('seafoam'), w('forest'), w('moss'), w('olive')] : [w('seafoam', 'forest', 0.4), w('forest'), w('moss'), w('seafoam')];
  const n = 2 + Math.floor(ih(seed, 0, 81) * 3);
  for (let k = 0; k < n; k++) {
    const bx = x + k * (turtle ? 2 : 1) + (ih(seed, k, 82) < 0.3 ? 1 : 0);
    const bh = Math.max(2, Math.round(h * (0.5 + ih(seed, k, 83) * 0.5)));
    const lean = ih(seed, k, 84) < 0.5 ? -1 : 1;
    for (let i = 0; i < bh; i++) {
      const ox = i > bh * 0.6 ? lean : 0;
      const c = i < 2 ? at(cols, 1) : at(cols, k % 2 ? 2 : 0);
      buf.set(bx + ox, base - 1 - i, c);
      if (turtle) buf.set(bx + ox + 1, base - 1 - i, at(cols, 1));
    }
    if (ih(seed, k, 85) < 0.4) buf.set(bx + lean, base - bh, at(cols, 3));
  }
}

function propagule(buf: Buf, cx: number, base: number, h: number, seed: number): void {
  const lean = ih(seed, 0, 91) < 0.5 ? -1 : 1;
  for (let i = 0; i < h; i++) {
    const ox = i > h * 0.6 ? lean : 0;
    buf.set(cx + ox, base - 1 - i, i < h * 0.5 ? w('olive', 'brown', 0.5) : w('olive'));
  }
  const tx = cx + lean;
  const ty = base - h;
  buf.set(tx - 1, ty, w('seafoam'));
  buf.set(tx + 1, ty, w('moss'));
  buf.set(tx - 2, ty - 1, w('seafoam', 'lime', 0.4));
  buf.set(tx + 2, ty - 1, w('moss'));
  buf.set(tx, ty - 1, w('forest'));
}

function twig(buf: Buf, x: number, base: number, len: number, seed: number): void {
  const rise = 1 + Math.floor(ih(seed, 0, 95) * 3);
  for (let i = 0; i < len; i++) {
    const y = base - 1 - Math.round((i / len) * rise);
    buf.set(x + i, y, i % 4 === 0 ? w('brown') : w('bark'));
    buf.set(x + i, y - 1, i % 3 === 0 ? w('brown', 'tan', 0.3) : w('brown'));
  }
  buf.set(x + (len >> 1), base - 3 - rise, w('brown'));
  buf.set(x + (len >> 1) + 1, base - 4 - rise, w('bark'));
}

function blackCoral(buf: Buf, cx: number, base: number, h: number, seed: number): void {
  const stem = w('charcoal', 'ink', 0.4);
  const twig1 = w('charcoal');
  const polyp = w('silver', 'charcoal', 0.3);
  const grow = (x: number, y: number, ang: number, len: number, depth: number, k: number): void => {
    for (let i = 0; i < len; i++) {
      const px = Math.round(x + Math.sin(ang) * i);
      const py = Math.round(y - Math.cos(ang) * i);
      buf.set(px, py, depth === 2 ? stem : twig1);
      if (depth === 0 && i % 2 === 1) buf.set(px + 1, py, polyp);
    }
    if (depth <= 0) return;
    const ex = x + Math.sin(ang) * len;
    const ey = y - Math.cos(ang) * len;
    const n = 2 + (ih(seed, k, 101) < 0.5 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const a = ang + (j - (n - 1) / 2) * 0.7 + (ih(seed, k * 5 + j, 102) - 0.5) * 0.3;
      grow(ex, ey, a, len * 0.7, depth - 1, k * 4 + j);
    }
  };
  grow(cx, base - 1, 0, Math.round(h * 0.38), 2, 1);
}

function seaPen(buf: Buf, cx: number, base: number, h: number): void {
  for (let i = 0; i < h; i++) {
    const y = base - 1 - i;
    buf.set(cx, y, i < h * 0.4 ? w('tan', 'brown', 0.4) : w('pink', 'cream', 0.3));
    if (i > h * 0.4 && i % 2 === 0) {
      buf.set(cx - 1, y, w('pink'));
      buf.set(cx + 1, y, w('magenta'));
      if (i > h * 0.55 && i < h - 2) {
        buf.set(cx - 2, y + 1, w('pink', 'magenta', 0.4));
        buf.set(cx + 2, y + 1, w('magenta', 'purple', 0.4));
      }
    }
  }
}

function glassSponge(buf: Buf, x: number, base: number, wd: number, h: number): void {
  const lit = w('white');
  const mid = w('silver');
  const dark = w('slate');
  for (let y = base - h; y < base; y++) {
    const t = (base - y) / h;
    const hw = (wd / 2) * (0.5 + 0.5 * t);
    const cx = x + wd / 2;
    const xa = Math.round(cx - hw);
    const xb = Math.round(cx + hw);
    for (let px = xa; px < xb; px++) {
      const edge = px === xa || px === xb - 1;
      if (!edge && (px + y) % 2 === 0) continue;
      buf.set(px, y, px === xa ? lit : edge ? dark : mid);
    }
  }
}

// ---- mangrove (front layer: over fish) -------------------------------------

/** Mangrove: leafy canopy above the surface, trunk, and arching prop roots. */
export function paintMangrove(buf: Buf, d: Decor): void {
  const rootBottom = d.y + d.h;
  if (!buf.hits(d.x - 40, d.y - 30, d.w + 80, d.h + 40)) return;
  const tx = d.x + Math.floor(d.w / 2);
  const seed = d.x;
  // Hanging aerial roots from the canopy.
  for (let k = 0; k < 3; k++) {
    const ax = d.x + 4 + Math.floor(ih(seed, k, 111) * (d.w - 8));
    if (Math.abs(ax - tx) < 4) continue;
    for (let y = d.y + 10; y < 4 + k * 3; y++) buf.set(ax + (y > 0 ? (k % 2 ? 1 : -1) : 0), y, ROOT_MID);
  }
  // Trunk above water.
  for (let y = d.y + 8; y < 8; y++) {
    buf.set(tx - 2, y, ROOT_LIT);
    buf.set(tx - 1, y, ROOT_MID);
    buf.set(tx, y, ROOT_MID);
    buf.set(tx + 1, y, ROOT_DARK);
    if (ih(tx, y, 112) < 0.2) buf.set(tx - 1, y, ROOT_LIT);
  }
  // Prop roots: arch out from the trunk and plunge down; 2px with a lit side.
  const n = 7 + Math.floor(d.w / 14);
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const sy = -6 + Math.floor(ih(seed, i, 113) * 12);
    const ex = d.x + Math.round(t * (d.w - 2)) + Math.round((ih(seed, i, 114) - 0.5) * 6);
    const ey = rootBottom - Math.floor(ih(seed, i, 115) * 10);
    const sx = tx + (ex < tx ? -1 : 1);
    const steps = Math.ceil((Math.abs(ex - sx) + Math.abs(ey - sy)) * 1.6);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const px = Math.round(sx + (ex - sx) * Math.sin(u * Math.PI * 0.5));
      const py = Math.round(sy + (ey - sy) * (1 - Math.cos(u * Math.PI * 0.5)));
      pts.push([px, py, u]);
    }
  }
  for (const [px, py, u] of pts) {
    if (u > 0.93) continue;
    buf.set(px + 1, py, ROOT_DARK);
    buf.set(px + 1, py + 1, ROOT_DARK);
  }
  for (const [px, py, u] of pts) {
    let c = u > 0.93 ? ROOT_MID : ROOT_LIT;
    if (py >= 0 && py < 14 && ih(px, py, 116) < 0.28) c = ih(px, py, 117) < 0.5 ? word(P.cream) : word(P.silver);
    else if (py >= 14 && ih(px, py, 118) < 0.08) c = word(P.moss);
    buf.set(px, py, c);
  }
  // Canopy: overlapping leaf clusters, back (dark) to front (lit).
  const blobs = 6 + Math.floor(d.w / 12);
  for (let pass = 0; pass < 2; pass++) {
    for (let b = 0; b < blobs; b++) {
      const t = b / (blobs - 1);
      const bx = d.x - 8 + t * (d.w + 16) + (ih(seed, b, 121) - 0.5) * 8;
      const by = d.y + 2 + ih(seed, b, 122) * 10 - (pass === 1 ? 4 : 0) - Math.sin(t * Math.PI) * 6;
      const r = 6 + ih(seed, b, 123) * 5 - pass * 1.5;
      leafBlob(buf, bx, by, r, pass, seed + b * 13);
    }
  }
}

function leafBlob(buf: Buf, cx: number, cy: number, r: number, pass: number, seed: number): void {
  const R = Math.ceil(r) + 1;
  for (let y = Math.floor(cy - R); y <= cy + R; y++) {
    for (let x = Math.floor(cx - R * 1.3); x <= cx + R * 1.3; x++) {
      const u = (x + 0.5 - cx) / (r * 1.3);
      const v = (y + 0.5 - cy) / r;
      const q = u * u + v * v;
      // Leafy, ragged outline from 2x2 clumps.
      const clump = ih(x >> 1, y >> 1, seed);
      if (q > 1 - (clump < 0.4 ? 0.25 : 0) || (q > 0.7 && clump < 0.15)) continue;
      const I = -u * 0.55 - v * 0.8 + (clump - 0.5) * 0.7;
      let idx = I > 0.55 ? 0 : I > 0.15 ? 1 : I > -0.25 ? 2 : I > -0.6 ? 3 : 4;
      if (pass === 0) idx = Math.min(5, idx + 1);
      if (idx <= 1 && bayer(x, y) < 0.12) idx = 0;
      buf.set(x, y, at(LEAF, idx));
    }
  }
}
