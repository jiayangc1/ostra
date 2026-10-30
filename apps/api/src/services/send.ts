import { normalizeAddress, type Address, type OutgoingAttachment, type OutgoingMessage, type ThreadSummary } from "@ostra/core";
import { sentToNormalized } from "@ostra/core/compose";
import { accounts, and, contactsLastIdentity, eq, identities, messageAccounts, messages, sql } from "@ostra/db";
import { HttpError, notFound } from "../lib/errors.ts";
import { providerFor, setAccountStatus } from "./accounts.ts";
import type { Services } from "./context.ts";
import { ingestBatch } from "./ingest.ts";
import { getThreadSummary } from "./threads.ts";
import { AuthExpiredError } from "@ostra/core";

export interface SendInput {
  identityId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | undefined;
  /** Message being replied to or forwarded; threads the reply. */
  replyToMessageId?: string | null | undefined;
  attachments?: OutgoingAttachment[] | undefined;
}

/** Resolve an identity id to its identity + account, checking ownership. */
export async function identityFor(s: Services, userId: string, identityId: string) {
  const [row] = await s.db
    .select({ identity: identities, account: accounts })
    .from(identities)
    .innerJoin(accounts, eq(accounts.id, identities.accountId))
    .where(and(eq(identities.id, identityId), eq(accounts.userId, userId)));
  if (!row) throw notFound("Identity not found");
  return row;
}

/**
 * The send router: identity → its account → that account's provider.
 * The pre-send check runs in the client before this (it never blocks).
 */
export async function sendMessage(s: Services, userId: string, input: SendInput): Promise<{ thread: ThreadSummary | null; messageId: string | null }> {
  const { identity, account } = await identityFor(s, userId, input.identityId);
  if (account.status === "needs_reauth") throw new HttpError(409, `Reconnect ${account.displayName} to send from it.`, "needs_reauth");
  if (input.to.length + input.cc.length + input.bcc.length === 0) throw new HttpError(422, "Add at least one recipient.", "no_recipients");

  let threading: Pick<OutgoingMessage, "inReplyTo" | "references" | "providerThreadId"> = {};
  if (input.replyToMessageId) {
    const [orig] = await s.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, input.replyToMessageId), eq(messages.userId, userId)));
    if (!orig) throw notFound("Original message not found");
    const [link] = await s.db
      .select({ accountId: messageAccounts.accountId })
      .from(messageAccounts)
      .where(and(eq(messageAccounts.messageId, orig.id), eq(messageAccounts.accountId, account.id)));
    threading = {
      inReplyTo: orig.rfcMessageId,
      references: [...orig.references, ...(orig.rfcMessageId ? [orig.rfcMessageId] : [])].slice(-20),
      // Provider threads only make sense inside the same account.
      providerThreadId: link ? (orig.providerThreadId ?? undefined) : undefined,
    };
  }

  const outgoing: OutgoingMessage = {
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
    attachments: input.attachments,
    ...threading,
  };
  const identityRef = { address: identity.address, displayName: identity.displayName };
  const provider = providerFor(s, account);
  let result;
  try {
    result = await provider.send(outgoing, identityRef);
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      await setAccountStatus(s, account, "needs_reauth", "Sign in again to keep this account in sync.");
      throw new HttpError(409, `Reconnect ${account.displayName} to send from it.`, "needs_reauth");
    }
    s.log.warn("send failed", { accountId: account.id }, err);
    throw new HttpError(502, "The mail server didn't accept the message. It wasn't sent.", "send_failed");
  } finally {
    await provider.close?.().catch(() => {});
  }

  // Show it in the thread right away; the provider sync will dedupe on Message-ID.
  const sent = sentToNormalized(outgoing, identityRef, { ...result, date: new Date(), providerThreadId: threading.providerThreadId });
  const ingest = await ingestBatch(s, account, { messages: [sent], updates: [], deleted: [] });

  // Remember who we wrote to from which identity (smart "from" rule 2).
  for (const r of [...input.to, ...input.cc, ...input.bcc]) {
    await s.db
      .insert(contactsLastIdentity)
      .values({ userId, contactAddress: normalizeAddress(r.address), identityId: identity.id })
      .onConflictDoUpdate({
        target: [contactsLastIdentity.userId, contactsLastIdentity.contactAddress],
        set: { identityId: identity.id, updatedAt: new Date(), useCount: sql`${contactsLastIdentity.useCount} + 1` },
      });
  }

  const threadId = [...ingest.touchedThreads][0];
  const [row] = await s.db.select({ id: messages.id }).from(messages).where(and(eq(messages.userId, userId), eq(messages.dedupeKey, `mid:${result.rfcMessageId.toLowerCase()}`)));
  return { thread: threadId ? await getThreadSummary(s.db, userId, threadId) : null, messageId: row?.id ?? null };
}
