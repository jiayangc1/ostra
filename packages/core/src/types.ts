export const PROVIDER_KINDS = ["gmail", "outlook", "imap", "resend"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** Unified virtual folders. `snoozed` is reserved for v1.1 and never produced by v1 providers. */
export const VIRTUAL_FOLDERS = ["inbox", "sent", "drafts", "spam", "trash", "archive", "snoozed"] as const;
export type VirtualFolder = (typeof VIRTUAL_FOLDERS)[number];
export const VISIBLE_FOLDERS = ["inbox", "sent", "drafts", "spam", "trash", "archive"] as const satisfies readonly VirtualFolder[];

export const CATEGORIES = ["primary", "newsletter", "notification", "promotion"] as const;
export type Category = (typeof CATEGORIES)[number];

export const COLORS = ["blue", "purple", "amber", "green", "pink", "teal", "gray"] as const;
export type Color = (typeof COLORS)[number];

export type AccountStatus = "connecting" | "syncing" | "active" | "needs_reauth" | "error" | "disconnected";

export interface Address {
  name?: string | undefined;
  address: string;
}

export interface AttachmentMeta {
  filename: string;
  contentType: string;
  size: number;
  /** Provider-side handle used to fetch the bytes later. */
  providerAttachmentId?: string | undefined;
  contentId?: string | undefined;
  inline?: boolean | undefined;
}

/**
 * The normalized message every provider produces. Nothing downstream of a
 * provider knows where the mail came from.
 */
export interface NormalizedMessage {
  providerMessageId: string;
  providerThreadId?: string | undefined;
  /** The `Message-ID` header, without angle brackets. */
  rfcMessageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  snippet: string;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: AttachmentMeta[];
  /** ISO-8601 timestamp. */
  sentAt: string;
  folder: VirtualFolder;
  isRead: boolean;
  /** Lower-cased header names; only the headers the AI and threading need. */
  headers: Record<string, string>;
  providerLabels?: string[] | undefined;
}

export interface FlagUpdate {
  providerMessageId: string;
  isRead?: boolean | undefined;
  folder?: VirtualFolder | undefined;
}

export interface Identity {
  id: string;
  accountId: string;
  address: string;
  displayName: string | null;
  isDefault: boolean;
}

export interface Account {
  id: string;
  provider: ProviderKind;
  displayName: string;
  color: Color;
  status: AccountStatus;
  lastSyncedAt: string | null;
  aiEnabled: boolean;
  error?: string | null | undefined;
}

export interface Label {
  id: string;
  name: string;
  color: Color;
  description: string | null;
  sourceTemplate: string | null;
}

export interface ThreadLabel {
  labelId: string;
  source: "ai" | "user";
  confidence: number | null;
}

/** A row in the unified list. */
export interface ThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  category: Category;
  isRead: boolean;
  folder: VirtualFolder;
  from: Address;
  participants: Address[];
  /** Every account this thread landed in (one dot each). */
  accountIds: string[];
  labels: ThreadLabel[];
  messageCount: number;
  hasAttachments: boolean;
}

export interface MessageDetail {
  id: string;
  threadId: string;
  accountIds: string[];
  rfcMessageId: string | null;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  snippet: string;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: AttachmentMeta[];
  sentAt: string;
  folder: VirtualFolder;
  isRead: boolean;
  labels: ThreadLabel[];
}

export interface ThreadDetail extends ThreadSummary {
  messages: MessageDetail[];
}

export interface UserSettings {
  theme: "dark" | "light" | "system";
  defaultIdentityId: string | null;
  autoLabel: boolean;
  aiEnabled: boolean;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "dark",
  defaultIdentityId: null,
  autoLabel: true,
  aiEnabled: true,
  onboarded: false,
};

export interface OutgoingMessage {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  bodyText: string;
  bodyHtml?: string | undefined;
  inReplyTo?: string | null | undefined;
  references?: string[] | undefined;
  attachments?: OutgoingAttachment[] | undefined;
  /** Provider thread to attach the reply to, when the provider supports it. */
  providerThreadId?: string | undefined;
}

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  /** Base64 content. */
  content: string;
}

export interface IdentityRef {
  address: string;
  displayName: string | null;
}
