import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { accounts, contactsLastIdentity, eq, identities } from "@ostra/db";
import { PROVIDER_KINDS, type ThreadSummary } from "@ostra/core";
import { createHarness, type Harness } from "../test/harness.ts";
import { msg } from "../test/fake-provider.ts";
import { ingestBatch } from "./ingest.ts";

let h: Harness;
before(async () => (h = await createHarness()));
after(() => h.close());

async function identityOf(accountId: string) {
  const [i] = await h.s.db.select().from(identities).where(eq(identities.accountId, accountId));
  return i!;
}

test("the send router delivers through the chosen identity's provider, for every provider kind", async () => {
  const user = "router";
  const u = await h.user(user);
  const accts = await Promise.all(PROVIDER_KINDS.map((provider, i) => h.addAccount(u.id, { provider, address: `me${i}@${provider}.example` })));
  for (const [i, a] of accts.entries()) {
    const identity = await identityOf(a.id);
    const res = await h.request("/api/send", {
      method: "POST",
      user,
      json: { identityId: identity.id, to: [{ address: `friend${i}@example.org` }], subject: `Hi ${i}`, bodyText: "Hello" },
    });
    assert.equal(res.status, 201);
    for (const [j, other] of accts.entries()) {
      assert.equal(h.fakes.get(other.id)!.sent.length, j <= i ? 1 : 0, `${PROVIDER_KINDS[j]} after sending via ${PROVIDER_KINDS[i]}`);
    }
    assert.equal(h.fakes.get(a.id)!.sent[0]!.identity.address, identity.address);
  }
  const sent = (await (await h.request("/api/threads?folder=sent", { user })).json()) as { threads: ThreadSummary[] };
  assert.equal(sent.threads.length, PROVIDER_KINDS.length, "sent mail shows up immediately");
});

test("replies carry In-Reply-To/References and land in the original thread", async () => {
  const user = "replier";
  const u = await h.user(user);
  const a = await h.addAccount(u.id, { address: "hello@acme.dev" });
  const [row] = await h.s.db.select().from(accounts).where(eq(accounts.id, a.id));
  const original = msg({ rfcMessageId: "orig@fund.vc", references: ["intro@fund.vc"], subject: "Deck" });
  await ingestBatch(h.s, row!, { messages: [original], updates: [], deleted: [] });
  const inbox = (await (await h.request("/api/threads?folder=inbox", { user })).json()) as { threads: ThreadSummary[] };
  const detail = (await (await h.request(`/api/threads/${inbox.threads[0]!.id}`, { user })).json()) as { messages: { id: string }[] };

  const identity = await identityOf(a.id);
  const res = await h.request("/api/send", {
    method: "POST",
    user,
    json: { identityId: identity.id, to: [{ address: "ada@example.org" }], subject: "Re: Deck", bodyText: "Thanks", replyToMessageId: detail.messages[0]!.id },
  });
  const body = (await res.json()) as { thread: ThreadSummary };
  const out = h.fakes.get(a.id)!.sent[0]!.message;
  assert.equal(out.inReplyTo, "orig@fund.vc");
  assert.deepEqual(out.references, ["intro@fund.vc", "orig@fund.vc"]);
  assert.equal(body.thread.id, inbox.threads[0]!.id);
  assert.equal(body.thread.messageCount, 2);
});

test("sending remembers the identity per contact, and refuses accounts that need reauth", async () => {
  const user = "memory";
  const u = await h.user(user);
  const a = await h.addAccount(u.id, { address: "hello@acme.dev" });
  const identity = await identityOf(a.id);
  await h.request("/api/send", { method: "POST", user, json: { identityId: identity.id, to: [{ address: "Investor@Fund.vc" }], bodyText: "Hi" } });
  const rows = await h.s.db.select().from(contactsLastIdentity).where(eq(contactsLastIdentity.userId, u.id));
  assert.deepEqual(rows.map((r) => [r.contactAddress, r.identityId]), [["investor@fund.vc", identity.id]]);

  await h.s.db.update(accounts).set({ status: "needs_reauth" }).where(eq(accounts.id, a.id));
  const res = await h.request("/api/send", { method: "POST", user, json: { identityId: identity.id, to: [{ address: "x@y.com" }], bodyText: "Hi" } });
  assert.equal(res.status, 409);
});

test("you can't send from someone else's identity", async () => {
  const owner = await h.user("owner2");
  const a = await h.addAccount(owner.id);
  const identity = await identityOf(a.id);
  const res = await h.request("/api/send", { method: "POST", user: "thief", json: { identityId: identity.id, to: [{ address: "x@y.com" }], bodyText: "Hi" } });
  assert.equal(res.status, 404);
  assert.equal(h.fakes.get(a.id)!.sent.length, 0);
});
