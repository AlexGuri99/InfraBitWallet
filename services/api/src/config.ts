/**
 * Server-only configuration for TON data providers.
 *
 * API keys belong to the API service (or Vercel environment variables), never to the Mini App:
 * the Mini App is a static bundle, so any `VITE_*` value is public. Nothing here logs, returns
 * or stringifies a key except into the outbound provider request header.
 *
 * Supported providers:
 * - toncenter: https://toncenter.com/api/v3 — sends the key in `X-API-Key`.
 * - tonapi:    https://tonapi.io — sends the key as `Authorization: Bearer …`.
 *
 * An empty or missing key is valid (public endpoints with lower rate limits); the caller decides
 * whether to require one.
 */
import { z } from 'zod';

export type TonDataProvider = 'toncenter' | 'tonapi';

export interface ServerConfig {
  provider: TonDataProvider;
  toncenterApiKey?: string | undefined;
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
  TONCENTER_API_KEY: optionalKey,
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
    TONCENTER_API_KEY: env['TONCENTER_API_KEY'],
    TONAPI_API_KEY: env['TONAPI_API_KEY'],
  });
  if (!parsed.success) return { ok: false, error: 'INVALID_SERVER_ENV' };
  return {
    ok: true,
    config: {
      provider: parsed.data.TON_DATA_PROVIDER ?? 'toncenter',
      toncenterApiKey: parsed.data.TONCENTER_API_KEY,
      tonapiApiKey: parsed.data.TONAPI_API_KEY,
    },
  };
}

/** Outbound headers for the selected provider, or an empty object when no key is configured. */
export function providerRequestHeaders(config: ServerConfig): Record<string, string> {
  if (config.provider === 'toncenter' && config.toncenterApiKey) {
    return { 'X-API-Key': config.toncenterApiKey };
  }
  if (config.provider === 'tonapi' && config.tonapiApiKey) {
    return { Authorization: `Bearer ${config.tonapiApiKey}` };
  }
  return {};
}

/** Base URL for the selected provider (no key in the URL, ever). */
export function providerBaseUrl(config: ServerConfig): string {
  return config.provider === 'tonapi' ? 'https://tonapi.io' : 'https://toncenter.com';
}
