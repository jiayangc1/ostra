import { accounts, and, eq } from "@ostra/db";
import { ResendProvider, verifyResendWebhook, type ResendCredentials } from "@ostra/sync-resend";
import { Hono } from "hono";
import type { Services } from "../services/context.ts";
import { ingestBatch } from "../services/ingest.ts";

/**
 * Resend inbound mail. Each account gets its own URL (`/webhooks/resend/<token>`)
 * and its own signing secret; the Svix signature is checked over the raw
 * body before the email is fetched from Resend and ingested.
 */
export function resendWebhook(s: Services) {
  const r = new Hono();
  r.post("/:token", async (c) => {
    const [account] = await s.db.select().from(accounts).where(and(eq(accounts.provider, "resend"), eq(accounts.webhookToken, c.req.param("token"))));
    if (!account) return c.json({ error: "Unknown endpoint" }, 404);
    const creds = s.envelope.decryptJson<ResendCredentials>(account.encryptedCredentials);
    if (!creds.webhookSecret) return c.json({ error: "Webhook secret not configured" }, 409);

    const raw = await c.req.text();
    let event: ReturnType<typeof verifyResendWebhook>;
    try {
      event = verifyResendWebhook(creds.webhookSecret, raw, { id: c.req.header("svix-id"), timestamp: c.req.header("svix-timestamp"), signature: c.req.header("svix-signature") });
    } catch {
      return c.json({ error: "Invalid signature" }, 400);
    }
    if (event.type !== "email.received" || !event.data.email_id) return c.json({ ok: true });

    const provider = s.providers.resend ? s.providers.resend({ account, credentials: creds as never, config: s.config, saveCredentials: async () => {} }) : new ResendProvider(creds);
    const message = await (provider as ResendProvider).fetchReceived(event.data.email_id);
    await ingestBatch(s, account, { messages: [message], updates: [], deleted: [] });
    await s.db.update(accounts).set({ lastSyncedAt: new Date() }).where(eq(accounts.id, account.id));
    return c.json({ ok: true });
  });
  return r;
}
