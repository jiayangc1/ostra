import { test } from "node:test";
import assert from "node:assert/strict";
import { gmailFolderLabelDelta, gmailLabelsToFolder, imapMailboxToFolder, outlookFolderToVirtual } from "./folders.ts";

test("gmail labels map to unified folders with trash/spam precedence", () => {
  assert.equal(gmailLabelsToFolder(["INBOX", "UNREAD", "CATEGORY_UPDATES"]), "inbox");
  assert.equal(gmailLabelsToFolder(["SPAM", "INBOX"]), "spam");
  assert.equal(gmailLabelsToFolder(["TRASH", "SPAM"]), "trash");
  assert.equal(gmailLabelsToFolder(["SENT"]), "sent");
  assert.equal(gmailLabelsToFolder(["SENT", "INBOX"]), "inbox");
  assert.equal(gmailLabelsToFolder(["DRAFT"]), "drafts");
  assert.equal(gmailLabelsToFolder(["Label_12", "IMPORTANT"]), "archive");
});

test("gmail folder label delta", () => {
  assert.deepEqual(gmailFolderLabelDelta("archive"), { add: [], remove: ["INBOX", "SPAM", "TRASH"] });
  assert.deepEqual(gmailFolderLabelDelta("spam"), { add: ["SPAM"], remove: ["INBOX"] });
});

test("outlook folders map by well-known name, then display name", () => {
  assert.equal(outlookFolderToVirtual({ wellKnownName: "junkemail" }), "spam");
  assert.equal(outlookFolderToVirtual({ displayName: "Junk Email" }), "spam");
  assert.equal(outlookFolderToVirtual({ wellKnownName: "deleteditems" }), "trash");
  assert.equal(outlookFolderToVirtual({ displayName: "Sent Items" }), "sent");
  assert.equal(outlookFolderToVirtual({ displayName: "Projects" }), "archive");
});

test("imap mailboxes map by special-use, then name", () => {
  assert.equal(imapMailboxToFolder({ path: "INBOX" }), "inbox");
  assert.equal(imapMailboxToFolder({ path: "Whatever", specialUse: "\\Junk" }), "spam");
  assert.equal(imapMailboxToFolder({ path: "[Gmail]/Sent Mail", delimiter: "/" }), "sent");
  assert.equal(imapMailboxToFolder({ path: "INBOX.Trash", delimiter: "." }), "trash");
  assert.equal(imapMailboxToFolder({ path: "Deleted Messages" }), "trash");
  assert.equal(imapMailboxToFolder({ path: "Clients/Acme" }), "archive");
});
