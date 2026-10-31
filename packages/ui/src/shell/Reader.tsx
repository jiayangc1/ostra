import { useState, type ReactNode } from "react";
import type { Account, Label, MessageDetail, ThreadDetail, ThreadSummary } from "@ostra/core";
import { displayName, formatAddressList } from "@ostra/core";
import { AlertCircle, Archive, ArrowLeft, ChevronDown, ChevronUp, Download, Forward, Paperclip, Reply, ReplyAll, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { Avatar } from "../components/Avatar.tsx";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { Dot } from "../components/Dot.tsx";
import { Kbd } from "../components/Kbd.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { CATEGORY_NAMES, formatBytes, fullTime, relativeTime } from "../app/format.ts";
import { HtmlBody, TextBody } from "./EmailBody.tsx";
import { OstraMark } from "../brand/logo.tsx";

interface Props {
  summary: ThreadSummary | null;
  detail: ThreadDetail | null;
  error: string | null;
  accounts: Map<string, Account>;
  labels: Map<string, Label>;
  /** Single-pane layout: show a back button. */
  narrow: boolean;
  /** Where the open thread sits in the list, for "3 of 14" and prev/next. */
  position: { index: number; total: number } | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onDownload: (messageId: string, index: number, filename: string) => void;
  onAction: (action: "archive" | "trash" | "spam") => void;
  onReply: (mode: "reply" | "replyAll" | "forward", message: MessageDetail) => void;
  onLabel: () => void;
  onCategory: () => void;
  onBack: () => void;
  onRetry: () => void;
  /** The one-line AI draft and its accept handler; rendered by the composer milestone. */
  footer?: ReactNode;
}

const HINTS: { keys: string; label: string }[] = [
  { keys: "j", label: "Next" },
  { keys: "k", label: "Previous" },
  { keys: "enter", label: "Open" },
  { keys: "e", label: "Archive" },
  { keys: "r", label: "Reply" },
  { keys: "c", label: "Compose" },
  { keys: "mod+k", label: "Commands" },
  { keys: "?", label: "All shortcuts" },
];

export function Reader(props: Props) {
  const { summary, detail, error, accounts, labels, narrow, position, onPrev, onNext, onDownload, onAction, onReply, onLabel, onCategory, onBack, onRetry, footer } = props;
  if (!summary) {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-6 px-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-window border border-line bg-surface text-fg-3 shadow-raised">
            <OstraMark size={24} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-fg">No message selected</p>
            <p className="text-[13px] text-fg-3">Pick one from the list, or drive with the keyboard.</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
          {HINTS.map((h) => (
            <div key={h.keys} className="flex items-center justify-between gap-6">
              <dt className="text-fg-3">{h.label}</dt>
              <dd>
                <Kbd keys={h.keys} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  const messages = detail?.messages ?? [];
  const last = messages[messages.length - 1];

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={summary.subject || "Message"}>
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-2.5">
        {narrow && (
          <>
            <ToolbarButton label="Back to list" shortcut="esc" onClick={onBack}>
              <ArrowLeft size={15} strokeWidth={1.75} />
            </ToolbarButton>
            <Divider />
          </>
        )}
        {summary.folder === "inbox" && (
          <ToolbarButton label="Archive" shortcut="e" onClick={() => onAction("archive")} align="start">
            <Archive size={15} strokeWidth={1.75} />
          </ToolbarButton>
        )}
        <ToolbarButton label="Move to trash" shortcut="#" onClick={() => onAction("trash")}>
          <Trash2 size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <ToolbarButton label="Mark as spam" shortcut="!" onClick={() => onAction("spam")}>
          <ShieldAlert size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <Divider />
        <ToolbarButton label="Label" shortcut="l" onClick={onLabel}>
          <Tag size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <Tooltip content="Change category" shortcut="y">
          <button
            type="button"
            onClick={onCategory}
            className="o-press flex h-7 items-center gap-1 rounded-control border border-line px-2 text-[12px] font-medium text-fg-2 hover:border-line-hover hover:bg-hover hover:text-fg"
          >
            {CATEGORY_NAMES[summary.category]}
            <ChevronDown size={12} className="text-fg-3" />
          </button>
        </Tooltip>

        <div className="ml-auto flex items-center gap-0.5">
          {position && (
            <>
              <span className="hidden px-1.5 font-mono text-[11px] tabular-nums text-fg-3 sm:inline">
                {position.index + 1} / {position.total}
              </span>
              <ToolbarButton label="Previous" shortcut="k" onClick={onPrev ?? (() => {})} disabled={!onPrev}>
                <ChevronUp size={15} strokeWidth={1.75} />
              </ToolbarButton>
              <ToolbarButton label="Next" shortcut="j" onClick={onNext ?? (() => {})} disabled={!onNext} align="end">
                <ChevronDown size={15} strokeWidth={1.75} />
              </ToolbarButton>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={summary.id} className="mx-auto flex max-w-3xl animate-slide-up flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-2.5">
            <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.025em] text-fg">{summary.subject || "(no subject)"}</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
              {summary.labels.map((l) => {
                const label = labels.get(l.labelId);
                return label ? (
                  <Badge key={l.labelId} color={label.color}>
                    {label.name}
                  </Badge>
                ) : null;
              })}
              <span>
                {summary.messageCount} {summary.messageCount === 1 ? "message" : "messages"}
              </span>
              {summary.hasAttachments && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1">
                    <Paperclip size={11} /> Attachments
                  </span>
                </>
              )}
            </div>
          </div>

          {error && !detail && (
            <div role="alert" className="flex animate-slide-down items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[13px] text-fg-2">
              <AlertCircle size={15} className="shrink-0 text-red" />
              <span className="flex-1">{error}</span>
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
          {!detail && !error && <ReaderSkeleton />}
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <MessageView key={m.id} message={m} defaultOpen={i === messages.length - 1 || !m.isRead} accounts={accounts} onDownload={onDownload} onReply={onReply} />
            ))}
          </div>

          {last && (
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => onReply("reply", last)}
                className="o-press group flex w-full items-center gap-3 rounded-card border border-line bg-panel px-3.5 py-3 text-left text-[13px] text-fg-3 shadow-raised hover:border-line-hover hover:text-fg-2"
              >
                <Reply size={15} strokeWidth={1.75} className="shrink-0 transition-transform duration-[var(--motion-fast)] ease-spring group-hover:-translate-x-0.5" />
                <span className="flex-1 truncate">Reply to {displayName(last.from)}…</span>
                <Kbd keys="r" />
              </button>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="tertiary" prefix={<ReplyAll size={14} strokeWidth={1.75} />} onClick={() => onReply("replyAll", last)}>
                  Reply all
                </Button>
                <Button size="sm" variant="tertiary" prefix={<Forward size={14} strokeWidth={1.75} />} onClick={() => onReply("forward", last)}>
                  Forward
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {footer}
    </article>
  );
}

function Divider() {
  return <span className="mx-1.5 h-4 w-px bg-line" aria-hidden="true" />;
}

function ToolbarButton({
  label,
  shortcut,
  onClick,
  children,
  disabled,
  align = "center",
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  align?: "center" | "start" | "end";
}) {
  return (
    <Tooltip content={label} shortcut={shortcut} align={align}>
      <Button variant="tertiary" size="sm" iconOnly aria-label={label} aria-keyshortcuts={shortcut} onClick={onClick} disabled={disabled}>
        {children}
      </Button>
    </Tooltip>
  );
}

function MessageView({
  message: m,
  defaultOpen,
  accounts,
  onDownload,
  onReply,
}: {
  message: MessageDetail;
  defaultOpen: boolean;
  accounts: Map<string, Account>;
  onDownload: Props["onDownload"];
  onReply: Props["onReply"];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const account = m.accountIds.map((id) => accounts.get(id)).find(Boolean);
  const files = m.attachments.map((a, i) => ({ ...a, index: i })).filter((a) => !a.inline);
  const sender = displayName(m.from);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="o-press flex w-full items-center gap-3 rounded-card border border-line bg-panel px-3.5 py-2.5 text-left hover:border-line-hover hover:bg-hover"
      >
        <Avatar name={sender} seed={m.from.address} size={24} />
        <span className="shrink-0 text-[13px] font-medium text-fg">{sender}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3">{m.snippet}</span>
        <time dateTime={m.sentAt} className="shrink-0 font-mono text-[11px] text-fg-3" title={fullTime(m.sentAt)}>
          {relativeTime(m.sentAt)}
        </time>
      </button>
    );
  }

  return (
    <section className="group/msg flex animate-fade-in flex-col overflow-hidden rounded-card border border-line bg-panel shadow-raised">
      <header className="flex items-start gap-3 px-4 pt-4">
        <Avatar
          name={sender}
          seed={m.from.address}
          size={32}
          badge={account ? <Dot color={account.color} size={9} label={account.displayName} /> : undefined}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-semibold text-fg">{sender}</span>
            <span className="truncate text-[12px] text-fg-3">{m.from.address}</span>
          </div>
          <span className="truncate text-[12px] text-fg-3">to {formatAddressList([...m.to, ...m.cc].slice(0, 4)) || "undisclosed recipients"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <time dateTime={m.sentAt} className="font-mono text-[11px] text-fg-3">
            {fullTime(m.sentAt)}
          </time>
          <Tooltip content="Reply" align="end">
            <button
              type="button"
              aria-label={`Reply to ${sender}`}
              onClick={() => onReply("reply", m)}
              className="o-press -my-1 flex h-7 w-7 items-center justify-center rounded-control text-fg-3 opacity-0 transition-opacity hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/msg:opacity-100"
            >
              <Reply size={14} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>
      </header>
      <div className="px-4 pb-4 pt-4">{m.bodyHtml ? <HtmlBody html={m.bodyHtml} /> : <TextBody text={m.bodyText ?? m.snippet} />}</div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-line bg-surface px-4 py-3" aria-label="Attachments">
          {files.map((a) => (
            <li key={a.index}>
              <button
                type="button"
                onClick={() => onDownload(m.id, a.index, a.filename)}
                className="group/file o-lift flex items-center gap-2.5 rounded-control border border-line bg-panel py-1.5 pl-2 pr-2.5 text-[13px] hover:border-line-hover"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-[5px] bg-hover text-fg-3">
                  <Paperclip size={13} />
                </span>
                <span className="flex flex-col items-start leading-tight">
                  <span className="max-w-48 truncate font-medium text-fg">{a.filename}</span>
                  <span className="font-mono text-[11px] text-fg-3">{formatBytes(a.size)}</span>
                </span>
                <Download size={14} className={cn("ml-1 text-fg-3 transition-[translate,color] duration-[var(--motion-fast)] ease-spring group-hover/file:translate-y-0.5 group-hover/file:text-fg")} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReaderSkeleton() {
  return (
    <div className="flex animate-fade-in flex-col gap-4 rounded-card border border-line p-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-2.5 w-64" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[70%]" />
      </div>
    </div>
  );
}
