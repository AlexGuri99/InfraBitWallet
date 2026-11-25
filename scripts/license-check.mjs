/**
 * License gate. Lists production dependencies of EVERY workspace package via
 * `pnpm -r licenses list --prod --json` and fails if any license is not allow-listed
 * or if nothing was checked (no vacuous pass). Works on Windows and Linux.
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'MIT OR CC0-1.0',
  '(MIT OR CC0-1.0)',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'Unlicense',
  '0BSD',
  'OFL-1.1',
]);

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
let out;
try {
  out = execFileSync(pnpm, ['-r', 'licenses', 'list', '--prod', '--json'], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
} catch (e) {
  console.error('license-check: `pnpm licenses list` failed:', e instanceof Error ? e.message : e);
  process.exit(2);
}

// With -r, pnpm prints one JSON object per package or a merged object; parse leniently.
const objects = [];
let depth = 0;
let start = -1;
for (let i = 0; i < out.length; i++) {
  const c = out[i];
  if (c === '"') {
    i++;
    while (i < out.length && out[i] !== '"') i += out[i] === '\\' ? 2 : 1;
  } else if (c === '{') {
    if (depth++ === 0) start = i;
  } else if (c === '}' && --depth === 0) {
    objects.push(JSON.parse(out.slice(start, i + 1)));
  }
}

const byLicense = new Map();
for (const obj of objects) {
  for (const [license, pkgs] of Object.entries(obj)) {
    byLicense.set(license, (byLicense.get(license) ?? []).concat(pkgs.map((p) => p.name)));
  }
}

const total = [...byLicense.values()].reduce((n, l) => n + l.length, 0);
if (total === 0) {
  console.error('license-check: no packages were checked (refusing to pass vacuously)');
  process.exit(2);
}

const bad = [...byLicense.entries()].filter(([license]) => !ALLOWED.has(license));
for (const [license, names] of byLicense) {
  console.log(`${ALLOWED.has(license) ? 'ok  ' : 'BAD '} ${license}: ${String(names.length)}`);
}
if (bad.length > 0) {
  for (const [license, names] of bad) {
    console.error(
      `license-check: disallowed license ${license}: ${[...new Set(names)].join(', ')}`,
    );
  }
  process.exit(1);
}
console.log(`license-check: ${String(total)} package entries, all allow-listed`);
