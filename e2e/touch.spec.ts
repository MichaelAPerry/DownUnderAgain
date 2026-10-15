import { expect, test as base } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SHOTS = '/tmp/claude-0';

/**
 * Real multi-touch through the Chrome DevTools Protocol. touchStart/touchMove
 * list every finger currently down, so this keeps track of them.
 */
class Fingers {
  private readonly down = new Map<number, { x: number; y: number }>();
  constructor(private readonly cdp: CDPSession) {}

  private points(): Array<{ x: number; y: number; id: number }> {
    return [...this.down].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  }

  async start(id: number, x: number, y: number): Promise<void> {
    this.down.set(id, { x, y });
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() });
  }

  async move(id: number, x: number, y: number, steps = 6): Promise<void> {
    const from = this.down.get(id);
    if (!from) throw new Error(`finger ${id} is not down`);
    for (let i = 1; i <= steps; i++) {
      this.down.set(id, { x: from.x + ((x - from.x) * i) / steps, y: from.y + ((y - from.y) * i) / steps });
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
    }
  }

  async end(id: number): Promise<void> {
    const p = this.down.get(id);
    if (!p) throw new Error(`finger ${id} is not down`);
    this.down.delete(id);
    // Chromium's CDP lifts exactly the fingers listed in a touchEnd.
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
  }

  async tap(x: number, y: number): Promise<void> {
    await this.start(99, x, y);
    await this.end(99);
  }
}

const test = base.extend<{ problems: string[]; fingers: Fingers }>({
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
  fingers: async ({ page }, use) => {
    await use(new Fingers(await page.context().newCDPSession(page)));
  },
});

const waitScreen = (page: Page, screen: string): Promise<unknown> =>
  page.waitForFunction((s) => (window as any).__game?.screen === s, screen);

async function tapButton(page: Page, fingers: Fingers, name: string | RegExp): Promise<void> {
  const b = page.getByRole('button', { name, exact: typeof name === 'string' ? true : undefined }).first();
  await expect(b).toBeVisible();
  await b.scrollIntoViewIfNeeded();
  const box = await b.boundingBox();
  if (!box) throw new Error(`no box for ${String(name)}`);
  await fingers.tap(box.x + box.width / 2, box.y + box.height / 2);
}

async function center(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Title gate -> mode -> species -> briefing -> playing, all by tapping. */
async function tapIntoGame(page: Page, fingers: Fingers, mode: RegExp, species: RegExp): Promise<void> {
  const vp = page.viewportSize() ?? { width: 800, height: 400 };
  await fingers.tap(vp.width / 2, vp.height / 2);
  await expect(page.getByRole('button', { name: 'PLAY', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__game.started)).toBe(true);
  await tapButton(page, fingers, 'PLAY');
  await tapButton(page, fingers, mode);
  await tapButton(page, fingers, species);
  await tapButton(page, fingers, 'DIVE IN!');
  await waitScreen(page, 'playing');
}

const player = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const p = (window as any).__game.session.player;
    return { x: p.x, y: p.y };
  });

/** Keep the test fish alive and fed so nothing ends the dive mid-test. */
const immortal = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const g = (window as any).__game;
    const p = g.session.player;
    (window as any).__keepAlive = setInterval(() => {
      p.energy = 100;
      p.hp = p.maxHp;
    }, 50);
  });

test.describe('phone landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  test('tap through menus, steer with the joystick, burst and pause', async ({ page, problems, fingers }) => {
    void problems;
    await tapIntoGame(page, fingers, /FREE SWIM/, /BLUEGILL/);
    await expect(page.locator('.touch-pad')).toBeVisible();
    await expect(page.locator('.touch-burst')).toBeVisible();
    await expect(page.locator('.touch-evolve')).toBeHidden();
    await immortal(page);
    // Taps never turned into mouse-steer.
    expect(await page.evaluate(() => (window as any).__game.input.mouseDown)).toBe(false);

    // Drag right: the fish swims right.
    let start = await player(page);
    await fingers.start(1, 160, 250);
    await fingers.move(1, 240, 250);
    const stick = await page.evaluate(() => ({ ...(window as any).__game.input.stick }));
    expect(stick.active).toBe(true);
    expect(stick.x).toBeGreaterThan(0.9);
    expect(Math.abs(stick.y)).toBeLessThan(0.1);
    await expect(page.locator('.touch-stick.on')).toBeVisible();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/touch-landscape.png` });
    let now = await player(page);
    expect(now.x - start.x).toBeGreaterThan(15);

    // Multi-touch: hold BURST with a second finger while still steering.
    const burst = await center(page, '.touch-burst');
    await fingers.start(2, burst.x, burst.y);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).__game.session.world.input.burst)).toBe(true);
    expect(await page.evaluate(() => (window as any).__game.input.stick.active)).toBe(true);
    await page.screenshot({ path: `${SHOTS}/touch-landscape-burst.png` });
    await fingers.end(2);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).__game.session.world.input.burst)).toBe(false);

    // Swing the same thumb left (the base trails it): the fish turns around.
    await fingers.move(1, 60, 250, 8);
    start = await player(page);
    await page.waitForTimeout(900);
    now = await player(page);
    expect(now.x).toBeLessThan(start.x - 10);

    // Lift: input stops.
    await fingers.end(1);
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      return { stick: g.input.stick.active, x: g.session.world.input.x, y: g.session.world.input.y };
    });
    expect(after).toEqual({ stick: false, x: 0, y: 0 });

    // A small drag inside the dead zone does nothing.
    await fingers.start(1, 160, 250);
    await fingers.move(1, 163, 250, 2);
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => (window as any).__game.session.world.input.x)).toBe(0);
    await fingers.end(1);

    // A touch on the right side away from the buttons doesn't spawn a joystick.
    await fingers.start(3, 600, 120);
    expect(await page.evaluate(() => (window as any).__game.input.stick.active)).toBe(false);
    await fingers.end(3);

    // PAUSE.
    const pause = await center(page, '.touch-pause');
    await fingers.tap(pause.x, pause.y);
    await waitScreen(page, 'paused');
    await expect(page.locator('.touch-pad')).toBeHidden();
    await tapButton(page, fingers, 'RESUME');
    await waitScreen(page, 'playing');
    await expect(page.locator('.touch-pad')).toBeVisible();

    // A physical keyboard switches the touch UI off; the next touch brings it back.
    await page.keyboard.press('KeyC');
    await expect(page.locator('.touch-layer')).toBeHidden();
    await page.keyboard.press('KeyC');
    await fingers.start(1, 160, 250);
    await expect(page.locator('.touch-pad')).toBeVisible();
    await fingers.end(1);
  });

  test('evolve button pulses when an upgrade is affordable and opens the shop', async ({ page, problems, fingers }) => {
    void problems;
    await tapIntoGame(page, fingers, /EVOLUTION/, /SERGEANT MAJOR/);
    await immortal(page);
    const evolve = page.locator('.touch-evolve');
    await expect(evolve).toBeVisible();
    await expect(evolve).not.toHaveClass(/can-evolve/);
    await page.evaluate(() => {
      (window as any).__game.session.biomass = 50;
    });
    await expect(evolve).toHaveClass(/can-evolve/);
    await page.screenshot({ path: `${SHOTS}/touch-evolve.png` });
    const c = await center(page, '.touch-evolve');
    await fingers.tap(c.x, c.y);
    await waitScreen(page, 'shop');
    await expect(page.getByRole('heading', { name: 'EVOLVE' })).toBeVisible();
    await expect(page.locator('.touch-pad')).toBeHidden();
  });

  test('help lists touch controls', async ({ page, problems, fingers }) => {
    void problems;
    await fingers.tap(400, 200);
    await tapButton(page, fingers, 'HOW TO PLAY');
    await expect(page.getByText('TOUCH CONTROLS', { exact: true })).toBeVisible();
  });
});

test.describe('phone portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('rotate hint shows, dismisses, and the joystick still works', async ({ page, problems, fingers }) => {
    void problems;
    const hint = page.locator('.touch-rotate');
    await expect(hint).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/touch-portrait-title.png` });
    await tapIntoGame(page, fingers, /FREE SWIM/, /BLUEGILL/);
    await immortal(page);
    await expect(hint).toBeVisible();
    await expect(page.locator('.touch-burst')).toBeVisible();

    const start = await player(page);
    await fingers.start(1, 120, 640);
    await fingers.move(1, 200, 640);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/touch-portrait.png` });
    const now = await player(page);
    await fingers.end(1);
    expect(now.x).toBeGreaterThan(start.x + 8);

    const box = await hint.boundingBox();
    if (!box) throw new Error('no hint box');
    await fingers.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(hint).toBeHidden();
    expect(await page.evaluate(() => (window as any).__game.screen)).toBe('playing');
  });
});

test.describe('desktop', () => {
  test('touch UI stays hidden with mouse and keyboard', async ({ page, problems }) => {
    void problems;
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'PLAY', exact: true }).click();
    await page.getByRole('button', { name: /FREE SWIM/ }).click();
    await page.getByRole('button', { name: /BLUEGILL/ }).click();
    await page.getByRole('button', { name: 'DIVE IN!', exact: true }).click();
    await waitScreen(page, 'playing');
    await expect(page.locator('.touch-layer')).toBeHidden();
    await expect(page.locator('.touch-pad')).toBeHidden();
    await expect(page.locator('.touch-rotate')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__game.touch.active)).toBe(false);
    // Mouse-steer still works: hold the left button to the right of the fish.
    const box = await page.locator('#view').boundingBox();
    if (!box) throw new Error('no canvas box');
    const start = await player(page);
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => (window as any).__game.input.mouseDown)).toBe(true);
    await page.mouse.up();
    expect((await player(page)).x).toBeGreaterThan(start.x + 10);
  });
});
