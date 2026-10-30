import { normalizeAddress, type Category, type ProviderAction, type VirtualFolder } from "@ostra/core";
import {
  accounts,
  and,
  corrections,
  eq,
  identities,
  inArray,
  labels,
  messageAccounts,
  messageLabels,
  messages,
  ne,
  senderRules,
  sql,
  threads,
} from "@ostra/db";
import { HttpError, notFound } from "../lib/errors.ts";
import { providerFor } from "./accounts.ts";
import type { Services } from "./context.ts";
import { getThreadRow, getThreadSummary, refreshThread, setThreadCategory, summarize } from "./threads.ts";

export const THREAD_ACTIONS = ["archive", "trash", "spam", "inbox", "markRead", "markUnread"] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

async function ownAddresses(s: Services, userId: string): Promise<Set<string>> {
  const rows = await s.db
    .select({ address: identities.address })
    .from(identities)
    .innerJoin(accounts, eq(accounts.id, identities.accountId))
    .where(eq(accounts.userId, userId));
  return new Set(rows.map((r) => normalizeAddress(r.address)));
}

/** Where a message ends up after `action`, or undefined when it doesn't move. */
function nextFolder(action: ThreadAction, current: VirtualFolder, isOwn: boolean): VirtualFolder | undefined {
  switch (action) {
    case "archive":
      return current === "inbox" ? "archive" : undefined;
    case "trash":
      return current === "trash" ? undefined : "trash";
    case "spam":
      return isOwn || current === "spam" ? undefined : "spam";
    case "inbox":
      if (current === "inbox" || current === "drafts") return undefined;
      return isOwn ? (current === "sent" ? undefined : "sent") : "inbox";
    default:
      return undefined;
  }
}

function toProviderAction(action: ThreadAction, folder: VirtualFolder | undefined): ProviderAction | null {
  if (action === "markRead" || action === "markUnread") return { type: action };
  if (!folder) return null;
  if (action === "inbox") return { type: "move", folder };
  return { type: action };
}

/**
 * Archive / trash / spam / read state for a whole thread, across every
 * account its messages landed in. The DB changes first (clients already
 * updated optimistically); if any provider call fails we roll back and
 * return 502 so the client can roll back with a toast.
 */
export async function applyThreadAction(s: Services, userId: string, threadId: string, action: ThreadAction) {
  await getThreadRow(s.db, userId, threadId);
  const own = await ownAddresses(s, userId);
  const msgs = await s.db
    .select({ id: messages.id, folder: messages.folder, isRead: messages.isRead, from: messages.from })
    .from(messages)
    .where(eq(messages.threadId, threadId));
  const links = msgs.length ? await s.db.select().from(messageAccounts).where(inArray(messageAccounts.messageId, msgs.map((m) => m.id))) : [];

  const plan: { messageId: string; prev: { folder: VirtualFolder; isRead: boolean }; next: { folder?: VirtualFolder; isRead?: boolean } }[] = [];
  for (const m of msgs) {
    const isOwn = own.has(normalizeAddress(m.from.address));
    if (action === "markRead" || action === "markUnread") {
      const isRead = action === "markRead";
      if (m.isRead !== isRead && !isOwn) plan.push({ messageId: m.id, prev: m, next: { isRead } });
      continue;
    }
    const folder = nextFolder(action, m.folder, isOwn);
    if (folder) plan.push({ messageId: m.id, prev: m, next: { folder } });
  }

  const apply = async (rev: boolean) => {
    for (const p of plan) {
      const values = rev ? { folder: p.prev.folder, isRead: p.prev.isRead } : p.next;
      await s.db.update(messages).set(values).where(eq(messages.id, p.messageId));
      if (values.folder) await s.db.update(messageAccounts).set({ folder: values.folder }).where(eq(messageAccounts.messageId, p.messageId));
    }
  };
  await apply(false);

  // Provider calls, grouped by account so each provider is built once.
  const byAccount = new Map<string, { providerMessageId: string; action: ProviderAction }[]>();
  for (const p of plan) {
    const pa = toProviderAction(action, p.next.folder);
    if (!pa) continue;
    for (const l of links.filter((x) => x.messageId === p.messageId)) {
      const list = byAccount.get(l.accountId) ?? [];
      list.push({ providerMessageId: l.providerMessageId, action: pa });
      byAccount.set(l.accountId, list);
    }
  }
  const acctRows = byAccount.size ? await s.db.select().from(accounts).where(inArray(accounts.id, [...byAccount.keys()])) : [];
  const results = await Promise.allSettled(
    acctRows.map(async (acct) => {
      const provider = providerFor(s, acct);
      try {
        for (const item of byAccount.get(acct.id)!) {
          const r = await provider.applyAction(item.providerMessageId, item.action);
          if (r?.providerMessageId && r.providerMessageId !== item.providerMessageId) {
            await s.db
              .update(messageAccounts)
              .set({ providerMessageId: r.providerMessageId })
              .where(and(eq(messageAccounts.accountId, acct.id), eq(messageAccounts.providerMessageId, item.providerMessageId)));
          }
        }
      } finally {
        await provider.close?.().catch(() => {});
      }
    }),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    s.log.warn("provider action failed, rolling back", { threadId, action }, failed.reason);
    await apply(true);
    await refreshThread(s.db, threadId);
    throw new HttpError(502, "The mail provider didn't accept that change.", "provider_action_failed");
  }

  const row = await refreshThread(s.db, threadId);
  if (row) {
    const [summary] = await summarize(s.db, [row]);
    s.hub.publish(userId, { type: "thread.upsert", thread: summary! });
    return summary!;
  }
  return null;
}

async function latestIncoming(s: Services, threadId: string) {
  const [m] = await s.db
    .select({ id: messages.id, from: messages.from, subject: messages.subject, snippet: messages.snippet })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), ne(messages.folder, "sent"), ne(messages.folder, "drafts")))
    .orderBy(sql`${messages.sentAt} desc`)
    .limit(1);
  return m ?? null;
}

/** Re-categorizations of the same sender to the same category before it becomes a rule. */
export const SENDER_RULE_THRESHOLD = 2;

/** `y`: change a thread's category. Recorded as a correction; twice for one sender becomes a rule. */
export async function changeCategory(s: Services, userId: string, threadId: string, category: Category) {
  const thread = await getThreadRow(s.db, userId, threadId);
  const msg = await latestIncoming(s, threadId);
  await setThreadCategory(s.db, threadId, category, "user", 1);
  if (thread.category !== category) {
    const sender = msg ? normalizeAddress(msg.from.address) : "";
    await s.db.insert(corrections).values({
      userId,
      messageId: msg?.id ?? null,
      kind: "category",
      fromValue: thread.category,
      toValue: category,
      sender,
      subject: msg?.subject ?? thread.subject,
      snippet: msg?.snippet ?? "",
    });
    if (sender) {
      const [{ n } = { n: 0 }] = await s.db
        .select({ n: sql<number>`count(*)::int` })
        .from(corrections)
        .where(and(eq(corrections.userId, userId), eq(corrections.kind, "category"), eq(corrections.sender, sender), eq(corrections.toValue, category)));
      if (Number(n) >= SENDER_RULE_THRESHOLD) {
        await s.db
          .insert(senderRules)
          .values({ userId, sender, category })
          .onConflictDoUpdate({ target: [senderRules.userId, senderRules.sender], set: { category } });
        await applySenderRuleToExisting(s, userId, sender, category);
      }
    }
  }
  const summary = await getThreadSummary(s.db, userId, threadId);
  s.hub.publish(userId, { type: "thread.upsert", thread: summary });
  return summary;
}

/** Once a sender rule exists, move that sender's other (non user-set) threads too. */
async function applySenderRuleToExisting(s: Services, userId: string, sender: string, category: Category) {
  const rows = await s.db
    .selectDistinct({ id: threads.id })
    .from(threads)
    .innerJoin(messages, eq(messages.threadId, threads.id))
    .where(and(eq(threads.userId, userId), ne(threads.categorySource, "user"), ne(threads.category, category), sql`lower(${messages.from}->>'address') = ${sender}`));
  if (!rows.length) return;
  await s.db
    .update(threads)
    .set({ category, categorySource: "sender_rule", categoryConfidence: 1 })
    .where(inArray(threads.id, rows.map((r) => r.id)));
  const updated = await s.db.select().from(threads).where(inArray(threads.id, rows.map((r) => r.id)));
  for (const t of await summarize(s.db, updated)) s.hub.publish(userId, { type: "thread.upsert", thread: t });
}

/** `l`: add or remove a label on a thread. User actions are recorded as training signal. */
export async function setThreadLabel(s: Services, userId: string, threadId: string, labelId: string, applied: boolean) {
  await getThreadRow(s.db, userId, threadId);
  const [label] = await s.db.select().from(labels).where(and(eq(labels.id, labelId), eq(labels.userId, userId)));
  if (!label) throw notFound("Label not found");
  const msgs = await s.db.select({ id: messages.id }).from(messages).where(eq(messages.threadId, threadId));
  const ids = msgs.map((m) => m.id);
  const current = ids.length
    ? await s.db.select().from(messageLabels).where(and(inArray(messageLabels.messageId, ids), eq(messageLabels.labelId, labelId)))
    : [];
  const msg = await latestIncoming(s, threadId);

  if (applied) {
    const target = msg?.id ?? ids[ids.length - 1];
    if (target) {
      await s.db
        .insert(messageLabels)
        .values({ messageId: target, labelId, source: "user", confidence: 1 })
        .onConflictDoUpdate({ target: [messageLabels.messageId, messageLabels.labelId], set: { source: "user", confidence: 1 } });
    }
    // An AI label the user confirms isn't a correction; adding a missing one is.
    if (current.length === 0) await recordLabelCorrection(s, userId, msg, null, label.name);
  } else if (ids.length) {
    await s.db.delete(messageLabels).where(and(inArray(messageLabels.messageId, ids), eq(messageLabels.labelId, labelId)));
    if (current.some((c) => c.source === "ai")) await recordLabelCorrection(s, userId, msg, label.name, null);
  }
  const summary = await getThreadSummary(s.db, userId, threadId);
  s.hub.publish(userId, { type: "thread.upsert", thread: summary });
  return summary;
}

async function recordLabelCorrection(
  s: Services,
  userId: string,
  msg: { id: string; from: { address: string }; subject: string; snippet: string } | null,
  fromValue: string | null,
  toValue: string | null,
) {
  await s.db.insert(corrections).values({
    userId,
    messageId: msg?.id ?? null,
    kind: "label",
    fromValue,
    toValue,
    sender: msg ? normalizeAddress(msg.from.address) : "",
    subject: msg?.subject ?? "",
    snippet: msg?.snippet ?? "",
  });
}

