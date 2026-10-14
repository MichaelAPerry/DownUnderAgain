import { button, h } from '../dom';
import type { ScreenView } from './types';

export const titleScreen: ScreenView = (app) => {
  const mute = button(app.save.muted ? 'SOUND: OFF' : 'SOUND: ON', () => {
    app.setMuted(!app.save.muted);
    mute.textContent = app.save.muted ? 'SOUND: OFF' : 'SOUND: ON';
  }, { small: true });
  const seen = app.save.codex.length;
  const total = app.region.all.length;
  return h(
    'div',
    { class: 'screen flex-col gap-6' },
    h(
      'div',
      { class: 'text-center' },
      h('h1', {
        class: 'text-2xl sm:text-4xl text-yellow tracking-widest leading-tight',
        text: 'DOWN UNDER',
        style: { textShadow: '4px 4px 0 #141420, -2px -2px 0 #ef7d57' },
      }),
      h('h1', {
        class: 'text-xl sm:text-3xl text-cyan tracking-widest mt-2',
        text: 'AGAIN',
        style: { textShadow: '4px 4px 0 #141420' },
      }),
      h('p', { class: 'mt-4 text-[10px] text-cream', text: 'FLORIDA: RIVER TO REEF', style: { textShadow: '2px 2px 0 #141420' } }),
    ),
    h(
      'div',
      { class: 'flex flex-col gap-3 w-56' },
      button('PLAY', () => app.go('modeSelect'), { primary: true }),
      button(`REEF CODEX ${seen}/${total}`, () => app.go('codex')),
      button('HOW TO PLAY', () => app.go('help')),
    ),
    h('div', { class: 'flex gap-3 items-center' }, mute),
    h('p', {
      class: 'absolute bottom-2 left-0 right-0 text-center text-[8px] text-silver',
      text: 'A spiritual successor to the 1994 classic. Fan-made, not affiliated.',
      style: { textShadow: '1px 1px 0 #141420' },
    }),
  );
};
