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
