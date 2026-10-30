import type { ServerEvent } from "./types.ts";

/**
 * WebSocket to the API with token-in-first-message auth, heartbeat and
 * exponential reconnect. `onReady` fires on every (re)connect so the store
 * can reconcile anything it missed.
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly getToken: () => Promise<string | null>,
    private readonly handlers: { onEvent(e: ServerEvent): void; onReady(): void; onStatus(s: "connecting" | "online" | "offline"): void },
  ) {}

  start() {
    this.stopped = false;
    void this.connect();
    window.addEventListener("online", this.kick);
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.kick);
    if (this.retry) clearTimeout(this.retry);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    this.ws = null;
  }

  private kick = () => {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.attempt = 0;
    if (this.retry) clearTimeout(this.retry);
    void this.connect();
  };

  private async connect() {
    if (this.stopped) return;
    this.handlers.onStatus("connecting");
    const token = await this.getToken();
    if (!token || this.stopped) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (msg) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(String(msg.data)) as ServerEvent;
      } catch {
        return;
      }
      if (event.type === "ready") {
        this.attempt = 0;
        this.handlers.onStatus("online");
        this.handlers.onReady();
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" })), 25_000);
        return;
      }
      if (event.type !== "pong") this.handlers.onEvent(event);
    };
    ws.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.stopped || this.ws !== ws) return;
      this.handlers.onStatus("offline");
      const wait = Math.min(1000 * 2 ** this.attempt++, 30_000) * (0.75 + Math.random() * 0.5);
      this.retry = setTimeout(() => void this.connect(), wait);
    };
  }
}
