/**
 * Design-system E2E: self-hosted fonts, dual themes, privacy masking, the 4-tab floating nav,
 * and the labelled coming-soon shells.
 */
import { test, expect, type Page } from '@playwright/test';

const PASS = '2580';

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
  await page.getByLabel('PIN', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm PIN').fill(PASS);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('hero-balance')).toHaveText('$2.25');
}

test.describe('design system', () => {
  test('loads self-hosted fonts with zero external network requests', async ({ page }) => {
    const origins = new Set<string>();
    const fontResponses: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http')) return;
      origins.add(new URL(url).origin);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('.woff2') || url.endsWith('.woff')) fontResponses.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const origin = new URL(page.url()).origin;
    expect([...origins]).toEqual([origin]);
    expect(fontResponses.length).toBeGreaterThan(0);
    for (const url of fontResponses) {
      expect(new URL(url).origin).toBe(origin);
    }
    expect([...origins].some((o) => /fonts\.(googleapis|gstatic)\.com/.test(o))).toBe(false);
  });

  test('theme switcher flips data-theme and persists it locally', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const stored = await page.evaluate(() => localStorage.getItem('ozw.theme'));
    expect(stored).toBe('dark');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('privacy toggle masks balances across screens', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);
    await page.getByRole('button', { name: 'Hide balance' }).click();
    await expect(page.getByTestId('hero-balance')).toHaveText('••••');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByText(/••••/).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Wallet' }).click();
    await page.getByRole('button', { name: 'Show balance' }).click();
    await expect(page.getByTestId('hero-balance')).toHaveText('$2.25');
  });

  test('floating navigation exposes all four tabs', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);
    for (const name of ['Wallet', 'Market', 'Assistant', 'Settings']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
    await page.getByRole('tab', { name: 'Wallet' }).click();
    await expect(page.getByRole('tab', { name: 'Wallet' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('Trade and Earn are labelled UI shells with disabled CTAs', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);
    await page.getByRole('button', { name: 'Trade' }).click();
    await expect(page.getByRole('heading', { name: 'Trade' })).toBeVisible();
    await expect(page.getByText('Coming in P3').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Coming in P3' })).toBeDisabled();
    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByRole('button', { name: 'Earn' }).click();
    await expect(page.getByRole('heading', { name: 'Add Stake' })).toBeVisible();
    await expect(page.getByText('13.62% APY')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Coming in P3' })).toBeDisabled();
  });

  test('Market and Assistant are clearly tagged preview shells', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);
    await page.getByRole('tab', { name: 'Market' }).click();
    await expect(page.getByRole('heading', { name: 'Market' })).toBeVisible();
    await expect(page.getByText(/Live market data coming soon/)).toBeVisible();

    await page.getByRole('tab', { name: 'Assistant' }).click();
    await expect(page.getByRole('heading', { name: 'Assistant' })).toBeVisible();
    await expect(page.getByText('Coming soon').first()).toBeVisible();
    await expect(page.getByLabel('Message the assistant')).toBeDisabled();
  });

  test('Coin Detail and Transaction Detail render live data', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);
    await page.getByTestId('asset-TON').click();
    await expect(page.getByRole('heading', { name: 'Toncoin' })).toBeVisible();
    await expect(page.getByTestId('coin-balance')).toHaveText('1.5 TON');
    await expect(page.getByText(/Preview — static data/)).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByRole('button', { name: 'Deposit' }).click();
    await expect(page.getByRole('heading', { name: 'Fund' })).toBeVisible();
    await expect(page.getByTestId('address-TON')).toHaveText(/^0Q/);
    await page.getByRole('button', { name: /Buy with Card/ }).click();
    await expect(page.getByRole('status')).toContainText('coming soon');
  });
});
