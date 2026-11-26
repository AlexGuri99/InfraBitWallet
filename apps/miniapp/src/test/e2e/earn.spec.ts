/**
 * Earn E2E: mocked same-origin staking info/emulate/broadcast against the production build and
 * the production CSP. Covers the stake flow, instant unstake, the unavailable-network state, both
 * themes, and asserts zero CSP violations.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const PASS = '2580';

const POOL_RAW = '0:a45b17f28409229b78360e3290420f13e4fe20f90d7e2bf8c4ac6703259e22fa';
const TS_TON_MASTER = '0:bdf3fa8098d129b54b4f73b5bac5d1e1fd91eb054169c3916dfc8ccd536d1000';
const TS_TON_WALLET = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

const PORTFOLIO = {
  address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
  network: 'testnet',
  status: 'active',
  balanceRaw: '10000000000',
  balance: '10',
  priceUsd: 1.5,
  change24h: 2,
  totalUsd: 15,
  assets: [
    {
      id: 'ton',
      symbol: 'TON',
      name: 'Toncoin',
      decimals: 9,
      standard: 'native',
      balanceRaw: '10000000000',
      balance: '10',
      usdValue: 15,
    },
    {
      id: TS_TON_MASTER,
      symbol: 'tsTON',
      name: 'Tonstakers TON',
      decimals: 9,
      standard: 'jetton',
      balanceRaw: '5000000000',
      balance: '5',
      usdValue: null,
      jettonWalletAddress: TS_TON_WALLET,
    },
  ],
  updatedAt: 0,
  source: 'toncenter',
};

const STAKING_INFO = {
  network: 'testnet',
  poolAddress: POOL_RAW,
  tsTonMasterAddress: TS_TON_MASTER,
  tsTonSymbol: 'tsTON',
  tsTonDecimals: 9,
  apy: 12.84,
  tvlRaw: '153977655101523586',
  stakers: 147970,
  instantLiquidityRaw: '1006115160479073',
  exchangeRate: 1.2,
  verified: true,
  updatedAt: 0,
};

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockTonApi(
  page: Page,
  options: { staking?: 'ok' | 'unavailable' } = {},
): Promise<void> {
  const staking = options.staking ?? 'ok';
  await page.route('**/api/ton/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/portfolio')) {
      await json(route, PORTFOLIO);
      return;
    }
    if (path.endsWith('/activity')) {
      await json(route, { items: [] });
      return;
    }
    if (path.endsWith('/staking/info')) {
      await json(
        route,
        staking === 'unavailable' ? { error: 'staking_unavailable' } : STAKING_INFO,
        staking === 'unavailable' ? 503 : 200,
      );
      return;
    }
    if (path.endsWith('/wallet-state')) {
      await json(route, {
        address: PORTFOLIO.address,
        network: 'testnet',
        status: 'active',
        seqno: 5,
        balanceRaw: PORTFOLIO.balanceRaw,
        source: 'toncenter',
      });
      return;
    }
    if (path.endsWith('/emulate')) {
      await json(route, {
        ok: true,
        estimatedFeeRaw: '31000000',
        balanceChanges: [],
        warnings: [],
        willBounce: false,
      });
      return;
    }
    if (path.endsWith('/broadcast')) {
      await json(route, { messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' } });
      return;
    }
    await json(route, {}, 404);
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
  await expect(page.getByTestId('hero-balance')).toHaveText('$15.00');
}

function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

test.describe('Earn — live Tonstakers', () => {
  test('stakes through review, emulation and broadcast with no CSP violations', async ({
    page,
  }) => {
    const violations = collectCspViolations(page);
    await mockTonApi(page);
    await createWallet(page);

    await page.getByRole('button', { name: 'Earn' }).click();
    await expect(page.getByRole('heading', { name: 'Add Stake' })).toBeVisible();
    await expect(page.getByTestId('earn-apy')).toHaveText('12.84% APY');
    await expect(page.getByText('5 tsTON')).toBeVisible();
    await expect(page.getByText('1 tsTON ≈ 1.2000 TON').first()).toBeVisible();

    // Below the 1 TON minimum: nothing is built or emulated.
    await page.getByLabel('Stake amount').fill('0.5');
    await page.getByRole('button', { name: 'Review stake' }).click();
    await expect(page.getByRole('alert')).toHaveText('Minimum stake is 1 TON');

    await page.getByLabel('Stake amount').fill('2');
    await page.getByRole('button', { name: 'Review stake' }).click();
    await expect(page.getByRole('heading', { name: 'Review stake' })).toBeVisible();
    await expect(page.getByText('2 TON')).toBeVisible();
    await expect(page.getByText('~0.031 TON')).toBeVisible();
    await expect(page.getByText('Wallet fee')).toBeVisible();
    await expect(page.getByText('0%')).toBeVisible();
    // Decoded recipient is rendered in testnet user-friendly form.
    await expect(page.locator('code').first()).toHaveText(/^kQ[0-9A-Za-z_-]{46}$/);

    await page.getByRole('button', { name: 'Confirm & Stake' }).click();
    await expect(page.getByRole('heading', { name: 'Staking submitted' })).toBeVisible();
    await expect(page.getByText(/testnet\.tonviewer\.com\/message/)).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('unstakes instantly with the selected mode', async ({ page }) => {
    const violations = collectCspViolations(page);
    await mockTonApi(page);
    await createWallet(page);

    await page.getByRole('button', { name: 'Earn' }).click();
    await page.getByRole('button', { name: 'Unstake' }).click();
    await page.getByLabel('Unstake amount').fill('5');
    await page.getByRole('button', { name: 'Instant' }).click();
    await expect(page.getByText(/Fill-or-kill against the pool/)).toBeVisible();
    await page.getByRole('button', { name: 'Review unstake' }).click();

    await expect(page.getByRole('heading', { name: 'Review unstake' })).toBeVisible();
    await expect(page.getByText('5 tsTON')).toBeVisible();
    await expect(page.getByText('Instant')).toBeVisible();
    await expect(page.getByText('≈ 6 TON')).toBeVisible();

    await page.getByRole('button', { name: 'Confirm & Unstake' }).click();
    await expect(page.getByRole('heading', { name: 'Staking submitted' })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('shows the clean unavailable state when the pool has no metrics', async ({ page }) => {
    await mockTonApi(page, { staking: 'unavailable' });
    await createWallet(page);
    await page.getByRole('button', { name: 'Earn' }).click();
    await expect(page.getByRole('heading', { name: 'Add Stake' })).toBeVisible();
    await expect(page.getByText(/Staking is unavailable on this network/)).toBeVisible();
    await expect(page.getByTestId('earn-apy')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review stake' })).toBeDisabled();
  });

  test('renders the overview in both themes', async ({ page }) => {
    await mockTonApi(page);
    await createWallet(page);

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Earn' }).click();
    await expect(page.getByTestId('earn-apy')).toHaveText('12.84% APY');
    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Earn' }).click();
    await expect(page.getByTestId('earn-apy')).toHaveText('12.84% APY');
    await expect(page.getByText('147,970')).toBeVisible();
  });
});
