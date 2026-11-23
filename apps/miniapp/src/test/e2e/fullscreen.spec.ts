/**
 * Fullscreen top-bar control under the production CSP at a narrow viewport.
 *
 * The browser Fullscreen API is stubbed so the wiring is deterministic in Chromium and WebKit.
 * The test also verifies the utility cluster never overflows at 360/375px and that no CSP
 * violation is reported while toggling.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const MINIAPP_ROOT = resolve(SELF_DIR, '..', '..', '..');
const PROJECT_ROOT = resolve(MINIAPP_ROOT, '..', '..');

function productionCsp(): string {
  const cfg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'vercel.json'), 'utf-8')) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const rule = cfg.headers?.find((entry) => entry.source === '/(.*)');
  const csp = rule?.headers.find(
    (entry) => entry.key.toLowerCase() === 'content-security-policy',
  )?.value;
  if (!csp) throw new Error('vercel.json has no Content-Security-Policy header');
  return csp;
}

async function applyProductionCsp(page: Page, csp: string): Promise<string[]> {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP_VIOLATION ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on('console', (message) => {
    if (message.text().startsWith('CSP_VIOLATION')) violations.push(message.text());
  });
  await page.route('**/*', async (route) => {
    let response;
    try {
      response = await route.fetch();
    } catch {
      await route.abort().catch(() => undefined);
      return;
    }
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  return violations;
}

/** Deterministic standard Fullscreen API for both Playwright engines. */
async function stubBrowserFullscreen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let element: Element | null = null;
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => element,
    });
    Element.prototype.requestFullscreen = function requestFullscreen(): Promise<void> {
      element = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    Document.prototype.exitFullscreen = function exitFullscreen(): Promise<void> {
      element = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
  });
}

const PORTFOLIO = {
  address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
  network: 'testnet',
  status: 'active',
  balanceRaw: '1500000000',
  balance: '1.5',
  priceUsd: 1.5,
  change24h: 2,
  totalUsd: 2.25,
  assets: [
    {
      id: 'ton',
      symbol: 'TON',
      name: 'Toncoin',
      decimals: 9,
      standard: 'native',
      balanceRaw: '1500000000',
      balance: '1.5',
      usdValue: 2.25,
    },
  ],
  updatedAt: 0,
  source: 'toncenter',
};

async function mockTonApi(page: Page): Promise<void> {
  await page.route('**/api/ton/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/portfolio')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PORTFOLIO),
      });
      return;
    }
    if (path.endsWith('/activity')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
}

async function createWallet(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  await page.getByLabel("I've stored the seed phrase in a secure place.").check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('PIN', { exact: true }).fill('2580');
  await page.getByLabel('Confirm PIN').fill('2580');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('hero-balance')).toHaveText('$2.25');
}

test.describe('fullscreen control', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('toggles fullscreen at 360/375px with no overflow and no CSP violations', async ({
    page,
  }) => {
    const csp = productionCsp();
    const violations = await applyProductionCsp(page, csp);
    await stubBrowserFullscreen(page);
    await mockTonApi(page);
    await createWallet(page);

    const enter = page.getByRole('button', { name: 'Enter fullscreen' });
    await expect(enter).toBeVisible();
    await expect(enter).toHaveAttribute('aria-pressed', 'false');

    await enter.click();
    const exit = page.getByRole('button', { name: 'Exit fullscreen' });
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    await exit.click();
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    for (const width of [375, 360]) {
      await page.setViewportSize({ width, height: 812 });
      const layout = await page.evaluate(() => {
        const header = document.querySelector('header');
        return {
          inner: window.innerWidth,
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          headerHeight: header?.getBoundingClientRect().height ?? 0,
        };
      });
      expect(layout.inner).toBe(width);
      expect(layout.doc).toBeLessThanOrEqual(width);
      expect(layout.body).toBeLessThanOrEqual(width);
      expect(layout.headerHeight).toBeLessThanOrEqual(64);
    }

    expect(violations).toEqual([]);
  });
});
