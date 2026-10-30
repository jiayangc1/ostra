import type { ExtractedEvent } from "@ostra/core";
import { addDays, isValidTimeZone, parseWallTime, utcToWall, zonedToUtc } from "@ostra/core";
import { z } from "zod";
import { UNTRUSTED_NOTE, untrusted, type LLMProvider } from "./llm.ts";

const MONTHS = "jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?";
const DATEISH = new RegExp(
  `\\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\\b|\\b(${MONTHS})\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b|\\b\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(${MONTHS})\\b|\\b(tomorrow|tonight|this (morning|afternoon|evening|weekend)|next (week|month))\\b|\\b\\d{1,2}/\\d{1,2}(/\\d{2,4})?\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b`,
  "i",
);
const TIMEISH = /\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)(?![a-z])|\b([01]?\d|2[0-3]):[0-5]\d\b|\b(noon|midnight)\b/i;
const EVENTISH =
  /\b(meet(ing)?|call|dinner|lunch|breakfast|brunch|coffee|appointment|appt|interview|reservation|booking|booked|confirmed|party|event|webinar|class|lesson|practice|tournament|match|game|concert|show|flight|check-?in|session|rehearsal|exam|test|quiz|conference|deadline|due|ceremony|orientation|zoom\.us|meet\.google|teams\.microsoft|rsvp)\b/i;

/** Cheap local gate before any model call: a date plus a time or an event word. */
export function mightContainEvent(subject: string, text: string): boolean {
  const s = `${subject}\n${text.slice(0, 4000)}`;
  return DATEISH.test(s) && (TIMEISH.test(s) || EVENTISH.test(s));
}

const Schema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      /** YYYY-MM-DD */
      date: z.string(),
      /** HH:MM, 24-hour; null for all-day */
      startTime: z.string().nullable(),
      endTime: z.string().nullable(),
      /** YYYY-MM-DD, for multi-day events */
      endDate: z.string().nullable(),
      location: z.string().nullable(),
      /** IANA zone only when the email states one explicitly */
      timeZone: z.string().nullable(),
      url: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM = `You find calendar events in one email: things the recipient would put on their calendar, with a specific date. Examples: a meeting or call they're invited to, a dinner plan, an appointment, a reservation, an interview, a class, a game, a flight, a deadline for something they must do.
Ignore: sale periods, shipping or delivery estimates, newsletters' event roundups the recipient isn't attending, past events, dates only mentioned in passing, and anything without a clear date.
Resolve relative dates ("Thursday", "tomorrow") from when the email was sent. Use 24-hour HH:MM. If no time is given, startTime is null (all day). Only fill timeZone when the email names one ("3pm ET", "10:00 PST") — as an IANA name. Keep titles short and specific ("Dinner with Maya at Uchi", not "Dinner").
Return {"events": []} when there are none. Most emails have none.
${UNTRUSTED_NOTE}`;

export interface EventScanInput {
  subject: string;
  from: { name?: string | undefined; address: string };
  body: string;
  /** ISO instant the email was sent. */
  sentAt: string;
  /** The user's zone, for times written without one. */
  timeZone: string | null;
}

export const EVENT_THRESHOLD = 0.7;

/** Events in a plain-text email, via the fast model. Throws on model failure. */
export async function extractEvents(llm: LLMProvider, m: EventScanInput): Promise<ExtractedEvent[]> {
  const zone = m.timeZone && isValidTimeZone(m.timeZone) ? m.timeZone : "UTC";
  const sentLocal = utcToWall(m.sentAt, zone);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(new Date(m.sentAt));
  const prompt = [
    `The email was sent ${weekday}, ${sentLocal.slice(0, 10)} at ${sentLocal.slice(11, 16)} (${zone}).`,
    untrusted("email", `From: ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}\nSubject: ${m.subject}\n\n${m.body.slice(0, 3000)}`),
  ].join("\n\n");
  const r = await llm.json({ tier: "fast", system: SYSTEM, prompt, schema: Schema, maxTokens: 800 });

  const sentDay = sentLocal.slice(0, 10);
  const out: ExtractedEvent[] = [];
  for (const e of r.events) {
    if (e.confidence < EVENT_THRESHOLD || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    // Something that already happened isn't worth a calendar card.
    if (e.date < addDays(sentDay, -1)) continue;
    const tz = e.timeZone && isValidTimeZone(e.timeZone) ? e.timeZone : zone;
    const base = {
      title: e.title.trim().slice(0, 300) || "Event",
      location: e.location?.trim().slice(0, 500) || null,
      description: null,
      url: e.url && /^https?:\/\//i.test(e.url) ? e.url : null,
      uid: null,
      organizer: null,
      rrule: null,
      source: "text" as const,
    };
    if (!e.startTime) {
      const end = e.endDate && /^\d{4}-\d{2}-\d{2}$/.test(e.endDate) && e.endDate >= e.date ? addDays(e.endDate, 1) : addDays(e.date, 1);
      out.push({ ...base, allDay: true, start: e.date, end, timeZone: null });
      continue;
    }
    const start = parseWallTime(`${e.date}T${e.startTime}`);
    if (!start) continue;
    const startUtc = zonedToUtc(start, tz);
    let end: string | null = null;
    if (e.endTime) {
      const endWall = parseWallTime(`${e.endDate ?? e.date}T${e.endTime}`);
      const endUtc = endWall ? zonedToUtc(endWall, tz) : null;
      // "9pm–1am" ends the next day.
      if (endUtc) end = (endUtc <= startUtc && !e.endDate ? new Date(endUtc.getTime() + 86400_000) : endUtc).toISOString();
      if (end && end <= startUtc.toISOString()) end = null;
    }
    out.push({ ...base, allDay: false, start: startUtc.toISOString(), end, timeZone: tz });
  }
  return out.slice(0, 3);
}
