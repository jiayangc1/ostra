import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { accounts, eq } from "@ostra/db";
import { createHarness, type Harness } from "../test/harness.ts";

let h: Harness;
before(async () => {
  h = await createHarness();
  h.s.config.google = { clientId: "gid", clientSecret: "gs", pubsubTopic: undefined, pubsubAudience: undefined, pubsubServiceAccount: undefined };
  h.s.config.publicUrl = "https://api.ostramail.com";
  h.s.config.appUrl = "https://app.ostramail.com";
});
after(() => h.close());

test("start returns a consent URL whose state is sealed and points back to our callback", async () => {
  const res = await h.request("/api/accounts/oauth/gmail/start", { method: "POST", json: { color: "pink", returnTo: "/onboarding" } });
  const { url } = (await res.json()) as { url: string };
  const u = new URL(url);
  assert.equal(u.searchParams.get("redirect_uri"), "https://api.ostramail.com/oauth/gmail/callback");
  const state = u.searchParams.get("state")!;
  assert.ok(!Buffer.from(state, "base64url").toString().includes("onboarding"), "state is opaque");
});

test("unconfigured providers say so", async () => {
  const res = await h.request("/api/accounts/oauth/outlook/start", { method: "POST", json: {} });
  assert.equal(res.status, 503);
});

test("forged or tampered state is rejected without touching the provider", async () => {
  const res = await h.request("/oauth/gmail/callback?code=x&state=AAAA", { user: "" });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location")!, /^https:\/\/app\.ostramail\.com\/settings\/accounts\?error=/);
});

test("returnTo can't become an open redirect", async () => {
  const res = await h.request("/api/accounts/oauth/gmail/start", { method: "POST", json: { returnTo: "//evil.com" } });
  const state = new URL(((await res.json()) as { url: string }).url).searchParams.get("state")!;
  const cb = await h.request(`/oauth/gmail/callback?error=access_denied&state=${state}`, { user: "" });
  assert.match(cb.headers.get("location")!, /^https:\/\/app\.ostramail\.com\/settings\/accounts\?error=Access/);
});

test("graph webhook echoes validation and only accepts the account's clientState", async () => {
  const v = await h.request("/webhooks/graph?validationToken=abc%20123", { method: "POST", user: "" });
  assert.equal(await v.text(), "abc 123");

  const u = await h.user("graph");
  const a = await h.addAccount(u.id, { provider: "outlook" });
  await h.s.db.update(accounts).set({ push: { resourceId: "sub-1", expiresAt: null } }).where(eq(accounts.id, a.id));
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  const queued: string[] = [];
  const add = h.s.queue.add.bind(h.s.queue);
  h.s.queue.add = (async (_n: string, d: { accountId: string }) => void queued.push(d.accountId)) as typeof h.s.queue.add;
  await h.request("/webhooks/graph", { method: "POST", user: "", json: { value: [{ subscriptionId: "sub-1", clientState: "wrong" }] } });
  assert.deepEqual(queued, []);
  await h.request("/webhooks/graph", { method: "POST", user: "", json: { value: [{ subscriptionId: "sub-1", clientState: row!.webhookToken }] } });
  assert.deepEqual(queued, [a.id]);
  h.s.queue.add = add;
});

test("gmail push without OIDC configuration or with a bad token is refused", async () => {
  assert.equal((await h.request("/webhooks/gmail", { method: "POST", user: "", json: {} })).status, 503);
  h.s.config.google!.pubsubAudience = "https://api.ostramail.com/webhooks/gmail";
  const res = await h.request("/webhooks/gmail", { method: "POST", user: "", headers: { authorization: "Bearer not.a.jwt" }, json: { message: { data: "" } } });
  assert.equal(res.status, 401);
});
