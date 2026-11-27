import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
    // UI tests run real Argon2id (fast test KDF) + full flows; 5s is too tight when suites run
    // in parallel on CI hardware. Failures are still assertion-driven.
    testTimeout: 20_000,
  },
});
