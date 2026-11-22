import { describe, it, expect } from 'vitest';
import {
  loadServerConfig,
  providerBaseUrl,
  providerRequestHeaders,
  type ServerConfig,
} from './config';

describe('server config: TON provider keys', () => {
  it('defaults to toncenter with no key (public rate limits)', () => {
    const result = loadServerConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.provider).toBe('toncenter');
    expect(providerRequestHeaders(result.config)).toEqual({});
    expect(providerBaseUrl(result.config)).toBe('https://toncenter.com');
  });

  it('sends a TON Center key in X-API-Key, never in the URL', () => {
    const result = loadServerConfig({ TONCENTER_API_KEY: 'test-key-123' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(providerRequestHeaders(result.config)).toEqual({ 'X-API-Key': 'test-key-123' });
    expect(providerBaseUrl(result.config)).not.toContain('test-key-123');
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
    expect(providerBaseUrl(result.config)).toBe('https://tonapi.io');
  });

  it('ignores the other provider key', () => {
    const config: ServerConfig = {
      provider: 'tonapi',
      toncenterApiKey: 'unused',
      tonapiApiKey: undefined,
    };
    expect(providerRequestHeaders(config)).toEqual({});
  });

  it('treats empty or whitespace keys as not configured', () => {
    const result = loadServerConfig({ TONCENTER_API_KEY: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(providerRequestHeaders(result.config)).toEqual({});
  });

  it('rejects an unknown provider without echoing the value', () => {
    const result = loadServerConfig({ TON_DATA_PROVIDER: 'secret-provider-name' });
    expect(result).toEqual({ ok: false, error: 'INVALID_SERVER_ENV' });
    expect(JSON.stringify(result)).not.toContain('secret-provider-name');
  });
});
