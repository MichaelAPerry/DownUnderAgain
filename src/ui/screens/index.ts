import type { Screen } from '../../app/screens';
import { briefingScreen } from './briefing';
import { codexScreen } from './codex';
import { helpScreen } from './help';
import { lanHostScreen } from './lanHost';
import { lanJoinScreen } from './lanJoin';
import { lanMenuScreen } from './lanMenu';
import { lanRespawnScreen } from './lanRespawn';
import { lanResultsScreen } from './lanResults';
import { modeSelectScreen } from './modeSelect';
import { pausedScreen } from './paused';
import { resultsScreen } from './results';
import { sandboxScreen } from './sandbox';
import { shopScreen } from './shop';
import { speciesSelectScreen } from './speciesSelect';
import { stageEndScreen } from './stageEnd';
import { titleScreen } from './title';
import type { ScreenView } from './types';

/** DOM view per screen; 'playing' has none (the HUD is drawn on the canvas). */
export const SCREENS: Partial<Record<Screen, ScreenView>> = {
  title: titleScreen,
  modeSelect: modeSelectScreen,
  speciesSelect: speciesSelectScreen,
  sandbox: sandboxScreen,
  briefing: briefingScreen,
  paused: pausedScreen,
  shop: shopScreen,
  stageEnd: stageEndScreen,
  results: resultsScreen,
  codex: codexScreen,
  help: helpScreen,
  lanMenu: lanMenuScreen,
  lanHost: lanHostScreen,
  lanJoin: lanJoinScreen,
  lanRespawn: lanRespawnScreen,
  lanResults: lanResultsScreen,
};
