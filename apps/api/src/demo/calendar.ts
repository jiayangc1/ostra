import type { CalendarClient } from "@ostra/calendar";
import type { CalendarInfo } from "@ostra/core";

/** Demo mode only: a CalDAV login to this host is an in-memory calendar, so the whole flow works offline. */
export const DEMO_CALDAV_HOST = "demo.invalid";

const CALENDARS: CalendarInfo[] = [
  { id: "https://demo.invalid/cal/home/", name: "Home", color: "#ff2968", primary: true },
  { id: "https://demo.invalid/cal/school/", name: "School", color: "#1badf8", primary: false },
  { id: "https://demo.invalid/cal/debate/", name: "Debate", color: "#63da38", primary: false },
];

export function demoCalendar(username: string): CalendarClient {
  return {
    whoami: async () => username.toLowerCase(),
    listCalendars: async () => CALENDARS,
    createEvent: async (calendarId, _event, key) => ({ id: `${calendarId}${encodeURIComponent(key)}.ics`, url: null }),
  };
}
