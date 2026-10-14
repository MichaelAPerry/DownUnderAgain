/** Evolution Mode: spend Biomass Points on mutations mid-run. */
import { PALETTE } from '../../data/palette';
import { upgradeCost } from '../../sim/stats';
import { button, h, panel } from '../dom';
import type { ScreenView } from './types';

export const shopScreen: ScreenView = (app) => {
  const root = h('div');
  const render = () => {
    const s = app.session;
    if (!s) {
      root.replaceChildren(button('RESUME', () => app.resume(), { primary: true }));
      return;
    }
    const rows = s.upgrades.map((u) => {
      const lv = s.levels[u.id] ?? 0;
      const maxed = lv >= u.maxLevel;
      const cost = maxed ? 0 : upgradeCost(u, lv);
      return h(
        'div',
        { class: 'card flex items-center gap-3' },
        h('span', { class: 'inline-block w-3 h-3 shrink-0 border-2 border-ink', style: { background: PALETTE[u.color] } }),
        h(
          'div',
          { class: 'flex-1 flex flex-col gap-1' },
          h('span', { class: 'text-yellow', text: u.name.toUpperCase() }),
          h('span', { class: 'muted text-[8px]', text: u.description }),
          h('span', { class: 'text-[8px] tracking-tighter', text: '■'.repeat(lv) + '□'.repeat(u.maxLevel - lv) }),
        ),
        button(maxed ? 'MAX' : `${cost} BIO`, () => {
          if (app.buy(u.id)) {
            app.sfx('upgrade');
            render();
          } else app.sfx('warn');
        }, { small: true, primary: !maxed && s.biomass >= cost, disabled: maxed || s.biomass < cost }),
      );
    });
    root.replaceChildren(
      h('p', { class: 'text-center text-lime mb-3', text: `BIOMASS: ${s.biomass}` }),
      h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-2' }, ...rows),
      h(
        'div',
        { class: 'mt-4 flex justify-between items-center' },
        h('span', { class: 'muted text-[8px]', text: 'TAB OR ESC TO RESUME' }),
        button('RESUME', () => app.resume(), { primary: true }),
      ),
    );
  };
  render();
  return panel('EVOLVE', root);
};
