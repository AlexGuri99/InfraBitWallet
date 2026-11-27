import { describe, it, expect, vi } from 'vitest';
import {
  collectableSwapFeeBps,
  isReferralConfigured,
  loadServerConfig,
  providerBaseUrl,
  providerRequestHeaders,
  stakingEnabledFor,
  swapEnabledFor,
  type ServerConfig,
} from './config.js';

const TON_ADDRESS = '0:debd442a01d7562dfa3f37c44d9d420e39aa2ef4f9f7a402ed1e3b9c0e389287';

describe('mainnet revenue startup warning', () => {
  it('warns once on mainnet without a usable referral address (no secrets in the message)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      loadServerConfig({ TON_NETWORK: 'mainnet', TONCENTER_API_KEY: 'secret-key-value' });
      loadServerConfig({ TON_NETWORK: 'mainnet' });
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0] ?? '');
      expect(message).toContain('STON_REFERRAL_ADDRESS');
      expect(message).not.toContain('secret-key-value');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('server config: TON provider keys', () => {
  it('defaults to testnet + toncenter with no key (public rate limits)', () => {
    const result = loadServerConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.provider).toBe('toncenter');
    expect(result.config.network).toBe('testnet');
    expect(providerRequestHeaders(result.config)).toEqual({});
    expect(providerBaseUrl(result.config)).toBe('https://testnet.toncenter.com');
  });

  it('uses TONCENTER_TESTNET_API_KEY on testnet and never the mainnet key', () => {
    const result = loadServerConfig({
      TONCENTER_TESTNET_API_KEY: 'testnet-key',
      TONCENTER_API_KEY: 'mainnet-key',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(providerRequestHeaders(result.config)).toEqual({ 'X-API-Key': 'testnet-key' });
    expect(providerRequestHeaders(result.config)).not.toHaveProperty('X-API-Key', 'mainnet-key');
    expect(providerBaseUrl(result.config)).not.toContain('testnet-key');
  });

  it('uses the mainnet key and base URL only when TON_NETWORK=mainnet', () => {
    const result = loadServerConfig({
      TON_NETWORK: 'mainnet',
      TONCENTER_API_KEY: 'mainnet-key',
      TONCENTER_TESTNET_API_KEY: 'testnet-key',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(providerRequestHeaders(result.config)).toEqual({ 'X-API-Key': 'mainnet-key' });
    expect(providerBaseUrl(result.config)).toBe('https://toncenter.com');
  });

  it('sends a TonAPI key as a Bearer header', () => {
    const result = loadServerConfig({
      TON_DATA_PROVIDER: 'tonapi',
      TONAPI_API_KEY: 'tonapi-key',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(providerRequestHeaders(result.config)).toEqual({
      Authorization: 'Bearer tonapi-key',
    });
    expect(providerBaseUrl(result.config)).toBe('https://testnet.tonapi.io');
  });

  it('ignores the key of the other provider', () => {
    const config: ServerConfig = {
      provider: 'tonapi',
      network: 'testnet',
      toncenterApiKey: 'unused',
      toncenterTestnetApiKey: 'unused',
      tonapiApiKey: undefined,
    };
    expect(providerRequestHeaders(config)).toEqual({});
  });

  it('treats empty or whitespace keys as not configured', () => {
    const result = loadServerConfig({ TONCENTER_TESTNET_API_KEY: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(providerRequestHeaders(result.config)).toEqual({});
  });

  it('rejects unknown provider/network values without echoing them', () => {
    for (const env of [
      { TON_DATA_PROVIDER: 'secret-provider-name' },
      { TON_NETWORK: 'secret-network-name' },
    ]) {
      const result = loadServerConfig(env);
      expect(result).toEqual({ ok: false, error: 'INVALID_SERVER_ENV' });
      expect(JSON.stringify(result)).not.toContain('secret-');
    }
  });
});

describe('mainnet swap revenue policy', () => {
  function configFor(env: Record<string, string>): ServerConfig {
    const result = loadServerConfig(env);
    if (!result.ok) throw new Error('config failed');
    return result.config;
  }

  it('collects 35 bps only on mainnet with a parsable referral address', () => {
    expect(
      collectableSwapFeeBps(
        configFor({ TON_NETWORK: 'mainnet', STON_REFERRAL_ADDRESS: TON_ADDRESS }),
      ),
    ).toBe(35);
    expect(
      isReferralConfigured(
        configFor({ TON_NETWORK: 'mainnet', STON_REFERRAL_ADDRESS: TON_ADDRESS }),
      ),
    ).toBe(true);

    // Unset or a typo must never look healthy.
    expect(collectableSwapFeeBps(configFor({ TON_NETWORK: 'mainnet' }))).toBe(0);
    expect(
      collectableSwapFeeBps(
        configFor({ TON_NETWORK: 'mainnet', STON_REFERRAL_ADDRESS: 'not-a-ton-address' }),
      ),
    ).toBe(0);
    // Testnet never reports a fee.
    expect(
      collectableSwapFeeBps(
        configFor({ TON_NETWORK: 'testnet', STON_REFERRAL_ADDRESS: TON_ADDRESS }),
      ),
    ).toBe(0);
  });

  it('reports swap/staking availability by network', () => {
    expect(swapEnabledFor(configFor({ TON_NETWORK: 'mainnet' }))).toBe(true);
    expect(swapEnabledFor(configFor({ TON_NETWORK: 'testnet' }))).toBe(false);
    expect(
      swapEnabledFor(
        configFor({ TON_NETWORK: 'testnet', STON_TESTNET_API_BASE_URL: 'https://ston.test' }),
      ),
    ).toBe(true);
    expect(stakingEnabledFor(configFor({ TON_NETWORK: 'mainnet' }))).toBe(true);
    expect(stakingEnabledFor(configFor({ TON_NETWORK: 'testnet' }))).toBe(false);
  });
});
