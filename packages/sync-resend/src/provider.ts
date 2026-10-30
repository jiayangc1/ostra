import {
  AuthExpiredError,
  RateLimitedError,
  makeSnippet,
  normalizeMessageId,
  parseMessageIdList,
  type Address,
  type ConnectResult,
  type IdentityRef,
  type MailProvider,
  type NormalizedMessage,
  type OutgoingMessage,
  type SendResult,
  type SyncBatch,
} from "@ostra/core";
import { formatAddress, parseAddressList } from "@ostra/core";
import { newMessageId } from "@ostra/core/compose";
import { parseMime } from "@ostra/core/mime";
import { Webhook } from "svix";

export const RESEND_API = "https://api.resend.com";

export interface ResendCredentials {
  apiKey: string;
  domain: string;
  /** Primary send-as address on the domain, e.g. hello@acme.dev */
  address: string;
  displayName: string | null;
  /** Other addresses on the domain to send as (support@, founders@). */
  aliases?: string[];
  /** Signing secret of the `email.received` webhook (whsec_...). Set after the webhook is created. */
  webhookSecret?: string | null;
}

export interface ResendOptions {
  fetch?: typeof fetch;
}

/** The parts of GET /emails/receiving/{id} we use. */
export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[] | string;
  cc?: string[] | null;
  bcc?: string[] | null;
  reply_to?: string[] | null;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  created_at: string;
  message_id?: string | null;
  headers?: Record<string, string> | null;
  raw?: { download_url: string; expires_at: string } | null;
  attachments?: { id: string; filename: string; content_type: string; size: number; content_id?: string | null; content_disposition?: string | null }[];
}

const toList = (v: string[] | string | null | undefined): Address[] => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x) => parseAddressList(x));

/** Verify a Resend webhook (Svix signatures over the raw body). Throws when invalid. */
export function verifyResendWebhook(secret: string, rawBody: string, headers: { id?: string | null; timestamp?: string | null; signature?: string | null }): { type: string; data: { email_id?: string } } {
  const wh = new Webhook(secret);
  return wh.verify(rawBody, {
    "svix-id": headers.id ?? "",
    "svix-timestamp": headers.timestamp ?? "",
    "svix-signature": headers.signature ?? "",
  }) as { type: string; data: { email_id?: string } };
}

/**
 * Custom domains through Resend. Receiving is push-only (the `email.received`
 * webhook); sending goes through the Resend API. There is no remote mailbox,
 * so archive / trash / read state live in Ostra alone.
 */
export class ResendProvider implements MailProvider {
  readonly kind = "resend" as const;
  private readonly f: typeof fetch;

  constructor(
    private readonly creds: ResendCredentials,
    opts: ResendOptions = {},
  ) {
    this.f = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.f(`${RESEND_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.creds.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) throw new AuthExpiredError("Resend rejected the API key");
    if (res.status === 429) throw new RateLimitedError("Resend rate limit", Number(res.headers.get("retry-after") ?? 1) * 1000);
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new Error(data.message ?? `Resend error ${res.status}`);
    return data;
  }

  async connect(): Promise<ConnectResult> {
    let domains: { data?: { name: string; status: string }[] };
    try {
      domains = await this.call("GET", "/domains");
    } catch (err) {
      if (err instanceof AuthExpiredError) throw new Error("Resend rejected that API key. It needs full access.");
      throw err;
    }
    const domain = domains.data?.find((d) => d.name.toLowerCase() === this.creds.domain.toLowerCase());
    if (!domain) throw new Error(`${this.creds.domain} isn't a domain in this Resend account.`);
    if (domain.status !== "verified") throw new Error(`${this.creds.domain} isn't verified in Resend yet.`);
    const onDomain = (a: string) => a.toLowerCase().endsWith(`@${this.creds.domain.toLowerCase()}`);
    if (!onDomain(this.creds.address)) throw new Error(`${this.creds.address} isn't on ${this.creds.domain}.`);
    return {
      displayName: this.creds.domain,
      identities: [this.creds.address, ...(this.creds.aliases ?? []).filter(onDomain)].map((address) => ({ address, displayName: this.creds.displayName })),
    };
  }

  /** Nothing to backfill: Resend only knows mail it received after the domain was set up, and delivers it by webhook. */
  async initialSync(): Promise<SyncBatch> {
    return { messages: [], updates: [], deleted: [], cursor: "webhook", hasMore: false };
  }

  async incrementalSync(): Promise<SyncBatch> {
    return this.initialSync();
  }

  async subscribe() {
    return { expiresAt: null, resourceId: this.creds.domain, close: async () => {} };
  }

  /** Mailbox state is app-side for Resend domains. */
  async applyAction() {}

  /** Fetch a received email (after `email.received`) and normalize it, preferring the raw MIME. */
  async fetchReceived(emailId: string): Promise<NormalizedMessage> {
    const email = await this.call<ReceivedEmail>("GET", `/emails/receiving/${encodeURIComponent(emailId)}`);
    const meta = { providerMessageId: `resend:${email.id}`, folder: "inbox" as const, isRead: false, receivedAt: email.created_at };
    const url = email.raw?.download_url;
    if (url && url.startsWith("https://")) {
      const raw = await this.f(url);
      if (raw.ok) return parseMime(Buffer.from(await raw.arrayBuffer()), meta);
    }
    return receivedToNormalized(email);
  }

  async send(message: OutgoingMessage, identity: IdentityRef): Promise<SendResult> {
    const rfcMessageId = newMessageId(identity.address);
    const headers: Record<string, string> = { "Message-ID": `<${rfcMessageId}>` };
    const reply = normalizeMessageId(message.inReplyTo);
    if (reply) headers["In-Reply-To"] = `<${reply}>`;
    if (message.references?.length) headers.References = message.references.map((r) => `<${normalizeMessageId(r) ?? r}>`).join(" ");
    const r = await this.call<{ id: string }>("POST", "/emails", {
      from: formatAddress({ name: identity.displayName ?? undefined, address: identity.address }),
      to: message.to.map(formatAddress),
      cc: message.cc.length ? message.cc.map(formatAddress) : undefined,
      bcc: message.bcc.length ? message.bcc.map(formatAddress) : undefined,
      subject: message.subject,
      text: message.bodyText,
      html: message.bodyHtml,
      headers,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, content_type: a.contentType })),
    });
    return { providerMessageId: `resend-sent:${r.id}`, rfcMessageId };
  }
}

/** Fallback when the raw MIME isn't available: build from the parsed JSON. */
export function receivedToNormalized(e: ReceivedEmail): NormalizedMessage {
  const headers = Object.fromEntries(Object.entries(e.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const html = e.html && !e.html.startsWith("data:") ? e.html : null;
  return {
    providerMessageId: `resend:${e.id}`,
    rfcMessageId: normalizeMessageId(e.message_id ?? headers["message-id"]),
    inReplyTo: normalizeMessageId(headers["in-reply-to"]),
    references: parseMessageIdList(headers.references),
    from: parseAddressList(e.from)[0] ?? { address: "" },
    to: toList(e.to),
    cc: toList(e.cc),
    bcc: toList(e.bcc),
    replyTo: toList(e.reply_to),
    subject: e.subject ?? "",
    snippet: makeSnippet(e.text),
    bodyText: e.text ?? null,
    bodyHtml: html,
    attachments: (e.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.content_type,
      size: a.size,
      contentId: a.content_id ?? undefined,
      inline: a.content_disposition === "inline",
      providerAttachmentId: a.id,
    })),
    sentAt: new Date(e.created_at).toISOString(),
    folder: "inbox",
    isRead: false,
    headers,
  };
}
