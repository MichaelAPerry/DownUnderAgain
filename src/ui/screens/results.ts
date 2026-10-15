import { MODES } from '../../modes/session';
import { button, h, panel } from '../dom';
import type { ScreenView } from './types';

function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const resultsScreen: ScreenView = (app) => {
  const session = app.session;
  if (!session) return panel('NO RUN', button('TITLE', () => app.go('title'), { primary: true }));
  const s = session.summary();
  const row = (label: string, value: string, cls = ''): HTMLElement =>
    h(
      'div',
      { class: 'flex justify-between gap-4 py-1 border-b border-charcoal' },
      h('span', { class: 'muted', text: label }),
      h('span', { class: cls, text: value }),
    );

  const names = s.discoveries
    .slice(0, 6)
    .map((id) => app.region.all.find((d) => d.id === id)?.name ?? id);
  const isBest = s.score > 0 && app.save.best[s.mode] === s.score;

  return panel(
    s.won ? 'VICTORY!' : 'GAME OVER',
    h(
      'div',
      { class: 'max-w-md mx-auto' },
      isBest ? h('p', { class: 'text-lime text-center text-xs animate-pulse mb-2', text: 'NEW BEST!' }) : null,
      h('div', { class: 'text-center my-3' },
        h('div', { class: 'muted text-[8px]', text: 'SCORE' }),
        h('div', { class: 'text-yellow text-2xl', text: String(s.score) }),
      ),
      row('MODE', MODES[s.mode].title.toUpperCase()),
      row('FISH', s.speciesName.toUpperCase()),
      row('TIME', fmtTime(s.time)),
      row('MEALS', String(s.meals)),
      MODES[s.mode].staged ? row('STAGE', `${s.stage}/${s.stages}`) : null,
      row('INVASIVE LIONFISH REMOVED', String(s.invasivesRemoved)),
      s.cause ? row('CAUSE OF DEATH', s.cause, 'text-orange text-right') : null,
      row('NEW CODEX ENTRIES', String(s.discoveries.length), 'text-cyan'),
      names.length
        ? h('p', { class: 'text-[8px] text-silver mt-1', text: names.join(', ') + (s.discoveries.length > names.length ? ', ...' : '') })
        : null,
    ),
    h(
      'div',
      { class: 'mt-4 flex gap-3 flex-wrap justify-center' },
      button('PLAY AGAIN', () => app.playAgain(), { primary: true }),
      button('CHANGE MODE', () => app.go('modeSelect')),
      button('TITLE', () => app.quit()),
    ),
  );
};
