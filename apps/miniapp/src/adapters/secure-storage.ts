/**
 * Telegram SecureStorage adapter (A9).
 *
 * Thin, injectable wrapper around Telegram.WebApp.SecureStorage so the vault core never depends
 * on Telegram. Source: https://core.telegram.org/bots/webapps (fetched 2026-11-21)
 * - SecureStorage is available since Bot API 9.0.
 * - Values are encrypted at rest: Keychain on iOS, Keystore on Android.
 * - At most 10 items per bot per user.
 * - getItem, when the key is absent, returns null plus a flag telling whether it can be
 *   restored from the current device. restoreItem asks the user and returns the value.
 *
 * We keep exactly ONE item here (the device secret), well within the 10-item budget.
 */
import type { StorageAdapter } from '@onezerowallet/crypto-vault';

type Callback = (error: string | null, value?: unknown) => void;

/** Callback-style API as documented by Telegram. */
export interface TelegramSecureStorageApi {
  setItem(key: string, value: string, callback?: Callback): void;
  getItem(key: string, callback: Callback): void;
  removeItem(key: string, callback?: Callback): void;
  clear(callback?: Callback): void;
  restoreItem?(key: string, callback: Callback): void;
}

export interface TelegramWebAppLike {
  version?: string;
  isVersionAtLeast?: (version: string) => boolean;
  SecureStorage?: TelegramSecureStorageApi;
}

export const SECURE_STORAGE_MIN_VERSION = '9.0';
/** Telegram's documented per-bot per-user limit. */
export const SECURE_STORAGE_ITEM_BUDGET = 10;
/** Item budget consumed by this wallet. */
export const SECURE_STORAGE_ITEMS_USED = ['device_secret'] as const;

function versionAtLeast(current: string, required: string): boolean {
  const a = current.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = required.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Feature-detect the object AND the Bot API version, never assuming either. */
export function isSecureStorageAvailable(webApp: TelegramWebAppLike | undefined): boolean {
  if (!webApp || !webApp.SecureStorage) return false;
  if (typeof webApp.isVersionAtLeast === 'function') {
    return webApp.isVersionAtLeast(SECURE_STORAGE_MIN_VERSION);
  }
  return (
    typeof webApp.version === 'string' && versionAtLeast(webApp.version, SECURE_STORAGE_MIN_VERSION)
  );
}

/** The SecureStorage API object, or null when unsupported. */
export function getSecureStorage(
  webApp: TelegramWebAppLike | undefined,
): TelegramSecureStorageApi | null {
  return isSecureStorageAvailable(webApp) ? (webApp?.SecureStorage ?? null) : null;
}

export interface SecureStorageAdapter extends StorageAdapter {
  /** Restore a key from another device (Telegram prompts the user). Null if unavailable/denied. */
  restore(key: string): Promise<string | null>;
  /** Whether restoreItem exists on this client. */
  readonly supportsRestore: boolean;
}

function settable(api: TelegramSecureStorageApi, key: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    api.setItem(key, value, (error) => {
      if (error) reject(new Error(`SECURE_STORAGE_SET_FAILED: ${error}`));
      else resolve();
    });
  });
}

function removable(api: TelegramSecureStorageApi, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    api.removeItem(key, (error) => {
      if (error) reject(new Error(`SECURE_STORAGE_REMOVE_FAILED: ${error}`));
      else resolve();
    });
  });
}

/**
 * Promisify the callback API. Async callbacks that throw are converted into rejections so a bad
 * client cannot hang the caller.
 */
export function createSecureStorageAdapter(api: TelegramSecureStorageApi): SecureStorageAdapter {
  const supportsRestore = typeof api.restoreItem === 'function';
  return {
    supportsRestore,
    get(key) {
      return new Promise<string | null>((resolve, reject) => {
        api.getItem(key, (error, value) => {
          if (error) reject(new Error(`SECURE_STORAGE_GET_FAILED: ${error}`));
          else resolve(typeof value === 'string' ? value : null);
        });
      });
    },
    set(key, value) {
      return settable(api, key, value);
    },
    delete(key) {
      return removable(api, key);
    },
    clear() {
      return new Promise((resolve, reject) => {
        api.clear((error) => {
          if (error) reject(new Error(`SECURE_STORAGE_CLEAR_FAILED: ${error}`));
          else resolve();
        });
      });
    },
    async restore(key) {
      if (!api.restoreItem) return null;
      return new Promise<string | null>((resolve) => {
        api.restoreItem?.(key, (error, value) => {
          // A denied restore surfaces as a non-null error; treat it as "not restored".
          if (error) resolve(null);
          else resolve(typeof value === 'string' ? value : null);
        });
      });
    },
  };
}
