import type { MailProvider, ProviderKind } from "@ostra/core";
import type { AccountRow, Database, Db } from "@ostra/db";
import type { Config } from "../config.ts";
import type { EncryptedBlobStore } from "../lib/blob-store.ts";
import type { Envelope } from "../lib/crypto.ts";
import type { Logger } from "../lib/log.ts";
import type { JobQueue } from "../lib/queue.ts";
import type { RealtimeHub } from "../lib/realtime.ts";
import type { AiService } from "./ai.ts";

export interface ProviderContext<C = unknown> {
  account: AccountRow;
  credentials: C;
  /** Persist refreshed OAuth tokens. */
  saveCredentials(next: C): Promise<void>;
  config: Config;
}

export type ProviderFactory = (ctx: ProviderContext<never>) => MailProvider;
export type ProviderRegistry = Partial<Record<ProviderKind, ProviderFactory>>;

export interface AuthIdentity {
  clerkUserId: string;
  email?: string;
  name?: string | null;
}

export interface Services {
  config: Config;
  database: Database;
  db: Db;
  envelope: Envelope;
  blobs: EncryptedBlobStore;
  queue: JobQueue;
  hub: RealtimeHub;
  providers: ProviderRegistry;
  ai: AiService;
  log: Logger;
  /** Verifies a session token; null when invalid. */
  verifyToken(token: string): Promise<AuthIdentity | null>;
}
