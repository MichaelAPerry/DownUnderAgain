import './styles.css';
import { Game } from './app/game';

const canvas = document.getElementById('view');
const ui = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !(ui instanceof HTMLElement)) {
  throw new Error('Down Under Again: missing #view canvas or #ui root');
}
try {
  const game = new Game(canvas, ui);
  // Dev-only handle for debugging and automated play-testing; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
} catch (err) {
  const msg = document.createElement('p');
  msg.className = 'text-cream text-xs p-4';
  msg.textContent = `Sorry, the game could not start: ${err instanceof Error ? err.message : String(err)}`;
  ui.replaceChildren(msg);
}
