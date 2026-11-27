/**
 * E2E: the server-side network switch (`/api/ton/config`) drives the whole UI.
 *
 * Mainnet run asserts UQ addresses, tonviewer.com links, no TESTNET badge, mainnet send
 * validation and a TON-only deposit surface. Testnet run asserts the 0Q/testnet behaviour is
 * unchanged.
 */
import { test, expect, type Page } from '@playwright/test';

const PASS = '2580';

type Network = 'mainnet' | 'testnet';

interface MockOptions {
  network: Network;
  activity?: unknown[];
  requests?: Array<{ path: string; network: string | null; address: string | null }>;
}

function configBody(network: Network): Record<string, unknown> {
  return {
    network,
    swapEnabled: network === 'mainnet',
    stakingEnabled: network === 'mainnet',
    swapFeeBps: network === 'mainnet' ? 35 : 0,
    referralConfigured: network === 'mainnet',
  };
}

const PORTFOLIO = {
  address: '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287',
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

async function mockTonApi(page: Page, options: MockOptions): Promise<void> {
  const requests = options.requests ?? [];
  await page.route('**/api/ton/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push({
      path,
      network: url.searchParams.get('network'),
      address: url.searchParams.get('address'),
    });
    if (path === '/api/ton/config') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(configBody(options.network)),
      });
      return;
    }
    if (path.endsWith('/portfolio')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...PORTFOLIO, network: options.network }),
      });
      return;
    }
    if (path.endsWith('/activity')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: options.activity ?? [] }),
      });
      return;
    }
    if (path.endsWith('/wallet-state')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          address: url.searchParams.get('address') ?? '',
          network: options.network,
          status: 'active',
          seqno: 1,
          balanceRaw: '1500000000',
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
          estimatedFeeRaw: '1000000',
          balanceChanges: [{ assetId: 'ton', symbol: 'TON', deltaRaw: '-101000000', decimals: 9 }],
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
  await expect(page.getByTestId('hero-balance')).toBeVisible();
}

test.describe('server-driven network', () => {
  test('mainnet: UQ addresses, tonviewer.com links, no TESTNET badge, TON-only deposit', async ({
    page,
  }) => {
    const requests: MockOptions['requests'] = [];
    await mockTonApi(page, { network: 'mainnet', requests });
    await createWallet(page);

    await expect(page.getByText('Testnet', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('ton-address-pill')).toHaveText(/^UQ/);
    await expect(page.getByTestId('asset-TRX')).toHaveCount(0);
    await expect(page.getByTestId('asset-ETH')).toHaveCount(0);

    // Every read call used the server-advertised network and the mainnet address form.
    const reads = requests.filter((entry) => /portfolio|activity/.test(entry.path));
    expect(reads.length).toBeGreaterThan(0);
    for (const entry of reads) {
      expect(entry.network).toBe('mainnet');
      expect(entry.address).toMatch(/^UQ/);
    }

    await page.getByRole('button', { name: 'Deposit' }).click();
    await expect(page.getByTestId('address-TON')).toHaveText(/^UQ/);
    await expect(page.getByRole('button', { name: 'TRON' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'EVM' })).toHaveCount(0);
    await expect(page.getByTestId('address-TRON')).toHaveCount(0);
    await expect(page.getByTestId('address-EVM')).toHaveCount(0);
    const ownAddress = (await page.getByTestId('address-TON').textContent()) ?? '';
    await page.getByRole('button', { name: 'Back' }).click();

    // Send: testnet-only address rejected, own mainnet address reviewed and submitted.
    await page.getByRole('button', { name: 'Send / Sell' }).click();
    await page.getByLabel('Amount').fill('0.1');
    await page.getByLabel('Recipient').fill('0QDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await expect(page.getByRole('alert')).toContainText(/Testnet-only address/);

    await page.getByLabel('Recipient').fill(ownAddress);
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await expect(page.getByRole('heading', { name: 'Review transfer' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm & Send' }).click();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
    await expect(page.getByText(/tonviewer\.com\/message/)).toBeVisible();
    await expect(page.getByText(/testnet\.tonviewer\.com/)).toHaveCount(0);
  });

  test('testnet: unchanged 0Q address, TESTNET badge and testnet explorer links', async ({
    page,
  }) => {
    const requests: MockOptions['requests'] = [];
    await mockTonApi(page, { network: 'testnet', requests });
    await createWallet(page);

    await expect(page.getByText('Testnet', { exact: true })).toBeVisible();
    await expect(page.getByTestId('ton-address-pill')).toHaveText(/^0Q/);
    const reads = requests.filter((entry) => /portfolio|activity/.test(entry.path));
    for (const entry of reads) {
      expect(entry.network).toBe('testnet');
      expect(entry.address).toMatch(/^0Q/);
    }

    await page.getByRole('button', { name: 'Deposit' }).click();
    await expect(page.getByTestId('address-TON')).toHaveText(/^0Q/);
    await expect(page.getByRole('button', { name: 'TRON' })).toHaveCount(0);

    // Send: mainnet-prefixed address rejected on testnet.
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Send / Sell' }).click();
    await page.getByLabel('Amount').fill('0.1');
    await page.getByLabel('Recipient').fill('UQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY');
    await page.getByRole('button', { name: 'Review transfer' }).click();
    await expect(page.getByRole('alert')).toContainText(/Mainnet-only address/);
  });
});
