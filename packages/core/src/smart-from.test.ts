import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseFromIdentity, domainMismatch } from "./smart-from.ts";
import type { Identity } from "./types.ts";

const ids: Identity[] = [
  { id: "personal", accountId: "gmail", address: "me@gmail.com", displayName: "Me", isDefault: true },
  { id: "hello", accountId: "startup", address: "hello@acme.dev", displayName: "Acme", isDefault: true },
  { id: "support", accountId: "startup", address: "support@acme.dev", displayName: "Acme Support", isDefault: false },
  { id: "work", accountId: "outlook", address: "me@bigco.com", displayName: "Me", isDefault: true },
];

const base = { identities: ids, recipients: [], lastIdentityByContact: new Map<string, string>(), defaultIdentityId: "personal" };

test("rule 1: a reply uses the identity the original was addressed to", () => {
  const r = chooseFromIdentity({
    ...base,
    original: { to: [{ address: "Support@Acme.dev" }], cc: [], accountIds: ["startup"] },
    recipients: ["customer@client.com"],
  });
  assert.deepEqual(r, { identityId: "support", reason: "reply" });
});

test("rule 1: cc'd identities count, and Delivered-To wins for BCC'd mail", () => {
  assert.equal(
    chooseFromIdentity({ ...base, original: { to: [{ address: "x@y.com" }], cc: [{ address: "me@bigco.com" }], accountIds: ["outlook"] } }).identityId,
    "work",
  );
  assert.equal(
    chooseFromIdentity({ ...base, original: { to: [{ address: "list@y.com" }], cc: [], deliveredTo: "hello@acme.dev", accountIds: ["startup"] } }).identityId,
    "hello",
  );
});

test("rule 1: unknown alias replies come from the receiving account's default identity", () => {
  const r = chooseFromIdentity({ ...base, original: { to: [{ address: "founders@acme.dev" }], cc: [], accountIds: ["startup"] } });
  assert.deepEqual(r, { identityId: "hello", reason: "reply" });
});

test("rule 2: a new email uses the identity last used with that contact", () => {
  const r = chooseFromIdentity({
    ...base,
    recipients: ["Investor@Fund.vc"],
    lastIdentityByContact: new Map([["investor@fund.vc", "hello"]]),
  });
  assert.deepEqual(r, { identityId: "hello", reason: "contact" });
});

test("rule 3: otherwise the default identity", () => {
  assert.deepEqual(chooseFromIdentity({ ...base, recipients: ["new@person.com"] }), { identityId: "personal", reason: "default" });
  assert.deepEqual(chooseFromIdentity({ ...base, defaultIdentityId: "deleted" }), { identityId: "personal", reason: "fallback" });
  assert.deepEqual(chooseFromIdentity({ ...base, identities: [] }), { identityId: null, reason: "fallback" });
});

test("domain mismatch spots a recipient on a domain you own under another identity", () => {
  const m = domainMismatch(ids[0]!, ids, ["cto@acme.dev"]);
  assert.equal(m?.identity.id, "hello");
  assert.equal(domainMismatch(ids[1]!, ids, ["cto@acme.dev"]), null);
  assert.equal(domainMismatch(ids[1]!, ids, ["friend@gmail.com"]), null);
});
