/**
 * Telegram WebApp `initData` verification (official Mini Apps spec).
 *
 * - `secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)`
 * - `data_check_string` = every `key=value` pair except `hash`, sorted by key, joined with `\n`
 * - signature = hex HMAC_SHA256(data_check_string, secret_key), compared constant-time
 * - `auth_date` must be younger than 24 h and not more than 5 min in the future
 *
 * Sources: https://core.telegram.org/bots/webapps ("Validating data received via the Mini App"),
 * Node `crypto` (HMAC-SHA-256, `timingSafeEqual`).
 *
 * The bot token and the raw header are never logged, returned or included in an error message.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
export const MAX_FUTURE_SKEW_SECONDS = 5 * 60;

export type InitDataFailure = 'missing' | 'malformed' | 'bad_hash' | 'expired';

export type InitDataResult =
  { ok: true; userId: number | null; authDate: number } | { ok: false; error: InitDataFailure };

function hmacHex(key: string, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

/** Constant-time comparison of two hex digests; length mismatch fails without leaking timing. */
function safeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Parse the `user` JSON blob, returning a numeric id or null (never throws). */
function readUserId(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const id = (parsed as { id?: unknown }).id;
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return id;
    }
  } catch {
    // Malformed user JSON is not fatal: the hash already proved authenticity.
  }
  return null;
}

export function verifyTelegramInitData(
  initData: string | null | undefined,
  botToken: string,
  nowMs: number = Date.now(),
): InitDataResult {
  if (typeof initData !== 'string' || initData.trim() === '') {
    return { ok: false, error: 'missing' };
  }
  if (initData.length > 8192) return { ok: false, error: 'malformed' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'malformed' };

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  if (pairs.length === 0) return { ok: false, error: 'malformed' };
  pairs.sort();

  const secretKey = hmacHex('WebAppData', botToken);
  const expected = hmacHex(secretKey, pairs.join('\n'));
  if (!safeEqualHex(expected, hash)) return { ok: false, error: 'bad_hash' };

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw === null ? NaN : Number.parseInt(authDateRaw, 10);
  if (!Number.isFinite(authDate)) return { ok: false, error: 'malformed' };

  const nowSeconds = Math.floor(nowMs / 1000);
  if (authDate > nowSeconds + MAX_FUTURE_SKEW_SECONDS) return { ok: false, error: 'expired' };
  if (nowSeconds - authDate > MAX_AUTH_AGE_SECONDS) return { ok: false, error: 'expired' };

  return { ok: true, userId: readUserId(params.get('user')), authDate };
}
