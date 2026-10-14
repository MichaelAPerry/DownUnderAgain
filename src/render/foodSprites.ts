/** Hand-drawn sprites for plants, plankton and invertebrates. */
import type { FoodSpriteId } from '../data/schema';
import { PALETTE } from '../data/palette';
import { fromRows } from './pixelSprite';
import type { PixelSprite } from './pixelSprite';

const P = PALETTE;

const DEFS: Record<FoodSpriteId, { frames: string[][]; legend: Record<string, string> }> = {
  algae: {
    legend: { g: P.seafoam, d: P.forest, l: P.lime },
    frames: [
      ['.l..l.', '.g.lg.', 'gd.gd.', '.gdg.g', '.dgd.d', 'ddgddd'],
      ['l..l..', 'g.lg..', '.gdgd.', 'g.gdg.', '.dgd.d', 'ddgddd'],
    ],
  },
  seagrass: {
    legend: { g: P.seafoam, d: P.forest, l: P.lime },
    frames: [
      ['.l....', '.g..l.', '.g..g.', 'lg..g.', 'g.g.g.', 'g.g.gl', 'g.d.gg', 'd.d.dg', 'dgd.dg', 'dddddd'],
      ['..l...', '..g..l', '.g...g', 'l.g.g.', 'g.g.g.', 'g.g.g.', 'g.d.gl', 'd.d.dg', 'dgd.dg', 'dddddd'],
    ],
  },
  coral: {
    legend: { y: P.yellow, o: P.orange, t: P.tan, w: P.cream },
    frames: [
      ['.w..w..w', 'yoy.oy.y', 'oyoyoyoy', 'yotyotyo', 'ttotttot', 'tttttttt'],
      ['w..w..w.', 'yoy.oy.y', 'oyoyoyoy', 'yotyotyo', 'ttotttot', 'tttttttt'],
    ],
  },
  plankton: {
    legend: { w: P.white, c: P.cyan },
    frames: [
      ['w..c', '.c..', '..w.', 'c..w'],
      ['.w..', 'c..w', '.c..', '..c.'],
    ],
  },
  larva: {
    legend: { b: P.brown, t: P.tan },
    frames: [
      ['b.t', '.bb'],
      ['bb.', '.bt'],
    ],
  },
  shrimp: {
    legend: { p: P.pink, w: P.cream, r: P.red },
    frames: [
      ['.r.pr', 'wpwpw', 'w..r.'],
      ['r..pr', 'wpwpw', '.w.r.'],
    ],
  },
  crab: {
    legend: { b: P.blue, s: P.sky, o: P.orange, k: P.ink },
    frames: [
      ['o.k.k.o', 'obsbsbo', '.bbbbb.', 'b.b.b.b'],
      ['o.k.k.o', 'obsbsbo', '.bbbbb.', '.b.b.b.'],
    ],
  },
  worm: {
    legend: { r: P.red, p: P.pink, o: P.orange },
    frames: [
      ['.rprp', 'oprp.'],
      ['oprp.', '.rpro'],
    ],
  },
  clam: {
    legend: { g: P.grey, s: P.silver, d: P.darkgrey, w: P.cream },
    frames: [
      ['.sss.', 'sgsgs', 'gdgdg', 'dwwwd'],
      ['.sss.', 'sgsgs', 'gdgdg', 'd...d'],
    ],
  },
  krill: {
    legend: { r: P.red, o: P.orange, p: P.pink },
    frames: [
      ['.ror', 'ppo.'],
      ['ror.', '.opp'],
    ],
  },
};

export function foodSprite(id: FoodSpriteId): PixelSprite {
  const d = DEFS[id];
  return fromRows(d.frames, d.legend);
}

export const FOOD_SPRITE_IDS = Object.keys(DEFS) as FoodSpriteId[];
