import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { parseAddressList, type ThreadSummary } from "@ostra/core";
import { AlertTriangle, ChevronDown, Minus, Paperclip, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { CommandMenu, type CommandItem } from "../components/CommandBar.tsx";
import { Dot } from "../components/Dot.tsx";
import { Kbd, isMac } from "../components/Kbd.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { LoadingDots } from "../components/LoadingDots.tsx";
import { cn } from "../lib/cn.ts";
import { formatBytes } from "../app/format.ts";
import { useHotkeys } from "../app/hotkeys.ts";
import { useMailStore, useStore } from "../app/store.ts";
import { fullBody, type ComposeMode, type DraftFields } from "./model.ts";

type Warning = { kind: "wrong_account"; message: string; suggestedIdentityId: string } | { kind: "missing_attachment"; message: string } | { kind: "tone"; message: string };
interface Attachment {
  filename: string;
  contentType: string;
  content: string;
  size: number;
}

const REASON: Record<string, string> = {
  reply: "the address this was sent to",
  contact: "you last wrote to them from here",
  default: "your default",
  fallback: "",
};

const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export interface ComposerProps {
  mode: ComposeMode;
  initial: DraftFields;
  threadId?: string | undefined;
  onClose: () => void;
  /** Playing the exit animation; the host unmounts it shortly after. */
  closing?: boolean;
}

/** The composer window: smart from, AI drafting and rewriting, pre-send check, ⌘Enter. */
export function Composer({ mode, initial, threadId, onClose, closing = false }: ComposerProps) {
  const store = useMailStore();
  const boot = useStore((s) => s.boot);
  const identities = boot?.identities ?? [];
  const accounts = useMemo(() => new Map((boot?.accounts ?? []).map((a) => [a.id, a])), [boot?.accounts]);
  const aiOn = !!boot?.ai.available && !!boot?.settings.aiEnabled;

  const [d, setD] = useState<DraftFields>(initial);
  const [identityId, setIdentityId] = useState<string | null>(boot?.settings.defaultIdentityId ?? identities[0]?.id ?? null);
  const [fromReason, setFromReason] = useState("");
  const [fromTouched, setFromTouched] = useState(false);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [showQuote, setShowQuote] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Items are built when the menu opens (they depend on the body at that moment). */
  const [aiMenu, setAiMenu] = useState<CommandItem[] | null>(null);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const title = mode === "new" ? "New message" : mode === "forward" ? "Forward" : mode === "replyAll" ? "Reply all" : "Reply";

  const dirty = d.body.trim() !== initial.body.trim() || d.to !== initial.to || d.cc !== initial.cc || d.subject !== initial.subject || attachments.length > 0;
  // Closing never silently throws away writing: a dirty draft asks first.
  const requestClose = () => {
    if (dirty && !confirmDiscard) {
      setMinimized(false);
      setConfirmDiscard(true);
    } else onClose();
  };

  const update = (patch: Partial<DraftFields>) => {
    setD((x) => ({ ...x, ...patch }));
    setWarnings(null);
  };

  // Smart "from": the original's address for replies, the contact's last identity for new mail.
  const recipientsKey = mode === "new" ? d.to : "";
  useEffect(() => {
    if (fromTouched) return;
    const recipients = parseAddressList(recipientsKey).map((a) => a.address);
    let alive = true;
    store.api
      .post<{ identityId: string | null; reason: string }>("/compose/from", { replyToMessageId: initial.replyToMessageId, recipients })
      .then(({ data }) => {
        if (!alive || !data.identityId) return;
        setIdentityId(data.identityId);
        setFromReason(REASON[data.reason] ?? "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [recipientsKey, fromTouched, initial.replyToMessageId, store]);

  useEffect(() => {
    // Replies start in the body; new mail starts at To.
    const t = setTimeout(() => (mode === "new" || mode === "forward" ? document.getElementById("compose-to")?.focus() : bodyRef.current?.focus()), 30);
    return () => clearTimeout(t);
  }, [mode]);

  const runAi = async (kind: "draft" | "shorter" | "longer" | "friendlier" | "more formal" | "fix grammar") => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const before = d.body;
    setAiBusy(kind);
    setError(null);
    try {
      const stream =
        kind === "draft"
          ? store.stream("/ai/draft", { threadId, identityId: identityId ?? undefined, instructions: before.trim() || undefined }, ctrl.signal)
          : store.stream("/ai/rewrite", { text: before, mode: kind, identityId: identityId ?? undefined }, ctrl.signal);
      let text = "";
      for await (const chunk of stream) {
        text += chunk;
        setD((x) => ({ ...x, body: text }));
      }
      setWarnings(null);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        setD((x) => ({ ...x, body: before }));
        setError(err instanceof Error ? err.message : "AI couldn't finish.");
      }
    } finally {
      if (abort.current === ctrl) abort.current = null;
      setAiBusy(null);
    }
  };

  const recipients = () => ({ to: parseAddressList(d.to), cc: parseAddressList(d.cc), bcc: parseAddressList(d.bcc) });

  const send = async (force = false) => {
    if (sending || checking || aiBusy) return;
    const r = recipients();
    if (r.to.length + r.cc.length + r.bcc.length === 0) {
      setError("Add at least one recipient.");
      return;
    }
    if (!identityId) {
      setError("Connect an account to send from.");
      return;
    }
    setError(null);
    // Pre-send check: warnings show inline once; sending again goes anyway.
    if (!force && warnings === null) {
      setChecking(true);
      try {
        const { data } = await store.api.post<{ warnings: Warning[] }>("/compose/check", {
          identityId,
          replyToMessageId: d.replyToMessageId,
          ...r,
          subject: d.subject,
          bodyText: d.body,
          attachmentCount: attachments.length,
        });
        if (data.warnings.length) {
          setWarnings(data.warnings);
          return;
        }
      } catch {
        // a failed check never blocks sending
      } finally {
        setChecking(false);
      }
    }
    setSending(true);
    try {
      const { data } = await store.api.post<{ thread: ThreadSummary | null }>(
        "/send",
        {
          identityId,
          ...r,
          subject: d.subject,
          bodyText: fullBody(d),
          replyToMessageId: d.replyToMessageId,
          attachments: attachments.map(({ filename, contentType, content }) => ({ filename, contentType, content })),
        },
        { timeout: 120_000 },
      );
      if (data.thread) store.upsertThread(data.thread);
      store.notify("Sent", { tone: "success" });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  };

  useHotkeys([
    { keys: "mod+enter", run: () => void send(warnings !== null), inInputs: true },
    {
      keys: "escape",
      inInputs: true,
      run: () => {
        if (aiMenu) setAiMenu(null);
        else if (aiBusy) abort.current?.abort();
        else if (confirmDiscard) setConfirmDiscard(false);
        else requestClose();
      },
    },
    { keys: "mod+j", run: () => aiOn && toggleAiMenu(), inInputs: true },
  ], !closing);

  const addFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    const total = attachments.reduce((n, a) => n + a.size, 0) + files.reduce((n, f) => n + f.size, 0);
    if (total > MAX_ATTACHMENTS_BYTES) {
      setError("Attachments can be up to 25 MB in total.");
      return;
    }
    const read = await Promise.all(
      files.map(
        (f) =>
          new Promise<Attachment>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve({ filename: f.name, contentType: f.type || "application/octet-stream", size: f.size, content: String(r.result).split(",")[1] ?? "" });
            r.onerror = () => reject(r.error);
            r.readAsDataURL(f);
          }),
      ),
    );
    setAttachments((a) => [...a, ...read]);
    setWarnings(null);
  };

  const toggleAiMenu = () => setAiMenu((open) => (open ? null : aiItems()));

  const aiItems = (): CommandItem[] => [
    ...(threadId ? [{ id: "draft", title: d.body.trim() ? "Draft reply from my notes" : "Draft a reply", group: "Write", icon: <Sparkles size={14} />, run: () => void runAi("draft") }] : []),
    ...(d.body.trim()
      ? (["shorter", "longer", "friendlier", "more formal", "fix grammar"] as const).map((m) => ({
          id: m,
          title: m === "fix grammar" ? "Fix grammar" : `Make it ${m}`,
          group: "Rewrite",
          run: () => void runAi(m),
        }))
      : []),
  ];

  const identity = identities.find((i) => i.id === identityId);
  const color = identity ? accounts.get(identity.accountId)?.color : undefined;

  return (
    <section
      role="dialog"
      aria-label={title}
      className={cn(
        "fixed bottom-0 right-0 z-40 flex max-h-[min(720px,calc(100dvh-16px))] w-full origin-bottom-right flex-col overflow-hidden rounded-t-window bg-elevated shadow-window",
        "sm:bottom-4 sm:right-4 sm:max-h-[min(720px,calc(100dvh-32px))] sm:w-[min(620px,calc(100vw-32px))] sm:rounded-window",
        closing ? "pointer-events-none animate-sheet-out" : "animate-sheet-in",
      )}
    >
      <header className={cn("flex h-11 shrink-0 items-center gap-2 pl-4 pr-2 transition-colors duration-[var(--motion-fast)]", !minimized && "border-b border-line", confirmDiscard && "bg-red-bg")}>
        {confirmDiscard ? (
          <>
            <span role="alert" className="flex-1 animate-fade-in text-[13px] font-medium text-fg">
              Discard this draft?
            </span>
            <Button size="sm" variant="tertiary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button size="sm" variant="danger" data-autofocus onClick={onClose}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setMinimized((m) => !m)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={!minimized}>
              <h2 className="truncate text-[13px] font-semibold">{minimized && d.subject.trim() ? d.subject : title}</h2>
              {aiBusy && <LoadingDots className="text-fg-3" />}
            </button>
            <Button size="sm" variant="tertiary" iconOnly aria-label={minimized ? "Expand composer" : "Minimize composer"} onClick={() => setMinimized((m) => !m)}>
              <Minus size={14} />
            </Button>
            <Button size="sm" variant="tertiary" iconOnly aria-label="Close composer" onClick={requestClose}>
              <X size={14} />
            </Button>
          </>
        )}
      </header>

      <div className="o-expand min-h-0 flex-1" data-open={!minimized}>
      <div className="flex min-h-0 flex-col" inert={minimized}>
      <div className="flex shrink-0 flex-col border-b border-line text-[13px]">
        <Row label="From">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {color && <Dot color={color} />}
            <select
              aria-label="From"
              value={identityId ?? ""}
              onChange={(e) => {
                setIdentityId(e.target.value);
                setFromTouched(true);
                setFromReason("");
                setWarnings(null);
              }}
              className="min-w-0 flex-1 cursor-pointer appearance-none truncate bg-transparent py-2 text-fg outline-none"
            >
              {identities.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.displayName ? `${i.displayName} <${i.address}>` : i.address}
                </option>
              ))}
            </select>
            {fromReason && <span className="hidden shrink-0 animate-fade-in text-[12px] text-fg-3 sm:inline">{fromReason}</span>}
            <ChevronDown size={12} className="shrink-0 text-fg-3" aria-hidden="true" />
          </span>
        </Row>
        <Row label="To" htmlFor="compose-to">
          <input id="compose-to" value={d.to} onChange={(e) => update({ to: e.target.value })} className="min-w-0 flex-1 bg-transparent py-2 outline-none" autoComplete="off" />
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="o-press shrink-0 rounded-[4px] px-1.5 py-0.5 text-[12px] text-fg-3 hover:bg-hover hover:text-fg">
              Cc Bcc
            </button>
          )}
        </Row>
        {showCc && (
          <div className="flex animate-slide-down flex-col">
            <Row label="Cc" htmlFor="compose-cc">
              <input id="compose-cc" value={d.cc} onChange={(e) => update({ cc: e.target.value })} className="min-w-0 flex-1 bg-transparent py-2 outline-none" autoComplete="off" />
            </Row>
            <Row label="Bcc" htmlFor="compose-bcc">
              <input id="compose-bcc" value={d.bcc} onChange={(e) => update({ bcc: e.target.value })} className="min-w-0 flex-1 bg-transparent py-2 outline-none" autoComplete="off" />
            </Row>
          </div>
        )}
        <Row label="Subject" htmlFor="compose-subject">
          <input id="compose-subject" value={d.subject} onChange={(e) => update({ subject: e.target.value })} className="min-w-0 flex-1 bg-transparent py-2 font-medium outline-none" />
        </Row>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        <textarea
          ref={bodyRef}
          aria-label="Message"
          value={d.body}
          onChange={(e) => update({ body: e.target.value })}
          readOnly={!!aiBusy}
          placeholder={threadId && aiOn ? `Write, or press ${isMac() ? "⌘J" : "Ctrl+J"} for AI` : "Write your message"}
          className={cn("min-h-48 flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-fg-3", aiBusy && "text-fg-2")}
        />
        {d.quote && (
          <div className="px-4 pb-3">
            <button type="button" onClick={() => setShowQuote((x) => !x)} className="o-press rounded-[4px] bg-hover px-1.5 font-mono text-[11px] text-fg-3 hover:bg-active hover:text-fg" aria-expanded={showQuote} aria-label={showQuote ? "Hide quoted text" : "Show quoted text"}>
              ···
            </button>
            {showQuote && <pre className="mt-2 animate-slide-down whitespace-pre-wrap border-l-2 border-line pl-3 font-sans text-[13px] text-fg-3">{d.quote}</pre>}
          </div>
        )}
        {aiMenu && (
          <div className="absolute bottom-2 left-2 z-10 w-72 origin-bottom-left animate-pop-in overflow-hidden rounded-card bg-elevated shadow-menu">
            <CommandMenu footer={false} items={aiMenu} placeholder="Ask AI…" onDone={() => setAiMenu(null)} emptyText={threadId ? "Write something first" : "Write something to rewrite"} />
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <ul className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-2" aria-label="Attachments">
          {attachments.map((a, i) => (
            <li key={i} className="flex animate-pop-in items-center gap-1.5 rounded-control border border-line bg-panel py-1 pl-2 pr-1 text-[12px]">
              <Paperclip size={11} className="text-fg-3" />
              <span className="max-w-40 truncate">{a.filename}</span>
              <span className="font-mono text-[11px] text-fg-3">{formatBytes(a.size)}</span>
              <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))} className="o-press rounded-[4px] p-0.5 text-fg-3 hover:bg-hover hover:text-fg">
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {warnings && warnings.length > 0 && (
        <div role="alert" className="flex shrink-0 animate-slide-up flex-col gap-2 border-t border-amber/20 bg-amber-bg px-4 py-3" data-testid="presend-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />
              <span className="flex-1 text-fg">{w.message}</span>
              {w.kind === "wrong_account" && (
                <Button
                  size="sm"
                  onClick={() => {
                    setIdentityId(w.suggestedIdentityId);
                    setFromTouched(true);
                    setWarnings((ws) => ws?.filter((x) => x !== w) ?? null);
                  }}
                >
                  Switch
                </Button>
              )}
              {w.kind === "missing_attachment" && (
                <Button size="sm" onClick={() => fileRef.current?.click()}>
                  Attach
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="flex shrink-0 animate-slide-down items-center gap-2 border-t border-line bg-red-bg px-4 py-2 text-[13px] text-red">
          <AlertTriangle size={14} className="shrink-0" />
          {error}
        </p>
      )}

      <footer className="flex h-12 shrink-0 items-center gap-1 border-t border-line px-3">
        <Button
          variant="primary"
          size="sm"
          loading={sending || checking}
          onClick={() => void send(warnings !== null)}
          suffix={<Kbd keys="mod+enter" className="[&_kbd]:border-primary-fg/20 [&_kbd]:bg-transparent [&_kbd]:text-primary-fg/70" />}
        >
          {warnings && warnings.length ? "Send anyway" : "Send"}
        </Button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => void addFiles(e)} />
        <Button size="sm" variant="tertiary" iconOnly aria-label="Attach files" onClick={() => fileRef.current?.click()}>
          <Paperclip size={14} />
        </Button>
        {aiOn && (
          <Button size="sm" variant="tertiary" aria-label="AI" onClick={toggleAiMenu} prefix={<Sparkles size={14} />} suffix={<Kbd keys="mod+j" />}>
            AI
          </Button>
        )}
        {aiBusy && (
          <span className="ml-2 flex items-center gap-2 text-[12px] text-fg-3" role="status">
            <LoadingDots /> Writing… <Kbd keys="esc" />
          </span>
        )}
        <Tooltip content="Discard draft" side="top" align="end">
          <Button size="sm" variant="tertiary" iconOnly aria-label="Discard draft" className="ml-auto hover:text-red" onClick={requestClose}>
            <Trash2 size={14} />
          </Button>
        </Tooltip>
      </footer>
      </div>
      </div>
    </section>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 last:border-b-0">
      <label htmlFor={htmlFor} className="w-14 shrink-0 text-fg-3">
        {label}
      </label>
      {children}
    </div>
  );
}
