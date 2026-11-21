/**
 * Vercel output-location compatibility.
 *
 * Depending on how a monorepo project's Root Directory is configured, Vercel can check for the
 * output at "<root>/dist" or at the repository root. The Vite build writes apps/miniapp/dist;
 * this copies it to the repository root as well so both checks succeed. The copy is gitignored
 * and is not used by local tooling (vite preview still serves apps/miniapp/dist).
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(appRoot, 'dist');
const repoRoot = resolve(appRoot, '..', '..');
const destination = resolve(repoRoot, 'dist');

if (!existsSync(source)) {
  console.log('ensure-root-dist: apps/miniapp/dist not found; nothing to copy');
  process.exit(0);
}

if (source !== destination) {
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  console.log('ensure-root-dist: copied apps/miniapp/dist -> dist');
}
