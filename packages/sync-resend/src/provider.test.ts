import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Webhook } from "svix";
import { ResendProvider, verifyResendWebhook, type ResendCredentials } from "./provider.ts";

const creds: ResendCredentials = { apiKey: "re_test", domain: "tidepool.dev", address: "hello@tidepool.dev", displayName: "Tidepool", aliases: ["support@tidepool.dev", "x@other.com"] };
const raw = readFileSync(new URL("../../core/src/node/fixtures/reply-with-attachment.eml", import.meta.url));

function setup(routes: Record<string, () => Response> = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const f = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : null });
    for (const [k, h] of Object.entries(routes)) if (url.includes(k)) return h();
    if (url.endsWith("/domains")) return Response.json({ data: [{ name: "tidepool.dev", status: "verified" }, { name: "pending.dev", status: "pending" }] });
    if (url.includes("/emails/receiving/")) return Response.json({ id: "r1", from: "Jane <jane@fund.vc>", to: ["hello@tidepool.dev"], created_at: "2026-10-07T21:30:00Z", raw: { download_url: "https://storage.resend.dev/raw/r1", expires_at: "" } });
    if (url === "https://storage.resend.dev/raw/r1") return new Response(raw);
    if (url.endsWith("/emails")) return Response.json({ id: "sent-1" });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { provider: new ResendProvider(creds, { fetch: f }), calls };
}

test("connect checks the domain is verified and keeps only aliases on it", async () => {
  const { provider } = setup();
  assert.deepEqual((await provider.connect()).identities.map((i) => i.address), ["hello@tidepool.dev", "support@tidepool.dev"]);
  const pending = new ResendProvider({ ...creds, domain: "pending.dev", address: "a@pending.dev" }, { fetch: setup().provider["f"] });
  await assert.rejects(pending.connect(), /isn't verified/);
  const bad = setup({ "/domains": () => new Response("{}", { status: 401 }) });
  await assert.rejects(bad.provider.connect(), /rejected that API key/);
});

test("received mail is fetched and normalized from the raw MIME", async () => {
  const { provider } = setup();
  const m = await provider.fetchReceived("r1");
  assert.equal(m.providerMessageId, "resend:r1");
  assert.equal(m.inReplyTo, "deck-1@acme.dev");
  assert.equal(m.attachments[0]!.filename, "deck-notes.pdf");
  assert.equal(m.folder, "inbox");
});

test("without raw MIME, the JSON fields are used", async () => {
  const { provider } = setup({
    "/emails/receiving/": () =>
      Response.json({ id: "r2", from: "Ada <ada@x.org>", to: "hello@tidepool.dev", subject: "Hi", text: "Hello there", html: null, created_at: "2026-10-01T00:00:00Z", headers: { "In-Reply-To": "<p@x>", "Message-ID": "<r2@x.org>" } }),
  });
  const m = await provider.fetchReceived("r2");
  assert.deepEqual(m.from, { name: "Ada", address: "ada@x.org" });
  assert.equal(m.rfcMessageId, "r2@x.org");
  assert.equal(m.inReplyTo, "p@x");
  assert.equal(m.snippet, "Hello there");
});

test("send uses the Resend API with our Message-ID and threading headers", async () => {
  const { provider, calls } = setup();
  const r = await provider.send(
    { to: [{ name: "Jane", address: "jane@fund.vc" }], cc: [], bcc: [{ address: "cfo@tidepool.dev" }], subject: "Re: Deck", bodyText: "Thursday", inReplyTo: "reply-1@fund.vc", references: ["deck-1@acme.dev", "reply-1@fund.vc"] },
    { address: "hello@tidepool.dev", displayName: "Tidepool" },
  );
  const body = calls.find((c) => c.url.endsWith("/emails"))!.body as Record<string, unknown> & { headers: Record<string, string> };
  assert.equal(body.from, "Tidepool <hello@tidepool.dev>");
  assert.deepEqual(body.bcc, ["cfo@tidepool.dev"]);
  assert.equal(body.headers["In-Reply-To"], "<reply-1@fund.vc>");
  assert.equal(body.headers.References, "<deck-1@acme.dev> <reply-1@fund.vc>");
  assert.equal(body.headers["Message-ID"], `<${r.rfcMessageId}>`);
});

test("webhook signatures are verified over the raw body", () => {
  const secret = "whsec_" + Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
  const payload = JSON.stringify({ type: "email.received", data: { email_id: "r1" } });
  const id = "msg_1";
  const ts = new Date();
  const signature = new Webhook(secret).sign(id, ts, payload);
  const evt = verifyResendWebhook(secret, payload, { id, timestamp: String(Math.floor(ts.getTime() / 1000)), signature });
  assert.equal(evt.data.email_id, "r1");
  assert.throws(() => verifyResendWebhook(secret, payload.replace("r1", "r9"), { id, timestamp: String(Math.floor(ts.getTime() / 1000)), signature }));
});
