import { memo, useCallback, useEffect, useRef } from "react";
import type { Account, Color, Label, ThreadSummary } from "@ostra/core";
import { displayName } from "@ostra/core";
import { Bell, ChevronRight, Newspaper, Paperclip, Tag } from "lucide-react";
import { Badge } from "../components/Badge.tsx";
import { DotStack } from "../components/Dot.tsx";
import { ListRow } from "../components/ListRow.tsx";
import { cn } from "../lib/cn.ts";
import { CATEGORY_NAMES, relativeTime } from "../app/format.ts";
import type { Row } from "./rows.ts";

const BUNDLE_ICON = { newsletter: Newspaper, notification: Bell, promotion: Tag } as const;

interface Props {
  rows: Row[];
  threads: Record<string, ThreadSummary>;
  accounts: Map<string, Account>;
  labels: Map<string, Label>;
  cursor: number;
  openId: string | null;
  onActivate: (index: number) => void;
  onHover?: (index: number) => void;
  onEndReached: () => void;
}

export function MessageList({ rows, threads, accounts, labels, cursor, openId, onActivate, onEndReached }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // A stable click handler, so memoized rows don't all re-render when one thread changes.
  const latest = useRef(onActivate);
  useEffect(() => {
    latest.current = onActivate;
  });
  const activate = useCallback((i: number) => latest.current(i), []);

  // Keep the keyboard cursor in view.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onEndReached(), { root: ref.current, rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onEndReached]);

  return (
    <div ref={ref} role="listbox" aria-label="Messages" className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
      {rows.map((row, i) =>
        row.kind === "bundle" ? (
          <BundleRow key={`b:${row.category}`} index={i} row={row} active={i === cursor} onActivate={activate} />
        ) : (
          <ThreadRow
            key={`t:${row.id}`}
            index={i}
            thread={threads[row.id]!}
            nested={!!row.bundle}
            active={i === cursor}
            selected={row.id === openId}
            accounts={accounts}
            labels={labels}
            onActivate={activate}
          />
        ),
      )}
      <div ref={sentinel} className="h-px" />
    </div>
  );
}

const ThreadRow = memo(function ThreadRow({
  thread: t,
  index,
  nested,
  active,
  selected,
  accounts,
  labels,
  onActivate,
}: {
  thread: ThreadSummary;
  index: number;
  nested: boolean;
  active: boolean;
  selected: boolean;
  accounts: Map<string, Account>;
  labels: Map<string, Label>;
  onActivate: (index: number) => void;
}) {
  const colors = t.accountIds.map((id) => accounts.get(id)?.color).filter((c): c is Color => !!c);
  const names = t.accountIds.map((id) => accounts.get(id)?.displayName ?? "");
  const sender = displayName(t.from);
  return (
    <ListRow
      data-row={index}
      data-thread-id={t.id}
      active={active}
      selected={selected}
      unread={!t.isRead}
      onClick={() => onActivate(index)}
      className={cn(nested && "bg-surface pl-7")}
      leading={
        <span className="mt-[7px] flex w-3 shrink-0 justify-center">
          <DotStack colors={colors.length ? colors : ["gray"]} labels={names} />
        </span>
      }
    >
      <div className="flex items-baseline gap-2">
        <span className={cn("truncate text-sm", t.isRead ? "text-fg-2" : "font-medium text-fg")}>
          {sender}
          {t.messageCount > 1 && <span className="ml-1.5 font-mono text-[11px] font-normal text-fg-3">{t.messageCount}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-fg-3">
          {t.hasAttachments && <Paperclip size={11} aria-label="Has attachments" />}
          <time dateTime={t.lastMessageAt}>{relativeTime(t.lastMessageAt)}</time>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        {!t.isRead && <span className="sr-only">Unread.</span>}
        <span className={cn("truncate text-[13px]", t.isRead ? "text-fg-3" : "text-fg-2")}>{t.subject || "(no subject)"}</span>
      </div>
      {t.labels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {t.labels.map((l) => {
            const label = labels.get(l.labelId);
            if (!label) return null;
            return (
              <Badge key={l.labelId} color={label.color} title={l.source === "ai" ? "Applied automatically" : undefined}>
                {label.name}
              </Badge>
            );
          })}
        </div>
      )}
    </ListRow>
  );
});

const BundleRow = memo(function BundleRow({ row, index, active, onActivate }: { row: Extract<Row, { kind: "bundle" }>; index: number; active: boolean; onActivate: (index: number) => void }) {
  const Icon = BUNDLE_ICON[row.category];
  return (
    <ListRow
      data-row={index}
      data-bundle={row.category}
      aria-expanded={row.expanded}
      active={active}
      onClick={() => onActivate(index)}
      className="py-2"
      leading={<Icon size={13} className="mt-[3px] w-3 shrink-0 text-fg-3" aria-hidden="true" />}
      trailing={
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cn("mt-[3px] shrink-0 text-fg-3 transition-transform duration-[var(--motion-normal)] ease-spring", row.expanded && "rotate-90")}
        />
      }
    >
      <span className={cn("text-[13px]", row.unread ? "text-fg" : "text-fg-3")}>
        {CATEGORY_NAMES[row.category]}
        <span className="ml-1.5 font-mono text-[12px] text-fg-3">· {row.ids.length}</span>
        {row.unread > 0 && <span className="ml-2 font-mono text-[11px] text-blue">{row.unread} new</span>}
      </span>
    </ListRow>
  );
});
