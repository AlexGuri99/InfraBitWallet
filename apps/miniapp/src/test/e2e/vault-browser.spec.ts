/**
 * E2E: the production build and the vault under the production CSP from vercel.json.
 *
 * Preconditions (dist/ and .e2e/vault-bundle.js) are created by scripts/e2e-prepare.mjs,
 * which Playwright's webServer runs before starting the preview server.
 *
 * The CSP is applied exactly as written in vercel.json (no string rewriting), and every
 * test fails if the browser reports a CSP violation.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const MINIAPP_ROOT = resolve(SELF_DIR, '..', '..', '..');
const PROJECT_ROOT = resolve(MINIAPP_ROOT, '..', '..');
const VAULT_BUNDLE_PATH = resolve(MINIAPP_ROOT, '.e2e', 'vault-bundle.js');

interface VercelHeader {
  key: string;
  value: string;
}
interface VercelHeaderRule {
  source: string;
  headers: VercelHeader[];
}

/** Read the production CSP from vercel.json. Throws if it is not present. */
function getProductionCsp(): string {
  const cfg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'vercel.json'), 'utf-8')) as {
    headers?: VercelHeaderRule[];
  };
  const rule = cfg.headers?.find((h) => h.source === '/(.*)');
  const csp = rule?.headers.find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;
  if (!csp) throw new Error('vercel.json has no Content-Security-Policy header for /(.*)');
  return csp;
}

const VAULT_TEST_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>vault test</title></head>' +
  '<body><h1 id="status">Ready</h1><script src="/vault-bundle.js"></script></body></html>';

/**
 * Serve the vault test page + bundle (same origin) and add the production CSP to every
 * response. Collects CSP violations reported by the browser.
 */
async function applyProductionCsp(page: Page, csp: string): Promise<string[]> {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP_VIOLATION ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (msg) => {
    if (msg.text().startsWith('CSP_VIOLATION')) violations.push(msg.text());
  });

  await page.route('**/*', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/vault-test.html') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'content-security-policy': csp },
        body: VAULT_TEST_HTML,
      });
      return;
    }
    if (path === '/vault-bundle.js') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        headers: { 'content-security-policy': csp },
        body: readFileSync(VAULT_BUNDLE_PATH),
      });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  return violations;
}

test.describe('Production CSP', () => {
  const csp = getProductionCsp();

  test('CSP in vercel.json has wasm-unsafe-eval but no unsafe-eval or script unsafe-inline', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain("'wasm-unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  test('production CSP allows app to load with no CSP violations', async ({ page }) => {
    const violations = await applyProductionCsp(page, csp);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'OneZeroWallet' })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('Argon2id vault create/unlock works under production CSP (WASM allowed)', async ({
    page,
  }) => {
    const violations = await applyProductionCsp(page, csp);
    await page.goto('/vault-test.html');
    await expect(page.locator('#status')).toHaveText('Ready');

    const result = await page.evaluate(async () => {
      const vault = (window as unknown as { vault?: Record<string, (...a: unknown[]) => unknown> })
        .vault;
      if (!vault) return { ok: false, err: 'vault bundle not loaded' };
      try {
        const phrase = vault['generateMnemonicPhrase']?.(24) as string;
        const seal = await (vault['createSeal']?.(phrase, 'test-passcode-123') as Promise<
          Record<string, unknown>
        >);
        const storage = new (vault['InMemoryStorage'] as new () => unknown)();
        const unlocked = await (vault['unlockSession']?.(
          seal,
          'test-passcode-123',
          storage,
        ) as Promise<{ success: boolean; error?: string }>);
        (vault['lockSession'] as () => void)();
        return unlocked.success
          ? { ok: true, version: seal['version'] as number }
          : { ok: false, err: unlocked.error ?? 'unknown' };
      } catch (e) {
        return { ok: false, err: e instanceof Error ? e.message : 'non-Error thrown' };
      }
    });

    expect(result).toMatchObject({ ok: true });
    expect(violations).toEqual([]);
  });

  test('Argon2id fails closed when WASM is blocked by a CSP without wasm-unsafe-eval', async ({
    page,
  }) => {
    // Negative control: proves the previous test depends on 'wasm-unsafe-eval' and is not vacuous.
    const strictCsp = csp.replace(" 'wasm-unsafe-eval'", '');
    expect(strictCsp).not.toContain('wasm-unsafe-eval');
    await applyProductionCsp(page, strictCsp);
    await page.goto('/vault-test.html');
    await expect(page.locator('#status')).toHaveText('Ready');

    const result = await page.evaluate(async () => {
      const vault = (window as unknown as { vault?: Record<string, (...a: unknown[]) => unknown> })
        .vault;
      if (!vault) return { ok: false, err: 'vault bundle not loaded' };
      try {
        await (vault['createSeal']?.(
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          'test-passcode-123',
        ) as Promise<unknown>);
        return { ok: true, err: '' };
      } catch (e) {
        return { ok: false, err: e instanceof Error ? e.message : 'non-Error thrown' };
      }
    });
    expect(result.ok).toBe(false);
    expect(result.err).toBe('KDF_UNAVAILABLE');
  });
});
