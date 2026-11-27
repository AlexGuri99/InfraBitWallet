/**
 * Telegram initData HMAC verification: valid, tampered, expired, future-skewed and malformed.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from './auth.js';

const TOKEN = '123456:TEST-BOT-TOKEN-not-a-real-secret';
const NOW = 1_800_000_000_000; // fixed clock (seconds = 1_800_000_000)

function sign(params: Record<string, string>, token = TOKEN): string {
  const pairs = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const secret = createHmac('sha256', 'WebAppData').update(token).digest('hex');
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  const query = new URLSearchParams(params);
  query.set('hash', hash);
  return query.toString();
}

function baseParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    auth_date: String(Math.floor(NOW / 1000) - 60),
    query_id: 'AAH-test',
    user: JSON.stringify({ id: 424242, first_name: 'Test' }),
    ...overrides,
  };
}

describe('verifyTelegramInitData', () => {
  it('accepts a correctly signed payload and extracts the user id', () => {
    const result = verifyTelegramInitData(sign(baseParams()), TOKEN, NOW);
    expect(result).toEqual({
      ok: true,
      userId: 424242,
      authDate: Math.floor(NOW / 1000) - 60,
    });
  });

  it('rejects a tampered field, a different token and a bad hash', () => {
    const valid = sign(baseParams());
    const tampered = valid.replace('424242', '999999');
    expect(verifyTelegramInitData(tampered, TOKEN, NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
    expect(verifyTelegramInitData(valid, 'another-token', NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
    const badHash = `${valid.split('hash=')[0] ?? ''}hash=${'0'.repeat(64)}`;
    expect(verifyTelegramInitData(badHash, TOKEN, NOW)).toEqual({
      ok: false,
      error: 'bad_hash',
    });
  });

  it('rejects payloads older than 24h and more than 5 minutes in the future', () => {
    const stale = sign(baseParams({ auth_date: String(Math.floor(NOW / 1000) - 86_401) }));
    expect(verifyTelegramInitData(stale, TOKEN, NOW)).toEqual({ ok: false, error: 'expired' });

    const future = sign(baseParams({ auth_date: String(Math.floor(NOW / 1000) + 301) }));
    expect(verifyTelegramInitData(future, TOKEN, NOW)).toEqual({ ok: false, error: 'expired' });

    const slightFuture = sign(baseParams({ auth_date: String(Math.floor(NOW / 1000) + 120) }));
    expect(verifyTelegramInitData(slightFuture, TOKEN, NOW)).toMatchObject({ ok: true });
  });

  it('rejects missing, empty and malformed payloads without throwing', () => {
    for (const value of [undefined, null, '', 'not-a-query', 'auth_date=1']) {
      const result = verifyTelegramInitData(value, TOKEN, NOW);
      expect(result.ok).toBe(false);
    }
  });
});
