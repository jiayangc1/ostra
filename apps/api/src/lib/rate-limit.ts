import type { MiddlewareHandler } from "hono";

/**
 * Fixed-window rate limiter, in memory. Keys by user when signed in,
 * otherwise by client IP. Good for one node; put Redis behind it to scale.
 */
export function rateLimit(opts: { windowMs: number; max: number; key: (c: Parameters<MiddlewareHandler>[0]) => string }): MiddlewareHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, opts.windowMs);
  sweep.unref?.();
  return async (c, next) => {
    const k = opts.key(c);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset < now) hits.set(k, (entry = { count: 0, reset: now + opts.windowMs }));
    entry.count++;
    c.header("RateLimit-Limit", String(opts.max));
    c.header("RateLimit-Remaining", String(Math.max(0, opts.max - entry.count)));
    if (entry.count > opts.max) {
      c.header("Retry-After", String(Math.ceil((entry.reset - now) / 1000)));
      return c.json({ error: "Too many requests", code: "rate_limited" }, 429);
    }
    await next();
  };
}
