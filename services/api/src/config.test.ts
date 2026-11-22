import { describe, it, expect } from 'vitest';
import {
  loadServerConfig,
  providerBaseUrl,
  providerRequestHeaders,
  type ServerConfig,
} from './config';

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
