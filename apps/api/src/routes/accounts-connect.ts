import { COLORS, type ProviderKind } from "@ostra/core";
import type { AccountRow } from "@ostra/db";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, badRequest } from "../lib/errors.ts";
import { isAllowedPort } from "../lib/ssrf.ts";
import { createAccount, toAccountDto } from "../services/accounts.ts";
import type { Services } from "../services/context.ts";
import type { AppEnv } from "./api.ts";

const server = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().refine(isAllowedPort, "Unsupported port"),
  secure: z.boolean(),
  user: z.string().min(1).max(320),
  pass: z.string().min(1).max(1024),
});

/** Verify credentials with the provider itself before anything is stored. */
async function verify(s: Services, kind: ProviderKind, credentials: unknown) {
  const factory = s.providers[kind];
  if (!factory) throw new HttpError(503, `${kind} isn't configured on this server`, "provider_unavailable");
  const provider = factory({ account: { id: "pending" } as AccountRow, credentials: credentials as never, config: s.config, saveCredentials: async () => {} });
  try {
    return await provider.connect();
  } catch (err) {
    throw new HttpError(422, err instanceof Error ? err.message : "Couldn't connect", "connect_failed");
  } finally {
    await provider.close?.().catch(() => {});
  }
}

export async function finishConnect(s: Services, userId: string, kind: ProviderKind, color: (typeof COLORS)[number], credentials: unknown, connected: Awaited<ReturnType<typeof verify>>, externalId?: string | null) {
  const row = await createAccount(s, userId, {
    provider: kind,
    displayName: connected.displayName,
    color,
    credentials,
    identities: connected.identities,
    externalId: externalId ?? null,
  });
  await s.queue.add("sync", { accountId: row.id, mode: "initial" }, { jobId: `${row.id}:initial` });
  s.hub.publish(userId, { type: "account.update", account: toAccountDto(row) });
  return toAccountDto(row);
}

export function connectRoutes(s: Services) {
  const r = new Hono<AppEnv>();

  r.post("/imap", async (c) => {
    const body = z
      .object({
        address: z.string().trim().email(),
        displayName: z.string().trim().max(80).nullable().default(null),
        color: z.enum(COLORS),
        imap: server,
        smtp: server,
        aliases: z.array(z.string().trim().email()).max(20).default([]),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw badRequest(body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), "invalid_body");
    const { color, ...credentials } = body.data;
    const connected = await verify(s, "imap", credentials);
    return c.json(await finishConnect(s, c.get("user").id, "imap", color, credentials, connected, credentials.address.toLowerCase()), 201);
  });

  return r;
}

export { verify as verifyProvider };
