import type { CalendarInfo, ExtractedEvent } from "@ostra/core";
import { eventEnd } from "@ostra/core";
import { HttpError, OAuthSession, type OAuthTokens } from "@ostra/core/oauth";
import { CalendarRequestError, describe, stableEventId, type CalendarClient, type CreatedEvent, type Fetch } from "./types.ts";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

/**
 * The narrowest calendar scopes that do the job: add events to calendars
 * the person owns, and list those calendars. Nothing here reads existing
 * events, and the mail scopes aren't involved.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

export interface GoogleCalendarCredentials {
  tokens: OAuthTokens;
}

export function googleCalendarAuthUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | undefined }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

function time(e: ExtractedEvent, at: string): GoogleEventTime {
  if (e.allDay) return { date: at };
  return e.timeZone ? { dateTime: at, timeZone: e.timeZone } : { dateTime: at };
}

/** The Google Calendar body for an event. */
export function googleEventBody(e: ExtractedEvent, id: string) {
  return {
    id,
    summary: e.title,
    ...(e.location ? { location: e.location } : {}),
    ...(describe(e) ? { description: describe(e) } : {}),
    start: time(e, e.start),
    end: time(e, eventEnd(e)),
    ...(e.rrule ? { recurrence: [`RRULE:${e.rrule}`] } : {}),
  };
}

export class GoogleCalendar implements CalendarClient {
  private readonly session: OAuthSession;

  constructor(
    creds: GoogleCalendarCredentials,
    opts: { clientId: string; clientSecret: string; save: (c: GoogleCalendarCredentials) => Promise<void>; fetch?: Fetch },
  ) {
    this.session = new OAuthSession(creds.tokens, { tokenUrl: GOOGLE_TOKEN_URL, clientId: opts.clientId, clientSecret: opts.clientSecret }, (tokens) => opts.save({ tokens }), opts.fetch);
  }

  async whoami(): Promise<string> {
    const me = await this.session.json<{ email?: string }>("https://openidconnect.googleapis.com/v1/userinfo");
    if (!me.email) throw new Error("Google didn't share the account's address.");
    return me.email.toLowerCase();
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const r = await this.session.json<{ items?: { id: string; summary: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; accessRole: string }[] }>(
      `${API}/users/me/calendarList?minAccessRole=owner&maxResults=250`,
    );
    return (r.items ?? [])
      .map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary, color: c.backgroundColor ?? null, primary: !!c.primary }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  async createEvent(calendarId: string, e: ExtractedEvent, key: string): Promise<CreatedEvent> {
    const id = stableEventId(key, calendarId);
    const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
    try {
      const r = await this.session.json<{ id: string; htmlLink?: string }>(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(googleEventBody(e, id)),
      });
      return { id: r.id, url: r.htmlLink ?? null };
    } catch (err) {
      // Same event already added to this calendar: return the existing one.
      if (err instanceof HttpError && err.status === 409) {
        const r = await this.session.json<{ id: string; htmlLink?: string }>(`${base}/${id}`);
        return { id: r.id, url: r.htmlLink ?? null };
      }
      if (err instanceof HttpError && (err.status === 400 || err.status === 403 || err.status === 404)) throw new CalendarRequestError(err.message, err.status);
      throw err;
    }
  }
}
