import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { MockLLM } from "@ostra/ai";
import { accounts, eq, labels, threads } from "@ostra/db";
import type { ThreadSummary } from "@ostra/core";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { jobHandlers } from "../worker.ts";
import { createAiService } from "./ai.ts";
import { ingestBatch } from "./ingest.ts";

let h: Harness;
let mode: "ok" | "fail" = "ok";
const llm = new MockLLM({
  json: (req) => {
    if (mode === "fail") throw new Error("model unavailable");
    if (req.system.includes("apply a person's own labels")) return { labels: req.prompt.includes("term sheet") ? [{ name: "Investors", confidence: 0.9 }] : [] };
    return { category: req.prompt.includes("webinar") ? "promotion" : "primary", confidence: 0.8 };
  },
});

before(async () => {
  h = await createHarness({ ai: (s) => createAiService(s, llm) });
  h.queue.process(jobHandlers(h.s));
});
after(() => h.close());
beforeEach(() => {
  mode = "ok";
  llm.calls.length = 0;
});

async function setup(user: string) {
  const u = await h.user(user);
  const a = await h.addAccount(u.id);
  await h.s.db.insert(labels).values({ userId: u.id, name: "Investors", color: "purple", description: "VCs" });
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  const ingest = async (over: Parameters<typeof msg>[0]) => {
    await ingestBatch(h.s, row!, { messages: [msg(over)], updates: [], deleted: [] });
    await h.queue.idle();
  };
  const inbox = async () => ((await (await h.request("/api/threads?folder=inbox", { user })).json()) as { threads: ThreadSummary[] }).threads;
  return { u, a, ingest, inbox };
}

test("bulk mail is sorted by heuristics alone; strangers go to the fast model", async () => {
  const { ingest, inbox } = await setup("sorting");
  await ingest({ from: { address: "hello@substack.com" }, subject: "Issue 9", headers: { "list-unsubscribe": "<https://x>" } });
  assert.equal(llm.calls.filter((c) => c.system.includes("sort incoming email")).length, 0);
  await ingest({ from: { address: "events@saas.io" }, subject: "Join our webinar" });
  const t = await inbox();
  assert.deepEqual(t.map((x) => [x.subject, x.category]).sort(), [["Issue 9", "newsletter"], ["Join our webinar", "promotion"]]);
});

test("auto-labels are applied on arrival", async () => {
  const { ingest, inbox } = await setup("labeling");
  await ingest({ from: { address: "maya@northstar.capital" }, subject: "Northstar term sheet" });
  const [t] = await inbox();
  assert.equal(t!.labels.length, 1);
  assert.equal(t!.labels[0]!.source, "ai");
});

test("model failures never block mail: primary now, retried later", async () => {
  const { u, ingest, inbox } = await setup("failing");
  mode = "fail";
  await ingest({ from: { address: "events@saas.io" }, subject: "Join our webinar" });
  const [t] = await inbox();
  assert.equal(t!.category, "primary");
  const [row] = await h.s.db.select().from(threads).where(eq(threads.id, t!.id));
  assert.equal(row!.aiPending, true);

  mode = "ok";
  await h.s.ai.retryThreads!(u.id, [t!.id]);
  assert.equal((await inbox())[0]!.category, "promotion");
});

test("accounts with AI turned off never reach the model", async () => {
  const { a, ingest, inbox } = await setup("private");
  await h.s.db.update(accounts).set({ aiEnabled: false }).where(eq(accounts.id, a.id));
  await ingest({ from: { address: "maya@northstar.capital" }, subject: "Northstar term sheet" });
  assert.equal(llm.calls.length, 0);
  const [t] = await inbox();
  assert.equal(t!.category, "primary");
  assert.deepEqual(t!.labels, []);
});

test("a user's category choice sticks when new mail arrives in the thread", async () => {
  const { ingest, inbox } = await setup("sticky");
  await ingest({ rfcMessageId: "root@x", from: { address: "events@saas.io" }, subject: "Join our webinar" });
  const [t] = await inbox();
  await h.request(`/api/threads/${t!.id}/category`, { method: "PUT", user: "sticky", json: { category: "primary" } });
  await ingest({ rfcMessageId: "child@x", inReplyTo: "root@x", references: ["root@x"], from: { address: "events@saas.io" }, subject: "Re: Join our webinar" });
  assert.equal((await inbox())[0]!.category, "primary");
});
