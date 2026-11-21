/**
 * A9: Telegram SecureStorage adapter — feature detection, callback API, restore semantics.
 */
import { describe, it, expect } from 'vitest';
import {
  createSecureStorageAdapter,
  getSecureStorage,
  isSecureStorageAvailable,
  SECURE_STORAGE_ITEM_BUDGET,
  SECURE_STORAGE_ITEMS_USED,
  type TelegramSecureStorageApi,
  type TelegramWebAppLike,
} from './secure-storage';

function fakeApi(options: { denyRestore?: boolean } = {}): {
  api: TelegramSecureStorageApi;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    api: {
      setItem(key, val, cb) {
        map.set(key, val);
        cb?.(null, true);
      },
      getItem(key, cb) {
        cb(null, map.get(key) ?? null);
      },
      removeItem(key, cb) {
        map.delete(key);
        cb?.(null, true);
      },
      clear(cb) {
        map.clear();
        cb?.(null, true);
      },
      restoreItem(key, cb) {
        if (options.denyRestore) cb('RESTORE_DENIED');
        else cb(null, map.get(key) ?? 'restored-value');
      },
    },
  };
}

describe('A9: SecureStorage feature detection', () => {
  it('is unavailable without the object or before Bot API 9.0', () => {
    expect(isSecureStorageAvailable(undefined)).toBe(false);
    expect(isSecureStorageAvailable({ version: '9.0' })).toBe(false);
    const obj = fakeApi().api;
    expect(isSecureStorageAvailable({ version: '8.9', SecureStorage: obj })).toBe(false);
  });

  it('is available at 9.0+ and honours isVersionAtLeast when present', () => {
    const obj = fakeApi().api;
    expect(isSecureStorageAvailable({ version: '9.0', SecureStorage: obj })).toBe(true);
    expect(isSecureStorageAvailable({ version: '10.2', SecureStorage: obj })).toBe(true);
    const webApp: TelegramWebAppLike = {
      SecureStorage: obj,
      isVersionAtLeast: (v) => v === '9.0',
    };
    expect(isSecureStorageAvailable(webApp)).toBe(true);
    expect(getSecureStorage(webApp)).toBe(obj);
    expect(getSecureStorage({ version: '8.0' })).toBeNull();
  });

  it('declares a one-item footprint within the 10-item budget', () => {
    expect(SECURE_STORAGE_ITEM_BUDGET).toBe(10);
    expect(SECURE_STORAGE_ITEMS_USED).toEqual(['device_secret']);
  });
});

describe('A9: SecureStorage adapter over the callback API', () => {
  it('round trips set/get/delete/clear', async () => {
    const { api } = fakeApi();
    const adapter = createSecureStorageAdapter(api);
    expect(await adapter.get('k')).toBeNull();
    await adapter.set('k', 'v');
    expect(await adapter.get('k')).toBe('v');
    await adapter.delete('k');
    expect(await adapter.get('k')).toBeNull();
    await adapter.set('a', '1');
    await adapter.clear();
    expect(await adapter.get('a')).toBeNull();
  });

  it('rejects when the client reports an error', async () => {
    const api = fakeApi().api;
    api.getItem = (_k, cb) => {
      cb('GET_FAILED');
    };
    const adapter = createSecureStorageAdapter(api);
    await expect(adapter.get('k')).rejects.toThrow('SECURE_STORAGE_GET_FAILED');
  });

  it('returns null for a key that is absent (restore is a separate, prompted call)', async () => {
    const { api } = fakeApi();
    const adapter = createSecureStorageAdapter(api);
    expect(await adapter.get('missing')).toBeNull();
  });

  it('restore returns the value, or null when denied or unsupported', async () => {
    const a = fakeApi();
    a.api.setItem('k', 'v', () => {});
    expect(await createSecureStorageAdapter(a.api).restore('k')).toBe('v');

    const denied = fakeApi({ denyRestore: true });
    expect(await createSecureStorageAdapter(denied.api).restore('k')).toBeNull();

    const noRestore: TelegramSecureStorageApi = {
      setItem: () => {},
      getItem: (_k, cb) => {
        cb(null, null);
      },
      removeItem: () => {},
      clear: () => {},
    };
    const adapter = createSecureStorageAdapter(noRestore);
    expect(adapter.supportsRestore).toBe(false);
    expect(await adapter.restore('k')).toBeNull();
  });
});
