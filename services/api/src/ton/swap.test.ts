/** STON.fi swap proxy tests with a mocked upstream (no network, no keys). */
import { describe, it, expect } from 'vitest';
import { assertReferralFeeBps, minReceivedRaw, SWAP_FEE_BPS } from '@onezerowallet/swap-ton';
import { SwapError, SwapService } from './swap.js';
import type { FetchLike } from './http.js';
import type { ServerConfig } from '../config.js';

const USER = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';
const NATIVE = '0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const JETTON = '0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const JETTON_WALLET = '0:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const ROUTER = '0:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
const PTON_MASTER = '0:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const PTON_WALLET = '0:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const REFERRAL = '0:1111111111111111111111111111111111111111111111111111111111111111';

const CONFIG: ServerConfig = {
  provider: 'toncenter',
  network: 'testnet',
  stonTestnetApiBaseUrl: 'https://ston.test',
};

interface Call {
  url: string;
  method: string;
}

function simulated(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    offer_address: NATIVE,
    ask_address: JETTON,
    offer_jetton_wallet: PTON_WALLET,
    ask_jetton_wallet: JETTON_WALLET,
    router_address: ROUTER,
    router: {
      address: ROUTER,
      major_version: 2,
      minor_version: 1,
      pton_master_address: PTON_MASTER,
      pton_wallet_address: PTON_WALLET,
      pton_version: '2.1',
      router_type: 'ConstantProduct',
      pool_creation_enabled: true,
    },
    pool_address: '0:9999999999999999999999999999999999999999999999999999999999999999',
    offer_units: '1000000000',
    ask_units: '1319131',
    min_ask_units: '1305939',
    slippage_tolerance: '0.01',
    price_impact: 0.000063432,
    swap_rate: 1.319131,
    fee_units: '3500',
    gas_params: {
      gas_budget: '1310000000',
      forward_gas: '100000000',
      estimated_gas_consumption: '120000000',
    },
    ...overrides,
  };
}

function mock(
  handler: (url: string, method: string) => { ok: boolean; status: number; body: unknown },
) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const res = handler(url, init?.method ?? 'GET');
    return Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body),
    });
  };
  return { fetchImpl, calls };
}

const QUOTE_REQUEST = {
  network: 'testnet',
  offerAsset: NATIVE,
  askAsset: JETTON,
  offerKind: 'native' as const,
  askKind: 'jetton' as const,
  offerUnits: '1000000000',
  slippageBps: 100,
  userAddress: USER,
};

describe('fee cap (basis points)', () => {
  it('rejects values above 100 bps and pips-style 3500', () => {
    expect(SWAP_FEE_BPS).toBe(35);
    expect(() => assertReferralFeeBps(101)).toThrow(/OUT_OF_RANGE/);
    expect(() => assertReferralFeeBps(3500)).toThrow(/OUT_OF_RANGE/);
  });

  it('sends 35 bps only when a reviewed referral address is configured', async () => {
    const without = mock(() => ({ ok: true, status: 200, body: simulated() }));
    const quote = await new SwapService({ config: CONFIG, fetchImpl: without.fetchImpl }).quote(
      QUOTE_REQUEST,
    );
    expect(quote.feeBps).toBe(0);
    expect(quote.feeUnits).toBe('0');
    const simulateUrl = without.calls.find((call) => call.url.includes('/v1/swap/simulate'));
    expect(simulateUrl?.url).not.toContain('referral_fee_bps');
    expect(simulateUrl?.url).not.toContain('referral_address');

    const withReferral = mock(() => ({ ok: true, status: 200, body: simulated() }));
    const quoteWith = await new SwapService({
      config: { ...CONFIG, stonReferralAddress: REFERRAL },
      fetchImpl: withReferral.fetchImpl,
    }).quote(QUOTE_REQUEST);
    expect(quoteWith.feeBps).toBe(35);
    expect(quoteWith.feeUnits).toBe('3500');
    const url =
      withReferral.calls.find((call) => call.url.includes('/v1/swap/simulate'))?.url ?? '';
    expect(url).toContain('referral_fee_bps=35');
    expect(url).toContain(encodeURIComponent(REFERRAL));
  });
});

describe('slippage minimum', () => {
  it('takes the stricter of the provider minimum and our own slippage math', async () => {
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: simulated() }));
    const service = new SwapService({ config: CONFIG, fetchImpl });
    // 1%: provider 1305939 vs computed floor(1319131 * 0.99) = 1305939
    const onePercent = await service.quote(QUOTE_REQUEST);
    expect(onePercent.minReceivedRaw).toBe('1305939');
    // 3%: computed floor(1319131 * 0.97) = 1279557, stricter than the provider's 1% minimum
    const threePercent = await service.quote({ ...QUOTE_REQUEST, slippageBps: 300 });
    expect(threePercent.minReceivedRaw).toBe('1279557');
    expect(threePercent.minReceivedRaw).toBe(minReceivedRaw('1319131', 300));
  });
});

describe('quote normalization', () => {
  it('maps the snake_case simulation into the UI contract', async () => {
    const { fetchImpl } = mock(() => ({ ok: true, status: 200, body: simulated() }));
    const quote = await new SwapService({ config: CONFIG, fetchImpl }).quote(QUOTE_REQUEST);
    expect(quote).toMatchObject({
      network: 'testnet',
      direction: 'ton->jetton',
      offer: { address: NATIVE, units: '1000000000' },
      ask: { address: JETTON, units: '1319131', minUnits: '1305939' },
      priceImpact: 0.000063432,
      router: {
        address: ROUTER,
        majorVersion: 2,
        minorVersion: 1,
        routerType: 'ConstantProduct',
        ptonMasterAddress: PTON_MASTER,
        ptonWalletAddress: PTON_WALLET,
        ptonVersion: '2.1',
      },
      askJettonWalletAddress: JETTON_WALLET,
      gas: { gasBudget: '1310000000', forwardGas: '100000000' },
    });
  });

  it('derives jetton -> TON and jetton -> jetton directions', async () => {
    const { fetchImpl } = mock((url) => ({
      ok: true,
      status: 200,
      body: simulated(
        url.includes('ask_address=' + encodeURIComponent(PTON_MASTER))
          ? { offer_address: JETTON, ask_address: PTON_MASTER }
          : { offer_address: JETTON, ask_address: NATIVE },
      ),
    }));
    const service = new SwapService({ config: CONFIG, fetchImpl });
    const toTon = await service.quote({
      ...QUOTE_REQUEST,
      offerAsset: JETTON,
      askAsset: NATIVE,
      offerKind: 'jetton',
      askKind: 'native',
    });
    expect(toTon.direction).toBe('jetton->ton');
    const toJetton = await service.quote({
      ...QUOTE_REQUEST,
      offerAsset: JETTON,
      askAsset: JETTON_WALLET,
      offerKind: 'jetton',
      askKind: 'jetton',
      offerJettonWallet: JETTON_WALLET,
    });
    expect(toJetton.direction).toBe('jetton->jetton');
    expect(toJetton.offerJettonWalletAddress).toBe(JETTON_WALLET);
  });
});

describe('fail-closed behaviour', () => {
  it('rejects invalid requests before calling upstream', async () => {
    const { fetchImpl, calls } = mock(() => ({ ok: true, status: 200, body: simulated() }));
    const service = new SwapService({ config: CONFIG, fetchImpl });
    for (const bad of [
      { ...QUOTE_REQUEST, offerAsset: 'not-an-address' },
      { ...QUOTE_REQUEST, offerUnits: '0' },
      { ...QUOTE_REQUEST, offerUnits: '1.5' },
      { ...QUOTE_REQUEST, slippageBps: 501 },
      { ...QUOTE_REQUEST, slippageBps: 9 },
      { ...QUOTE_REQUEST, network: 'mainnet' },
      { ...QUOTE_REQUEST, askAsset: NATIVE, askKind: 'native' as const },
    ]) {
      await expect(service.quote(bad)).rejects.toBeInstanceOf(SwapError);
    }
    expect(calls.length).toBe(0);
  });

  it('fails closed on testnet until an endpoint is configured', async () => {
    const { fetchImpl, calls } = mock(() => ({ ok: true, status: 200, body: simulated() }));
    const service = new SwapService({
      config: { ...CONFIG, stonTestnetApiBaseUrl: undefined },
      fetchImpl,
    });
    await expect(service.quote(QUOTE_REQUEST)).rejects.toMatchObject({ code: 'swap_unavailable' });
    await expect(service.assets()).rejects.toMatchObject({ code: 'swap_unavailable' });
    expect(calls.length).toBe(0);
  });

  it('rejects non-v2 routes and routers outside the allowlist', async () => {
    const v1 = mock(() => ({
      ok: true,
      status: 200,
      body: simulated({ router: { ...(simulated()['router'] as object), major_version: 1 } }),
    }));
    await expect(
      new SwapService({ config: CONFIG, fetchImpl: v1.fetchImpl }).quote(QUOTE_REQUEST),
    ).rejects.toMatchObject({ code: 'unsupported_dex' });

    const allowlisted = mock(() => ({ ok: true, status: 200, body: simulated() }));
    await expect(
      new SwapService({
        config: { ...CONFIG, stonAllowedRouters: [USER] },
        fetchImpl: allowlisted.fetchImpl,
      }).quote(QUOTE_REQUEST),
    ).rejects.toMatchObject({ code: 'unsupported_dex' });
  });

  it('maps upstream errors and zero-liquidity to clean codes', async () => {
    const down = mock(() => ({ ok: false, status: 502, body: {} }));
    await expect(
      new SwapService({ config: CONFIG, fetchImpl: down.fetchImpl }).quote(QUOTE_REQUEST),
    ).rejects.toMatchObject({ code: 'swap_unavailable' });

    const zero = mock(() => ({
      ok: true,
      status: 200,
      body: simulated({ ask_units: '0', min_ask_units: '0' }),
    }));
    await expect(
      new SwapService({ config: CONFIG, fetchImpl: zero.fetchImpl }).quote(QUOTE_REQUEST),
    ).rejects.toMatchObject({ code: 'no_route' });
  });
});

describe('assets', () => {
  it('keeps swappable assets, drops blacklisted/deprecated ones and puts native first', async () => {
    const { fetchImpl } = mock(() => ({
      ok: true,
      status: 200,
      body: {
        asset_list: [
          {
            contract_address: JETTON,
            symbol: 'USDT',
            display_name: 'Tether USD',
            decimals: 6,
            kind: 'Jetton',
            blacklisted: false,
            deprecated: false,
            community: false,
            image_url: 'https://example.test/usdt.png',
          },
          {
            contract_address: NATIVE,
            symbol: 'GRAM',
            display_name: 'Gram',
            decimals: 9,
            kind: 'Ton',
            blacklisted: false,
            deprecated: false,
            community: false,
            image_url: null,
          },
          {
            contract_address: USER,
            symbol: 'SCAM',
            decimals: 9,
            kind: 'Jetton',
            blacklisted: true,
            deprecated: false,
            community: true,
          },
          {
            contract_address: REFERRAL,
            symbol: 'OLD',
            decimals: 9,
            kind: 'Jetton',
            blacklisted: false,
            deprecated: true,
            community: false,
          },
          { contract_address: PTON_MASTER, symbol: 'X', decimals: 9, kind: 'NotAnAsset' },
        ],
      },
    }));
    const assets = await new SwapService({ config: CONFIG, fetchImpl }).assets();
    expect(assets.map((asset) => asset.symbol)).toEqual(['GRAM', 'USDT']);
    expect(assets[0]).toMatchObject({ kind: 'native', id: 'native', decimals: 9 });
    expect(assets[1]).toMatchObject({
      kind: 'jetton',
      id: JETTON,
      verified: true,
      decimals: 6,
    });
  });
});
