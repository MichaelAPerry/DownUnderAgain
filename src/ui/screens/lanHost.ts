/** Host lobby: the roster of your reef plus the two-code invite flow. */
import type { AppApi, LanInvite } from '../../app/api';
import { MAX_PLAYERS } from '../../net/protocol';
import { h, panel } from '../dom';
import {
  REPLY_PREFIX, codeArea, codeShare, errorLine, errorMessage, fishIcon, lanButton, onLanChange, qrScanner,
  slotChip, slotColor, stepTitle, whenDetached,
} from './lanCommon';
import type { ScreenView } from './types';

function rosterView(app: AppApi): HTMLElement {
  const host = app.lan.host;
  if (!host) return h('p', { class: 'muted', text: 'No reef is running.' });
  const ready = host.players.filter((p) => p.ready).length;
  const rows = [...host.players]
    .sort((a, b) => a.slot - b.slot)
    .map((p) =>
      h(
        'li',
        { class: 'card flex items-center gap-2 min-h-[44px]', style: { borderLeft: `6px solid ${slotColor(p.slot)}` } },
        slotChip(p.slot),
        h(
          'div',
          { class: 'flex flex-col min-w-0 flex-1' },
          h(
            'span',
            { class: 'flex items-center gap-2' },
            h('span', { class: 'truncate', style: { color: slotColor(p.slot) }, text: p.ready ? p.name : `PLAYER ${p.slot}` }),
            p.slot === 1 ? h('span', { class: 'chip text-yellow', text: 'YOU' }) : null,
          ),
          p.ready
            ? h('span', { class: 'muted text-[8px] truncate', text: p.fish.name.toUpperCase() })
            : h('span', { class: 'text-cyan text-[8px] animate-pulse', text: 'connecting…' }),
        ),
        p.ready ? fishIcon(p.fish, 32) : null,
      ),
    );
  const open = Math.max(0, MAX_PLAYERS - host.players.length);
  for (let i = 0; i < open; i++) {
    rows.push(h('li', { class: 'border-2 border-dashed border-charcoal p-2 muted text-[8px] min-h-[44px] flex items-center', text: 'open spot' }));
  }
  return h(
    'div',
    { class: 'flex flex-col gap-2' },
    h(
      'div',
      { class: 'flex items-baseline justify-between gap-2' },
      h('h3', { class: 'text-cyan text-[10px]', text: 'PLAYERS' }),
      h('span', { class: 'muted text-[8px]', text: `${ready}/${MAX_PLAYERS}` }),
    ),
    h('ul', { class: 'flex flex-col gap-1' }, ...rows),
    host.started ? h('p', { class: 'text-lime text-[8px]', text: 'The reef is running. New friends drop straight in.' }) : null,
  );
}

/** The right-hand invite flow: one guest at a time, reset after each success. */
function invitePanel(app: AppApi, onDone: () => void): { el: HTMLElement; refresh(): void } {
  const el = h('div', { class: 'flex flex-col gap-2' });
  let invite: LanInvite | null = null;
  /** Bumped whenever the flow restarts so stale promise results are ignored. */
  let gen = 0;
  let connecting = false;
  let note: string | null = null;
  let full = false;

  const drop = () => {
    gen++;
    if (invite && !connecting) invite.cancel();
    invite = null;
    connecting = false;
  };
  // Leaving the lobby abandons an invite nobody has answered yet.
  whenDetached(el, drop);

  const isFull = () => app.lan.host?.isFull ?? true;

  const showIdle = () => {
    full = isFull();
    const btn = lanButton('INVITE A FRIEND', create, { primary: !app.lan.host || app.lan.host.players.length < 2, disabled: full });
    el.replaceChildren(
      h('h3', { class: 'text-cyan text-[10px]', text: 'INVITE A FRIEND' }),
      ...(note ? [h('p', { class: 'text-lime', text: note })] : []),
      full
        ? h('p', { class: 'muted text-[8px]', text: `The reef is full (${MAX_PLAYERS} players).` })
        : h('p', { class: 'muted text-[8px]', text: 'Each friend needs their own invite. Their device must be on the same Wi-Fi.' }),
      btn,
    );
  };

  const showError = (msg: string, withReply: HTMLElement | null) => {
    const err = errorLine();
    err.set(msg);
    el.replaceChildren(
      h('h3', { class: 'text-cyan text-[10px]', text: 'INVITE A FRIEND' }),
      err.el,
      h('div', { class: 'flex flex-wrap gap-2' }, lanButton('TRY AGAIN', () => {
        drop();
        create();
      }, { primary: true }), lanButton('CANCEL', () => {
        drop();
        showIdle();
      }, { small: true })),
      ...(withReply ? [withReply] : []),
    );
  };

  function create(): void {
    drop();
    note = null;
    const my = gen;
    el.replaceChildren(
      h('h3', { class: 'text-cyan text-[10px]', text: 'INVITE A FRIEND' }),
      h('p', { class: 'text-cyan animate-pulse', text: 'preparing invite…' }),
    );
    app.lan.createInvite().then(
      (inv) => {
        if (my !== gen || !el.isConnected) {
          inv.cancel();
          return;
        }
        invite = inv;
        showInvite(inv, my);
      },
      (e: unknown) => {
        if (my !== gen) return;
        showError(errorMessage(e), null);
      },
    );
  }

  const showInvite = (inv: LanInvite, my: number) => {
    const err = errorLine();
    const reply = codeArea({ label: 'Reply code', placeholder: `Paste the reply code (starts with ${REPLY_PREFIX})` });
    const status = h('p', { class: 'text-cyan animate-pulse', text: 'connecting…' });
    status.hidden = true;

    const connect = (text: string) => {
      const code = text.trim();
      if (!code) {
        err.set('Paste the reply code from your friend first.');
        return;
      }
      if (connecting) return;
      connecting = true;
      err.set(null);
      status.hidden = false;
      connectBtn.disabled = true;
      scanner.setDisabled(true);
      reply.readOnly = true;
      inv.complete(code).then(
        () => {
          if (my !== gen) return;
          connecting = false;
          invite = null;
          gen++;
          note = 'Connected! Invite another friend, or start the reef.';
          showIdle();
          onDone();
        },
        (e: unknown) => {
          if (my !== gen) return;
          connecting = false;
          status.hidden = true;
          connectBtn.disabled = false;
          scanner.setDisabled(false);
          reply.readOnly = false;
          err.set(errorMessage(e));
          tryAgain.hidden = false;
        },
      );
    };

    const connectBtn = lanButton('CONNECT', () => connect(reply.value), { primary: true });
    const scanner = qrScanner('SCAN REPLY', REPLY_PREFIX, (code) => {
      reply.value = code;
      connect(code);
    });
    const tryAgain = lanButton('TRY AGAIN', () => {
      drop();
      create();
    }, { small: true });
    tryAgain.hidden = true;
    const cancel = lanButton('CANCEL', () => {
      drop();
      showIdle();
    }, { small: true });

    el.replaceChildren(
      stepTitle(1, 'SHOW YOUR FRIEND THIS INVITE'),
      h('p', { class: 'muted text-[8px]', text: 'They choose JOIN A REEF, then scan the QR or paste the code.' }),
      codeShare(inv.code, 'Invite code'),
      h('div', { class: 'mt-2' }, stepTitle(2, 'PASTE OR SCAN THEIR REPLY')),
      reply,
      h('div', { class: 'flex flex-wrap gap-2' }, connectBtn, cancel),
      scanner.el,
      status,
      err.el,
      tryAgain,
    );
  };

  showIdle();
  return {
    el,
    refresh() {
      // Only the idle view depends on the roster (full or not).
      if (!invite && !connecting && full !== isFull()) showIdle();
    },
  };
}

export const lanHostScreen: ScreenView = (app) => {
  const host = app.lan.host;
  if (!host) {
    return panel(
      'YOUR REEF',
      h('p', { class: 'muted mb-4', text: 'This reef has closed.' }),
      lanButton('TITLE', () => app.lan.exit(), { primary: true }),
    );
  }

  const rosterBox = h('div');
  const renderRoster = () => rosterBox.replaceChildren(rosterView(app));
  const invites = invitePanel(app, renderRoster);

  const startLabel = host.started ? 'BACK TO THE REEF' : 'START REEF';
  const actions = h(
    'div',
    { class: 'mt-4 flex flex-wrap items-center justify-between gap-3' },
    host.started
      ? lanButton('END GAME', () => app.lan.finish(), { small: true })
      : lanButton('LEAVE', () => app.lan.exit(), { small: true }),
    lanButton(startLabel, () => app.lan.start(), { primary: true }),
  );

  const el = panel(
    'YOUR REEF',
    h(
      'div',
      { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
      rosterBox,
      h('div', { class: 'card' }, invites.el),
    ),
    host.started ? null : h('p', { class: 'muted text-[8px] mt-3', text: 'Start whenever you like, even alone. Friends can still join after the start.' }),
    actions,
  );

  renderRoster();
  onLanChange(app, el, () => {
    renderRoster();
    invites.refresh();
  });
  return el;
};
