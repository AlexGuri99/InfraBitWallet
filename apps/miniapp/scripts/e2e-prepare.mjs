/**
 * Prepare everything the Playwright suite needs, from a clean checkout, on any OS:
 *  1. production build of the miniapp into dist/ (Vite empties dist/ first)
 *  2. a browser bundle of the vault package into .e2e/vault-bundle.js
 *     (kept OUT of dist/ so the production output stays exactly what ships)
 *
 * Fails loudly if either output is missing afterwards.
 */
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const e2eDir = resolve(root, '.e2e');
const vaultEntry = resolve(root, '..', '..', 'packages', 'crypto-vault', 'src', 'index.ts');
const vaultOut = resolve(e2eDir, 'vault-bundle.js');

await viteBuild({ root, logLevel: 'warn' });

rmSync(e2eDir, { recursive: true, force: true });
mkdirSync(e2eDir, { recursive: true });
await esbuild({
  entryPoints: [vaultEntry],
  bundle: true,
  outfile: vaultOut,
  platform: 'browser',
  format: 'iife',
  globalName: 'vault',
  logLevel: 'warning',
});

for (const required of [resolve(dist, 'index.html'), vaultOut]) {
  if (!existsSync(required) || statSync(required).size === 0) {
    throw new Error(`e2e-prepare: expected output missing or empty: ${required}`);
  }
}
console.log('e2e-prepare: dist/ and .e2e/vault-bundle.js ready');
