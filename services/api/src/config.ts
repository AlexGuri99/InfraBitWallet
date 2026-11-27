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
import { normalizeTonAddress } from './ton/validation.js';

export type TonDataProvider = 'toncenter' | 'tonapi';
export type TonNetwork = 'mainnet' | 'testnet';

export interface ServerConfig {
  provider: TonDataProvider;
  network: TonNetwork;
  toncenterApiKey?: string | undefined;
  toncenterTestnetApiKey?: string | undefined;
  tonapiApiKey?: string | undefined;
  /**
   * STON.fi REST base URL (mainnet). `api.ston.fi` serves mainnet data only (docs.ston.fi
   * "Setup and environments"), so testnet quotes require an operator-provided endpoint.
   */
  stonApiBaseUrl?: string | undefined;
  stonTestnetApiBaseUrl?: string | undefined;
  /** Reviewed fee-recipient for the 35 bps referral fee; omitted = no fee is collected. */
  stonReferralAddress?: string | undefined;
  /** Optional signed-off router allowlist; when set, quotes from other routers are rejected. */
  stonAllowedRouters?: string[] | undefined;
  /** Require a valid Telegram `initData` HMAC on provider-backed routes (mainnet). */
  requireTelegramAuth: boolean;
  /** Bot token used only to verify `initData`; never logged or returned. */
  telegramBotToken?: string | undefined;
}

/** Documented mainnet REST API base URL (docs.ston.fi / api.ston.fi). */
export const STON_MAINNET_API_URL = 'https://api.ston.fi' as const;

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
  STON_API_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().pipe(z.url()).optional(),
  ),
  STON_TESTNET_API_BASE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().pipe(z.url()).optional(),
  ),
  STON_REFERRAL_ADDRESS: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).max(100).optional(),
  ),
  STON_ALLOWED_ROUTERS: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().optional(),
  ),
  REQUIRE_TELEGRAM_AUTH: z
    .preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.enum(['true', 'false']).optional(),
    )
    .transform((value) => value === 'true'),
  TELEGRAM_BOT_TOKEN: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
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
    STON_API_BASE_URL: env['STON_API_BASE_URL'],
    STON_TESTNET_API_BASE_URL: env['STON_TESTNET_API_BASE_URL'],
    STON_REFERRAL_ADDRESS: env['STON_REFERRAL_ADDRESS'],
    STON_ALLOWED_ROUTERS: env['STON_ALLOWED_ROUTERS'],
    REQUIRE_TELEGRAM_AUTH: env['REQUIRE_TELEGRAM_AUTH'],
    TELEGRAM_BOT_TOKEN: env['TELEGRAM_BOT_TOKEN'],
  });
  if (!parsed.success) return { ok: false, error: 'INVALID_SERVER_ENV' };
  const routers = parsed.data.STON_ALLOWED_ROUTERS?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const config: ServerConfig = {
    provider: parsed.data.TON_DATA_PROVIDER ?? 'toncenter',
    network: parsed.data.TON_NETWORK ?? 'testnet',
    toncenterApiKey: parsed.data.TONCENTER_API_KEY,
    toncenterTestnetApiKey: parsed.data.TONCENTER_TESTNET_API_KEY,
    tonapiApiKey: parsed.data.TONAPI_API_KEY,
    stonApiBaseUrl: parsed.data.STON_API_BASE_URL,
    stonTestnetApiBaseUrl: parsed.data.STON_TESTNET_API_BASE_URL,
    stonReferralAddress: parsed.data.STON_REFERRAL_ADDRESS,
    ...(routers && routers.length > 0 ? { stonAllowedRouters: routers } : {}),
    requireTelegramAuth: parsed.data.REQUIRE_TELEGRAM_AUTH,
    ...(parsed.data.TELEGRAM_BOT_TOKEN ? { telegramBotToken: parsed.data.TELEGRAM_BOT_TOKEN } : {}),
  };
  // Fail closed: demanding auth without a token would reject every request anyway, so refuse to
  // start with a clear (secret-free) error instead.
  if (config.requireTelegramAuth && !config.telegramBotToken) {
    return { ok: false, error: 'INVALID_SERVER_ENV' };
  }
  warnOnMissingMainnetReferral(config);
  return { ok: true, config };
}

/** Policy fee in basis points (0.35%), mirroring `SWAP_FEE_BPS` in `@onezerowallet/swap-ton`. */
export const POLICY_SWAP_FEE_BPS = 35 as const;

/** True when a reviewed, parsable referral address is configured (never exposed raw to the client). */
export function isReferralConfigured(config: ServerConfig): boolean {
  return normalizeTonAddress(config.stonReferralAddress) !== null;
}

/**
 * Fee actually collectable: the policy fee only on mainnet with a valid referral address, else 0.
 * An invalid address is treated as "not configured" so a typo can never silently look healthy.
 */
export function collectableSwapFeeBps(config: ServerConfig): number {
  return config.network === 'mainnet' && isReferralConfigured(config) ? POLICY_SWAP_FEE_BPS : 0;
}

/** TON swaps are served on mainnet (STON REST) or on testnet only with an operator endpoint. */
export function swapEnabledFor(config: ServerConfig): boolean {
  return config.network === 'mainnet' || config.stonTestnetApiBaseUrl !== undefined;
}

/** Tonstakers metrics exist on mainnet only; testnet staking fails closed. */
export function stakingEnabledFor(config: ServerConfig): boolean {
  return config.network === 'mainnet';
}

let warnedMissingReferral = false;

/**
 * Startup warning (once per process) so mainnet can never run with silently zero swap revenue.
 * The message never contains an address or a key.
 */
function warnOnMissingMainnetReferral(config: ServerConfig): void {
  if (warnedMissingReferral) return;
  if (config.network !== 'mainnet') return;
  if (isReferralConfigured(config)) return;
  warnedMissingReferral = true;
  console.warn(
    '[api] TON_NETWORK=mainnet but STON_REFERRAL_ADDRESS is unset or not a valid TON address: ' +
      'swap revenue is disabled (swapFeeBps=0). Set a reviewed treasury address and redeploy.',
  );
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
