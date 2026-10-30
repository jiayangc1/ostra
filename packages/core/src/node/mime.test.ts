import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mimeAttachment, parseMime } from "./mime.ts";

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

test("newsletter: decodes subject, keeps bulk headers, prefers text body", async () => {
  const m = await parseMime(await fixture("newsletter.eml"), { providerMessageId: "INBOX:1:7", folder: "inbox", isRead: false });
  assert.equal(m.subject, "Issue 42: Edge functions ⚡");
  assert.deepEqual(m.from, { name: "Weekly Dev", address: "hello@weekly.dev" });
  assert.equal(m.rfcMessageId, "issue42.abc@mail.weekly.dev");
  assert.match(m.headers["list-unsubscribe"]!, /weekly\.dev\/u\/abc/);
  assert.equal(m.headers["precedence"], "bulk");
  assert.equal(m.headers["delivered-to"], "me@acme.dev");
  assert.equal(m.headers["return-path"], undefined, "unneeded headers are dropped");
  assert.equal(m.snippet, "This week: edge functions, cold starts, and more.");
  assert.match(m.bodyHtml!, /<h1>This week<\/h1>/);
  assert.equal(m.sentAt, "2026-10-06T09:00:00.000Z");
});

test("reply: threading headers, quoted names, cc, attachments", async () => {
  const raw = await fixture("reply-with-attachment.eml");
  const m = await parseMime(raw, { providerMessageId: "x", folder: "inbox", isRead: true });
  assert.deepEqual(m.from, { name: "Doe, Jane", address: "jane@fund.vc" });
  assert.deepEqual(m.to, [{ name: "Founder", address: "hello@acme.dev" }]);
  assert.deepEqual(m.cc, [{ address: "partner@fund.vc" }]);
  assert.equal(m.inReplyTo, "deck-1@acme.dev");
  assert.deepEqual(m.references, ["intro-0@fund.vc", "deck-1@acme.dev"]);
  assert.equal(m.snippet, "Thanks, comments attached. Can we talk Thursday?");
  assert.equal(m.sentAt, "2026-10-07T21:30:00.000Z");
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0]!.filename, "deck-notes.pdf");
  assert.equal(m.attachments[0]!.contentType, "application/pdf");
  const bytes = await mimeAttachment(raw, 0);
  assert.equal(Buffer.from(bytes!).subarray(0, 4).toString(), "%PDF");
});

test("missing Date header falls back to the received time", async () => {
  const m = await parseMime("From: a@b.c\r\nSubject: x\r\n\r\nhi", { providerMessageId: "x", folder: "inbox", isRead: false, receivedAt: "2026-01-02T03:04:05.000Z" });
  assert.equal(m.sentAt, "2026-01-02T03:04:05.000Z");
  assert.equal(m.rfcMessageId, null);
});
