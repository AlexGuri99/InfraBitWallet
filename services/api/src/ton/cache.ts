/**
 * Process-local TTL cache with in-flight de-duplication. Vercel may run several instances, so
 * this is a rate-limit/cost optimisation, not a correctness guarantee.
 */
interface Entry {
  expiresAt: number;
  value: unknown;
}

const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

export const TTL = {
  portfolioMs: 30_000,
  activityMs: 30_000,
  priceMs: 60_000,
  jettonMetaMs: 5 * 60_000,
} as const;

export async function cached<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now()) return hit.value as T;
  const running = inFlight.get(key);
  if (running) return running as Promise<T>;
  const promise = load()
    .then((value) => {
      entries.set(key, { expiresAt: now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/** Test helper: clear all cached state. */
export function clearCache(): void {
  entries.clear();
  inFlight.clear();
}
