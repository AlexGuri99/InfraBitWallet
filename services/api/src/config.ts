/**
 * Server-only configuration for TON data providers.
 *
 * API keys belong to the API service (or Vercel environment variables), never to the Mini App:
 * the Mini App is a static bundle, so any `VITE_*` value is public. Nothing here logs, returns
 * or stringifies a key except into the outbound provider request header.
 *
 * Supported providers:
 * - toncenter: https://toncenter.com/api/v3 (mainnet) and https://testnet.toncenter.com/api/v3
 *   (testnet, confirmed on toncenter.com). Key is sent as `X-API-Key`; the exact header name is
 *   marked UNVERIFIED in docs/UNVERIFIED.md and must be confirmed at first live call.
 * - tonapi:    https://tonapi.io — sends the key as `Authorization: Bearer …`. TonAPI testnet is
 *   not documented for this integration.
 *
 * Network defaults to testnet: mainnet is gated behind an explicit TON_NETWORK=mainnet and the
 * owner's sign-off (CLAUDE.md "stop and ask"). Missing/empty keys are valid (public rate limits).
 */
import { z } from 'zod';

export type TonDataProvider = 'toncenter' | 'tonapi';
export type TonNetwork = 'mainnet' | 'testnet';

export interface ServerConfig {
  provider: TonDataProvider;
  network: TonNetwork;
  toncenterApiKey?: string | undefined;
  toncenterTestnetApiKey?: string | undefined;
  tonapiApiKey?: string | undefined;
}

export type ConfigResult =
  { ok: true; config: ServerConfig } | { ok: false; error: 'INVALID_SERVER_ENV' };

/** Empty strings are treated as "not configured" rather than as a key. */
const optionalKey = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const envSchema = z.object({
  TON_DATA_PROVIDER: z.enum(['toncenter', 'tonapi']).optional(),
  TON_NETWORK: z.enum(['mainnet', 'testnet']).optional(),
  TONCENTER_API_KEY: optionalKey,
  TONCENTER_TESTNET_API_KEY: optionalKey,
  TONAPI_API_KEY: optionalKey,
});

/**
 * Build the server config from an environment object. Errors are deliberately generic and never
 * include values, so a malformed secret cannot leak through an error message or log.
 */
export function loadServerConfig(
  env: Record<string, string | undefined> = process.env,
): ConfigResult {
  const parsed = envSchema.safeParse({
    TON_DATA_PROVIDER: env['TON_DATA_PROVIDER'],
    TON_NETWORK: env['TON_NETWORK'],
    TONCENTER_API_KEY: env['TONCENTER_API_KEY'],
    TONCENTER_TESTNET_API_KEY: env['TONCENTER_TESTNET_API_KEY'],
    TONAPI_API_KEY: env['TONAPI_API_KEY'],
  });
  if (!parsed.success) return { ok: false, error: 'INVALID_SERVER_ENV' };
  return {
    ok: true,
    config: {
      provider: parsed.data.TON_DATA_PROVIDER ?? 'toncenter',
      network: parsed.data.TON_NETWORK ?? 'testnet',
      toncenterApiKey: parsed.data.TONCENTER_API_KEY,
      toncenterTestnetApiKey: parsed.data.TONCENTER_TESTNET_API_KEY,
      tonapiApiKey: parsed.data.TONAPI_API_KEY,
    },
  };
}

/** The TON Center key for the configured network, if any. */
function toncenterKey(config: ServerConfig): string | undefined {
  return config.network === 'testnet' ? config.toncenterTestnetApiKey : config.toncenterApiKey;
}

/** Outbound headers for the selected provider, or an empty object when no key is configured. */
export function providerRequestHeaders(config: ServerConfig): Record<string, string> {
  if (config.provider === 'toncenter') {
    const key = toncenterKey(config);
    return key ? { 'X-API-Key': key } : {};
  }
  // The provider is narrowed to 'tonapi' here.
  if (config.tonapiApiKey) {
    return { Authorization: `Bearer ${config.tonapiApiKey}` };
  }
  return {};
}

/** Base URL for the selected provider and network (no key in the URL, ever). */
export function providerBaseUrl(config: ServerConfig): string {
  if (config.provider === 'tonapi') {
    return config.network === 'testnet' ? 'https://testnet.tonapi.io' : 'https://tonapi.io';
  }
  return config.network === 'testnet' ? 'https://testnet.toncenter.com' : 'https://toncenter.com';
}
