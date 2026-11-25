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
    {
      id: '-1:27b3b038792c090b59897fbd890c4f5bc8a63d9ffc716f5861968972f617908b',
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
      standard: 'jetton',
      balanceRaw: '2500000',
      balance: '2.5',
      usdValue: null,
    },
    {
      id: '-1:aaaa000000000000000000000000000000000000000000000000000000000001',
      symbol: 'FOO',
      name: 'Foo Token',
      decimals: 9,
      standard: 'jetton',
      balanceRaw: '1000000000',
      balance: '1',
      usdValue: null,
    },
  ],
  updatedAt: 0,
  source: 'toncenter',
};

const SWAP_NATIVE = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SWAP_JETTON = '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SWAP_JETTON_WALLET = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const SWAP_PTON_MASTER = '0:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SWAP_ROUTER = '0:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const SWAP_PTON_WALLET = '0:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const SWAP_QUOTE = {
  network: 'testnet',
  offer: { address: SWAP_NATIVE, units: '1000000000' },
  ask: { address: SWAP_JETTON, units: '2500000', minUnits: '2475000' },
  minReceivedRaw: '2475000',
  slippageBps: 100,
  priceImpact: 0.001,
  swapRate: 2.5,
  providerMinUnits: '2475000',
  feeBps: 35,
  feeUnits: '3500',
  referralAddress: null,
  router: {
    address: SWAP_ROUTER,
    majorVersion: 2,
    minorVersion: 1,
    routerType: 'ConstantProduct',
    ptonMasterAddress: SWAP_PTON_MASTER,
    ptonWalletAddress: SWAP_PTON_WALLET,
    ptonVersion: '2.1',
    poolAddress: '0:9999999999999999999999999999999999999999999999999999999999999999',
  },
  direction: 'ton->jetton',
  offerJettonWalletAddress: null,
  askJettonWalletAddress: SWAP_JETTON_WALLET,
  gas: { gasBudget: '1310000000', forwardGas: '100000000', estimatedGasConsumption: '120000000' },
  quotedAt: 0,
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
    if (path.endsWith('/swap/assets')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          network: 'testnet',
          assets: [
            {
              id: 'native',
              symbol: 'TON',
              name: 'Gram',
              decimals: 9,
              kind: 'native',
              contractAddress: SWAP_NATIVE,
              imageUrl: null,
              verified: true,
            },
            {
              id: SWAP_JETTON,
              symbol: 'USDT',
              name: 'Tether USD',
              decimals: 6,
              kind: 'jetton',
              contractAddress: SWAP_JETTON,
              imageUrl: null,
              verified: true,
            },
          ],
        }),
      });
      return;
    }
    if (path.endsWith('/swap/quote')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SWAP_QUOTE),
      });
      return;
    }
    if (path.endsWith('/wallet-state')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          address: PORTFOLIO.address,
          network: 'testnet',
          status: 'active',
          seqno: 5,
          balanceRaw: PORTFOLIO.balanceRaw,
          source: 'toncenter',
        }),
      });
      return;
    }
    if (path.endsWith('/emulate')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          estimatedFeeRaw: '31000000',
          balanceChanges: [],
          warnings: [],
          willBounce: false,
        }),
      });
      return;
    }
    if (path.endsWith('/broadcast')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' } }),
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
    for (const url of fontResponses) {
      expect(new URL(url).origin).toBe(origin);
    }
    // Chromium shares its HTTP cache across contexts, so a preceding test may already have
    // fetched the woff2 files (zero responses here). Assert the intent instead: the faces are
    // actually loaded and every @font-face URL in the app stylesheet is same-origin.
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const link = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]');
      const css = link ? await fetch(link.href).then((response) => response.text()) : '';
      return {
        loaded: document.fonts.check('16px "Plus Jakarta Sans"'),
        sources: [...css.matchAll(/url\((["']?)([^"')]+\.woff2)\1\)/g)].map(
          (match) => match[2] ?? '',
        ),
      };
    });
    expect(fonts.loaded).toBe(true);
    expect(fonts.sources.length).toBeGreaterThan(0);
    for (const source of fonts.sources) {
      expect(new URL(source, origin).origin).toBe(origin);
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

  test('Trade runs a mocked live swap in both themes; Earn is a labelled shell', async ({
    page,
  }) => {
    const cspViolations: string[] = [];
    page.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
    });
    await mockTonApi(page);
    await createWallet(page);

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Trade' }).click();
    await expect(page.getByRole('heading', { name: 'Trade' })).toBeVisible();
    await page.getByLabel('You sell amount').fill('1');
    await expect(page.getByText('Minimum received').first()).toBeVisible();
    await expect(page.getByText('0.35%').first()).toBeVisible();
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await expect(page.getByRole('heading', { name: 'Review swap' })).toBeVisible();
    await expect(page.getByText(/~0.031 TON/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm & Swap' }).click();
    await expect(page.getByRole('heading', { name: 'Swap submitted' })).toBeVisible();
    expect(cspViolations).toEqual([]);
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

  test('coin icons are inline SVGs and unknown jettons use a monogram', async ({ page }) => {
    const imageRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'image') imageRequests.push(request.url());
    });
    await mockTonApi(page);
    await createWallet(page);

    await expect(page.locator('[data-testid="asset-TON"] svg')).toHaveCount(1);
    await expect(page.locator('[data-testid="asset-USDT"] svg')).toHaveCount(1);
    await expect(page.locator('[data-testid="asset-FOO-2"]')).toContainText('FO');
    await expect(page.locator('[data-testid="asset-FOO-2"] svg')).toHaveCount(0);
    const origin = new URL(page.url()).origin;
    expect(
      imageRequests.filter((url) => {
        if (url.startsWith('data:')) return false;
        return new URL(url).origin !== origin;
      }),
    ).toEqual([]);

    await page.getByTestId('asset-TON').click();
    await expect(page.getByRole('heading', { name: 'Toncoin' })).toBeVisible();
    await expect(page.getByTestId('coin-balance')).toHaveText('1.5 TON');
    expect(await page.locator('img').count()).toBe(0);
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
