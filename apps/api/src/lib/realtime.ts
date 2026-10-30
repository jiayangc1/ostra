import type { Account, ThreadSummary } from "@ostra/core";

export type RealtimeEvent =
  | { type: "thread.upsert"; thread: ThreadSummary }
  | { type: "thread.remove"; threadId: string }
  | { type: "account.update"; account: Account }
  | { type: "labels.changed" }
  | { type: "sync.done"; accountId: string; added: number };

export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type Bridge = { publish(msg: string): void; close(): Promise<void> };

/**
 * Fans events out to every open socket of a user. With Redis configured,
 * events published by worker processes reach API processes through a
 * pub/sub channel.
 */
export class RealtimeHub {
  private readonly sockets = new Map<string, Set<Socket>>();
  private bridge: Bridge | null = null;

  async connectRedis(url: string) {
    const { Redis } = await import("ioredis");
    const pub = new Redis(url);
    const sub = new Redis(url);
    await sub.subscribe("ostra:events");
    sub.on("message", (_channel, raw: string) => {
      const { userId, event } = JSON.parse(raw) as { userId: string; event: RealtimeEvent };
      this.deliver(userId, event);
    });
    this.bridge = {
      publish: (msg) => void pub.publish("ostra:events", msg),
      close: async () => {
        sub.disconnect();
        pub.disconnect();
      },
    };
  }

  add(userId: string, socket: Socket) {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(socket);
  }

  remove(userId: string, socket: Socket) {
    const set = this.sockets.get(userId);
    set?.delete(socket);
    if (set?.size === 0) this.sockets.delete(userId);
  }

  publish(userId: string, event: RealtimeEvent) {
    if (this.bridge) this.bridge.publish(JSON.stringify({ userId, event }));
    else this.deliver(userId, event);
  }

  disconnectUser(userId: string) {
    for (const s of this.sockets.get(userId) ?? []) s.close(4001, "signed out");
    this.sockets.delete(userId);
  }

  private deliver(userId: string, event: RealtimeEvent) {
    const payload = JSON.stringify(event);
    for (const s of this.sockets.get(userId) ?? []) {
      try {
        s.send(payload);
      } catch {
        // socket closing; it will be removed by its close handler
      }
    }
  }

  async close() {
    await this.bridge?.close();
  }
}
