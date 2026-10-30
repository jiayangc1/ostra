import { join } from "node:path";
import { createDatabase } from "@ostra/db";
import type { Config } from "../config.ts";
import { createTokenVerifier } from "../lib/auth.ts";
import { EncryptedBlobStore, FsBlobStore, S3BlobStore, type BlobStore } from "../lib/blob-store.ts";
import { Envelope } from "../lib/crypto.ts";
import { log } from "../lib/log.ts";
import { MemoryQueue, createBullQueue, type JobQueue } from "../lib/queue.ts";
import { RealtimeHub } from "../lib/realtime.ts";
import { ImapProvider, type ImapCredentials } from "@ostra/sync-imap";
import { GmailProvider, type GmailCredentials } from "@ostra/sync-gmail";
import { OutlookProvider, type OutlookCredentials } from "@ostra/sync-outlook";
import { ResendProvider, type ResendCredentials } from "@ostra/sync-resend";
import { assertPublicHost } from "../lib/ssrf.ts";
import { createAiService, noopAi } from "./ai.ts";
import { AnthropicProvider } from "@ostra/ai";
import { PROVIDER_KINDS } from "@ostra/core";
import { DemoProvider, isDemoCredentials } from "../demo/provider.ts";
import type { ProviderRegistry, Services } from "./context.ts";

export interface ServiceOverrides {
  blobStore?: BlobStore;
  queue?: JobQueue;
  providers?: ProviderRegistry;
  envelope?: Envelope;
  verifyToken?: Services["verifyToken"];
  /** "memory" for tests. */
  pgliteDir?: string;
  ai?: (s: Services) => Services["ai"];
}

export async function createServices(config: Config, o: ServiceOverrides = {}): Promise<Services> {
  const database = await createDatabase({ url: config.databaseUrl, dataDir: o.pgliteDir ?? join(config.dataDir, "pglite") });
  await database.migrate();

  const envelope = o.envelope ?? (config.masterKey ? Envelope.fromEnv(config.masterKey) : Envelope.fromDevKeyFile(join(config.dataDir, "dev-master.key")));
  const store: BlobStore =
    o.blobStore ??
    (config.s3
      ? new S3BlobStore(config.s3.bucket, config.s3)
      : new FsBlobStore(join(config.dataDir, "blobs")));
  const queue = o.queue ?? (config.redisUrl ? await createBullQueue(config.redisUrl, (m, e) => log.warn(m, {}, e)) : new MemoryQueue(4, (m, e) => log.warn(m, {}, e)));
  const hub = new RealtimeHub();
  if (config.redisUrl && !o.queue) await hub.connectRedis(config.redisUrl);

  const services: Services = {
    config,
    database,
    db: database.db,
    envelope,
    blobs: new EncryptedBlobStore(store, envelope),
    queue,
    hub,
    providers: withDemo(config, o.providers ?? defaultProviders(config)),
    ai: noopAi,
    log,
    verifyToken: o.verifyToken ?? (await createTokenVerifier(config)),
  };
  services.ai = o.ai ? o.ai(services) : createAiService(services, config.anthropicApiKey ? new AnthropicProvider({ apiKey: config.anthropicApiKey }) : null);
  return services;
}

function defaultProviders(config: Config): ProviderRegistry {
  const checkHost = (host: string) => assertPublicHost(host, { allowPrivate: config.allowPrivateMailHosts });
  const httpsPublic = config.publicUrl.startsWith("https://");
  return {
    ...(config.google
      ? {
          gmail: (ctx) =>
            new GmailProvider(ctx.credentials as GmailCredentials, {
              clientId: config.google!.clientId,
              clientSecret: config.google!.clientSecret,
              pubsubTopic: config.google!.pubsubTopic,
              save: (c) => ctx.saveCredentials(c as never),
            }),
        }
      : {}),
    ...(config.microsoft
      ? {
          outlook: (ctx) =>
            new OutlookProvider(ctx.credentials as OutlookCredentials, {
              clientId: config.microsoft!.clientId,
              clientSecret: config.microsoft!.clientSecret,
              tenant: config.microsoft!.tenant,
              save: (c) => ctx.saveCredentials(c as never),
              // Graph only delivers to public https endpoints; locally, polling covers it.
              notificationUrl: httpsPublic ? `${config.publicUrl}/webhooks/graph` : undefined,
              clientState: ctx.account.webhookToken,
            }),
        }
      : {}),
    resend: (ctx) => new ResendProvider(ctx.credentials as ResendCredentials),
    imap: (ctx) =>
      new ImapProvider(ctx.credentials as ImapCredentials, {
        checkHost,
        log: (m, e) => log.warn(m, { accountId: ctx.account.id }, e),
      }),
  };
}

/** In demo mode, accounts created by the seeder use the local demo provider whatever their kind. */
function withDemo(config: Config, registry: ProviderRegistry): ProviderRegistry {
  if (!config.demo) return registry;
  const out: ProviderRegistry = {};
  for (const kind of PROVIDER_KINDS) {
    const real = registry[kind];
    out[kind] = (ctx) => (isDemoCredentials(ctx.credentials) ? new DemoProvider(ctx.credentials) : real ? real(ctx) : new DemoProvider(ctx.credentials));
  }
  return out;
}

export async function closeServices(s: Services) {
  await s.queue.close();
  await s.hub.close();
  await s.database.close();
}
