/**
 * Shared request guard for the `/api/ton/*` handlers: Telegram `initData` authentication
 * (when `REQUIRE_TELEGRAM_AUTH=true`) and per-caller rate limiting.
 *
 * Auth is optional so testnet/preview/E2E keep working; the switch lives in server env and the
 * client always sends the header when it has one. Rate limits are per caller: the verified
 * Telegram user id when authenticated, otherwise the client IP (`x-forwarded-for`).
 */
import type { ServerConfig } from './config.js';
import { defaultRateLimiter, RATE_LIMITS, type RateLimitStore } from './rate-limit.js';
import { verifyTelegramInitData } from './telegram/auth.js';

export type GuardKind = 'read' | 'heavy';

export interface GuardRequest {
  headers?: Record<string, string | string[] | undefined> | undefined;
}

export interface GuardResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export type GuardResult = { ok: true; caller: string } | { ok: false };

export const INIT_DATA_HEADER = 'x-telegram-init-data';

function headerValue(req: GuardRequest, name: string): string | undefined {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

/** First hop in `x-forwarded-for`, falling back to an anonymous bucket. */
export function clientIp(req: GuardRequest): string {
  const forwarded = headerValue(req, 'x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = headerValue(req, 'x-real-ip');
  return real ?? 'unknown';
}

function sendError(
  res: GuardResponse,
  status: number,
  error: string,
  headers: Record<string, string> = {},
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify({ error }));
}

export interface GuardOptions {
  /** `/api/ton/config` must stay readable outside Telegram. */
  skipAuth?: boolean | undefined;
  /** Injectable store for tests. */
  limiter?: RateLimitStore | undefined;
  nowMs?: number | undefined;
}

/**
 * Applies authentication and rate limiting. Returns `{ ok: false }` after writing the response,
 * so handlers can `return` immediately.
 */
export function guardTonRequest(
  req: GuardRequest,
  res: GuardResponse,
  config: ServerConfig,
  kind: GuardKind,
  options: GuardOptions = {},
): GuardResult {
  let caller = `ip:${clientIp(req)}`;

  if (config.requireTelegramAuth && options.skipAuth !== true) {
    const token = config.telegramBotToken;
    if (!token) {
      // loadServerConfig already fails closed; defence in depth.
      sendError(res, 500, 'server_misconfigured');
      return { ok: false };
    }
    const verified = verifyTelegramInitData(
      headerValue(req, INIT_DATA_HEADER) ?? null,
      token,
      options.nowMs,
    );
    if (!verified.ok) {
      sendError(res, 401, 'unauthorized');
      return { ok: false };
    }
    caller = verified.userId === null ? caller : `user:${String(verified.userId)}`;
  }

  const limiter = options.limiter ?? defaultRateLimiter;
  const limit = RATE_LIMITS[kind];
  const result = limiter.hit(`${caller}:${kind}`, limit.limit, limit.windowMs, options.nowMs);
  if (!result.allowed) {
    sendError(res, 429, 'rate_limited', {
      'retry-after': String(result.retryAfterSeconds),
    });
    return { ok: false };
  }
  return { ok: true, caller };
}
