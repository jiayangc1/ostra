import {
  AuthExpiredError,
  CursorInvalidError,
  imapMailboxToFolder,
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
import { ImapFlow, type ImapFlowOptions, type ListResponse } from "imapflow";
import nodemailer from "nodemailer";

export interface ServerSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface ImapCredentials {
  address: string;
  displayName: string | null;
  imap: ServerSettings;
  smtp: ServerSettings;
  /** Extra send-as addresses on the same mailbox (aliases). */
  aliases?: string[];
}

interface BoxState {
  path: string;
  folder: VirtualFolder;
  uidValidity: string;
  lastUid: number;
  /** UIDs inside the sync window (newest ~1000), to detect deletions. */
  known: number[];
  /** UIDs in the window without \Seen, to detect read-state changes. */
  unseen: number[];
  /** Initial sync for this mailbox finished. */
  done: boolean;
}

interface Cursor {
  v: 1;
  boxes: BoxState[];
}

/** Mailboxes we sync, one per unified folder. */
const SYNCED: VirtualFolder[] = ["inbox", "sent", "drafts", "spam", "trash", "archive"];
/** Most recent messages fetched per mailbox on first sync. */
export const INITIAL_LIMIT = 300;
const WINDOW = 1000;
const FETCH_CHUNK = 50;

/** Provider message ids carry mailbox + UIDVALIDITY + UID: `uidValidity:uid:path`. */
export function encodeId(path: string, uidValidity: string | bigint, uid: number): string {
  return `${uidValidity}:${uid}:${path}`;
}

export function decodeId(id: string): { uidValidity: string; uid: number; path: string } {
  const a = id.indexOf(":");
  const b = id.indexOf(":", a + 1);
  if (a < 0 || b < 0) throw new Error("Malformed IMAP message id");
  return { uidValidity: id.slice(0, a), uid: Number(id.slice(a + 1, b)), path: id.slice(b + 1) };
}

/** Pick one mailbox per unified folder, preferring SPECIAL-USE flags over names. */
export function chooseMailboxes(list: Pick<ListResponse, "path" | "specialUse" | "delimiter" | "flags">[]): Map<VirtualFolder, string> {
  const chosen = new Map<VirtualFolder, { path: string; special: boolean }>();
  for (const box of list) {
    if (box.flags?.has("\\Noselect") || box.flags?.has("\\NonExistent")) continue;
    // Gmail's "All Mail" duplicates every other folder.
    if (box.specialUse === "\\All") continue;
    const folder = imapMailboxToFolder(box);
    if (!SYNCED.includes(folder)) continue;
    const special = !!box.specialUse || box.path.toUpperCase() === "INBOX";
    // Only well-known archive names or \Archive count; random user folders don't.
    if (folder === "archive" && !special && !/^archives?$/i.test(box.path.split(box.delimiter || "/").pop() ?? "")) continue;
    const current = chosen.get(folder);
    if (!current || (special && !current.special)) chosen.set(folder, { path: box.path, special });
  }
  return new Map([...chosen].map(([f, v]) => [f, v.path]));
}

/** Compress a sorted UID list into an IMAP sequence set ("1:5,9,12:14"). */
export function toSequenceSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}:${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

function isAuthFailure(err: unknown): boolean {
  const e = err as { authenticationFailed?: boolean; responseCode?: string; code?: string; responseText?: string };
  return !!e && (e.authenticationFailed === true || e.responseCode === "AUTHENTICATIONFAILED" || e.code === "EAUTH");
}

export type ImapClientFactory = (opts: ImapFlowOptions) => ImapFlow;
export type SmtpFactory = (s: ServerSettings) => { sendMail(opts: { envelope: { from: string; to: string[] }; raw: Buffer }): Promise<unknown>; verify(): Promise<unknown>; close?(): void };

export interface ImapProviderOptions {
  /** Injected in tests. */
  imapFactory?: ImapClientFactory;
  smtpFactory?: SmtpFactory;
  log?: (msg: string, err?: unknown) => void;
  /** SSRF guard: throws when a host must not be contacted. Runs before every connection. */
  checkHost?: (host: string) => Promise<void>;
}

const defaultImapFactory: ImapClientFactory = (opts) => new ImapFlow(opts);
const defaultSmtpFactory: SmtpFactory = (s) =>
  nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15_000 });

export class ImapProvider implements MailProvider {
  readonly kind = "imap" as const;
  private client: ImapFlow | null = null;
  private readonly imapFactory: ImapClientFactory;
  private readonly smtpFactory: SmtpFactory;
  private readonly log: (msg: string, err?: unknown) => void;
  private readonly checkHost: (host: string) => Promise<void>;

  constructor(
    private readonly creds: ImapCredentials,
    opts: ImapProviderOptions = {},
  ) {
    this.imapFactory = opts.imapFactory ?? defaultImapFactory;
    this.smtpFactory = opts.smtpFactory ?? defaultSmtpFactory;
    this.log = opts.log ?? (() => {});
    this.checkHost = opts.checkHost ?? (async () => {});
  }

  private options(): ImapFlowOptions {
    const s = this.creds.imap;
    return { host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass }, logger: false, emitLogs: false };
  }

  private async imap(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    await this.checkHost(this.creds.imap.host);
    const client = this.imapFactory(this.options());
    client.on("error", (err: unknown) => this.log("imap connection error", err));
    try {
      await client.connect();
    } catch (err) {
      if (isAuthFailure(err)) throw new AuthExpiredError("IMAP sign-in failed");
      throw err;
    }
    this.client = client;
    return client;
  }

  async close() {
    const c = this.client;
    this.client = null;
    if (c?.usable) await c.logout().catch(() => c.close());
  }

  /** Verify IMAP and SMTP before saving the account, with errors a person can act on. */
  async connect(): Promise<ConnectResult> {
    try {
      const client = await this.imap();
      await client.list();
    } catch (err) {
      if (err instanceof Error && err.name === "UnsafeHostError") throw err;
      if (err instanceof AuthExpiredError) throw new Error("The IMAP server rejected that username or password.");
      throw new Error(`Couldn't reach the IMAP server at ${this.creds.imap.host}:${this.creds.imap.port}.`);
    }
    try {
      await this.checkHost(this.creds.smtp.host);
      await this.smtpFactory(this.creds.smtp).verify();
    } catch (err) {
      if (err instanceof Error && err.name === "UnsafeHostError") throw err;
      if (isAuthFailure(err)) throw new Error("The SMTP server rejected that username or password.");
      throw new Error(`Couldn't reach the SMTP server at ${this.creds.smtp.host}:${this.creds.smtp.port}.`);
    }
    return {
      displayName: this.creds.address,
      identities: [
        { address: this.creds.address, displayName: this.creds.displayName },
        ...(this.creds.aliases ?? []).map((a) => ({ address: a, displayName: this.creds.displayName })),
      ],
    };
  }

  private parseCursor(raw: string | null | undefined): Cursor | null {
    if (!raw) return null;
    try {
      const c = JSON.parse(raw) as Cursor;
      return c.v === 1 ? c : null;
    } catch {
      return null;
    }
  }

  private async freshCursor(client: ImapFlow): Promise<Cursor> {
    const boxes = chooseMailboxes(await client.list());
    return {
      v: 1,
      boxes: SYNCED.filter((f) => boxes.has(f)).map((folder) => ({ path: boxes.get(folder)!, folder, uidValidity: "", lastUid: 0, known: [], unseen: [], done: false })),
    };
  }

  private async fetchMessages(client: ImapFlow, box: BoxState, uids: number[]): Promise<NormalizedMessage[]> {
    const out: NormalizedMessage[] = [];
    for (let i = 0; i < uids.length; i += FETCH_CHUNK) {
      const chunk = uids.slice(i, i + FETCH_CHUNK);
      for await (const msg of client.fetch(toSequenceSet(chunk), { uid: true, flags: true, source: true, internalDate: true }, { uid: true })) {
        if (!msg.source) continue;
        try {
          out.push(
            await parseMime(msg.source, {
              providerMessageId: encodeId(box.path, box.uidValidity, msg.uid),
              folder: box.folder,
              isRead: msg.flags?.has("\\Seen") ?? false,
              receivedAt: msg.internalDate,
              providerThreadId: msg.threadId,
            }),
          );
        } catch (err) {
          this.log(`skipping unparsable message uid ${msg.uid}`, err);
        }
      }
    }
    return out;
  }

  /** First sync: the most recent messages of one mailbox per call. */
  async initialSync(cursorRaw?: string | null): Promise<SyncBatch> {
    const client = await this.imap();
    const cursor = this.parseCursor(cursorRaw) ?? (await this.freshCursor(client));
    const box = cursor.boxes.find((b) => !b.done);
    if (!box) return { messages: [], updates: [], deleted: [], cursor: JSON.stringify(cursor), hasMore: false };

    const lock = await client.getMailboxLock(box.path, { readOnly: true });
    try {
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error(`Couldn't open ${box.path}`);
      box.uidValidity = String(mailbox.uidValidity);
      const all = ((await client.search({ all: true }, { uid: true })) || []).sort((a, b) => a - b);
      const recent = all.slice(-INITIAL_LIMIT);
      const messages = await this.fetchMessages(client, box, recent);
      box.lastUid = Math.max(mailbox.uidNext - 1, all[all.length - 1] ?? 0);
      box.known = all.slice(-WINDOW);
      box.unseen = messages.filter((m) => !m.isRead).map((m) => decodeId(m.providerMessageId).uid);
      box.done = true;
      return { messages, updates: [], deleted: [], cursor: JSON.stringify(cursor), hasMore: cursor.boxes.some((b) => !b.done) };
    } finally {
      lock.release();
    }
  }

  /** New mail since lastUid, read-state changes and deletions inside the window. */
  async incrementalSync(cursorRaw: string): Promise<SyncBatch> {
    const cursor = this.parseCursor(cursorRaw);
    if (!cursor || cursor.boxes.some((b) => !b.done)) return this.initialSync(cursorRaw);
    const client = await this.imap();
    const messages: NormalizedMessage[] = [];
    const updates: FlagUpdate[] = [];
    const deleted: string[] = [];

    for (const box of cursor.boxes) {
      let lock;
      try {
        lock = await client.getMailboxLock(box.path, { readOnly: true });
      } catch (err) {
        this.log(`mailbox ${box.path} unavailable`, err);
        continue;
      }
      try {
        const mailbox = client.mailbox;
        if (!mailbox) continue;
        if (String(mailbox.uidValidity) !== box.uidValidity) throw new CursorInvalidError(`UIDVALIDITY changed for ${box.path}`);

        const present = ((await client.search({ all: true }, { uid: true })) || []).sort((a, b) => a - b);
        const presentSet = new Set(present);
        const fresh = present.filter((u) => u > box.lastUid);
        if (fresh.length) messages.push(...(await this.fetchMessages(client, box, fresh.slice(-INITIAL_LIMIT))));

        for (const uid of box.known) if (!presentSet.has(uid)) deleted.push(encodeId(box.path, box.uidValidity, uid));

        // Read-state: only for the window, flags only (cheap).
        const windowUids = present.filter((u) => u <= box.lastUid).slice(-WINDOW);
        const wasUnseen = new Set(box.unseen);
        const nowUnseen: number[] = [];
        if (windowUids.length) {
          for await (const msg of client.fetch(toSequenceSet(windowUids), { uid: true, flags: true }, { uid: true })) {
            const seen = msg.flags?.has("\\Seen") ?? false;
            if (!seen) nowUnseen.push(msg.uid);
            if (seen === wasUnseen.has(msg.uid)) {
              updates.push({ providerMessageId: encodeId(box.path, box.uidValidity, msg.uid), isRead: seen });
            }
          }
        }
        box.lastUid = Math.max(box.lastUid, mailbox.uidNext - 1, present[present.length - 1] ?? 0);
        box.known = present.slice(-WINDOW);
        box.unseen = [
          ...nowUnseen,
          ...messages
            .map((m) => ({ m, id: decodeId(m.providerMessageId) }))
            .filter(({ m, id }) => !m.isRead && id.path === box.path)
            .map(({ id }) => id.uid),
        ];
      } finally {
        lock.release();
      }
    }
    return { messages, updates, deleted, cursor: JSON.stringify(cursor), hasMore: false };
  }

  /** IMAP IDLE on INBOX over a dedicated connection; reconnects with backoff. */
  async subscribe(onChange: () => void): Promise<Subscription> {
    let closed = false;
    let client: ImapFlow | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(onChange, 500);
    };

    const start = async (): Promise<void> => {
      if (closed) return;
      await this.checkHost(this.creds.imap.host);
      const c = this.imapFactory({ ...this.options(), disableAutoIdle: false });
      client = c;
      c.on("exists", changed);
      c.on("expunge", changed);
      c.on("flags", changed);
      c.on("error", (err: unknown) => this.log("idle connection error", err));
      c.on("close", () => {
        if (closed) return;
        const wait = Math.min(2 ** attempt++ * 1000, 5 * 60_000);
        timer = setTimeout(() => void start().catch((err) => this.log("idle reconnect failed", err)), wait);
      });
      try {
        await c.connect();
      } catch (err) {
        if (isAuthFailure(err)) throw new AuthExpiredError("IMAP sign-in failed");
        throw err;
      }
      await c.mailboxOpen("INBOX", { readOnly: true });
      attempt = 0;
      changed(); // catch anything that arrived while we were disconnected
    };

    await start();
    return {
      expiresAt: null,
      resourceId: null,
      close: async () => {
        closed = true;
        if (timer) clearTimeout(timer);
        if (debounce) clearTimeout(debounce);
        const c = client as ImapFlow | null;
        if (c?.usable) await c.logout().catch(() => c.close());
      },
    };
  }

  private async destination(client: ImapFlow, folder: VirtualFolder): Promise<string> {
    const boxes = chooseMailboxes(await client.list());
    const found = boxes.get(folder);
    if (found) return found;
    if (folder === "archive") {
      await client.mailboxCreate("Archive");
      return "Archive";
    }
    if (folder === "inbox") return "INBOX";
    throw new Error(`This server has no ${folder} folder`);
  }

  async applyAction(providerMessageId: string, action: ProviderAction): Promise<ActionResult | void> {
    const { path, uid, uidValidity } = decodeId(providerMessageId);
    const client = await this.imap();
    const lock = await client.getMailboxLock(path);
    try {
      if (String(client.mailbox && client.mailbox.uidValidity) !== uidValidity) throw new CursorInvalidError("Mailbox changed; resync needed");
      const range = String(uid);
      switch (action.type) {
        case "markRead":
          await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
          return;
        case "markUnread":
          await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
          return;
        default: {
          const folder: VirtualFolder = action.type === "move" ? action.folder : action.type;
          const dest = await this.destination(client, folder);
          if (dest === path) return;
          const res = await client.messageMove(range, dest, { uid: true });
          const newUid = res && res.uidMap?.get(uid);
          if (res && newUid && res.uidValidity !== undefined) return { providerMessageId: encodeId(dest, res.uidValidity, newUid) };
          return;
        }
      }
    } finally {
      lock.release();
    }
  }

  async send(message: OutgoingMessage, identity: IdentityRef): Promise<SendResult> {
    const built = await buildRawMessage(message, identity);
    await this.checkHost(this.creds.smtp.host);
    const smtp = this.smtpFactory(this.creds.smtp);
    try {
      await smtp.sendMail({ envelope: { from: identity.address, to: built.recipients }, raw: built.raw });
    } catch (err) {
      if (isAuthFailure(err)) throw new AuthExpiredError("SMTP sign-in failed");
      throw err;
    } finally {
      smtp.close?.();
    }

    // Gmail and Outlook.com file sent mail themselves; everyone else needs an APPEND.
    let providerMessageId = `smtp:${built.rfcMessageId}`;
    if (!/gmail\.com|googlemail\.com|outlook\.|office365\.com/i.test(this.creds.smtp.host)) {
      try {
        const client = await this.imap();
        const sent = await this.destination(client, "sent");
        const res = await client.append(sent, built.raw, ["\\Seen"], built.date);
        if (res && res.uid && res.uidValidity !== undefined) providerMessageId = encodeId(sent, res.uidValidity, res.uid);
      } catch (err) {
        // The mail went out; failing to file a copy must not look like a failed send.
        this.log("couldn't append to Sent", err);
      }
    }
    return { providerMessageId, rfcMessageId: built.rfcMessageId };
  }

  async fetchAttachment(providerMessageId: string, providerAttachmentId: string): Promise<Uint8Array> {
    const { path, uid } = decodeId(providerMessageId);
    const client = await this.imap();
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error("Message not found on server");
      const bytes = await mimeAttachment(msg.source, Number(providerAttachmentId));
      if (!bytes) throw new Error("Attachment not found");
      return bytes;
    } finally {
      lock.release();
    }
  }
}
