import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { CalendarClient } from "@ostra/calendar";
import { CalDavCalendar } from "@ostra/calendar";
import { AuthExpiredError, type CalendarConnection, type ExtractedEvent, type ThreadDetail, type ThreadSummary, type UserSettings } from "@ostra/core";
import { accounts, eq } from "@ostra/db";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { jobHandlers } from "../worker.ts";
import { guardedFetch, type CalendarContext } from "../services/calendars.ts";
import { ingestBatch } from "../services/ingest.ts";
import { loadConfig } from "../config.ts";

/** One fake calendar account per Apple ID; records what was added. */
const added: { account: string; calendarId: string; event: ExtractedEvent; key: string }[] = [];
let expire = false;
function fakeCalendars(ctx: CalendarContext): CalendarClient {
  const creds = ctx.credentials as { username?: string; password?: string };
  const account = creds.username ?? "me@gmail.com";
  return {
    async whoami() {
      if (creds.password === "wrong" || expire) throw new AuthExpiredError("nope");
      return account.toLowerCase();
    },
    async listCalendars() {
      if (expire) throw new AuthExpiredError("nope");
      return [
        { id: `https://p1-caldav.icloud.com/${account}/home/`, name: "Home", color: "#ff2968", primary: true },
        { id: `https://p1-caldav.icloud.com/${account}/work/`, name: "Work", color: null, primary: false },
      ];
    },
    async createEvent(calendarId, event, key) {
      if (expire) throw new AuthExpiredError("nope");
      added.push({ account, calendarId, event, key });
      return { id: `${calendarId}${key}.ics`, url: null };
    },
  };
}

let h: Harness;
const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x@example.com", "SUMMARY:Tournament", "DTSTART;VALUE=DATE:20261114", "DTEND;VALUE=DATE:20261116", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

before(async () => {
  h = await createHarness({ calendars: fakeCalendars });
  h.queue.process(jobHandlers(h.s));
});
after(() => h.close());

async function setup(user: string) {
  const u = await h.user(user);
  const a = await h.addAccount(u.id);
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  const m = msg({ subject: "Tournament invite", attachments: [{ filename: "t.ics", contentType: "text/calendar", size: 200, providerAttachmentId: "a" }] });
  h.fakes.get(a.id)!.files.set(`${m.providerMessageId}:a`, new TextEncoder().encode(ICS));
  await ingestBatch(h.s, row!, { messages: [m], updates: [], deleted: [] });
  await h.queue.idle();
  const threads = ((await (await h.request("/api/threads?folder=inbox", { user })).json()) as { threads: ThreadSummary[] }).threads;
  const detail = async () => (await (await h.request(`/api/threads/${threads[0]!.id}`, { user })).json()) as ThreadDetail;
  const messageId = (await detail()).messages[0]!.id;
  const settings = async () => ((await (await h.request("/api/bootstrap", { user })).json()) as { settings: UserSettings }).settings;
  return { u, messageId, detail, settings };
}

const connect = (user: string, json: unknown) => h.request("/api/calendars/caldav", { method: "POST", user, json });

test("connect iCloud with an app-specific password; the first calendar becomes the default", async () => {
  const { settings } = await setup("apple");
  const res = await connect("apple", { username: "Jo@iCloud.com", password: "abcd efgh ijkl mnop" });
  assert.equal(res.status, 201);
  const conn = (await res.json()) as CalendarConnection;
  assert.deepEqual([conn.provider, conn.account, conn.serverLabel, conn.status], ["caldav", "jo@icloud.com", "iCloud", "active"]);
  assert.equal(conn.calendars.length, 2);
  assert.deepEqual((await settings()).defaultCalendar, { connectionId: conn.id, calendarId: conn.calendars[0]!.id });

  // Connecting the same Apple ID again updates it instead of duplicating.
  await connect("apple", { username: "jo@icloud.com", password: "abcdefghijklmnop" });
  const list = (await (await h.request("/api/calendars", { user: "apple" })).json()) as CalendarConnection[];
  assert.equal(list.length, 1);
  // Credentials stay on the server.
  assert.ok(!JSON.stringify(list).includes("abcdefghijklmnop"));
});

test("a wrong Apple password explains app-specific passwords", async () => {
  await setup("wrongpw");
  const res = await connect("wrongpw", { username: "jo@icloud.com", password: "wrong" });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /app-specific password/);
});

test("add to the default calendar, to a chosen one, and twice without duplicating", async () => {
  const { messageId, detail } = await setup("adder");
  const conn = (await (await connect("adder", { username: "adder@icloud.com", password: "p" })).json()) as CalendarConnection;
  added.length = 0;

  const first = await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "adder", json: {} });
  assert.equal(first.status, 201);
  assert.equal(((await first.json()) as { calendarName: string }).calendarName, "Home");
  assert.equal(added[0]!.event.title, "Tournament");
  assert.equal(added[0]!.key, `${messageId}:0`);

  await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "adder", json: {} });
  const work = conn.calendars[1]!.id;
  await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "adder", json: { connectionId: conn.id, calendarId: work } });

  const placements = (await detail()).messages[0]!.events[0]!.added;
  assert.deepEqual(placements.map((p) => p.calendarName).sort(), ["Home", "Work"]);
});

test("adding needs a calendar, a real event and your own message", async () => {
  const { messageId } = await setup("guards");
  let res = await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "guards", json: {} });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "no_calendar");
  await connect("guards", { username: "guards@icloud.com", password: "p" });
  res = await h.request(`/api/messages/${messageId}/events/5/add`, { method: "POST", user: "guards", json: {} });
  assert.equal(res.status, 404);
  await setup("intruder");
  res = await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "intruder", json: {} });
  assert.equal(res.status, 404);
  res = await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "guards", json: { calendarId: "https://evil.example.com/" } });
  assert.equal(res.status, 400);
});

test("an expired calendar login is flagged for reconnecting", async () => {
  const { messageId } = await setup("expiry");
  await connect("expiry", { username: "expiry@icloud.com", password: "p" });
  expire = true;
  try {
    const res = await h.request(`/api/messages/${messageId}/events/0/add`, { method: "POST", user: "expiry", json: {} });
    assert.equal(res.status, 409);
    const [conn] = (await (await h.request("/api/calendars", { user: "expiry" })).json()) as CalendarConnection[];
    assert.equal(conn?.status, "needs_reauth");
  } finally {
    expire = false;
  }
});

test("removing the default calendar clears or moves the default", async () => {
  const { settings } = await setup("remover");
  const a = (await (await connect("remover", { username: "a@icloud.com", password: "p" })).json()) as CalendarConnection;
  const b = (await (await connect("remover", { username: "b@icloud.com", password: "p" })).json()) as CalendarConnection;
  assert.equal((await settings()).defaultCalendar?.connectionId, a.id);
  await h.request(`/api/calendars/${a.id}`, { method: "DELETE", user: "remover" });
  assert.equal((await settings()).defaultCalendar?.connectionId, b.id);
  await h.request(`/api/calendars/${b.id}`, { method: "DELETE", user: "remover" });
  assert.equal((await settings()).defaultCalendar, null);
});

test("download any event as .ics with nothing connected", async () => {
  const { messageId } = await setup("download");
  const res = await h.request(`/api/messages/${messageId}/events/0/ics`, { user: "download" });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/calendar/);
  assert.match(res.headers.get("content-disposition")!, /Tournament\.ics/);
  const body = await res.text();
  assert.match(body, /DTSTART;VALUE=DATE:20261114/);
  assert.match(body, /UID:x@example\.com/);
});

test("calendar OAuth needs a configured provider; a bad callback goes back to settings", async () => {
  await setup("oauth");
  const res = await h.request("/api/calendars/oauth/google/start", { method: "POST", user: "oauth", json: {} });
  assert.equal(res.status, 503);
  const cb = await h.request("/oauth/calendar/google/callback?state=garbage&code=x", { user: "" });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get("location")!, /\/settings\/calendars\?error=/);
});

test("the default calendar can only point at your own connection", async () => {
  await setup("settings");
  const res = await h.request("/api/settings", { method: "PATCH", user: "settings", json: { defaultCalendar: { connectionId: "00000000-0000-4000-8000-000000000000", calendarId: "x" } } });
  assert.equal(res.status, 400);
  const tz = await h.request("/api/settings", { method: "PATCH", user: "settings", json: { timeZone: "Mars/Olympus" } });
  assert.equal(tz.status, 400);
});

test("CalDAV only talks to public https hosts", async () => {
  const guarded = guardedFetch(loadConfig({ NODE_ENV: "test" }), async () => new Response("ok"));
  await assert.rejects(() => guarded("http://caldav.example.com/"), /https/);
  await assert.rejects(() => guarded("https://127.0.0.1/"), /not a public host/);
  await assert.rejects(() => guarded("https://169.254.169.254/latest/meta-data"), /not a public host/);
  const dav = new CalDavCalendar({ serverUrl: "https://localhost/", username: "u", password: "p" }, { fetch: guarded });
  await assert.rejects(() => dav.listCalendars());
});
