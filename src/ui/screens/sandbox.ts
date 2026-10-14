/** Custom Fish Sandbox: point-buy creature designer with a live sprite preview. */
import { PALETTE } from '../../data/palette';
import type { PaletteKey } from '../../data/palette';
import {
  COLOR_CHOICES, CUSTOM_PATTERNS, CUSTOM_SHAPES, DIETS, SANDBOX_POINTS, SANDBOX_STATS, STAT_LABELS, STAT_MAX,
  buildCustomDef, defaultSpec, pointsSpent, sanitizeName, statCost,
} from '../../data/sandbox';
import type { CustomFishSpec, SandboxStat } from '../../data/sandbox';
import { ZONE_IDS } from '../../data/schema';
import type { ZoneId } from '../../data/schema';
import { generateFishSprite } from '../../render/fishSprite';
import { bake } from '../../render/spriteCache';
import { button, h, panel, spriteImg } from '../dom';
import type { ScreenView } from './types';

function cycle<T>(list: readonly T[], cur: T, dir: number): T {
  const i = list.indexOf(cur);
  return list[(i + dir + list.length) % list.length] as T;
}

export const sandboxScreen: ScreenView = (app) => {
  const spec: CustomFishSpec = structuredClone(app.save.custom ?? defaultSpec());
  const root = h('div');

  const optionRow = <T extends string>(label: string, options: readonly T[], current: T, set: (v: T) => void, names?: (v: T) => string) =>
    h(
      'div',
      { class: 'flex flex-col gap-1' },
      h('span', { class: 'muted', text: label }),
      h(
        'div',
        { class: 'flex flex-wrap gap-1' },
        ...options.map((o) => {
          const b = button((names ? names(o) : o).toUpperCase(), () => {
            set(o);
            app.sfx('select');
            render();
          }, { small: true, primary: o === current });
          b.setAttribute('aria-pressed', String(o === current));
          return b;
        }),
      ),
    );

  const render = () => {
    const spent = pointsSpent(spec);
    const left = SANDBOX_POINTS - spent;
    let def;
    try {
      def = buildCustomDef(spec);
    } catch {
      def = null;
    }
    const frame = def?.look ? bake(generateFishSprite(def.look, def.length, def.height)).frames[0] : undefined;

    const nameInput = h('input', {
      class: 'font-pixel text-[10px] bg-ink text-yellow border-2 border-charcoal px-2 py-1 w-full',
      attrs: { type: 'text', maxlength: '14', 'aria-label': 'Fish name', value: spec.name },
    });
    nameInput.addEventListener('change', () => {
      spec.name = sanitizeName(nameInput.value);
      render();
    });

    const statRows = SANDBOX_STATS.map((s: SandboxStat) => {
      const lv = spec.stats[s];
      const min = s === 'size' ? 1 : 0;
      const nextCost = statCost(s, lv + 1) - statCost(s, lv);
      const pips = h('span', { class: 'tracking-tighter text-yellow', text: '■'.repeat(lv) + '□'.repeat(STAT_MAX - lv) });
      return h(
        'div',
        { class: 'flex items-center gap-2' },
        h('span', { class: 'w-24', text: STAT_LABELS[s].toUpperCase() }),
        button('-', () => {
          spec.stats[s] = lv - 1;
          render();
        }, { small: true, disabled: lv <= min }),
        pips,
        button('+', () => {
          spec.stats[s] = lv + 1;
          render();
        }, { small: true, disabled: lv >= STAT_MAX || nextCost > left }),
        s === 'size' ? h('span', { class: 'muted text-[8px]', text: '2 PTS' }) : null,
      );
    });

    const colorRow = (slot: keyof CustomFishSpec['colors']) => {
      const swatch = h('span', { class: 'inline-block w-4 h-4 border-2 border-ink', style: { background: PALETTE[spec.colors[slot]] } });
      return h(
        'div',
        { class: 'flex items-center gap-2' },
        h('span', { class: 'w-16', text: slot.toUpperCase() }),
        button('<', () => {
          spec.colors[slot] = cycle<PaletteKey>(COLOR_CHOICES, spec.colors[slot], -1);
          render();
        }, { small: true }),
        swatch,
        button('>', () => {
          spec.colors[slot] = cycle<PaletteKey>(COLOR_CHOICES, spec.colors[slot], 1);
          render();
        }, { small: true }),
      );
    };

    const zoneName = (z: ZoneId) => app.region.zones.find((d) => d.id === z)?.name ?? z;
    const summary = def
      ? [
          `LENGTH ${def.length}PX  SPEED ${def.stats.maxSpeed}`,
          `EATS ${def.diet.join(', ').toUpperCase()}`,
          def.diet.includes('fish') ? `CAN SWALLOW FISH UP TO ${Math.floor(def.length * def.stats.jaw)}PX` : 'NO FISH ON THE MENU',
          `HUNGER RATE ${def.stats.metabolism}%/S`,
        ]
      : ['INVALID DESIGN'];

    root.replaceChildren(
      h(
        'div',
        { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
        h(
          'div',
          { class: 'flex flex-col gap-3' },
          h(
            'div',
            { class: 'card flex items-center justify-center h-28' },
            frame ? spriteImg(frame, Math.max(1, Math.min(6, Math.floor(200 / (def?.length ?? 20))))) : h('span', { text: '?' }),
          ),
          nameInput,
          h('div', { class: left < 0 ? 'text-red' : 'text-lime', text: `POINTS LEFT: ${left}/${SANDBOX_POINTS}` }),
          h('div', { class: 'flex flex-col gap-1' }, ...statRows),
          h('div', { class: 'muted text-[8px] flex flex-col gap-1' }, ...summary.map((t) => h('span', { text: t }))),
        ),
        h(
          'div',
          { class: 'flex flex-col gap-3' },
          optionRow('DIET', DIETS, spec.diet, (v) => (spec.diet = v)),
          optionRow('HOME', ZONE_IDS, spec.home, (v) => (spec.home = v), (z) => zoneName(z)),
          h(
            'div',
            { class: 'flex items-center gap-2' },
            button(spec.euryhaline ? 'FRESH+SALT: ON' : 'FRESH+SALT: OFF', () => {
              spec.euryhaline = !spec.euryhaline;
              render();
            }, { small: true, primary: spec.euryhaline, disabled: !spec.euryhaline && left < 2 }),
            h('span', { class: 'muted text-[8px]', text: '2 PTS: SURVIVE ANY SALINITY' }),
          ),
          optionRow('SHAPE', CUSTOM_SHAPES, spec.shape, (v) => (spec.shape = v)),
          optionRow('PATTERN', CUSTOM_PATTERNS, spec.pattern, (v) => (spec.pattern = v)),
          h('div', { class: 'flex flex-col gap-1' }, colorRow('body'), colorRow('belly'), colorRow('fin'), colorRow('accent')),
        ),
      ),
      h(
        'div',
        { class: 'mt-4 flex gap-2 justify-between' },
        button('< BACK', () => app.go('speciesSelect'), { small: true }),
        button('SAVE & DIVE', () => {
          if (!def || left < 0) return;
          app.saveCustom(spec);
          app.selectSpecies(def);
        }, { primary: true, disabled: !def || left < 0 }),
      ),
    );
  };
  render();
  return panel('CUSTOM FISH SANDBOX', root);
};
