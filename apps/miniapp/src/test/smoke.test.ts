import { describe, it, expect } from 'vitest';

// Trivial smoke test to verify the test runner works
describe('smoke', () => {
  it('should run tests', () => {
    expect(1 + 1).toBe(2);
  });

  it('should import and render without error', async () => {
    // Just verify modules import cleanly
    const { mockTelegramEnvironment } = await import('../telegram/__mocks__/telegramMock');
    expect(mockTelegramEnvironment).toBeDefined();
  });
});
