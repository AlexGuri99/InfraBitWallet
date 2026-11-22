/**
 * E2E for the refactored onboarding flows.
 *
 * Create: phrase (reveal + checkbox) -> 3-word verification -> passcode -> Home.
 * Import: 12/24 numbered grid (smart paste) -> passcode -> Home.
 * Runs against the production build with no Telegram client, so no device secret exists and the
 * passphrase policy requires 12+ characters. Each test gets a fresh browser context (empty IDB).
 */
import { test, expect, type Page } from '@playwright/test';

const PASS = 'e2e passphrase one';

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

  await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
  const inputs = page.locator('input[id^="word-"]');
  for (let i = 0; i < 3; i++) {
    const id = await inputs.nth(i).getAttribute('id');
    const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
    await inputs.nth(i).fill(words[position] ?? '');
  }
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Set a passcode' })).toBeVisible();
  return words;
}

async function finishCreate(page: Page): Promise<void> {
  await page.getByLabel('Passcode', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm passcode').fill(PASS);
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

    expect(await page.getByTestId('address-EVM').textContent()).toMatch(/^0x/);
    expect(await page.getByTestId('address-TRON').textContent()).toMatch(/^T/);
    expect(await page.getByTestId('address-Receive TON').textContent()).toMatch(/^UQ/);

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
    await page.getByLabel('Passcode', { exact: true }).fill('wrong passphrase');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Wrong passcode|Too many attempts/);

    await page.waitForTimeout(3500);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
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
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('address-EVM')).toHaveText(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
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
