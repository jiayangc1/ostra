import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthExpiredError, CursorInvalidError } from "@ostra/core";
import type { ImapFlow } from "imapflow";
import { FakeImapFlow, FakeServer } from "./fake-imap.ts";
import { ImapProvider, chooseMailboxes, decodeId, encodeId, toSequenceSet, type ImapCredentials } from "./provider.ts";

const creds: ImapCredentials = {
  address: "hello@acme.dev",
  displayName: "Acme",
  imap: { host: "imap.acme.dev", port: 993, secure: true, user: "hello@acme.dev", pass: "pw" },
  smtp: { host: "smtp.acme.dev", port: 465, secure: true, user: "hello@acme.dev", pass: "pw" },
};

const eml = (id: string, subject: string, extra = "") =>
  `From: Ada <ada@example.org>\r\nTo: hello@acme.dev\r\nSubject: ${subject}\r\nMessage-ID: <${id}>\r\nDate: Thu, 01 Oct 2026 10:00:00 +0000\r\n${extra}\r\nBody of ${subject}\r\n`;

function setup() {
  const server = new FakeServer().addBox("INBOX").addBox("Sent", "\\Sent").addBox("Junk", "\\Junk").addBox("Trash", "\\Trash");
  const sent: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
  const provider = new ImapProvider(creds, {
    imapFactory: () => new FakeImapFlow(server) as unknown as ImapFlow,
    smtpFactory: () => ({ sendMail: async (o) => void sent.push(o), verify: async () => true }),
  });
  return { server, provider, sent };
}

async function syncAll(p: ImapProvider) {
  let cursor: string | null = null;
  const messages = [];
  for (;;) {
    const b = await p.initialSync(cursor);
    messages.push(...b.messages);
    cursor = b.cursor;
    if (!b.hasMore) return { messages, cursor };
  }
}

test("helpers: ids, sequence sets, mailbox choice", () => {
  assert.deepEqual(decodeId(encodeId("INBOX/Sub:folder", 7n, 42)), { uidValidity: "7", uid: 42, path: "INBOX/Sub:folder" });
  assert.equal(toSequenceSet([5, 1, 2, 3, 9, 10]), "1:3,5,9:10");
  const boxes = chooseMailboxes([
    { path: "INBOX", delimiter: "/", flags: new Set() },
    { path: "[Gmail]/All Mail", specialUse: "\\All", delimiter: "/", flags: new Set() },
    { path: "Sent Items", delimiter: "/", flags: new Set() },
    { path: "[Gmail]/Sent Mail", specialUse: "\\Sent", delimiter: "/", flags: new Set() },
    { path: "Clients", delimiter: "/", flags: new Set() },
  ]);
  assert.equal(boxes.get("sent"), "[Gmail]/Sent Mail");
  assert.equal(boxes.has("archive"), false, "neither All Mail nor user folders count as archive");
});

test("initial sync walks each mailbox and maps folders", async () => {
  const { server, provider } = setup();
  server.deliver("INBOX", eml("a@x", "Hello"));
  server.deliver("INBOX", eml("b@x", "Read one"), ["\\Seen"]);
  server.deliver("Junk", eml("c@x", "Win a prize"));
  const { messages } = await syncAll(provider);
  assert.deepEqual(messages.map((m) => [m.subject, m.folder, m.isRead]), [
    ["Hello", "inbox", false],
    ["Read one", "inbox", true],
    ["Win a prize", "spam", false],
  ]);
  assert.equal(messages[0]!.rfcMessageId, "a@x");
});

test("incremental sync: new mail, read-state changes, deletions", async () => {
  const { server, provider } = setup();
  const u1 = server.deliver("INBOX", eml("a@x", "One"));
  server.deliver("INBOX", eml("b@x", "Two"));
  const { cursor } = await syncAll(provider);

  server.boxes.get("INBOX")!.messages.find((m) => m.uid === u1)!.flags.add("\\Seen");
  server.boxes.get("INBOX")!.messages = server.boxes.get("INBOX")!.messages.filter((m) => m.uid !== 2);
  server.deliver("INBOX", eml("c@x", "Three"));

  const b = await provider.incrementalSync(cursor);
  assert.deepEqual(b.messages.map((m) => m.subject), ["Three"]);
  assert.deepEqual(b.updates, [{ providerMessageId: encodeId("INBOX", 1n, u1), isRead: true }]);
  assert.deepEqual(b.deleted, [encodeId("INBOX", 1n, 2)]);

  const again = await provider.incrementalSync(b.cursor);
  assert.equal(again.messages.length + again.updates.length + again.deleted.length, 0, "nothing changes twice");
});

test("UIDVALIDITY change invalidates the cursor", async () => {
  const { server, provider } = setup();
  server.deliver("INBOX", eml("a@x", "One"));
  const { cursor } = await syncAll(provider);
  server.boxes.get("INBOX")!.uidValidity = 99n;
  await assert.rejects(provider.incrementalSync(cursor), CursorInvalidError);
});

test("actions: flags, and moves that return the new UID (archive created on demand)", async () => {
  const { server, provider } = setup();
  const uid = server.deliver("INBOX", eml("a@x", "One"));
  const id = encodeId("INBOX", 1n, uid);
  await provider.applyAction(id, { type: "markRead" });
  assert.ok(server.boxes.get("INBOX")!.messages[0]!.flags.has("\\Seen"));
  const moved = await provider.applyAction(id, { type: "archive" });
  assert.ok(server.boxes.has("Archive"));
  assert.equal(moved && moved.providerMessageId, encodeId("Archive", 1n, 1));
  const back = await provider.applyAction(moved!.providerMessageId!, { type: "move", folder: "inbox" });
  assert.equal(back && decodeId(back.providerMessageId!).path, "INBOX");
});

test("send goes over SMTP with bcc in the envelope only, then files a copy in Sent", async () => {
  const { server, provider, sent } = setup();
  const r = await provider.send(
    { to: [{ address: "jane@fund.vc" }], cc: [], bcc: [{ address: "cfo@acme.dev" }], subject: "Deck", bodyText: "Attached." },
    { address: "hello@acme.dev", displayName: "Acme" },
  );
  assert.deepEqual(sent[0]!.envelope, { from: "hello@acme.dev", to: ["jane@fund.vc", "cfo@acme.dev"] });
  assert.ok(!sent[0]!.raw.toString().includes("cfo@acme.dev"));
  assert.equal(server.appended[0]!.path, "Sent");
  assert.equal(decodeId(r.providerMessageId).path, "Sent");
  assert.match(r.rfcMessageId, /@acme\.dev$/);
});

test("rejected credentials surface as AuthExpiredError during sync and a readable error on connect", async () => {
  const { server, provider } = setup();
  server.rejectAuth = true;
  await assert.rejects(provider.initialSync(null), AuthExpiredError);
  await assert.rejects(provider.connect(), /rejected that username or password/);
});
