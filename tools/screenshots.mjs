/**
 * Captures in-game screenshots of each zone for docs and art review.
 * Usage: start `npm run dev -- --port 5181`, then `npm run screenshots`.
 * Output: docs/screenshots/*.png (1152x648, i.e. the 384x216 view at 3x).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const URL = process.env.SHOT_URL ?? 'http://localhost:5181/';
const OUT = process.env.SHOT_DIR ?? 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

// fish id, mode button, where to put the player (world px), file name
const SHOTS = [
  ['bluegill', 'FREE SWIM', 600, 60, 'spring'],
  ['sheepshead', 'FREE SWIM', 1800, 70, 'estuary'],
  ['red_drum', 'FREE SWIM', 3000, 90, 'seagrass'],
  ['great_barracuda', 'FREE SWIM', 4200, 110, 'reef'],
  ['great_hammerhead', 'FREE SWIM', 5000, 260, 'dropoff'],
  ['swordfish', 'FREE SWIM', 5900, 760, 'deep'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1152, height: 648 } });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
await page.addInitScript(() => localStorage.clear());
await page.goto(URL);
await page.waitForFunction(() => window.__game?.screen === 'title');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/title.png` });
await page.keyboard.press('Enter');
await page.getByRole('button', { name: 'PLAY', exact: true }).waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/title-menu.png` });

for (const [id, mode, x, y, name] of SHOTS) {
  await page.evaluate(() => { if (window.__game.screen !== 'title') window.__game.quit(); });
  await page.waitForFunction(() => window.__game.screen === 'title');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(mode) }).click();
  const def = await page.evaluate((sid) => window.__game.region.species.find((s) => s.id === sid)?.name, id);
  await page.getByRole('button', { name: new RegExp(def.toUpperCase()) }).first().click();
  await page.getByRole('button', { name: 'DIVE IN!' }).click();
  await page.waitForFunction(() => window.__game.screen === 'playing');
  await page.evaluate(([px, py]) => {
    const p = window.__game.session.player;
    p.x = p.px = px; p.y = p.py = py; p.energy = 100;
  }, [x, y]);
  // Let the camera settle and the reef move; keep the player safe while shooting.
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => { const p = window.__game.session.player; p.hp = p.maxHp; p.energy = 100; });
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'QUIT TO TITLE' }).click();
}
await browser.close();
if (problems.length) {
  console.error('Console problems:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Saved ${SHOTS.length + 1} screenshots to ${OUT}/`);
