import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { CATEGORIES, VISIBLE_FOLDERS, type Account, type Category, type Label, type MessageDetail, type VirtualFolder } from "@ostra/core";
import { AlertCircle, Archive, Inbox, Keyboard, Layers, LogOut, Mail, MailOpen, Moon, PanelLeft, PenSquare, RefreshCw, Search, Settings, ShieldAlert, Sun, Tag, Trash2, X } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { CommandBar, type CommandItem } from "../components/CommandBar.tsx";
import { Dot } from "../components/Dot.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Kbd } from "../components/Kbd.tsx";
import { ListSkeleton } from "../components/Skeleton.tsx";
import { Tooltip } from "../components/Tooltip.tsx";
import { cn } from "../lib/cn.ts";
import { usePresence } from "../lib/presence.ts";
import { useTheme } from "../theme.tsx";
import { useAuthState } from "../app/auth.tsx";
import { CATEGORY_NAMES } from "../app/format.ts";
import { useHotkeys, type Hotkey } from "../app/hotkeys.ts";
import { useMailStore, useStore, viewKey, type View } from "../app/store.ts";
import { MessageList, type RowAction } from "./MessageList.tsx";
import { Reader } from "./Reader.tsx";
import { buildRows, type Row } from "./rows.ts";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { FOLDERS, Sidebar } from "./Sidebar.tsx";

const EMPTY: Record<string, { title: string; description: string }> = {
  inbox: { title: "You're all caught up", description: "New mail from every account lands here." },
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

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia !== "undefined" && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

const SIDEBAR_KEY = "ostra:sidebar-hidden";

/** Frame used while the app boots: same geometry as the shell, so nothing jumps when it arrives. */
export function ShellSkeleton() {
  return (
    <div className="flex h-full bg-frame" aria-busy="true">
      <div className="hidden w-[240px] shrink-0 flex-col gap-3 px-3 py-3 lg:flex">
        <div className="o-skeleton h-8 w-32 rounded-control" />
        <div className="o-skeleton h-8 rounded-control opacity-60" />
        <div className="mt-2 flex flex-col gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="o-skeleton h-6 rounded-control" style={{ opacity: 0.5 - i * 0.06 }} />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 p-0 sm:p-2 lg:pl-0">
        <div className="flex min-w-0 flex-1 overflow-hidden bg-panel shadow-panel sm:rounded-[10px]">
          <div className="flex w-full flex-col border-line lg:w-[340px] lg:border-r xl:w-[380px]">
            <div className="h-12 shrink-0 border-b border-line" />
            <ListSkeleton rows={9} />
          </div>
        </div>
      </div>
    </div>
  );
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
  const [overlay, setOverlay] = useState<null | "command" | "label" | "category" | "shortcuts">(null);
  const [detailErrorState, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const detailError = detailErrorState && detailErrorState.id === openId ? detailErrorState.message : null;
  /** Below 1024px: one pane at a time and the sidebar in a drawer. */
  const narrow = useMedia("(max-width: 1023px)");
  const [drawer, setDrawer] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = useCallback(() => {
    if (narrow) return setDrawer((d) => !d);
    setSidebarHidden((h) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, h ? "0" : "1");
      } catch {
        // ignore
      }
      return !h;
    });
  }, [narrow]);

  const accounts = useMemo(() => new Map((boot?.accounts ?? []).map((a) => [a.id, a])), [boot?.accounts]);
  const labels = useMemo(() => new Map((boot?.labels ?? []).map((l) => [l.id, l])), [boot?.labels]);
  const title = view.kind === "label" ? (labels.get(view.labelId)?.name ?? "Label") : (FOLDERS.find((f) => f.folder === view.folder)?.name ?? "Inbox");

  useEffect(() => {
    const unread = view.kind === "folder" && view.folder === "inbox" ? boot?.counts.inbox : 0;
    document.title = unread ? `${title} (${unread}) · Ostra` : `${title} · Ostra`;
  }, [title, view, boot?.counts.inbox]);

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

  // Threads in display order, for prev/next and "3 / 14".
  const threadRows = useMemo(() => rows.flatMap((r, i) => (r.kind === "thread" ? [{ id: r.id, index: i }] : [])), [rows]);
  const openPos = openId ? threadRows.findIndex((r) => r.id === openId) : -1;
  const prevThread = openPos > 0 ? threadRows[openPos - 1]! : null;
  const nextThread = openPos >= 0 && openPos < threadRows.length - 1 ? threadRows[openPos + 1]! : null;

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

  const onRowAction = useCallback((id: string, action: RowAction) => runAction(action, id), [runAction]);

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

  // While reading, j/k step through conversations; in the list they move the cursor.
  const step = (delta: 1 | -1) => {
    if (openId) {
      const target = delta === 1 ? nextThread : prevThread;
      if (target) open(target.id);
      return;
    }
    setCursor((c) => (delta === 1 ? Math.min(c + 1, rows.length - 1) : Math.max(c - 1, 0)));
  };

  const hotkeys: Hotkey[] = [
    { keys: "mod+k", run: () => setOverlay((p) => (p ? null : "command")), inInputs: true },
    { keys: "/", run: () => setOverlay("command") },
    { keys: "?", run: () => setOverlay("shortcuts") },
    { keys: "[", run: toggleSidebar },
    { keys: "j", run: () => step(1) },
    { keys: "k", run: () => step(-1) },
    // Arrow keys stay free to scroll an open message.
    { keys: "down", run: () => step(1), enabled: !openId },
    { keys: "up", run: () => step(-1), enabled: !openId },
    { keys: "enter", run: () => activate(cursor), enabled: !openId },
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
    { keys: "l", run: () => targetId && setOverlay("label") },
    { keys: "y", run: () => targetId && setOverlay("category") },
    { keys: "r", run: () => replyTo("reply"), enabled: !!compose },
    { keys: "a", run: () => replyTo("replyAll"), enabled: !!compose },
    { keys: "f", run: () => replyTo("forward"), enabled: !!compose },
    { keys: "c", run: () => compose?.({ mode: "new" }), enabled: !!compose },
    { keys: "g i", run: () => go("inbox") },
    { keys: "g s", run: () => go("sent") },
    { keys: "g d", run: () => go("drafts") },
    { keys: "g a", run: () => go("archive") },
  ];
  useHotkeys(hotkeys, overlay === null && !drawer);
  // ⌘K must still close the palette while it's open.
  useHotkeys([{ keys: "mod+k", run: () => setOverlay(null), inInputs: true }], overlay !== null);

  const target = targetId ? threads[targetId] : undefined;

  const commandItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = [];
    if (compose) items.push({ id: "compose", title: "New message", keywords: "compose write", group: "Mail", shortcut: "c", icon: <PenSquare size={14} />, run: () => compose({ mode: "new" }) });
    if (target) {
      items.push(
        { id: "archive", title: "Archive", group: "Mail", shortcut: "e", icon: <Archive size={14} />, run: () => runAction("archive") },
        { id: "trash", title: "Move to trash", group: "Mail", shortcut: "#", icon: <Trash2 size={14} />, run: () => runAction("trash") },
        { id: "spam", title: "Mark as spam", group: "Mail", shortcut: "!", icon: <ShieldAlert size={14} />, run: () => runAction("spam") },
        target.isRead
          ? { id: "unread", title: "Mark as unread", group: "Mail", shortcut: "shift+u", icon: <Mail size={14} />, run: () => runAction("markUnread") }
          : { id: "read", title: "Mark as read", group: "Mail", shortcut: "shift+i", icon: <MailOpen size={14} />, run: () => runAction("markRead") },
        { id: "label", title: "Label…", group: "Mail", shortcut: "l", icon: <Tag size={14} />, run: () => setTimeout(() => setOverlay("label"), 0) },
        { id: "category", title: "Change category…", group: "Mail", shortcut: "y", icon: <Layers size={14} />, run: () => setTimeout(() => setOverlay("category"), 0) },
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
      { id: "sidebar", title: "Toggle sidebar", group: "Ostra", shortcut: "[", icon: <PanelLeft size={14} />, run: toggleSidebar },
      { id: "shortcuts", title: "Keyboard shortcuts", group: "Ostra", shortcut: "?", icon: <Keyboard size={14} />, run: () => setTimeout(() => setOverlay("shortcuts"), 0) },
      { id: "settings", title: "Settings", group: "Ostra", icon: <Settings size={14} />, run: () => navigate("/settings") },
      { id: "refresh", title: "Refresh", group: "Ostra", icon: <RefreshCw size={14} />, run: () => void store.reconcile([view]) },
      { id: "signout", title: "Sign out", group: "Ostra", icon: <LogOut size={14} />, run: () => void store.clearCache().then(() => auth.signOut()) },
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, boot, view, resolved, compose, ext.commands, toggleSidebar]);

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
  const refreshing = list?.status === "loading" && list.ids.length > 0;
  const empty = EMPTY[view.kind === "label" ? "label" : view.folder]!;
  const filterAccount = view.kind === "folder" && view.accountId ? accounts.get(view.accountId) : undefined;
  const unread = view.kind === "folder" && view.folder === "inbox" && !view.accountId ? (boot?.counts.inbox ?? 0) : 0;

  const sidebar = (
    <Sidebar
      view={view}
      counts={boot?.counts ?? {}}
      labels={boot?.labels ?? []}
      accounts={boot?.accounts ?? []}
      hrefFor={(v) => hrefFor(v)}
      onCompose={compose ? () => compose({ mode: "new" }) : undefined}
      onCommand={() => setOverlay("command")}
      onShortcuts={() => setOverlay("shortcuts")}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <div className="flex h-full bg-frame">
      {!narrow && (
        <aside
          aria-label="Sidebar"
          inert={sidebarHidden}
          className={cn("shrink-0 overflow-hidden transition-[width] duration-[var(--motion-slow)] ease-out", sidebarHidden ? "w-0" : "w-[240px]")}
        >
          <div className={cn("h-full w-[240px] transition-opacity duration-[var(--motion-normal)]", sidebarHidden && "opacity-0")}>{sidebar}</div>
        </aside>
      )}
      {narrow && (
        <Drawer open={drawer} onClose={() => setDrawer(false)}>
          {sidebar}
        </Drawer>
      )}

      <div className={cn("flex min-w-0 flex-1", narrow ? "p-0 sm:p-2" : sidebarHidden ? "p-2" : "py-2 pr-2")}>
        <div className="flex min-w-0 flex-1 overflow-hidden bg-panel shadow-panel sm:rounded-[10px]">
          <section
            aria-label={title}
            className={cn("flex min-h-0 shrink-0 flex-col border-line", narrow ? "w-full" : "w-[340px] border-r xl:w-[380px]", narrow && openId && "hidden")}
          >
            <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line pl-2 pr-2">
              {(narrow || sidebarHidden) && (
                <Tooltip content={narrow ? "Menu" : "Show sidebar"} shortcut="[" align="start">
                  <Button variant="tertiary" size="sm" iconOnly aria-label={narrow ? "Open menu" : "Show sidebar"} onClick={toggleSidebar}>
                    <PanelLeft size={15} strokeWidth={1.75} />
                  </Button>
                </Tooltip>
              )}
              <h1 className={cn("truncate text-sm font-semibold tracking-[-0.01em]", !(narrow || sidebarHidden) && "pl-2")}>{title}</h1>
              {unread > 0 && <span className="rounded-full bg-hover px-1.5 py-px font-mono text-[11px] tabular-nums text-fg-2">{unread}</span>}
              {filterAccount && (
                <button
                  type="button"
                  onClick={() => navigate(hrefFor({ ...view, accountId: undefined } as View))}
                  className="o-press group flex h-6 min-w-0 animate-pop-in items-center gap-1.5 rounded-full border border-line pl-2 pr-1 text-[12px] text-fg-2 hover:border-line-hover hover:text-fg"
                  title="Show all accounts"
                >
                  <Dot color={filterAccount.color} size={6} />
                  <span className="truncate">{filterAccount.displayName}</span>
                  <X size={12} className="shrink-0 text-fg-3 group-hover:text-fg" aria-label="Clear filter" />
                </button>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                {connection === "offline" && <span className="mr-1 rounded-full bg-amber-bg px-2 py-px text-[11px] font-medium text-amber">Offline</span>}
                <Tooltip content="Refresh" align="end">
                  <Button variant="tertiary" size="sm" iconOnly aria-label="Refresh" onClick={() => void store.reconcile([view])}>
                    <RefreshCw size={14} strokeWidth={1.75} className={cn(refreshing && "animate-spin")} />
                  </Button>
                </Tooltip>
                {narrow && (
                  <>
                    <Button variant="tertiary" size="sm" iconOnly aria-label="Search and commands" onClick={() => setOverlay("command")}>
                      <Search size={15} strokeWidth={1.75} />
                    </Button>
                    {compose && (
                      <Button variant="tertiary" size="sm" iconOnly aria-label="New message" onClick={() => compose({ mode: "new" })}>
                        <PenSquare size={15} strokeWidth={1.75} />
                      </Button>
                    )}
                  </>
                )}
              </span>
            </header>

            {reauth.length > 0 && (
              <div role="status" className="mx-2 mt-2 flex animate-slide-down items-center gap-2.5 rounded-card border border-amber/25 bg-amber-bg px-3 py-2 text-[13px] text-fg">
                <AlertCircle size={15} className="shrink-0 text-amber" />
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
              <EmptyState icon={<AlertCircle size={18} />} title="Couldn't load your mail" description="Check your connection and try again." action={<Button onClick={() => void store.loadList(view)}>Try again</Button>} />
            ) : rows.length === 0 ? (
              (boot?.accounts.length ?? 0) === 0 ? (
                <EmptyState
                  icon={<Mail size={18} />}
                  title="Connect your first account"
                  description="Gmail, Outlook, iCloud, any IMAP server, or a custom domain through Resend."
                  action={
                    <Button variant="primary" onClick={() => navigate("/settings/accounts")}>
                      Connect account
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Inbox size={18} />}
                  title={empty.title}
                  description={empty.description}
                  action={
                    view.kind === "folder" && view.folder === "inbox" && compose ? (
                      <Button size="sm" prefix={<PenSquare size={13} />} suffix={<Kbd keys="c" />} onClick={() => compose({ mode: "new" })}>
                        New message
                      </Button>
                    ) : undefined
                  }
                />
              )
            ) : (
              <MessageList
                listKey={key}
                rows={rows}
                threads={threads}
                accounts={accounts}
                labels={labels}
                cursor={cursor}
                openId={openId}
                canArchive={view.kind === "folder" && view.folder === "inbox"}
                onActivate={activate}
                onAction={onRowAction}
                onEndReached={() => void store.loadList(view, { more: true }).catch(() => {})}
              />
            )}
          </section>

          <main className={cn("min-h-0 min-w-0 flex-1", narrow && !openId && "hidden")}>
            <Reader
              summary={summary}
              detail={detail ?? null}
              error={detailError}
              accounts={accounts}
              labels={labels}
              narrow={narrow}
              position={openPos >= 0 ? { index: openPos, total: threadRows.length } : null}
              onPrev={prevThread ? () => open(prevThread.id) : null}
              onNext={nextThread ? () => open(nextThread.id) : null}
              onAction={(a) => runAction(a, openId)}
              onReply={(mode, message) => compose?.({ mode, message, threadId: openId ?? undefined })}
              onLabel={() => setOverlay("label")}
              onCategory={() => setOverlay("category")}
              onBack={() => open(null)}
              onRetry={() => openId && store.loadThread(openId).then(() => setDetailError(null), (e: Error) => setDetailError({ id: openId, message: e.message }))}
              onDownload={(messageId, index, filename) => void downloadAttachment(store, messageId, index, filename)}
              footer={openId && ext.readerFooter ? ext.readerFooter(openId) : null}
            />
          </main>
        </div>
      </div>

      <CommandBar open={overlay === "command"} onClose={() => setOverlay(null)} items={commandItems} />
      <CommandBar open={overlay === "label"} onClose={() => setOverlay(null)} items={labelItems} keepOpen label="Label" placeholder="Label as…" emptyText="No labels yet. Add some in Settings." footer="Enter toggles · Esc closes" />
      <CommandBar open={overlay === "category"} onClose={() => setOverlay(null)} items={categoryItems} label="Category" placeholder="Move to category…" />
      <ShortcutsDialog open={overlay === "shortcuts"} onClose={() => setOverlay(null)} />
    </div>
  );
}

/** The sidebar on small screens: slides in from the left over a dimmed backdrop. */
function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { mounted, closing } = usePresence(open, 200);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className={cn("fixed inset-0 z-40", closing && "pointer-events-none")}>
      <div className={cn("absolute inset-0 bg-overlay", closing ? "animate-fade-out" : "animate-fade-in")} onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Navigation" className={cn("absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-frame shadow-window", closing ? "animate-drawer-out" : "animate-drawer-in")}>
        {children}
      </div>
    </div>,
    document.body,
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
