import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { log } from "./lib/log.ts";
import { closeServices, createServices } from "./services/index.ts";
import { stopAllPush } from "./services/sync.ts";
import { jobHandlers, startBackground } from "./worker.ts";

const config = loadConfig();
const services = await createServices(config);
const { app, injectWebSocket } = createApp(services, {
  staticDir: process.env.STATIC_DIR ?? resolve(import.meta.dirname, "../../web/dist"),
});

let stopBackground = () => {};
if (config.inlineWorkers) {
  services.queue.process(jobHandlers(services));
  stopBackground = startBackground(services);
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info("api listening", { port: info.port, db: services.database.kind, auth: config.authMode, workers: config.inlineWorkers ? "inline" : "external" });
});
injectWebSocket(server);

const shutdown = async () => {
  stopBackground();
  await stopAllPush();
  server.close();
  await closeServices(services);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
