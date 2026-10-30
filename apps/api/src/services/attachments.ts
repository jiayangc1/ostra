import { accounts, eq, messageAccounts, type MessageRow } from "@ostra/db";
import { providerFor } from "./accounts.ts";
import type { Services } from "./context.ts";

const attachmentKey = (userId: string, messageId: string, index: number) => `u/${userId}/a/${messageId}/${index}`;

/** An attachment's bytes: from the encrypted cache, else fetched from any account holding the message, then cached. */
export async function loadAttachment(s: Services, m: Pick<MessageRow, "id" | "userId" | "attachments">, index: number): Promise<Buffer | null> {
  const meta = m.attachments[index];
  if (!meta) return null;
  const key = attachmentKey(m.userId, m.id, index);
  let bytes = await s.blobs.get(key);
  if (bytes) return bytes;
  const links = await s.db.select().from(messageAccounts).where(eq(messageAccounts.messageId, m.id));
  for (const link of links) {
    const [acct] = await s.db.select().from(accounts).where(eq(accounts.id, link.accountId));
    if (!acct) continue;
    const provider = providerFor(s, acct);
    try {
      if (!provider.fetchAttachment) continue;
      bytes = Buffer.from(await provider.fetchAttachment(link.providerMessageId, meta.providerAttachmentId ?? String(index)));
      break;
    } catch (err) {
      s.log.warn("attachment fetch failed", { accountId: acct.id }, err);
    } finally {
      await provider.close?.().catch(() => {});
    }
  }
  if (bytes) await s.blobs.put(key, bytes);
  return bytes ?? null;
}
