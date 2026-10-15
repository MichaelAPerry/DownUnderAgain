import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The single-file edition (built by global-setup) must run straight from disk,
// offline, with no requests beyond the file itself.
test('single HTML file plays offline from file://', async ({ page }) => {
  const problems: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file:') && !u.startsWith('data:')) external.push(u);
  });
  const url = pathToFileURL(resolve('dist-single/down-under-again.html')).href;
  await page.goto(url);
  await page.getByRole('button', { name: 'Start the game' }).click();
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: /FREE SWIM/ }).click();
  await page.getByRole('button', { name: /BLUEGILL/ }).click();
  await page.getByRole('button', { name: 'DIVE IN!' }).click();
  await expect.poll(() => page.evaluate(() => document.fonts.check('10px "Press Start 2P"'))).toBe(true);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyD');
  expect(problems).toEqual([]);
  expect(external).toEqual([]);
});
