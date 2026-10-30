import { useEffect, useState } from "react";
import type { CalendarConnection, MessageEvent, ThreadCode } from "@ostra/core";
import { CODE_TTL_MS } from "@ostra/core";
import { CalendarPlus, Check, ChevronDown, Copy, Download, ExternalLink, KeyRound, MapPin, Sparkles, X } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { Kbd } from "../components/Kbd.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { eventDateParts, eventTime, originalZoneTime } from "../app/format.ts";

/** A code is worth surfacing for a few minutes after it arrives. */
export function isFreshCode(code: Pick<ThreadCode, "sentAt"> | null | undefined, now = Date.now()): boolean {
  return !!code && now - Date.parse(code.sentAt) < CODE_TTL_MS && Date.parse(code.sentAt) - now < 5 * 60_000;
}

/** Re-render once a minute so fresh codes age out on their own. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "482913" split for reading: "482 913". */
const spaced = (v: string) => (/^\d{6}$/.test(v) ? `${v.slice(0, 3)} ${v.slice(3)}` : /^\d{8}$/.test(v) ? `${v.slice(0, 4)} ${v.slice(4)}` : v);

/** One-tap copy for a verification code. */
export function CodeChip({ value, onCopy, size = "md", className }: { value: string; onCopy: (v: string) => Promise<boolean>; size?: "sm" | "md"; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      // Rows are buttons too; don't open the thread when copying from the list.
      onClick={(e) => {
        e.stopPropagation();
        void onCopy(value).then((ok) => ok && setCopied(true));
      }}
      onKeyDown={(e) => e.stopPropagation()}
      aria-label={copied ? `Copied ${value}` : `Copy code ${value}`}
      className={cn(
        "o-press group inline-flex shrink-0 items-center rounded-full border font-mono tabular-nums transition-colors duration-[var(--motion-fast)]",
        size === "sm" ? "h-[18px] gap-1 px-1.5 text-[11px]" : "h-8 gap-2 px-3 text-[15px] tracking-[0.08em]",
        copied ? "border-transparent bg-green-bg text-green" : "border-line bg-surface text-fg hover:border-line-hover hover:bg-hover",
        className,
      )}
    >
      <span>{spaced(value)}</span>
      {copied ? <Check size={size === "sm" ? 11 : 14} aria-hidden="true" /> : <Copy size={size === "sm" ? 10 : 13} aria-hidden="true" className="text-fg-3 group-hover:text-fg" />}
    </button>
  );
}

/** The newest code across all mail, above the list, while it's fresh. */
export function CodeBar({ code, sender, onCopy, onOpen, onDismiss }: { code: ThreadCode; sender: string; onCopy: (v: string) => Promise<boolean>; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div role="status" className="flex animate-slide-down items-center gap-3 border-b border-line bg-surface px-4 py-2">
      <KeyRound size={14} className="shrink-0 text-blue" aria-hidden="true" />
      <button type="button" onClick={onOpen} className="o-press min-w-0 flex-1 truncate text-left text-[13px] text-fg-2 hover:text-fg">
        Code from <span className="text-fg">{sender}</span>
      </button>
      <Tooltip content="Copy code" shortcut="shift+c">
        <CodeChip value={code.value} onCopy={onCopy} size="sm" className="h-6 px-2 text-[12px]" />
      </Tooltip>
      <Button variant="tertiary" size="sm" iconOnly aria-label="Dismiss" onClick={onDismiss} className="h-6 w-6">
        <X size={13} />
      </Button>
    </div>
  );
}

export interface EventActions {
  calendars: CalendarConnection[] | null;
  defaultCalendar: { connectionId: string; calendarId: string } | null;
  onAdd: (messageId: string, event: MessageEvent) => void;
  onPick: (messageId: string, event: MessageEvent) => void;
  onDownload: (messageId: string, event: MessageEvent) => void;
  onConnect: () => void;
}

/** A calendar event found in the message, with one click to add it. */
export function EventCard({ messageId, event: e, actions, viewerZone }: { messageId: string; event: MessageEvent; actions: EventActions; viewerZone: string | undefined }) {
  const [busy, setBusy] = useState(false);
  const { month, day } = eventDateParts(e);
  const connections = actions.calendars ?? [];
  const def = actions.defaultCalendar;
  const defConn = connections.find((c) => c.id === def?.connectionId);
  const defCal = defConn?.calendars.find((c) => c.id === def?.calendarId);
  const placement = e.added[e.added.length - 1];
  const zoneHint = originalZoneTime(e, viewerZone);
  const now = useMinuteClock();
  // All-day ends are exclusive dates; read them as local midnight.
  const past = (e.allDay ? new Date(`${e.end ?? e.start}T00:00:00`).getTime() : Date.parse(e.end ?? e.start)) < now;

  const add = async () => {
    setBusy(true);
    try {
      await actions.onAdd(messageId, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Event: ${e.title}`} className={cn("flex animate-slide-up gap-4 rounded-card border border-line bg-surface p-4", past && "opacity-70")}>
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control border border-line bg-canvas" aria-hidden="true">
        <span className="font-mono text-[10px] leading-none tracking-wider text-red">{month}</span>
        <span className="mt-1 text-[18px] font-semibold leading-none tracking-[-0.02em] text-fg">{day}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 truncate text-sm font-medium text-fg">{e.title}</h3>
            {e.source === "text" && (
              <Tooltip content="Found in the message text. Check the details before adding.">
                <Sparkles size={12} className="shrink-0 text-purple" aria-label="Found by AI" />
              </Tooltip>
            )}
          </div>
          <p className="font-mono text-[12px] text-fg-2">
            {eventTime(e)}
            {zoneHint && <span className="text-fg-3"> · {zoneHint} there</span>}
            {e.rrule && <span className="text-fg-3"> · repeats</span>}
          </p>
          {e.location && (
            <p className="flex min-w-0 items-center gap-1 text-[12px] text-fg-3">
              <MapPin size={11} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{e.location}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {placement ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-control bg-green-bg px-2.5 text-[13px] text-green">
              <Check size={13} aria-hidden="true" />
              Added to {placement.calendarName ?? "calendar"}
            </span>
          ) : connections.length === 0 ? (
            <Button size="sm" variant="primary" prefix={<CalendarPlus size={13} />} onClick={actions.onConnect}>
              Connect a calendar
            </Button>
          ) : (
            <span className="inline-flex">
              <Button size="sm" variant="primary" loading={busy} prefix={<CalendarPlus size={13} />} onClick={() => void add()} className="rounded-r-none">
                Add to {defCal?.name ?? "calendar"}
              </Button>
              <Button size="sm" variant="primary" iconOnly aria-label="Choose a calendar" onClick={() => actions.onPick(messageId, e)} className="rounded-l-none border-l border-l-[color-mix(in_srgb,var(--o-primary-fg)_20%,transparent)]">
                <ChevronDown size={13} />
              </Button>
            </span>
          )}
          {placement?.url && (
            <Button size="sm" variant="tertiary" prefix={<ExternalLink size={12} />} onClick={() => window.open(placement.url!, "_blank", "noopener")}>
              Open
            </Button>
          )}
          {placement && connections.length > 0 && (
            <Button size="sm" variant="tertiary" onClick={() => actions.onPick(messageId, e)}>
              Add elsewhere
            </Button>
          )}
          <Button size="sm" variant="tertiary" prefix={<Download size={12} />} onClick={() => actions.onDownload(messageId, e)}>
            .ics
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Tiny hint shown in the reader next to a code. */
export function CodeHint() {
  return (
    <span className="text-[12px] text-fg-3">
      <Kbd keys="shift+c" /> copies the latest code from anywhere
    </span>
  );
}
