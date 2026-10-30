import type { Account, Label, LabelTemplate, ThreadSummary, UserSettings } from "@ostra/core";

export interface IdentityDto {
  id: string;
  accountId: string;
  address: string;
  displayName: string | null;
  isDefault: boolean;
}

export interface Bootstrap {
  user: { id: string; email: string; name: string | null };
  settings: UserSettings;
  accounts: Account[];
  identities: IdentityDto[];
  labels: Label[];
  counts: Record<string, number>;
  ai: { available: boolean };
  templates: LabelTemplate[];
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextCursor: string | null;
}

export type ThreadActionName = "archive" | "trash" | "spam" | "inbox" | "markRead" | "markUnread";

export type ServerEvent =
  | { type: "ready" }
  | { type: "pong" }
  | { type: "thread.upsert"; thread: ThreadSummary }
  | { type: "thread.remove"; threadId: string }
  | { type: "account.update"; account: Account }
  | { type: "labels.changed" }
  | { type: "sync.done"; accountId: string; added: number };
