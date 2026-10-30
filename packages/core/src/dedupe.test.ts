import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeKey, groupDuplicates, normalizeMessageId, normalizeSubject, parseMessageIdList, threadingCandidates } from "./dedupe.ts";

const base = { from: { address: "a@x.com" }, subject: "Hi", sentAt: "2026-01-01T00:00:00.000Z" };

test("message ids normalize angle brackets and case", () => {
  assert.equal(normalizeMessageId("<CAB123@Mail.Gmail.com>"), "cab123@mail.gmail.com");
  assert.equal(normalizeMessageId("  abc@x  "), "abc@x");
  assert.equal(normalizeMessageId(""), null);
  assert.equal(normalizeMessageId("<>"), null);
  assert.equal(normalizeMessageId("has space@x"), null);
});

test("references header parses into an ordered unique list", () => {
  assert.deepEqual(parseMessageIdList("<a@x> <B@x>\r\n <a@x>"), ["a@x", "b@x"]);
  assert.deepEqual(parseMessageIdList(null), []);
});

test("the same email in two accounts dedupes on Message-ID and records both accounts", () => {
  const groups = groupDuplicates([
    { accountId: "gmail", message: { ...base, rfcMessageId: "<ID-1@x>" } },
    { accountId: "work", message: { ...base, rfcMessageId: "id-1@x" } },
    { accountId: "work", message: { ...base, rfcMessageId: "id-2@x" } },
    { accountId: "work", message: { ...base, rfcMessageId: "id-1@x" } },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]!.accountIds, ["gmail", "work"]);
  assert.deepEqual(groups[1]!.accountIds, ["work"]);
});

test("messages without a Message-ID fall back to a stable content hash", () => {
  const a = dedupeKey({ ...base, rfcMessageId: null });
  const b = dedupeKey({ ...base, rfcMessageId: null, from: { address: "A@X.com" } });
  const c = dedupeKey({ ...base, rfcMessageId: null, subject: "Other" });
  assert.match(a, /^hash:[0-9a-f]{16}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("subjects normalize reply/forward prefixes", () => {
  assert.equal(normalizeSubject("Re: RE: Fwd:  Launch plan"), "launch plan");
  assert.equal(normalizeSubject("AW: Angebot"), "angebot");
});

test("threading candidates put In-Reply-To first", () => {
  assert.deepEqual(threadingCandidates({ inReplyTo: "<c@x>", references: ["<a@x>", "<c@x>"] }), ["c@x", "a@x"]);
});
