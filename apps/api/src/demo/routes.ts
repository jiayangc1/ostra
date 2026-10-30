import { Hono } from "hono";
import type { AppEnv } from "../routes/api.ts";
import type { Services } from "../services/context.ts";
import { seedDemo } from "./seed.ts";

/** Demo-mode helpers for local development and e2e tests. Mounted only when OSTRA_DEMO=true. */
export function devRoutes(s: Services) {
  const r = new Hono<AppEnv>();
  r.post("/seed", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { labels?: boolean; onboarded?: boolean };
    await seedDemo(s, c.get("user").id, body);
    return c.json({ ok: true });
  });
  return r;
}
