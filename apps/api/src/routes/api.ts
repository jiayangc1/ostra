import { CATEGORIES, COLORS, LABEL_TEMPLATES, VIRTUAL_FOLDERS, type Label, type UserSettings } from "@ostra/core";
import { accounts, and, eq, identities, inArray, labels, type LabelRow, type UserRow } from "@ostra/db";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { badRequest, notFound } from "../lib/errors.ts";
import { THREAD_ACTIONS, applyThreadAction, changeCategory, setThreadLabel } from "../services/actions.ts";
import { disconnectAccount, getAccount, toAccountDto } from "../services/accounts.ts";
import type { Services } from "../services/context.ts";
import { stopPush } from "../services/sync.ts";
import { sendMessage } from "../services/send.ts";
import { connectRoutes } from "./accounts-connect.ts";
import { attachmentRoute } from "./attachments.ts";
import { devRoutes } from "../demo/routes.ts";
import { folderCounts, getThreadDetail, listThreads } from "../services/threads.ts";
import { settingsOf, updateSettings, upsertUserByClerkId } from "../services/users.ts";

export type AppEnv = { Variables: { user: UserRow } };

export const toLabelDto = (l: LabelRow): Label => ({
  id: l.id,
  name: l.name,
  color: l.color,
  description: l.description,
  sourceTemplate: l.sourceTemplate,
});

async function parse<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => {
    throw badRequest("Expected a JSON body");
  });
  const r = schema.safeParse(body);
  if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), "invalid_body");
  return r.data;
}

const uuid = z.string().uuid();
const color = z.enum(COLORS);

export function apiRoutes(s: Services) {
  const api = new Hono<AppEnv>();

  // Auth: every /api route needs a valid session token.
  api.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const who = token ? await s.verifyToken(token) : null;
    if (!who) return c.json({ error: "Sign in required", code: "unauthenticated" }, 401);
    const user = await upsertUserByClerkId(s.db, who.clerkUserId, { email: who.email, name: who.name ?? null });
    c.set("user", user);
    await next();
  });

  // ---- Bootstrap: everything the shell needs in one round trip ----
  api.get("/bootstrap", async (c) => {
    const user = c.get("user");
    const accts = await s.db.select().from(accounts).where(eq(accounts.userId, user.id)).orderBy(accounts.createdAt);
    const ids = accts.length ? await s.db.select().from(identities).where(inArray(identities.accountId, accts.map((a) => a.id))) : [];
    const lbls = await s.db.select().from(labels).where(eq(labels.userId, user.id)).orderBy(labels.createdAt);
    return c.json({
      user: { id: user.id, email: user.email, name: user.name },
      settings: settingsOf(user),
      accounts: accts.map(toAccountDto),
      identities: ids.map((i) => ({ id: i.id, accountId: i.accountId, address: i.address, displayName: i.displayName, isDefault: i.isDefault })),
      labels: lbls.map(toLabelDto),
      counts: await folderCounts(s.db, user.id),
      ai: { available: s.ai.available },
      templates: LABEL_TEMPLATES,
    });
  });

  api.get("/counts", async (c) => c.json(await folderCounts(s.db, c.get("user").id)));

  // ---- Settings ----
  const settingsSchema = z
    .object({
      theme: z.enum(["dark", "light", "system"]),
      defaultIdentityId: uuid.nullable(),
      autoLabel: z.boolean(),
      aiEnabled: z.boolean(),
      onboarded: z.boolean(),
    })
    .partial();
  api.patch("/settings", async (c) => {
    const user = c.get("user");
    const patch = (await parse(c, settingsSchema)) as Partial<UserSettings>;
    if (patch.defaultIdentityId) {
      const [own] = await s.db
        .select({ id: identities.id })
        .from(identities)
        .innerJoin(accounts, eq(accounts.id, identities.accountId))
        .where(and(eq(identities.id, patch.defaultIdentityId), eq(accounts.userId, user.id)));
      if (!own) throw badRequest("Unknown identity");
    }
    return c.json(await updateSettings(s.db, user.id, patch));
  });

  // ---- Threads ----
  const listSchema = z.object({
    folder: z.enum(VIRTUAL_FOLDERS).optional(),
    accountId: uuid.optional(),
    labelId: uuid.optional(),
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  });
  api.get("/threads", async (c) => {
    const q = listSchema.safeParse(c.req.query());
    if (!q.success) throw badRequest("Invalid query");
    const query = q.data.folder || q.data.labelId ? q.data : { ...q.data, folder: "inbox" as const };
    return c.json(await listThreads(s.db, c.get("user").id, query));
  });

  api.get("/threads/:id", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) throw notFound("Thread not found");
    return c.json(await getThreadDetail(s, c.get("user").id, id.data));
  });

  api.post("/threads/:id/actions", async (c) => {
    const { action } = await parse(c, z.object({ action: z.enum(THREAD_ACTIONS) }));
    return c.json({ thread: await applyThreadAction(s, c.get("user").id, c.req.param("id"), action) });
  });

  api.put("/threads/:id/category", async (c) => {
    const { category } = await parse(c, z.object({ category: z.enum(CATEGORIES) }));
    return c.json({ thread: await changeCategory(s, c.get("user").id, c.req.param("id"), category) });
  });

  api.put("/threads/:id/labels/:labelId", async (c) => {
    const { applied } = await parse(c, z.object({ applied: z.boolean() }));
    return c.json({ thread: await setThreadLabel(s, c.get("user").id, c.req.param("id"), c.req.param("labelId"), applied) });
  });

  // ---- Labels ----
  const labelSchema = z.object({
    name: z.string().trim().min(1).max(40),
    color: color.default("gray"),
    description: z.string().trim().max(300).nullable().optional(),
  });
  api.get("/labels", async (c) => {
    const rows = await s.db.select().from(labels).where(eq(labels.userId, c.get("user").id)).orderBy(labels.createdAt);
    return c.json(rows.map(toLabelDto));
  });

  api.post("/labels", async (c) => {
    const user = c.get("user");
    const body = await parse(c, labelSchema);
    const [row] = await s.db
      .insert(labels)
      .values({ userId: user.id, name: body.name, color: body.color, description: body.description ?? null })
      .onConflictDoNothing()
      .returning();
    if (!row) return c.json({ error: "A label with that name already exists", code: "label_exists" }, 409);
    s.hub.publish(user.id, { type: "labels.changed" });
    return c.json(toLabelDto(row), 201);
  });

  /** Onboarding: create labels from template packs plus custom names. Idempotent by name. */
  api.post("/labels/templates", async (c) => {
    const user = c.get("user");
    const body = await parse(c, z.object({ templateIds: z.array(z.string()).max(10), custom: z.array(labelSchema).max(50).default([]) }));
    const values = [
      ...LABEL_TEMPLATES.filter((t) => body.templateIds.includes(t.id)).flatMap((t) =>
        t.labels.map((l) => ({ userId: user.id, name: l.name, color: l.color, description: l.description, sourceTemplate: t.id })),
      ),
      ...body.custom.map((l) => ({ userId: user.id, name: l.name, color: l.color, description: l.description ?? null, sourceTemplate: null })),
    ];
    if (values.length) await s.db.insert(labels).values(values).onConflictDoNothing();
    const rows = await s.db.select().from(labels).where(eq(labels.userId, user.id)).orderBy(labels.createdAt);
    s.hub.publish(user.id, { type: "labels.changed" });
    return c.json(rows.map(toLabelDto));
  });

  api.patch("/labels/:id", async (c) => {
    const user = c.get("user");
    const body = await parse(c, labelSchema.partial());
    const [row] = await s.db
      .update(labels)
      .set(body)
      .where(and(eq(labels.id, c.req.param("id")), eq(labels.userId, user.id)))
      .returning();
    if (!row) throw notFound("Label not found");
    s.hub.publish(user.id, { type: "labels.changed" });
    return c.json(toLabelDto(row));
  });

  api.delete("/labels/:id", async (c) => {
    const user = c.get("user");
    await s.db.delete(labels).where(and(eq(labels.id, c.req.param("id")), eq(labels.userId, user.id)));
    s.hub.publish(user.id, { type: "labels.changed" });
    return c.body(null, 204);
  });

  // ---- Accounts ----
  api.route("/accounts/connect", connectRoutes(s));

  api.get("/accounts", async (c) => {
    const rows = await s.db.select().from(accounts).where(eq(accounts.userId, c.get("user").id)).orderBy(accounts.createdAt);
    return c.json(rows.map(toAccountDto));
  });

  api.patch("/accounts/:id", async (c) => {
    const user = c.get("user");
    const body = await parse(c, z.object({ displayName: z.string().trim().min(1).max(60), color, aiEnabled: z.boolean() }).partial());
    const acct = await getAccount(s, user.id, c.req.param("id"));
    const [row] = await s.db.update(accounts).set(body).where(eq(accounts.id, acct.id)).returning();
    s.hub.publish(user.id, { type: "account.update", account: toAccountDto(row!) });
    return c.json(toAccountDto(row!));
  });

  api.post("/accounts/:id/sync", async (c) => {
    const acct = await getAccount(s, c.get("user").id, c.req.param("id"));
    await s.queue.add("sync", { accountId: acct.id, mode: acct.syncCursor ? "incremental" : "initial" }, { jobId: `${acct.id}:manual` });
    return c.json({ queued: true }, 202);
  });

  /** Disconnect: stop sync and delete the account's stored mail. */
  api.delete("/accounts/:id", async (c) => {
    const user = c.get("user");
    const acct = await getAccount(s, user.id, c.req.param("id"));
    await stopPush(acct.id);
    await disconnectAccount(s, acct);
    return c.body(null, 204);
  });

  // ---- Send ----
  const addr = z.object({ name: z.string().max(200).optional(), address: z.string().trim().email() });
  api.post("/send", async (c) => {
    const body = await parse(
      c,
      z.object({
        identityId: uuid,
        to: z.array(addr).max(100).default([]),
        cc: z.array(addr).max(100).default([]),
        bcc: z.array(addr).max(100).default([]),
        subject: z.string().max(998).default(""),
        bodyText: z.string().max(2_000_000),
        bodyHtml: z.string().max(5_000_000).optional(),
        replyToMessageId: uuid.nullable().optional(),
        attachments: z
          .array(z.object({ filename: z.string().min(1).max(255), contentType: z.string().max(255), content: z.string().max(35_000_000) }))
          .max(20)
          .optional(),
      }),
    );
    return c.json(await sendMessage(s, c.get("user").id, body), 201);
  });

  api.get("/messages/:id/attachments/:index", attachmentRoute(s));

  if (s.config.demo) api.route("/dev", devRoutes(s));

  return api;
}
