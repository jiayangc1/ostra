import type { CalendarInfo, ExtractedEvent } from "@ostra/core";
import { eventEnd } from "@ostra/core";
import { HttpError, OAuthSession, type OAuthTokens } from "@ostra/core/oauth";
import { CalendarRequestError, describe, stableEventId, type CalendarClient, type CreatedEvent, type Fetch } from "./types.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Calendar-only: add events and list calendars. No mail scopes. */
export const MS_CALENDAR_SCOPES = ["offline_access", "openid", "email", "profile", "User.Read", "Calendars.ReadWrite"];
export const msCalendarTokenUrl = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

export interface MicrosoftCalendarCredentials {
  tokens: OAuthTokens;
}

export function microsoftCalendarAuthUrl(p: { clientId: string; tenant: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | undefined }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: MS_CALENDAR_SCOPES.join(" "),
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  });
  return `https://login.microsoftonline.com/${p.tenant}/oauth2/v2.0/authorize?${q}`;
}

/** Graph wants wall time plus a zone name; UTC with no "Z" is always accepted. */
const graphUtc = (iso: string) => iso.replace(/Z$/, "").replace(/(\.\d{3})?$/, "");

/** The Graph body for an event. Graph's recurrence format differs from RRULE, so repeats aren't carried over. */
export function graphEventBody(e: ExtractedEvent, transactionId: string) {
  const end = eventEnd(e);
  const description = describe(e);
  return {
    subject: e.title,
    ...(description ? { body: { contentType: "text", content: description } } : {}),
    ...(e.location ? { location: { displayName: e.location } } : {}),
    isAllDay: e.allDay,
    start: e.allDay ? { dateTime: `${e.start}T00:00:00`, timeZone: "UTC" } : { dateTime: graphUtc(e.start), timeZone: "UTC" },
    end: e.allDay ? { dateTime: `${end}T00:00:00`, timeZone: "UTC" } : { dateTime: graphUtc(end), timeZone: "UTC" },
    // Graph drops a second create with the same transactionId.
    transactionId,
  };
}

export class MicrosoftCalendar implements CalendarClient {
  private readonly session: OAuthSession;

  constructor(
    creds: MicrosoftCalendarCredentials,
    opts: { clientId: string; clientSecret: string; tenant: string; save: (c: MicrosoftCalendarCredentials) => Promise<void>; fetch?: Fetch },
  ) {
    this.session = new OAuthSession(
      creds.tokens,
      { tokenUrl: msCalendarTokenUrl(opts.tenant), clientId: opts.clientId, clientSecret: opts.clientSecret, refreshParams: { scope: MS_CALENDAR_SCOPES.join(" ") } },
      (tokens) => opts.save({ tokens }),
      opts.fetch,
    );
  }

  async whoami(): Promise<string> {
    const me = await this.session.json<{ mail?: string | null; userPrincipalName?: string }>(`${GRAPH}/me?$select=mail,userPrincipalName`);
    const address = me.mail ?? me.userPrincipalName;
    if (!address) throw new Error("Microsoft didn't share the account's address.");
    return address.toLowerCase();
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    const r = await this.session.json<{ value: { id: string; name: string; hexColor?: string; isDefaultCalendar?: boolean; canEdit?: boolean }[] }>(
      `${GRAPH}/me/calendars?$select=id,name,hexColor,isDefaultCalendar,canEdit&$top=100`,
    );
    return r.value
      .filter((c) => c.canEdit !== false)
      .map((c) => ({ id: c.id, name: c.name, color: c.hexColor || null, primary: !!c.isDefaultCalendar }))
      .sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  async createEvent(calendarId: string, e: ExtractedEvent, key: string): Promise<CreatedEvent> {
    try {
      const r = await this.session.json<{ id: string; webLink?: string }>(`${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(graphEventBody(e, stableEventId(key, calendarId))),
      });
      return { id: r.id, url: r.webLink ?? null };
    } catch (err) {
      if (err instanceof HttpError && (err.status === 400 || err.status === 403 || err.status === 404)) throw new CalendarRequestError(err.message, err.status);
      throw err;
    }
  }
}
