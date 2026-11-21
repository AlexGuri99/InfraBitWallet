/**
 * Scans the REAL production build output (apps/miniapp/dist) and the vault test bundle
 * (apps/miniapp/.e2e/vault-bundle.js) for hardcoded secrets.
 *
 * Both directories are produced by scripts/e2e-prepare.mjs. The scanner throws if a
 * directory is missing or empty, so this test cannot pass vacuously. The scanner itself is
 * proven in src/test/helpers/secret-scan.test.ts (negative tests with injected secrets).
 */
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFiles, scanDirectory } from '../helpers/secret-scan';

const MINIAPP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test.describe('Build output secret scan', () => {
  test('production build (dist/) has JS output and no hardcoded secrets', () => {
    const dist = resolve(MINIAPP_ROOT, 'dist');
    expect(collectFiles(dist, ['.js']).length).toBeGreaterThan(0);
    expect(collectFiles(dist, ['.html']).length).toBeGreaterThan(0);
    expect(scanDirectory(dist)).toEqual([]);
  });

  test('vault test bundle (.e2e/) exists and has no hardcoded secrets', () => {
    const e2e = resolve(MINIAPP_ROOT, '.e2e');
    expect(collectFiles(e2e, ['.js']).length).toBeGreaterThan(0);
    expect(scanDirectory(e2e)).toEqual([]);
  });
});
