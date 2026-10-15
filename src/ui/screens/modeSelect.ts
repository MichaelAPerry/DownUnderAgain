import { MODE_IDS } from '../../app/save';
import { MODES } from '../../modes/session';
import { button, h, panel } from '../dom';
import type { ScreenView } from './types';

export const modeSelectScreen: ScreenView = (app) => {
  const cards = MODE_IDS.map((id) => {
    const m = MODES[id];
    const best = app.save.best[id];
    return h(
      'button',
      { class: 'card-button flex flex-col gap-2', attrs: { type: 'button' }, onClick: () => app.selectMode(id) },
      h('span', { class: 'text-yellow text-[11px]', text: m.title.toUpperCase() }),
      h('span', { class: 'leading-relaxed', text: m.blurb }),
      h('span', { class: 'muted text-[8px]', text: best !== undefined ? `BEST: ${best}` : 'BEST: ---' }),
    );
  });
  cards.push(
    h(
      'button',
      { class: 'card-button flex flex-col gap-2', attrs: { type: 'button' }, onClick: () => app.go('lanMenu') },
      h('span', { class: 'text-cyan text-[11px]', text: 'LAN REEF' }),
      h('span', { class: 'leading-relaxed', text: 'Swim with friends on the same Wi-Fi. Watch out: they can eat you too!' }),
      h('span', { class: 'muted text-[8px]', text: '2-6 PLAYERS' }),
    ),
  );
  return panel(
    'CHOOSE A MODE',
    h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }, ...cards),
    h('div', { class: 'mt-4 flex justify-start' }, button('< BACK', () => app.go('title'), { small: true })),
  );
};
