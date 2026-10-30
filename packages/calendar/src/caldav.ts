import type { CalendarInfo, ExtractedEvent } from "@ostra/core";
import { AuthExpiredError, RateLimitedError, buildIcs } from "@ostra/core";
import { CalendarRequestError, stableEventId, type CalendarClient, type CreatedEvent, type Fetch } from "./types.ts";

/**
 * CalDAV (RFC 4791) with HTTP basic auth: iCloud with an app-specific
 * password, and any other CalDAV server (Fastmail, Nextcloud, ...).
 *
 * The fetch passed in is responsible for refusing private and loopback
 * hosts; every request, including redirects, goes through it.
 */

export const ICLOUD_CALDAV_URL = "https://caldav.icloud.com/";

export interface CalDavCredentials {
  serverUrl: string;
  username: string;
  password: string;
  /** Found on connect, so later calls skip discovery. */
  homeUrl?: string | undefined;
}

// ---------- tiny WebDAV XML reader ----------

export interface DavResponse {
  href: string;
  /** Properties from the propstat with a 2xx status, by local name, as inner XML. */
  props: Record<string, string>;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** Parse a 207 multistatus body. Namespace prefixes are dropped; DAV, CalDAV and Apple names don't collide here. */
export function parseMultistatus(xml: string): DavResponse[] {
  const plain = xml.replace(/<(\/?)[A-Za-z][\w.-]*:/g, "<$1");
  const out: DavResponse[] = [];
  for (const [, body] of plain.matchAll(/<response\b[^>]*>([\s\S]*?)<\/response>/g)) {
    const href = body!.match(/<href\b[^>]*>([\s\S]*?)<\/href>/)?.[1];
    if (!href) continue;
    const props: Record<string, string> = {};
    for (const [, ps] of body!.matchAll(/<propstat\b[^>]*>([\s\S]*?)<\/propstat>/g)) {
      const status = ps!.match(/<status\b[^>]*>([\s\S]*?)<\/status>/)?.[1] ?? "200";
      if (!/\s2\d\d\b|^2\d\d$/.test(status.trim())) continue;
      const prop = ps!.match(/<prop\b[^>]*>([\s\S]*?)<\/prop>/)?.[1] ?? "";
      // Each child of <prop>: <name .../> or <name ...>inner</name>
      for (const m of prop.matchAll(/<([A-Za-z][\w-]*)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g)) props[m[1]!] = m[2] ?? "";
    }
    out.push({ href: decode(href.trim()), props });
  }
  return out;
}

const hrefIn = (inner: string | undefined) => {
  const h = inner?.match(/<href\b[^>]*>([\s\S]*?)<\/href>/)?.[1];
  return h ? decode(h.trim()) : null;
};
const textOf = (inner: string | undefined) => (inner ? decode(inner.replace(/<[^>]+>/g, "")).trim() : "");

// ---------- client ----------

const PROPFIND_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const PROPFIND_HOME = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const PROPFIND_CALENDARS = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><d:current-user-privilege-set/><c:supported-calendar-component-set/><a:calendar-color/></d:prop></d:propfind>`;

export class CalDavCalendar implements CalendarClient {
  private readonly auth: string;

  constructor(
    private creds: CalDavCredentials,
    private readonly opts: { fetch: Fetch; save?: (c: CalDavCredentials) => Promise<void> },
  ) {
    this.auth = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
  }

  private async request(method: string, url: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<{ res: Response; url: string }> {
    let current = url;
    // Follow redirects ourselves so each hop goes through the guarded fetch.
    for (let hop = 0; hop < 5; hop++) {
      const res = await this.opts.fetch(current, {
        method,
        redirect: "manual",
        headers: { Authorization: this.auth, ...(init.body ? { "Content-Type": method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8" } : {}), ...init.headers },
        ...(init.body ? { body: init.body } : {}),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      if (res.status === 401) throw new AuthExpiredError("CalDAV server rejected the username or password");
      if (res.status === 429 || res.status === 503) throw new RateLimitedError(`CalDAV throttled (${res.status})`, null);
      return { res, url: current };
    }
    throw new CalendarRequestError("Too many redirects from the calendar server", 508);
  }

  private async propfind(url: string, body: string, depth: "0" | "1"): Promise<{ items: DavResponse[]; url: string }> {
    const { res, url: at } = await this.request("PROPFIND", url, { body, headers: { Depth: depth } });
    if (res.status !== 207) throw new CalendarRequestError(`Calendar server answered ${res.status} to PROPFIND`, res.status);
    return { items: parseMultistatus(await res.text()), url: at };
  }

  /** Find the calendar home: current-user-principal → calendar-home-set (RFC 6764 discovery). */
  async discoverHome(): Promise<string> {
    if (this.creds.homeUrl) return this.creds.homeUrl;
    const starts = [this.creds.serverUrl, new URL("/.well-known/caldav", this.creds.serverUrl).toString()];
    let principal: string | null = null;
    for (const start of starts) {
      try {
        const { items, url } = await this.propfind(start, PROPFIND_PRINCIPAL, "0");
        const href = items.map((i) => hrefIn(i.props["current-user-principal"])).find(Boolean);
        if (href) {
          principal = new URL(href, url).toString();
          break;
        }
      } catch (err) {
        if (err instanceof AuthExpiredError) throw err;
      }
    }
    if (!principal) throw new CalendarRequestError("That server doesn't look like a CalDAV calendar.", 404);
    const { items, url } = await this.propfind(principal, PROPFIND_HOME, "0");
    const home = items.map((i) => hrefIn(i.props["calendar-home-set"])).find(Boolean);
    if (!home) throw new CalendarRequestError("The calendar server didn't say where your calendars are.", 404);
    this.creds = { ...this.creds, homeUrl: new URL(home, url).toString() };
    await this.opts.save?.(this.creds);
    return this.creds.homeUrl!;
  }

  get credentials(): CalDavCredentials {
    return this.creds;
  }

  async whoami(): Promise<string> {
    await this.discoverHome();
    return this.creds.username.toLowerCase();
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const home = await this.discoverHome();
    const { items, url } = await this.propfind(home, PROPFIND_CALENDARS, "1");
    const out: CalendarInfo[] = [];
    for (const i of items) {
      if (!/<calendar\b/.test(i.props.resourcetype ?? "")) continue;
      const comps = i.props["supported-calendar-component-set"];
      if (comps && !/name="VEVENT"/i.test(comps)) continue; // reminders-only lists
      const privileges = i.props["current-user-privilege-set"];
      if (privileges && !/<(write|write-content|all|bind)\b/.test(privileges)) continue;
      const color = textOf(i.props["calendar-color"]).match(/^#[0-9a-f]{6}/i)?.[0] ?? null;
      out.push({ id: new URL(i.href, url).toString(), name: textOf(i.props.displayname) || "Calendar", color, primary: false });
    }
    // iCloud and most servers have no "primary"; the first calendar is the usual default.
    const main = out.find((c) => /^(home|calendar|personal)$/i.test(c.name)) ?? out[0];
    if (main) main.primary = true;
    return out.sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  async createEvent(calendarId: string, e: ExtractedEvent, key: string): Promise<CreatedEvent> {
    const uid = stableEventId(key, calendarId);
    const href = new URL(`${uid}.ics`, calendarId.endsWith("/") ? calendarId : `${calendarId}/`).toString();
    const { res } = await this.request("PUT", href, { body: buildIcs(e, { uid }), headers: { "If-None-Match": "*" } });
    // 412: it's already there from an earlier add.
    if (res.ok || res.status === 412) return { id: href, url: null };
    throw new CalendarRequestError(`The calendar server refused the event (${res.status}).`, res.status);
  }
}
