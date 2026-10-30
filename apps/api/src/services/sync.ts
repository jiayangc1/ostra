import { AuthExpiredError, CursorInvalidError, type Subscription } from "@ostra/core";
import { accounts, eq } from "@ostra/db";
import { providerFor, setAccountStatus } from "./accounts.ts";
import type { Services } from "./context.ts";
import { ingestBatch } from "./ingest.ts";

/** Upper bound on pages per job so one huge mailbox can't starve the queue; the job re-queues itself. */
const MAX_PAGES_PER_RUN = 20;

/**
 * Pull mail for one account. Initial sync pages backwards through recent
 * mail; incremental sync applies provider deltas from the stored cursor.
 */
export async function runSync(s: Services, accountId: string, mode: "initial" | "incremental"): Promise<void> {
  const [account] = await s.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.status === "disconnected" || account.status === "needs_reauth") return;

  const provider = providerFor(s, account);
  let cursor = account.syncCursor;
  let added = 0;
  try {
    if (account.status !== "syncing" && mode === "initial") await setAccountStatus(s, account, "syncing");
    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const batch = mode === "initial" || !cursor ? await provider.initialSync(cursor) : await provider.incrementalSync(cursor);
      const r = await ingestBatch(s, account, batch);
      added += r.added;
      cursor = batch.cursor;
      await s.db.update(accounts).set({ syncCursor: cursor }).where(eq(accounts.id, account.id));
      if (!batch.hasMore) {
        await setAccountStatus(s, account, "active", null, { lastSyncedAt: new Date(), syncCursor: cursor });
        s.hub.publish(account.userId, { type: "sync.done", accountId: account.id, added });
        return;
      }
    }
    await s.queue.add("sync", { accountId, mode }, { jobId: `${accountId}:${mode}:more` });
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      s.log.warn("account needs reauth", { accountId });
      await setAccountStatus(s, account, "needs_reauth", "Sign in again to keep this account in sync.");
      return;
    }
    if (err instanceof CursorInvalidError) {
      s.log.warn("sync cursor invalid, resyncing", { accountId });
      await s.db.update(accounts).set({ syncCursor: null }).where(eq(accounts.id, account.id));
      await s.queue.add("sync", { accountId, mode: "initial" }, { jobId: `${accountId}:initial` });
      return;
    }
    throw err;
  } finally {
    await provider.close?.().catch(() => {});
  }
}

/** Live push subscriptions held by this process (IMAP IDLE). */
const live = new Map<string, Subscription>();

/** Start push for an account; changes trigger an incremental sync. */
export async function startPush(s: Services, accountId: string): Promise<void> {
  if (live.has(accountId)) return;
  const [account] = await s.db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.status === "disconnected" || account.status === "needs_reauth") return;
  const provider = providerFor(s, account);
  try {
    const sub = await provider.subscribe(() => {
      void s.queue.add("sync", { accountId, mode: "incremental" }, { jobId: `${accountId}:incremental` });
    });
    live.set(accountId, sub);
    await s.db.update(accounts).set({ push: { expiresAt: sub.expiresAt, resourceId: sub.resourceId } }).where(eq(accounts.id, accountId));
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      await setAccountStatus(s, account, "needs_reauth", "Sign in again to keep this account in sync.");
      return;
    }
    s.log.warn("push subscribe failed", { accountId }, err);
  }
}

export async function stopPush(accountId: string): Promise<void> {
  const sub = live.get(accountId);
  live.delete(accountId);
  await sub?.close().catch(() => {});
}

export async function stopAllPush(): Promise<void> {
  await Promise.all([...live.keys()].map(stopPush));
}
