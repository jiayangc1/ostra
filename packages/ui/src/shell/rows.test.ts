import { test } from "node:test";
import assert from "node:assert/strict";
import type { Category, ThreadSummary } from "@ostra/core";
import { buildRows } from "./rows.ts";

const t = (id: string, category: Category, isRead = false): ThreadSummary => ({
  id,
  subject: id,
  snippet: "",
  lastMessageAt: "2026-01-01T00:00:00.000Z",
  category,
  isRead,
  folder: "inbox",
  from: { address: `${id}@x.com` },
  participants: [],
  accountIds: [],
  labels: [],
  messageCount: 1,
  hasAttachments: false,
  code: null,
  eventCount: 0,
});

const threads = Object.fromEntries(
  [t("p1", "primary"), t("n1", "newsletter"), t("p2", "primary"), t("x1", "notification", true), t("n2", "newsletter", true), t("p3", "primary")].map((x) => [x.id, x]),
);
const ids = ["p1", "n1", "p2", "x1", "n2", "p3"];

test("non-primary mail collapses into one bundle per category at its newest position", () => {
  const rows = buildRows(ids, threads, { bundle: true, expanded: new Set() });
  assert.deepEqual(
    rows.map((r) => (r.kind === "thread" ? r.id : `[${r.category} ${r.ids.length}/${r.unread}]`)),
    ["p1", "[newsletter 2/1]", "p2", "[notification 1/0]", "p3"],
  );
});

test("expanded bundles show their threads inline, right after the bundle row", () => {
  const rows = buildRows(ids, threads, { bundle: true, expanded: new Set(["newsletter"]) });
  assert.deepEqual(
    rows.map((r) => (r.kind === "thread" ? `${r.id}${r.bundle ? "*" : ""}` : r.category)),
    ["p1", "newsletter", "n1*", "n2*", "p2", "notification", "p3"],
  );
});

test("outside the inbox, lists are flat", () => {
  assert.equal(buildRows(ids, threads, { bundle: false, expanded: new Set() }).length, 6);
});
