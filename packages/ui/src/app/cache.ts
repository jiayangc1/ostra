import { openDB, type IDBPDatabase } from "idb";

/**
 * Local cache so the app renders instantly from disk and reconciles with
 * the server after. IndexedDB on web; the desktop shell injects SQLite.
 */
export interface ClientCache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCache implements ClientCache {
  private readonly map = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.map.get(key) as T | undefined;
  }
  async set(key: string, value: unknown) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
  async clear() {
    this.map.clear();
  }
}

export class IndexedDbCache implements ClientCache {
  private db: Promise<IDBPDatabase>;

  /** One database per signed-in user, so switching accounts never leaks mail. */
  constructor(userKey: string) {
    this.db = openDB(`ostra:${userKey}`, 1, {
      upgrade(db) {
        db.createObjectStore("kv");
      },
    });
  }

  async get<T>(key: string) {
    try {
      return (await (await this.db).get("kv", key)) as T | undefined;
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: unknown) {
    try {
      await (await this.db).put("kv", value, key);
    } catch {
      // quota or private mode; the cache is best-effort
    }
  }
  async delete(key: string) {
    try {
      await (await this.db).delete("kv", key);
    } catch {
      // ignore
    }
  }
  async clear() {
    try {
      await (await this.db).clear("kv");
    } catch {
      // ignore
    }
  }
}

export type CacheFactory = (userKey: string) => ClientCache;
export const indexedDbCacheFactory: CacheFactory = (userKey) => (typeof indexedDB === "undefined" ? new MemoryCache() : new IndexedDbCache(userKey));
