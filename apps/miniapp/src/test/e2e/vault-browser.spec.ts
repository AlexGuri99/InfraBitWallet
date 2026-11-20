/**
 * E2E test: vault operations in the browser under production CSP.
 *
 * Verifies:
 * 1. The production build loads under the CSP from vercel.json
 * 2. Argon2id-based vault create/unlock works in the browser (with wasm-unsafe-eval)
 * 3. V2 vault with mnemonic storage works in the browser
 * 4. Built bundle does not contain hardcoded secrets
 */

import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SELF_DIR, '..', '..', '..', '..', '..');

// ---------------------------------------------------------------------------
// CSP helpers
// ---------------------------------------------------------------------------

/** Read the current CSP from vercel.json */
function getCspFromVercel(): string {
  const vercelPath = resolve(PROJECT_ROOT, 'vercel.json');
  const raw = readFileSync(vercelPath, 'utf-8');
  const cfg: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>;
  const rawHeaders = cfg['headers'];
  const headers: { source: string; headers: { key: string; value: string }[] }[] =
    Array.isArray(rawHeaders) ? (rawHeaders as { source: string; headers: { key: string; value: string }[] }[]) : [];
  const match = headers.find((h) => h.source === '/(.*)');
  const cspHeader = match?.headers?.find(
    (h: { key: string; value: string }) => h.key.toLowerCase() === 'content-security-policy',
  );
  return cspHeader?.value ?? '';
}

/** Vault test page HTML — served inline with the vault-bundle.js script */
const VAULT_TEST_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script src="vault-bundle.js"></script><h1 id="status">Ready</h1></body></html>';

/** Set up route interception that applies the given CSP to all file responses */
async function applyCsp(page: import('@playwright/test').Page, csp: string): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url;
    if (url.endsWith('/vault-test') || url.endsWith('/vault-test.html')) {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'content-security-policy': csp },
        body: VAULT_TEST_HTML,
      });
      return;
    }
    const response = await route.fetch();
    const headers = new Headers(response.headers);
    headers.set('content-security-policy', csp);
    route.fulfill({
      status: response.status,
      headers: Object.fromEntries(headers),
      body: await response.body(),
    });
  });
}

// ---------------------------------------------------------------------------
// Bundle secret scan
// ---------------------------------------------------------------------------

/** Collect all files with given extensions recursively from dir */
function collectFiles(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        results.push(...collectFiles(full, exts));
      } else {
        const hasExt = exts.some((e) => entry.endsWith(e));
        if (hasExt) {
          results.push(full);
        }
      }
    }
  } catch {
    // skip non-existent dirs
  }
  return results;
}

interface ScanRule {
  pattern: RegExp;
  reason: string;
}

/** Patterns that should NOT appear in production JS bundles */
const SECRET_PATTERNS: ScanRule[] = [
  { pattern: /abandon (?:abandon ){11}about/, reason: 'BIP-39 test mnemonic' },
  { pattern: /[0-9a-f]{128,}/i, reason: '512+ bit hex string (possible private key or seed)' },
  { pattern: /xpriv|xprv|tprv|spriv/, reason: 'Extended private key prefix' },
  { pattern: /BEGIN EC PRIVATE KEY|BEGIN RSA PRIVATE KEY/, reason: 'PEM-encoded private key' },
  { pattern: /sk_-/i, reason: 'Stripe secret key pattern (sk_live/sk_test)' },
  { pattern: /ghp_|gho_|github_pat/, reason: 'GitHub personal access token' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Vault browser operations', () => {
  const csp = getCspFromVercel();

  test('production CSP allows app to load', async ({ page }) => {
    await page.route('**/*', async (route) => {
      const response = await route.fetch();
      const headers = new Headers(response.headers);
      headers.set('content-security-policy', csp);
      route.fulfill({
        status: response.status,
        headers: Object.fromEntries(headers),
        body: await response.body(),
      });
    });
    await page.goto('/');
    await expect(page.getByText('OneZeroWallet')).toBeVisible();
  });

  test('Argon2id vault create/unlock works under production CSP (with wasm-unsafe-eval)', async ({ page }) => {
    const cspWithWasm = csp.replace(
      "script-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
    );
    await applyCsp(page, cspWithWasm);
    await page.goto('/vault-test.html');
    await expect(page.getByText('Ready')).toBeVisible();

    const result = await page.evaluate(async () => {
      const win = window as unknown as Record<string, Record<string, unknown>>;
      const vault = win['vault'];
      if (!vault) return { ok: false, err: 'vault not loaded' };
      try {
        const phrase = vault['generateMnemonicPhrase'](24) as string;
        const normalized = vault['normalizeMnemonic'](phrase) as string;
        const seed = vault['mnemonicToSeed'](normalized) as Uint8Array;
        const seal = await (vault['sealVault'] as (s: Uint8Array, p: string) => Promise<Record<string, unknown>>)(seed, 'test-passcode-123');
        const ur = await (vault['unsealVault'] as (s: Record<string, unknown>, p: string) => Promise<Record<string, unknown>>)(seal, 'test-passcode-123');
        const urr = ur as Record<string, boolean>;
        if (!urr['success']) {
          return { ok: false, err: (ur as Record<string, string>)['error'] ?? 'unknown' };
        }
        return { ok: true, ver: (seal['version'] as number) };
      } catch (e) {
        return { ok: false, err: e instanceof Error ? e.message : String(e) };
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ver).toBe(1);
    }
  });

  test('v2 vault with mnemonic works under production CSP', async ({ page }) => {
    const cspWithWasm = csp.replace(
      "script-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
    );
    await applyCsp(page, cspWithWasm);
    await page.goto('/vault-test.html');
    await expect(page.getByText('Ready')).toBeVisible();

    const result = await page.evaluate(async () => {
      const win = window as unknown as Record<string, Record<string, unknown>>;
      const vault = win['vault'];
      if (!vault) return { ok: false, err: 'vault not loaded' };
      try {
        const phrase = vault['generateMnemonicPhrase'](24) as string;
        const normalized = vault['normalizeMnemonic'](phrase) as string;
        const seed = vault['mnemonicToSeed'](normalized) as Uint8Array;
        const seal = await (vault['sealVault'] as (s: Uint8Array, p: string, ds: unknown, cfg: unknown, mn: string) => Promise<Record<string, unknown>>)(seed, 'v2-password-789', undefined, undefined, phrase);
        if ((seal['version'] as number) !== 2) {
          return { ok: false, err: 'not v2' };
        }
        const ur = await (vault['unsealVault'] as (s: Record<string, unknown>, p: string) => Promise<Record<string, unknown>>)(seal, 'v2-password-789');
        const urr = ur as Record<string, string>;
        if (!(ur as Record<string, boolean>)['success']) {
          return { ok: false, err: urr['error'] ?? 'unknown' };
        }
        return { ok: true, mnemonicMatch: urr['mnemonic'] === phrase };
      } catch (e) {
        return { ok: false, err: e instanceof Error ? e.message : String(e) };
      }
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mnemonicMatch).toBe(true);
    }
  });

  test('built JS bundle has no hardcoded secrets', async () => {
    const distDir = resolve(PROJECT_ROOT, 'apps/miniapp/dist');
    const jsFiles = collectFiles(distDir, ['.js', '.html']);
    expect(jsFiles.length).toBeGreaterThan(0);

    const allIssues: string[] = [];
    for (const f of jsFiles) {
      const content = readFileSync(f, 'utf-8');
      for (const rule of SECRET_PATTERNS) {
        if (rule.pattern.test(content)) {
          allIssues.push(`${f.replace(PROJECT_ROOT, '').replace(/\\/g, '/')}: ${rule.reason}`);
        }
      }
    }
    if (allIssues.length > 0) {
      console.log('Secret scan issues found:');
      for (const issue of allIssues) {
        console.log(`  ${issue}`);
      }
    }
    expect(allIssues).toHaveLength(0);
  });
});