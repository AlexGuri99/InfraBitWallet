/**
 * Real Node ESM smoke test for the Vercel functions.
 *
 * Vitest transforms TypeScript on the fly, so it cannot catch extensionless relative imports or
 * unbundled workspace sources — exactly what crashed in production
 * (ERR_MODULE_NOT_FOUND: /var/task/services/api/src/config).
 *
 * This script builds the workspace libraries, compiles the two handlers to plain JS with tsc,
 * then imports and invokes them in plain Node with a mocked invalid request. Passing proves:
 * - no extensionless / src-file imports remain,
 * - the handlers resolve @onezerowallet/api from its built dist,
 * - the 400 invalid_address path works without provider calls or API keys.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'apps/miniapp/.esm-smoke');

function run(args) {
  // When launched from a package script, npm_execpath points at pnpm's JS entry, which works
  // on every OS without .cmd shell quirks. Fall back to the shell for direct `node` runs.
  const cli = process.env['npm_execpath'];
  if (cli) {
    if (/\.(?:cjs|mjs|js)$/.test(cli)) {
      execFileSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit' });
    } else {
      // pnpm.exe on Windows (or a shell wrapper elsewhere).
      execFileSync(cli, args, { cwd: root, stdio: 'inherit' });
    }
    return;
  }
  execSync(['pnpm', ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true });
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = '') {
      this.body = body;
    },
  };
}

async function invoke(name, request, expectedError) {
  const file = resolve(outDir, 'ton', `${name}.js`);
  if (!existsSync(file)) throw new Error(`compiled handler missing: ${file}`);
  const module = await import(pathToFileURL(file).href);
  const handler = module.default;
  if (typeof handler !== 'function') throw new Error(`${name}: default export is not a function`);

  const res = fakeResponse();
  await handler(request, res);
  if (res.statusCode !== 400) {
    throw new Error(`${name}: expected 400, got ${String(res.statusCode)} body=${res.body}`);
  }
  const parsed = JSON.parse(res.body);
  if (parsed.error !== expectedError) {
    throw new Error(`${name}: unexpected error payload ${res.body}`);
  }
  const text = readFileSync(file, 'utf8');
  if (/services\/api\/src|from ['"]\.\.?\/[^'"]*['"]/.test(text)) {
    throw new Error(`${name}: compiled output still contains source/extensionless imports`);
  }
  console.log(`esm-smoke: ${name} -> 400 invalid_address`);
}

try {
  rmSync(outDir, { recursive: true, force: true });
  run(['--filter', '@onezerowallet/chain-ton', 'build']);
  run(['--filter', '@onezerowallet/api', 'build']);
  run(['--filter', '@onezerowallet/miniapp', 'exec', 'tsc', '-p', 'api/tsconfig.smoke.json']);
  const getInvalid = { method: 'GET', query: { address: 'not-a-ton-address', network: 'testnet' } };
  const postInvalid = {
    method: 'POST',
    body: { boc: 'not-a-boc', network: 'testnet' },
  };
  await invoke('portfolio', getInvalid, 'invalid_address');
  await invoke('activity', getInvalid, 'invalid_address');
  await invoke('wallet-state', getInvalid, 'invalid_address');
  await invoke('emulate', postInvalid, 'invalid_boc');
  await invoke('broadcast', postInvalid, 'invalid_boc');
  console.log('esm-smoke: OK');
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
