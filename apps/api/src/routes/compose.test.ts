import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { MockLLM } from "@ostra/ai";
import { accounts, eq, identities } from "@ostra/db";
import type { ThreadDetail, ThreadSummary } from "@ostra/core";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { createAiService } from "../services/ai.ts";
import { ingestBatch } from "../services/ingest.ts";

let h: Harness;
const llm = new MockLLM({
  json: () => ({ harsher: false, note: "" }),
  text: (r) => (r.prompt.includes("<draft>") ? "Shorter." : "Thanks, Thursday works."),
});
before(async () => (h = await createHarness({ ai: (s) => createAiService(s, llm) })));
after(() => h.close());

async function setup(user: string) {
  const u = await h.user(user);
  const personal = await h.addAccount(u.id, { address: "sam@gmail.com" });
  const startup = await h.addAccount(u.id, { address: "hello@tidepool.dev", color: "green" });
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, startup.id));
  await ingestBatch(h.s, row!, { messages: [msg({ from: { name: "Jane", address: "jane@fund.vc" }, to: [{ address: "hello@tidepool.dev" }], subject: "Deck" })], updates: [], deleted: [] });
  const [thread] = ((await (await h.request("/api/threads?folder=inbox", { user })).json()) as { threads: ThreadSummary[] }).threads;
  const detail = (await (await h.request(`/api/threads/${thread!.id}`, { user })).json()) as ThreadDetail;
  const idOf = async (accountId: string) => (await h.s.db.select().from(identities).where(eq(identities.accountId, accountId)))[0]!.id;
  return { u, personal, startup, thread: thread!, messageId: detail.messages[0]!.id, personalId: await idOf(personal.id), startupId: await idOf(startup.id) };
}

test("smart from: replies come from the address the mail was sent to", async () => {
  const { messageId, startupId } = await setup("from");
  const r = await (await h.request("/api/compose/from", { method: "POST", user: "from", json: { replyToMessageId: messageId } })).json();
  assert.deepEqual(r, { identityId: startupId, reason: "reply" });
});

test("pre-send: wrong account and missing attachment, never blocking", async () => {
  const { messageId, personalId, startupId } = await setup("check");
  const res = await h.request("/api/compose/check", {
    method: "POST",
    user: "check",
    json: { identityId: personalId, replyToMessageId: messageId, to: [{ address: "jane@fund.vc" }], subject: "Re: Deck", bodyText: "I've attached the updated deck.", attachmentCount: 0 },
  });
  const { warnings } = (await res.json()) as { warnings: { kind: string; suggestedIdentityId?: string }[] };
  assert.deepEqual(warnings.map((w) => w.kind), ["wrong_account", "missing_attachment"]);
  assert.equal(warnings[0]!.suggestedIdentityId, startupId);
});

test("AI draft streams text for the thread", async () => {
  const { thread } = await setup("draft");
  const res = await h.request("/api/ai/draft", { method: "POST", user: "draft", json: { threadId: thread.id } });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "Thanks, Thursday works.");
  const rw = await h.request("/api/ai/rewrite", { method: "POST", user: "draft", json: { text: "A long draft", mode: "shorter" } });
  assert.equal(await rw.text(), "Shorter.");
});

test("AI never sees mail from an account with AI off", async () => {
  const { thread, startup } = await setup("private-ai");
  await h.s.db.update(accounts).set({ aiEnabled: false }).where(eq(accounts.id, startup.id));
  const before = llm.calls.length;
  const res = await h.request("/api/ai/draft", { method: "POST", user: "private-ai", json: { threadId: thread.id } });
  assert.equal(res.status, 403);
  const sug = (await (await h.request(`/api/ai/suggestion/${thread.id}`, { user: "private-ai" })).json()) as { draft: string | null };
  assert.equal(sug.draft, null);
  assert.equal(llm.calls.length, before);
});
