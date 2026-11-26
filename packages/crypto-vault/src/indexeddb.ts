/**
 * IndexedDB storage adapter (A9).
 *
 * Holds ONLY the sealed vault envelope and non-secret state (backoff). It must never receive the
 * device secret: create a CompositeStorage that routes DEVICE_SECRET to the secure adapter.
 *
 * The IDBFactory is injectable so tests can use fake-indexeddb (or a hand-written fake) without
 * a browser.
 */
import type { StorageAdapter } from './storage';

export interface IndexedDbAdapterOptions {
  /** Database name. One wallet per origin, so this need not be user-specific. */
  dbName?: string;
  /** Object store name inside the database. */
  storeName?: string;
  /** IDBFactory to use. Defaults to globalThis.indexedDB. */
  factory?: IDBFactory;
}

const DEFAULT_DB = 'infrabitwallet';
const DEFAULT_STORE = 'kv';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IDB_REQUEST_FAILED'));
    };
  });
}

export class IndexedDBAdapter implements StorageAdapter {
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly factory: IDBFactory;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbAdapterOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB;
    this.storeName = options.storeName ?? DEFAULT_STORE;
    const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) throw new Error('INDEXEDDB_UNAVAILABLE');
    this.factory = factory;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = () => {
          resolve(req.result);
        };
        req.onerror = () => {
          reject(req.error ?? new Error('IDB_OPEN_FAILED'));
        };
      });
    }
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.db();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async get(key: string): Promise<string | null> {
    const store = await this.store('readonly');
    const result = await requestToPromise<unknown>(store.get(key));
    return typeof result === 'string' ? result : null;
  }

  private writeTransaction(store: IDBObjectStore): Promise<void> {
    const tx = store.transaction;
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('IDB_TX_FAILED'));
      };
      tx.onabort = () => {
        reject(tx.error ?? new Error('IDB_TX_ABORTED'));
      };
    });
  }

  async set(key: string, value: string): Promise<void> {
    const store = await this.store('readwrite');
    const done = this.writeTransaction(store);
    await requestToPromise<IDBValidKey>(store.put(value, key));
    await done;
  }

  async delete(key: string): Promise<void> {
    const store = await this.store('readwrite');
    const done = this.writeTransaction(store);
    await requestToPromise<undefined>(store.delete(key));
    await done;
  }

  async clear(): Promise<void> {
    const store = await this.store('readwrite');
    const done = this.writeTransaction(store);
    await requestToPromise<undefined>(store.clear());
    await done;
  }
}
