import { RateLimitedError } from "@ostra/core";

export interface JobMap {
  /** Pull new mail for one account. */
  sync: { accountId: string; mode: "initial" | "incremental" };
  /** Categorize + auto-label freshly ingested messages. */
  ai: { userId: string; messageIds: string[] };
  /** Push a provider action (archive, trash...) for one message in one account. */
  action: { accountId: string; providerMessageId: string; action: import("@ostra/core").ProviderAction };
  /** Delete everything for a user (Clerk user.deleted). */
  purgeUser: { userId: string };
}
export type JobName = keyof JobMap;
export type Handlers = { [K in JobName]: (data: JobMap[K]) => Promise<void> };

export interface AddOptions {
  /** Jobs with the same id are coalesced while one is pending; one added while it runs queues a single follow-up run. */
  jobId?: string;
  delayMs?: number;
  attempts?: number;
}

export interface JobQueue {
  add<K extends JobName>(name: K, data: JobMap[K], opts?: AddOptions): Promise<void>;
  process(handlers: Handlers): void;
  close(): Promise<void>;
}

export function backoffMs(attempt: number, err: unknown): number {
  if (err instanceof RateLimitedError && err.retryAfterMs) return err.retryAfterMs;
  const base = Math.min(2 ** attempt * 1000, 5 * 60_000);
  return base / 2 + Math.random() * (base / 2);
}

/**
 * In-process queue for development and tests: coalescing by job id,
 * exponential backoff with jitter, honors provider Retry-After.
 */
export class MemoryQueue implements JobQueue {
  private handlers: Handlers | null = null;
  private readonly pending = new Set<string>();
  private readonly active = new Set<string>();
  private readonly rerun = new Map<string, { name: JobName; data: unknown; opts: AddOptions }>();
  private readonly backlog: { name: JobName; data: unknown; opts: AddOptions }[] = [];
  private running = 0;
  private closed = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly concurrency = 4,
    private readonly log: (msg: string, err?: unknown) => void = () => {},
  ) {}

  async add<K extends JobName>(name: K, data: JobMap[K], opts: AddOptions = {}) {
    if (this.closed) return;
    const key = opts.jobId ? `${name}:${opts.jobId}` : null;
    if (key && this.active.has(key)) {
      // Running now: run once more after it, with the latest data.
      this.rerun.set(key, { name, data, opts });
      return;
    }
    if (key && this.pending.has(key)) return;
    if (key) this.pending.add(key);
    const enqueue = () => {
      this.backlog.push({ name, data, opts });
      this.pump();
    };
    if (opts.delayMs) this.later(enqueue, opts.delayMs);
    else enqueue();
  }

  process(handlers: Handlers) {
    this.handlers = handlers;
    this.pump();
  }

  /** Resolves when nothing is queued or running (tests). Delayed retries are not awaited. */
  idle(): Promise<void> {
    if (this.running === 0 && this.backlog.length === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  async close() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  private pump() {
    if (!this.handlers || this.closed) return;
    while (this.running < this.concurrency && this.backlog.length) {
      const job = this.backlog.shift()!;
      this.running++;
      void this.run(job, 1).finally(() => {
        this.running--;
        this.pump();
        if (this.running === 0 && this.backlog.length === 0) {
          const w = this.idleWaiters;
          this.idleWaiters = [];
          w.forEach((r) => r());
        }
      });
    }
  }

  private async run(job: { name: JobName; data: unknown; opts: AddOptions }, attempt: number): Promise<void> {
    const key = job.opts.jobId ? `${job.name}:${job.opts.jobId}` : null;
    const finish = () => {
      if (!key) return;
      this.pending.delete(key);
      const next = this.rerun.get(key);
      this.rerun.delete(key);
      if (next) void this.add(next.name, next.data as never, next.opts);
    };
    if (key) this.active.add(key);
    try {
      await (this.handlers![job.name] as (d: unknown) => Promise<void>)(job.data);
      if (key) this.active.delete(key);
      finish();
    } catch (err) {
      if (key) this.active.delete(key);
      const max = job.opts.attempts ?? 5;
      if (attempt >= max || this.closed) {
        this.log(`job ${job.name} failed after ${attempt} attempts`, err);
        finish();
        return;
      }
      const wait = backoffMs(attempt, err);
      this.log(`job ${job.name} attempt ${attempt} failed, retrying in ${Math.round(wait)}ms`, err);
      this.later(() => {
        this.running++;
        void this.run(job, attempt + 1).finally(() => {
          this.running--;
          this.pump();
        });
      }, wait);
    }
  }
}

/** BullMQ-backed queue when REDIS_URL is set. Survives restarts and scales across worker processes. */
export async function createBullQueue(redisUrl: string, log: (msg: string, err?: unknown) => void): Promise<JobQueue> {
  const { Queue, Worker, DelayedError } = await import("bullmq");
  const { Redis } = await import("ioredis");
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue("ostra", { connection });
  let worker: InstanceType<typeof Worker> | null = null;
  return {
    async add(name, data, opts = {}) {
      await queue.add(name, data, {
        // Not a custom jobId: BullMQ silently drops adds whose id still sits in the failed set,
        // which froze an account's sync after one bad run. keepLastIfActive also queues one
        // follow-up run when a push lands mid-sync instead of dropping it.
        deduplication: opts.jobId ? { id: `${name}:${opts.jobId}`, keepLastIfActive: true } : undefined,
        delay: opts.delayMs,
        attempts: opts.attempts ?? 5,
        backoff: { type: "exponential", delay: 2000, jitter: 0.5 },
        removeOnComplete: true,
        removeOnFail: 500,
      });
    },
    process(handlers) {
      worker = new Worker(
        "ostra",
        async (job, token) => {
          try {
            await (handlers[job.name as JobName] as (d: unknown) => Promise<void>)(job.data);
          } catch (err) {
            if (err instanceof RateLimitedError && err.retryAfterMs && token) {
              await job.moveToDelayed(Date.now() + err.retryAfterMs, token);
              throw new DelayedError();
            }
            throw err;
          }
        },
        { connection: connection.duplicate(), concurrency: 8 },
      );
      worker.on("failed", (job, err) => log(`job ${job?.name} failed (attempt ${job?.attemptsMade})`, err));
    },
    async close() {
      await worker?.close();
      await queue.close();
      connection.disconnect();
    },
  };
}
