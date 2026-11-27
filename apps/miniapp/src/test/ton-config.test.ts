/**
 * `/api/ton/config` client: parses the server network and fails closed to testnet on any error.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTonConfig } from '../ton/config';
import { DEFAULT_TON_CONFIG } from '../ui/network';

const MAINNET = {
  network: 'mainnet',
  swapEnabled: true,
  stakingEnabled: true,
  swapFeeBps: 35,
  referralConfigured: true,
};

function stubFetch(handler: () => Promise<Response> | Response): void {
  vi.stubGlobal('fetch', vi.fn(handler));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchTonConfig', () => {
  it('returns the server-advertised mainnet configuration', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(MAINNET), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(fetchTonConfig()).resolves.toEqual(MAINNET);
  });

  it('falls back to testnet with swaps/staking disabled on HTTP errors', async () => {
    stubFetch(() => new Response('{"error":"server_misconfigured"}', { status: 500 }));
    await expect(fetchTonConfig()).resolves.toEqual(DEFAULT_TON_CONFIG);
  });

  it('falls back when the response is malformed or a different network', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ network: 'mainnet', swapEnabled: 'yes' }), {
          status: 200,
        }),
    );
    await expect(fetchTonConfig()).resolves.toEqual(DEFAULT_TON_CONFIG);
  });

  it('falls back when the request itself fails (offline)', async () => {
    stubFetch(() => Promise.reject(new Error('offline')));
    await expect(fetchTonConfig()).resolves.toEqual(DEFAULT_TON_CONFIG);
  });
});
