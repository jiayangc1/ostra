import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthExpiredError, type ExtractedEvent } from "@ostra/core";
import { CalDavCalendar, parseMultistatus } from "./caldav.ts";
import { GoogleCalendar, googleEventBody } from "./google.ts";
import { MicrosoftCalendar, graphEventBody } from "./microsoft.ts";
import { stableEventId } from "./types.ts";

const dinner: ExtractedEvent = {
  title: "Debate prep dinner",
  allDay: false,
  start: "2026-11-06T01:00:00.000Z",
  end: "2026-11-06T02:30:00.000Z",
  timeZone: "America/Chicago",
  location: "Uchi, Houston",
  description: "Bring the slides.",
  url: null,
  uid: "abc@google.com",
  organizer: null,
  rrule: null,
  source: "ics",
};
const holiday: ExtractedEvent = { ...dinner, title: "Thanksgiving break", allDay: true, start: "2026-11-26", end: "2026-11-28", timeZone: null };
const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3600_000 };

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
    calls.push(c);
    return handler(c);
  }) as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Google Calendar", () => {
  it("builds timed and all-day bodies", () => {
    const timed = googleEventBody(dinner, "id1");
    assert.deepEqual(timed.start, { dateTime: "2026-11-06T01:00:00.000Z", timeZone: "America/Chicago" });
    assert.deepEqual(timed.end, { dateTime: "2026-11-06T02:30:00.000Z", timeZone: "America/Chicago" });
    const allDay = googleEventBody(holiday, "id2");
    assert.deepEqual([allDay.start, allDay.end], [{ date: "2026-11-26" }, { date: "2026-11-28" }]);
    assert.deepEqual(googleEventBody({ ...dinner, rrule: "FREQ=WEEKLY" }, "x").recurrence, ["RRULE:FREQ=WEEKLY"]);
  });

  it("creates an event with a stable id, and returns the existing one on a repeat", async () => {
    const id = stableEventId("m1:0", "primary");
    assert.match(id, /^[0-9a-v]{5,1024}$/);
    let created = false;
    const { f, calls } = fakeFetch((c) => {
      if (c.method === "POST") {
        if (created) return json({ error: { message: "The requested identifier already exists." } }, 409);
        created = true;
        return json({ id, htmlLink: "https://calendar.google.com/event?eid=1" });
      }
      return json({ id, htmlLink: "https://calendar.google.com/event?eid=1" });
    });
    const g = new GoogleCalendar({ tokens }, { clientId: "c", clientSecret: "s", save: async () => {}, fetch: f });
    const first = await g.createEvent("primary", dinner, "m1:0");
    const again = await g.createEvent("primary", dinner, "m1:0");
    assert.deepEqual(first, again);
    assert.equal(calls[0]!.url, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
    assert.equal(JSON.parse(calls[0]!.body!).id, id);
    assert.equal(calls[0]!.headers.Authorization, "Bearer at");
    assert.equal(calls[2]!.url, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`);
  });

  it("lists owned calendars with the primary first", async () => {
    const { f, calls } = fakeFetch(() => json({ items: [{ id: "work", summary: "Work", accessRole: "owner" }, { id: "me@gmail.com", summary: "me@gmail.com", summaryOverride: "Personal", primary: true, backgroundColor: "#9fe1e7", accessRole: "owner" }] }));
    const g = new GoogleCalendar({ tokens }, { clientId: "c", clientSecret: "s", save: async () => {}, fetch: f });
    const list = await g.listCalendars();
    assert.deepEqual(list.map((c) => c.name), ["Personal", "Work"]);
    assert.match(calls[0]!.url, /minAccessRole=owner/);
  });
});

describe("Microsoft calendar", () => {
  it("sends UTC wall times Graph accepts", () => {
    const b = graphEventBody(dinner, "tx");
    assert.deepEqual(b.start, { dateTime: "2026-11-06T01:00:00", timeZone: "UTC" });
    assert.deepEqual(b.end, { dateTime: "2026-11-06T02:30:00", timeZone: "UTC" });
    const d = graphEventBody(holiday, "tx");
    assert.equal(d.isAllDay, true);
    assert.deepEqual(d.end, { dateTime: "2026-11-28T00:00:00", timeZone: "UTC" });
    assert.deepEqual(b.location, { displayName: "Uchi, Houston" });
  });

  it("creates in the chosen calendar and lists only editable ones", async () => {
    const { f, calls } = fakeFetch((c) =>
      c.method === "POST"
        ? json({ id: "AAMk1", webLink: "https://outlook.live.com/calendar/item/1" }, 201)
        : json({ value: [{ id: "shared", name: "Team", canEdit: false }, { id: "cal1", name: "Calendar", isDefaultCalendar: true, canEdit: true }] }),
    );
    const m = new MicrosoftCalendar({ tokens }, { clientId: "c", clientSecret: "s", tenant: "common", save: async () => {}, fetch: f });
    assert.deepEqual((await m.listCalendars()).map((c) => c.id), ["cal1"]);
    const r = await m.createEvent("cal1", dinner, "m1:0");
    assert.equal(r.url, "https://outlook.live.com/calendar/item/1");
    assert.equal(calls[1]!.url, "https://graph.microsoft.com/v1.0/me/calendars/cal1/events");
  });
});

describe("CalDAV", () => {
  const ms = (inner: string) => new Response(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${inner}</d:multistatus>`, { status: 207 });

  it("parses multistatus with any prefixes", () => {
    const r = parseMultistatus(
      `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/1/calendars/home/</D:href><D:propstat><D:prop><D:displayname>Home &amp; Family</D:displayname><D:resourcetype><D:collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat><D:propstat><D:prop><A:calendar-color xmlns:A="http://apple.com/ns/ical/"/></D:prop><D:status>HTTP/1.1 404 Not Found</D:status></D:propstat></D:response></D:multistatus>`,
    );
    assert.equal(r[0]?.href, "/1/calendars/home/");
    assert.equal(r[0]?.props.displayname, "Home &amp; Family"); // raw inner XML; listCalendars decodes it
    assert.match(r[0]!.props.resourcetype!, /<calendar\b/);
    assert.equal(r[0]?.props["calendar-color"], undefined);
  });

  it("discovers iCloud calendars across hosts and puts an event", async () => {
    const { f, calls } = fakeFetch((c) => {
      const body = c.body ?? "";
      if (c.method === "PROPFIND" && c.url === "https://caldav.icloud.com/") {
        return ms(`<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123456/principal/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      }
      if (c.method === "PROPFIND" && body.includes("calendar-home-set")) {
        return ms(`<d:response><d:href>/123456/principal/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>https://p42-caldav.icloud.com:443/123456/calendars/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      }
      if (c.method === "PROPFIND") {
        assert.equal(c.headers.Depth, "1");
        return ms(
          `<d:response><d:href>/123456/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
            `<d:response><d:href>/123456/calendars/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Work</d:displayname><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
            `<d:response><d:href>/123456/calendars/home/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Home</d:displayname><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set><x:calendar-color xmlns:x="http://apple.com/ns/ical/">#FF2968FF</x:calendar-color></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
            `<d:response><d:href>/123456/calendars/tasks/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
        );
      }
      if (c.method === "PUT") return new Response(null, { status: 201 });
      return new Response(null, { status: 500 });
    });
    let saved: unknown = null;
    const dav = new CalDavCalendar({ serverUrl: "https://caldav.icloud.com/", username: "Jo@iCloud.com", password: "abcd-efgh-ijkl-mnop" }, { fetch: f, save: async (c) => void (saved = c) });
    assert.equal(await dav.whoami(), "jo@icloud.com");
    const cals = await dav.listCalendars();
    assert.deepEqual(cals.map((c) => [c.name, c.primary, c.color]), [["Home", true, "#FF2968"], ["Work", false, null]]);
    assert.equal(cals[0]!.id, "https://p42-caldav.icloud.com/123456/calendars/home/");
    assert.equal((saved as { homeUrl: string }).homeUrl, "https://p42-caldav.icloud.com/123456/calendars/");

    const created = await dav.createEvent(cals[0]!.id, dinner, "m1:0");
    const put = calls.find((c) => c.method === "PUT")!;
    assert.equal(put.url, created.id);
    assert.match(put.url, /^https:\/\/p42-caldav\.icloud\.com\/123456\/calendars\/home\/ostra[0-9a-f]+\.ics$/);
    assert.equal(put.headers["If-None-Match"], "*");
    assert.match(put.headers.Authorization!, /^Basic /);
    assert.match(put.body!, /SUMMARY:Debate prep dinner/);
  });

  it("treats an existing event as added and a bad password as needing sign-in", async () => {
    const exists = fakeFetch(() => new Response(null, { status: 412 }));
    const dav = new CalDavCalendar({ serverUrl: "https://dav.example.com/", username: "u", password: "p", homeUrl: "https://dav.example.com/u/" }, { fetch: exists.f });
    assert.match((await dav.createEvent("https://dav.example.com/u/cal/", dinner, "k")).id, /\.ics$/);
    const denied = fakeFetch(() => new Response(null, { status: 401 }));
    const bad = new CalDavCalendar({ serverUrl: "https://caldav.icloud.com/", username: "u", password: "wrong" }, { fetch: denied.f });
    await assert.rejects(() => bad.listCalendars(), AuthExpiredError);
  });

  it("follows redirects through the given fetch", async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.url === "https://dav.example.com/") return new Response(null, { status: 404 });
      if (c.url === "https://dav.example.com/.well-known/caldav") return new Response(null, { status: 301, headers: { Location: "/dav/" } });
      if (c.url === "https://dav.example.com/dav/" && (c.body ?? "").includes("current-user-principal"))
        return ms(`<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/dav/principals/u/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
      return ms(`<d:response><d:href>/dav/principals/u/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>/dav/calendars/u/</d:href></cal:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`);
    });
    const dav = new CalDavCalendar({ serverUrl: "https://dav.example.com/", username: "u", password: "p" }, { fetch: f });
    assert.equal(await dav.discoverHome(), "https://dav.example.com/dav/calendars/u/");
    assert.ok(calls.some((c) => c.url === "https://dav.example.com/dav/"));
  });
});
