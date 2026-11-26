/**
 * A9: IndexedDBAdapter against fake-indexeddb (test-only; no browser needed).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBAdapter } from './indexeddb';

let dbCounter = 0;
function freshAdapter(): IndexedDBAdapter {
  dbCounter += 1;
  // fake-indexeddb/auto (imported below) installs a global IDBFactory.
  return new IndexedDBAdapter({ dbName: `infrabit-test-${String(dbCounter)}`, storeName: 'kv' });
}

describe('A9: IndexedDBAdapter', () => {
  let adapter: IndexedDBAdapter;
  beforeEach(() => {
    adapter = freshAdapter();
  });

  it('returns null for a missing key', async () => {
    expect(await adapter.get('nope')).toBeNull();
  });

  it('sets, gets, overwrites and deletes a value', async () => {
    await adapter.set('k', 'v1');
    expect(await adapter.get('k')).toBe('v1');
    await adapter.set('k', 'v2');
    expect(await adapter.get('k')).toBe('v2');
    await adapter.delete('k');
    expect(await adapter.get('k')).toBeNull();
  });

  it('clears every entry', async () => {
    await adapter.set('a', '1');
    await adapter.set('b', '2');
    await adapter.clear();
    expect(await adapter.get('a')).toBeNull();
    expect(await adapter.get('b')).toBeNull();
  });

  it('persists across adapter instances that share a database', async () => {
    const dbName = `infrabit-shared-${String(dbCounter)}`;
    const a = new IndexedDBAdapter({ dbName });
    const b = new IndexedDBAdapter({ dbName });
    await a.set('k', 'value');
    expect(await b.get('k')).toBe('value');
  });

  it('throws when no IDBFactory is available', () => {
    const saved = (globalThis as Record<string, unknown>)['indexedDB'];
    (globalThis as Record<string, unknown>)['indexedDB'] = undefined;
    try {
      expect(() => new IndexedDBAdapter()).toThrow('INDEXEDDB_UNAVAILABLE');
    } finally {
      (globalThis as Record<string, unknown>)['indexedDB'] = saved;
    }
  });
});
