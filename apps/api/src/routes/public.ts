import { waitlist } from "@ostra/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { rateLimit } from "../lib/rate-limit.ts";
import type { Services } from "../services/context.ts";

const SITE_ORIGINS = (process.env.SITE_ORIGINS ?? "https://ostramail.com,https://www.ostramail.com,http://localhost:4321").split(",").map((s) => s.trim());

/** Unauthenticated endpoints for ostramail.com. */
export function publicRoutes(s: Services) {
  const r = new Hono();
  r.use("*", cors({ origin: (o) => (SITE_ORIGINS.includes(o) ? o : null), allowMethods: ["POST"], allowHeaders: ["Content-Type"] }));
  r.use(
    "*",
    rateLimit({ windowMs: 60 * 60_000, max: 10, key: (c) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local" }),
  );

  r.post("/waitlist", async (c) => {
    const body = z
      .object({ email: z.string().trim().toLowerCase().email().max(320), source: z.string().max(40).optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Enter a valid email address." }, 400);
    await s.db.insert(waitlist).values({ email: body.data.email, source: body.data.source ?? null }).onConflictDoNothing();
    // Same answer whether or not the address was already there.
    return c.json({ ok: true });
  });
  return r;
}
