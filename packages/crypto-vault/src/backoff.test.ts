/**
 * A8: persistent backoff, distinct rate-limit errors, non-counting configuration failures,
 * real wipe, mandatory storage, and the visibility listener lifecycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { argon2id } from 'hash-wasm';
import { createSeal, type VaultSeal } from './vault';
import { unlockSession, lockSession } from './session';
import { InMemoryStorage, STORAGE_KEYS } from './storage';
import {
  computeBackoffDelay,
  isBackoffActive,
  recordFailedAttempt,
  resetBackoff,
  getBackoffCount,
} from './backoff';
import { MNEMONIC_12_HARDHAT } from './fixtures/mnemonics';

vi.mock('hash-wasm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hash-wasm')>();
  return { ...actual, argon2id: vi.fn(actual.argon2id) };
});

const FAST = { argon2TimeCost: 2, argon2MemoryCost: 19456, argon2Parallelism: 1 };
const PASS = 'session passphrase 123';
const DEVICE_SECRET = new Uint8Array(32).fill(0x22);

let seal: VaultSeal;
beforeAll(async () => {
  seal = await createSeal(MNEMONIC_12_HARDHAT, PASS, undefined, FAST);
});
afterEach(() => {
  lockSession();
  vi.mocked(argon2id).mockClear();
  vi.unstubAllGlobals();
});

describe('A8: persisted nextAllowedAt', () => {
  it('records an absolute timestamp and reports the remaining wait', async () => {
    const storage = new InMemoryStorage();
    const { count, retryAfterMs } = await recordFailedAttempt(storage);
    expect(count).toBe(1);
    expect(retryAfterMs).toBeGreaterThan(0);
    const stored = Number.parseInt(
      (await storage.get(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT)) ?? '0',
    );
    expect(stored).toBeGreaterThan(Date.now());
    const remaining = await isBackoffActive(storage);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(retryAfterMs);
  });

  it('the window does not re-roll on repeated reads', async () => {
    const storage = new InMemoryStorage();
    await recordFailedAttempt(storage);
    const before = await storage.get(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT);
    await isBackoffActive(storage);
    await isBackoffActive(storage);
    expect(await storage.get(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT)).toBe(before);
  });

  it('resetBackoff clears the count and the timestamp', async () => {
    const storage = new InMemoryStorage();
    await recordFailedAttempt(storage);
    await resetBackoff(storage);
    expect(await storage.get(STORAGE_KEYS.BACKOFF_COUNT)).toBeNull();
    expect(await storage.get(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT)).toBeNull();
    expect(await isBackoffActive(storage)).toBe(0);
  });

  it('computeBackoffDelay stays exponential', () => {
    expect(computeBackoffDelay(0)).toBe(0);
    expect(computeBackoffDelay(1)).toBeGreaterThanOrEqual(2000);
    expect(computeBackoffDelay(10)).toBeGreaterThanOrEqual(512000);
  });
});

describe('A8: storage is mandatory (fail closed)', () => {
  it('backoff helpers throw without storage', async () => {
    const missing = undefined as unknown as InMemoryStorage;
    await expect(recordFailedAttempt(missing)).rejects.toThrow('STORAGE_REQUIRED');
    await expect(isBackoffActive(missing)).rejects.toThrow('STORAGE_REQUIRED');
  });

  it('unlockSession without storage refuses to unlock', async () => {
    const r = await unlockSession(seal, PASS, undefined);
    expect(r).toEqual({ success: false, error: 'storage_required' });
  });
});

describe('A8: rate limiting', () => {
  it('returns rate_limited with retryAfterMs, not wrong_passcode, and does not run Argon2', async () => {
    const storage = new InMemoryStorage();
    const first = await unlockSession(seal, 'wrong passphrase', storage);
    expect(first).toMatchObject({ success: false, error: 'wrong_passcode' });

    vi.mocked(argon2id).mockClear();
    const second = await unlockSession(seal, 'wrong passphrase', storage);
    expect(second.success).toBe(false);
    if (second.success) return;
    expect(second.error).toBe('rate_limited');
    expect(typeof second.retryAfterMs).toBe('number');
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(argon2id).not.toHaveBeenCalled();
  });

  it('a successful unlock resets the backoff', async () => {
    const storage = new InMemoryStorage();
    await unlockSession(seal, 'wrong passphrase', storage);
    await storage.set(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT, '0'); // let the wait elapse
    const ok = await unlockSession(seal, PASS, storage);
    expect(ok.success).toBe(true);
    expect(await getBackoffCount(storage)).toBe(0);
  });

  it('device_secret_missing is not counted as a failed attempt', async () => {
    const dsSeal = await createSeal(MNEMONIC_12_HARDHAT, PASS, DEVICE_SECRET, FAST);
    const storage = new InMemoryStorage();
    const r = await unlockSession(dsSeal, PASS, storage);
    expect(r).toEqual({ success: false, error: 'device_secret_missing' });
    expect(await getBackoffCount(storage)).toBe(0);
  });

  it('kdf_unavailable is not counted as a failed attempt', async () => {
    const storage = new InMemoryStorage();
    vi.mocked(argon2id).mockImplementationOnce(() => Promise.reject(new Error('wasm unavailable')));
    const r = await unlockSession(seal, PASS, storage);
    expect(r).toEqual({ success: false, error: 'kdf_unavailable' });
    expect(await getBackoffCount(storage)).toBe(0);
  });
});

/** Move the persisted wait window into the past without touching the attempt count. */
async function expireBackoff(storage: InMemoryStorage): Promise<void> {
  await storage.set(STORAGE_KEYS.BACKOFF_NEXT_ALLOWED_AT, '0');
}

describe('A8: wipe threshold', () => {
  it('is disabled by default: repeated wrong attempts never delete the seal', async () => {
    const storage = new InMemoryStorage();
    await storage.set(STORAGE_KEYS.SEAL, 'stored-seal');
    for (let i = 0; i < 3; i++) {
      await unlockSession(seal, 'wrong passphrase', storage);
      await expireBackoff(storage);
    }
    expect(await getBackoffCount(storage)).toBe(3);
    expect(await storage.get(STORAGE_KEYS.SEAL)).toBe('stored-seal');
  });

  it('deletes the seal and device secret and returns wiped when reached', async () => {
    const storage = new InMemoryStorage();
    await storage.set(STORAGE_KEYS.SEAL, 'stored-seal');
    await storage.set(STORAGE_KEYS.DEVICE_SECRET, 'ab'.repeat(32));
    const opts = { wipeAfterFailures: 2 };

    const one = await unlockSession(seal, 'wrong passphrase', storage, opts);
    expect(one).toMatchObject({ success: false, error: 'wrong_passcode' });
    await expireBackoff(storage);

    const two = await unlockSession(seal, 'wrong passphrase', storage, opts);
    expect(two).toEqual({ success: false, error: 'wiped' });
    expect(await storage.get(STORAGE_KEYS.SEAL)).toBeNull();
    expect(await storage.get(STORAGE_KEYS.DEVICE_SECRET)).toBeNull();
    expect(await getBackoffCount(storage)).toBe(0);
  });

  it('after a wipe, unlocking fails because the stored seal is gone', async () => {
    const storage = new InMemoryStorage();
    await storage.set(STORAGE_KEYS.SEAL, 'stored-seal');
    const opts = { wipeAfterFailures: 1 };
    expect(await unlockSession(seal, 'wrong passphrase', storage, opts)).toEqual({
      success: false,
      error: 'wiped',
    });
    expect(await storage.get(STORAGE_KEYS.SEAL)).toBeNull();
  });
});

describe('A8: visibility listener lifecycle', () => {
  let added: number;
  let removed: number;
  beforeEach(() => {
    added = 0;
    removed = 0;
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: () => {
        added += 1;
      },
      removeEventListener: () => {
        removed += 1;
      },
    });
  });

  it('registers once, replaces on re-unlock, and removes on lock', async () => {
    const storage = new InMemoryStorage();
    await unlockSession(seal, PASS, storage);
    expect(added).toBe(1);
    await unlockSession(seal, PASS, storage);
    // The second unlock locks the first session (remove) and adds its own listener (add).
    expect(added).toBe(2);
    expect(removed).toBe(1);
    lockSession();
    expect(removed).toBe(2);
  });
});
