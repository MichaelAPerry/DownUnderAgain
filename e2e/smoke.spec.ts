import { expect, test as base } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Every test collects page errors and console errors/warnings and asserts none occurred. */
const test = base.extend<{ problems: string[] }>({
  problems: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`console.${msg.type()}: ${msg.text()}`);
    });
    await page.addInitScript(() => localStorage.clear());
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__game?.screen === 'title');
    await use(problems);
    expect(problems).toEqual([]);
  },
});

const btn = (page: Page, name: string | RegExp, exact = true): Locator =>
  page.getByRole('button', { name, exact: typeof name === 'string' ? exact : undefined });

const waitScreen = (page: Page, screen: string): Promise<unknown> =>
  page.waitForFunction((s) => (window as any).__game?.screen === s, screen);

const screenOf = (page: Page): Promise<string> => page.evaluate(() => (window as any).__game.screen);

async function titleToSpecies(page: Page, mode: RegExp): Promise<void> {
  await btn(page, 'PLAY').click();
  await btn(page, mode).click();
}

async function dive(page: Page): Promise<void> {
  await btn(page, 'DIVE IN!').click();
  await waitScreen(page, 'playing');
}

test('title loads', async ({ page, problems }) => {
  void problems;
  await expect(page.getByRole('heading', { name: 'DOWN UNDER' })).toBeVisible();
  await expect(page.locator('#view')).toBeVisible();
});

test('free swim flow with pause and quit', async ({ page, problems }) => {
  void problems;
  await titleToSpecies(page, /FREE SWIM/);
  await btn(page, /BLUEGILL/).click();
  await expect(page.getByText('BLUEGILL', { exact: true })).toBeVisible();
  await expect(btn(page, 'DIVE IN!')).toBeVisible();
  await btn(page, 'DIVE IN!').click();
  await page.waitForTimeout(800);
  expect(await screenOf(page)).toBe('playing');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Escape');
  await expect(page.getByText('PAUSED', { exact: true })).toBeVisible();
  await btn(page, 'RESUME').click();
  await waitScreen(page, 'playing');
  await page.keyboard.press('Escape');
  await btn(page, 'QUIT TO TITLE').click();
  await expect(page.getByRole('heading', { name: 'DOWN UNDER' })).toBeVisible();
});

test('Enter on a species card opens the briefing and stops there', async ({ page, problems }) => {
  void problems;
  await titleToSpecies(page, /FREE SWIM/);
  await btn(page, /BLUEGILL/).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect(await screenOf(page)).toBe('briefing');
  // Enter away from any button dives in.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await waitScreen(page, 'playing');
});

// Regression: the briefing's document-level Enter shortcut used to fire as well
// as the focused button, so Enter on QUIT would dive in *and* quit, and Enter on
// DIVE IN! dived twice (logging an illegal-transition warning).
test('Enter on a focused briefing button fires only that button', async ({ page, problems }) => {
  void problems;
  await titleToSpecies(page, /FREE SWIM/);
  await btn(page, /BLUEGILL/).click();
  await btn(page, 'QUIT').focus();
  await page.keyboard.press('Enter');
  await waitScreen(page, 'title');
  await page.waitForTimeout(300);
  expect(await screenOf(page)).toBe('title');
  expect(await page.evaluate(() => (window as any).__game.session)).toBeNull();

  await titleToSpecies(page, /FREE SWIM/);
  await btn(page, /BLUEGILL/).click();
  await btn(page, 'DIVE IN!').focus();
  await page.keyboard.press('Enter');
  await waitScreen(page, 'playing');
  await page.waitForTimeout(300);
  // The problems fixture fails the test if the second dive logged a warning.
});

test('tournament retry, next stage and game over', async ({ page, problems }) => {
  void problems;
  await titleToSpecies(page, /TOURNAMENT/);
  await dive(page);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.session.world.kill(g.session.player, 'starved', null);
  });
  await expect(btn(page, 'TRY AGAIN')).toBeVisible({ timeout: 4000 });
  await btn(page, 'TRY AGAIN').click();
  await dive(page);
  await page.evaluate(() => {
    (window as any).__game.session.growth = 10000;
  });
  await expect(btn(page, 'NEXT FISH')).toBeVisible({ timeout: 4000 });
  await btn(page, 'NEXT FISH').click();
  await expect(page.getByText(/STAGE 2\//)).toBeVisible();
  await dive(page);
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.session.lives = 1;
    g.session.world.kill(g.session.player, 'starved', null);
  });
  await expect(page.getByText('GAME OVER', { exact: true })).toBeVisible({ timeout: 4000 });
  await expect(btn(page, 'PLAY AGAIN')).toBeVisible();
});

test('evolution shop purchase', async ({ page, problems }) => {
  void problems;
  await titleToSpecies(page, /EVOLUTION/);
  await btn(page, /SERGEANT MAJOR/).click();
  await dive(page);
  await page.evaluate(() => {
    (window as any).__game.session.biomass = 50;
  });
  await page.keyboard.press('Tab');
  await expect(page.getByText('EVOLVE', { exact: true })).toBeVisible();
  // Two upgrades cost 8 BIO; Power Fins is listed first.
  await btn(page, '8 BIO').first().click();
  await expect(page.getByText('BIOMASS: 42')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await waitScreen(page, 'playing');
});

test('custom fish sandbox', async ({ page, problems }) => {
  void problems;
  await titleToSpecies(page, /FREE SWIM/);
  await btn(page, 'CREATE').click();
  await expect(page.getByText('CUSTOM FISH SANDBOX')).toBeVisible();
  await btn(page, 'SHARK').click();
  await btn(page, 'SAVE & DIVE').click();
  await dive(page);
  expect(await page.evaluate(() => (window as any).__game.session.species.id)).toBe('custom');
});

test('codex and help screens', async ({ page, problems }) => {
  void problems;
  await btn(page, /REEF CODEX/).click();
  await expect(page.getByText(/DISCOVERED/)).toBeVisible();
  await btn(page, '< BACK').click();
  await btn(page, 'HOW TO PLAY').click();
  await expect(page.getByText('CONTROLS', { exact: true })).toBeVisible();
  await btn(page, '< BACK').click();
  await expect(page.getByRole('heading', { name: 'DOWN UNDER' })).toBeVisible();
});
