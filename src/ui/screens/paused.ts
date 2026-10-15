import { button, h, panel } from '../dom';
import type { ScreenView } from './types';

export const pausedScreen: ScreenView = (app) => {
  const mute = button(app.save.muted ? 'SOUND: OFF' : 'SOUND: ON', () => {
    app.setMuted(!app.save.muted);
    mute.textContent = app.save.muted ? 'SOUND: OFF' : 'SOUND: ON';
  });
  const musicLabel = (): string => (app.save.music ? 'MUSIC: ON' : 'MUSIC: OFF');
  const music = button(musicLabel(), () => {
    app.setMusic(!app.save.music);
    music.textContent = musicLabel();
  });
  const cuesLabel = (): string => (app.save.cues ? 'FOOD-WEB CUES: ON' : 'FOOD-WEB CUES: OFF');
  const cues = button(cuesLabel(), () => {
    app.setCues(!app.save.cues);
    cues.textContent = cuesLabel();
  });
  return panel(
    'PAUSED',
    h(
      'div',
      { class: 'flex flex-col gap-3 max-w-xs mx-auto' },
      button('RESUME', () => app.resume(), { primary: true }),
      button('HOW TO PLAY', () => app.go('help')),
      mute,
      music,
      cues,
      button('QUIT TO TITLE', () => app.quit()),
    ),
    h('p', { class: 'muted text-[8px] text-center mt-4', text: 'ESC TO RESUME' }),
  );
};
