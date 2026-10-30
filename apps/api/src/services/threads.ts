import type { Category, EventPlacement, MessageDetail, ThreadDetail, ThreadLabel, ThreadSummary, VirtualFolder } from "@ostra/core";
import { uniqueAddresses } from "@ostra/core";
import {
  and,
  calendarConnections,
  calendarPlacements,
  desc,
  eq,
  inArray,
  lt,
  messageAccounts,
  messageLabels,
  messages,
  sql,
  threads,
  type Db,
  type ThreadRow,
} from "@ostra/db";
import { notFound } from "../lib/errors.ts";
import type { Services } from "./context.ts";

export interface StoredBody {
  text: string | null;
  html: string | null;
}

export const bodyKey = (userId: string, messageId: string) => `u/${userId}/m/${messageId}.json`;

export interface ListQuery {
  folder?: VirtualFolder | undefined;
  accountId?: string | undefined;
  labelId?: string | undefined;
  /** ISO timestamp; returns threads strictly older. */
  before?: string | undefined;
  limit?: number | undefined;
}

export async function listThreads(db: Db, userId: string, q: ListQuery): Promise<{ threads: ThreadSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 200);
  const conds = [eq(threads.userId, userId)];
  if (q.labelId) {
    conds.push(
      sql`exists (select 1 from ${messageLabels} ml join ${messages} m on m.id = ml.message_id where m.thread_id = ${threads.id} and ml.label_id = ${q.labelId})`,
    );
    if (!q.folder) conds.push(sql`${threads.folder} not in ('trash', 'spam')`);
  }
  if (q.folder) {
    conds.push(sql`exists (select 1 from ${messages} m where m.thread_id = ${threads.id} and m.folder = ${q.folder})`);
  }
  if (q.accountId) {
    conds.push(
      sql`exists (select 1 from ${messageAccounts} ma join ${messages} m on m.id = ma.message_id where m.thread_id = ${threads.id} and ma.account_id = ${q.accountId})`,
    );
  }
  if (q.before) conds.push(lt(threads.lastMessageAt, new Date(q.before)));

  const rows = await db
    .select()
    .from(threads)
    .where(and(...conds))
    .orderBy(desc(threads.lastMessageAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const summaries = await summarize(db, page);
  return {
    threads: summaries,
    nextCursor: rows.length > limit ? page[page.length - 1]!.lastMessageAt.toISOString() : null,
  };
}

/** Build list rows (participants, account dots, labels) for a set of threads. */
export async function summarize(db: Db, rows: ThreadRow[]): Promise<ThreadSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const msgs = await db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      from: messages.from,
      snippet: messages.snippet,
      sentAt: messages.sentAt,
      folder: messages.folder,
      hasAttachments: messages.hasAttachments,
      extracted: messages.extracted,
    })
    .from(messages)
    .where(inArray(messages.threadId, ids))
    .orderBy(messages.sentAt);
  const msgIds = msgs.map((m) => m.id);
  const [accts, lbls] = msgIds.length
    ? await Promise.all([
        db.select({ messageId: messageAccounts.messageId, accountId: messageAccounts.accountId }).from(messageAccounts).where(inArray(messageAccounts.messageId, msgIds)),
        db
          .select({ messageId: messageLabels.messageId, labelId: messageLabels.labelId, source: messageLabels.source, confidence: messageLabels.confidence })
          .from(messageLabels)
          .where(inArray(messageLabels.messageId, msgIds)),
      ])
    : [[], []];

  const threadOfMessage = new Map(msgs.map((m) => [m.id, m.threadId]));
  const byThread = new Map<string, typeof msgs>();
  for (const m of msgs) {
    const list = byThread.get(m.threadId);
    if (list) list.push(m);
    else byThread.set(m.threadId, [m]);
  }
  const accountsByThread = new Map<string, string[]>();
  for (const a of accts) {
    const t = threadOfMessage.get(a.messageId)!;
    const list = accountsByThread.get(t) ?? [];
    if (!list.includes(a.accountId)) list.push(a.accountId);
    accountsByThread.set(t, list);
  }
  const labelsByThread = new Map<string, ThreadLabel[]>();
  for (const l of lbls) {
    const t = threadOfMessage.get(l.messageId)!;
    const list = labelsByThread.get(t) ?? [];
    const existing = list.find((x) => x.labelId === l.labelId);
    // A user-applied label anywhere in the thread wins over an AI one.
    if (!existing) list.push({ labelId: l.labelId, source: l.source, confidence: l.confidence });
    else if (l.source === "user") existing.source = "user";
    labelsByThread.set(t, list);
  }

  return rows.map((t) => {
    const ms = byThread.get(t.id) ?? [];
    const incoming = ms.filter((m) => m.folder !== "sent" && m.folder !== "drafts");
    const latest = ms[ms.length - 1];
    const latestIncoming = incoming[incoming.length - 1] ?? latest;
    const withCode = [...incoming].reverse().find((m) => m.extracted.code);
    return {
      id: t.id,
      subject: t.subject,
      snippet: latest?.snippet ?? "",
      lastMessageAt: t.lastMessageAt.toISOString(),
      category: t.category,
      isRead: t.isRead,
      folder: t.folder,
      from: latestIncoming?.from ?? { address: "" },
      participants: uniqueAddresses(ms.map((m) => m.from)),
      accountIds: accountsByThread.get(t.id) ?? [],
      labels: labelsByThread.get(t.id) ?? [],
      messageCount: ms.length,
      hasAttachments: ms.some((m) => m.hasAttachments),
      code: withCode ? { value: withCode.extracted.code!, messageId: withCode.id, sentAt: withCode.sentAt.toISOString() } : null,
      eventCount: ms.reduce((n, m) => n + (m.extracted.events?.length ?? 0), 0),
    };
  });
}

export async function getThreadRow(db: Db, userId: string, threadId: string): Promise<ThreadRow> {
  const [row] = await db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.userId, userId)));
  if (!row) throw notFound("Thread not found");
  return row;
}

export async function getThreadSummary(db: Db, userId: string, threadId: string): Promise<ThreadSummary> {
  const row = await getThreadRow(db, userId, threadId);
  return (await summarize(db, [row]))[0]!;
}

export async function getThreadDetail(s: Services, userId: string, threadId: string): Promise<ThreadDetail> {
  const row = await getThreadRow(s.db, userId, threadId);
  const [summary] = await summarize(s.db, [row]);
  const msgs = await s.db.select().from(messages).where(eq(messages.threadId, threadId)).orderBy(messages.sentAt);
  const ids = msgs.map((m) => m.id);
  const [accts, lbls, placed] = ids.length
    ? await Promise.all([
        s.db.select().from(messageAccounts).where(inArray(messageAccounts.messageId, ids)),
        s.db.select().from(messageLabels).where(inArray(messageLabels.messageId, ids)),
        s.db
          .select({ p: calendarPlacements, calendars: calendarConnections.calendars })
          .from(calendarPlacements)
          .innerJoin(calendarConnections, eq(calendarConnections.id, calendarPlacements.connectionId))
          .where(inArray(calendarPlacements.messageId, ids)),
      ])
    : [[], [], []];
  const placementsFor = (messageId: string, index: number): EventPlacement[] =>
    placed
      .filter((r) => r.p.messageId === messageId && r.p.eventIndex === index)
      .map((r) => ({
        connectionId: r.p.connectionId,
        calendarId: r.p.calendarId,
        calendarName: r.calendars.find((c) => c.id === r.p.calendarId)?.name ?? null,
        url: r.p.url,
        addedAt: r.p.createdAt.toISOString(),
      }));
  const details: MessageDetail[] = await Promise.all(
    msgs.map(async (m) => {
      const body = m.bodyRef ? await s.blobs.getJson<StoredBody>(m.bodyRef).catch(() => null) : null;
      return {
        id: m.id,
        threadId: m.threadId,
        accountIds: accts.filter((a) => a.messageId === m.id).map((a) => a.accountId),
        rfcMessageId: m.rfcMessageId,
        from: m.from,
        to: m.to,
        cc: m.cc,
        bcc: m.bcc,
        replyTo: m.replyTo,
        subject: m.subject,
        snippet: m.snippet,
        bodyText: body?.text ?? null,
        bodyHtml: body?.html ?? null,
        attachments: m.attachments,
        sentAt: m.sentAt.toISOString(),
        folder: m.folder,
        isRead: m.isRead,
        labels: lbls.filter((l) => l.messageId === m.id).map((l) => ({ labelId: l.labelId, source: l.source, confidence: l.confidence })),
        code: m.extracted.code ?? null,
        events: (m.extracted.events ?? []).map((e, index) => ({ ...e, index, added: placementsFor(m.id, index) })),
      };
    }),
  );
  return { ...summary!, messages: details };
}

/** The folder a thread is filed under, from the folders of its messages. */
export function primaryFolder(folders: VirtualFolder[]): VirtualFolder {
  const set = new Set(folders);
  if (set.has("inbox")) return "inbox";
  if (folders.length > 0 && folders.every((f) => f === "trash")) return "trash";
  if (set.has("spam")) return "spam";
  if (set.has("archive")) return "archive";
  if (set.has("drafts")) return "drafts";
  if (set.has("sent")) return "sent";
  return folders.includes("trash") ? "trash" : "archive";
}

/** Recompute denormalized thread fields from its messages. Deletes empty threads. */
export async function refreshThread(db: Db, threadId: string): Promise<ThreadRow | null> {
  const ms = await db
    .select({ sentAt: messages.sentAt, folder: messages.folder, isRead: messages.isRead, subject: messages.subject })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.sentAt);
  if (ms.length === 0) {
    await db.delete(threads).where(eq(threads.id, threadId));
    return null;
  }
  const visible = ms.filter((m) => m.folder !== "trash" && m.folder !== "spam");
  const relevant = visible.length ? visible : ms;
  const [row] = await db
    .update(threads)
    .set({
      lastMessageAt: relevant[relevant.length - 1]!.sentAt,
      isRead: relevant.every((m) => m.isRead || m.folder === "sent" || m.folder === "drafts"),
      folder: primaryFolder(ms.map((m) => m.folder)),
      subject: ms[0]!.subject || ms[ms.length - 1]!.subject,
    })
    .where(eq(threads.id, threadId))
    .returning();
  return row ?? null;
}

export async function setThreadCategory(db: Db, threadId: string, category: Category, source: string, confidence: number | null) {
  await db.update(threads).set({ category, categorySource: source, categoryConfidence: confidence, aiPending: false }).where(eq(threads.id, threadId));
}

export async function folderCounts(db: Db, userId: string): Promise<Record<string, number>> {
  const rows = await db.execute<{ folder: string; unread: number; total: number }>(sql`
    select m.folder as folder,
           count(distinct m.thread_id) filter (where not m.is_read)::int as unread,
           count(distinct m.thread_id)::int as total
    from ${messages} m
    where m.user_id = ${userId}
    group by m.folder
  `);
  const out: Record<string, number> = {};
  for (const r of rows.rows) {
    // Inbox shows unread; drafts show how many exist; the rest show nothing noisy.
    if (r.folder === "inbox") out.inbox = Number(r.unread);
    if (r.folder === "drafts") out.drafts = Number(r.total);
    if (r.folder === "spam") out.spam = Number(r.unread);
  }
  return out;
}
