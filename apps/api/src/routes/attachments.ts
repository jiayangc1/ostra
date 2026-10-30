import type { Context } from "hono";
import { and, eq, messages } from "@ostra/db";
import { HttpError, notFound } from "../lib/errors.ts";
import { loadAttachment } from "../services/attachments.ts";
import type { Services } from "../services/context.ts";
import type { AppEnv } from "./api.ts";

/** Download an attachment: from the encrypted cache, else fetched from the provider and cached. */
export function attachmentRoute(s: Services) {
  return async (c: Context<AppEnv>) => {
    const user = c.get("user");
    const index = Number(c.req.param("index"));
    const [m] = await s.db.select().from(messages).where(and(eq(messages.id, c.req.param("id")!), eq(messages.userId, user.id)));
    const meta = m?.attachments[index];
    if (!m || !meta) throw notFound("Attachment not found");

    const bytes = await loadAttachment(s, m, index);
    if (!bytes) throw new HttpError(502, "Couldn't download this attachment from the mail server.", "attachment_unavailable");
    const safeName = meta.filename.replace(/[\r\n"\\]/g, "_");
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    });
  };
}
