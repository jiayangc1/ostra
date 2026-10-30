import type { Address, AttachmentMeta, Category, Color, ProviderKind, UserSettings, VirtualFolder } from "@ostra/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull().default(""),
  name: text("name"),
  settings: jsonb("settings").$type<Partial<UserSettings>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface PushState {
  expiresAt: string | null;
  resourceId: string | null;
}

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderKind>().notNull(),
    displayName: text("display_name").notNull(),
    color: text("color").$type<Color>().notNull().default("blue"),
    /** Envelope-encrypted JSON. Never logged. */
    encryptedCredentials: text("encrypted_credentials").notNull(),
    syncCursor: text("sync_cursor"),
    status: text("status").notNull().default("connecting"),
    statusMessage: text("status_message"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    push: jsonb("push").$type<PushState>(),
    /** Random secret used to route and authenticate provider webhooks (Graph clientState, Resend route). */
    webhookToken: text("webhook_token").notNull().unique(),
    /** Provider-side identity of the mailbox (Gmail emailAddress, Graph user id, Resend domain). */
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId), index("accounts_external_idx").on(t.provider, t.externalId)],
);

export const identities = pgTable(
  "identities",
  {
    id: id(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    displayName: text("display_name"),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [uniqueIndex("identities_account_address_idx").on(t.accountId, sql`lower(${t.address})`)],
);

export const threads = pgTable(
  "threads",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull().default(""),
    normalizedSubject: text("normalized_subject").notNull().default(""),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull(),
    category: text("category").$type<Category>().notNull().default("primary"),
    categoryConfidence: real("category_confidence"),
    /** heuristic | ai | user | sender_rule | default */
    categorySource: text("category_source").notNull().default("default"),
    isRead: boolean("is_read").notNull().default(false),
    folder: text("folder").$type<VirtualFolder>().notNull().default("inbox"),
    /** AI categorization failed or hasn't run yet; retried by the worker. */
    aiPending: boolean("ai_pending").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("threads_user_folder_time_idx").on(t.userId, t.folder, t.lastMessageAt),
    index("threads_ai_pending_idx").on(t.aiPending),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The account the message was first seen in. All accounts are in message_accounts. */
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    providerThreadId: text("provider_thread_id"),
    /** Normalized `Message-ID` header. */
    rfcMessageId: text("rfc_message_id"),
    dedupeKey: text("dedupe_key").notNull(),
    inReplyTo: text("in_reply_to"),
    references: jsonb("references").$type<string[]>().notNull().default([]),
    from: jsonb("from").$type<Address>().notNull(),
    to: jsonb("to").$type<Address[]>().notNull().default([]),
    cc: jsonb("cc").$type<Address[]>().notNull().default([]),
    bcc: jsonb("bcc").$type<Address[]>().notNull().default([]),
    replyTo: jsonb("reply_to").$type<Address[]>().notNull().default([]),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    /** Object storage key of the encrypted body. */
    bodyRef: text("body_ref"),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    attachments: jsonb("attachments").$type<AttachmentMeta[]>().notNull().default([]),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    folder: text("folder").$type<VirtualFolder>().notNull().default("inbox"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_user_dedupe_idx").on(t.userId, t.dedupeKey),
    index("messages_thread_idx").on(t.threadId, t.sentAt),
    index("messages_user_rfc_idx").on(t.userId, t.rfcMessageId),
    index("messages_provider_thread_idx").on(t.accountId, t.providerThreadId),
  ],
);

/** Every account a (deduped) message landed in, with that account's provider id. */
export const messageAccounts = pgTable(
  "message_accounts",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    folder: text("folder").$type<VirtualFolder>().notNull().default("inbox"),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.accountId] }),
    uniqueIndex("message_accounts_provider_idx").on(t.accountId, t.providerMessageId),
  ],
);

export const labels = pgTable(
  "labels",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").$type<Color>().notNull().default("gray"),
    description: text("description"),
    sourceTemplate: text("source_template"),
    /** AI never applies this label when false. */
    aiEnabled: boolean("ai_enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("labels_user_name_idx").on(t.userId, sql`lower(${t.name})`)],
);

export const messageLabels = pgTable(
  "message_labels",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    source: text("source").$type<"ai" | "user">().notNull(),
    confidence: real("confidence"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.labelId] }), index("message_labels_label_idx").on(t.labelId)],
);

export const corrections = pgTable(
  "corrections",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    kind: text("kind").$type<"category" | "label">().notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    /** Snapshot so corrections stay useful as few-shot examples after the message is gone. */
    sender: text("sender").notNull().default(""),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("corrections_user_time_idx").on(t.userId, t.createdAt)],
);

/** Learned "always use this category for this sender" rules. */
export const senderRules = pgTable(
  "sender_rules",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sender: text("sender").notNull(),
    category: text("category").$type<Category>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.sender] })],
);

export const contactsLastIdentity = pgTable(
  "contacts_last_identity",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactAddress: text("contact_address").notNull(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    useCount: integer("use_count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.userId, t.contactAddress] })],
);

export type UserRow = typeof users.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type IdentityRow = typeof identities.$inferSelect;
export type ThreadRow = typeof threads.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type LabelRow = typeof labels.$inferSelect;
