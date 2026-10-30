import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AuthExpiredError, CursorInvalidError } from "@ostra/core";
import { parseMime } from "@ostra/core/mime";
import { GmailProvider, googleAuthUrl, type GmailCredentials } from "./provider.ts";

const fx = JSON.parse(readFileSync(new URL("./fixtures/gmail.json", import.meta.url), "utf8"));

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function setup(overrides: Record<string, (url: URL) => Response> = {}) {
  const calls: Call[] = [];
  const saved: GmailCredentials[] = [];
  const f = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ method: init.method ?? "GET", url: url.pathname + url.search, body: init.body ? safeJson(String(init.body)) : null });
    for (const [pattern, handler] of Object.entries(overrides)) if (url.pathname.endsWith(pattern)) return handler(url);
    const p = url.pathname.replace("/gmail/v1/users/me", "");
    if (p === "/profile") return Response.json(fx.profile);
    if (p === "/settings/sendAs") return Response.json(fx.sendAs);
    if (p === "/messages") return Response.json(fx.list);
    if (p.startsWith("/messages/") && url.searchParams.get("format") === "raw") {
      const id = p.split("/")[2]!;
      return fx[id] ? Response.json(fx[id]) : Response.json({ error: { message: "Not Found" } }, { status: 404 });
    }
    if (p === "/history") return Response.json(fx.history);
    if (p === "/messages/send") return Response.json({ id: "sent1", threadId: "t2" });
    if (p.endsWith("/modify") || p.endsWith("/trash") || p.endsWith("/untrash")) return Response.json({});
    if (p === "/watch") return Response.json({ historyId: "1000", expiration: "1800000000000" });
    return new Response("unexpected " + p, { status: 500 });
  }) as typeof fetch;
  const provider = new GmailProvider(
    { email: "sam@gmail.com", tokens: { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3_600_000 } },
    { clientId: "cid", clientSecret: "cs", pubsubTopic: "projects/p/topics/ostra", save: async (c) => void saved.push(c), fetch: f },
  );
  return { provider, calls, saved };
}

test("auth URL asks for offline access with PKCE", () => {
  const u = new URL(googleAuthUrl({ clientId: "cid", redirectUri: "https://api/cb", state: "s", codeChallenge: "c" }));
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.match(u.searchParams.get("scope")!, /gmail\.modify/);
});

test("connect returns the address plus verified send-as aliases", async () => {
  const { provider } = setup();
  const r = await provider.connect();
  assert.deepEqual(r.identities, [
    { address: "sam@gmail.com", displayName: "Sam Rivera" },
    { address: "sam@tidepool.dev", displayName: "Sam at Tidepool" },
  ]);
});

test("initial sync normalizes raw messages with labels mapped to folders", async () => {
  const { provider } = setup();
  const b = await provider.initialSync(null);
  assert.equal(b.hasMore, false);
  assert.deepEqual(JSON.parse(b.cursor), { v: 1, historyId: "1000" });
  const [nl, reply] = b.messages;
  assert.equal(nl!.providerMessageId, "m1");
  assert.equal(nl!.providerThreadId, "t1");
  assert.equal(nl!.folder, "inbox");
  assert.equal(nl!.isRead, false);
  assert.equal(nl!.headers["list-unsubscribe"]?.includes("weekly.dev"), true);
  assert.equal(reply!.isRead, true);
  assert.equal(reply!.inReplyTo, "deck-1@acme.dev");
});

test("incremental sync turns history into new messages, label updates and deletions (drafts skipped)", async () => {
  const { provider } = setup();
  const b = await provider.incrementalSync(JSON.stringify({ v: 1, historyId: "1000" }));
  assert.deepEqual(b.messages.map((m) => m.providerMessageId), ["m3"]);
  assert.deepEqual(b.updates, [
    { providerMessageId: "m1", isRead: true, folder: "archive" },
    { providerMessageId: "m2", isRead: true, folder: "spam" },
  ]);
  assert.deepEqual(b.deleted, ["m9"]);
  assert.deepEqual(JSON.parse(b.cursor), { v: 1, historyId: "1005" });
});

test("an expired historyId asks for a full resync", async () => {
  const { provider } = setup({ "/history": () => Response.json({ error: { message: "Requested entity was not found." } }, { status: 404 }) });
  await assert.rejects(provider.incrementalSync(JSON.stringify({ v: 1, historyId: "1" })), CursorInvalidError);
});

test("actions map onto label changes", async () => {
  const { provider, calls } = setup();
  await provider.applyAction("m1", { type: "archive" });
  await provider.applyAction("m1", { type: "spam" });
  await provider.applyAction("m1", { type: "markRead" });
  await provider.applyAction("m1", { type: "trash" });
  const modifies = calls.filter((c) => c.url.endsWith("/modify")).map((c) => c.body);
  assert.deepEqual(modifies, [
    { addLabelIds: [], removeLabelIds: ["INBOX", "SPAM", "TRASH"] },
    { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    { addLabelIds: [], removeLabelIds: ["UNREAD"] },
  ]);
  assert.ok(calls.some((c) => c.method === "POST" && c.url.endsWith("/messages/m1/trash")));
});

test("send posts raw MIME into the right thread", async () => {
  const { provider, calls } = setup();
  const r = await provider.send(
    { to: [{ address: "jane@fund.vc" }], cc: [], bcc: [], subject: "Re: Deck", bodyText: "Thursday.", inReplyTo: "reply-1@fund.vc", providerThreadId: "t2" },
    { address: "sam@tidepool.dev", displayName: "Sam" },
  );
  const body = calls.find((c) => c.url.endsWith("/messages/send"))!.body as { raw: string; threadId: string };
  assert.equal(body.threadId, "t2");
  const parsed = await parseMime(Buffer.from(body.raw, "base64url"), { providerMessageId: "x", folder: "sent", isRead: true });
  assert.equal(parsed.from.address, "sam@tidepool.dev");
  assert.equal(parsed.inReplyTo, "reply-1@fund.vc");
  assert.equal(r.providerMessageId, "sent1");
});

test("watch registers push on the Pub/Sub topic", async () => {
  const { provider, calls } = setup();
  const sub = await provider.subscribe();
  assert.equal(sub.resourceId, "sam@gmail.com");
  assert.equal(sub.expiresAt, new Date(1800000000000).toISOString());
  assert.equal((calls.find((c) => c.url.endsWith("/watch"))!.body as { topicName: string }).topicName, "projects/p/topics/ostra");
});

test("revoked access surfaces as AuthExpiredError", async () => {
  const { provider } = setup({
    "/profile": () => new Response("", { status: 401 }),
    "/token": () => Response.json({ error: "invalid_grant" }, { status: 400 }),
  });
  await assert.rejects(provider.initialSync(null), AuthExpiredError);
});

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
