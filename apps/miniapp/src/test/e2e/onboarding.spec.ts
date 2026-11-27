/**
 * E2E for the refactored onboarding flows.
 *
 * Create: phrase (reveal + checkbox) -> 3-word verification -> passcode -> Home.
 * Import: 12/24 numbered grid (smart paste) -> passcode -> Home.
 * Runs against the production build with no Telegram client, so no device secret exists and the
 * passphrase policy requires 12+ characters. Each test gets a fresh browser context (empty IDB).
 */
import { test, expect, type Page } from '@playwright/test';

const PASS = '2580';

function wordLocator(page: Page) {
  return page.locator('[data-role="word"]');
}

async function createToPasscode(page: Page): Promise<string[]> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeVisible();
  await expect(page.getByTestId('phrase-words')).toHaveText('');
  await page.getByRole('button', { name: 'Show recovery phrase' }).click();
  await expect(wordLocator(page)).toHaveCount(24);
  const words = await wordLocator(page).allTextContents();

  const next = page.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  await page.getByLabel("I've stored the seed phrase in a secure place.").check();
  await expect(next).toBeEnabled();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
  return words;
}

async function finishCreate(page: Page): Promise<void> {
  await page.getByLabel('PIN', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm PIN').fill(PASS);
  await expect(page.getByRole('status')).toHaveText(/Requirements met/);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('hero-balance')).toBeVisible();
}

async function pastePhrase(page: Page, phrase: string): Promise<void> {
  await page.getByLabel('Word 1', { exact: true }).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, phrase);
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
  ],
  updatedAt: 0,
  source: 'toncenter',
};

const ACTIVITY_ITEMS = [
  {
    id: 'e2e-tx',
    direction: 'in',
    standard: 'native',
    symbol: 'TON',
    decimals: 9,
    amountRaw: '2000000000',
    amount: '2',
    counterparty: 'UQDevUQqAddWLfo_N8RNnUIOOaou9Pn3pALtHjucDjiSh3EY',
    timestamp: 1_700_000_000,
    feeRaw: '1000000',
    fee: '0.001',
    status: 'ok',
    hash: 'AAAA',
    comment: 'hello [link removed]',
    isScam: false,
  },
];

/** Mock the same-origin read proxy so tests never hit a live provider. */
async function mockTonApi(
  page: Page,
  options: {
    activity?: unknown[];
    failPortfolioOnce?: boolean;
    onRequest?: (url: string) => void;
  } = {},
): Promise<void> {
  let portfolioCalls = 0;
  await page.route('**/api/ton/**', async (route) => {
    const url = route.request().url();
    options.onRequest?.(url);
    const path = new URL(url).pathname;
    if (path.endsWith('/portfolio')) {
      portfolioCalls += 1;
      if (options.failPortfolioOnce === true && portfolioCalls === 1) {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: '{"error":"upstream_unavailable"}',
        });
        return;
      }
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
        body: JSON.stringify({ items: options.activity ?? [] }),
      });
      return;
    }
    if (path.endsWith('/wallet-state')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          address: new URL(url).searchParams.get('address') ?? '',
          network: 'testnet',
          status: 'uninit',
          seqno: 0,
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
        body: JSON.stringify({
          messageHash: { hex: 'ab'.repeat(32), base64: 'qquq' },
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '{}' });
  });
}

test.describe('onboarding and unlock', () => {
  test('create, verify, passcode, lock/unlock, survive reload', async ({ page }) => {
    await mockTonApi(page);
    const words = await createToPasscode(page);
    await finishCreate(page);

    await page.getByRole('button', { name: 'Deposit' }).click();
    await expect(page.getByTestId('address-TON')).toHaveText(/^0Q/);
    await page.getByRole('button', { name: 'EVM' }).click();
    await expect(page.getByTestId('address-EVM')).toHaveText(/^0x/);
    await page.getByRole('button', { name: 'TRON' }).click();
    await expect(page.getByTestId('address-TRON')).toHaveText(/^T/);
    await page.getByRole('button', { name: 'Back' }).click();

    const dump = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      text: document.body.innerText,
    }));
    expect(dump.local).not.toContain(words[0] ?? 'never');
    expect(dump.session).not.toContain(words[0] ?? 'never');
    expect(dump.text).not.toContain(words.join(' '));

    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Lock Wallet' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill('1357');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Wrong passcode|Too many attempts/);

    await page.waitForTimeout(3500);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('hero-balance')).toBeVisible();
  });

  test('queries the exact testnet address displayed in the Receive sheet', async ({ page }) => {
    const queried: string[] = [];
    await mockTonApi(page, {
      onRequest: (url) => {
        const address = new URL(url).searchParams.get('address');
        if (address) queried.push(address);
      },
    });
    await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('button', { name: 'Deposit' }).click();
    const displayed = await page.getByTestId('address-TON').textContent();
    expect(displayed).toMatch(/^0Q/);
    expect(queried.length).toBeGreaterThan(0);
    for (const address of queried) {
      expect(address).toBe(displayed);
      expect(address).not.toMatch(/^0:/);
    }
  });

  test('IndexedDB holds only the sealed envelope after create', async ({ page }) => {
    await mockTonApi(page);
    const words = await createToPasscode(page);
    await finishCreate(page);

    const dump = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('onezerowallet');
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(new Error(String(req.error)));
        };
      });
      const tx = db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const req = store.getAllKeys();
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(new Error(String(req.error)));
        };
      });
      const values = await new Promise<unknown[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(new Error(String(req.error)));
        };
      });
      db.close();
      return { keys: keys.map(String), values: JSON.stringify(values) };
    });

    // One key: the wallet set (labels + one sealed envelope per wallet). No legacy `vault_seal`.
    expect(dump.keys.sort()).toEqual(['vault_wallets']);
    expect(dump.values).not.toContain(words.join(' '));
    expect(dump.values).toContain('passcodeWrappedKey');
    expect(dump.values).toContain('accountType');
  });

  test('import: 12-word grid via smart paste, then passcode', async ({ page }) => {
    await mockTonApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await page.getByRole('button', { name: /Secret Words/ }).click();
    await expect(page.getByLabel(/^Word \d+$/)).toHaveCount(24);
    await page.getByRole('button', { name: '12 words' }).click();
    await expect(page.getByLabel(/^Word \d+$/)).toHaveCount(12);

    await pastePhrase(page, 'test test test test test test test test test test test junk');
    await expect(page.getByLabel('Word 12', { exact: true })).toHaveValue('junk');
    await expect(page.getByLabel('Word 1', { exact: true })).toHaveValue('test');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm PIN').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByTestId('hero-balance')).toBeVisible();
    await page.getByRole('button', { name: 'Deposit' }).click();
    await page.getByRole('button', { name: 'EVM' }).click();
    await expect(page.getByTestId('address-EVM')).toHaveText(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });

  test('home dashboard: hero, tabs, actions and asset list', async ({ page }) => {
    await mockTonApi(page);
    await createToPasscode(page);
    await finishCreate(page);

    await expect(page.getByRole('tab', { name: 'Wallet' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Testnet', { exact: true })).toBeVisible();
    await expect(page.getByTestId('hero-balance')).toHaveText('$2.25');
    await expect(page.getByTestId('asset-TON')).toContainText('Toncoin');
    await expect(page.getByTestId('asset-TON')).toContainText('1.5 TON');
    await expect(page.getByTestId('asset-USDT')).toContainText('TON · Jetton');
    await expect(page.getByTestId('asset-TRX')).toContainText('TRC-20');
    await expect(page.getByTestId('asset-ETH')).toContainText('ERC-20');

    await page.getByRole('button', { name: 'Hide balance' }).click();
    await expect(page.getByTestId('hero-balance')).toHaveText('••••');
    await page.getByRole('button', { name: 'Show balance' }).click();

    await expect(page.getByText(/No transactions yet/)).toBeVisible();

    await page.getByRole('button', { name: 'Send / Sell' }).click();
    await expect(page.getByRole('heading', { name: 'Send TON' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
  });

  test('ton-native import shows only TON assets and address', async ({ page }) => {
    await mockTonApi(page);
    const tonPhrase = [
      'hospital',
      'stove',
      'relief',
      'fringe',
      'tongue',
      'always',
      'charge',
      'angry',
      'urge',
      'sentence',
      'again',
      'match',
      'nerve',
      'inquiry',
      'senior',
      'coconut',
      'label',
      'tumble',
      'carry',
      'category',
      'beauty',
      'bean',
      'road',
      'solution',
    ].join(' ');

    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await page.getByRole('button', { name: /Secret Words/ }).click();
    await pastePhrase(page, tonPhrase);
    await expect(page.getByLabel('Word 24', { exact: true })).toHaveValue('solution');
    await page.getByRole('button', { name: 'Continue' }).click();

    // If the phrase happens to be valid BIP-39 too, choose the TON-only reading.
    if (
      await page
        .getByRole('heading', { name: 'Which wallet is this phrase from?' })
        .isVisible()
        .catch(() => false)
    ) {
      await page.getByRole('button', { name: 'TON-only wallet' }).click();
    }
    await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm PIN').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByTestId('hero-balance')).toBeVisible();
    await expect(page.getByTestId('asset-TON')).toBeVisible();
    await expect(page.getByTestId('asset-USDT')).toBeVisible();
    await expect(page.getByTestId('asset-TRX')).toHaveCount(0);
    await expect(page.getByTestId('asset-ETH')).toHaveCount(0);

    await page.getByRole('button', { name: 'Deposit' }).click();
    await expect(page.getByTestId('address-TON')).toHaveText(/^0Q/);
    await expect(page.getByTestId('address-TRON')).toHaveCount(0);
    await expect(page.getByTestId('address-EVM')).toHaveCount(0);
  });

  test('activity tab lists transfers, labels bounced refunds and opens the detail view', async ({
    page,
  }) => {
    const bounceItem = {
      ...(ACTIVITY_ITEMS[0] ?? {}),
      id: 'e2e-bounce',
      direction: 'out',
      amountRaw: '49933333',
      amount: '0.049933333',
      isBounce: true,
    };
    await mockTonApi(page, { activity: [...ACTIVITY_ITEMS, bounceItem] });
    await createToPasscode(page);
    await finishCreate(page);
    const row = page.getByTestId('activity-e2e-tx');
    await expect(row).toContainText('+2 TON');
    await row.click();
    await expect(page.getByRole('heading', { name: 'Received' })).toBeVisible();
    await expect(page.getByText('hello [link removed]')).toBeVisible();
    await expect(page.locator('a[href*="testnet.tonviewer.com/transaction"]')).toHaveAttribute(
      'href',
      /testnet\.tonviewer\.com/,
    );
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('activity-e2e-bounce')).toContainText('Bounced');
  });

  test('portfolio failure shows Offline with Retry, never a false $0.00', async ({ page }) => {
    await mockTonApi(page, { failPortfolioOnce: true });
    await createToPasscode(page);
    await finishCreate(page);
    await expect(page.getByRole('alert')).toContainText('Offline');
    await expect(page.getByTestId('hero-balance')).toHaveText('—');
    await expect(page.getByText('$0.00')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('hero-balance')).toHaveText('$2.25');
  });

  test('sends TON from the signed payload with an emulated preview', async ({ page }) => {
    await mockTonApi(page);
    await createToPasscode(page);
    await finishCreate(page);

    await page.getByRole('button', { name: 'Deposit' }).click();
    const ownAddress = (await page.getByTestId('address-TON').textContent()) ?? '';
    await page.getByRole('button', { name: 'Back' }).click();

    await page.getByRole('button', { name: 'Send / Sell' }).click();
    await expect(page.getByRole('heading', { name: 'Send TON' })).toBeVisible();
    await page.getByLabel('Recipient').fill(ownAddress);
    await page.getByLabel('Amount').fill('0.1');
    await page.getByRole('button', { name: 'Review transfer' }).click();

    await expect(page.getByText(/First send — deploys Wallet V5R1/)).toBeVisible();
    await expect(page.getByText(/Network fee/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm & Send' }).click();
    await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible();
    await expect(page.getByText(/testnet\.tonviewer\.com\/message/)).toBeVisible();
  });

  test('settings reveal requires re-auth and clears the phrase on leaving', async ({ page }) => {
    await mockTonApi(page);
    const words = await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('tab', { name: 'Settings' }).click();

    await page.getByRole('button', { name: 'Reveal Phrase' }).click();
    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(wordLocator(page)).toHaveCount(24);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
  });

  test('settings Test your backup verifies the stored phrase', async ({ page }) => {
    await mockTonApi(page);
    const words = await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Test Backup' }).click();
    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Test your backup' }).click();

    await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
    const inputs = page.locator('input[id^="word-"]');
    for (let i = 0; i < 3; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await inputs.nth(i).fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('phrase hides when the app is backgrounded', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await expect(page.getByTestId('phrase-words')).toHaveText('');
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.getByTestId('phrase-words')).not.toHaveText('');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // The app wipes the temporary phrase and returns to the welcome screen.
    await expect(page.getByRole('heading', { name: 'Your keys, your coins' })).toBeVisible();
    await expect(page.getByTestId('phrase-words')).toHaveCount(0);
  });
});
