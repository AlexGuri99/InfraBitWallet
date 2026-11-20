/**
 * StorageAdapter interface — abstracts over Telegram SecureStorage, DeviceStorage,
 * IndexedDB, and in-memory (for tests).
 *
 * Never store a plain vault key or seed in any storage implementation.
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

/**
 * In-memory storage adapter for testing.
 * Never use in production.
 */
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
 * Storage keys used by the vault module.
 */
export const STORAGE_KEYS = {
  /** Passcode-wrapped vault key (ciphertext) stored in SecureStorage or IndexedDB */
  VAULT_KEY_WRAPPED: 'vault_key_wrapped',
  /** Device secret for passcode+device combined unlock */
  DEVICE_SECRET: 'device_secret',
  /** AES-GCM encrypted seed ciphertext stored in IndexedDB/DeviceStorage */
  SEED_CIPHERTEXT: 'seed_ciphertext',
  /** Vault version for parameter migration */
  VAULT_VERSION: 'vault_version',
  /** Persistent backoff counter */
  BACKOFF_COUNT: 'backoff_count',
  /** Persistent backoff window start (timestamp ms) */
  BACKOFF_WINDOW_START: 'backoff_window_start',
} as const;
