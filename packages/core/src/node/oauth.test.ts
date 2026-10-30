import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthExpiredError, RateLimitedError } from "../provider.ts";
import { OAuthSession, type OAuthTokens } from "./oauth.ts";

const cfg = { tokenUrl: "https://auth.example/token", clientId: "id", clientSecret: "secret" };

function fakeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return (async (url: string, init: RequestInit) => handler(String(url), init)) as typeof fetch;
}

test("refreshes expired tokens before the call and saves rotated tokens", async () => {
  const saved: OAuthTokens[] = [];
  const seen: string[] = [];
  const f = fakeFetch((url, init) => {
    if (url === cfg.tokenUrl) return Response.json({ access_token: "new", refresh_token: "r2", expires_in: 3600 });
    seen.push(String((init.headers as Record<string, string>).Authorization));
    return Response.json({ ok: true });
  });
  const s = new OAuthSession({ accessToken: "old", refreshToken: "r1", expiresAt: Date.now() - 1 }, cfg, async (t) => void saved.push(t), f);
  assert.deepEqual(await s.json("https://api.example/x"), { ok: true });
  assert.deepEqual(seen, ["Bearer new"]);
  assert.equal(saved[0]!.refreshToken, "r2");
});

test("a 401 triggers one refresh and retry", async () => {
  let calls = 0;
  const f = fakeFetch((url) => {
    if (url === cfg.tokenUrl) return Response.json({ access_token: "fresh", expires_in: 3600 });
    return ++calls === 1 ? new Response("", { status: 401 }) : Response.json({ ok: 1 });
  });
  const s = new OAuthSession({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, cfg, async () => {}, f);
  assert.deepEqual(await s.json("https://api.example/x"), { ok: 1 });
});

test("revoked refresh tokens become AuthExpiredError; 429 becomes RateLimitedError with Retry-After", async () => {
  const revoked = fakeFetch((url) => (url === cfg.tokenUrl ? Response.json({ error: "invalid_grant" }, { status: 400 }) : new Response("", { status: 401 })));
  const s1 = new OAuthSession({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, cfg, async () => {}, revoked);
  await assert.rejects(s1.json("https://api.example/x"), AuthExpiredError);

  const throttled = fakeFetch(() => new Response("", { status: 429, headers: { "retry-after": "7" } }));
  const s2 = new OAuthSession({ accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3_600_000 }, cfg, async () => {}, throttled);
  await assert.rejects(s2.json("https://api.example/x"), (e: unknown) => e instanceof RateLimitedError && e.retryAfterMs === 7000);
});
