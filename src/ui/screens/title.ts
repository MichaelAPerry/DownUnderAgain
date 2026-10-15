import { button, h } from '../dom';
import type { ScreenView } from './types';

/**
 * The logo, prompt and foreground swimmers are drawn on the canvas
 * (render/titleScreen.ts). Before the player starts, the whole screen is a
 * click target ("press any key" also works); afterwards the menu slides in,
 * aligned to the canvas just under the logo.
 */
export const titleScreen: ScreenView = (app) => {
  if (!app.started) {
    return h('button', {
      class: 'absolute inset-0 w-full h-full cursor-pointer bg-transparent border-0',
      attrs: { type: 'button', 'aria-label': 'Start the game', 'data-sfx': 'none' },
      onClick: () => app.start(),
    });
  }
  const soundLabel = () => (app.save.muted ? 'SOUND: OFF' : 'SOUND: ON');
  const musicLabel = () => (app.save.music ? 'MUSIC: ON' : 'MUSIC: OFF');
  const sound = button(soundLabel(), () => {
    app.setMuted(!app.save.muted);
    sound.textContent = soundLabel();
  }, { small: true });
  const music = button(musicLabel(), () => {
    app.setMusic(!app.save.music);
    music.textContent = musicLabel();
  }, { small: true });
  const seen = app.save.codex.length;
  const total = app.region.all.length;
  return h(
    'div',
    {
      class: 'absolute left-0 right-0 flex flex-col items-center gap-3 menu-in',
      style: { top: 'calc(var(--cv-top, 0px) + var(--cv-h, 100vh) * 0.48)' },
    },
    h(
      'div',
      { class: 'flex flex-col gap-2 w-56' },
      button('PLAY', () => app.go('modeSelect'), { primary: true }),
      button(`REEF CODEX ${seen}/${total}`, () => app.go('codex')),
      button('HOW TO PLAY', () => app.go('help')),
    ),
    h('div', { class: 'flex gap-2' }, sound, music),
  );
};
