import { createHash } from "node:crypto";
import type { CalendarInfo, ExtractedEvent } from "@ostra/core";

export type Fetch = typeof fetch;

export interface CreatedEvent {
  /** Provider-side id (Google/Graph event id, or the CalDAV resource URL). */
  id: string;
  /** Opens the event in the calendar's own app, when the provider gives a link. */
  url: string | null;
}

/**
 * One calendar account. Every provider takes the same event shape, so the
 * API never knows which calendar it's talking to.
 */
export interface CalendarClient {
  /** The signed-in address or Apple ID. */
  whoami(): Promise<string>;
  /** Calendars the account can add events to. */
  listCalendars(): Promise<CalendarInfo[]>;
  /**
   * Add an event. `key` identifies this event from this message, so adding
   * it twice doesn't make a duplicate.
   */
  createEvent(calendarId: string, event: ExtractedEvent, key: string): Promise<CreatedEvent>;
}

/** The provider rejected the event or request (not auth, not throttling). */
export class CalendarRequestError extends Error {
  override readonly name = "CalendarRequestError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A stable id for (event, calendar): safe as a Google event id (base32hex) or a CalDAV file name. */
export function stableEventId(key: string, calendarId: string): string {
  return `ostra${createHash("sha256").update(`${key}\n${calendarId}`).digest("hex").slice(0, 40)}`;
}

/** Text added to the event so it's clear where it came from. */
export function describe(e: ExtractedEvent): string | null {
  const parts = [e.description, e.url && !e.description?.includes(e.url) ? e.url : null].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}
