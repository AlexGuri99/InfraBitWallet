/**
 * Request guard: env-gated initData auth + fixed-window rate limits (401 / 429 semantics).
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { guardTonRequest } from './api-guard.js';
import { createInMemoryRateLimiter } from './rate-limit.js';
import type { ServerConfig } from './config.js';

const TOKEN = '123456:TEST-BOT-TOKEN-not-a-real-secret';
const NOW = 1_800_000_000_000;

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    provider: 'toncenter',
    network: 'mainnet',
    requireTelegramAuth: true,
    telegramBotToken: TOKEN,
    ...overrides,
  };
}

function signedInitData(userId = 424242, token = TOKEN): string {
  const params: Record<string, string> = {
    auth_date: String(Math.floor(NOW / 1000) - 60),
    user: JSON.stringify({ id: userId }),
  };
  const pairs = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`);
  const secret = createHmac('sha256', 'WebAppData').update(token).digest('hex');
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  return `${pairs.join('&')}&hash=${hash}`;
}

function response() {
  const state = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  return {
    state,
    res: {
      set statusCode(value: number) {
        state.statusCode = value;
      },
      get statusCode() {
        return state.statusCode;
      },
      setHeader(name: string, value: string) {
        state.headers[name.toLowerCase()] = value;
      },
      end(body = '') {
        state.body = body;
      },
    },
  };
}

describe('guardTonRequest', () => {
  it('rejects a missing or invalid initData with 401 when auth is required', () => {
    for (const header of [undefined, '', 'auth_date=1&hash=deadbeef']) {
      const { res, state } = response();
      const result = guardTonRequest(
        { headers: header === undefined ? {} : { 'x-telegram-init-data': header } },
        res,
        config(),
        'read',
        { limiter: createInMemoryRateLimiter(), nowMs: NOW },
      );
      expect(result.ok).toBe(false);
      expect(state.statusCode).toBe(401);
      expect(JSON.parse(state.body)).toEqual({ error: 'unauthorized' });
    }
  });

  it('accepts a valid initData and keys the rate limit by Telegram user id', () => {
    const limiter = createInMemoryRateLimiter();
    const good = signedInitData(424242);
    const first = guardTonRequest(
      { headers: { 'x-telegram-init-data': good } },
      response().res,
      config(),
      'read',
      { limiter, nowMs: NOW },
    );
    expect(first).toEqual({ ok: true, caller: 'user:424242' });

    // A different user id has its own bucket.
    const other = guardTonRequest(
      { headers: { 'x-telegram-init-data': signedInitData(777) } },
      response().res,
      config(),
      'read',
      { limiter, nowMs: NOW },
    );
    expect(other).toEqual({ ok: true, caller: 'user:777' });
  });

  it('bypasses auth when REQUIRE_TELEGRAM_AUTH is false and keys by client IP', () => {
    const result = guardTonRequest(
      { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } },
      response().res,
      config({ requireTelegramAuth: false }),
      'read',
      { limiter: createInMemoryRateLimiter(), nowMs: NOW },
    );
    expect(result).toEqual({ ok: true, caller: 'ip:203.0.113.9' });
  });

  it('allows 60 reads/min per caller, then returns 429 with Retry-After', () => {
    const limiter = createInMemoryRateLimiter();
    const req = { headers: { 'x-forwarded-for': '198.51.100.7' } };
    const cfg = config({ requireTelegramAuth: false });
    for (let i = 0; i < 60; i += 1) {
      expect(guardTonRequest(req, response().res, cfg, 'read', { limiter, nowMs: NOW }).ok).toBe(
        true,
      );
    }
    const { res, state } = response();
    expect(guardTonRequest(req, res, cfg, 'read', { limiter, nowMs: NOW }).ok).toBe(false);
    expect(state.statusCode).toBe(429);
    expect(JSON.parse(state.body)).toEqual({ error: 'rate_limited' });
    expect(Number(state.headers['retry-after'])).toBeGreaterThan(0);

    // A new window (after 60 s) allows again.
    expect(
      guardTonRequest(req, response().res, cfg, 'read', { limiter, nowMs: NOW + 61_000 }).ok,
    ).toBe(true);
  });

  it('applies the stricter heavy-route budget (20/min) independently of reads', () => {
    const limiter = createInMemoryRateLimiter();
    const req = { headers: { 'x-forwarded-for': '198.51.100.8' } };
    const cfg = config({ requireTelegramAuth: false });
    for (let i = 0; i < 20; i += 1) {
      expect(guardTonRequest(req, response().res, cfg, 'heavy', { limiter, nowMs: NOW }).ok).toBe(
        true,
      );
    }
    const { res, state } = response();
    expect(guardTonRequest(req, res, cfg, 'heavy', { limiter, nowMs: NOW }).ok).toBe(false);
    expect(state.statusCode).toBe(429);
    // Reads are unaffected by the heavy bucket.
    expect(guardTonRequest(req, response().res, cfg, 'read', { limiter, nowMs: NOW }).ok).toBe(
      true,
    );
  });

  it('keeps /api/ton/config reachable without auth (skipAuth)', () => {
    const result = guardTonRequest(
      { headers: { 'x-forwarded-for': '198.51.100.9' } },
      response().res,
      config(),
      'read',
      { skipAuth: true, limiter: createInMemoryRateLimiter(), nowMs: NOW },
    );
    expect(result.ok).toBe(true);
  });

  it('fails closed when auth is required but no token is configured', () => {
    const { res, state } = response();
    const result = guardTonRequest(
      { headers: { 'x-telegram-init-data': signedInitData() } },
      res,
      config({ telegramBotToken: undefined }),
      'read',
      { limiter: createInMemoryRateLimiter(), nowMs: NOW },
    );
    expect(result.ok).toBe(false);
    expect(state.statusCode).toBe(500);
    expect(JSON.parse(state.body)).toEqual({ error: 'server_misconfigured' });
  });
});
