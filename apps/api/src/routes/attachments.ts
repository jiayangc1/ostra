import type { Context } from "hono";
import { and, eq, messageAccounts, messages, accounts } from "@ostra/db";
import { HttpError, notFound } from "../lib/errors.ts";
import { providerFor } from "../services/accounts.ts";
import type { Services } from "../services/context.ts";
import type { AppEnv } from "./api.ts";

const attachmentKey = (userId: string, messageId: string, index: number) => `u/${userId}/a/${messageId}/${index}`;

/** Download an attachment: from the encrypted cache, else fetched from the provider and cached. */
export function attachmentRoute(s: Services) {
  return async (c: Context<AppEnv>) => {
    const user = c.get("user");
    const index = Number(c.req.param("index"));
    const [m] = await s.db.select().from(messages).where(and(eq(messages.id, c.req.param("id")!), eq(messages.userId, user.id)));
    const meta = m?.attachments[index];
    if (!m || !meta) throw notFound("Attachment not found");

    const key = attachmentKey(user.id, m.id, index);
    let bytes = await s.blobs.get(key);
    if (!bytes) {
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
      if (!bytes) throw new HttpError(502, "Couldn't download this attachment from the mail server.", "attachment_unavailable");
      await s.blobs.put(key, bytes);
    }
    const safeName = meta.filename.replace(/[\r\n"\\]/g, "_");
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    });
  };
}
