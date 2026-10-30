import {
  dedupeKey,
  makeSnippet,
  htmlToText,
  normalizeMessageId,
  normalizeSubject,
  threadingCandidates,
  type FlagUpdate,
  type NormalizedMessage,
  type SyncBatch,
  type VirtualFolder,
} from "@ostra/core";
import { and, eq, inArray, messageAccounts, messages, threads, type AccountRow, type Db } from "@ostra/db";
import type { Services } from "./context.ts";
import { bodyKey, refreshThread, summarize, type StoredBody } from "./threads.ts";

/** Folders a message counts as "received" in, i.e. worth categorizing and labeling. */
const INCOMING: ReadonlySet<VirtualFolder> = new Set(["inbox", "archive", "spam"]);

/** When the same message is in several accounts in different folders, the most visible one wins. */
const VISIBILITY: VirtualFolder[] = ["inbox", "drafts", "sent", "archive", "spam", "trash", "snoozed"];
const moreVisible = (a: VirtualFolder, b: VirtualFolder) => (VISIBILITY.indexOf(a) <= VISIBILITY.indexOf(b) ? a : b);

export interface IngestResult {
  /** New messages that should go through categorize + auto-label. */
  newIncoming: string[];
  touchedThreads: Set<string>;
  added: number;
}

async function findThreadFor(db: Db, userId: string, account: AccountRow, m: NormalizedMessage, rfcId: string | null): Promise<string | null> {
  const candidates = threadingCandidates(m);
  if (candidates.length) {
    const [hit] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.userId, userId), inArray(messages.rfcMessageId, candidates)))
      .limit(1);
    if (hit) return hit.threadId;
  }
  // A reply that arrived before its parent.
  if (rfcId) {
    const [child] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.userId, userId), eq(messages.inReplyTo, rfcId)))
      .limit(1);
    if (child) return child.threadId;
  }
  if (m.providerThreadId) {
    const [sibling] = await db
      .select({ threadId: messages.threadId })
      .from(messages)
      .where(and(eq(messages.accountId, account.id), eq(messages.providerThreadId, m.providerThreadId)))
      .limit(1);
    if (sibling) return sibling.threadId;
  }
  return null;
}

export async function ingestMessage(s: Services, account: AccountRow, m: NormalizedMessage, result: IngestResult): Promise<void> {
  const { db } = s;
  const userId = account.userId;
  const key = dedupeKey(m);
  const rfcId = normalizeMessageId(m.rfcMessageId);

  // Already stored (same email in another account, or a re-sync): just record this account.
  const [existing] = await db.select().from(messages).where(and(eq(messages.userId, userId), eq(messages.dedupeKey, key)));
  if (existing) {
    await db
      .insert(messageAccounts)
      .values({ messageId: existing.id, accountId: account.id, providerMessageId: m.providerMessageId, folder: m.folder })
      .onConflictDoUpdate({ target: [messageAccounts.messageId, messageAccounts.accountId], set: { providerMessageId: m.providerMessageId, folder: m.folder } });
    // The message's folder is the most visible folder across every account holding it.
    const links = await db.select({ folder: messageAccounts.folder }).from(messageAccounts).where(eq(messageAccounts.messageId, existing.id));
    const folder = links.reduce<VirtualFolder>((f, l) => moreVisible(f, l.folder), links[0]?.folder ?? m.folder);
    const isRead = existing.isRead || m.isRead;
    if (folder !== existing.folder || isRead !== existing.isRead) {
      await db.update(messages).set({ folder, isRead }).where(eq(messages.id, existing.id));
    }
    result.touchedThreads.add(existing.threadId);
    return;
  }

  let threadId = await findThreadFor(db, userId, account, m, rfcId);
  if (!threadId) {
    const [t] = await db
      .insert(threads)
      .values({
        userId,
        subject: m.subject,
        normalizedSubject: normalizeSubject(m.subject),
        lastMessageAt: new Date(m.sentAt),
        isRead: m.isRead,
        folder: m.folder,
        aiPending: INCOMING.has(m.folder),
      })
      .returning({ id: threads.id });
    threadId = t!.id;
  }

  const text = m.bodyText ?? (m.bodyHtml ? htmlToText(m.bodyHtml) : null);
  const [row] = await db
    .insert(messages)
    .values({
      threadId,
      userId,
      accountId: account.id,
      providerMessageId: m.providerMessageId,
      providerThreadId: m.providerThreadId ?? null,
      rfcMessageId: rfcId,
      dedupeKey: key,
      inReplyTo: normalizeMessageId(m.inReplyTo),
      references: m.references.map((r) => normalizeMessageId(r)).filter((r): r is string => !!r),
      from: m.from,
      to: m.to,
      cc: m.cc,
      bcc: m.bcc,
      replyTo: m.replyTo,
      subject: m.subject,
      snippet: m.snippet || makeSnippet(text),
      hasAttachments: m.attachments.some((a) => !a.inline),
      attachments: m.attachments,
      headers: m.headers,
      sentAt: new Date(m.sentAt),
      folder: m.folder,
      isRead: m.isRead,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (!row) return; // lost a race with a concurrent sync of another account; that one recorded it

  const ref = bodyKey(userId, row.id);
  await s.blobs.putJson(ref, { text: m.bodyText, html: m.bodyHtml } satisfies StoredBody);
  await db.update(messages).set({ bodyRef: ref }).where(eq(messages.id, row.id));
  await db.insert(messageAccounts).values({ messageId: row.id, accountId: account.id, providerMessageId: m.providerMessageId, folder: m.folder }).onConflictDoNothing();

  if (INCOMING.has(m.folder)) {
    result.newIncoming.push(row.id);
    await db.update(threads).set({ aiPending: true }).where(eq(threads.id, threadId));
  }
  result.touchedThreads.add(threadId);
  result.added++;
}

async function applyUpdate(s: Services, account: AccountRow, u: FlagUpdate, result: IngestResult) {
  const [link] = await s.db
    .select({ messageId: messageAccounts.messageId })
    .from(messageAccounts)
    .where(and(eq(messageAccounts.accountId, account.id), eq(messageAccounts.providerMessageId, u.providerMessageId)));
  if (!link) return;
  if (u.folder) await s.db.update(messageAccounts).set({ folder: u.folder }).where(and(eq(messageAccounts.messageId, link.messageId), eq(messageAccounts.accountId, account.id)));
  const patch: { isRead?: boolean; folder?: VirtualFolder } = {};
  if (u.isRead !== undefined) patch.isRead = u.isRead;
  if (u.folder) {
    const links = await s.db.select({ folder: messageAccounts.folder }).from(messageAccounts).where(eq(messageAccounts.messageId, link.messageId));
    patch.folder = links.reduce<VirtualFolder>((f, l) => moreVisible(f, l.folder), u.folder);
  }
  if (Object.keys(patch).length === 0) return;
  const [m] = await s.db.update(messages).set(patch).where(eq(messages.id, link.messageId)).returning({ threadId: messages.threadId });
  if (m) result.touchedThreads.add(m.threadId);
}

async function applyDelete(s: Services, account: AccountRow, providerMessageId: string, result: IngestResult) {
  const [link] = await s.db
    .delete(messageAccounts)
    .where(and(eq(messageAccounts.accountId, account.id), eq(messageAccounts.providerMessageId, providerMessageId)))
    .returning({ messageId: messageAccounts.messageId });
  if (!link) return;
  // Only delete the message once no account holds it any more.
  const remaining = await s.db.select({ a: messageAccounts.accountId }).from(messageAccounts).where(eq(messageAccounts.messageId, link.messageId)).limit(1);
  if (remaining.length) return;
  const [m] = await s.db.delete(messages).where(eq(messages.id, link.messageId)).returning({ threadId: messages.threadId, bodyRef: messages.bodyRef });
  if (m?.bodyRef) await s.blobs.delete(m.bodyRef).catch(() => {});
  if (m) result.touchedThreads.add(m.threadId);
}

/**
 * Store one sync batch: dedupe across accounts, thread, persist bodies
 * encrypted, push updates to open clients, and queue AI for new mail.
 */
export async function ingestBatch(s: Services, account: AccountRow, batch: Pick<SyncBatch, "messages" | "updates" | "deleted">): Promise<IngestResult> {
  const result: IngestResult = { newIncoming: [], touchedThreads: new Set(), added: 0 };
  // Oldest first so parents exist before replies.
  const ordered = [...batch.messages].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  for (const m of ordered) await ingestMessage(s, account, m, result);
  for (const u of batch.updates) await applyUpdate(s, account, u, result);
  for (const d of batch.deleted) await applyDelete(s, account, d, result);

  const refreshed = [];
  for (const id of result.touchedThreads) {
    const row = await refreshThread(s.db, id);
    if (row) refreshed.push(row);
    else s.hub.publish(account.userId, { type: "thread.remove", threadId: id });
  }
  for (const summary of await summarize(s.db, refreshed)) s.hub.publish(account.userId, { type: "thread.upsert", thread: summary });

  if (result.newIncoming.length) {
    await s.queue.add("ai", { userId: account.userId, messageIds: result.newIncoming });
  }
  return result;
}
