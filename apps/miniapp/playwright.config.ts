import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm build && npx esbuild ../../packages/crypto-vault/src/index.ts --bundle --outfile=dist/vault-bundle.js --platform=browser --format=iife --global-name=vault && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
