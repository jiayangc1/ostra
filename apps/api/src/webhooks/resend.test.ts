import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { accounts, eq, messages } from "@ostra/db";
import { createHarness, type Harness } from "../test/harness.ts";

let h: Harness;
before(async () => (h = await createHarness()));
after(() => h.close());

const secret = "whsec_" + Buffer.from("fedcba9876543210fedcba9876543210").toString("base64");

test("signed email.received webhooks ingest the mail into that account; unsigned ones don't", async () => {
  const u = await h.user("resend");
  const a = await h.addAccount(u.id, { provider: "resend", address: "hello@tidepool.dev" });
  await h.s.db.update(accounts).set({ encryptedCredentials: h.s.envelope.encryptJson({ apiKey: "re_x", domain: "tidepool.dev", address: "hello@tidepool.dev", webhookSecret: secret }) }).where(eq(accounts.id, a.id));
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));

  const payload = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
  const ts = new Date();
  const headers = { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": new Webhook(secret).sign("msg_1", ts, payload), "content-type": "application/json" };

  const forged = await h.request(`/webhooks/resend/${row!.webhookToken}`, { method: "POST", user: "", body: payload, headers: { ...headers, "svix-signature": "v1,AAAA" } });
  assert.equal(forged.status, 400);
  const unknown = await h.request(`/webhooks/resend/not-a-token`, { method: "POST", user: "", body: payload, headers });
  assert.equal(unknown.status, 404);

  const ok = await h.request(`/webhooks/resend/${row!.webhookToken}`, { method: "POST", user: "", body: payload, headers });
  assert.equal(ok.status, 200);
  const stored = await h.s.db.select().from(messages).where(eq(messages.userId, u.id));
  assert.deepEqual(stored.map((m) => m.subject), ["Inbound via Resend"]);
});
