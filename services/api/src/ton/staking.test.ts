/** Tonstakers staking-info proxy tests with a mocked upstream (no network, no keys). */
import { describe, it, expect } from 'vitest';
import { Address } from '@ton/core';
import { TONSTAKERS_POOL_MAINNET } from '@onezerowallet/staking-ton';
import { StakingError, StakingService } from './staking.js';
import type { FetchLike } from './http.js';
import type { ServerConfig } from '../config.js';

const MASTER = '0:bdf3fa8098d129b54b4f73b5bac5d1e1fd91eb054169c3916dfc8ccd536d1000';
const POOL_RAW = Address.parse(TONSTAKERS_POOL_MAINNET).toRawString();

const MAINNET: ServerConfig = {
  provider: 'toncenter',
  network: 'mainnet',
  requireTelegramAuth: false,
};
const TESTNET: ServerConfig = {
  provider: 'toncenter',
  network: 'testnet',
  requireTelegramAuth: false,
};

function poolBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    implementation: { name: 'Tonstakers', description: 'Minimum deposit 1 GRAM' },
    pool: {
      apy: 12.5,
      total_amount: 150_000_000_000_000_000,
      current_nominators: 147_970,
      verified: true,
      liquid_jetton_master: MASTER,
      ...overrides,
    },
  };
}

function jettonBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    address: MASTER,
    total_supply: '125000000000000000',
    metadata: { symbol: 'tsTON', name: 'Tonstakers TON', decimals: '9' },
    verification: 'whitelist',
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string> | undefined;
}

function mock(handler: (url: string) => { ok: boolean; status: number; body: unknown }): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers });
    const res = handler(url);
    return Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body),
    });
  };
  return { fetchImpl, calls };
}

const defaultHandler = (url: string): { ok: boolean; status: number; body: unknown } => {
  if (url.includes('/v2/staking/pool/')) return { ok: true, status: 200, body: poolBody() };
  if (url.includes('/v2/jettons/')) return { ok: true, status: 200, body: jettonBody() };
  if (url.includes('/v2/accounts/')) {
    return { ok: true, status: 200, body: { balance: 1_000_000_000_000_000, status: 'active' } };
  }
  return { ok: false, status: 404, body: {} };
};

describe('StakingService.info', () => {
  it('normalizes live pool metrics on mainnet', async () => {
    const { fetchImpl, calls } = mock(defaultHandler);
    const info = await new StakingService({ config: MAINNET, fetchImpl }).info({
      network: 'mainnet',
    });
    expect(info.network).toBe('mainnet');
    expect(info.poolAddress).toBe(POOL_RAW);
    expect(info.tsTonMasterAddress).toBe(MASTER);
    expect(info.tsTonSymbol).toBe('tsTON');
    expect(info.tsTonDecimals).toBe(9);
    expect(info.apy).toBe(12.5);
    expect(info.stakers).toBe(147_970);
    expect(info.tvlRaw).toBe('150000000000000000');
    expect(info.instantLiquidityRaw).toBe('1000000000000000');
    // 150 TON of assets over 125 tsTON supply → 1.2 TON per tsTON.
    expect(info.exchangeRate).toBeCloseTo(1.2, 9);
    expect(info.verified).toBe(true);
    // The jetton must be fetched by the master the pool reported, never a guess.
    expect(
      calls.some((call) => call.url.includes(`/v2/jettons/${encodeURIComponent(MASTER)}`)),
    ).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('sends a configured TonAPI key only as an Authorization header', async () => {
    const { fetchImpl, calls } = mock(defaultHandler);
    const service = new StakingService({
      config: { ...MAINNET, tonapiApiKey: 'tonapi-key' },
      fetchImpl,
    });
    await service.info({ network: 'mainnet' });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers).toEqual({ Authorization: 'Bearer tonapi-key' });
      expect(call.url).not.toContain('tonapi-key');
    }
  });

  it('fails closed on testnet without calling any provider', async () => {
    const { fetchImpl, calls } = mock(defaultHandler);
    await expect(
      new StakingService({ config: TESTNET, fetchImpl }).info({ network: 'testnet' }),
    ).rejects.toMatchObject({ code: 'staking_unavailable' });
    expect(calls).toEqual([]);
  });

  it('rejects a network that does not match the server switch', async () => {
    const { fetchImpl } = mock(defaultHandler);
    await expect(
      new StakingService({ config: TESTNET, fetchImpl }).info({ network: 'mainnet' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('fails closed when the provider describes a different implementation', async () => {
    const { fetchImpl } = mock(() => ({
      ok: true,
      status: 200,
      body: poolBody(),
    }));
    const service = new StakingService({ config: MAINNET, fetchImpl: mockOther(fetchImpl) });
    await expect(service.info({ network: 'mainnet' })).rejects.toBeInstanceOf(StakingError);
  });

  it('fails closed on an unverified pool', async () => {
    const { fetchImpl } = mock((url) =>
      url.includes('/v2/staking/pool/')
        ? { ok: true, status: 200, body: poolBody({ verified: false }) }
        : defaultHandler(url),
    );
    await expect(
      new StakingService({ config: MAINNET, fetchImpl }).info({ network: 'mainnet' }),
    ).rejects.toMatchObject({ code: 'staking_unavailable' });
  });

  it('fails closed when the jetton master is missing', async () => {
    const { fetchImpl } = mock((url) =>
      url.includes('/v2/staking/pool/')
        ? { ok: true, status: 200, body: poolBody({ liquid_jetton_master: null }) }
        : defaultHandler(url),
    );
    await expect(
      new StakingService({ config: MAINNET, fetchImpl }).info({ network: 'mainnet' }),
    ).rejects.toMatchObject({ code: 'staking_unavailable' });
  });

  it('fails closed when the jetton endpoint returns a different token', async () => {
    const { fetchImpl } = mock((url) =>
      url.includes('/v2/jettons/')
        ? { ok: true, status: 200, body: jettonBody({ address: POOL_RAW }) }
        : defaultHandler(url),
    );
    await expect(
      new StakingService({ config: MAINNET, fetchImpl }).info({ network: 'mainnet' }),
    ).rejects.toMatchObject({ code: 'staking_unavailable' });
  });

  it('fails closed on a zero supply instead of dividing by it', async () => {
    const { fetchImpl } = mock((url) =>
      url.includes('/v2/jettons/')
        ? { ok: true, status: 200, body: jettonBody({ total_supply: '0' }) }
        : defaultHandler(url),
    );
    await expect(
      new StakingService({ config: MAINNET, fetchImpl }).info({ network: 'mainnet' }),
    ).rejects.toMatchObject({ code: 'staking_unavailable' });
  });

  it('maps an upstream failure to staking_unavailable without leaking the body', async () => {
    const { fetchImpl } = mock(() => ({ ok: false, status: 500, body: { secret: 'x' } }));
    const error = await new StakingService({ config: MAINNET, fetchImpl })
      .info({ network: 'mainnet' })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(StakingError);
    expect((error as StakingError).code).toBe('staking_unavailable');
    expect(JSON.stringify(error)).not.toContain('secret');
  });
});

/** Wrap the pool response so only the implementation name differs. */
function mockOther(inner: FetchLike): FetchLike {
  return (url, init) => {
    const response = inner(url, init);
    if (!url.includes('/v2/staking/pool/')) return response;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          implementation: { name: 'SomeOtherPool' },
          pool: poolBody()['pool'],
        }),
    });
  };
}
