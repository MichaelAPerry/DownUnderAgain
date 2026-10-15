import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Two separate browser contexts pair over real WebRTC (no server) and play in
// the same reef. Chrome normally masks LAN IPs behind mDNS names; the test
// container has no mDNS responder, so expose raw local IPs for this run.
test.use({ launchOptions: { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] } });
test.setTimeout(90_000);

async function openPlayer(browser: Browser, name: string): Promise<{ page: Page; problems: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1152, height: 648 } });
  const page = await ctx.newPage();
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${name} console.${m.type()}: ${m.text()}`);
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__game?.screen === 'title');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'PLAY', exact: true }).click();
  await page.getByRole('button', { name: /LAN REEF/ }).click();
  const nameBox = page.getByRole('textbox', { name: 'Your name' });
  await nameBox.fill(name);
  await nameBox.blur();
  return { page, problems };
}

const screenOf = (p: Page) => p.evaluate(() => (window as any).__game.screen as string);

test('host and guest pair with invite/reply codes and share one reef', async ({ browser }) => {
  const host = await openPlayer(browser, 'HOST');
  const guest = await openPlayer(browser, 'ALEX');

  // Host opens a reef as a bull shark and creates an invite.
  await host.page.getByRole('button', { name: /HOST A REEF/ }).click();
  await host.page.getByRole('button', { name: /BULL SHARK/ }).first().click();
  await expect.poll(() => screenOf(host.page)).toBe('lanHost');
  await host.page.getByRole('button', { name: 'INVITE A FRIEND' }).click();
  const inviteOut = host.page.getByRole('textbox', { name: 'Invite code' });
  await expect(inviteOut).toHaveValue(/^DUA1I\./, { timeout: 15_000 });
  const invite = await inviteOut.inputValue();

  // Guest picks a mullet, pastes the invite and gets a reply code.
  await guest.page.getByRole('button', { name: /JOIN A REEF/ }).click();
  await guest.page.getByRole('button', { name: /STRIPED MULLET/ }).first().click();
  await guest.page.getByRole('textbox', { name: 'Invite code' }).fill(invite);
  await guest.page.getByRole('button', { name: 'JOIN', exact: true }).click();
  const replyOut = guest.page.getByRole('textbox', { name: 'Reply code' });
  await expect(replyOut).toHaveValue(/^DUA1R\./, { timeout: 15_000 });
  const reply = await replyOut.inputValue();

  // Host enters the reply; the guest appears in the lobby.
  await host.page.getByRole('textbox', { name: 'Reply code' }).fill(reply);
  await host.page.getByRole('button', { name: 'CONNECT', exact: true }).click();
  await expect.poll(() => host.page.evaluate(() => (window as any).__game.lan.host.roster().map((r: any) => r.name)), { timeout: 30_000 })
    .toEqual(['HOST', 'ALEX']);
  await expect.poll(() => guest.page.evaluate(() => (window as any).__game.lan.client?.state)).toBe('lobby');

  // Start: both are swimming in the same reef.
  await host.page.getByRole('button', { name: /START REEF/ }).click();
  await expect.poll(() => screenOf(host.page)).toBe('playing');
  await expect.poll(() => screenOf(guest.page), { timeout: 10_000 }).toBe('playing');

  // The guest's keyboard moves the guest's fish in the HOST's simulation.
  const alexX = () => host.page.evaluate(() => (window as any).__game.lan.host.players.find((p: any) => p.name === 'ALEX').entity.x as number);
  const x0 = await alexX();
  await guest.page.keyboard.down('KeyA');
  await guest.page.waitForTimeout(1200);
  await guest.page.keyboard.up('KeyA');
  expect(await alexX()).toBeLessThan(x0 - 15);

  // The guest's mirror tracks its own fish and receives the shared roster.
  const g = await guest.page.evaluate(() => {
    const c = (window as any).__game.lan.client;
    return { you: c.you?.def.id, roster: c.roster.map((r: any) => r.name), mirrored: c.world.entities.length };
  });
  expect(g.you).toBe('striped_mullet');
  expect(g.roster).toEqual(['HOST', 'ALEX']);
  expect(g.mirrored).toBeGreaterThan(3);

  // Host ends the game: both see the results.
  await host.page.keyboard.press('Escape');
  await host.page.getByRole('button', { name: 'END GAME FOR EVERYONE' }).click();
  await expect.poll(() => screenOf(host.page)).toBe('lanResults');
  await expect.poll(() => screenOf(guest.page), { timeout: 10_000 }).toBe('lanResults');
  await expect(guest.page.getByText('REEF RESULTS')).toBeVisible();

  expect([...host.problems, ...guest.problems]).toEqual([]);
});
