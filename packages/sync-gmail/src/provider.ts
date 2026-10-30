import {
  CursorInvalidError,
  gmailFolderLabelDelta,
  gmailLabelsToFolder,
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
} from "@ostra/core";
import { buildRawMessage } from "@ostra/core/compose";
import { mimeAttachment, parseMime } from "@ostra/core/mime";
import { HttpError, OAuthSession, type Fetch, type OAuthTokens } from "@ostra/core/oauth";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** gmail.modify: read, label, archive, trash and send. Restricted scope: public launch needs Google's security assessment. */
export const GMAIL_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify"];

export interface GmailCredentials {
  email: string;
  tokens: OAuthTokens;
}

export interface GmailOptions {
  clientId: string;
  clientSecret: string;
  /** projects/<id>/topics/<topic>; without it push is off and polling covers us. */
  pubsubTopic?: string | undefined;
  save: (creds: GmailCredentials) => Promise<void>;
  fetch?: Fetch;
}

interface Cursor {
  v: 1;
  historyId: string;
  /** Present while the initial backfill is still paging. */
  pageToken?: string | null;
  fetched?: number;
}

/** Most recent messages pulled on first sync. */
export const INITIAL_LIMIT = 500;
const PAGE = 100;
const CONCURRENCY = 8;

export function googleAuthUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | undefined }): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
    ...(p.loginHint ? { login_hint: p.loginHint } : {}),
  });
  return `${GOOGLE_AUTH_URL}?${q}`;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}

interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  raw: string;
  internalDate: string;
}

export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  private readonly session: OAuthSession;

  constructor(
    private creds: GmailCredentials,
    private readonly opts: GmailOptions,
  ) {
    this.session = new OAuthSession(
      creds.tokens,
      { tokenUrl: GOOGLE_TOKEN_URL, clientId: opts.clientId, clientSecret: opts.clientSecret },
      async (tokens) => {
        this.creds = { ...this.creds, tokens };
        await opts.save(this.creds);
      },
      opts.fetch,
    );
  }

  private api<T>(path: string, init?: RequestInit) {
    return this.session.json<T>(`${GMAIL_API}${path}`, init);
  }

  private post<T>(path: string, body: unknown) {
    return this.api<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  async connect(): Promise<ConnectResult> {
    const profile = await this.api<{ emailAddress: string }>("/profile");
    const sendAs = await this.api<{ sendAs?: { sendAsEmail: string; displayName?: string; isPrimary?: boolean; verificationStatus?: string }[] }>("/settings/sendAs").catch(() => ({ sendAs: [] }));
    const aliases = (sendAs.sendAs ?? []).filter((s) => s.isPrimary || s.verificationStatus === "accepted");
    const primary = aliases.find((s) => s.isPrimary);
    const identities = [
      { address: profile.emailAddress, displayName: primary?.displayName || null },
      ...aliases.filter((s) => !s.isPrimary).map((s) => ({ address: s.sendAsEmail, displayName: s.displayName || null })),
    ];
    return { displayName: profile.emailAddress, identities };
  }

  private async fetchRaw(id: string): Promise<NormalizedMessage | null> {
    try {
      const m = await this.api<RawMessage>(`/messages/${id}?format=raw`);
      const labels = m.labelIds ?? [];
      return await parseMime(Buffer.from(m.raw, "base64url"), {
        providerMessageId: m.id,
        providerThreadId: m.threadId,
        folder: gmailLabelsToFolder(labels),
        isRead: !labels.includes("UNREAD"),
        receivedAt: new Date(Number(m.internalDate)),
        providerLabels: labels,
      });
    } catch (err) {
      // Deleted between listing and fetching.
      if (err instanceof HttpError && err.status === 404) return null;
      throw err;
    }
  }

  async initialSync(cursorRaw?: string | null): Promise<SyncBatch> {
    let cursor: Cursor | null = cursorRaw ? (JSON.parse(cursorRaw) as Cursor) : null;
    if (!cursor) {
      // Take the history id first, so nothing that arrives during backfill is missed.
      const profile = await this.api<{ historyId: string }>("/profile");
      cursor = { v: 1, historyId: profile.historyId, pageToken: null, fetched: 0 };
    }
    if (cursor.pageToken === undefined) return { messages: [], updates: [], deleted: [], cursor: JSON.stringify(cursor), hasMore: false };

    const q = new URLSearchParams({ maxResults: String(PAGE), includeSpamTrash: "true", q: "newer_than:90d" });
    if (cursor.pageToken) q.set("pageToken", cursor.pageToken);
    const list = await this.api<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${q}`);
    const messages = (await pool(list.messages ?? [], CONCURRENCY, (m) => this.fetchRaw(m.id))).filter((m): m is NormalizedMessage => !!m);
    const fetched = (cursor.fetched ?? 0) + messages.length;
    const more = !!list.nextPageToken && fetched < INITIAL_LIMIT;
    const next: Cursor = more ? { ...cursor, pageToken: list.nextPageToken, fetched } : { v: 1, historyId: cursor.historyId };
    return { messages, updates: [], deleted: [], cursor: JSON.stringify(next), hasMore: more };
  }

  async incrementalSync(cursorRaw: string): Promise<SyncBatch> {
    const cursor = JSON.parse(cursorRaw) as Cursor;
    if (cursor.pageToken !== undefined) return this.initialSync(cursorRaw);
    const added = new Set<string>();
    const updates = new Map<string, FlagUpdate>();
    const deleted = new Set<string>();
    let pageToken: string | undefined;
    let historyId = cursor.historyId;
    type LabelChange = { message: { id: string; labelIds?: string[] } };
    do {
      const q = new URLSearchParams({ startHistoryId: cursor.historyId });
      for (const t of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) q.append("historyTypes", t);
      if (pageToken) q.set("pageToken", pageToken);
      let page: {
        history?: { messagesAdded?: LabelChange[]; messagesDeleted?: LabelChange[]; labelsAdded?: LabelChange[]; labelsRemoved?: LabelChange[] }[];
        nextPageToken?: string;
        historyId: string;
      };
      try {
        page = await this.api(`/history?${q}`);
      } catch (err) {
        // historyId too old (Gmail keeps about a week): full resync.
        if (err instanceof HttpError && err.status === 404) throw new CursorInvalidError("Gmail history expired");
        throw err;
      }
      for (const h of page.history ?? []) {
        for (const a of h.messagesAdded ?? []) {
          // Drafts churn on every keystroke; they come in via sync of the DRAFT label only when saved.
          if (!a.message.labelIds?.includes("DRAFT")) added.add(a.message.id);
        }
        for (const d of h.messagesDeleted ?? []) {
          deleted.add(d.message.id);
          added.delete(d.message.id);
        }
        for (const c of [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])]) {
          const labels = c.message.labelIds ?? [];
          updates.set(c.message.id, { providerMessageId: c.message.id, isRead: !labels.includes("UNREAD"), folder: gmailLabelsToFolder(labels) });
        }
      }
      pageToken = page.nextPageToken;
      historyId = page.historyId ?? historyId;
    } while (pageToken);

    const messages = (await pool([...added], CONCURRENCY, (id) => this.fetchRaw(id))).filter((m): m is NormalizedMessage => !!m);
    for (const m of messages) updates.delete(m.providerMessageId);
    return { messages, updates: [...updates.values()].filter((u) => !deleted.has(u.providerMessageId)), deleted: [...deleted], cursor: JSON.stringify({ v: 1, historyId } satisfies Cursor), hasMore: false };
  }

  /** Pub/Sub watch on the mailbox; notifications arrive at /webhooks/gmail. Expires after 7 days. */
  async subscribe(): Promise<Subscription> {
    const noop = { expiresAt: null, resourceId: this.creds.email, close: async () => {} };
    if (!this.opts.pubsubTopic) return noop;
    const r = await this.post<{ historyId: string; expiration: string }>("/watch", { topicName: this.opts.pubsubTopic, labelFilterBehavior: "exclude", labelIds: ["DRAFT"] });
    return {
      expiresAt: new Date(Number(r.expiration)).toISOString(),
      resourceId: this.creds.email,
      close: async () => {
        await this.post("/stop", {}).catch(() => {});
      },
    };
  }

  async applyAction(id: string, action: ProviderAction): Promise<ActionResult | void> {
    const modify = (add: string[], remove: string[]) => this.post(`/messages/${id}/modify`, { addLabelIds: add, removeLabelIds: remove });
    switch (action.type) {
      case "markRead":
        await modify([], ["UNREAD"]);
        return;
      case "markUnread":
        await modify(["UNREAD"], []);
        return;
      case "trash":
        await this.post(`/messages/${id}/trash`, {});
        return;
      default: {
        const folder = action.type === "move" ? action.folder : action.type;
        if (folder === "trash") {
          await this.post(`/messages/${id}/trash`, {});
          return;
        }
        // Leaving trash needs an explicit untrash.
        await this.post(`/messages/${id}/untrash`, {}).catch(() => {});
        const { add, remove } = gmailFolderLabelDelta(folder);
        await modify(add, remove);
      }
    }
  }

  async send(message: OutgoingMessage, identity: IdentityRef): Promise<SendResult> {
    const built = await buildRawMessage(message, identity);
    const r = await this.post<{ id: string; threadId: string }>("/messages/send", {
      raw: built.raw.toString("base64url"),
      ...(message.providerThreadId ? { threadId: message.providerThreadId } : {}),
    });
    return { providerMessageId: r.id, rfcMessageId: built.rfcMessageId };
  }

  async fetchAttachment(id: string, index: string): Promise<Uint8Array> {
    const m = await this.api<RawMessage>(`/messages/${id}?format=raw`);
    const bytes = await mimeAttachment(Buffer.from(m.raw, "base64url"), Number(index));
    if (!bytes) throw new Error("Attachment not found");
    return bytes;
  }
}
