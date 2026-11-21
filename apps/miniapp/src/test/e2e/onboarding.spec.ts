/**
 * Stage C E2E: create a wallet, verify the backup, lock/unlock, reject a wrong passcode and
 * reload into a persisted vault. Runs against the production build with no Telegram client, so
 * no device secret exists and the passphrase policy requires 12+ characters.
 *
 * Every test gets a fresh browser context, so IndexedDB starts empty.
 */
import { test, expect } from '@playwright/test';

const PASS = 'e2e passphrase one';

test.describe('onboarding and unlock', () => {
  test('create, verify backup, lock and unlock, survive reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();

    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Your recovery phrase' })).toBeVisible();
    await expect(page.getByTestId('phrase-words')).toHaveText('');
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();

    const words = (await page.getByTestId('phrase-words').locator('span').allTextContents()).map(
      (text) => text.replace(/^\d+\.\s*/, ''),
    );
    expect(words).toHaveLength(24);
    await page.getByRole('button', { name: 'I wrote it down' }).click();

    await expect(page.getByRole('heading', { name: 'Check your backup' })).toBeVisible();
    const inputs = page.locator('input[id^="word-"]');
    const count = await inputs.count();
    expect(count).toBe(3);
    for (let i = 0; i < count; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await inputs.nth(i).fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // The phrase must not survive in web storage or the visible DOM.
    const dump = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
      text: document.body.innerText,
    }));
    expect(dump.local).not.toContain(words[0] ?? 'never');
    expect(dump.session).not.toContain(words[0] ?? 'never');
    expect(dump.text).not.toContain(words.join(' '));

    // Wrong passcode is rejected; then the right one opens the wallet.
    await page.getByLabel('Passcode', { exact: true }).fill('wrong passphrase');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Wrong passcode|Too many attempts/);

    // The wrong attempt opened a short backoff window; let it elapse before reloading.
    await page.waitForTimeout(3500);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('address-EVM')).toHaveText(/^0x/);
    await expect(page.getByTestId('address-TRON')).toHaveText(/^T/);
    await expect(page.getByTestId('address-Receive TON')).toHaveText(/^UQ/);
  });

  test('IndexedDB holds only the sealed envelope, never the phrase', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    const words = (await page.getByTestId('phrase-words').locator('span').allTextContents()).map(
      (text) => text.replace(/^\d+\.\s*/, ''),
    );

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
    for (const word of words) expect(dump.values.toLowerCase()).not.toContain(word.toLowerCase());
  });

  test('imports a wallet phrase', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Import a wallet' }).click();
    await page
      .getByLabel('Recovery phrase')
      .fill('test test test test test test test test test test test junk');
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByRole('heading', { name: 'Your wallet' })).toBeVisible();
    await expect(page.getByTestId('address-EVM')).toHaveText(
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });

  test('settings reveal requires re-auth and clears the phrase on leaving', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    const words = (await page.getByTestId('phrase-words').locator('span').allTextContents()).map(
      (text) => text.replace(/^\d+\.\s*/, ''),
    );
    await page.getByRole('button', { name: 'I wrote it down' }).click();
    const inputs = page.locator('input[id^="word-"]');
    for (let i = 0; i < 3; i++) {
      const id = await inputs.nth(i).getAttribute('id');
      const position = Number.parseInt(id?.replace('word-', '') ?? '0', 10);
      await inputs.nth(i).fill(words[position] ?? '');
    }
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByLabel('Enter your passcode to continue').fill(PASS);
    await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.getByTestId('phrase-words')).not.toHaveText('');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(words.join(' '));
  });

  test('the phrase screen is empty until the explicit reveal tap', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a wallet' }).click();
    await page.getByLabel('Passcode', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passcode').fill(PASS);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('phrase-words')).toHaveText('');

    // Backgrounding hides an already revealed phrase.
    await page.getByRole('button', { name: 'Show recovery phrase' }).click();
    await expect(page.getByTestId('phrase-words')).not.toHaveText('');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('phrase-words')).toHaveText('');
  });
});
