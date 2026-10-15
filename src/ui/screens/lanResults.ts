/** Final leaderboard for a LAN reef. */
import type { RosterEntry } from '../../net/protocol';
import { h, panel } from '../dom';
import { fishById, fishIcon, lanButton, slotChip, slotColor } from './lanCommon';
import type { ScreenView } from './types';

export const lanResultsScreen: ScreenView = (app) => {
  const lan = app.lan;
  const roster: RosterEntry[] = [...(lan.host?.roster() ?? lan.client?.roster ?? [])].sort(
    (a, b) => b.score - a.score || a.deaths - b.deaths || a.slot - b.slot,
  );
  const mySlot = lan.role === 'host' ? 1 : (lan.client?.slot ?? 0);
  const reason = lan.client?.endReason ?? null;
  const top = roster[0]?.score ?? 0;

  const head = h(
    'tr',
    { class: 'muted text-[8px]' },
    h('th', { class: 'text-left p-1', text: '#' }),
    h('th', { class: 'text-left p-1', text: 'PLAYER' }),
    h('th', { class: 'text-left p-1', text: 'FISH' }),
    h('th', { class: 'text-right p-1', text: 'SCORE' }),
    h('th', { class: 'text-right p-1', text: 'DEATHS' }),
  );
  const rows = roster.map((r, i) => {
    const winner = i === 0 && top > 0;
    const def = fishById(app, r.fish);
    return h(
      'tr',
      { class: `border-b border-charcoal ${winner ? 'bg-charcoal/60' : ''}` },
      h('td', { class: `p-1 ${winner ? 'text-yellow' : 'text-silver'}`, text: String(i + 1) }),
      h(
        'td',
        { class: 'p-1' },
        h(
          'span',
          { class: 'flex items-center gap-2 flex-wrap' },
          slotChip(r.slot),
          h('span', { style: { color: slotColor(r.slot) }, text: r.name }),
          r.slot === mySlot ? h('span', { class: 'chip text-cyan', text: 'YOU' }) : null,
          winner ? h('span', { class: 'chip text-yellow', text: 'WINNER' }) : null,
        ),
      ),
      h(
        'td',
        { class: 'p-1' },
        h(
          'span',
          { class: 'flex items-center gap-1' },
          def ? fishIcon(def, 24) : null,
          h('span', { class: 'hidden sm:inline text-[8px]', text: (def?.name ?? r.fish).toUpperCase() }),
        ),
      ),
      h('td', { class: `p-1 text-right ${winner ? 'text-yellow' : ''}`, text: String(r.score) }),
      h('td', { class: 'p-1 text-right text-silver', text: String(r.deaths) }),
    );
  });

  return panel(
    'REEF RESULTS',
    reason ? h('p', { class: 'text-orange text-center mb-3', text: reason }) : null,
    roster.length
      ? h(
          'div',
          { class: 'max-w-xl mx-auto overflow-x-auto' },
          h('table', { class: 'w-full border-collapse text-[9px]' }, h('thead', {}, head), h('tbody', {}, ...rows)),
        )
      : h('p', { class: 'muted text-center', text: 'No scores were recorded.' }),
    h('div', { class: 'mt-4 flex justify-center' }, lanButton('TITLE', () => lan.exit(), { primary: true })),
  );
};
