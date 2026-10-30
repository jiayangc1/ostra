import { autoLabel, categorize, type Correction, type LLMProvider } from "@ostra/ai";
import { normalizeAddress } from "@ostra/core";
import {
  accounts,
  and,
  contactsLastIdentity,
  corrections,
  desc,
  eq,
  inArray,
  labels,
  messageLabels,
  messages,
  senderRules,
  sql,
  threads,
  users,
} from "@ostra/db";
import type { Services } from "./context.ts";
import { bodyKey, summarize, type StoredBody } from "./threads.ts";
import { settingsOf } from "./users.ts";

/**
 * Glue between the API and @ostra/ai: categorize + auto-label on ingest,
 * learning from corrections, and the model used for writing features.
 */
export interface AiService {
  /** A model is configured (writing features and LLM categorization). */
  readonly available: boolean;
  readonly llm: LLMProvider | null;
  /** Categorize + auto-label freshly ingested messages. Never throws for model failures. */
  processMessages(userId: string, messageIds: string[]): Promise<void>;
  /** Re-run categorization for threads whose earlier attempt failed. */
  retryThreads?(userId: string, threadIds: string[]): Promise<void>;
}

export const noopAi: AiService = {
  available: false,
  llm: null,
  async processMessages() {},
};

async function recentCorrections(s: Services, userId: string): Promise<Correction[]> {
  const rows = await s.db.select().from(corrections).where(eq(corrections.userId, userId)).orderBy(desc(corrections.createdAt)).limit(60);
  return rows.map((r) => ({ kind: r.kind, fromValue: r.fromValue, toValue: r.toValue, sender: r.sender, subject: r.subject, snippet: r.snippet, createdAt: r.createdAt.toISOString() }));
}

export function createAiService(s: Services, llm: LLMProvider | null): AiService {
  const processMessages = async (userId: string, messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const [user] = await s.db.select().from(users).where(eq(users.id, userId));
    if (!user) return;
    const settings = settingsOf(user);
    const msgs = await s.db.select().from(messages).where(and(eq(messages.userId, userId), inArray(messages.id, messageIds)));
    const acctRows = await s.db.select().from(accounts).where(eq(accounts.userId, userId));
    const aiAccounts = new Set(acctRows.filter((a) => a.aiEnabled).map((a) => a.id));
    const userLabels = await s.db.select().from(labels).where(and(eq(labels.userId, userId), eq(labels.aiEnabled, true)));
    const history = llm ? await recentCorrections(s, userId) : [];
    const touched = new Set<string>();

    for (const m of msgs) {
      const [thread] = await s.db.select().from(threads).where(eq(threads.id, m.threadId));
      if (!thread) continue;
      // Content only reaches a model when the user, and this account, allow AI.
      const mayUseModel = !!llm && settings.aiEnabled && aiAccounts.has(m.accountId);
      const sender = normalizeAddress(m.from.address);
      const [rule] = await s.db.select().from(senderRules).where(and(eq(senderRules.userId, userId), eq(senderRules.sender, sender)));
      const [participated] = await s.db.execute<{ n: number }>(sql`select count(*)::int as n from ${messages} where thread_id = ${m.threadId} and folder = 'sent'`).then((r) => r.rows);
      const [known] = await s.db.select({ c: contactsLastIdentity.contactAddress }).from(contactsLastIdentity).where(and(eq(contactsLastIdentity.userId, userId), eq(contactsLastIdentity.contactAddress, sender)));
      const signals = { from: m.from, subject: m.subject, snippet: m.snippet, headers: m.headers, userParticipated: Number(participated?.n ?? 0) > 0, knownContact: !!known };

      // Category (a user's choice for the thread always sticks).
      if (thread.categorySource !== "user") {
        try {
          const r = await categorize(mayUseModel ? llm : null, signals, { senderRule: rule?.category ?? null, corrections: history });
          await s.db.update(threads).set({ category: r.category, categoryConfidence: r.confidence, categorySource: r.source, aiPending: false }).where(eq(threads.id, thread.id));
        } catch (err) {
          // AI never blocks mail: stay primary, retry later.
          s.log.warn("categorization failed; will retry", { threadId: thread.id }, err);
          await s.db.update(threads).set({ category: "primary", categorySource: "default", aiPending: true }).where(eq(threads.id, thread.id));
        }
      } else {
        await s.db.update(threads).set({ aiPending: false }).where(eq(threads.id, thread.id));
      }

      // Labels, applied directly on arrival.
      if (mayUseModel && settings.autoLabel && userLabels.length) {
        try {
          const body = m.bodyRef ? await s.blobs.getJson<StoredBody>(m.bodyRef) : null;
          const applied = await autoLabel(llm!, { ...signals, body: body?.text ?? null }, userLabels.map((l) => ({ id: l.id, name: l.name, description: l.description })), history);
          if (applied.length) {
            await s.db
              .insert(messageLabels)
              .values(applied.map((a) => ({ messageId: m.id, labelId: a.labelId, source: "ai" as const, confidence: a.confidence })))
              .onConflictDoNothing();
          }
        } catch (err) {
          s.log.warn("auto-label failed", { messageId: m.id }, err);
        }
      }
      touched.add(thread.id);
    }

    if (touched.size) {
      const rows = await s.db.select().from(threads).where(inArray(threads.id, [...touched]));
      for (const t of await summarize(s.db, rows)) s.hub.publish(userId, { type: "thread.upsert", thread: t });
    }
  };

  return {
    available: !!llm,
    llm,
    processMessages,
    async retryThreads(userId, threadIds) {
      if (threadIds.length === 0) return;
      const rows = await s.db
        .select({ id: messages.id, threadId: messages.threadId })
        .from(messages)
        .where(and(eq(messages.userId, userId), inArray(messages.threadId, threadIds), sql`${messages.folder} not in ('sent', 'drafts')`))
        .orderBy(desc(messages.sentAt));
      const latest = new Map<string, string>();
      for (const r of rows) if (!latest.has(r.threadId)) latest.set(r.threadId, r.id);
      await processMessages(userId, [...latest.values()]);
    },
  };
}

export { bodyKey };
