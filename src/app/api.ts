/** The surface UI screens program against. Implemented by app/game.ts. */
import type { SpeciesDef } from '../data/schema';
import type { Region } from '../data/regions/florida';
import type { CustomFishSpec } from '../data/sandbox';
import type { Sfx } from '../audio/sfx';
import type { GameSession } from '../modes/session';
import type { LanHost } from '../modes/lanHost';
import type { LanClient } from '../modes/lanClient';
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
  /** LAN multiplayer (serverless WebRTC on the same network). */
  readonly lan: LanApi;
}

export interface LanInvite {
  /** Invite code to show the guest (text + QR). */
  code: string;
  /** Enter the guest's reply code; resolves once the guest is connected. */
  complete(replyCode: string): Promise<void>;
  /** Abandon this invite. */
  cancel(): void;
}

export interface LanJoin {
  /** Reply code to show the host (text + QR). */
  reply: string;
  /** Resolves once connected to the host (then the app moves on by itself). */
  connected: Promise<void>;
  cancel(): void;
}

export interface LanApi {
  readonly role: 'none' | 'host' | 'guest';
  readonly host: LanHost | null;
  readonly client: LanClient | null;
  /** Player name (sanitised, saved). */
  readonly playerName: string;
  setPlayerName(name: string): void;
  /** Become the host of a new reef with this fish; goes to the host lobby. */
  hostReef(fish: SpeciesDef): void;
  /** Host: create a one-guest invite. */
  createInvite(): Promise<LanInvite>;
  /** Guest: accept an invite code with the chosen fish. Throws a readable Error on a bad code. */
  join(inviteCode: string, fish: SpeciesDef): Promise<LanJoin>;
  /** Host: start the match (everyone spawns). */
  start(): void;
  /** Either role: respawn as this fish after dying. */
  respawn(fish: SpeciesDef): void;
  /** Host: end the match for everyone (-> results). Guest: leave (-> results). */
  finish(): void;
  /** Leave LAN entirely and return to the title (from lobby/results). */
  exit(): void;
  /** Subscribe to roster / connection / state changes; returns unsubscribe. */
  onChange(fn: () => void): () => void;
}
