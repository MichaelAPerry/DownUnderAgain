import type { SpeciesDef, Tier } from '../../data/schema';
import { buildCustomDef } from '../../data/sandbox';
import { spriteFor, bake } from '../../render/spriteCache';
import { generateFishSprite } from '../../render/fishSprite';
import { button, h, panel, spriteImg } from '../dom';
import type { ScreenView } from './types';

const TIER_ORDER: Tier[] = ['herbivore', 'omnivore', 'carnivore', 'apex'];
const TIER_LABEL: Record<Tier, string> = {
  herbivore: 'HERBIVORES',
  omnivore: 'OMNIVORES',
  carnivore: 'CARNIVORES',
  apex: 'APEX PREDATORS',
  food: 'FOOD',
};
const TIER_COLOR: Record<Tier, string> = {
  herbivore: 'text-lime',
  omnivore: 'text-cyan',
  carnivore: 'text-orange',
  apex: 'text-red',
  food: 'text-silver',
};

function preview(def: SpeciesDef): HTMLElement {
  const frame = spriteFor(def).frames[0];
  const scale = Math.max(1, Math.min(4, Math.floor(56 / def.length)));
  return h('div', { class: 'h-14 flex items-center justify-center' }, frame ? spriteImg(frame, scale) : null);
}

export const speciesSelectScreen: ScreenView = (app) => {
  const zoneName = (id: string) => app.region.zones.find((z) => z.id === id)?.name ?? id;
  const playable = app.region.species.filter((s) => s.playable);
  const sections = TIER_ORDER.map((tier) => {
    const list = playable.filter((s) => s.tier === tier).sort((a, b) => a.length - b.length);
    if (!list.length) return null;
    return h(
      'section',
      { class: 'mb-4' },
      h('h3', { class: `${TIER_COLOR[tier]} text-[10px] mb-2`, text: TIER_LABEL[tier] }),
      h(
        'div',
        { class: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2' },
        ...list.map((def) =>
          h(
            'button',
            { class: 'card-button flex flex-col gap-1', attrs: { type: 'button' }, onClick: () => app.selectSpecies(def) },
            preview(def),
            h('span', { class: 'text-yellow', text: def.name.toUpperCase() }),
            h('span', { class: 'muted text-[8px]', text: zoneName(def.habitats[0]?.zone ?? '').toUpperCase() }),
            !def.native ? h('span', { class: 'chip text-orange self-start', text: 'INVASIVE' }) : null,
          ),
        ),
      ),
    );
  });

  const spec = app.save.custom;
  let customCard: HTMLElement;
  if (spec) {
    const def = buildCustomDef(spec);
    const frame = def.look ? bake(generateFishSprite(def.look, def.length, def.height)).frames[0] : undefined;
    customCard = h(
      'div',
      { class: 'card flex flex-col gap-2 items-start' },
      h('span', { class: 'text-pink text-[10px]', text: 'YOUR CUSTOM FISH' }),
      frame ? spriteImg(frame, Math.max(1, Math.min(4, Math.floor(56 / def.length)))) : null,
      h('span', { class: 'text-yellow', text: def.name }),
      h(
        'div',
        { class: 'flex gap-2' },
        button('PLAY', () => app.selectSpecies(def), { primary: true, small: true }),
        button('EDIT', () => app.go('sandbox'), { small: true }),
      ),
    );
  } else {
    customCard = h(
      'div',
      { class: 'card flex flex-col gap-2 items-start' },
      h('span', { class: 'text-pink text-[10px]', text: 'CUSTOM FISH SANDBOX' }),
      h('span', { text: 'Spend points to design your own creature.' }),
      button('CREATE', () => app.go('sandbox'), { primary: true, small: true }),
    );
  }

  return panel(
    'CHOOSE YOUR FISH',
    h('div', { class: 'mb-4' }, customCard),
    ...sections,
    h('div', { class: 'mt-2' }, button('< BACK', () => app.go('modeSelect'), { small: true })),
  );
};
