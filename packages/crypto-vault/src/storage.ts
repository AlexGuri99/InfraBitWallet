/**
 * StorageAdapter interface — abstracts over Telegram SecureStorage, IndexedDB and in-memory
 * (for tests).
 *
 * Never store a plain vault key or seed in any storage implementation. Only the sealed vault
 * envelope (ciphertext) and the device secret may be persisted; the device secret belongs in
 * the secure adapter (Telegram SecureStorage: Keychain on iOS, Keystore on Android —
 * https://core.telegram.org/bots/webapps, SecureStorage, Bot API 9.0).
 */
export interface StorageAdapter {
  /** Retrieve a value by key. Returns null if not found. */
  get(key: string): Promise<string | null>;
  /** Store a value. Overwrites if key exists. */
  set(key: string, value: string): Promise<void>;
  /** Remove a key. No-op if key doesn't exist. */
  delete(key: string): Promise<void>;
  /** Clear all entries. */
  clear(): Promise<void>;
}

/** In-memory storage adapter for testing. Never use in production. */
export class InMemoryStorage implements StorageAdapter {
  private store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }
}

/**
 * Routes a subset of keys to a secure adapter and everything else to a bulk adapter.
 * Used by VaultManager: the device secret lives in SecureStorage, the seal ciphertext in
 * IndexedDB, and the unlock backoff state in the same bulk store as the seal.
 */
export class CompositeStorage implements StorageAdapter {
  private readonly secure: StorageAdapter;
  private readonly bulk: StorageAdapter;
  private readonly secureKeys: ReadonlySet<string>;

  constructor(secure: StorageAdapter, bulk: StorageAdapter, secureKeys: readonly string[]) {
    this.secure = secure;
    this.bulk = bulk;
    this.secureKeys = new Set(secureKeys);
  }

  private route(key: string): StorageAdapter {
    return this.secureKeys.has(key) ? this.secure : this.bulk;
  }

  get(key: string): Promise<string | null> {
    return this.route(key).get(key);
  }

  set(key: string, value: string): Promise<void> {
    return this.route(key).set(key, value);
  }

  delete(key: string): Promise<void> {
    return this.route(key).delete(key);
  }

  async clear(): Promise<void> {
    await this.secure.clear();
    await this.bulk.clear();
  }
}

/**
 * Storage keys used by the vault module. Deliberately small: every additional persisted value is
 * an additional thing to validate and wipe.
 */
export const STORAGE_KEYS = {
  /** Sealed vault envelope (ciphertext) in IndexedDB/DeviceStorage. Legacy single-wallet slot; */
  /** migrated into WALLETS on first read. */
  SEAL: 'vault_seal',
  /** Wallet set: labels + one sealed envelope per wallet (ciphertext only, no key material). */
  WALLETS: 'vault_wallets',
  /** Device secret (32 bytes, 64 hex chars) in the secure adapter only. */
  DEVICE_SECRET: 'device_secret',
  /** Consecutive failed passcode attempts. */
  BACKOFF_COUNT: 'backoff_count',
  /** Absolute timestamp (ms) before which unlock is refused. */
  BACKOFF_NEXT_ALLOWED_AT: 'backoff_next_allowed_at',
} as const;
