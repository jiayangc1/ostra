import { Hono } from "hono";
import type { Services } from "../services/context.ts";
import { findUserByClerkId, upsertUserByClerkId } from "../services/users.ts";

/**
 * Clerk → users table sync. Signatures are verified (Standard Webhooks /
 * Svix) before anything is read from the payload.
 */
export function clerkWebhook(s: Services) {
  const r = new Hono();
  r.post("/", async (c) => {
    const secret = s.config.clerk.webhookSecret;
    if (!secret) return c.json({ error: "Clerk webhooks are not configured" }, 503);
    const { verifyWebhook } = await import("@clerk/backend/webhooks");
    let evt: Awaited<ReturnType<typeof verifyWebhook>>;
    try {
      evt = await verifyWebhook(c.req.raw, { signingSecret: secret });
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }

    if (evt.type === "user.created" || evt.type === "user.updated") {
      const d = evt.data;
      const primary = d.email_addresses.find((e) => e.id === d.primary_email_address_id) ?? d.email_addresses[0];
      await upsertUserByClerkId(s.db, d.id, {
        email: primary?.email_address ?? "",
        name: [d.first_name, d.last_name].filter(Boolean).join(" ") || null,
      });
    } else if (evt.type === "user.deleted" && evt.data.id) {
      const user = await findUserByClerkId(s.db, evt.data.id);
      if (user) await s.queue.add("purgeUser", { userId: user.id }, { jobId: user.id });
    }
    return c.json({ ok: true });
  });
  return r;
}
