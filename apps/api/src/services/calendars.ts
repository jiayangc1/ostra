import {
  CalDavCalendar,
  CalendarRequestError,
  GoogleCalendar,
  ICLOUD_CALDAV_URL,
  MicrosoftCalendar,
  type CalDavCredentials,
  type CalendarClient,
  type Fetch,
  type GoogleCalendarCredentials,
  type MicrosoftCalendarCredentials,
} from "@ostra/calendar";
import { AuthExpiredError, RateLimitedError, type CalendarConnection, type CalendarInfo, type CalendarProviderKind, type EventPlacement } from "@ostra/core";
import { and, calendarConnections, calendarPlacements, eq, messages, sql, users, type CalendarConnectionRow } from "@ostra/db";
import { HttpError, badRequest, notFound } from "../lib/errors.ts";
import { assertPublicHost, UnsafeHostError } from "../lib/ssrf.ts";
import type { Config } from "../config.ts";
import type { Services } from "./context.ts";
import { settingsOf, updateSettings } from "./users.ts";

export type { CalDavCredentials };
export type CalendarCredentials = GoogleCalendarCredentials | MicrosoftCalendarCredentials | CalDavCredentials;

export interface CalendarContext {
  provider: CalendarProviderKind;
  credentials: CalendarCredentials;
  /** Persist refreshed tokens or discovered CalDAV URLs. */
  save(next: CalendarCredentials): Promise<void>;
}

export type CalendarFactory = (ctx: CalendarContext) => CalendarClient;

/**
 * fetch for user-supplied CalDAV servers: https only, public hosts only,
 * checked again on every request and redirect hop.
 */
export function guardedFetch(config: Pick<Config, "allowPrivateMailHosts">, f: Fetch = fetch): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:" && !config.allowPrivateMailHosts) throw new UnsafeHostError("Calendar servers must use https.");
    await assertPublicHost(url.hostname, { allowPrivate: config.allowPrivateMailHosts });
    return f(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) });
  }) as Fetch;
}

export function defaultCalendarFactory(config: Config): CalendarFactory {
  const davFetch = guardedFetch(config);
  return (ctx) => {
    if (ctx.provider === "google") {
      if (!config.google) throw new HttpError(503, "Google sign-in isn't configured on this server.", "provider_unavailable");
      return new GoogleCalendar(ctx.credentials as GoogleCalendarCredentials, { clientId: config.google.clientId, clientSecret: config.google.clientSecret, save: (c) => ctx.save(c) });
    }
    if (ctx.provider === "microsoft") {
      if (!config.microsoft) throw new HttpError(503, "Microsoft sign-in isn't configured on this server.", "provider_unavailable");
      return new MicrosoftCalendar(ctx.credentials as MicrosoftCalendarCredentials, { ...config.microsoft, save: (c) => ctx.save(c) });
    }
    return new CalDavCalendar(ctx.credentials as CalDavCredentials, { fetch: davFetch, save: (c) => ctx.save(c) });
  };
}

function serverLabel(row: Pick<CalendarConnectionRow, "provider">, creds: CalendarCredentials | null): string | null {
  if (row.provider !== "caldav" || !creds) return null;
  const host = new URL((creds as CalDavCredentials).serverUrl).hostname;
  return host.endsWith("icloud.com") ? "iCloud" : host;
}

export function toConnectionDto(s: Services, row: CalendarConnectionRow): CalendarConnection {
  let creds: CalendarCredentials | null = null;
  try {
    creds = s.envelope.decryptJson<CalendarCredentials>(row.encryptedCredentials);
  } catch {
    // Unreadable credentials just mean no server label.
  }
  return { id: row.id, provider: row.provider, account: row.account, serverLabel: serverLabel(row, creds), status: row.status, error: row.statusMessage, calendars: row.calendars };
}

export async function getConnection(s: Services, userId: string, id: string): Promise<CalendarConnectionRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Calendar not found");
  const [row] = await s.db.select().from(calendarConnections).where(and(eq(calendarConnections.id, id), eq(calendarConnections.userId, userId)));
  if (!row) throw notFound("Calendar not found");
  return row;
}

function clientFor(s: Services, row: CalendarConnectionRow): CalendarClient {
  const credentials = s.envelope.decryptJson<CalendarCredentials>(row.encryptedCredentials);
  return s.calendars({
    provider: row.provider,
    credentials,
    save: async (next) => {
      await s.db.update(calendarConnections).set({ encryptedCredentials: s.envelope.encryptJson(next) }).where(eq(calendarConnections.id, row.id));
    },
  });
}

/** Run a call against a connection, turning provider failures into answers the UI can show. */
async function withClient<T>(s: Services, row: CalendarConnectionRow, fn: (c: CalendarClient) => Promise<T>): Promise<T> {
  try {
    const out = await fn(clientFor(s, row));
    if (row.status !== "active") await s.db.update(calendarConnections).set({ status: "active", statusMessage: null }).where(eq(calendarConnections.id, row.id));
    return out;
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      await s.db.update(calendarConnections).set({ status: "needs_reauth", statusMessage: "Sign in again to keep adding events." }).where(eq(calendarConnections.id, row.id));
      throw new HttpError(409, `${row.account} needs you to sign in again.`, "calendar_reauth");
    }
    if (err instanceof RateLimitedError) throw new HttpError(429, "The calendar is busy. Try again in a minute.", "calendar_throttled");
    if (err instanceof CalendarRequestError) throw new HttpError(502, err.message, "calendar_rejected");
    if (err instanceof HttpError) throw err;
    s.log.warn("calendar call failed", { connectionId: row.id, provider: row.provider }, err);
    throw new HttpError(502, "Couldn't reach the calendar. Try again.", "calendar_unavailable");
  }
}

/**
 * Store a newly verified connection, or refresh one the user connected
 * before (same provider and account). The first calendar connected becomes
 * the default for "Add to calendar".
 */
export async function saveConnection(s: Services, userId: string, provider: CalendarProviderKind, credentials: CalendarCredentials, client: CalendarClient): Promise<CalendarConnectionRow> {
  const account = await client.whoami();
  const calendars = await client.listCalendars();
  if (calendars.length === 0) throw badRequest("That account has no calendars Ostra can add events to.", "no_calendars");
  // CalDAV discovery may have filled in the home URL.
  const creds = client instanceof CalDavCalendar ? client.credentials : credentials;
  const encryptedCredentials = s.envelope.encryptJson(creds);
  const [existing] = await s.db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, provider), sql`lower(${calendarConnections.account}) = ${account.toLowerCase()}`));
  const [row] = existing
    ? await s.db.update(calendarConnections).set({ encryptedCredentials, calendars, status: "active", statusMessage: null }).where(eq(calendarConnections.id, existing.id)).returning()
    : await s.db.insert(calendarConnections).values({ userId, provider, account, encryptedCredentials, calendars, status: "active" }).returning();
  const [user] = await s.db.select().from(users).where(eq(users.id, userId));
  if (user && !settingsOf(user).defaultCalendar) {
    const main = calendars.find((c) => c.primary) ?? calendars[0]!;
    await updateSettings(s.db, userId, { defaultCalendar: { connectionId: row!.id, calendarId: main.id } });
  }
  return row!;
}

/** Verify an Apple ID (or any CalDAV login) and save it. */
export async function connectCalDav(s: Services, userId: string, input: { serverUrl?: string | undefined; username: string; password: string }) {
  const serverUrl = input.serverUrl?.trim() || ICLOUD_CALDAV_URL;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(serverUrl) ? serverUrl : `https://${serverUrl}`);
  } catch {
    throw badRequest("That server address doesn't look right.", "invalid_server");
  }
  const credentials: CalDavCredentials = { serverUrl: url.toString(), username: input.username.trim(), password: input.password.replace(/\s+/g, "") };
  const client = s.calendars({ provider: "caldav", credentials, save: async () => {} });
  try {
    return await saveConnection(s, userId, "caldav", credentials, client);
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      const apple = url.hostname.endsWith("icloud.com");
      throw badRequest(apple ? "Apple didn't accept that. Use an app-specific password, not your Apple ID password." : "The server didn't accept that username and password.", "bad_credentials");
    }
    if (err instanceof UnsafeHostError) throw badRequest(err.message, "unsafe_host");
    if (err instanceof CalendarRequestError) throw badRequest(err.message, "not_caldav");
    if (err instanceof HttpError) throw err;
    s.log.warn("caldav connect failed", {}, err);
    throw badRequest("Couldn't reach that calendar server.", "unreachable");
  }
}

export async function refreshCalendars(s: Services, row: CalendarConnectionRow): Promise<CalendarConnectionRow> {
  const calendars = await withClient(s, row, (c) => c.listCalendars());
  const [next] = await s.db.update(calendarConnections).set({ calendars, status: "active", statusMessage: null }).where(eq(calendarConnections.id, row.id)).returning();
  return next!;
}

export async function removeConnection(s: Services, userId: string, row: CalendarConnectionRow): Promise<void> {
  await s.db.delete(calendarConnections).where(eq(calendarConnections.id, row.id));
  const [user] = await s.db.select().from(users).where(eq(users.id, userId));
  if (user && settingsOf(user).defaultCalendar?.connectionId === row.id) {
    const [other] = await s.db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId)).limit(1);
    const cal = other?.calendars.find((c) => c.primary) ?? other?.calendars[0];
    await updateSettings(s.db, userId, { defaultCalendar: other && cal ? { connectionId: other.id, calendarId: cal.id } : null });
  }
}

export async function messageEvent(s: Services, userId: string, messageId: string, index: number) {
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) throw notFound("Message not found");
  const [m] = await s.db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.userId, userId)));
  const event = m?.extracted.events?.[index];
  if (!m || !event) throw notFound("Event not found");
  return { message: m, event };
}

/** Put one event from a message on a calendar: the one asked for, else the user's default. */
export async function addEventToCalendar(s: Services, userId: string, messageId: string, index: number, target: { connectionId?: string | undefined; calendarId?: string | undefined }): Promise<EventPlacement> {
  const { event } = await messageEvent(s, userId, messageId, index);
  const [user] = await s.db.select().from(users).where(eq(users.id, userId));
  const fallback = user ? settingsOf(user).defaultCalendar : null;
  const connectionId = target.connectionId ?? fallback?.connectionId;
  if (!connectionId) throw badRequest("Connect a calendar first.", "no_calendar");
  const row = await getConnection(s, userId, connectionId);
  const calendarId = target.calendarId ?? (fallback?.connectionId === row.id ? fallback.calendarId : null) ?? (row.calendars.find((c) => c.primary) ?? row.calendars[0])?.id;
  const calendar: CalendarInfo | undefined = row.calendars.find((c) => c.id === calendarId);
  if (!calendarId || !calendar) throw badRequest("Pick one of that account's calendars.", "unknown_calendar");

  const created = await withClient(s, row, (c) => c.createEvent(calendarId, event, `${messageId}:${index}`));
  const [p] = await s.db
    .insert(calendarPlacements)
    .values({ messageId, eventIndex: index, connectionId: row.id, calendarId, providerEventId: created.id, url: created.url })
    .onConflictDoUpdate({
      target: [calendarPlacements.messageId, calendarPlacements.eventIndex, calendarPlacements.connectionId, calendarPlacements.calendarId],
      set: { providerEventId: created.id, url: created.url },
    })
    .returning();
  return { connectionId: row.id, calendarId, calendarName: calendar.name, url: p!.url, addedAt: p!.createdAt.toISOString() };
}
