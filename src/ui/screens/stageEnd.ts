import type { SpeciesDef } from '../../data/schema';
import { spriteFor } from '../../render/spriteCache';
import { button, h, panel, spriteImg } from '../dom';
import type { ScreenView } from './types';

function preview(def: SpeciesDef): HTMLElement {
  const frame = spriteFor(def).frames[0];
  const scale = Math.max(2, Math.min(6, Math.floor(100 / def.length)));
  return h('div', { class: 'flex items-center justify-center min-h-[48px] my-2' }, frame ? spriteImg(frame, scale) : null);
}

export const stageEndScreen: ScreenView = (app) => {
  const session = app.session;
  if (!session) return panel('NO RUN', button('TITLE', () => app.go('title'), { primary: true }));
  const quit = h('div', { class: 'mt-4 flex justify-start' }, button('QUIT', () => app.quit(), { small: true }));

  if (session.outcome === 'stageClear') {
    const next = session.ladder[session.stage + 1];
    return panel(
      'STAGE CLEAR!',
      h(
        'div',
        { class: 'flex flex-col items-center gap-2 text-center' },
        h('p', { text: `YOU SURVIVED AS A ${session.species.name.toUpperCase()}` }),
        h('p', { class: 'text-yellow text-xs', text: `SCORE: ${session.score}` }),
        next
          ? h(
              'div',
              { class: 'flex flex-col items-center gap-1 mt-2' },
              h('p', { class: 'muted text-[8px]', text: 'NEXT FISH' }),
              preview(next),
              h('p', { class: 'text-cyan', text: next.name.toUpperCase() }),
            )
          : null,
        h(
          'div',
          { class: 'mt-3' },
          button('NEXT FISH', () => {
            app.sfx('confirm');
            app.next();
          }, { primary: true }),
        ),
      ),
      quit,
    );
  }

  const cause = session.cause ?? 'Unknown';
  const title = cause.startsWith('Eaten') ? 'YOU WERE EATEN!' : 'YOU DIED';
  return panel(
    title,
    h(
      'div',
      { class: 'flex flex-col items-center gap-2 text-center' },
      h('p', { class: 'text-orange', text: cause }),
      h('p', { text: `LIVES LEFT: ${session.lives}` }),
      h(
        'div',
        { class: 'mt-3 flex gap-3 flex-wrap justify-center' },
        session.canRetry
          ? button('TRY AGAIN', () => {
              app.sfx('confirm');
              app.retry();
            }, { primary: true })
          : null,
        button('GIVE UP', () => app.go('results')),
      ),
    ),
    quit,
  );
};
