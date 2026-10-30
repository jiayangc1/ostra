/**
 * Minimal structured logger. Never pass credentials, tokens or message
 * bodies here; errors are reduced to name + message.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min = ORDER[(process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === "test" ? "error" : "info")] ?? 20;

function errorInfo(err: unknown) {
  if (err instanceof Error) return { error: `${err.name}: ${err.message}` };
  return err === undefined ? {} : { error: String(err) };
}

function write(level: Level, msg: string, meta?: Record<string, unknown>, err?: unknown) {
  if (ORDER[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta, ...errorInfo(err) });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>, err?: unknown) => write("warn", msg, meta, err),
  error: (msg: string, meta?: Record<string, unknown>, err?: unknown) => write("error", msg, meta, err),
};
export type Logger = typeof log;
