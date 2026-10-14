import { button, h, panel } from '../dom';
import type { ScreenView } from './types';

export const helpScreen: ScreenView = (app) => {
  const section = (title: string, ...body: Array<HTMLElement | string>): HTMLElement =>
    h(
      'section',
      { class: 'mb-4' },
      h('h3', { class: 'text-yellow text-[10px] mb-2', text: title }),
      ...body.map((b) => (typeof b === 'string' ? h('p', { class: 'mb-1', text: b }) : b)),
    );
  const list = (items: string[]): HTMLElement =>
    h('ul', { class: 'flex flex-col gap-1' }, ...items.map((t) => h('li', { text: `- ${t}` })));

  const zones = app.region.zones.map((z, i) =>
    h('li', {}, h('span', { class: 'text-cyan', text: `${i + 1}. ${z.name.toUpperCase()}: ` }), z.tagline),
  );

  return panel(
    'HOW TO PLAY',
    section('CONTROLS', list([
      'WASD / ARROWS: SWIM',
      'HOLD LEFT MOUSE: SWIM TOWARD CURSOR',
      'SHIFT or SPACE: BURST (uses extra energy)',
      'ESC or P: PAUSE',
      'TAB: EVOLVE (Evolution mode)',
      'M: MUTE',
    ])),
    section(
      'SURVIVAL',
      'Energy drops over time: eat to refill it. Swim into food mouth-first to eat.',
      'Health drops when starving, stung, in the wrong salinity or when parasites build up.',
      'Visit a cleaner goby on the reef, or rub against the sand, to shed parasites.',
      'Small fish can hide in seagrass, mangrove roots and reef crevices.',
    ),
    section('FOOD-WEB CUES', list([
      'Green mark: you can eat it',
      'Red !: a predator has noticed you',
      'Cyan +: a cleaner (when you have parasites)',
    ])),
    section('THE TRANSECT', h('ul', { class: 'flex flex-col gap-1' }, ...zones)),
    section(
      'INVASIVE LIONFISH',
      'Lionfish are not native to Florida. Their numbers grow over time and crowd out small reef fish. Eating one scores double, but watch out for venomous spines!',
    ),
    h('div', { class: 'mt-2 flex justify-start' }, button('< BACK', () => app.go(app.previous === 'paused' ? 'paused' : 'title'), { small: true })),
  );
};
