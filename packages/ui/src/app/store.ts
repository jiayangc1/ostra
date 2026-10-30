import type { CalendarConnection, Category, EventPlacement, ThreadDetail, ThreadSummary, UserSettings, VirtualFolder } from "@ostra/core";
import type { AxiosInstance } from "axios";
import { createContext, useContext, useSyncExternalStore } from "react";
import { ApiError } from "./api.ts";
import type { ClientCache } from "./cache.ts";
import type { Bootstrap, ServerEvent, ThreadActionName, ThreadPage } from "./types.ts";

export type View = { kind: "folder"; folder: VirtualFolder; accountId?: string | undefined } | { kind: "label"; labelId: string };

export function viewKey(v: View): string {
  return v.kind === "label" ? `label:${v.labelId}` : `folder:${v.folder}${v.accountId ? `@${v.accountId}` : ""}`;
}

export function parseViewKey(key: string): View {
  if (key.startsWith("label:")) return { kind: "label", labelId: key.slice(6) };
  const [folder, accountId] = key.slice(7).split("@");
  return { kind: "folder", folder: folder as VirtualFolder, accountId };
}

export interface ListState {
  ids: string[];
  cursor: string | null;
  status: "idle" | "loading" | "ready" | "error";
  /** The server's full list is loaded (no cursor). */
  complete: boolean;
}

export interface State {
  boot: Bootstrap | null;
  bootStatus: "loading" | "ready" | "error";
  threads: Record<string, ThreadSummary>;
  lists: Record<string, ListState>;
  details: Record<string, ThreadDetail>;
  connection: "connecting" | "online" | "offline";
  /** Connected calendars; null until loaded. */
  calendars: CalendarConnection[] | null;
}

const EMPTY_LIST: ListState = { ids: [], cursor: null, status: "idle", complete: false };

/** Does `t` belong in list `view`? Mirrors the server's list query closely enough for live updates. */
export function belongs(t: ThreadSummary, view: View): boolean {
  if (view.kind === "label") return t.labels.some((l) => l.labelId === view.labelId) && t.folder !== "trash" && t.folder !== "spam";
  if (view.accountId && !t.accountIds.includes(view.accountId)) return false;
  return t.folder === view.folder;
}

const byTimeDesc = (threads: Record<string, ThreadSummary>) => (a: string, b: string) =>
  (threads[b]?.lastMessageAt ?? "").localeCompare(threads[a]?.lastMessageAt ?? "");

/** What a thread looks like right after an action, before the server confirms. */
export function optimistic(t: ThreadSummary, action: ThreadActionName): ThreadSummary {
  switch (action) {
    case "archive":
      return t.folder === "inbox" ? { ...t, folder: "archive" } : t;
    case "trash":
      return { ...t, folder: "trash" };
    case "spam":
      return { ...t, folder: "spam" };
    case "inbox":
      return { ...t, folder: "inbox" };
    case "markRead":
      return { ...t, isRead: true };
    case "markUnread":
      return { ...t, isRead: false };
  }
}

const ACTION_VERB: Record<ThreadActionName, string> = {
  archive: "archive",
  trash: "move to trash",
  spam: "mark as spam",
  inbox: "move to inbox",
  markRead: "mark as read",
  markUnread: "mark as unread",
};

export interface StoreDeps {
  api: AxiosInstance;
  /** For streaming endpoints (AI writing), which axios can't stream in browsers. */
  stream?: (path: string, body: unknown, signal?: AbortSignal) => AsyncGenerator<string>;
  cache: ClientCache;
  notify(message: string, opts?: { tone?: "error" | "default"; action?: { label: string; onClick: () => void } }): void;
}

export class MailStore {
  private state: State = { boot: null, bootStatus: "loading", threads: {}, lists: {}, details: {}, connection: "connecting", calendars: null };
  private readonly listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private countsTimer: ReturnType<typeof setTimeout> | null = null;
  /** Detail ids in recency order, for the cache. */
  private recentDetails: string[] = [];

  constructor(private readonly deps: StoreDeps) {}

  /** The authenticated API client, for screens that talk to the API directly (settings, composer). */
  get api() {
    return this.deps.api;
  }

  stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<string> {
    if (!this.deps.stream) throw new Error("Streaming isn't available");
    return this.deps.stream(path, body, signal);
  }

  notify(message: string, opts?: Parameters<StoreDeps["notify"]>[1]) {
    this.deps.notify(message, opts);
  }

  // ---------- subscription ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
    this.schedulePersist();
  }

  // ---------- cache ----------
  async hydrate() {
    const cached = await this.deps.cache.get<Pick<State, "boot" | "threads" | "lists" | "details">>("state:v2");
    if (cached && this.state.bootStatus === "loading") {
      this.set({
        boot: cached.boot,
        bootStatus: cached.boot ? "ready" : "loading",
        threads: cached.threads ?? {},
        // Cached lists render immediately but are refetched.
        lists: Object.fromEntries(Object.entries(cached.lists ?? {}).map(([k, l]) => [k, { ...l, status: "idle" as const }])),
        details: cached.details ?? {},
      });
      this.recentDetails = Object.keys(cached.details ?? {});
    }
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => void this.persistNow(), 600);
  }

  /** Write the cache now (after settings saves, so a quick reload can't restore stale settings). */
  private persistNow(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    const { boot, threads, lists, details } = this.state;
    // Keep the cache bounded: first 200 rows of each list, 30 recent threads.
    const keepLists = Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, { ...l, ids: l.ids.slice(0, 200), cursor: l.ids.length > 200 ? null : l.cursor, complete: l.complete && l.ids.length <= 200 }]));
    const keepIds = new Set(Object.values(keepLists).flatMap((l) => l.ids));
    const keepThreads = Object.fromEntries(Object.entries(threads).filter(([id]) => keepIds.has(id)));
    const keepDetails = Object.fromEntries(this.recentDetails.slice(-30).filter((id) => details[id]).map((id) => [id, details[id]!]));
    return this.deps.cache.set("state:v2", { boot, threads: keepThreads, lists: keepLists, details: keepDetails });
  }

  // ---------- bootstrap ----------
  async loadBootstrap() {
    try {
      const { data } = await this.deps.api.get<Bootstrap>("/bootstrap");
      this.set({ boot: data, bootStatus: "ready" });
      // Times written in plain text ("dinner at 7") are read in the user's zone.
      const zone = browserTimeZone();
      if (zone && data.settings.timeZone !== zone) void this.updateSettings({ timeZone: zone }).catch(() => {});
    } catch (err) {
      if (!this.state.boot) this.set({ bootStatus: "error" });
      throw err;
    }
  }

  private refreshCountsSoon() {
    if (this.countsTimer) clearTimeout(this.countsTimer);
    this.countsTimer = setTimeout(async () => {
      try {
        const { data } = await this.deps.api.get<Record<string, number>>("/counts");
        this.set((s) => (s.boot ? { boot: { ...s.boot, counts: data } } : {}));
      } catch {
        // counts are cosmetic
      }
    }, 300);
  }

  async updateSettings(patch: Partial<UserSettings>) {
    const prev = this.state.boot?.settings;
    this.set((s) => (s.boot ? { boot: { ...s.boot, settings: { ...s.boot.settings, ...patch } } } : {}));
    try {
      const { data } = await this.deps.api.patch<UserSettings>("/settings", patch);
      this.set((s) => (s.boot ? { boot: { ...s.boot, settings: data } } : {}));
      await this.persistNow().catch(() => {});
    } catch (err) {
      if (prev) this.set((s) => (s.boot ? { boot: { ...s.boot, settings: prev } } : {}));
      throw err;
    }
  }

  // ---------- lists ----------
  list(view: View): ListState {
    return this.state.lists[viewKey(view)] ?? EMPTY_LIST;
  }

  private mergeThreads(list: ThreadSummary[]) {
    const threads = { ...this.state.threads };
    for (const t of list) threads[t.id] = t;
    return threads;
  }

  async loadList(view: View, opts: { more?: boolean } = {}) {
    const key = viewKey(view);
    const current = this.state.lists[key] ?? EMPTY_LIST;
    if (current.status === "loading" || (opts.more && (!current.cursor || current.complete))) return;
    this.set((s) => ({ lists: { ...s.lists, [key]: { ...current, status: "loading" } } }));
    try {
      const params: Record<string, string> = view.kind === "label" ? { labelId: view.labelId } : { folder: view.folder, ...(view.accountId ? { accountId: view.accountId } : {}) };
      if (opts.more && current.cursor) params.before = current.cursor;
      const { data } = await this.deps.api.get<ThreadPage>("/threads", { params });
      this.set((s) => {
        const threads = this.mergeThreads(data.threads);
        const fresh = data.threads.map((t) => t.id);
        const ids = opts.more ? [...new Set([...current.ids, ...fresh])] : fresh;
        return { threads, lists: { ...s.lists, [key]: { ids, cursor: data.nextCursor, status: "ready", complete: !data.nextCursor } } };
      });
    } catch (err) {
      this.set((s) => ({ lists: { ...s.lists, [key]: { ...current, status: current.ids.length ? "ready" : "error" } } }));
      throw err;
    }
  }

  /** Put a thread into the right lists after it changed. */
  private place(t: ThreadSummary, state: State, opts: { keepIn?: string[] } = {}): Pick<State, "threads" | "lists"> {
    const threads = { ...state.threads, [t.id]: t };
    const lists: Record<string, ListState> = {};
    for (const [key, l] of Object.entries(state.lists)) {
      const view = parseViewKey(key);
      const has = l.ids.includes(t.id);
      const should = belongs(t, view) || (has && view.kind === "folder" && view.folder === "sent") || opts.keepIn?.includes(key);
      if (has && !should) lists[key] = { ...l, ids: l.ids.filter((id) => id !== t.id) };
      else if (!has && should) {
        // Only insert if it falls inside the loaded window.
        const oldest = l.ids.length ? threads[l.ids[l.ids.length - 1]!]?.lastMessageAt : undefined;
        if (l.complete || !oldest || t.lastMessageAt >= oldest) lists[key] = { ...l, ids: [...l.ids, t.id].sort(byTimeDesc(threads)) };
        else lists[key] = l;
      } else if (has) lists[key] = { ...l, ids: [...l.ids].sort(byTimeDesc(threads)) };
      else lists[key] = l;
    }
    return { threads, lists };
  }

  upsertThread(t: ThreadSummary) {
    this.set((s) => {
      const placed = this.place(t, s);
      const detail = s.details[t.id];
      const details = { ...s.details };
      if (detail) {
        // New message in a thread we have cached: drop it so the next open refetches.
        if (detail.messageCount !== t.messageCount) delete details[t.id];
        else {
          details[t.id] = { ...detail, ...t, messages: detail.messages };
          // Events were found after it loaded: fetch them so an open thread shows the card.
          if ((detail.eventCount ?? 0) !== t.eventCount) queueMicrotask(() => void this.loadThread(t.id).catch(() => {}));
        }
      }
      return { ...placed, details };
    });
  }

  removeThread(id: string) {
    this.set((s) => {
      const threads = { ...s.threads };
      delete threads[id];
      const details = { ...s.details };
      delete details[id];
      const lists = Object.fromEntries(Object.entries(s.lists).map(([k, l]) => [k, l.ids.includes(id) ? { ...l, ids: l.ids.filter((x) => x !== id) } : l]));
      return { threads, lists, details };
    });
  }

  // ---------- details ----------
  async loadThread(id: string): Promise<ThreadDetail | null> {
    try {
      const { data } = await this.deps.api.get<ThreadDetail>(`/threads/${id}`);
      this.recentDetails = [...this.recentDetails.filter((x) => x !== id), id];
      this.set((s) => ({ details: { ...s.details, [id]: data }, threads: { ...s.threads, [id]: { ...s.threads[id], ...stripMessages(data) } } }));
      return data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) this.removeThread(id);
      throw err;
    }
  }

  // ---------- actions ----------
  /**
   * Optimistic thread action: the UI updates immediately; if the server or
   * provider refuses, everything is restored and a toast explains why.
   */
  async act(id: string, action: ThreadActionName, opts: { undoable?: boolean; silent?: boolean } = {}): Promise<boolean> {
    const before = this.state.threads[id];
    if (!before) return false;
    const snapshot = { threads: this.state.threads, lists: this.state.lists };
    const after = optimistic(before, action);
    this.set((s) => this.place(after, s));
    try {
      const { data } = await this.deps.api.post<{ thread: ThreadSummary | null }>(`/threads/${id}/actions`, { action });
      if (data.thread) this.upsertThread(data.thread);
      this.refreshCountsSoon();
      if (opts.undoable && !opts.silent) {
        const label = action === "archive" ? "Archived" : action === "trash" ? "Moved to trash" : action === "spam" ? "Marked as spam" : "Moved to inbox";
        // Undo returns it to the inbox; only offered when that's where it came from.
        const undo = before.folder === "inbox" && action !== "inbox" ? { label: "Undo", onClick: () => void this.act(id, "inbox", { silent: true }) } : undefined;
        this.deps.notify(label, undo ? { action: undo } : {});
      }
      return true;
    } catch (err) {
      this.set({ threads: snapshot.threads, lists: snapshot.lists });
      if (!opts.silent) this.deps.notify(`Couldn't ${ACTION_VERB[action]}. ${err instanceof Error ? err.message : ""}`.trim(), { tone: "error" });
      return false;
    }
  }

  async setCategory(id: string, category: Category) {
    const before = this.state.threads[id];
    if (!before || before.category === category) return;
    this.upsertThread({ ...before, category });
    try {
      const { data } = await this.deps.api.put<{ thread: ThreadSummary }>(`/threads/${id}/category`, { category });
      this.upsertThread(data.thread);
    } catch (err) {
      this.upsertThread(before);
      this.deps.notify(`Couldn't change the category. ${err instanceof Error ? err.message : ""}`, { tone: "error" });
    }
  }

  async setLabel(id: string, labelId: string, applied: boolean) {
    const before = this.state.threads[id];
    if (!before) return;
    const labels = applied
      ? [...before.labels.filter((l) => l.labelId !== labelId), { labelId, source: "user" as const, confidence: 1 }]
      : before.labels.filter((l) => l.labelId !== labelId);
    this.upsertThread({ ...before, labels });
    try {
      const { data } = await this.deps.api.put<{ thread: ThreadSummary }>(`/threads/${id}/labels/${labelId}`, { applied });
      this.upsertThread(data.thread);
    } catch (err) {
      this.upsertThread(before);
      this.deps.notify(`Couldn't update labels. ${err instanceof Error ? err.message : ""}`, { tone: "error" });
    }
  }

  // ---------- realtime ----------
  setConnection(connection: State["connection"]) {
    if (this.state.connection !== connection) this.set({ connection });
  }

  applyEvent(e: ServerEvent) {
    switch (e.type) {
      case "thread.upsert":
        this.upsertThread(e.thread);
        this.refreshCountsSoon();
        break;
      case "thread.remove":
        this.removeThread(e.threadId);
        this.refreshCountsSoon();
        break;
      case "account.update":
        this.set((s) => (s.boot ? { boot: { ...s.boot, accounts: s.boot.accounts.some((a) => a.id === e.account.id) ? s.boot.accounts.map((a) => (a.id === e.account.id ? e.account : a)) : [...s.boot.accounts, e.account] } } : {}));
        break;
      case "labels.changed":
      case "sync.done":
        void this.loadBootstrap().catch(() => {});
        break;
    }
  }

  /** After (re)connecting: refetch what's on screen so missed events don't matter. */
  async reconcile(visible: View[]) {
    await Promise.allSettled([this.loadBootstrap(), ...visible.map((v) => this.loadList(v))]);
  }

  async downloadAttachment(messageId: string, index: number): Promise<Blob | null> {
    try {
      const { data } = await this.deps.api.get<Blob>(`/messages/${messageId}/attachments/${index}`, { responseType: "blob", timeout: 120_000 });
      return data;
    } catch (err) {
      this.deps.notify(err instanceof Error ? err.message : "Couldn't download the attachment.", { tone: "error" });
      return null;
    }
  }

  // ---------- codes and calendars ----------
  async copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.deps.notify(`Copied ${value}`);
      return true;
    } catch {
      this.deps.notify("Couldn't reach the clipboard. Select the code and copy it instead.", { tone: "error" });
      return false;
    }
  }

  private calendarsLoading: Promise<CalendarConnection[]> | null = null;

  /** One request at a time; callers that arrive meanwhile share it. */
  loadCalendars(): Promise<CalendarConnection[]> {
    this.calendarsLoading ??= this.deps.api
      .get<CalendarConnection[]>("/calendars")
      .then(({ data }) => {
        this.set({ calendars: data });
        return data;
      })
      .finally(() => {
        this.calendarsLoading = null;
      });
    return this.calendarsLoading;
  }

  /** Add an event found in a message to a calendar (the default one when no target is given). */
  async addEvent(threadId: string, messageId: string, index: number, target: { connectionId: string; calendarId: string } | null = null): Promise<EventPlacement | null> {
    try {
      const { data } = await this.deps.api.post<EventPlacement>(`/messages/${messageId}/events/${index}/add`, target ?? {});
      this.set((s) => {
        const d = s.details[threadId];
        if (!d) return {};
        const messages = d.messages.map((m) =>
          m.id !== messageId
            ? m
            : {
                ...m,
                events: m.events.map((e) =>
                  e.index !== index ? e : { ...e, added: [...e.added.filter((p) => !(p.connectionId === data.connectionId && p.calendarId === data.calendarId)), data] },
                ),
              },
        );
        return { details: { ...s.details, [threadId]: { ...d, messages } } };
      });
      const url = data.url;
      this.deps.notify(`Added to ${data.calendarName ?? "your calendar"}`, url ? { action: { label: "Open", onClick: () => window.open(url, "_blank", "noopener") } } : {});
      return data;
    } catch (err) {
      if (err instanceof ApiError && err.code === "calendar_reauth") void this.loadCalendars().catch(() => {});
      this.deps.notify(err instanceof Error ? err.message : "Couldn't add the event.", { tone: "error" });
      return null;
    }
  }

  async downloadEvent(messageId: string, index: number): Promise<Blob | null> {
    try {
      const { data } = await this.deps.api.get<Blob>(`/messages/${messageId}/events/${index}/ics`, { responseType: "blob" });
      return data;
    } catch (err) {
      this.deps.notify(err instanceof Error ? err.message : "Couldn't download the event.", { tone: "error" });
      return null;
    }
  }

  async clearCache() {
    await this.deps.cache.clear();
  }
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function stripMessages(d: ThreadDetail): ThreadSummary {
  const { messages: _messages, ...rest } = d;
  return rest;
}

export const StoreContext = createContext<MailStore | null>(null);

export function useMailStore(): MailStore {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useMailStore must be used inside the app");
  return s;
}

/** Subscribe to a slice. Selectors must return stable references (state objects, not new arrays). */
export function useStore<T>(selector: (s: State) => T): T {
  const store = useMailStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
