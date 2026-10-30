import { randomBytes } from "node:crypto";
import type { Color, ProviderKind } from "@ostra/core";
import { createApp } from "../app.ts";
import { loadConfig } from "../config.ts";
import { MemoryBlobStore } from "../lib/blob-store.ts";
import { Envelope } from "../lib/crypto.ts";
import { MemoryQueue } from "../lib/queue.ts";
import { createAccount } from "../services/accounts.ts";
import type { ProviderRegistry, Services } from "../services/context.ts";
import { closeServices, createServices, type ServiceOverrides } from "../services/index.ts";
import { upsertUserByClerkId } from "../services/users.ts";
import { FakeProvider } from "./fake-provider.ts";

export interface Harness {
  s: Services;
  queue: MemoryQueue;
  /** One FakeProvider per account id. */
  fakes: Map<string, FakeProvider>;
  request(path: string, init?: RequestInit & { json?: unknown; user?: string }): Promise<Response>;
  addAccount(userId: string, opts?: { address?: string; color?: Color; provider?: ProviderKind }): Promise<{ id: string; fake: FakeProvider; userId: string }>;
  user(name?: string): Promise<{ id: string }>;
  close(): Promise<void>;
}

export async function createHarness(o: ServiceOverrides = {}): Promise<Harness> {
  const fakes = new Map<string, FakeProvider>();
  const factory = (ctx: { account: { id: string } }) => {
    let f = fakes.get(ctx.account.id);
    if (!f) fakes.set(ctx.account.id, (f = new FakeProvider()));
    return f;
  };
  const providers: ProviderRegistry = { imap: factory, gmail: factory, outlook: factory, resend: factory };
  const queue = new MemoryQueue(1);
  const config = { ...loadConfig({ NODE_ENV: "test" }), dataDir: "/nonexistent" };
  const s = await createServices(config, {
    pgliteDir: "memory",
    blobStore: new MemoryBlobStore(),
    queue,
    providers,
    envelope: new Envelope(new Map([[1, randomBytes(32)]])),
    ...o,
  });
  const { app } = createApp(s);
  return {
    s,
    queue,
    fakes,
    request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.user !== "") headers.set("authorization", `Bearer dev:${init.user ?? "you"}`);
      if (init.json !== undefined) headers.set("content-type", "application/json");
      return Promise.resolve(app.request(path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body }));
    },
    async user(name = "you") {
      return upsertUserByClerkId(s.db, `dev_${name}`, { email: `${name}@dev.local` });
    },
    async addAccount(userId, opts = {}) {
      const row = await createAccount(s, userId, {
        provider: opts.provider ?? "imap",
        displayName: opts.address ?? "me@example.com",
        color: opts.color ?? "blue",
        credentials: { secret: "x" },
        identities: [{ address: opts.address ?? "me@example.com", displayName: "Me" }],
      });
      const fake = new FakeProvider();
      fakes.set(row.id, fake);
      return { id: row.id, fake, userId };
    },
    close: () => closeServices(s),
  };
}
