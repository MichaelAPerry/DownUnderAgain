import type { SpeciesDef, Tier } from '../../data/schema';
import { foodWebFor } from '../../sim/foodWeb';
import { spriteFor } from '../../render/spriteCache';
import { button, h, panel, spriteImg } from '../dom';
import type { ScreenView } from './types';

const GROUPS: ReadonlyArray<readonly [Tier, string]> = [
  ['apex', 'APEX PREDATORS'],
  ['carnivore', 'CARNIVORES'],
  ['omnivore', 'OMNIVORES'],
  ['herbivore', 'HERBIVORES'],
  ['food', 'PLANTS & SMALL LIFE'],
];

export const codexScreen: ScreenView = (app) => {
  const all = app.region.all;
  const found = new Set(app.save.codex);
  const known = (d: SpeciesDef): boolean => found.has(d.id);
  const discovered = all.filter(known).length;

  const sprite = (def: SpeciesDef, scale: number, hidden: boolean): HTMLElement => {
    const frame = spriteFor(def).frames[0];
    const c = frame ? spriteImg(frame, scale) : h('span');
    if (hidden) c.classList.add('opacity-30', 'brightness-0');
    return h('span', { class: 'flex items-center justify-center h-10 w-full overflow-hidden' }, c);
  };

  const names = (defs: SpeciesDef[]): string =>
    defs.length ? defs.map((d) => (known(d) ? d.name : '???')).join(', ') : 'nothing';

  const details = h('div', { class: 'card flex flex-col gap-2 min-h-[160px]' });
  const show = (def: SpeciesDef): void => {
    details.replaceChildren();
    if (!known(def)) {
      details.append(sprite(def, 3, true), h('div', { class: 'text-yellow text-center', text: '???' }));
      return;
    }
    const web = foodWebFor(def, all);
    const scale = Math.max(1, Math.min(8, Math.floor(120 / Math.max(def.length, def.height))));
    const frame = spriteFor(def).frames[0];
    const zones = def.habitats.map((hb) => app.region.zones.find((z) => z.id === hb.zone)?.name ?? hb.zone);
    details.append(
      h('div', { class: 'flex items-center justify-center min-h-[64px]' }, frame ? spriteImg(frame, scale) : null),
      h('div', { class: 'text-yellow text-xs text-center', text: def.name.toUpperCase() }),
      h('div', { class: 'text-silver text-[8px] italic text-center', text: def.scientific }),
      h('div', { class: 'text-center' }, h('span', { class: `chip ${def.native ? 'text-lime' : 'text-orange'}`, text: def.codex.status.toUpperCase() })),
      h('div', { text: `SIZE: ${def.codex.size}` }),
      h('p', { text: def.codex.blurb }),
      h('p', { class: 'text-cyan', text: def.codex.fact }),
      h('div', { text: `HABITAT: ${zones.join(', ')}` }),
      h('div', { text: `DIET: ${def.diet.length ? def.diet.join(', ') : 'none'}` }),
      h('div', { text: `EATS: ${names(web.eats)}` }),
      h('div', { text: `EATEN BY: ${names(web.eatenBy)}` }),
    );
  };
  details.append(h('p', { class: 'muted text-center', text: 'SELECT AN ENTRY' }));

  const groups = GROUPS.map(([tier, label]) => {
    const defs = all.filter((d) => d.tier === tier);
    if (!defs.length) return null;
    const cards = defs.map((def) =>
      h(
        'button',
        {
          class: 'card-button flex flex-col items-center gap-1',
          attrs: { type: 'button', 'data-sfx': 'select' },
          onClick: () => show(def),
        },
        sprite(def, def.length < 10 ? 3 : 2, !known(def)),
        h('span', { class: 'text-[8px] text-center', text: known(def) ? def.name : '???' }),
      ),
    );
    return h(
      'div',
      { class: 'mb-3' },
      h('h3', { class: 'text-yellow text-[9px] mb-2', text: label }),
      h('div', { class: 'grid grid-cols-2 sm:grid-cols-3 gap-2' }, ...cards),
    );
  });

  return panel(
    'REEF CODEX',
    h('p', { class: 'text-center text-cyan mb-3', text: `${discovered}/${all.length} DISCOVERED` }),
    h(
      'div',
      { class: 'grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-3' },
      h('div', { class: 'max-h-[50vh] md:max-h-[60vh] overflow-y-auto pr-1' }, ...groups),
      h('div', { class: 'max-h-[40vh] md:max-h-[60vh] overflow-y-auto' }, details),
    ),
    h('div', { class: 'mt-4 flex justify-start' }, button('< BACK', () => app.go('title'), { small: true })),
  );
};
