import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { messageAccounts, messages, threads, eq } from "@ostra/db";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { ingestBatch } from "./ingest.ts";
import { runSync } from "./sync.ts";
import { getThreadDetail, listThreads } from "./threads.ts";
import { accounts } from "@ostra/db";

let h: Harness;
before(async () => (h = await createHarness()));
after(() => h.close());

const accountRow = async (id: string) => (await h.s.db.select().from(accounts).where(eq(accounts.id, id)))[0]!;

test("the same email in two accounts is stored once, with both accounts recorded", async () => {
  const u = await h.user("dedupe");
  const a = await h.addAccount(u.id, { address: "me@gmail.com" });
  const b = await h.addAccount(u.id, { address: "me@work.com", color: "amber" });
  const shared = msg({ rfcMessageId: "<Shared-1@x.com>", subject: "Board meeting" });
  await ingestBatch(h.s, await accountRow(a.id), { messages: [shared], updates: [], deleted: [] });
  await ingestBatch(h.s, await accountRow(b.id), { messages: [{ ...shared, providerMessageId: "other-id", rfcMessageId: "shared-1@x.com" }], updates: [], deleted: [] });

  const rows = await h.s.db.select().from(messages).where(eq(messages.userId, u.id));
  assert.equal(rows.length, 1);
  const links = await h.s.db.select().from(messageAccounts).where(eq(messageAccounts.messageId, rows[0]!.id));
  assert.deepEqual(links.map((l) => l.providerMessageId).sort(), ["other-id", shared.providerMessageId].sort());
  const list = await listThreads(h.s.db, u.id, { folder: "inbox" });
  assert.equal(list.threads.length, 1);
  assert.deepEqual(list.threads[0]!.accountIds.sort(), [a.id, b.id].sort());
});

test("replies join the parent's thread, even when they arrive first", async () => {
  const u = await h.user("threading");
  const a = await h.addAccount(u.id);
  const parent = msg({ rfcMessageId: "parent@x", subject: "Launch" });
  const reply = msg({ rfcMessageId: "reply@x", inReplyTo: "<parent@x>", references: ["<parent@x>"], subject: "Re: Launch" });
  await ingestBatch(h.s, await accountRow(a.id), { messages: [reply], updates: [], deleted: [] });
  await ingestBatch(h.s, await accountRow(a.id), { messages: [parent], updates: [], deleted: [] });
  const t = await h.s.db.select().from(threads).where(eq(threads.userId, u.id));
  assert.equal(t.length, 1);
  const detail = await getThreadDetail(h.s, u.id, t[0]!.id);
  assert.deepEqual(detail.messages.map((m) => m.subject), ["Launch", "Re: Launch"]);
  assert.equal(detail.messages[0]!.bodyText, "Hi there");
});

test("bodies are encrypted at rest", async () => {
  const u = await h.user("enc");
  const a = await h.addAccount(u.id);
  await ingestBatch(h.s, await accountRow(a.id), { messages: [msg({ bodyText: "the launch code is 1234" })], updates: [], deleted: [] });
  const [row] = await h.s.db.select().from(messages).where(eq(messages.userId, u.id));
  // Read the raw store underneath the encryption layer.
  const raw = await (h.s.blobs as unknown as { store: { get(k: string): Promise<Buffer> } }).store.get(row!.bodyRef!);
  assert.ok(!raw.toString("latin1").includes("launch code"));
});

test("sync applies flag updates and deletions, and queues AI for new incoming mail", async () => {
  const u = await h.user("sync");
  const a = await h.addAccount(u.id);
  const m1 = msg();
  const m2 = msg({ folder: "sent", from: { address: "me@example.com" } });
  a.fake.batches.push({ messages: [m1, m2], updates: [], deleted: [], cursor: "1", hasMore: false });
  const queued: string[][] = [];
  const add = h.s.queue.add.bind(h.s.queue);
  h.s.queue.add = (async (name: string, data: { messageIds?: string[] }) => {
    if (name === "ai") queued.push(data.messageIds!);
  }) as typeof h.s.queue.add;
  await runSync(h.s, a.id, "initial");
  h.s.queue.add = add;
  assert.equal(queued.length, 1);
  assert.equal(queued[0]!.length, 1, "only the incoming message is queued for AI");

  a.fake.batches.push({ messages: [], updates: [{ providerMessageId: m1.providerMessageId, isRead: true, folder: "archive" }], deleted: [m2.providerMessageId], cursor: "2", hasMore: false });
  await runSync(h.s, a.id, "incremental");
  const rows = await h.s.db.select().from(messages).where(eq(messages.userId, u.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.folder, "archive");
  assert.equal(rows[0]!.isRead, true);
  const [acct] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  assert.equal(acct!.syncCursor, "2");
  assert.equal(acct!.status, "active");
});

test("expired credentials mark the account needs_reauth instead of failing silently", async () => {
  const u = await h.user("reauth");
  const a = await h.addAccount(u.id);
  const { AuthExpiredError } = await import("@ostra/core");
  a.fake.initialSync = async () => {
    throw new AuthExpiredError("token revoked");
  };
  await runSync(h.s, a.id, "initial");
  const [acct] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  assert.equal(acct!.status, "needs_reauth");
});
