import { createDatabase } from "./client.ts";

const database = await createDatabase({ url: process.env.DATABASE_URL, dataDir: process.env.PGLITE_DIR ?? "../../.data/pglite" });
await database.migrate();
console.log(`migrated (${database.kind})`);
await database.close();
