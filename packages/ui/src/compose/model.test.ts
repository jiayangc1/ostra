import { test } from "node:test";
import assert from "node:assert/strict";
import type { MessageDetail } from "@ostra/core";
import { draftFor, fullBody } from "./model.ts";

const m: MessageDetail = {
  id: "m1",
  threadId: "t1",
  accountIds: ["a"],
  rfcMessageId: "x@y",
  from: { name: "Jane Doe", address: "jane@fund.vc" },
  to: [{ address: "hello@tidepool.dev" }, { name: "Lena", address: "lena@tidepool.dev" }],
  cc: [{ address: "partner@fund.vc" }, { address: "HELLO@tidepool.dev" }],
  bcc: [],
  replyTo: [],
  subject: "Re: Deck",
  snippet: "",
  bodyText: "Looks great.\nThursday?",
  bodyHtml: null,
  attachments: [],
  sentAt: "2026-10-07T21:30:00.000Z",
  folder: "inbox",
  isRead: true,
  labels: [],
  code: null,
  events: [],
};

test("reply goes to the sender, keeps one Re:, and quotes the original", () => {
  const d = draftFor("reply", m, ["hello@tidepool.dev"]);
  assert.equal(d.to, "Jane Doe <jane@fund.vc>");
  assert.equal(d.cc, "");
  assert.equal(d.subject, "Re: Deck");
  assert.match(d.quote, /wrote:\n> Looks great\.\n> Thursday\?$/);
  assert.equal(d.replyToMessageId, "m1");
});

test("reply all adds everyone except you, without duplicates", () => {
  const d = draftFor("replyAll", m, ["hello@tidepool.dev"]);
  assert.equal(d.to, "Jane Doe <jane@fund.vc>");
  assert.equal(d.cc, "Lena <lena@tidepool.dev>, partner@fund.vc");
});

test("Reply-To wins; replying to your own message goes to its recipients", () => {
  assert.equal(draftFor("reply", { ...m, replyTo: [{ address: "list@fund.vc" }] }, []).to, "list@fund.vc");
  assert.equal(draftFor("reply", { ...m, from: { address: "hello@tidepool.dev" } }, ["hello@tidepool.dev"]).to, "Lena <lena@tidepool.dev>");
});

test("forward has no recipients and carries the message", () => {
  const d = draftFor("forward", m, []);
  assert.equal(d.to, "");
  assert.equal(d.subject, "Fwd: Re: Deck");
  assert.match(d.quote, /Forwarded message[\s\S]*Looks great/);
});

test("the sent body puts your text above the quote", () => {
  assert.equal(fullBody({ body: "Yes!  \n", quote: "> hi" }), "Yes!\n\n> hi");
  assert.equal(fullBody({ body: "Hi", quote: "" }), "Hi");
});
