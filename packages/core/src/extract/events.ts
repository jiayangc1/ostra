/**
 * Calendar events found in mail, from .ics invites or plain text, in one
 * shape every calendar provider can take.
 *
 * Timed events carry UTC instants plus the zone they were written in, so a
 * calendar shows them right and a recurrence keeps its wall-clock time.
 * All-day events carry plain dates (end exclusive, as in iCalendar).
 */
export interface ExtractedEvent {
  title: string;
  allDay: boolean;
  /** Timed: ISO instant (UTC). All-day: YYYY-MM-DD. */
  start: string;
  /** Timed: ISO instant or null when unknown. All-day: YYYY-MM-DD, exclusive. */
  end: string | null;
  /** IANA zone the event was written in, when known. */
  timeZone: string | null;
  location: string | null;
  description: string | null;
  url: string | null;
  /** iCalendar UID, kept so a calendar recognizes the same invite. */
  uid: string | null;
  organizer: string | null;
  /** RRULE value without the "RRULE:" prefix. */
  rrule: string | null;
  source: "ics" | "text";
}

// ---------- time zones ----------

/** Outlook and Exchange write Windows zone names in TZID. */
const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Central America Standard Time": "America/Guatemala",
  "Canada Central Standard Time": "America/Regina",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "SA Pacific Standard Time": "America/Bogota",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "E. Europe Standard Time": "Europe/Chisinau",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Arabian Standard Time": "Asia/Dubai",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "Taipei Standard Time": "Asia/Taipei",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
};

export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A TZID as written by any mail client, as an IANA zone, or null. */
export function resolveTimeZone(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const raw = tzid.trim().replace(/^"|"$/g, "");
  if (WINDOWS_ZONES[raw]) return WINDOWS_ZONES[raw]!;
  if (isValidTimeZone(raw)) return raw;
  // "/mozilla.org/20070129_1/America/New_York", "(UTC-05:00) Eastern Time (US & Canada)"
  const iana = raw.match(/([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+(?:\/[A-Z][A-Za-z_]+)?)$/)?.[1];
  if (iana && isValidTimeZone(iana)) return iana;
  if (/eastern/i.test(raw)) return "America/New_York";
  if (/central/i.test(raw) && /us|canada|america/i.test(raw)) return "America/Chicago";
  if (/mountain/i.test(raw)) return "America/Denver";
  if (/pacific/i.test(raw)) return "America/Los_Angeles";
  return null;
}

function offsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - instant;
}

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** The UTC instant of a wall-clock time in a zone (DST gaps resolve forward). */
export function zonedToUtc(t: WallTime, tz: string): Date {
  const guess = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second ?? 0);
  const first = offsetMs(guess, tz);
  let at = guess - first;
  const second = offsetMs(at, tz);
  if (second !== first) at = guess - second;
  return new Date(at);
}

/** "2026-11-05T19:00" (no zone) → wall time; null when it doesn't parse. */
export function parseWallTime(s: string): WallTime | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const t = { year: +y!, month: +mo!, day: +d!, hour: +h!, minute: +mi!, second: se ? +se : 0 };
  if (t.month < 1 || t.month > 12 || t.day < 1 || t.day > 31 || t.hour > 23 || t.minute > 59) return null;
  return t;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Add days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// ---------- parsing .ics ----------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): Prop | null {
  // NAME;PARAM=a;PARAM="b:c":VALUE (colons inside quoted params don't split)
  let i = 0;
  let inQuote = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...rawParams] = head.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: name!.toUpperCase(), params, value };
}

const unescapeText = (v: string) =>
  v
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();

/** DTSTART/DTEND value → instant or date. */
function parseDateValue(p: Prop, fallbackTz: string | null): { allDay: boolean; value: string; tz: string | null } | null {
  const v = p.value.trim();
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || p.params.VALUE === "DATE") {
    const d = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!d) return null;
    return { allDay: true, value: `${d[1]}-${d[2]}-${d[3]}`, tz: null };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const wall: WallTime = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +m[4]!, minute: +m[5]!, second: m[6] ? +m[6] : 0 };
  if (m[7]) return { allDay: false, value: new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)).toISOString(), tz: resolveTimeZone(p.params.TZID) };
  const tz = resolveTimeZone(p.params.TZID) ?? fallbackTz ?? "UTC";
  return { allDay: false, value: zonedToUtc(wall, tz).toISOString(), tz };
}

/** ISO 8601 duration (P1D, PT1H30M, P1W) → ms. */
function durationMs(v: string): number | null {
  const m = v.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

export interface ParseIcsOptions {
  /** Zone for floating times and unknown TZIDs (the user's zone). */
  fallbackTimeZone?: string | null;
}

/**
 * The events in an iCalendar file. Cancellations and cancelled events are
 * skipped; recurrence exceptions (RECURRENCE-ID) are left to the series.
 */
export function parseIcs(text: string, opts: ParseIcsOptions = {}): ExtractedEvent[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const fallback = opts.fallbackTimeZone && isValidTimeZone(opts.fallbackTimeZone) ? opts.fallbackTimeZone : null;
  const out: ExtractedEvent[] = [];
  let method = "";
  let depth: string[] = [];
  let cur: Prop[] | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      depth.push(p.value.toUpperCase());
      if (p.value.toUpperCase() === "VEVENT" && depth.length === 2) cur = [];
      continue;
    }
    if (p.name === "END") {
      const closing = depth.pop();
      if (closing === "VEVENT" && cur) {
        const ev = toEvent(cur, fallback);
        if (ev && method !== "CANCEL") out.push(ev);
        cur = null;
      }
      if (depth.length === 0) depth = [];
      continue;
    }
    if (depth.length === 1 && p.name === "METHOD") method = p.value.trim().toUpperCase();
    // Properties of nested blocks (VALARM inside VEVENT) don't belong to the event.
    if (cur && depth[depth.length - 1] === "VEVENT") cur.push(p);
  }
  return out.slice(0, 10);
}

function toEvent(props: Prop[], fallbackTz: string | null): ExtractedEvent | null {
  const get = (n: string) => props.find((p) => p.name === n);
  if (get("RECURRENCE-ID")) return null;
  if (get("STATUS")?.value.trim().toUpperCase() === "CANCELLED") return null;
  const dtstart = get("DTSTART");
  if (!dtstart) return null;
  const start = parseDateValue(dtstart, fallbackTz);
  if (!start) return null;

  let end: string | null = null;
  const dtend = get("DTEND");
  const duration = get("DURATION");
  if (dtend) end = parseDateValue(dtend, fallbackTz)?.value ?? null;
  else if (duration) {
    const ms = durationMs(duration.value);
    if (ms !== null) end = start.allDay ? addDays(start.value, Math.max(1, Math.round(ms / 86400_000))) : new Date(Date.parse(start.value) + ms).toISOString();
  }
  if (start.allDay && !end) end = addDays(start.value, 1);
  // Mixed or backwards ranges: drop the end rather than trust it.
  if (end && (start.allDay ? !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start.value : !end.includes("T") || Date.parse(end) < Date.parse(start.value))) {
    end = start.allDay ? addDays(start.value, 1) : null;
  }

  const organizer = get("ORGANIZER");
  const orgAddress = organizer?.value.replace(/^mailto:/i, "").trim() || null;
  const text = (n: string) => {
    const v = get(n)?.value;
    return v ? unescapeText(v) || null : null;
  };
  const url = text("URL");
  return {
    title: (text("SUMMARY") ?? "Untitled event").slice(0, 300),
    allDay: start.allDay,
    start: start.value,
    end,
    timeZone: start.tz,
    location: text("LOCATION")?.slice(0, 500) ?? null,
    description: text("DESCRIPTION")?.slice(0, 2000) ?? null,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    uid: get("UID")?.value.trim() || null,
    organizer: organizer?.params.CN ? `${organizer.params.CN}${orgAddress ? ` <${orgAddress}>` : ""}` : orgAddress,
    rrule: get("RRULE")?.value.trim() || null,
    source: "ics",
  };
}

// ---------- writing .ics ----------

const escapeText = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** Fold to 75 octets per RFC 5545 (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let chunk = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += ch;
    size += n;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

const icsUtc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDate = (d: string) => d.replace(/-/g, "");

/** An instant as wall-clock time in a zone: "2026-11-05T19:00:00". */
export function utcToWall(iso: string, tz: string): string {
  const t = Date.parse(iso);
  const local = new Date(t + offsetMs(t, tz));
  return local.toISOString().slice(0, 19);
}
const icsWall = (iso: string, tz: string) => utcToWall(iso, tz).replace(/[-:]/g, "");

/** A one-event iCalendar file for a calendar to import or a CalDAV PUT. */
export function buildIcs(e: ExtractedEvent, opts: { uid: string; now?: Date; method?: "PUBLISH" }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ostra//Ostra Mail//EN", "CALSCALE:GREGORIAN"];
  if (opts.method) lines.push(`METHOD:${opts.method}`);
  lines.push("BEGIN:VEVENT", `UID:${opts.uid}`, `DTSTAMP:${icsUtc((opts.now ?? new Date()).toISOString())}`);
  if (e.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end ?? addDays(e.start, 1))}`);
  } else if (e.rrule && e.timeZone && isValidTimeZone(e.timeZone)) {
    // A repeating event keeps its wall-clock time across DST, so write it in its zone.
    lines.push(`DTSTART;TZID=${e.timeZone}:${icsWall(e.start, e.timeZone)}`, `DTEND;TZID=${e.timeZone}:${icsWall(eventEnd(e), e.timeZone)}`);
  } else {
    lines.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(eventEnd(e))}`);
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.url) lines.push(`URL:${e.url}`);
  if (e.rrule && /^[A-Z0-9=;,:+-]+$/i.test(e.rrule)) lines.push(`RRULE:${e.rrule}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** An event's end, or the default length when none was given. */
export function eventEnd(e: Pick<ExtractedEvent, "allDay" | "start" | "end">): string {
  if (e.end) return e.end;
  return e.allDay ? addDays(e.start, 1) : new Date(Date.parse(e.start) + 3600_000).toISOString();
}
