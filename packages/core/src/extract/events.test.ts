import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays, buildIcs, parseIcs, parseWallTime, resolveTimeZone, utcToWall, zonedToUtc } from "./events.ts";

const GOOGLE_INVITE = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VTIMEZONE",
  "TZID:America/Chicago",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DTSTART;TZID=America/Chicago:20261105T190000",
  "DTEND;TZID=America/Chicago:20261105T203000",
  "DTSTAMP:20261030T130000Z",
  "ORGANIZER;CN=Maya Chen:mailto:maya@example.com",
  "UID:abc123@google.com",
  "DESCRIPTION:Bring the slides\\, and the notes.\\nSee you there!",
  "LOCATION:Uchi\\, 904 Westheimer Rd\\, Houston",
  "SUMMARY:Debate prep dinner",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H10M0S",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("reads a Google invite in its time zone", () => {
    const [e] = parseIcs(GOOGLE_INVITE);
    assert.ok(e);
    assert.equal(e.title, "Debate prep dinner");
    assert.equal(e.allDay, false);
    // 7pm CST (UTC-6, after DST ends on Nov 1) = 01:00Z next day.
    assert.equal(e.start, "2026-11-06T01:00:00.000Z");
    assert.equal(e.end, "2026-11-06T02:30:00.000Z");
    assert.equal(e.timeZone, "America/Chicago");
    assert.equal(e.location, "Uchi, 904 Westheimer Rd, Houston");
    assert.equal(e.description, "Bring the slides, and the notes.\nSee you there!");
    assert.equal(e.organizer, "Maya Chen <maya@example.com>");
    assert.equal(e.uid, "abc123@google.com");
    assert.equal(e.source, "ics");
  });

  it("maps Outlook's Windows zone names and folded lines", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "SUMMARY;LANGUAGE=en-US:Quarterly review with the whole product and design",
      "  team",
      'DTSTART;TZID="Pacific Standard Time":20260310T090000',
      "DURATION:PT1H30M",
      "UID:040000008200E00074C5B7101A82E008",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const [e] = parseIcs(ics);
    assert.equal(e?.title, "Quarterly review with the whole product and design team");
    assert.equal(e?.timeZone, "America/Los_Angeles");
    assert.equal(e?.start, "2026-03-10T16:00:00.000Z"); // PDT, UTC-7
    assert.equal(e?.end, "2026-03-10T17:30:00.000Z");
  });

  it("handles all-day events, UTC times and floating times", () => {
    const ics = (body: string[]) => ["BEGIN:VCALENDAR", "BEGIN:VEVENT", ...body, "END:VEVENT", "END:VCALENDAR"].join("\n");
    const [allDay] = parseIcs(ics(["SUMMARY:Thanksgiving break", "DTSTART;VALUE=DATE:20261126", "DTEND;VALUE=DATE:20261128"]));
    assert.deepEqual([allDay?.allDay, allDay?.start, allDay?.end], [true, "2026-11-26", "2026-11-28"]);
    const [oneDay] = parseIcs(ics(["SUMMARY:Field trip", "DTSTART;VALUE=DATE:20261112"]));
    assert.equal(oneDay?.end, "2026-11-13");
    const [utc] = parseIcs(ics(["SUMMARY:Call", "DTSTART:20261201T150000Z", "DTEND:20261201T153000Z"]));
    assert.equal(utc?.start, "2026-12-01T15:00:00.000Z");
    const [floating] = parseIcs(ics(["SUMMARY:Dentist", "DTSTART:20261201T090000"]), { fallbackTimeZone: "America/Chicago" });
    assert.equal(floating?.start, "2026-12-01T15:00:00.000Z");
    assert.equal(floating?.end, null);
  });

  it("skips cancellations, cancelled events and recurrence exceptions", () => {
    const cancel = ["BEGIN:VCALENDAR", "METHOD:CANCEL", "BEGIN:VEVENT", "SUMMARY:Standup", "DTSTART:20261201T150000Z", "END:VEVENT", "END:VCALENDAR"].join("\n");
    assert.deepEqual(parseIcs(cancel), []);
    const cancelled = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "STATUS:CANCELLED", "SUMMARY:x", "DTSTART:20261201T150000Z", "END:VEVENT", "END:VCALENDAR"].join("\n");
    assert.deepEqual(parseIcs(cancelled), []);
    const exception = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Weekly 1:1",
      "DTSTART;TZID=America/New_York:20261102T100000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "RECURRENCE-ID;TZID=America/New_York:20261109T100000",
      "SUMMARY:Weekly 1:1 (moved)",
      "DTSTART;TZID=America/New_York:20261110T100000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const events = parseIcs(exception);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.rrule, "FREQ=WEEKLY;BYDAY=MO");
  });

  it("returns nothing for junk", () => {
    assert.deepEqual(parseIcs("not a calendar"), []);
    assert.deepEqual(parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:no start\nEND:VEVENT\nEND:VCALENDAR"), []);
  });
});

describe("time zones", () => {
  it("resolves TZIDs from different clients", () => {
    assert.equal(resolveTimeZone("Eastern Standard Time"), "America/New_York");
    assert.equal(resolveTimeZone("/mozilla.org/20070129_1/Europe/Berlin"), "Europe/Berlin");
    assert.equal(resolveTimeZone("Asia/Tokyo"), "Asia/Tokyo");
    assert.equal(resolveTimeZone("Nowhere/Special"), null);
  });

  it("converts wall time to UTC across DST", () => {
    assert.equal(zonedToUtc({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, "America/Chicago").toISOString(), "2026-07-01T14:00:00.000Z");
    assert.equal(zonedToUtc({ year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, "America/Chicago").toISOString(), "2026-12-01T15:00:00.000Z");
    assert.equal(utcToWall("2026-12-01T15:00:00.000Z", "America/Chicago"), "2026-12-01T09:00:00");
  });

  it("parses wall times and adds days", () => {
    assert.deepEqual(parseWallTime("2026-11-05T19:00"), { year: 2026, month: 11, day: 5, hour: 19, minute: 0, second: 0 });
    assert.equal(parseWallTime("next thursday"), null);
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });
});

describe("buildIcs", () => {
  it("round-trips through parseIcs", () => {
    const [e] = parseIcs(GOOGLE_INVITE);
    const ics = buildIcs(e!, { uid: "ostra-1", now: new Date("2026-10-30T00:00:00Z") });
    assert.match(ics, /\r\nDTSTART:20261106T010000Z\r\n/);
    assert.match(ics, /LOCATION:Uchi\\, 904 Westheimer Rd\\, Houston/);
    const [back] = parseIcs(ics);
    assert.equal(back?.title, e?.title);
    assert.equal(back?.start, e?.start);
    assert.equal(back?.end, e?.end);
    assert.equal(back?.description, e?.description);
  });

  it("writes repeating events in their zone and folds long lines", () => {
    const ics = buildIcs(
      { title: "x".repeat(200), allDay: false, start: "2026-11-02T15:00:00.000Z", end: null, timeZone: "America/New_York", location: null, description: null, url: null, uid: null, organizer: null, rrule: "FREQ=WEEKLY;BYDAY=MO", source: "ics" },
      { uid: "u" },
    );
    assert.match(ics, /DTSTART;TZID=America\/New_York:20261102T100000/);
    assert.match(ics, /DTEND;TZID=America\/New_York:20261102T110000/);
    assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));
  });
});
