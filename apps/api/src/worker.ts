import { accounts, eq, inArray, threads, and } from "@ostra/db";
import type { Handlers } from "./lib/queue.ts";
import { providerFor, purgeUser } from "./services/accounts.ts";
import type { Services } from "./services/context.ts";
import { scanEvents } from "./services/extract.ts";
import { runSync, startPush } from "./services/sync.ts";

export function jobHandlers(s: Services): Handlers {
  return {
    sync: async ({ accountId, mode }) => {
      await runSync(s, accountId, mode);
    },
    ai: async ({ userId, messageIds }) => {
      await s.ai.processMessages(userId, messageIds);
      // After categorizing, so newsletters and promotions are skipped. Its own job, so a failure retries only the scan.
      await s.queue.add("events", { userId, messageIds });
    },
    events: async ({ userId, messageIds }) => {
      await scanEvents(s, userId, messageIds);
    },
    action: async ({ accountId, providerMessageId, action }) => {
      const [acct] = await s.db.select().from(accounts).where(eq(accounts.id, accountId));
      if (!acct) return;
      const p = providerFor(s, acct);
      try {
        await p.applyAction(providerMessageId, action);
      } finally {
        await p.close?.();
      }
    },
    purgeUser: async ({ userId }) => {
      await purgeUser(s, userId);
    },
  };
}

/**
 * Background loops: keep push alive for every account, renew expiring
 * webhook subscriptions, and retry AI that failed earlier.
 */
export function startBackground(s: Services): () => void {
  const tick = async () => {
    const rows = await s.db.select().from(accounts).where(inArray(accounts.status, ["active", "syncing"]));
    for (const a of rows) {
      const expires = a.push?.expiresAt ? Date.parse(a.push.expiresAt) : null;
      if (!a.push || (expires !== null && expires - Date.now() < 24 * 3600_000)) await startPush(s, a.id);
      // Safety net for missed push notifications.
      await s.queue.add("sync", { accountId: a.id, mode: a.syncCursor ? "incremental" : "initial" }, { jobId: `${a.id}:poll` });
    }
    if (s.ai.available) {
      const pending = await s.db.select({ id: threads.id, userId: threads.userId }).from(threads).where(and(eq(threads.aiPending, true))).limit(200);
      const byUser = new Map<string, string[]>();
      for (const t of pending) byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t.id]);
      for (const [userId, threadIds] of byUser) await s.ai.retryThreads?.(userId, threadIds);
    }
  };
  const run = () => tick().catch((err) => s.log.warn("background tick failed", {}, err));
  const first = setTimeout(run, 2000);
  const interval = setInterval(run, 5 * 60_000);
  first.unref?.();
  interval.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}
