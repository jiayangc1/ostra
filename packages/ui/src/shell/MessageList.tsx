import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Account, Color, Label, ThreadSummary } from "@ostra/core";
import { displayName } from "@ostra/core";
import { Archive, Bell, ChevronRight, Mail, MailOpen, Newspaper, Paperclip, Tag, Trash2 } from "lucide-react";
import { Avatar } from "../components/Avatar.tsx";
import { Badge } from "../components/Badge.tsx";
import { Dot } from "../components/Dot.tsx";
import { ListRow } from "../components/ListRow.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { CATEGORY_NAMES, relativeTime } from "../app/format.ts";
import type { Row } from "./rows.ts";

const BUNDLE_ICON = { newsletter: Newspaper, notification: Bell, promotion: Tag } as const;

export type RowAction = "archive" | "trash" | "markRead" | "markUnread";

interface Props {
  /** Identifies the list; switching lists never animates rows in or out. */
  listKey: string;
  rows: Row[];
  threads: Record<string, ThreadSummary>;
  accounts: Map<string, Account>;
  labels: Map<string, Label>;
  cursor: number;
  openId: string | null;
  onActivate: (index: number) => void;
  onAction: (id: string, action: RowAction) => void;
  onEndReached: () => void;
  /** Archive only makes sense where mail can leave the inbox. */
  canArchive: boolean;
}

type Ghost = { id: string; index: number; thread: ThreadSummary; nested: boolean };

/**
 * Rows that just left (archived, trashed) stay for one collapse animation;
 * rows that just arrived (new mail, undo) grow in. Bulk changes skip both.
 */
function useRowMotion(listKey: string, rows: Row[], threads: Record<string, ThreadSummary>) {
  const [track, setTrack] = useState({ key: listKey, rows, ghosts: [] as Ghost[], entering: [] as string[], stamp: 0 });

  // Diffed during render (no effect pass): rows that left become ghosts, rows that arrived animate in.
  if (track.rows !== rows || track.key !== listKey) {
    let ghosts: Ghost[] = [];
    let entering: string[] = [];
    if (track.key === listKey) {
      const now = new Set(rows.flatMap((r) => (r.kind === "thread" ? [r.id] : [])));
      const was = new Set(track.rows.flatMap((r) => (r.kind === "thread" ? [r.id] : [])));
      const removed: Ghost[] = [];
      track.rows.forEach((r, index) => {
        if (r.kind === "thread" && !now.has(r.id) && threads[r.id]) removed.push({ id: r.id, index, thread: threads[r.id]!, nested: !!r.bundle });
      });
      const added = [...now].filter((id) => !was.has(id));
      ghosts = track.ghosts.filter((g) => !now.has(g.id));
      entering = track.entering.filter((id) => now.has(id));
      // Collapsing a bundle removes many rows at once: that's a layout change, not mail leaving.
      if (removed.length > 0 && removed.length <= 3 && !removed.some((g) => g.nested)) ghosts = [...ghosts, ...removed];
      if (added.length > 0 && added.length <= 3) entering = [...entering, ...added];
    }
    setTrack({ key: listKey, rows, ghosts, entering, stamp: track.stamp + 1 });
  }

  const busy = track.ghosts.length > 0 || track.entering.length > 0;
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setTrack((s) => ({ ...s, ghosts: [], entering: [] })), 340);
    return () => clearTimeout(t);
  }, [busy, track.stamp]);

  return { ghosts: track.ghosts, entering: new Set(track.entering) };
}

export function MessageList({ listKey, rows, threads, accounts, labels, cursor, openId, onActivate, onAction, onEndReached, canArchive }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // Stable handlers, so memoized rows don't all re-render when one thread changes.
  const latest = useRef({ onActivate, onAction, onEndReached });
  useEffect(() => {
    latest.current = { onActivate, onAction, onEndReached };
  });
  const activate = useCallback((i: number) => latest.current.onActivate(i), []);
  const act = useCallback((id: string, a: RowAction) => latest.current.onAction(id, a), []);
  const { ghosts, entering } = useRowMotion(listKey, rows, threads);

  // Keep the keyboard cursor in view.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // Infinite scroll. One observer per list; it reads the latest callback through the ref.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current.onEndReached(), { root: ref.current, rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [listKey]);

  const items: ReactNode[] = rows.map((row, i) => (
    <div key={row.kind === "bundle" ? `b:${row.category}` : `t:${row.id}`} role="none" className={cn(row.kind === "thread" && entering.has(row.id) && "grid animate-enter-row [&>*]:min-h-0 [&>*]:overflow-hidden")}>
      {row.kind === "bundle" ? (
        <BundleRow index={i} row={row} active={i === cursor} onActivate={activate} />
      ) : (
        <ThreadRow
          index={i}
          thread={threads[row.id]!}
          nested={!!row.bundle}
          active={i === cursor}
          selected={row.id === openId}
          accounts={accounts}
          labels={labels}
          canArchive={canArchive}
          onActivate={activate}
          onAction={act}
        />
      )}
    </div>
  ));
  for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
    items.splice(
      Math.min(g.index, items.length),
      0,
      <div key={`ghost:${g.id}`} role="none" aria-hidden="true" className="pointer-events-none grid animate-collapse [&>*]:min-h-0 [&>*]:overflow-hidden">
        <div>
          <ThreadRow index={-1} thread={g.thread} nested={g.nested} active={false} selected={false} accounts={accounts} labels={labels} canArchive={false} onActivate={activate} onAction={act} />
        </div>
      </div>,
    );
  }

  return (
    <div ref={ref} role="listbox" aria-label="Messages" className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto py-2" tabIndex={-1}>
      {items}
      <div ref={sentinel} className="h-px shrink-0" />
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
  canArchive,
  onActivate,
  onAction,
}: {
  thread: ThreadSummary;
  index: number;
  nested: boolean;
  active: boolean;
  selected: boolean;
  accounts: Map<string, Account>;
  labels: Map<string, Label>;
  canArchive: boolean;
  onActivate: (index: number) => void;
  onAction: (id: string, action: RowAction) => void;
}) {
  const colors = t.accountIds.map((id) => accounts.get(id)?.color).filter((c): c is Color => !!c);
  const names = t.accountIds.map((id) => accounts.get(id)?.displayName ?? "").filter(Boolean);
  const sender = displayName(t.from);
  const unread = !t.isRead;
  return (
    <ListRow
      data-row={index >= 0 ? index : undefined}
      data-thread-id={t.id}
      active={active}
      selected={selected}
      unread={unread}
      onClick={() => onActivate(index)}
      className={cn(nested && "ml-6")}
      leading={
        <span className="relative mt-0.5 flex">
          <Avatar
            name={sender}
            seed={t.from.address}
            size={nested ? 24 : 28}
            badge={colors.length > 0 ? <Dot color={colors[0]!} size={8} label={names.join(", ")} /> : undefined}
          />
        </span>
      }
    >
      <div className="flex items-center gap-2">
        {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue" aria-hidden="true" />}
        <span className={cn("truncate text-[13px]", unread ? "font-semibold text-fg" : "font-medium text-fg-2")}>{sender}</span>
        {t.messageCount > 1 && <span className="shrink-0 font-mono text-[11px] text-fg-3">{t.messageCount}</span>}
        <span className="relative ml-auto flex shrink-0 items-center">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-fg-3 transition-opacity duration-[var(--motion-fast)] group-hover/row:opacity-0">
            {t.hasAttachments && <Paperclip size={11} aria-label="Has attachments" />}
            <time dateTime={t.lastMessageAt}>{relativeTime(t.lastMessageAt)}</time>
          </span>
          {index >= 0 && (
            <span className="absolute -right-1 top-1/2 flex -translate-y-1/2 translate-x-1 items-center gap-0.5 opacity-0 transition-[opacity,translate] duration-[var(--motion-fast)] ease-out group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
              {canArchive && (
                <RowButton label="Archive" shortcut="e" onClick={() => onAction(t.id, "archive")}>
                  <Archive size={13} />
                </RowButton>
              )}
              <RowButton label="Trash" shortcut="#" onClick={() => onAction(t.id, "trash")}>
                <Trash2 size={13} />
              </RowButton>
              <RowButton label={unread ? "Mark as read" : "Mark as unread"} shortcut={unread ? "shift+i" : "shift+u"} onClick={() => onAction(t.id, unread ? "markRead" : "markUnread")}>
                {unread ? <MailOpen size={13} /> : <Mail size={13} />}
              </RowButton>
            </span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[13px]">
        {unread && <span className="sr-only">Unread.</span>}
        <span className={cn("truncate", unread ? "text-fg" : "text-fg-2")}>{t.subject || "(no subject)"}</span>
      </div>
      {t.snippet && <p className="truncate text-[12.5px] leading-snug text-fg-3">{t.snippet}</p>}
      {t.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
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

function RowButton({ label, shortcut, onClick, children }: { label: string; shortcut: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} shortcut={shortcut} align="end" delay={600}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="o-press flex h-6 w-6 items-center justify-center rounded-[5px] bg-panel text-fg-3 shadow-raised hover:text-fg"
      >
        {children}
      </button>
    </Tooltip>
  );
}

const BundleRow = memo(function BundleRow({ row, index, active, onActivate }: { row: Extract<Row, { kind: "bundle" }>; index: number; active: boolean; onActivate: (index: number) => void }) {
  const Icon = BUNDLE_ICON[row.category];
  return (
    <ListRow
      data-row={index}
      data-bundle={row.category}
      aria-expanded={row.expanded}
      active={active}
      onClick={() => onActivate(index)}
      className="items-center py-2"
      leading={
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-fg-3">
          <Icon size={13} aria-hidden="true" />
        </span>
      }
      trailing={
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cn("shrink-0 text-fg-3 transition-transform duration-[var(--motion-normal)] ease-spring", row.expanded && "rotate-90")}
        />
      }
    >
      <span className="flex items-center gap-2 text-[13px]">
        <span className={cn("font-medium", row.unread ? "text-fg" : "text-fg-2")}>{CATEGORY_NAMES[row.category]}</span>
        <span className="font-mono text-[11px] text-fg-3">{row.ids.length}</span>
        {row.unread > 0 && <span className="rounded-full bg-blue-bg px-1.5 py-px text-[11px] font-medium text-blue">{row.unread} new</span>}
      </span>
    </ListRow>
  );
});
