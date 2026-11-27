/**
 * Zero-dependency fixed-window rate limiting.
 *
 * The store is an interface so a distributed implementation (e.g. Upstash Redis) can be plugged
 * in later without touching the handlers. The in-memory store is per serverless instance: it
 * bounds bursts against one warm instance and is a cost/abuse guard, not a hard global quota.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Only meaningful when `allowed` is false: seconds until the window resets. */
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  hit(key: string, limit: number, windowMs: number, nowMs?: number): RateLimitResult;
}

interface Window {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 5_000;

/** In-memory fixed window keyed by caller + bucket. */
export function createInMemoryRateLimiter(): RateLimitStore {
  const windows = new Map<string, Window>();
  let lastSweep = 0;

  const sweep = (now: number): void => {
    if (now - lastSweep < 60_000 && windows.size <= MAX_KEYS) return;
    lastSweep = now;
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
    // A hostile cardinality spike must not grow memory without bound.
    while (windows.size > MAX_KEYS) {
      const oldest = windows.keys().next().value;
      if (oldest === undefined) break;
      windows.delete(oldest);
    }
  };

  return {
    hit(key, limit, windowMs, nowMs = Date.now()) {
      sweep(nowMs);
      const current = windows.get(key);
      if (!current || current.resetAt <= nowMs) {
        windows.set(key, { count: 1, resetAt: nowMs + windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - nowMs) / 1000)),
        };
      }
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

/** Process-wide store used by the handlers (swap the instance for tests). */
export const defaultRateLimiter: RateLimitStore = createInMemoryRateLimiter();

export const RATE_LIMITS = {
  read: { limit: 60, windowMs: 60_000 },
  heavy: { limit: 20, windowMs: 60_000 },
} as const;
