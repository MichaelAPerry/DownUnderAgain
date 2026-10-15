/** The surface UI screens program against. Implemented by app/game.ts. */
import type { SpeciesDef } from '../data/schema';
import type { Region } from '../data/regions/florida';
import type { CustomFishSpec } from '../data/sandbox';
import type { Sfx } from '../audio/sfx';
import type { GameSession } from '../modes/session';
import type { ModeId, SaveData } from './save';
import type { Screen } from './screens';

export interface AppApi {
  readonly region: Region;
  readonly save: Readonly<SaveData>;
  /** The active run, if any (set from briefing through results). */
  readonly session: GameSession | null;
  /** Mode chosen on the mode-select screen. */
  readonly mode: ModeId;
  readonly screen: Screen;
  /** False until the player has pressed a key / clicked past the title gate (unlocks audio). */
  readonly started: boolean;
  readonly previous: Screen | null;
  go(to: Screen): void;
  /** Pass the title gate: unlock audio, start the music, reveal the menu. */
  start(): void;
  sfx(name: Sfx): void;
  selectMode(mode: ModeId): void;
  selectSpecies(def: SpeciesDef): void;
  /** Briefing -> playing. */
  begin(): void;
  resume(): void;
  /** After a death with lives left: replay the same stage. */
  retry(): void;
  /** After a stage clear: advance to the next fish. */
  next(): void;
  /** End the run and return to the title. */
  quit(): void;
  /** Results -> a fresh run with the same mode (and species, if unstaged). */
  playAgain(): void;
  setMuted(muted: boolean): void;
  setMusic(on: boolean): void;
  setCues(cues: boolean): void;
  saveCustom(spec: CustomFishSpec): void;
  buy(upgradeId: string): boolean;
}
