/** Guest flow: pick a fish, enter the host's invite, hand back the reply code. */
import type { LanJoin } from '../../app/api';
import type { SpeciesDef } from '../../data/schema';
import { h, panel } from '../dom';
import {
  INVITE_PREFIX, codeArea, codeShare, errorLine, errorMessage, fishGrid, fishIcon, lanButton, lanFish, onLanChange,
  qrScanner, slotChip, slotColor, stepTitle,
} from './lanCommon';
import type { ScreenView } from './types';

/** Remembered between visits so a retry keeps the same fish. */
let lastFishId: string | null = null;

export const lanJoinScreen: ScreenView = (app) => {
  const root = h('div');
  const fishes = lanFish(app);
  let fish: SpeciesDef | null = fishes.find((f) => f.id === lastFishId) ?? null;
  let join: LanJoin | null = null;
  let gen = 0;

  const leave = () => {
    gen++;
    join?.cancel();
    join = null;
    app.go('lanMenu');
  };

  const showStep1 = (prefill = '') => {
    gen++;
    join = null;
    const err = errorLine();
    const picked = h('span', { class: 'text-yellow text-[8px]' });
    const showPicked = () => {
      picked.textContent = fish ? `YOU: ${fish.name.toUpperCase()}` : '';
    };
    showPicked();
    const grid = fishGrid(fishes, fish?.id ?? null, (def) => {
      fish = def;
      lastFishId = def.id;
      showPicked();
      err.set(null);
    });
    const invite = codeArea({ label: 'Invite code', placeholder: `Paste the host’s invite code (starts with ${INVITE_PREFIX})` });
    invite.value = prefill;
    const status = h('p', { class: 'text-cyan animate-pulse', text: 'preparing your reply…' });
    status.hidden = true;

    const doJoin = (text: string) => {
      const code = text.trim();
      if (!fish) {
        err.set('Choose your fish first.');
        return;
      }
      if (!code) {
        err.set('Paste or scan the host’s invite code first.');
        return;
      }
      const chosen = fish;
      const my = ++gen;
      err.set(null);
      status.hidden = false;
      joinBtn.disabled = true;
      scanner.setDisabled(true);
      grid.setDisabled(true);
      app.lan.join(code, chosen).then(
        (j) => {
          if (my !== gen || !root.isConnected) {
            j.cancel();
            return;
          }
          join = j;
          showStep2(j, my);
        },
        (e: unknown) => {
          if (my !== gen) return;
          status.hidden = true;
          joinBtn.disabled = false;
          scanner.setDisabled(false);
          grid.setDisabled(false);
          err.set(errorMessage(e));
        },
      );
    };

    const joinBtn = lanButton('JOIN', () => doJoin(invite.value), { primary: true });
    const scanner = qrScanner('SCAN INVITE', INVITE_PREFIX, (code) => {
      invite.value = code;
      doJoin(code);
    });

    root.replaceChildren(
      h(
        'div',
        { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
        h(
          'section',
          {},
          h('div', { class: 'flex items-center justify-between gap-2' }, stepTitle(1, 'PICK YOUR FISH'), picked),
          grid.el,
        ),
        h(
          'section',
          { class: 'flex flex-col gap-2' },
          stepTitle(2, 'ENTER THE INVITE'),
          h('p', { class: 'muted text-[8px]', text: 'Ask the host for an invite: scan their QR or paste their code.' }),
          invite,
          h('div', { class: 'flex flex-wrap gap-2' }, joinBtn),
          scanner.el,
          status,
          err.el,
        ),
      ),
      h('div', { class: 'mt-4 flex justify-start' }, lanButton('< CANCEL', leave, { small: true })),
    );
  };

  const lobbyList = (): HTMLElement | null => {
    const client = app.lan.client;
    if (!client || !client.roster.length) return null;
    return h(
      'ul',
      { class: 'flex flex-col gap-1' },
      ...client.roster.map((r) =>
        h(
          'li',
          { class: 'flex items-center gap-2' },
          slotChip(r.slot),
          h('span', { style: { color: slotColor(r.slot) }, text: r.name }),
          r.slot === client.slot ? h('span', { class: 'chip text-yellow', text: 'YOU' }) : null,
        ),
      ),
    );
  };

  const showStep2 = (j: LanJoin, my: number) => {
    const err = errorLine();
    const status = h('p', { class: 'text-cyan animate-pulse', text: 'waiting for the host…' });
    const lobby = h('div', { class: 'flex flex-col gap-2' });
    const renderLobby = () => {
      const list = lobbyList();
      lobby.replaceChildren(...(list ? [h('p', { class: 'muted text-[8px]', text: 'IN THE REEF' }), list] : []));
    };
    const restart = lanButton('START OVER', () => {
      j.cancel();
      showStep1();
    }, { small: true });
    restart.hidden = true;

    root.replaceChildren(
      h(
        'div',
        { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
        h(
          'section',
          { class: 'flex flex-col gap-2' },
          stepTitle(3, 'SHOW THIS REPLY TO THE HOST'),
          h('p', { class: 'muted text-[8px]', text: 'Show this to the host (they scan it or type it in).' }),
          codeShare(j.reply, 'Reply code'),
        ),
        h(
          'section',
          { class: 'flex flex-col gap-2' },
          fish ? h('div', { class: 'flex items-center gap-2' }, fishIcon(fish, 40), h('span', { class: 'text-yellow', text: fish.name.toUpperCase() })) : null,
          status,
          err.el,
          restart,
          lobby,
        ),
      ),
      h('div', { class: 'mt-4 flex justify-start' }, lanButton('< CANCEL', leave, { small: true })),
    );

    j.connected.then(
      () => {
        if (my !== gen) return;
        status.className = 'text-lime';
        status.textContent = 'Connected! Waiting for the host to start';
        renderLobby();
      },
      (e: unknown) => {
        if (my !== gen) return;
        status.hidden = true;
        err.set(errorMessage(e));
        restart.hidden = false;
      },
    );
    onLanChange(app, lobby, () => {
      if (my === gen) renderLobby();
    });
  };

  showStep1();
  return panel('JOIN A REEF', root);
};
