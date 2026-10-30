const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Compact mono timestamps for the list: 4m, 3h, Tue, Oct 3, 2025. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (diff < MIN) return "now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  const d = new Date(t);
  if (diff < 6 * DAY) return d.toLocaleDateString(undefined, { weekday: "short" });
  if (d.getFullYear() === new Date(now).getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
}

/** Full timestamp for the reader. */
export function fullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const CATEGORY_NAMES = {
  primary: "Primary",
  newsletter: "Newsletters",
  notification: "Notifications",
  promotion: "Promotions",
} as const;

/** A local Date for a YYYY-MM-DD calendar date (no zone shift). */
const localDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, day);
};

const dayFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** "Thu, Nov 5 · 7:00 – 8:30 PM", "Sat, Nov 14 – Sun, Nov 15", in the viewer's zone. */
export function eventTime(e: { allDay: boolean; start: string; end: string | null }, timeZone?: string): string {
  if (e.allDay) {
    const start = localDate(e.start);
    const lastDay = e.end ? localDate(e.end) : start;
    if (e.end) lastDay.setDate(lastDay.getDate() - 1);
    const a = start.toLocaleDateString(undefined, dayFmt);
    return lastDay > start ? `${a} – ${lastDay.toLocaleDateString(undefined, dayFmt)}` : `${a} · All day`;
  }
  const opts = timeZone ? { timeZone } : {};
  const start = new Date(e.start);
  const day = start.toLocaleDateString(undefined, { ...dayFmt, ...opts });
  const from = start.toLocaleTimeString(undefined, { ...timeFmt, ...opts });
  if (!e.end) return `${day} · ${from}`;
  const end = new Date(e.end);
  const endDay = end.toLocaleDateString(undefined, { ...dayFmt, ...opts });
  const to = end.toLocaleTimeString(undefined, { ...timeFmt, ...opts });
  return endDay === day ? `${day} · ${from} – ${to}` : `${day} ${from} – ${endDay} ${to}`;
}

/** Month and day for the date block on an event card. */
export function eventDateParts(e: { allDay: boolean; start: string }): { month: string; day: string } {
  const d = e.allDay ? localDate(e.start) : new Date(e.start);
  return { month: d.toLocaleDateString(undefined, { month: "short" }).toUpperCase(), day: String(d.getDate()) };
}

/** The event was written in a different zone than the viewer's: "7:00 PM ET" style hint. */
export function originalZoneTime(e: { allDay: boolean; start: string; timeZone: string | null }, viewerZone: string | undefined): string | null {
  if (e.allDay || !e.timeZone || !viewerZone || e.timeZone === viewerZone) return null;
  const opts = { timeZone: e.timeZone, ...timeFmt, timeZoneName: "short" } as const;
  const a = new Date(e.start).toLocaleTimeString(undefined, opts);
  const b = new Date(e.start).toLocaleTimeString(undefined, { ...opts, timeZone: viewerZone });
  return a === b ? null : a;
}
