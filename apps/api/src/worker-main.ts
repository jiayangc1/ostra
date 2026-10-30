import { loadConfig } from "./config.ts";
import { log } from "./lib/log.ts";
import { closeServices, createServices } from "./services/index.ts";
import { stopAllPush } from "./services/sync.ts";
import { jobHandlers, startBackground } from "./worker.ts";

/** Standalone worker process (set OSTRA_INLINE_WORKERS=false on the API). Requires REDIS_URL. */
const config = loadConfig();
if (!config.redisUrl) throw new Error("A separate worker process needs REDIS_URL");
const services = await createServices(config);
services.queue.process(jobHandlers(services));
const stop = startBackground(services);
log.info("worker started");

const shutdown = async () => {
  stop();
  await stopAllPush();
  await closeServices(services);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
