import { randomBytes } from "node:crypto";
import type { Account, AccountStatus, Color, MailProvider, ProviderKind } from "@ostra/core";
import { accounts, and, eq, identities, messageAccounts, messages, ne, users, type AccountRow } from "@ostra/db";
import { HttpError, notFound } from "../lib/errors.ts";
import type { Services } from "./context.ts";
import { stopPush } from "./sync.ts";
import { refreshThread } from "./threads.ts";

export function toAccountDto(row: AccountRow): Account {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.displayName,
    color: row.color,
    status: row.status as AccountStatus,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    aiEnabled: row.aiEnabled,
    error: row.statusMessage,
  };
}

export async function createAccount(
  s: Services,
  userId: string,
  input: {
    provider: ProviderKind;
    displayName: string;
    color: Color;
    credentials: unknown;
    identities: { address: string; displayName: string | null }[];
    externalId?: string | null;
  },
): Promise<AccountRow> {
  return s.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        userId,
        provider: input.provider,
        displayName: input.displayName,
        color: input.color,
        encryptedCredentials: s.envelope.encryptJson(input.credentials),
        webhookToken: randomBytes(24).toString("base64url"),
        externalId: input.externalId ?? null,
        status: "syncing",
      })
      .returning();
    const seen = new Set<string>();
    const ids = input.identities.filter((i) => {
      const k = i.address.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (ids.length) {
      await tx.insert(identities).values(ids.map((i, n) => ({ accountId: row!.id, address: i.address, displayName: i.displayName, isDefault: n === 0 })));
    }
    return row!;
  });
}

export async function getAccount(s: Services, userId: string, accountId: string): Promise<AccountRow> {
  const [row] = await s.db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  if (!row) throw notFound("Account not found");
  return row;
}

export async function setAccountStatus(s: Services, account: AccountRow, status: AccountStatus, message: string | null = null, extra: Partial<AccountRow> = {}) {
  const [row] = await s.db
    .update(accounts)
    .set({ status, statusMessage: message, ...extra })
    .where(eq(accounts.id, account.id))
    .returning();
  if (row) s.hub.publish(row.userId, { type: "account.update", account: toAccountDto(row) });
  return row ?? account;
}

/** Build the provider for an account, wiring token refresh back into encrypted storage. */
export function providerFor(s: Services, account: AccountRow): MailProvider {
  const factory = s.providers[account.provider];
  if (!factory) throw new HttpError(503, `${account.provider} is not configured on this server`, "provider_unavailable");
  const credentials = s.envelope.decryptJson<never>(account.encryptedCredentials);
  return factory({
    account,
    credentials,
    config: s.config,
    saveCredentials: async (next) => {
      await s.db.update(accounts).set({ encryptedCredentials: s.envelope.encryptJson(next) }).where(eq(accounts.id, account.id));
    },
  });
}

/**
 * Disconnect an account and delete its stored mail. Messages that also
 * landed in another of the user's accounts are kept and re-homed.
 */
export async function disconnectAccount(s: Services, account: AccountRow): Promise<void> {
  const { db } = s;
  // Best effort: stop provider-side push (Gmail watch, Graph subscription).
  try {
    const provider = providerFor(s, account);
    const sub = await provider.subscribe(() => {}).catch(() => null);
    await sub?.close();
    await provider.close?.();
  } catch {
    // provider not configured or credentials gone; nothing to stop
  }

  const owned = await db.select({ id: messages.id, threadId: messages.threadId, bodyRef: messages.bodyRef }).from(messages).where(eq(messages.accountId, account.id));
  const touched = new Set<string>();
  for (const m of owned) {
    touched.add(m.threadId);
    const [other] = await db
      .select({ accountId: messageAccounts.accountId })
      .from(messageAccounts)
      .where(and(eq(messageAccounts.messageId, m.id), ne(messageAccounts.accountId, account.id)))
      .limit(1);
    if (other) {
      await db.update(messages).set({ accountId: other.accountId }).where(eq(messages.id, m.id));
    } else {
      if (m.bodyRef) await s.blobs.delete(m.bodyRef).catch(() => {});
      await db.delete(messages).where(eq(messages.id, m.id));
    }
  }
  await db.delete(accounts).where(eq(accounts.id, account.id));
  for (const t of touched) {
    const row = await refreshThread(db, t);
    if (!row) s.hub.publish(account.userId, { type: "thread.remove", threadId: t });
  }
}

/** Clerk `user.deleted`: disconnect every account and delete all stored mail. */
export async function purgeUser(s: Services, userId: string): Promise<void> {
  const rows = await s.db.select().from(accounts).where(eq(accounts.userId, userId));
  for (const a of rows) {
    await stopPush(a.id);
    await disconnectAccount(s, a).catch((err) => s.log.warn("disconnect during purge failed", { accountId: a.id }, err));
  }
  await s.blobs.deletePrefix(`u/${userId}/`);
  await s.db.delete(users).where(eq(users.id, userId));
  s.hub.disconnectUser(userId);
}
