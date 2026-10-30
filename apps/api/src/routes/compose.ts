import { REWRITE_MODES, draftReply, preSendCheck, rewrite, type ThreadForWriting } from "@ostra/ai";
import { chooseFromIdentity, htmlToText, normalizeAddress, type Identity, type SmartFromInput } from "@ostra/core";
import { accounts, and, contactsLastIdentity, eq, identities, inArray, messageAccounts, messages, users } from "@ostra/db";
import { Hono, type Context } from "hono";
import { streamText } from "hono/streaming";
import { z } from "zod";
import { HttpError, badRequest, notFound } from "../lib/errors.ts";
import type { Services } from "../services/context.ts";
import { getThreadDetail } from "../services/threads.ts";
import { settingsOf } from "../services/users.ts";
import type { AppEnv } from "./api.ts";

const uuid = z.string().uuid();
const addr = z.object({ name: z.string().optional(), address: z.string().trim().email() });

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const r = schema.safeParse(await c.req.json().catch(() => null));
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid_body");
  return r.data;
}

/** Everything smart "from" needs, for one user and an optional message being answered. */
async function smartFromContext(s: Services, userId: string, replyToMessageId: string | null | undefined, recipients: string[]): Promise<Omit<SmartFromInput, "recipients">> {
  const [user] = await s.db.select().from(users).where(eq(users.id, userId));
  const ids = await s.db
    .select({ id: identities.id, accountId: identities.accountId, address: identities.address, displayName: identities.displayName, isDefault: identities.isDefault })
    .from(identities)
    .innerJoin(accounts, eq(accounts.id, identities.accountId))
    .where(eq(accounts.userId, userId));
  let original: SmartFromInput["original"];
  if (replyToMessageId) {
    const [m] = await s.db.select().from(messages).where(and(eq(messages.id, replyToMessageId), eq(messages.userId, userId)));
    if (!m) throw notFound("Message not found");
    const links = await s.db.select({ accountId: messageAccounts.accountId }).from(messageAccounts).where(eq(messageAccounts.messageId, m.id));
    original = { to: m.to, cc: m.cc, deliveredTo: m.headers["delivered-to"] ?? m.headers["x-original-to"] ?? null, accountIds: links.map((l) => l.accountId) };
  }
  const normalized = recipients.map(normalizeAddress);
  const last = normalized.length
    ? await s.db
        .select()
        .from(contactsLastIdentity)
        .where(and(eq(contactsLastIdentity.userId, userId), inArray(contactsLastIdentity.contactAddress, normalized)))
    : [];
  return {
    identities: ids as Identity[],
    original,
    lastIdentityByContact: new Map(last.map((r) => [r.contactAddress, r.identityId])),
    defaultIdentityId: user ? settingsOf(user).defaultIdentityId : null,
  };
}

/** The model may see this thread only if AI is on for the user and every account it landed in. */
async function assertAiAllowed(s: Services, userId: string, accountIds: string[]) {
  if (!s.ai.llm) throw new HttpError(503, "AI isn't configured on this server.", "ai_unavailable");
  const [user] = await s.db.select().from(users).where(eq(users.id, userId));
  if (!user || !settingsOf(user).aiEnabled) throw new HttpError(403, "AI features are turned off in Preferences.", "ai_disabled");
  if (accountIds.length) {
    const rows = await s.db.select({ aiEnabled: accounts.aiEnabled }).from(accounts).where(inArray(accounts.id, accountIds));
    if (rows.some((r) => !r.aiEnabled)) throw new HttpError(403, "AI is turned off for this account.", "ai_disabled");
  }
}

function forWriting(detail: Awaited<ReturnType<typeof getThreadDetail>>): ThreadForWriting {
  return {
    subject: detail.subject,
    messages: detail.messages.map((m) => ({ from: m.from, sentAt: m.sentAt, text: m.bodyText ?? (m.bodyHtml ? htmlToText(m.bodyHtml) : m.snippet) })),
  };
}

/** Small LRU of one-line suggestions, keyed by thread + latest message. */
const suggestions = new Map<string, string>();
function remember(key: string, value: string) {
  suggestions.set(key, value);
  if (suggestions.size > 500) suggestions.delete(suggestions.keys().next().value!);
}

export function composeRoutes(s: Services) {
  const r = new Hono<AppEnv>();

  r.post("/compose/from", async (c) => {
    const b = await body(c, z.object({ replyToMessageId: uuid.nullable().optional(), recipients: z.array(z.string()).max(100).default([]) }));
    const ctx = await smartFromContext(s, c.get("user").id, b.replyToMessageId, b.recipients);
    return c.json(chooseFromIdentity({ ...ctx, recipients: b.recipients }));
  });

  r.post("/compose/check", async (c) => {
    const user = c.get("user");
    const b = await body(
      c,
      z.object({
        identityId: uuid,
        replyToMessageId: uuid.nullable().optional(),
        to: z.array(addr).default([]),
        cc: z.array(addr).default([]),
        bcc: z.array(addr).default([]),
        subject: z.string().default(""),
        bodyText: z.string().max(200_000),
        attachmentCount: z.number().int().min(0).default(0),
      }),
    );
    const recipients = [...b.to, ...b.cc, ...b.bcc].map((a) => a.address);
    const ctx = await smartFromContext(s, user.id, b.replyToMessageId, recipients);

    // The tone check reads the draft and thread: only with AI allowed for every account involved.
    let llm = null;
    let thread: { from: string; text: string }[] | undefined;
    const sendingAccount = ctx.identities.find((i) => i.id === b.identityId)?.accountId;
    try {
      await assertAiAllowed(s, user.id, [...(ctx.original?.accountIds ?? []), ...(sendingAccount ? [sendingAccount] : [])]);
      llm = s.ai.llm;
      if (b.replyToMessageId) {
        const [m] = await s.db.select({ threadId: messages.threadId }).from(messages).where(eq(messages.id, b.replyToMessageId));
        if (m) thread = forWriting(await getThreadDetail(s, user.id, m.threadId)).messages.map((x) => ({ from: x.from.address, text: x.text }));
      }
    } catch {
      llm = null;
    }
    const warnings = await preSendCheck(llm, { identityId: b.identityId, smartFrom: ctx, recipients, subject: b.subject, body: b.bodyText, attachmentCount: b.attachmentCount, thread });
    return c.json({ warnings });
  });

  r.post("/ai/draft", async (c) => {
    const user = c.get("user");
    const b = await body(c, z.object({ threadId: uuid, identityId: uuid.optional(), instructions: z.string().max(2000).optional() }));
    const detail = await getThreadDetail(s, user.id, b.threadId);
    await assertAiAllowed(s, user.id, detail.accountIds);
    const last = detail.messages[detail.messages.length - 1];
    const ctx = await smartFromContext(s, user.id, last?.id ?? null, []);
    const chosen = ctx.identities.find((i) => i.id === (b.identityId ?? chooseFromIdentity({ ...ctx, recipients: [] }).identityId));
    if (!chosen) throw badRequest("No identity to write as");
    return streamText(c, async (out) => {
      try {
        for await (const chunk of draftReply(s.ai.llm!, forWriting(detail), chosen, b.instructions, c.req.raw.signal)) await out.write(chunk);
      } catch (err) {
        s.log.warn("draft failed", {}, err);
        await out.write("\n\n[Ostra couldn't finish this draft. Try again.]");
      }
    });
  });

  r.post("/ai/rewrite", async (c) => {
    const user = c.get("user");
    const b = await body(c, z.object({ text: z.string().min(1).max(20_000), mode: z.enum(REWRITE_MODES), identityId: uuid.optional() }));
    let accountIds: string[] = [];
    if (b.identityId) {
      const [i] = await s.db.select({ accountId: identities.accountId }).from(identities).where(eq(identities.id, b.identityId));
      if (i) accountIds = [i.accountId];
    }
    await assertAiAllowed(s, user.id, accountIds);
    return streamText(c, async (out) => {
      try {
        for await (const chunk of rewrite(s.ai.llm!, b.text, b.mode, c.req.raw.signal)) await out.write(chunk);
      } catch (err) {
        s.log.warn("rewrite failed", {}, err);
        throw err;
      }
    });
  });

  /** The one-line draft under the reader. Cached per thread state; null when AI isn't allowed. */
  r.get("/ai/suggestion/:threadId", async (c) => {
    const user = c.get("user");
    const detail = await getThreadDetail(s, user.id, c.req.param("threadId"));
    const last = detail.messages[detail.messages.length - 1];
    if (!last || last.folder === "sent" || detail.category !== "primary") return c.json({ draft: null });
    try {
      await assertAiAllowed(s, user.id, detail.accountIds);
    } catch {
      return c.json({ draft: null });
    }
    const key = `${detail.id}:${last.id}`;
    const cached = suggestions.get(key);
    if (cached !== undefined) return c.json({ draft: cached });
    const ctx = await smartFromContext(s, user.id, last.id, []);
    const chosen = ctx.identities.find((i) => i.id === chooseFromIdentity({ ...ctx, recipients: [] }).identityId);
    if (!chosen) return c.json({ draft: null });
    try {
      let draft = "";
      for await (const chunk of draftReply(s.ai.llm!, forWriting(detail), chosen, "Keep it short: two or three sentences.")) draft += chunk;
      draft = draft.trim();
      remember(key, draft);
      return c.json({ draft });
    } catch (err) {
      s.log.warn("suggestion failed", { threadId: detail.id }, err);
      return c.json({ draft: null });
    }
  });

  return r;
}
