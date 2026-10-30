import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { accounts, eq, senderRules } from "@ostra/db";
import type { ThreadSummary } from "@ostra/core";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { ingestBatch } from "../services/ingest.ts";

let h: Harness;
before(async () => (h = await createHarness()));
after(() => h.close());

async function seedThread(user: string, over = {}) {
  const u = await h.user(user);
  const a = await h.addAccount(u.id);
  const b = await h.addAccount(u.id, { address: "me@other.com" });
  const m = msg(over);
  const [acctA] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  const [acctB] = await h.s.db.select().from(accounts).where(eq(accounts.id, b.id));
  await ingestBatch(h.s, acctA!, { messages: [m], updates: [], deleted: [] });
  await ingestBatch(h.s, acctB!, { messages: [{ ...m, providerMessageId: "b-copy" }], updates: [], deleted: [] });
  const list = (await (await h.request("/api/threads?folder=inbox", { user })).json()) as { threads: ThreadSummary[] };
  return { u, a, b, thread: list.threads[0]! };
}

test("every /api route requires a session", async () => {
  const res = await h.request("/api/bootstrap", { user: "" });
  assert.equal(res.status, 401);
  const bad = await h.request("/api/bootstrap", { headers: { authorization: "Bearer nope" }, user: "" });
  assert.equal(bad.status, 401);
});

test("users only see their own threads", async () => {
  const { thread } = await seedThread("owner");
  const res = await h.request(`/api/threads/${thread.id}`, { user: "intruder" });
  assert.equal(res.status, 404);
});

test("archive moves the thread in every account it landed in", async () => {
  const { a, b, thread } = await seedThread("archiver");
  const res = await h.request(`/api/threads/${thread.id}/actions`, { method: "POST", json: { action: "archive" }, user: "archiver" });
  assert.equal(res.status, 200);
  assert.deepEqual(h.fakes.get(a.id)!.actions.map((x) => x.action), [{ type: "archive" }]);
  assert.deepEqual(h.fakes.get(b.id)!.actions.map((x) => x.action), [{ type: "archive" }]);
  const inbox = (await (await h.request("/api/threads?folder=inbox", { user: "archiver" })).json()) as { threads: unknown[] };
  assert.equal(inbox.threads.length, 0);
  const archive = (await (await h.request("/api/threads?folder=archive", { user: "archiver" })).json()) as { threads: unknown[] };
  assert.equal(archive.threads.length, 1);
});

test("a failed provider action rolls back and reports 502", async () => {
  const { b, thread } = await seedThread("rollback");
  h.fakes.get(b.id)!.failActions = true;
  const res = await h.request(`/api/threads/${thread.id}/actions`, { method: "POST", json: { action: "trash" }, user: "rollback" });
  assert.equal(res.status, 502);
  const inbox = (await (await h.request("/api/threads?folder=inbox", { user: "rollback" })).json()) as { threads: unknown[] };
  assert.equal(inbox.threads.length, 1, "thread is back in the inbox");
});

test("re-categorizing a sender twice creates a sender rule", async () => {
  const user = "categorizer";
  const sender = { name: "Digest", address: "Digest@News.example" };
  const { thread: t1 } = await seedThread(user, { from: sender });
  const u = await h.user(user);
  const [acct] = await h.s.db.select().from(accounts).where(eq(accounts.userId, u.id));
  await ingestBatch(h.s, acct!, { messages: [msg({ from: sender, subject: "Issue 2" })], updates: [], deleted: [] });
  const threads = ((await (await h.request("/api/threads?folder=inbox", { user })).json()) as { threads: ThreadSummary[] }).threads;
  const t2 = threads.find((t) => t.id !== t1.id)!;

  await h.request(`/api/threads/${t1.id}/category`, { method: "PUT", json: { category: "newsletter" }, user });
  assert.equal((await h.s.db.select().from(senderRules).where(eq(senderRules.userId, u.id))).length, 0);
  await h.request(`/api/threads/${t2.id}/category`, { method: "PUT", json: { category: "newsletter" }, user });
  const rules = await h.s.db.select().from(senderRules).where(eq(senderRules.userId, u.id));
  assert.deepEqual(rules.map((r) => [r.sender, r.category]), [["digest@news.example", "newsletter"]]);
});

test("labels: templates, toggling on a thread, and validation", async () => {
  const user = "labeler";
  const { thread } = await seedThread(user);
  const created = (await (await h.request("/api/labels/templates", { method: "POST", json: { templateIds: ["developer"], custom: [{ name: "Side project", color: "teal" }] }, user })).json()) as { id: string; name: string }[];
  assert.deepEqual(created.map((l) => l.name), ["Deploys", "Alerts", "GitHub", "Billing", "Side project"]);
  // Idempotent
  const again = (await (await h.request("/api/labels/templates", { method: "POST", json: { templateIds: ["developer"] }, user })).json()) as unknown[];
  assert.equal(again.length, 5);

  const label = created[0]!;
  const on = (await (await h.request(`/api/threads/${thread.id}/labels/${label.id}`, { method: "PUT", json: { applied: true }, user })).json()) as { thread: ThreadSummary };
  assert.deepEqual(on.thread.labels, [{ labelId: label.id, source: "user", confidence: 1 }]);
  const off = (await (await h.request(`/api/threads/${thread.id}/labels/${label.id}`, { method: "PUT", json: { applied: false }, user })).json()) as { thread: ThreadSummary };
  assert.deepEqual(off.thread.labels, []);

  const dup = await h.request("/api/labels", { method: "POST", json: { name: "deploys" }, user });
  assert.equal(dup.status, 409);
  const invalid = await h.request("/api/labels", { method: "POST", json: { name: "" }, user });
  assert.equal(invalid.status, 400);
});

test("disconnecting an account keeps mail that is also in another account", async () => {
  const user = "disconnect";
  const { a, thread } = await seedThread(user);
  const res = await h.request(`/api/accounts/${a.id}`, { method: "DELETE", user });
  assert.equal(res.status, 204);
  const detail = (await (await h.request(`/api/threads/${thread.id}`, { user })).json()) as ThreadSummary;
  assert.equal(detail.accountIds.length, 1);
});

test("clerk webhooks reject bad signatures", async () => {
  h.s.config.clerk.webhookSecret = "whsec_" + Buffer.from("x".repeat(32)).toString("base64");
  const res = await h.request("/webhooks/clerk", { method: "POST", json: { type: "user.deleted", data: { id: "x" } }, user: "" });
  assert.equal(res.status, 400);
});
