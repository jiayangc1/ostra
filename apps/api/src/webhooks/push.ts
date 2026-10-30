import { timingSafeEqual } from "node:crypto";
import { accounts, and, eq, sql } from "@ostra/db";
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Services } from "../services/context.ts";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Gmail push: Pub/Sub POSTs `{message:{data}}` with an OIDC token signed by
 * Google for our audience. We verify it, then queue an incremental sync for
 * that mailbox. The payload itself is never trusted beyond the address.
 */
export function gmailWebhook(s: Services) {
  const r = new Hono();
  r.post("/", async (c) => {
    const audience = s.config.google?.pubsubAudience;
    if (!audience) return c.json({ error: "Gmail push isn't configured" }, 503);
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    try {
      await jwtVerify(token, GOOGLE_JWKS, { audience, issuer: ["https://accounts.google.com", "accounts.google.com"] });
    } catch {
      return c.json({ error: "Invalid token" }, 401);
    }
    const body = (await c.req.json().catch(() => null)) as { message?: { data?: string } } | null;
    let email: string | undefined;
    try {
      email = (JSON.parse(Buffer.from(body?.message?.data ?? "", "base64").toString()) as { emailAddress?: string }).emailAddress;
    } catch {
      // malformed; acknowledge so Pub/Sub doesn't retry forever
    }
    if (email) {
      const rows = await s.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.provider, "gmail"), eq(accounts.externalId, email.toLowerCase())));
      for (const a of rows) await s.queue.add("sync", { accountId: a.id, mode: "incremental" }, { jobId: `${a.id}:incremental` });
    }
    return c.body(null, 204);
  });
  return r;
}

/**
 * Microsoft Graph change notifications. Subscription validation echoes the
 * token; notifications are matched to an account by subscription id and
 * must carry that account's secret clientState.
 */
export function graphWebhook(s: Services) {
  const r = new Hono();
  r.post("/", async (c) => {
    const validation = c.req.query("validationToken");
    if (validation) return c.text(validation, 200, { "Content-Type": "text/plain" });
    const body = (await c.req.json().catch(() => null)) as { value?: { subscriptionId?: string; clientState?: string }[] } | null;
    for (const n of body?.value ?? []) {
      if (!n.subscriptionId || !n.clientState) continue;
      const [acct] = await s.db
        .select()
        .from(accounts)
        .where(and(eq(accounts.provider, "outlook"), sql`${accounts.push}->>'resourceId' = ${n.subscriptionId}`));
      if (!acct || !safeEqual(acct.webhookToken, n.clientState)) continue;
      await s.queue.add("sync", { accountId: acct.id, mode: "incremental" }, { jobId: `${acct.id}:incremental` });
    }
    return c.body(null, 202);
  });
  return r;
}
