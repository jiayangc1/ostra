import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { CATEGORIES, VISIBLE_FOLDERS, type Account, type Category, type Label, type MessageDetail, type VirtualFolder } from "@ostra/core";
import { AlertCircle, Archive, Inbox, LogOut, Mail, MailOpen, Moon, PenSquare, RefreshCw, Settings, ShieldAlert, Sun, Tag, Trash2, Layers } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { CommandBar, type CommandItem } from "../components/CommandBar.tsx";
import { Dot } from "../components/Dot.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ListSkeleton } from "../components/Skeleton.tsx";
import { cn } from "../lib/cn.ts";
import { useTheme } from "../theme.tsx";
import { useAuthState } from "../app/auth.tsx";
import { CATEGORY_NAMES } from "../app/format.ts";
import { useHotkeys, type Hotkey } from "../app/hotkeys.ts";
import { useMailStore, useStore, viewKey, type View } from "../app/store.ts";
import { MessageList } from "./MessageList.tsx";
import { Reader } from "./Reader.tsx";
import { buildRows, type Row } from "./rows.ts";
import { FOLDERS, Sidebar } from "./Sidebar.tsx";

const EMPTY: Record<string, { title: string; description: string }> = {
  inbox: { title: "You're caught up.", description: "New mail from every account lands here." },
  sent: { title: "Nothing sent yet", description: "Press c to write something." },
  drafts: { title: "No drafts", description: "Drafts from your accounts show up here." },
  spam: { title: "No spam", description: "Mail your providers flag as spam lands here." },
  trash: { title: "Trash is empty", description: "Deleted mail stays here until your provider clears it." },
  archive: { title: "Nothing archived", description: "Press e on a message to archive it." },
  label: { title: "No mail with this label", description: "Press l on a message to label it." },
};

export interface ComposeRequest {
  mode: "new" | "reply" | "replyAll" | "forward";
  message?: MessageDetail;
  threadId?: string;
  /** Prefilled body, e.g. an accepted AI draft. */
  body?: string;
}

export interface ShellExtensions {
  /** Opens the composer; provided once the composer is mounted. */
  compose?: (req: ComposeRequest) => void;
  /** Footer rendered under the reader (AI draft line). */
  readerFooter?: (threadId: string) => ReactNode;
  /** Extra commands for ⌘K. */
  commands?: CommandItem[];
}

function useView(): { view: View; openId: string | null } {
  const params = useParams();
  const [search] = useSearchParams();
  const location = useLocation();
  return useMemo(() => {
    const accountId = search.get("account") ?? undefined;
    if (location.pathname.startsWith("/label/") && params.labelId) return { view: { kind: "label", labelId: params.labelId }, openId: params.threadId ?? null };
    const folder = (VISIBLE_FOLDERS as readonly string[]).includes(params.folder ?? "") ? (params.folder as VirtualFolder) : "inbox";
    return { view: { kind: "folder", folder, accountId }, openId: params.threadId ?? null };
  }, [params.folder, params.labelId, params.threadId, search, location.pathname]);
}

export function hrefFor(v: View, threadId?: string | null): string {
  const base = v.kind === "label" ? `/label/${v.labelId}` : `/${v.folder}`;
  const path = threadId ? `${base}/${threadId}` : base;
  return v.kind === "folder" && v.accountId ? `${path}?account=${v.accountId}` : path;
}

export function Shell({ ext = {} }: { ext?: ShellExtensions }) {
  const store = useMailStore();
  const navigate = useNavigate();
  const auth = useAuthState();
  const { resolved, setPreference } = useTheme();
  const { view, openId } = useView();
  const key = viewKey(view);

  const boot = useStore((s) => s.boot);
  const threads = useStore((s) => s.threads);
  const list = useStore((s) => s.lists[key]);
  const detail = useStore((s) => (openId ? s.details[openId] : undefined));
  const connection = useStore((s) => s.connection);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The keyboard cursor belongs to a view; switching views starts at the top.
  const [cursorState, setCursorState] = useState({ key, index: 0, openId: null as string | null });
  const [palette, setPalette] = useState<null | "command" | "label" | "category">(null);
  const [detailErrorState, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const detailError = detailErrorState && detailErrorState.id === openId ? detailErrorState.message : null;
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 1279px)").matches);

  useEffect(() => {
    const mq = matchMedia("(max-width: 1279px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const accounts = useMemo(() => new Map((boot?.accounts ?? []).map((a) => [a.id, a])), [boot?.accounts]);
  const labels = useMemo(() => new Map((boot?.labels ?? []).map((l) => [l.id, l])), [boot?.labels]);
  const title = view.kind === "label" ? (labels.get(view.labelId)?.name ?? "Label") : (FOLDERS.find((f) => f.folder === view.folder)?.name ?? "Inbox");

  useEffect(() => {
    document.title = `${title} · Ostra`;
  }, [title]);

  // Load the list whenever the view changes (cached rows render meanwhile).
  useEffect(() => {
    void store.loadList(view).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows: Row[] = useMemo(
    () => buildRows(list?.ids ?? [], threads, { bundle: view.kind === "folder" && view.folder === "inbox", expanded }),
    [list?.ids, threads, view, expanded],
  );

  // Opening a thread (by click, link or keyboard) moves the cursor to it.
  // Adjusting state during render, keyed on what changed, avoids an extra effect pass.
  if (cursorState.key !== key || cursorState.openId !== openId) {
    const i = openId ? rows.findIndex((r) => r.kind === "thread" && r.id === openId) : -1;
    setCursorState({ key, openId, index: i >= 0 ? i : cursorState.key === key ? cursorState.index : 0 });
  }
  // Clamped, so archiving the last row leaves the cursor on the new last row.
  const cursor = Math.min(cursorState.key === key ? cursorState.index : 0, Math.max(0, rows.length - 1));
  const setCursor = useCallback((fn: (c: number) => number) => setCursorState((s) => ({ ...s, index: fn(Math.min(s.index, Math.max(0, rows.length - 1))) })), [rows.length]);

  // Load the opened thread; mark it read.
  useEffect(() => {
    if (!openId) return;
    store.loadThread(openId).catch((err: Error) => setDetailError({ id: openId, message: err.message }));
    const t = store.getState().threads[openId];
    if (t && !t.isRead) void store.act(openId, "markRead", { silent: true });
  }, [openId, store]);

  const open = useCallback((id: string | null) => navigate(hrefFor(view, id)), [navigate, view]);

  const activate = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      setCursor(() => index);
      if (row.kind === "bundle") {
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(row.category)) next.delete(row.category);
          else next.add(row.category);
          return next;
        });
      } else open(row.id);
    },
    [rows, open, setCursor],
  );

  const cursorThreadId = rows[cursor]?.kind === "thread" ? (rows[cursor] as { id: string }).id : null;
  const targetId = openId ?? cursorThreadId;

  const runAction = useCallback(
    (action: "archive" | "trash" | "spam" | "inbox" | "markRead" | "markUnread", id = targetId) => {
      if (!id) return;
      const wasOpen = id === openId;
      const index = rows.findIndex((r) => r.kind === "thread" && r.id === id);
      void store.act(id, action, { undoable: action !== "markRead" && action !== "markUnread" });
      if (wasOpen && action !== "markRead" && action !== "markUnread") {
        // Advance to the next thread, like a stack of paper.
        const next = rows.slice(index + 1).find((r) => r.kind === "thread") ?? rows.slice(0, Math.max(0, index)).reverse().find((r) => r.kind === "thread");
        open(next && next.kind === "thread" ? next.id : null);
      }
    },
    [targetId, openId, rows, store, open],
  );

  const compose = ext.compose;
  const replyTo = (mode: "reply" | "replyAll" | "forward") => {
    if (!compose || !openId) return;
    const last = detail?.messages[detail.messages.length - 1];
    if (last) return compose({ mode, message: last, threadId: openId });
    // Pressed before the thread finished loading: answer as soon as it arrives.
    void store.loadThread(openId).then((d) => {
      const m = d?.messages[d.messages.length - 1];
      if (m) compose({ mode, message: m, threadId: openId });
    }, () => {});
  };

  const go = (folder: VirtualFolder) => navigate(hrefFor({ kind: "folder", folder, accountId: view.kind === "folder" ? view.accountId : undefined }));

  const hotkeys: Hotkey[] = [
    { keys: "mod+k", run: () => setPalette((p) => (p ? null : "command")), inInputs: true },
    { keys: "j", run: () => setCursor((c) => Math.min(c + 1, rows.length - 1)) },
    { keys: "down", run: () => setCursor((c) => Math.min(c + 1, rows.length - 1)) },
    { keys: "k", run: () => setCursor((c) => Math.max(c - 1, 0)) },
    { keys: "up", run: () => setCursor((c) => Math.max(c - 1, 0)) },
    { keys: "enter", run: () => activate(cursor) },
    { keys: "o", run: () => activate(cursor) },
    {
      keys: "escape",
      run: () => {
        if (openId) open(null);
        else if (rows[cursor]?.kind === "thread" && (rows[cursor] as { bundle?: string }).bundle) {
          const cat = (rows[cursor] as { bundle: string }).bundle;
          setExpanded((p) => new Set([...p].filter((c) => c !== cat)));
        }
      },
    },
    { keys: "e", run: () => runAction("archive") },
    { keys: "#", run: () => runAction("trash") },
    { keys: "!", run: () => runAction("spam") },
    { keys: "shift+i", run: () => runAction("markRead") },
    { keys: "shift+u", run: () => runAction("markUnread") },
    { keys: "l", run: () => targetId && setPalette("label") },
    { keys: "y", run: () => targetId && setPalette("category") },
    { keys: "r", run: () => replyTo("reply"), enabled: !!compose },
    { keys: "a", run: () => replyTo("replyAll"), enabled: !!compose },
    { keys: "f", run: () => replyTo("forward"), enabled: !!compose },
    { keys: "c", run: () => compose?.({ mode: "new" }), enabled: !!compose },
    { keys: "g i", run: () => go("inbox") },
    { keys: "g s", run: () => go("sent") },
    { keys: "g d", run: () => go("drafts") },
    { keys: "g a", run: () => go("archive") },
  ];
  useHotkeys(hotkeys, palette === null);
  // ⌘K must still close the palette while it's open.
  useHotkeys([{ keys: "mod+k", run: () => setPalette(null), inInputs: true }], palette !== null);

  const target = targetId ? threads[targetId] : undefined;

  const commandItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];
    if (compose) items.push({ id: "compose", title: "Compose", group: "Mail", shortcut: "c", icon: <PenSquare size={14} />, run: () => compose({ mode: "new" }) });
    if (target) {
      items.push(
        { id: "archive", title: "Archive", group: "Mail", shortcut: "e", icon: <Archive size={14} />, run: () => runAction("archive") },
        { id: "trash", title: "Move to trash", group: "Mail", shortcut: "#", icon: <Trash2 size={14} />, run: () => runAction("trash") },
        { id: "spam", title: "Mark as spam", group: "Mail", shortcut: "!", icon: <ShieldAlert size={14} />, run: () => runAction("spam") },
        target.isRead
          ? { id: "unread", title: "Mark as unread", group: "Mail", shortcut: "shift+u", icon: <Mail size={14} />, run: () => runAction("markUnread") }
          : { id: "read", title: "Mark as read", group: "Mail", shortcut: "shift+i", icon: <MailOpen size={14} />, run: () => runAction("markRead") },
        { id: "label", title: "Label…", group: "Mail", shortcut: "l", icon: <Tag size={14} />, run: () => setTimeout(() => setPalette("label"), 0) },
        { id: "category", title: "Change category…", group: "Mail", shortcut: "y", icon: <Layers size={14} />, run: () => setTimeout(() => setPalette("category"), 0) },
      );
      if (target.folder !== "inbox") items.push({ id: "to-inbox", title: "Move to inbox", group: "Mail", icon: <Inbox size={14} />, run: () => runAction("inbox") });
    }
    items.push(...(ext.commands ?? []));
    for (const f of FOLDERS) items.push({ id: `go-${f.folder}`, title: `Go to ${f.name}`, group: "Navigate", shortcut: f.shortcut, icon: <f.icon size={14} />, run: () => go(f.folder) });
    for (const l of boot?.labels ?? []) items.push({ id: `label-${l.id}`, title: l.name, keywords: "label go", group: "Labels", icon: <Dot color={l.color} />, run: () => navigate(hrefFor({ kind: "label", labelId: l.id })) });
    for (const a of boot?.accounts ?? [])
      items.push({ id: `acct-${a.id}`, title: `Only ${a.displayName}`, keywords: "account filter", group: "Accounts", icon: <Dot color={a.color} />, run: () => navigate(hrefFor({ kind: "folder", folder: view.kind === "folder" ? view.folder : "inbox", accountId: a.id })) });
    if (view.kind === "folder" && view.accountId) items.push({ id: "acct-all", title: "Show all accounts", group: "Accounts", icon: <Layers size={14} />, run: () => navigate(hrefFor({ ...view, accountId: undefined })) });
    items.push(
      { id: "theme", title: resolved === "dark" ? "Switch to light theme" : "Switch to dark theme", group: "Ostra", icon: resolved === "dark" ? <Sun size={14} /> : <Moon size={14} />, run: () => setPreference(resolved === "dark" ? "light" : "dark") },
      { id: "settings", title: "Settings", group: "Ostra", icon: <Settings size={14} />, run: () => navigate("/settings") },
      { id: "refresh", title: "Refresh", group: "Ostra", icon: <RefreshCw size={14} />, run: () => void store.reconcile([view]) },
      { id: "signout", title: "Sign out", group: "Ostra", icon: <LogOut size={14} />, run: () => void store.clearCache().then(() => auth.signOut()) },
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, boot, view, resolved, compose, ext.commands]);

  const labelItems: CommandItem[] = useMemo(
    () =>
      (boot?.labels ?? []).map((l: Label) => {
        const applied = !!target?.labels.some((x) => x.labelId === l.id);
        return { id: l.id, title: l.name, icon: <Dot color={l.color} />, checked: applied, run: () => target && void store.setLabel(target.id, l.id, !applied) };
      }),
    [boot?.labels, target, store],
  );

  const categoryItems: CommandItem[] = useMemo(
    () =>
      CATEGORIES.map((c: Category, i) => ({
        id: c,
        title: CATEGORY_NAMES[c],
        shortcut: String(i + 1),
        checked: target?.category === c,
        run: () => target && void store.setCategory(target.id, c),
      })),
    [target, store],
  );

  const reauth = (boot?.accounts ?? []).filter((a: Account) => a.status === "needs_reauth");
  const summary = openId ? (threads[openId] ?? null) : null;
  const loading = !list || (list.status === "loading" && list.ids.length === 0) || (list.status === "idle" && list.ids.length === 0);
  const empty = EMPTY[view.kind === "label" ? "label" : view.folder]!;

  return (
    <div className={cn("grid h-full bg-canvas", narrow ? "grid-cols-[56px_minmax(0,1fr)]" : "grid-cols-[200px_340px_minmax(0,1fr)]", !narrow && "xl:grid-cols-[208px_360px_minmax(0,1fr)]")}>
      <aside className="min-h-0 border-r border-line bg-canvas">
        <Sidebar view={view} counts={boot?.counts ?? {}} labels={boot?.labels ?? []} accounts={boot?.accounts ?? []} collapsed={narrow} hrefFor={(v) => hrefFor(v)} />
      </aside>

      <section
        aria-label={title}
        className={cn("flex min-h-0 flex-col border-r border-line", narrow && openId && "hidden", narrow && !openId && "col-span-1")}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
          <h1 className="text-sm font-semibold tracking-[-0.01em]">{title}</h1>
          {view.kind === "folder" && view.accountId && accounts.get(view.accountId) && (
            <button
              type="button"
              onClick={() => navigate(hrefFor({ ...view, accountId: undefined }))}
              className="o-press flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-fg-2 hover:border-line-hover"
              title="Show all accounts"
            >
              <Dot color={accounts.get(view.accountId)!.color} size={6} />
              {accounts.get(view.accountId)!.displayName}
              <span aria-hidden="true">×</span>
            </button>
          )}
          <span className="ml-auto flex items-center gap-2">
            {connection === "offline" && <span className="font-mono text-[11px] text-fg-3">offline</span>}
            <button
              type="button"
              onClick={() => setPalette("command")}
              className="o-press flex h-7 items-center gap-1.5 rounded-control border border-line px-2 font-mono text-[11px] text-fg-3 hover:border-line-hover hover:text-fg"
              aria-label="Open command bar"
            >
              ⌘K
            </button>
          </span>
        </header>

        {reauth.length > 0 && (
          <div role="status" className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-[13px] text-fg-2">
            <AlertCircle size={14} className="shrink-0 text-amber" />
            <span className="flex-1 truncate">
              {reauth.map((a) => a.displayName).join(", ")} {reauth.length === 1 ? "needs" : "need"} you to sign in again.
            </span>
            <Button size="sm" variant="secondary" onClick={() => navigate(`/settings/accounts?reconnect=${reauth[0]!.id}`)}>
              Reconnect
            </Button>
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={10} />
        ) : list?.status === "error" ? (
          <EmptyState title="Couldn't load your mail" description="Check your connection and try again." action={<Button onClick={() => void store.loadList(view)}>Try again</Button>} />
        ) : rows.length === 0 ? (
          (boot?.accounts.length ?? 0) === 0 ? (
            <EmptyState icon={<Mail size={20} />} title="Connect your first account" description="Gmail, Outlook, any IMAP server, or a custom domain through Resend." action={<Button variant="primary" onClick={() => navigate("/settings/accounts")}>Connect account</Button>} />
          ) : (
            <EmptyState icon={<Inbox size={20} />} title={empty.title} description={empty.description} />
          )
        ) : (
          <MessageList
            rows={rows}
            threads={threads}
            accounts={accounts}
            labels={labels}
            cursor={cursor}
            openId={openId}
            onActivate={activate}
            onEndReached={() => void store.loadList(view, { more: true }).catch(() => {})}
          />
        )}
      </section>

      <main className={cn("min-h-0 min-w-0 bg-canvas", narrow && !openId && "hidden", narrow && openId && "col-span-1")}>
        <Reader
          summary={summary}
          detail={detail ?? null}
          error={detailError}
          accounts={accounts}
          labels={labels}
          onAction={(a) => runAction(a, openId)}
          onReply={(mode, message) => compose?.({ mode, message, threadId: openId ?? undefined })}
          onLabel={() => setPalette("label")}
          onCategory={() => setPalette("category")}
          onBack={() => open(null)}
          onRetry={() => openId && store.loadThread(openId).then(() => setDetailError(null), (e: Error) => setDetailError({ id: openId, message: e.message }))}
          onDownload={(messageId, index, filename) => void downloadAttachment(store, messageId, index, filename)}
          footer={openId && ext.readerFooter ? ext.readerFooter(openId) : null}
        />
      </main>

      <CommandBar open={palette === "command"} onClose={() => setPalette(null)} items={commandItems} />
      <CommandBar open={palette === "label"} onClose={() => setPalette(null)} items={labelItems} keepOpen label="Label" placeholder="Label as…" emptyText="No labels yet. Add some in Settings." footer="Enter toggles · Esc closes" />
      <CommandBar open={palette === "category"} onClose={() => setPalette(null)} items={categoryItems} label="Category" placeholder="Move to category…" />
    </div>
  );
}

async function downloadAttachment(store: ReturnType<typeof useMailStore>, messageId: string, index: number, filename: string) {
  const blob = await store.downloadAttachment(messageId, index);
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
