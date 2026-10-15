/** Shown over the live reef after your fish dies: pick the next one. */
import type { SpeciesDef } from '../../data/schema';
import { h, panel } from '../dom';
import { fishGrid, fishIcon, lanButton, lanFish } from './lanCommon';
import type { ScreenView } from './types';

export const lanRespawnScreen: ScreenView = (app) => {
  const lan = app.lan;
  const isHost = lan.role === 'host';
  const cause = (isHost ? lan.host?.localDeath : lan.client?.deathCause) ?? null;
  const eaten = !!cause && /^eaten/i.test(cause);
  const prev: SpeciesDef | undefined = isHost ? lan.host?.local.fish : lan.client?.fish;
  const fishes = lanFish(app);
  let chosen: SpeciesDef | null = fishes.find((f) => f.id === prev?.id) ?? prev ?? null;
  let done = false;

  const status = h('p', { class: 'text-cyan text-[9px] animate-pulse', text: 'respawning…' });
  status.hidden = true;

  const respawn = (def: SpeciesDef) => {
    if (done) return;
    done = true;
    grid.setDisabled(true);
    same.disabled = true;
    status.hidden = false;
    lan.respawn(def);
  };

  const grid = fishGrid(fishes, chosen?.id ?? null, (def) => {
    chosen = def;
    respawn(def);
  });
  const same = lanButton(chosen ? `SAME AGAIN: ${chosen.name.toUpperCase()}` : 'SAME AGAIN', () => {
    if (chosen) respawn(chosen);
  }, { primary: true, disabled: !chosen });

  const leave = lanButton(isHost ? 'END GAME FOR EVERYONE' : 'LEAVE', () => lan.finish(), { small: true });

  return panel(
    eaten ? 'YOU WERE EATEN!' : 'YOU DIED',
    h(
      'div',
      { class: 'flex flex-col items-center gap-1 mb-3 text-center' },
      prev ? fishIcon(prev, 48) : null,
      h('p', { class: 'text-orange', text: cause ?? 'Your fish is gone.' }),
    ),
    h(
      'div',
      { class: 'flex flex-wrap items-center justify-between gap-2 mb-2' },
      h('h3', { class: 'text-cyan text-[10px]', text: 'CHOOSE YOUR NEXT FISH' }),
      same,
    ),
    grid.el,
    status,
    h('p', { class: 'muted text-[8px] mt-2', text: 'The reef keeps going while you choose.' }),
    h('div', { class: 'mt-3 flex justify-start' }, leave),
  );
};
