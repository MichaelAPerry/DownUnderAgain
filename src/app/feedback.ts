/** Turns session feedback events into particles and sound effects. */
import { PALETTE as P } from '../data/palette';
import type { Sfx } from '../audio/sfx';
import type { FeedbackEvent } from '../modes/session';
import type { WorldRenderer } from '../render/worldRenderer';

export function presentFeedback(list: FeedbackEvent[], fx: WorldRenderer, play: (s: Sfx) => void): void {
  for (const f of list) {
    switch (f.kind) {
      case 'eat':
      case 'bigEat':
      case 'invasive':
        fx.puff(f.x, f.y, P.white);
        if (f.text) fx.floatText(f.x, f.y - 6, f.text, f.kind === 'invasive' ? P.lime : P.yellow);
        play(f.kind === 'eat' ? 'eat' : 'bigEat');
        break;
      case 'graze':
        fx.puff(f.x, f.y, P.lime);
        if (f.text) fx.floatText(f.x, f.y - 6, f.text, P.lime);
        play('graze');
        break;
      case 'sting':
        fx.puff(f.x, f.y, P.orange);
        play('sting');
        break;
      case 'hurt':
        if (f.text) fx.floatText(f.x, f.y - 6, f.text, P.white);
        play('hurt');
        break;
      case 'clean':
        fx.bubbles(f.x, f.y, 4);
        if (f.text) fx.floatText(f.x, f.y - 6, f.text, P.cyan);
        play('clean');
        break;
      case 'death':
        fx.puff(f.x, f.y, P.red);
        fx.bubbles(f.x, f.y, 8);
        play('death');
        break;
      case 'discover':
        play('select');
        break;
      case 'stage':
        play('win');
        break;
    }
  }
  list.length = 0;
}
