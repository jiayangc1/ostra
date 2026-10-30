import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HttpError } from "./lib/errors.ts";
import { rateLimit } from "./lib/rate-limit.ts";
import type { Socket } from "./lib/realtime.ts";
import { apiRoutes, type AppEnv } from "./routes/api.ts";
import type { Services } from "./services/context.ts";
import { upsertUserByClerkId } from "./services/users.ts";
import { clerkWebhook } from "./webhooks/clerk.ts";
import { gmailWebhook, graphWebhook } from "./webhooks/push.ts";
import { oauthCallbackRoutes } from "./routes/oauth.ts";

const clientIp = (c: { req: { header(n: string): string | undefined } }) =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "local";

export function createApp(s: Services, opts: { staticDir?: string | undefined; extraRoutes?: (app: Hono<AppEnv>) => void } = {}) {
  const app = new Hono<AppEnv>();
  const ws = createNodeWebSocket({ app });

  app.use(
    "*",
    secureHeaders({
      crossOriginResourcePolicy: "same-origin",
      referrerPolicy: "strict-origin-when-cross-origin",
      contentSecurityPolicy: undefined,
    }),
  );
  // The SPA is same-origin; Tauri and the Vite dev server are the only cross-origin clients.
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (s.config.clerk.authorizedParties.includes(origin) || origin === s.config.appUrl ? origin : null),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      maxAge: 600,
    }),
  );
  app.use("/api/*", bodyLimit({ maxSize: 30 * 1024 * 1024 }));
  app.use("/api/*", rateLimit({ windowMs: 60_000, max: 600, key: (c) => c.req.header("authorization")?.slice(-24) ?? clientIp(c) }));
  app.use("/webhooks/*", rateLimit({ windowMs: 60_000, max: 1200, key: clientIp }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, code: err.code }, err.status);
    s.log.error("unhandled error", { path: c.req.path, method: c.req.method }, err);
    return c.json({ error: "Something went wrong", code: "internal" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/api", apiRoutes(s));
  app.route("/webhooks/clerk", clerkWebhook(s));
  app.route("/webhooks/gmail", gmailWebhook(s));
  app.route("/webhooks/graph", graphWebhook(s));
  app.route("/oauth", oauthCallbackRoutes(s));
  opts.extraRoutes?.(app);

  /**
   * Realtime. Browsers can't set headers on WebSockets, and tokens in URLs
   * end up in logs, so the first message must be `{type:"auth", token}`.
   */
  app.get(
    "/ws",
    ws.upgradeWebSocket(() => {
      let userId: string | null = null;
      let socket: Socket | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        onOpen(_evt, wsCtx) {
          timer = setTimeout(() => !userId && wsCtx.close(4001, "auth timeout"), 5000);
        },
        async onMessage(evt, wsCtx) {
          let msg: { type?: string; token?: string };
          try {
            msg = JSON.parse(String(evt.data));
          } catch {
            return;
          }
          if (msg.type === "ping") return wsCtx.send(JSON.stringify({ type: "pong" }));
          if (msg.type === "auth" && !userId && msg.token) {
            const who = await s.verifyToken(msg.token);
            if (!who) return wsCtx.close(4001, "unauthenticated");
            const user = await upsertUserByClerkId(s.db, who.clerkUserId, { email: who.email, name: who.name ?? null });
            userId = user.id;
            socket = { send: (d) => wsCtx.send(d), close: (code, reason) => wsCtx.close(code, reason) };
            s.hub.add(userId, socket);
            if (timer) clearTimeout(timer);
            wsCtx.send(JSON.stringify({ type: "ready" }));
          }
        },
        onClose() {
          if (timer) clearTimeout(timer);
          if (userId && socket) s.hub.remove(userId, socket);
        },
      };
    }),
  );

  // Production: serve the built SPA from the same origin, falling back to index.html for client routes.
  const dir = opts.staticDir;
  if (dir && existsSync(resolve(dir, "index.html"))) {
    const index = readFile(resolve(dir, "index.html"), "utf8");
    app.use("/*", serveStatic({ root: dir }));
    app.get("*", async (c) => c.html(await index));
  }

  return { app, injectWebSocket: ws.injectWebSocket };
}
