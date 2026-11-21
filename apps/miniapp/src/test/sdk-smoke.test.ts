/**
 * B3: smoke test of @telegram-apps/sdk in a mocked environment under the valibot override.
 *
 * This proves the SDK loads, initializes, mocks launch params and cleans up without throwing.
 * It does NOT prove behaviour inside a real Telegram client (manual checks remain).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  init,
  isTMA,
  mockTelegramEnv,
  retrieveLaunchParams,
  retrieveRawLaunchParams,
} from '@telegram-apps/sdk';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('B3: @telegram-apps/sdk smoke test', () => {
  it('imports the expected functions', () => {
    expect(typeof init).toBe('function');
    expect(typeof retrieveLaunchParams).toBe('function');
    expect(typeof mockTelegramEnv).toBe('function');
  });

  it('isTMA returns a boolean without throwing', () => {
    expect(typeof isTMA()).toBe('boolean');
  });

  it('initializes against a mocked environment and reads launch params', () => {
    mockTelegramEnv({
      launchParams: {
        tgWebAppVersion: '10.0',
        tgWebAppPlatform: 'tdesktop',
        tgWebAppThemeParams: {},
      },
      resetPostMessage: true,
    });
    cleanups.push(init({ acceptCustomStyles: false }));

    const params = retrieveLaunchParams();
    expect(params.tgWebAppVersion).toBe('10.0');
    expect(params.tgWebAppPlatform).toBe('tdesktop');
    expect(retrieveRawLaunchParams()).toContain('tgWebAppVersion=10.0');
    expect(isTMA()).toBe(true);
  });
});
