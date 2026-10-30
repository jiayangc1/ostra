import type {
  FlagUpdate,
  IdentityRef,
  NormalizedMessage,
  OutgoingMessage,
  ProviderKind,
  VirtualFolder,
} from "./types.ts";

export type ProviderAction =
  | { type: "archive" }
  | { type: "trash" }
  | { type: "spam" }
  | { type: "markRead" }
  | { type: "markUnread" }
  | { type: "move"; folder: VirtualFolder };

export interface ConnectResult {
  /** Addresses this account can send as. The first is the primary address. */
  identities: { address: string; displayName: string | null }[];
  displayName: string;
}

export interface SyncBatch {
  messages: NormalizedMessage[];
  /** Flag / folder changes to messages we already have. */
  updates: FlagUpdate[];
  /** Provider message ids that no longer exist. */
  deleted: string[];
  /** Opaque provider cursor (historyId, deltaLink, UIDVALIDITY:UID, ...). */
  cursor: string;
  /** More pages are available right now; call again with `cursor`. */
  hasMore: boolean;
}

export interface Subscription {
  /** When push must be renewed (Gmail watch / Graph subscriptions expire). */
  expiresAt: string | null;
  /** Provider-side resource id, for renewals and webhook routing. */
  resourceId: string | null;
  close(): Promise<void>;
}

export interface ActionResult {
  providerMessageId?: string | undefined;
}

export interface SendResult {
  providerMessageId: string;
  rfcMessageId: string;
}

/**
 * The single interface every mail provider implements. Workers, the send
 * router and the API only ever talk to this.
 */
export interface MailProvider {
  readonly kind: ProviderKind;
  connect(): Promise<ConnectResult>;
  initialSync(cursor?: string | null): Promise<SyncBatch>;
  incrementalSync(cursor: string): Promise<SyncBatch>;
  /**
   * Start push. Long-lived connections (IMAP IDLE) call `onChange` directly;
   * webhook providers register the subscription and the webhook handler
   * triggers an incremental sync.
   */
  subscribe(onChange: () => void): Promise<Subscription>;
  send(message: OutgoingMessage, identity: IdentityRef): Promise<SendResult>;
  /** Returns the message's new provider id when the action changes it (IMAP moves change the UID). */
  applyAction(providerMessageId: string, action: ProviderAction): Promise<ActionResult | void>;
  /** Fetch an attachment's bytes on demand. */
  fetchAttachment?(providerMessageId: string, providerAttachmentId: string): Promise<Uint8Array>;
  close?(): Promise<void>;
}

/** Thrown by providers when credentials are no longer valid. The account is marked `needs_reauth`. */
export class AuthExpiredError extends Error {
  override readonly name = "AuthExpiredError";
}

/** Thrown by providers on 429 / throttling. `retryAfterMs` is honored by the worker backoff. */
export class RateLimitedError extends Error {
  override readonly name = "RateLimitedError";
  constructor(
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

/** The provider cursor is no longer valid (expired historyId, UIDVALIDITY change); do a full resync. */
export class CursorInvalidError extends Error {
  override readonly name = "CursorInvalidError";
}

export function actionTargetFolder(action: ProviderAction): VirtualFolder | null {
  switch (action.type) {
    case "archive":
      return "archive";
    case "trash":
      return "trash";
    case "spam":
      return "spam";
    case "move":
      return action.folder;
    default:
      return null;
  }
}
