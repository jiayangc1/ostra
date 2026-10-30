import { test } from "node:test";
import assert from "node:assert/strict";
import type { ThreadSummary } from "@ostra/core";
import type { AxiosInstance } from "axios";
import { MemoryCache } from "./cache.ts";
import { MailStore, belongs, viewKey } from "./store.ts";

const thread: ThreadSummary = {
  id: "t1",
  subject: "Hi",
  snippet: "",
  lastMessageAt: "2026-01-02T00:00:00.000Z",
  category: "primary",
  isRead: false,
  folder: "inbox",
  from: { address: "a@x.com" },
  participants: [],
  accountIds: ["acct"],
  labels: [],
  messageCount: 1,
  hasAttachments: false,
};

function makeStore(post: () => Promise<unknown>) {
  const notes: string[] = [];
  const api = {
    get: async () => ({ data: { threads: [thread], nextCursor: null } }),
    post: async () => ({ data: await post() }),
  } as unknown as AxiosInstance;
  const store = new MailStore({ api, cache: new MemoryCache(), notify: (m) => void notes.push(m) });
  return { store, notes };
}

test("list membership follows folder, account filter and labels", () => {
  assert.ok(belongs(thread, { kind: "folder", folder: "inbox" }));
  assert.ok(belongs(thread, { kind: "folder", folder: "inbox", accountId: "acct" }));
  assert.ok(!belongs(thread, { kind: "folder", folder: "inbox", accountId: "other" }));
  assert.ok(!belongs({ ...thread, folder: "archive" }, { kind: "folder", folder: "inbox" }));
  assert.ok(belongs({ ...thread, labels: [{ labelId: "L", source: "ai", confidence: 1 }] }, { kind: "label", labelId: "L" }));
  assert.ok(!belongs({ ...thread, folder: "trash", labels: [{ labelId: "L", source: "ai", confidence: 1 }] }, { kind: "label", labelId: "L" }));
});

test("archive removes the row immediately and keeps it out when the server agrees", async () => {
  const { store } = makeStore(async () => ({ thread: { ...thread, folder: "archive" } }));
  const inbox = { kind: "folder" as const, folder: "inbox" as const };
  await store.loadList(inbox);
  const pending = store.act("t1", "archive");
  assert.deepEqual(store.getState().lists[viewKey(inbox)]!.ids, [], "optimistic");
  assert.equal(await pending, true);
  assert.deepEqual(store.getState().lists[viewKey(inbox)]!.ids, []);
});

test("a failed action rolls back and tells the user", async () => {
  const { store, notes } = makeStore(async () => {
    throw new Error("The mail provider didn't accept that change.");
  });
  const inbox = { kind: "folder" as const, folder: "inbox" as const };
  await store.loadList(inbox);
  assert.equal(await store.act("t1", "archive"), false);
  assert.deepEqual(store.getState().lists[viewKey(inbox)]!.ids, ["t1"]);
  assert.equal(store.getState().threads.t1!.folder, "inbox");
  assert.match(notes[0]!, /Couldn't archive/);
});

test("live upserts insert new mail at the right position", async () => {
  const { store } = makeStore(async () => ({}));
  const inbox = { kind: "folder" as const, folder: "inbox" as const };
  await store.loadList(inbox);
  store.applyEvent({ type: "thread.upsert", thread: { ...thread, id: "t2", lastMessageAt: "2026-01-03T00:00:00.000Z" } });
  store.applyEvent({ type: "thread.upsert", thread: { ...thread, id: "t0", lastMessageAt: "2026-01-01T00:00:00.000Z" } });
  assert.deepEqual(store.getState().lists[viewKey(inbox)]!.ids, ["t2", "t1", "t0"]);
  store.applyEvent({ type: "thread.remove", threadId: "t1" });
  assert.deepEqual(store.getState().lists[viewKey(inbox)]!.ids, ["t2", "t0"]);
});
