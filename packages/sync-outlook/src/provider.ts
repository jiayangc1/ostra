import {
  CursorInvalidError,
  OUTLOOK_FOLDER_FOR,
  type ActionResult,
  type ConnectResult,
  type FlagUpdate,
  type IdentityRef,
  type MailProvider,
  type NormalizedMessage,
  type OutgoingMessage,
  type ProviderAction,
  type SendResult,
  type Subscription,
  type SyncBatch,
  type VirtualFolder,
} from "@ostra/core";
import { buildRawMessage } from "@ostra/core/compose";
import { mimeAttachment, parseMime } from "@ostra/core/mime";
import { HttpError, OAuthSession, type Fetch, type OAuthTokens } from "@ostra/core/oauth";

export const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_SCOPES = ["offline_access", "openid", "email", "profile", "User.Read", "Mail.ReadWrite", "Mail.Send"];
export const msTokenUrl = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

export interface OutlookCredentials {
  email: string;
  tokens: OAuthTokens;
}

export interface OutlookOptions {
  clientId: string;
  clientSecret: string;
  tenant: string;
  save: (creds: OutlookCredentials) => Promise<void>;
  /** Public https URL of /webhooks/graph; without it push is off and polling covers us. */
  notificationUrl?: string | undefined;
  /** Random per-account secret echoed back by Graph in every notification. */
  clientState: string;
  fetch?: Fetch;
}

/** Folders we sync, by Graph well-known name. */
const FOLDERS: { wk: string; folder: VirtualFolder }[] = [
  { wk: "inbox", folder: "inbox" },
  { wk: "sentitems", folder: "sent" },
  { wk: "drafts", folder: "drafts" },
  { wk: "junkemail", folder: "spam" },
  { wk: "deleteditems", folder: "trash" },
  { wk: "archive", folder: "archive" },
];

interface FolderState {
  wk: string;
  folder: VirtualFolder;
  /** nextLink while paging, deltaLink once caught up; null when the folder doesn't exist. */
  link: string | null;
  done: boolean;
}

interface Cursor {
  v: 1;
  folders: FolderState[];
  /** When the last incremental sync ran; items received after this are new mail. */
  lastRun: string;
}

interface GraphItem {
  id: string;
  conversationId?: string;
  isRead?: boolean;
  receivedDateTime?: string;
  "@removed"?: { reason: string };
}

const HEADERS = { Prefer: 'IdType="ImmutableId", odata.maxpagesize=50' };
const SELECT = "id,conversationId,isRead,receivedDateTime,internetMessageId";
const BACKFILL_DAYS = 90;

export function microsoftAuthUrl(p: { clientId: string; tenant: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | undefined }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: p.redirectUri,
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  });
  return `https://login.microsoftonline.com/${p.tenant}/oauth2/v2.0/authorize?${q}`;
}

export class OutlookProvider implements MailProvider {
  readonly kind = "outlook" as const;
  private readonly session: OAuthSession;

  constructor(
    private creds: OutlookCredentials,
    private readonly opts: OutlookOptions,
  ) {
    this.session = new OAuthSession(
      creds.tokens,
      { tokenUrl: msTokenUrl(opts.tenant), clientId: opts.clientId, clientSecret: opts.clientSecret, refreshParams: { scope: MS_SCOPES.join(" ") } },
      async (tokens) => {
        this.creds = { ...this.creds, tokens };
        await opts.save(this.creds);
      },
      opts.fetch,
    );
  }

  private get<T>(pathOrUrl: string) {
    return this.session.json<T>(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`, { headers: HEADERS });
  }

  private send_<T>(method: string, path: string, body?: unknown, contentType = "application/json") {
    return this.session.json<T>(`${GRAPH}${path}`, {
      method,
      headers: { ...HEADERS, "Content-Type": contentType },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async connect(): Promise<ConnectResult> {
    const me = await this.get<{ id: string; mail?: string | null; userPrincipalName: string; displayName?: string | null }>("/me?$select=id,mail,userPrincipalName,displayName");
    const address = me.mail || me.userPrincipalName;
    return { displayName: address, identities: [{ address, displayName: me.displayName ?? null }] };
  }

  private async fetchMime(item: GraphItem, folder: VirtualFolder): Promise<NormalizedMessage | null> {
    try {
      const res = await this.session.request(`${GRAPH}/me/messages/${item.id}/$value`, { headers: HEADERS });
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpError(res.status, `MIME fetch failed (${res.status})`, null);
      return await parseMime(Buffer.from(await res.arrayBuffer()), {
        providerMessageId: item.id,
        providerThreadId: item.conversationId,
        folder,
        isRead: item.isRead ?? false,
        receivedAt: item.receivedDateTime,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  private async startFolder(f: (typeof FOLDERS)[number]): Promise<FolderState> {
    try {
      await this.get(`/me/mailFolders/${f.wk}?$select=id`);
    } catch (err) {
      // Not every mailbox has an Archive folder.
      if (err instanceof HttpError && err.status === 404) return { ...f, link: null, done: true };
      throw err;
    }
    const since = new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString();
    return { ...f, link: `${GRAPH}/me/mailFolders/${f.wk}/messages/delta?$select=${SELECT}&$filter=receivedDateTime+ge+${since}`, done: false };
  }

  /** Walk each folder's delta to its deltaLink, one folder per call. */
  async initialSync(cursorRaw?: string | null): Promise<SyncBatch> {
    let cursor: Cursor = cursorRaw ? (JSON.parse(cursorRaw) as Cursor) : { v: 1, folders: [], lastRun: new Date().toISOString() };
    if (cursor.folders.length === 0) cursor = { ...cursor, folders: await Promise.all(FOLDERS.map((f) => this.startFolder(f))) };
    const state = cursor.folders.find((f) => !f.done);
    if (!state) return { messages: [], updates: [], deleted: [], cursor: JSON.stringify(cursor), hasMore: false };

    const messages: NormalizedMessage[] = [];
    let link = state.link!;
    for (let page = 0; page < 10; page++) {
      const r = await this.get<{ value: GraphItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(link);
      for (const item of r.value) {
        if (item["@removed"]) continue;
        const m = await this.fetchMime(item, state.folder);
        if (m) messages.push(m);
      }
      if (r["@odata.deltaLink"]) {
        state.link = r["@odata.deltaLink"];
        state.done = true;
        break;
      }
      link = r["@odata.nextLink"]!;
      state.link = link;
    }
    return { messages, updates: [], deleted: [], cursor: JSON.stringify(cursor), hasMore: cursor.folders.some((f) => !f.done) };
  }

  async incrementalSync(cursorRaw: string): Promise<SyncBatch> {
    const cursor = JSON.parse(cursorRaw) as Cursor;
    if (cursor.folders.some((f) => !f.done)) return this.initialSync(cursorRaw);
    const lastRun = Date.parse(cursor.lastRun) - 5 * 60_000;
    const seen = new Map<string, { item: GraphItem; folder: VirtualFolder }>();
    const removed = new Set<string>();

    for (const state of cursor.folders) {
      if (!state.link) continue;
      let link = state.link;
      for (;;) {
        let r: { value: GraphItem[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
        try {
          r = await this.get(link);
        } catch (err) {
          // Expired / invalid delta token.
          if (err instanceof HttpError && (err.status === 410 || (err.status === 400 && /sync/i.test(err.message)))) throw new CursorInvalidError("Graph delta token expired");
          throw err;
        }
        for (const item of r.value) {
          if (item["@removed"]) removed.add(item.id);
          else seen.set(item.id, { item, folder: state.folder });
        }
        if (r["@odata.deltaLink"]) {
          state.link = r["@odata.deltaLink"];
          break;
        }
        link = r["@odata.nextLink"]!;
      }
    }

    const messages: NormalizedMessage[] = [];
    const updates: FlagUpdate[] = [];
    for (const { item, folder } of seen.values()) {
      const isNew = item.receivedDateTime && Date.parse(item.receivedDateTime) >= lastRun;
      if (isNew) {
        const m = await this.fetchMime(item, folder);
        if (m) messages.push(m);
      } else {
        updates.push({ providerMessageId: item.id, isRead: item.isRead, folder });
      }
    }
    // With immutable ids a move shows up as removed in one folder and present in another.
    const deleted = [...removed].filter((id) => !seen.has(id));
    const next: Cursor = { ...cursor, lastRun: new Date().toISOString() };
    return { messages, updates, deleted, cursor: JSON.stringify(next), hasMore: false };
  }

  /** Graph change notifications; arrive at /webhooks/graph with our clientState. */
  async subscribe(): Promise<Subscription> {
    if (!this.opts.notificationUrl) return { expiresAt: null, resourceId: null, close: async () => {} };
    const expiresAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const sub = await this.send_<{ id: string; expirationDateTime: string }>("POST", "/subscriptions", {
      changeType: "created,updated,deleted",
      notificationUrl: this.opts.notificationUrl,
      resource: "/me/messages",
      expirationDateTime: expiresAt,
      clientState: this.opts.clientState,
    });
    return {
      expiresAt: sub.expirationDateTime,
      resourceId: sub.id,
      close: async () => {
        await this.send_("DELETE", `/subscriptions/${sub.id}`).catch(() => {});
      },
    };
  }

  async applyAction(id: string, action: ProviderAction): Promise<ActionResult | void> {
    switch (action.type) {
      case "markRead":
      case "markUnread":
        await this.send_("PATCH", `/me/messages/${id}`, { isRead: action.type === "markRead" });
        return;
      default: {
        const folder = action.type === "move" ? action.folder : action.type;
        const destinationId = OUTLOOK_FOLDER_FOR[folder];
        if (!destinationId) throw new Error(`Can't move to ${folder}`);
        const moved = await this.send_<{ id: string }>("POST", `/me/messages/${id}/move`, { destinationId });
        return { providerMessageId: moved.id };
      }
    }
  }

  /** Graph accepts a base64 MIME body on sendMail and files it in Sent Items. */
  async send(message: OutgoingMessage, identity: IdentityRef): Promise<SendResult> {
    const built = await buildRawMessage(message, identity);
    const res = await this.session.request(`${GRAPH}/me/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: built.raw.toString("base64"),
    });
    if (!res.ok) throw new HttpError(res.status, `sendMail failed (${res.status})`, await res.text().catch(() => null));
    return { providerMessageId: `graph-sent:${built.rfcMessageId}`, rfcMessageId: built.rfcMessageId };
  }

  async fetchAttachment(id: string, index: string): Promise<Uint8Array> {
    const res = await this.session.request(`${GRAPH}/me/messages/${id}/$value`, { headers: HEADERS });
    if (!res.ok) throw new HttpError(res.status, "MIME fetch failed", null);
    const bytes = await mimeAttachment(Buffer.from(await res.arrayBuffer()), Number(index));
    if (!bytes) throw new Error("Attachment not found");
    return bytes;
  }
}
