import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRawMessage } from "./compose.ts";
import { parseMime } from "./mime.ts";

test("composed messages round-trip through the parser with threading headers and no Bcc", async () => {
  const built = await buildRawMessage(
    {
      to: [{ name: "Doe, Jane", address: "jane@fund.vc" }],
      cc: [],
      bcc: [{ address: "secret@acme.dev" }],
      subject: "Re: Seed round deck",
      bodyText: "Thursday works.",
      inReplyTo: "reply-1@fund.vc",
      references: ["intro-0@fund.vc", "<reply-1@fund.vc>"],
      attachments: [{ filename: "a.txt", contentType: "text/plain", content: Buffer.from("hi").toString("base64") }],
    },
    { address: "hello@acme.dev", displayName: "Acme" },
  );
  assert.match(built.rfcMessageId, /@acme\.dev$/);
  assert.deepEqual(built.recipients, ["jane@fund.vc", "secret@acme.dev"]);
  assert.ok(!built.raw.toString().toLowerCase().includes("secret@acme.dev"), "bcc is not in the headers");
  const m = await parseMime(built.raw, { providerMessageId: "x", folder: "sent", isRead: true });
  assert.equal(m.rfcMessageId, built.rfcMessageId);
  assert.equal(m.inReplyTo, "reply-1@fund.vc");
  assert.deepEqual(m.references, ["intro-0@fund.vc", "reply-1@fund.vc"]);
  assert.deepEqual(m.from, { name: "Acme", address: "hello@acme.dev" });
  assert.equal(m.bodyText?.trim(), "Thursday works.");
  assert.equal(m.attachments[0]?.filename, "a.txt");
});
