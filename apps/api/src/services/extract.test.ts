import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { MockLLM } from "@ostra/ai";
import type { ThreadDetail, ThreadSummary } from "@ostra/core";
import { accounts, eq } from "@ostra/db";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { jobHandlers } from "../worker.ts";
import { createAiService } from "./ai.ts";
import { ingestBatch } from "./ingest.ts";

let h: Harness;
let eventMode: "found" | "none" | "fail" = "found";
const llm = new MockLLM({
  json: (req) => {
    if (req.system.includes("find calendar events")) {
      if (eventMode === "fail") throw new Error("model unavailable");
      return {
        events:
          eventMode === "found"
            ? [{ title: "Dinner with Maya", date: "2026-11-05", startTime: "19:00", endTime: null, endDate: null, location: "Uchi", timeZone: null, url: null, confidence: 0.9 }]
            : [],
      };
    }
    if (req.system.includes("apply a person's own labels")) return { labels: [] };
    return { category: req.prompt.includes("SALE") ? "promotion" : "primary", confidence: 0.8 };
  },
});

const ICS = ["BEGIN:VCALENDAR", "METHOD:REQUEST", "BEGIN:VEVENT", "UID:evt-1@example.com", "SUMMARY:Debate practice", "DTSTART;TZID=America/Chicago:20261103T160000", "DTEND;TZID=America/Chicago:20261103T173000", "LOCATION:Room 204", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

before(async () => {
  h = await createHarness({ ai: (s) => createAiService(s, llm) });
  h.queue.process(jobHandlers(h.s));
});
after(() => h.close());
beforeEach(() => {
  eventMode = "found";
  llm.calls.length = 0;
});

async function setup(user: string) {
  const u = await h.user(user);
  await h.request("/api/settings", { method: "PATCH", user, json: { timeZone: "America/Chicago" } });
  const a = await h.addAccount(u.id);
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  const ingest = async (over: Parameters<typeof msg>[0]) => {
    const m = msg(over);
    await ingestBatch(h.s, row!, { messages: [m], updates: [], deleted: [] });
    await h.queue.idle();
    return m;
  };
  const list = async (folder = "inbox") => ((await (await h.request(`/api/threads?folder=${folder}`, { user })).json()) as { threads: ThreadSummary[] }).threads;
  const detail = async (id: string) => (await (await h.request(`/api/threads/${id}`, { user })).json()) as ThreadDetail;
  return { u, a, ingest, list, detail };
}

test("one-time codes are found on arrival, with AI off too", async () => {
  const { ingest, list, detail } = await setup("codes");
  await h.request("/api/settings", { method: "PATCH", user: "codes", json: { aiEnabled: false } });
  await ingest({ from: { address: "noreply@accounts.google.com" }, subject: "G-482913 is your Google verification code", bodyText: "Enter this code to finish signing in." });
  await ingest({ subject: "Your order shipped", bodyText: "Order 553201 is on its way." });
  const threads = await list();
  const withCode = threads.find((t) => t.code);
  assert.equal(withCode?.code?.value, "482913");
  assert.equal(threads.filter((t) => t.code).length, 1);
  const d = await detail(withCode!.id);
  assert.equal(d.messages[0]!.code, "482913");
  assert.equal(withCode!.code!.messageId, d.messages[0]!.id);
});

test("codes in mail you sent aren't surfaced", async () => {
  const { ingest, list } = await setup("sentcodes");
  await ingest({ folder: "sent", subject: "my code", bodyText: "Your verification code is 112233" });
  const [t] = await list("sent");
  assert.equal(t?.code, null);
});

test(".ics invites are read without the model and appear on the message", async () => {
  const { a, ingest, list, detail } = await setup("ics");
  const fake = h.fakes.get(a.id)!;
  const m = msg({ subject: "Invitation: Debate practice", bodyText: "You've been invited.", attachments: [{ filename: "invite.ics", contentType: "text/calendar", size: ICS.length, providerAttachmentId: "att1" }] });
  fake.files.set(`${m.providerMessageId}:att1`, new TextEncoder().encode(ICS));
  await h.request("/api/settings", { method: "PATCH", user: "ics", json: { aiEnabled: false } });
  await ingest(m);
  const [t] = await list();
  assert.equal(t?.eventCount, 1);
  const d = await detail(t!.id);
  const [e] = d.messages[0]!.events;
  assert.deepEqual([e?.title, e?.start, e?.location, e?.source, e?.index], ["Debate practice", "2026-11-03T22:00:00.000Z", "Room 204", "ics", 0]);
  assert.deepEqual(e?.added, []);
  assert.equal(llm.calls.filter((c) => c.system.includes("find calendar events")).length, 0);
});

test("plain-text events go to the model only past the pre-filter, and never for promotions", async () => {
  const { ingest, list, detail } = await setup("text");
  await ingest({ from: { name: "Maya", address: "maya@example.com" }, subject: "dinner thursday?", bodyText: "Debate prep over dinner Thursday at 7 at Uchi?" });
  await ingest({ from: { address: "friend@example.com" }, subject: "thanks", bodyText: "Got the files, appreciate it." });
  await ingest({ from: { address: "deals@shop.com" }, subject: "SALE ends Friday at 9pm", bodyText: "Huge SALE event Friday at 9pm" });
  const calls = llm.calls.filter((c) => c.system.includes("find calendar events"));
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.prompt, /dinner thursday/);
  const t = (await list()).find((x) => x.subject === "dinner thursday?")!;
  const [e] = (await detail(t.id)).messages[0]!.events;
  assert.equal(e?.start, "2026-11-06T01:00:00.000Z");
  assert.equal(e?.source, "text");
});

test("event finding respects the setting", async () => {
  const { ingest } = await setup("nofind");
  await h.request("/api/settings", { method: "PATCH", user: "nofind", json: { findEvents: false } });
  await ingest({ subject: "lunch friday?", bodyText: "Lunch Friday at noon?" });
  assert.equal(llm.calls.filter((c) => c.system.includes("find calendar events")).length, 0);
});

test("a model failure is retried by the queue", async () => {
  const { ingest, list } = await setup("retry");
  eventMode = "fail";
  const run = ingest({ subject: "call tomorrow?", bodyText: "Can we do a call tomorrow at 3pm?" });
  // Let the first attempt fail, then let the retry succeed.
  await new Promise((r) => setTimeout(r, 50));
  eventMode = "found";
  await run;
  for (let i = 0; i < 40 && !(await list()).some((t) => t.eventCount > 0); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal((await list())[0]?.eventCount, 1);
});
