import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OutlookProvider, microsoftAuthUrl } from "./provider.ts";

const eml = (name: string) => readFileSync(new URL(`../../core/src/node/fixtures/${name}`, import.meta.url));
const recent = new Date(Date.now() - 60_000).toISOString();
const old = "2026-01-01T00:00:00Z";

/** Graph-shaped responses, keyed by path. Delta pages chain through nextLink → deltaLink. */
function graph(overrides: Record<string, unknown> = {}) {
  const calls: { method: string; path: string; body: string | null; headers: Record<string, string> }[] = [];
  const routes: Record<string, unknown> = {
    "/v1.0/me": { id: "u1", mail: null, userPrincipalName: "sam@northwind.io", displayName: "Sam Rivera" },
    "/v1.0/me/mailFolders/archive": { status: 404 },
    "/v1.0/me/mailFolders/inbox/messages/delta": { value: [{ id: "A1", conversationId: "c1", isRead: false, receivedDateTime: old }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/page2" },
    "/v1.0/page2": { value: [{ id: "A2", conversationId: "c2", isRead: true, receivedDateTime: old }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta/inbox?token=1" },
    "/v1.0/delta/inbox": {
      value: [
        { id: "A1", isRead: true, receivedDateTime: old },
        { id: "N1", conversationId: "c3", isRead: false, receivedDateTime: recent },
        { id: "A2", "@removed": { reason: "deleted" } },
        { id: "GONE", "@removed": { reason: "deleted" } },
      ],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta/inbox?token=2",
    },
    "/v1.0/delta/junkemail": { value: [{ id: "A2", isRead: true, receivedDateTime: old }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta/junkemail?token=2" },
    ...overrides,
  };
  const f = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: init.method ?? "GET", path: url.pathname, body: init.body ? String(init.body) : null, headers });
    if (url.pathname.endsWith("/$value")) return new Response(eml(url.pathname.includes("N1") ? "reply-with-attachment.eml" : "newsletter.eml"));
    if (url.pathname.startsWith("/v1.0/me/mailFolders/") && !url.pathname.includes("/messages")) {
      return url.pathname.endsWith("archive") ? Response.json({ error: { message: "nope" } }, { status: 404 }) : Response.json({ id: "f" });
    }
    if (url.pathname.match(/mailFolders\/\w+\/messages\/delta$/) && !routes[url.pathname]) return Response.json({ value: [], "@odata.deltaLink": `https://graph.microsoft.com/v1.0/delta/${url.pathname.split("/")[4]}?token=1` });
    if (url.pathname.startsWith("/v1.0/delta/") && !routes[url.pathname]) return Response.json({ value: [], "@odata.deltaLink": `https://graph.microsoft.com${url.pathname}?token=2` });
    if (url.pathname.endsWith("/move")) return Response.json({ id: "MOVED" });
    if (url.pathname === "/v1.0/me/sendMail") return new Response(null, { status: 202 });
    if (url.pathname === "/v1.0/subscriptions") return Response.json({ id: "sub1", expirationDateTime: "2026-11-01T00:00:00Z" });
    const r = routes[url.pathname];
    if (r) return Response.json(r);
    if (init.method === "PATCH") return Response.json({});
    return new Response("unexpected " + url.pathname, { status: 500 });
  }) as typeof fetch;
  const provider = new OutlookProvider(
    { email: "sam@northwind.io", tokens: { accessToken: "at", refreshToken: "rt", expiresAt: Date.now() + 3_600_000 } },
    { clientId: "c", clientSecret: "s", tenant: "common", save: async () => {}, notificationUrl: "https://api.ostramail.com/webhooks/graph", clientState: "secret-state", fetch: f },
  );
  return { provider, calls };
}

async function syncAll(p: OutlookProvider) {
  let cursor: string | null = null;
  const messages = [];
  for (;;) {
    const b = await p.initialSync(cursor);
    messages.push(...b.messages);
    cursor = b.cursor;
    if (!b.hasMore) return { messages, cursor };
  }
}

test("auth URL requests offline mail scopes with PKCE", () => {
  const u = new URL(microsoftAuthUrl({ clientId: "c", tenant: "common", redirectUri: "https://x/cb", state: "s", codeChallenge: "cc" }));
  assert.match(u.searchParams.get("scope")!, /offline_access.*Mail\.ReadWrite.*Mail\.Send/);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
});

test("connect falls back to the UPN when mail is empty", async () => {
  const { provider } = graph();
  assert.deepEqual((await provider.connect()).identities, [{ address: "sam@northwind.io", displayName: "Sam Rivera" }]);
});

test("initial sync pages each folder's delta with immutable ids and skips a missing Archive", async () => {
  const { provider, calls } = graph();
  const { messages } = await syncAll(provider);
  assert.deepEqual(messages.map((m) => [m.providerMessageId, m.folder, m.isRead]), [
    ["A1", "inbox", false],
    ["A2", "inbox", true],
  ]);
  assert.equal(messages[0]!.providerThreadId, "c1");
  assert.match(calls.find((c) => c.path.endsWith("/delta"))!.headers.Prefer!, /ImmutableId/);
});

test("incremental: new mail fetched as MIME, changes as updates, moves aren't deletions", async () => {
  const { provider } = graph();
  const { cursor } = await syncAll(provider);
  const b = await provider.incrementalSync(JSON.stringify({ ...JSON.parse(cursor), lastRun: new Date(Date.now() - 3_600_000).toISOString() }));
  assert.deepEqual(b.messages.map((m) => m.providerMessageId), ["N1"]);
  assert.equal(b.messages[0]!.inReplyTo, "deck-1@acme.dev");
  assert.deepEqual(
    b.updates.sort((x, y) => x.providerMessageId.localeCompare(y.providerMessageId)),
    [
      { providerMessageId: "A1", isRead: true, folder: "inbox" },
      { providerMessageId: "A2", isRead: true, folder: "spam" },
    ],
  );
  assert.deepEqual(b.deleted, ["GONE"]);
});

test("actions: read state via PATCH, moves by well-known folder", async () => {
  const { provider, calls } = graph();
  await provider.applyAction("A1", { type: "markRead" });
  const moved = await provider.applyAction("A1", { type: "spam" });
  assert.deepEqual(JSON.parse(calls.find((c) => c.method === "PATCH")!.body!), { isRead: true });
  assert.deepEqual(JSON.parse(calls.find((c) => c.path.endsWith("/move"))!.body!), { destinationId: "junkemail" });
  assert.equal(moved && moved.providerMessageId, "MOVED");
});

test("send posts base64 MIME; subscriptions carry the clientState", async () => {
  const { provider, calls } = graph();
  await provider.send({ to: [{ address: "a@b.com" }], cc: [], bcc: [], subject: "Hi", bodyText: "Hello" }, { address: "sam@northwind.io", displayName: "Sam" });
  const send = calls.find((c) => c.path === "/v1.0/me/sendMail")!;
  assert.match(Buffer.from(send.body!, "base64").toString(), /Subject: Hi/);
  const sub = await provider.subscribe();
  assert.equal(sub.resourceId, "sub1");
  assert.equal(JSON.parse(calls.find((c) => c.path === "/v1.0/subscriptions")!.body!).clientState, "secret-state");
});
