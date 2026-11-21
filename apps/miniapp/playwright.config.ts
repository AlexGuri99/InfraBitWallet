import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  // 'never' so a failing local run does not block waiting on a report server.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // e2e-prepare builds dist/ and .e2e/vault-bundle.js, so a fresh clone needs no manual step.
    command: 'node scripts/e2e-prepare.mjs && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // Never reuse: a stale server could serve an old build and hide failures.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
