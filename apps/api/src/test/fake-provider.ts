import type { MailProvider, NormalizedMessage, OutgoingMessage, IdentityRef, ProviderAction, SyncBatch } from "@ostra/core";

/** In-memory provider used by API tests: records calls, serves queued batches. */
export class FakeProvider implements MailProvider {
  readonly kind = "imap" as const;
  batches: SyncBatch[] = [];
  actions: { id: string; action: ProviderAction }[] = [];
  sent: { message: OutgoingMessage; identity: IdentityRef }[] = [];
  failActions = false;

  async connect() {
    return { identities: [{ address: "me@example.com", displayName: "Me" }], displayName: "Example" };
  }
  async initialSync(): Promise<SyncBatch> {
    return this.batches.shift() ?? { messages: [], updates: [], deleted: [], cursor: "c", hasMore: false };
  }
  async incrementalSync(): Promise<SyncBatch> {
    return this.initialSync();
  }
  async subscribe() {
    return { expiresAt: null, resourceId: null, close: async () => {} };
  }
  async send(message: OutgoingMessage, identity: IdentityRef) {
    this.sent.push({ message, identity });
    return { providerMessageId: `sent-${this.sent.length}`, rfcMessageId: `sent-${this.sent.length}@test` };
  }
  async applyAction(id: string, action: ProviderAction) {
    if (this.failActions) throw new Error("provider down");
    this.actions.push({ id, action });
  }
}

let seq = 0;
export function msg(over: Partial<NormalizedMessage> = {}): NormalizedMessage {
  seq++;
  return {
    providerMessageId: `p${seq}`,
    rfcMessageId: `m${seq}@test`,
    inReplyTo: null,
    references: [],
    from: { name: "Ada", address: "ada@example.org" },
    to: [{ address: "me@example.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: "Hello",
    snippet: "",
    bodyText: "Hi there",
    bodyHtml: null,
    attachments: [],
    sentAt: new Date(Date.UTC(2026, 0, 1, 0, seq)).toISOString(),
    folder: "inbox",
    isRead: false,
    headers: {},
    ...over,
  };
}
