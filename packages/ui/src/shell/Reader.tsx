import { useState, type ReactNode } from "react";
import type { Account, Label, MessageDetail, ThreadDetail, ThreadSummary } from "@ostra/core";
import { displayName, formatAddressList } from "@ostra/core";
import { Archive, ArrowLeft, Download, Forward, Paperclip, Reply, ReplyAll, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { Badge } from "../components/Badge.tsx";
import { Button } from "../components/Button.tsx";
import { Dot } from "../components/Dot.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Kbd } from "../components/Kbd.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { CATEGORY_NAMES, formatBytes, fullTime } from "../app/format.ts";
import { HtmlBody, TextBody } from "./EmailBody.tsx";
import { OstraMark } from "../brand/logo.tsx";

interface Props {
  summary: ThreadSummary | null;
  detail: ThreadDetail | null;
  error: string | null;
  accounts: Map<string, Account>;
  labels: Map<string, Label>;
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

export function Reader({ summary, detail, error, accounts, labels, onDownload, onAction, onReply, onLabel, onCategory, onBack, onRetry, footer }: Props) {
  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<OstraMark size={28} className="text-line-strong" />}
          title="Nothing selected"
          description={
            <span>
              Use <Kbd keys="j" /> and <Kbd keys="k" /> to move, <Kbd keys="enter" /> to open.
            </span>
          }
        />
      </div>
    );
  }

  const messages = detail?.messages ?? [];
  const last = messages[messages.length - 1];

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={summary.subject || "Message"}>
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
        <Button variant="tertiary" size="sm" iconOnly aria-label="Back to list" onClick={onBack} className="lg:hidden">
          <ArrowLeft size={15} />
        </Button>
        <ToolbarButton label="Archive" shortcut="e" onClick={() => onAction("archive")}>
          <Archive size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <ToolbarButton label="Trash" shortcut="#" onClick={() => onAction("trash")}>
          <Trash2 size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <ToolbarButton label="Spam" shortcut="!" onClick={() => onAction("spam")}>
          <ShieldAlert size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
        <ToolbarButton label="Label" shortcut="l" onClick={onLabel}>
          <Tag size={15} strokeWidth={1.75} />
        </ToolbarButton>
        <Tooltip content="Change category" shortcut="y">
          <button
            type="button"
            onClick={onCategory}
            className="o-press h-7 rounded-control px-2 font-mono text-[11px] text-fg-3 hover:bg-hover hover:text-fg"
          >
            {CATEGORY_NAMES[summary.category]}
          </button>
        </Tooltip>
        <div className="ml-auto flex items-center gap-1">
          {last && (
            <>
              <ToolbarButton label="Reply" shortcut="r" onClick={() => onReply("reply", last)}>
                <Reply size={15} strokeWidth={1.75} />
              </ToolbarButton>
              <ToolbarButton label="Reply all" shortcut="a" onClick={() => onReply("replyAll", last)}>
                <ReplyAll size={15} strokeWidth={1.75} />
              </ToolbarButton>
              <ToolbarButton label="Forward" shortcut="f" onClick={() => onReply("forward", last)}>
                <Forward size={15} strokeWidth={1.75} />
              </ToolbarButton>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6 sm:px-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-[18px] font-semibold leading-snug tracking-[-0.02em] text-fg">{summary.subject || "(no subject)"}</h1>
            {summary.labels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {summary.labels.map((l) => {
                  const label = labels.get(l.labelId);
                  return label ? (
                    <Badge key={l.labelId} color={label.color}>
                      {label.name}
                    </Badge>
                  ) : null;
                })}
              </div>
            )}
          </div>

          {error && !detail && (
            <div className="flex items-center justify-between rounded-card border border-line px-4 py-3 text-[13px] text-fg-2">
              {error}
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          )}
          {!detail && !error && <ReaderSkeleton />}
          {messages.map((m, i) => (
            <MessageView
              key={m.id}
              message={m}
              defaultOpen={i === messages.length - 1 || !m.isRead}
              accounts={accounts}
              onDownload={onDownload}
            />
          ))}
        </div>
      </div>
      {footer}
    </article>
  );
}

function ToolbarButton({ label, shortcut, onClick, children }: { label: string; shortcut: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} shortcut={shortcut}>
      <Button variant="tertiary" size="sm" iconOnly aria-label={label} aria-keyshortcuts={shortcut} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

function MessageView({ message: m, defaultOpen, accounts, onDownload }: { message: MessageDetail; defaultOpen: boolean; accounts: Map<string, Account>; onDownload: Props["onDownload"] }) {
  const [open, setOpen] = useState(defaultOpen);
  const account = m.accountIds.map((id) => accounts.get(id)).find(Boolean);
  const files = m.attachments.map((a, i) => ({ ...a, index: i })).filter((a) => !a.inline);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="o-press flex w-full items-baseline gap-3 rounded-card border border-line px-4 py-2.5 text-left hover:border-line-hover hover:bg-hover"
      >
        <span className="shrink-0 text-[13px] font-medium text-fg">{displayName(m.from)}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-fg-3">{m.snippet}</span>
        <time className="shrink-0 font-mono text-[11px] text-fg-3">{fullTime(m.sentAt)}</time>
      </button>
    );
  }

  return (
    <section className="flex animate-slide-up flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-fg">{displayName(m.from)}</span>
          <span className="truncate font-mono text-[12px] text-fg-3">{m.from.address}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-fg-3">
          {account && <Dot color={account.color} size={6} label={account.displayName} />}
          <span className="truncate">to {formatAddressList([...m.to, ...m.cc].slice(0, 4)) || "undisclosed recipients"}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={m.sentAt} className="shrink-0">
            {fullTime(m.sentAt)}
          </time>
        </div>
      </div>
      {m.bodyHtml ? <HtmlBody html={m.bodyHtml} /> : <TextBody text={m.bodyText ?? m.snippet} />}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Attachments">
          {files.map((a) => (
            <li key={a.index}>
              <button
                type="button"
                onClick={() => onDownload(m.id, a.index, a.filename)}
                className="group o-press flex items-center gap-2 rounded-card border border-line px-3 py-2 text-[13px] hover:border-line-hover hover:bg-hover"
              >
                <Paperclip size={13} className="text-fg-3" />
                <span className="max-w-48 truncate text-fg">{a.filename}</span>
                <span className="font-mono text-[11px] text-fg-3">{formatBytes(a.size)}</span>
                <Download size={13} className={cn("text-fg-3 transition-transform duration-[var(--motion-fast)] ease-spring group-hover:translate-y-px")} />
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
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3 w-72" />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-[92%]" />
        <Skeleton className="h-3 w-[70%]" />
      </div>
    </div>
  );
}
