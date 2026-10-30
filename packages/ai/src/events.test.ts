import assert from "node:assert/strict";
import { test } from "node:test";
import { extractEvents, mightContainEvent } from "./events.ts";
import { MockLLM } from "./mock.ts";

const mail = { subject: "dinner thursday?", from: { name: "Maya", address: "maya@example.com" }, body: "Want to do debate prep over dinner Thursday at 7 at Uchi? Should be done by 8:30.", sentAt: "2026-10-29T19:00:00.000Z", timeZone: "America/Chicago" };

test("pre-filter: needs a date plus a time or an event word", () => {
  assert.ok(mightContainEvent("dinner thursday?", "at 7pm at Uchi"));
  assert.ok(mightContainEvent("Interview confirmed", "Your interview is on Nov 5 with the hiring team."));
  assert.ok(mightContainEvent("Reminder", "Essay due 11/12"));
  assert.equal(mightContainEvent("Thanks!", "Got the files, appreciate it."), false);
  assert.equal(mightContainEvent("Quick question", "Can you call me back?"), false);
});

test("extractEvents: resolves wall time in the user's zone and tells the model when the mail was sent", async () => {
  const llm = new MockLLM({
    json: () => ({ events: [{ title: "Debate prep dinner with Maya", date: "2026-11-05", startTime: "19:00", endTime: "20:30", endDate: null, location: "Uchi", timeZone: null, url: null, confidence: 0.92 }] }),
  });
  const [e] = await extractEvents(llm, mail);
  assert.equal(llm.calls[0]!.tier, "fast");
  assert.match(llm.calls[0]!.prompt, /sent Thursday, 2026-10-29 at 14:00 \(America\/Chicago\)/);
  assert.match(llm.calls[0]!.prompt, /<email>/);
  assert.deepEqual([e?.allDay, e?.start, e?.end, e?.timeZone, e?.source], [false, "2026-11-06T01:00:00.000Z", "2026-11-06T02:30:00.000Z", "America/Chicago", "text"]);
  assert.equal(e?.location, "Uchi");
});

test("extractEvents: all-day, stated zones, overnight ends, and the confidence cut", async () => {
  const llm = new MockLLM({
    json: () => ({
      events: [
        { title: "Essay due", date: "2026-11-12", startTime: null, endTime: null, endDate: null, location: null, timeZone: null, url: null, confidence: 0.8 },
        { title: "Team call", date: "2026-11-03", startTime: "15:00", endTime: "15:30", endDate: null, location: null, timeZone: "America/New_York", url: "https://zoom.us/j/1", confidence: 0.9 },
        { title: "Party", date: "2026-11-07", startTime: "21:00", endTime: "01:00", endDate: null, location: null, timeZone: null, url: "javascript:alert(1)", confidence: 0.85 },
        { title: "Maybe", date: "2026-11-08", startTime: null, endTime: null, endDate: null, location: null, timeZone: null, url: null, confidence: 0.4 },
        { title: "Last week", date: "2026-10-20", startTime: null, endTime: null, endDate: null, location: null, timeZone: null, url: null, confidence: 0.9 },
      ],
    }),
  });
  const events = await extractEvents(llm, mail);
  assert.deepEqual(events.map((e) => e.title), ["Essay due", "Team call", "Party"]);
  assert.deepEqual([events[0]!.allDay, events[0]!.start, events[0]!.end], [true, "2026-11-12", "2026-11-13"]);
  assert.equal(events[1]!.start, "2026-11-03T20:00:00.000Z"); // 3pm EST
  assert.equal(events[1]!.url, "https://zoom.us/j/1");
  assert.equal(events[2]!.end, "2026-11-08T07:00:00.000Z"); // 1am the next day, CST
  assert.equal(events[2]!.url, null);
});
