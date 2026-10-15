import type { SpeciesDef } from '../../data/schema';
import { STAGE_GROWTH, STAGE_TIME } from '../../modes/session';
import { spriteFor } from '../../render/spriteCache';
import { button, h, panel, spriteImg } from '../dom';
import type { ScreenView } from './types';

function salinityLabel(def: SpeciesDef): string {
  const [min, max] = def.salinity;
  if (min <= 0.05 && max >= 0.95) return 'ANY';
  if (max <= 0.3) return 'FRESH';
  if (min >= 0.7) return 'MARINE';
  return 'BRACKISH';
}

export const briefingScreen: ScreenView = (app) => {
  const session = app.session;
  if (!session) {
    return panel('NO DIVE', button('TITLE', () => app.go('title'), { primary: true }));
  }
  const sp = session.species;
  const mode = session.mode;
  const title = mode.staged ? `STAGE ${session.stage + 1}/${session.stages}` : mode.title.toUpperCase();

  const zoneNames = sp.habitats.map((hb) => app.region.zones.find((z) => z.id === hb.zone)?.name ?? hb.zone);
  let goal: string;
  if (mode.staged) goal = `GOAL: EAT ${STAGE_GROWTH}% ENERGY OR SURVIVE ${STAGE_TIME}S`;
  else if (mode.usesEvolution) {
    const touch = document.documentElement.classList.contains('touch-ui');
    goal = `GOAL: EAT TO EARN BIOMASS. ${touch ? 'TAP THE EVOLVE BUTTON' : 'PRESS TAB'} TO MUTATE`;
  }
  else goal = 'GOAL: SURVIVE AS LONG AS YOU CAN';

  const frame = spriteFor(sp).frames[0];
  const scale = Math.max(2, Math.min(8, Math.floor(160 / sp.length)));
  const preview = frame ? spriteImg(frame, scale) : null;

  const begin = (): void => app.begin();

  const el = panel(
    title,
    h(
      'div',
      { class: 'flex flex-col items-center gap-2 text-center' },
      h('div', { class: 'flex items-center justify-center min-h-[96px] my-2' }, preview),
      h('div', { class: 'text-yellow text-xs', text: sp.name.toUpperCase() }),
      h('div', { class: 'text-silver text-[8px] italic', text: sp.scientific }),
      h('span', { class: 'chip text-cyan', text: sp.tier.toUpperCase() }),
      h('p', { class: 'max-w-md', text: sp.codex.blurb }),
      h(
        'div',
        { class: 'flex flex-col gap-1 text-[8px]' },
        h('div', { text: `HOME: ${zoneNames.join(', ')}` }),
        h('div', { text: `DIET: ${sp.diet.length ? sp.diet.join(', ').toUpperCase() : 'NONE'}` }),
        h('div', { text: `SALINITY: ${salinityLabel(sp)}` }),
      ),
      h('p', { class: 'text-lime text-[9px] mt-2', text: goal }),
      mode.id === 'tournament' ? h('p', { class: 'text-orange text-[9px]', text: `LIVES: ${session.lives}` }) : null,
    ),
    h(
      'div',
      { class: 'mt-4 flex items-center justify-between gap-3' },
      button('QUIT', () => app.quit(), { small: true }),
      button('DIVE IN!', begin, { primary: true }),
    ),
  );

  const onKey = (e: KeyboardEvent): void => {
    if (!el.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    // Buttons handle Enter natively; reacting here too would double-fire (or
    // dive straight through from the card that opened this screen).
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    if (e.key === 'Enter' && !e.repeat) {
      app.sfx('confirm');
      begin();
    }
  };
  document.addEventListener('keydown', onKey);
  return el;
};
