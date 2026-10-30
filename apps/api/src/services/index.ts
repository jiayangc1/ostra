import { join } from "node:path";
import { createDatabase } from "@ostra/db";
import type { Config } from "../config.ts";
import { createTokenVerifier } from "../lib/auth.ts";
import { EncryptedBlobStore, FsBlobStore, S3BlobStore, type BlobStore } from "../lib/blob-store.ts";
import { Envelope } from "../lib/crypto.ts";
import { log } from "../lib/log.ts";
import { MemoryQueue, createBullQueue, type JobQueue } from "../lib/queue.ts";
import { RealtimeHub } from "../lib/realtime.ts";
import { noopAi } from "./ai.ts";
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
    providers: o.providers ?? (await defaultProviders()),
    ai: noopAi,
    log,
    verifyToken: o.verifyToken ?? (await createTokenVerifier(config)),
  };
  services.ai = o.ai ? o.ai(services) : noopAi;
  return services;
}

/** Provider packages register themselves here as they land. */
async function defaultProviders(): Promise<ProviderRegistry> {
  return {};
}

export async function closeServices(s: Services) {
  await s.queue.close();
  await s.hub.close();
  await s.database.close();
}
