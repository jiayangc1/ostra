import { resolve } from "node:path";

export interface Config {
  env: "development" | "production" | "test";
  port: number;
  /** Public base URL of the API (OAuth redirects, webhook URLs). */
  publicUrl: string;
  /** Where the SPA lives (OAuth callback lands back here). */
  appUrl: string;
  databaseUrl: string | undefined;
  dataDir: string;
  redisUrl: string | undefined;
  masterKey: string | undefined;
  clerk: { secretKey: string | undefined; webhookSecret: string | undefined; authorizedParties: string[] };
  /** Dev auth is only possible outside production when Clerk is not configured. */
  authMode: "clerk" | "dev";
  s3: { bucket: string; region: string; endpoint: string | undefined; accessKeyId: string | undefined; secretAccessKey: string | undefined } | null;
  google: { clientId: string; clientSecret: string; pubsubTopic: string | undefined; pubsubAudience: string | undefined } | null;
  microsoft: { clientId: string; clientSecret: string; tenant: string } | null;
  anthropicApiKey: string | undefined;
  /** Run sync workers in the API process (single-process dev / small deploys). */
  inlineWorkers: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development") as Config["env"];
  const port = Number(env.PORT ?? 8787);
  const clerkSecret = env.CLERK_SECRET_KEY || undefined;
  if (nodeEnv === "production" && !clerkSecret) throw new Error("CLERK_SECRET_KEY is required in production");
  if (nodeEnv === "production" && !env.OSTRA_MASTER_KEY) throw new Error("OSTRA_MASTER_KEY is required in production");
  return {
    env: nodeEnv,
    port,
    publicUrl: env.PUBLIC_API_URL ?? `http://localhost:${port}`,
    appUrl: env.APP_URL ?? "http://localhost:5173",
    databaseUrl: env.DATABASE_URL || undefined,
    dataDir: resolve(env.OSTRA_DATA_DIR ?? resolve(import.meta.dirname, "../../../.data")),
    redisUrl: env.REDIS_URL || undefined,
    masterKey: env.OSTRA_MASTER_KEY || undefined,
    clerk: {
      secretKey: clerkSecret,
      webhookSecret: env.CLERK_WEBHOOK_SIGNING_SECRET || undefined,
      authorizedParties: (env.CLERK_AUTHORIZED_PARTIES ?? env.APP_URL ?? "http://localhost:5173,tauri://localhost,http://tauri.localhost")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    authMode: clerkSecret ? "clerk" : "dev",
    s3: env.S3_BUCKET
      ? {
          bucket: env.S3_BUCKET,
          region: env.S3_REGION ?? "auto",
          endpoint: env.S3_ENDPOINT || undefined,
          accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
        }
      : null,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            pubsubTopic: env.GOOGLE_PUBSUB_TOPIC || undefined,
            pubsubAudience: env.GOOGLE_PUBSUB_AUDIENCE || undefined,
          }
        : null,
    microsoft:
      env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
        ? { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenant: env.MICROSOFT_TENANT ?? "common" }
        : null,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    inlineWorkers: env.OSTRA_INLINE_WORKERS !== "false",
  };
}
