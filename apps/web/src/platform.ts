import { indexedDbCacheFactory, type CacheFactory, type ClientCache } from "@ostra/ui";

/** Running inside the Tauri desktop shell. */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Db = Awaited<ReturnType<typeof import("@tauri-apps/plugin-sql").default.load>>;
let dbPromise: Promise<Db> | null = null;

function database(): Promise<Db> {
  dbPromise ??= import("@tauri-apps/plugin-sql").then(async ({ default: Database }) => {
    const db = await Database.load("sqlite:ostra-cache.db");
    await db.execute("CREATE TABLE IF NOT EXISTS kv (user TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user, key))");
    return db;
  });
  return dbPromise;
}

/** The desktop cache: SQLite in the app data directory, one namespace per signed-in user. */
class SqliteCache implements ClientCache {
  constructor(private readonly user: string) {}
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const rows = await (await database()).select<{ value: string }[]>("SELECT value FROM kv WHERE user = $1 AND key = $2", [this.user, key]);
      return rows[0] ? (JSON.parse(rows[0].value) as T) : undefined;
    } catch {
      return undefined;
    }
  }
  async set(key: string, value: unknown) {
    try {
      await (await database()).execute("INSERT INTO kv (user, key, value) VALUES ($1, $2, $3) ON CONFLICT(user, key) DO UPDATE SET value = excluded.value", [this.user, key, JSON.stringify(value)]);
    } catch {
      // the cache is best-effort
    }
  }
  async delete(key: string) {
    await (await database()).execute("DELETE FROM kv WHERE user = $1 AND key = $2", [this.user, key]).catch(() => {});
  }
  async clear() {
    await (await database()).execute("DELETE FROM kv WHERE user = $1", [this.user]).catch(() => {});
  }
}

export const cacheFactory: CacheFactory = isDesktop ? (user) => new SqliteCache(user) : indexedDbCacheFactory;

/** OAuth consent screens refuse embedded webviews, so the desktop app opens them in the system browser. */
export const openExternal: ((url: string) => void) | undefined = isDesktop
  ? (url) => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url))
  : undefined;
