import type { ConnectResult, IdentityRef, MailProvider, OutgoingMessage, SyncBatch } from "@ostra/core";
import { newMessageId } from "@ostra/core/compose";

export interface DemoCredentials {
  demo: true;
  address: string;
  displayName: string | null;
}

/**
 * Provider for demo accounts: mail is seeded directly, actions succeed
 * locally, and sending files the message without leaving the machine.
 */
export class DemoProvider implements MailProvider {
  readonly kind = "imap" as const;
  constructor(private readonly creds: DemoCredentials) {}

  async connect(): Promise<ConnectResult> {
    return { displayName: this.creds.address, identities: [{ address: this.creds.address, displayName: this.creds.displayName }] };
  }
  async initialSync(): Promise<SyncBatch> {
    return { messages: [], updates: [], deleted: [], cursor: "demo", hasMore: false };
  }
  async incrementalSync(): Promise<SyncBatch> {
    return this.initialSync();
  }
  async subscribe() {
    return { expiresAt: null, resourceId: null, close: async () => {} };
  }
  async send(_m: OutgoingMessage, identity: IdentityRef) {
    const id = newMessageId(identity.address);
    return { providerMessageId: `demo-sent:${id}`, rfcMessageId: id };
  }
  async applyAction() {}
}

export const isDemoCredentials = (c: unknown): c is DemoCredentials => !!c && typeof c === "object" && (c as { demo?: unknown }).demo === true;
