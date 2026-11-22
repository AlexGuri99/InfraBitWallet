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
  await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
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

test.describe('onboarding and unlock', () => {
  test('create, verify, passcode, lock/unlock, survive reload', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);

    await page.getByRole('button', { name: 'Receive' }).click();
    await expect(page.getByTestId('address-EVM')).toHaveText(/^0x/);
    await expect(page.getByTestId('address-TRON')).toHaveText(/^T/);
    await expect(page.getByTestId('address-TON')).toHaveText(/^UQ/);
    await page.getByRole('button', { name: 'Close' }).click();

    const dump = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      text: document.body.innerText,
    }));
    expect(dump.local).not.toContain(words[0] ?? 'never');
    expect(dump.session).not.toContain(words[0] ?? 'never');
    expect(dump.text).not.toContain(words.join(' '));

    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill('1357');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Wrong passcode|Too many attempts/);

    await page.waitForTimeout(3500);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('PIN', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
  });

  test('IndexedDB holds only the sealed envelope after create', async ({ page }) => {
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

    expect(dump.keys.sort()).toEqual(['vault_seal']);
    expect(dump.values).not.toContain(words.join(' '));
    expect(dump.values).toContain('passcodeWrappedKey');
    expect(dump.values).toContain('accountType');
  });

  test('import: 12-word grid via smart paste, then passcode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
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

    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await page.getByRole('button', { name: 'Receive' }).click();
    await expect(page.getByTestId('address-EVM')).toHaveText(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });

  test('home dashboard: hero, tabs, actions and asset list', async ({ page }) => {
    await createToPasscode(page);
    await finishCreate(page);

    await expect(page.getByText('Main Wallet')).toBeVisible();
    await expect(page.getByText('Testnet')).toBeVisible();
    await expect(page.getByTestId('hero-balance')).toHaveText('$0.00');
    await expect(page.getByTestId('asset-TON')).toContainText('Toncoin');
    await expect(page.getByTestId('asset-USDT')).toContainText('TON · Jetton');
    await expect(page.getByTestId('asset-TRX')).toContainText('TRC-20');
    await expect(page.getByTestId('asset-ETH')).toContainText('ERC-20');

    await page.getByRole('button', { name: 'Hide balance' }).click();
    await expect(page.getByTestId('hero-balance')).toHaveText('••••');
    await page.getByRole('button', { name: 'Show balance' }).click();

    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByText(/No transactions yet/)).toBeVisible();
    await page.getByRole('tab', { name: 'Wallet' }).click();

    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('dialog', { name: 'Send' })).toContainText('P2');
    await page.getByRole('button', { name: 'Close' }).click();
  });

  test('ton-native import shows only TON assets and address', async ({ page }) => {
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

    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('asset-TON')).toBeVisible();
    await expect(page.getByTestId('asset-USDT')).toBeVisible();
    await expect(page.getByTestId('asset-TRX')).toHaveCount(0);
    await expect(page.getByTestId('asset-ETH')).toHaveCount(0);

    await page.getByRole('button', { name: 'Receive' }).click();
    await expect(page.getByTestId('address-TON')).toHaveText(/^UQ/);
    await expect(page.getByTestId('address-TRON')).toHaveCount(0);
    await expect(page.getByTestId('address-EVM')).toHaveCount(0);
  });

  test('settings reveal requires re-auth and clears the phrase on leaving', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(wordLocator(page)).toHaveCount(24);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
  });

  test('settings Test your backup verifies the stored phrase', async ({ page }) => {
    const words = await createToPasscode(page);
    await finishCreate(page);
    await page.getByRole('button', { name: 'Settings' }).click();
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
