// Test setup — mock Telegram environment and DOM matchers
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { mockTelegramEnvironment } from '../telegram/__mocks__/telegramMock';

mockTelegramEnvironment();

afterEach(() => {
  cleanup();
});
