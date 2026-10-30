import { loadConfig } from "./config.ts";
import { seedDemo } from "./demo/seed.ts";
import { closeServices, createServices } from "./services/index.ts";
import { upsertUserByClerkId } from "./services/users.ts";

/** `pnpm seed [clerkUserId]`: seed demo mail for a user (default: the local dev user). */
const config = { ...loadConfig(), demo: true };
if (config.env === "production") throw new Error("Refusing to seed demo data in production");
const s = await createServices(config);
const clerkUserId = process.argv[2] ?? "dev_you";
const user = await upsertUserByClerkId(s.db, clerkUserId, {});
await seedDemo(s, user.id);
console.log(`seeded demo mail for ${clerkUserId}`);
await closeServices(s);
