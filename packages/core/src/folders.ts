import type { VirtualFolder } from "./types.ts";

/**
 * Gmail system label ids → unified folder. A message can carry several
 * labels; precedence picks the most specific one.
 */
export function gmailLabelsToFolder(labelIds: readonly string[]): VirtualFolder {
  const ids = new Set(labelIds);
  if (ids.has("TRASH")) return "trash";
  if (ids.has("SPAM")) return "spam";
  if (ids.has("DRAFT")) return "drafts";
  if (ids.has("INBOX")) return "inbox";
  if (ids.has("SENT")) return "sent";
  return "archive";
}

/** The Gmail label changes that move a message into `folder`. */
export function gmailFolderLabelDelta(folder: VirtualFolder): { add: string[]; remove: string[] } {
  switch (folder) {
    case "inbox":
      return { add: ["INBOX"], remove: ["SPAM", "TRASH"] };
    case "archive":
      return { add: [], remove: ["INBOX", "SPAM", "TRASH"] };
    case "spam":
      return { add: ["SPAM"], remove: ["INBOX"] };
    case "trash":
      return { add: ["TRASH"], remove: ["INBOX"] };
    default:
      return { add: [], remove: [] };
  }
}

const OUTLOOK_WELL_KNOWN: Record<string, VirtualFolder> = {
  inbox: "inbox",
  sentitems: "sent",
  drafts: "drafts",
  junkemail: "spam",
  deleteditems: "trash",
  archive: "archive",
};

const OUTLOOK_DISPLAY: Record<string, VirtualFolder> = {
  inbox: "inbox",
  "sent items": "sent",
  drafts: "drafts",
  "junk email": "spam",
  "deleted items": "trash",
  archive: "archive",
};

/** Outlook / Graph folder (well-known name or display name) → unified folder. Custom folders are treated as archive. */
export function outlookFolderToVirtual(folder: { wellKnownName?: string | null; displayName?: string | null }): VirtualFolder {
  const wk = folder.wellKnownName?.toLowerCase();
  if (wk && OUTLOOK_WELL_KNOWN[wk]) return OUTLOOK_WELL_KNOWN[wk];
  const dn = folder.displayName?.toLowerCase().trim();
  if (dn && OUTLOOK_DISPLAY[dn]) return OUTLOOK_DISPLAY[dn];
  return "archive";
}

export const OUTLOOK_FOLDER_FOR: Partial<Record<VirtualFolder, string>> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  spam: "junkemail",
  trash: "deleteditems",
  archive: "archive",
};

const IMAP_SPECIAL_USE: Record<string, VirtualFolder> = {
  "\\inbox": "inbox",
  "\\sent": "sent",
  "\\drafts": "drafts",
  "\\junk": "spam",
  "\\trash": "trash",
  "\\archive": "archive",
  "\\all": "archive",
};

const IMAP_NAMES: Record<string, VirtualFolder> = {
  inbox: "inbox",
  sent: "sent",
  "sent items": "sent",
  "sent messages": "sent",
  "sent mail": "sent",
  drafts: "drafts",
  draft: "drafts",
  spam: "spam",
  junk: "spam",
  "junk e-mail": "spam",
  "junk email": "spam",
  "bulk mail": "spam",
  trash: "trash",
  bin: "trash",
  "deleted items": "trash",
  "deleted messages": "trash",
  archive: "archive",
  archives: "archive",
  "all mail": "archive",
};

/**
 * IMAP mailbox → unified folder. Prefers RFC 6154 SPECIAL-USE flags, then
 * well-known names (including `[Gmail]/...` and `INBOX.Sent` style paths).
 * Anything else is a user folder and maps to archive.
 */
export function imapMailboxToFolder(mailbox: { path: string; specialUse?: string | null; delimiter?: string | null }): VirtualFolder {
  const su = mailbox.specialUse?.toLowerCase();
  if (su && IMAP_SPECIAL_USE[su]) return IMAP_SPECIAL_USE[su];
  if (mailbox.path.toUpperCase() === "INBOX") return "inbox";
  const delimiter = mailbox.delimiter || "/";
  const leaf = mailbox.path.split(delimiter).pop()?.toLowerCase().trim() ?? "";
  return IMAP_NAMES[leaf] ?? "archive";
}
