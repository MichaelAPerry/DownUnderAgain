/** LAN REEF menu: set your name, then host or join a reef on the same Wi-Fi. */
import { h, panel } from '../dom';
import { NAME_MAX, cleanName, errorLine, errorMessage, fishGrid, lanButton, lanFish } from './lanCommon';
import type { ScreenView } from './types';

export const lanMenuScreen: ScreenView = (app) => {
  const root = h('div');

  const nameInput = h('input', {
    class: 'font-pixel text-[11px] bg-ink text-yellow border-2 border-charcoal px-2 py-2 w-full max-w-[220px] min-h-[40px] uppercase',
    attrs: {
      type: 'text',
      maxlength: String(NAME_MAX),
      'aria-label': 'Your name',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      enterkeyhint: 'done',
    },
  });
  nameInput.value = cleanName(app.lan.playerName);
  const commitName = () => {
    const clean = cleanName(nameInput.value);
    if (clean !== nameInput.value) nameInput.value = clean;
    if (clean.trim()) app.lan.setPlayerName(clean.trim());
  };
  nameInput.addEventListener('input', commitName);
  nameInput.addEventListener('change', () => {
    commitName();
    nameInput.value = cleanName(app.lan.playerName);
  });

  const nameRow = h(
    'label',
    { class: 'flex flex-wrap items-center gap-2 mb-3' },
    h('span', { class: 'text-cyan', text: 'NAME' }),
    nameInput,
  );

  const card = (title: string, blurb: string, color: string, onClick: () => void): HTMLButtonElement => {
    const b = h(
      'button',
      { class: 'card-button flex flex-col gap-2 min-h-[72px]', attrs: { type: 'button' }, onClick },
      h('span', { class: `${color} text-[11px]`, text: title }),
      h('span', { class: 'leading-relaxed', text: blurb }),
    );
    return b;
  };

  const showMenu = () => {
    root.replaceChildren(
      h(
        'div',
        { class: 'mb-3 flex flex-col gap-1' },
        h('p', { text: 'Play with friends on the same Wi-Fi. No internet server needed.' }),
        h('p', { class: 'muted', text: 'The host runs the reef, so keep the host’s device open and awake.' }),
      ),
      nameRow,
      h(
        'div',
        { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3' },
        card('HOST A REEF', 'Pick your fish, then invite friends with a code or QR.', 'text-yellow', () => {
          commitName();
          showPicker();
        }),
        card('JOIN A REEF', 'Enter or scan the invite from a friend who is hosting.', 'text-cyan', () => {
          commitName();
          app.go('lanJoin');
        }),
      ),
      h('p', {
        class: 'muted text-[8px] mt-3',
        text: 'Tip: if friends can’t connect, check that the Wi-Fi allows devices to see each other (guest networks often don’t).',
      }),
      h('div', { class: 'mt-4 flex justify-start' }, lanButton('< BACK', () => app.go('modeSelect'), { small: true })),
    );
  };

  const showPicker = () => {
    const err = errorLine();
    const grid = fishGrid(lanFish(app), null, (def) => {
      grid.setDisabled(true);
      try {
        app.lan.hostReef(def);
      } catch (e) {
        grid.setDisabled(false);
        err.set(errorMessage(e));
      }
    });
    const back = lanButton('< BACK', showMenu, { small: true });
    root.replaceChildren(
      h('p', { class: 'text-cyan mb-1', text: 'CHOOSE YOUR FISH' }),
      h('p', { class: 'muted text-[8px] mb-2', text: 'You can pick a different fish each time you respawn.' }),
      grid.el,
      err.el,
      h('div', { class: 'mt-4 flex justify-start' }, back),
    );
    back.focus({ preventScroll: true });
  };

  showMenu();
  return panel('LAN REEF', root);
};
