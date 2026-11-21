/**
 * Persistent unlock backoff (A8).
 *
 * - The delay is computed ONCE, when a failed attempt is recorded, and persisted as an absolute
 *   `nextAllowedAt` timestamp. A later call never re-rolls the random jitter, so the wait does
 *   not shrink or grow on its own.
 * - ONLY a wrong passcode counts as a failed attempt. `kdf_unavailable` and
 *   `device_secret_missing` are configuration problems, not guesses, and must not lock the user
 *   out.
 * - This protects against on-device UI guessing. It does NOT protect against an offline attack on
 *   a copied seal. Clock changes can bypass the UI delay (Date.now() is not monotonic); the seal
 *   itself is the real defence.
 */
import type { StorageAdapter } from './storage';
import { STORAGE_KEYS } from './storage';

export const MAX_BACKOFF_ATTEMPTS = 10;
export const BACKOFF_BASE_MS = 1000;

/** Runtime guard for JavaScript callers: storage is mandatory (fail closed). */
function requireStorage(storage: StorageAdapter | undefined | null): StorageAdapter {
  if (!storage) throw new Error('STORAGE_REQUIRED');
  return storage;
}

/**
 * Compute exponential backoff delay for a given attempt count.
 * Formula: base * 2^attempt + random(0, base)
 */
export function computeBackoffDelay(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  const clamped = Math.min(attemptCount, MAX_BACKOFF_ATTEMPTS);
  return BACKOFF_BASE_MS * Math.pow(2, clamped) + Math.floor(Math.random() * BACKOFF_BASE_MS);
}

/** Remaining wait in ms, from the persisted `nextAllowedAt`. 0 when not limited. */
export async function isBackoffActive(storage: StorageAdapter): Promise<number> {
  const s = requireStorage(storage);
  const nextStr = await s.get(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT);
  if (!nextStr) return 0;
  const nextAllowedAt = Number.parseInt(nextStr, 10);
  if (!Number.isFinite(nextAllowedAt)) return 0;
  const remaining = nextAllowedAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

export interface FailedAttemptInfo {
  count: number;
  retryAfterMs: number;
}

/** Record one failed passcode attempt and persist the wait window it opens. */
export async function recordFailedAttempt(storage: StorageAdapter): Promise<FailedAttemptInfo> {
  const s = requireStorage(storage);
  const countStr = await s.get(STORAGE_KEYS.BACKOFF_COUNT);
  const count = countStr ? Number.parseInt(countStr, 10) + 1 : 1;
  const retryAfterMs = computeBackoffDelay(count);
  await s.set(STORAGE_KEYS.BACKOFF_COUNT, String(count));
  await s.set(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT, String(Date.now() + retryAfterMs));
  return { count, retryAfterMs };
}

/** Reset backoff after a successful unlock (or a wipe). */
export async function resetBackoff(storage: StorageAdapter): Promise<void> {
  const s = requireStorage(storage);
  await s.delete(STORAGE_KEYS.BACKOFF_COUNT);
  await s.delete(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT);
}

/** Current consecutive failed-attempt count. */
export async function getBackoffCount(storage: StorageAdapter): Promise<number> {
  const s = requireStorage(storage);
  const countStr = await s.get(STORAGE_KEYS.BACKOFF_COUNT);
  return countStr ? Number.parseInt(countStr, 10) : 0;
}

/** Whether the persisted count has reached a wipe threshold. */
export async function isWipeThresholdReached(
  storage: StorageAdapter,
  maxFailures: number,
): Promise<boolean> {
  if (!Number.isFinite(maxFailures) || maxFailures <= 0) return false;
  return (await getBackoffCount(storage)) >= maxFailures;
}
