/**
 * E2E: InfraBit logo, tab-separated phrase copy and multi-wallet management.
 *
 * Runs against the production build with no Telegram client (no device secret). The same-origin
 * TON proxy is mocked so no network leaves the test.
 */
import { test, expect, type Page } from '@playwright/test';

const PASS = '258036';

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
    if (path === '/api/ton/config') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          network: 'testnet',
          swapEnabled: false,
          stakingEnabled: false,
          swapFeeBps: 0,
          referralConfigured: false,
        }),
      });
      return;
    }
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

async function createWallet(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeVisible();
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  const words = page.locator('[data-role="word"]');
  await expect(words).toHaveCount(24);
  const list = await words.allTextContents();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
  for (let i = 0; i < 3; i += 1) {
    const input = page.locator('input[id^="word-"]').nth(i);
    const id = await input.getAttribute('id');
    const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
    await input.fill(list[position] ?? '');
  }
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm PIN').fill(PASS);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('hero-balance')).toBeVisible();
  return list;
}

test.describe('brand, phrase copy and multi-wallet', () => {
  test('shows the InfraBit logo and favicon instead of the monogram', async ({ page }) => {
    await mockTonApi(page);
    await page.goto('/');
    const logo = page.getByTestId('infrabit-logo');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('src', /infrabit-logo/);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png');
    await createWallet(page);
    await expect(page.getByTestId('wallet-switcher')).toContainText('Wallet 1');
  });

  test('copies the recovery phrase and shows the one-minute reminder', async ({ page }) => {
    await mockTonApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.locator('[data-role="word"]')).toHaveCount(24);

    await page.getByRole('button', { name: 'Copy phrase' }).click();
    await expect(page.getByText('Copied', { exact: true })).toBeVisible();
    await expect(page.getByText(/cleared after 60 seconds/)).toBeVisible();
  });

  test('adds, switches and removes a wallet without touching the first', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);

    await page.getByTestId('wallet-switcher').click();
    await expect(page.getByRole('heading', { name: 'My Wallets' })).toBeVisible();
    await page.getByRole('button', { name: 'Create new wallet' }).click();

    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    const newWords = page.locator('[data-role="word"]');
    await expect(newWords).toHaveCount(24);
    const words = await newWords.allTextContents();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      const input = page.locator('input[id^="word-"]').nth(i);
      const id = await input.getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await input.fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByRole('heading', { name: 'Confirm your PIN' })).toBeVisible();
    await page.getByLabel('Current PIN').fill(PASS);
    await page.getByRole('button', { name: 'Add wallet' }).click();

    await expect(page.getByRole('heading', { name: 'My Wallets' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Wallet 2 · Active/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('wallet-switcher')).toContainText('Wallet 2');

    // Switch back to the first wallet.
    await page.getByTestId('wallet-switcher').click();
    await page.getByRole('button', { name: /Wallet 1 · Use this wallet/ }).click();
    await expect(page.getByRole('button', { name: /Wallet 1 · Active/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('wallet-switcher')).toContainText('Wallet 1');

    // Remove the second wallet with its recovery phrase.
    await page.getByTestId('wallet-switcher').click();
    await page.getByRole('button', { name: 'Remove' }).nth(1).click();
    await expect(page.getByRole('heading', { name: 'Remove wallet' })).toBeVisible();
    await page.getByLabel('Recovery phrase').fill(words.join(' '));
    await page.getByRole('button', { name: 'Remove wallet' }).click();

    await expect(page.getByRole('heading', { name: 'My Wallets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Wallet 1 · Active/ })).toBeVisible();
  });
});
