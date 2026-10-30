import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import * as schema from "./schema.ts";

export type Schema = typeof schema;
/**
 * The pg and PGlite drivers expose the same query builder; we type
 * everything against node-postgres.
 */
export type Db = NodePgDatabase<Schema>;

export interface Database {
  db: Db;
  kind: "postgres" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

/**
 * `DATABASE_URL` → Postgres via `pg`. Otherwise an embedded PGlite database
 * at `dataDir` (or in memory when `dataDir` is "memory"), which is what
 * local development and tests use.
 */
export async function createDatabase(opts: { url?: string | undefined; dataDir?: string | undefined } = {}): Promise<Database> {
  if (opts.url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      kind: "postgres",
      migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate: migrateLite } = await import("drizzle-orm/pglite/migrator");
  const dir = opts.dataDir ?? "memory";
  if (dir !== "memory") mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzleLite(client, { schema });
  return {
    db: db as unknown as Db,
    kind: "pglite",
    migrate: () => migrateLite(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close(),
  };
}
