/** Hand-drawn sprites for plants, plankton and invertebrates. */
import type { FoodSpriteId } from '../data/schema';
import { PALETTE } from '../data/palette';
import { fromRows } from './pixelSprite';
import type { PixelSprite } from './pixelSprite';

const P = PALETTE;

const DEFS: Record<FoodSpriteId, { frames: string[][]; legend: Record<string, string> }> = {
  // Filamentous algae tuft: three fronds with lit tips, swaying.
  algae: {
    legend: { l: P.lime, g: P.seafoam, d: P.forest, m: P.moss },
    frames: [
      ['l...l.', 'g.l.g.', 'gdg.gl', '.gdgd.', 'mgdgdm', '.mdmm.'],
      ['.l...l', '.g.l.g', '.gdg.g', '.gdgd.', 'mgdgdm', '.mdmm.'],
    ],
  },
  // Turtle-grass blades: 2px wide, lit left edge, an old olive tip.
  seagrass: {
    legend: { l: P.lime, g: P.seafoam, d: P.forest, o: P.olive, m: P.moss },
    frames: [
      ['lg....', 'gd..o.', 'gd..gl', 'gd..gd', 'gdl.gd', 'gdgdgd', 'gdgdgd', 'gdgdgd', 'dmgddm', 'mmmmmm'],
      ['.lg...', '.gd..o', '.gd..g', 'gd..gd', 'gdl.gd', 'gdgdgd', 'gdgdgd', 'gdgdgd', 'dmgddm', 'mmmmmm'],
    ],
  },
  // Polyp colony: tentacle tips extend and retract.
  coral: {
    legend: { w: P.cream, y: P.yellow, o: P.orange, t: P.tan, r: P.rust, b: P.brown },
    frames: [
      ['.w.wy.w.', 'yy.yo.yw', 'oy.oy.yy', 'oytoyroy', 'rotrotro', 'bbrbbrbb'],
      ['w..yw..w', 'yy.yo.yy', 'oy.oy.yo', 'oytoyroy', 'rotrotro', 'bbrbbrbb'],
    ],
  },
  // Copepod: flicking antennae, glassy body.
  plankton: {
    legend: { w: P.white, c: P.cyan, t: P.teal },
    frames: [
      ['c..c', '.wc.', '.cw.', '..t.'],
      ['.c.c', 'cwc.', '.cw.', '..t.'],
    ],
  },
  // Mosquito larva: dark head, segmented body, breathing siphon up to the surface; wriggles.
  larva: {
    legend: { k: P.ink, b: P.brown, t: P.tan },
    frames: [
      ['..t', 'kbb'],
      ['.t.', 'kb.'],
    ],
  },
  // Shrimp: banded translucent body, antenna, walking legs.
  shrimp: {
    legend: { p: P.pink, w: P.cream, r: P.red, k: P.ink },
    frames: [
      ['..ppw', 'rpwpk', '.r.ww'],
      ['..pw.', 'rpwpk', 'r..w.'],
    ],
  },
  // Blue crab: orange-tipped claws, stalked eyes, scuttling legs.
  crab: {
    legend: { o: P.orange, k: P.ink, b: P.blue, s: P.sky, n: P.navy },
    frames: [
      ['o.k.k.o', 'bssbssb', '.bbbbn.', 'b.n.n.b'],
      ['.ok.ko.', 'bssbssb', '.bbbbn.', '.n.n.n.'],
    ],
  },
  // Bristle worm (polychaete) wriggling, orange head.
  worm: {
    legend: { r: P.red, p: P.pink, o: P.orange, c: P.crimson },
    frames: [
      ['.pr..', 'c..po'],
      ['c..po', '.pr..'],
    ],
  },
  // Clam: ribbed shell gaping to show the pink mantle.
  clam: {
    legend: { s: P.silver, g: P.grey, d: P.darkgrey, w: P.white, p: P.pink },
    frames: [
      ['.sws.', 'sgsgd', 'dpwpd', '.dgd.'],
      ['.sws.', 'sgsgd', 'gdgdd', '.dgd.'],
    ],
  },
  // Krill: eye, red body, paddling legs.
  krill: {
    legend: { r: P.red, o: P.orange, p: P.pink, k: P.ink },
    frames: [
      ['rpok', '.r.p'],
      ['rpok', 'r.p.'],
    ],
  },
};

export function foodSprite(id: FoodSpriteId): PixelSprite {
  const d = DEFS[id];
  return fromRows(d.frames, d.legend);
}

export const FOOD_SPRITE_IDS = Object.keys(DEFS) as FoodSpriteId[];
