import type { Color, ProviderKind } from "@ostra/core";
import { COLORS } from "@ostra/core";
import { exchangeCode, pkcePair } from "@ostra/core/oauth";
import { googleAuthUrl, GOOGLE_TOKEN_URL, type GmailCredentials } from "@ostra/sync-gmail";
import { microsoftAuthUrl, msTokenUrl, MS_SCOPES, type OutlookCredentials } from "@ostra/sync-outlook";
import { accounts, and, eq, identities } from "@ostra/db";
import { Hono } from "hono";
import { z } from "zod";
import { HttpError, badRequest } from "../lib/errors.ts";
import { getAccount, setAccountStatus, toAccountDto } from "../services/accounts.ts";
import type { Services } from "../services/context.ts";
import type { AppEnv } from "./api.ts";
import { finishConnect, verifyProvider } from "./accounts-connect.ts";

type OAuthKind = Extract<ProviderKind, "gmail" | "outlook">;

interface OAuthState {
  userId: string;
  provider: OAuthKind;
  color: Color;
  verifier: string;
  returnTo: string;
  reconnectAccountId: string | null;
  exp: number;
}

const redirectUri = (s: Services, provider: OAuthKind) => `${s.config.publicUrl}/oauth/${provider}/callback`;

/** Only app-relative paths, so the callback can't be turned into an open redirect. */
const safeReturn = (p: string | undefined) => (p && /^\/[a-z0-9/_?=&-]*$/i.test(p) && !p.startsWith("//") ? p : "/settings/accounts");

function configured(s: Services, provider: OAuthKind) {
  const cfg = provider === "gmail" ? s.config.google : s.config.microsoft;
  if (!cfg) throw new HttpError(503, `${provider === "gmail" ? "Gmail" : "Outlook"} sign-in isn't configured on this server.`, "provider_unavailable");
  return cfg;
}

/** POST /api/accounts/oauth/:provider/start → the provider's consent URL. */
export function oauthStartRoutes(s: Services) {
  const r = new Hono<AppEnv>();
  r.post("/:provider/start", async (c) => {
    const provider = z.enum(["gmail", "outlook"]).safeParse(c.req.param("provider"));
    if (!provider.success) throw badRequest("Unknown provider");
    const body = z
      .object({ color: z.enum(COLORS).default("blue"), returnTo: z.string().optional(), reconnectAccountId: z.string().uuid().optional(), loginHint: z.string().email().optional() })
      .parse(await c.req.json().catch(() => ({})));
    const user = c.get("user");
    if (body.reconnectAccountId) await getAccount(s, user.id, body.reconnectAccountId);
    configured(s, provider.data);
    const { verifier, challenge } = await pkcePair();
    const state: OAuthState = {
      userId: user.id,
      provider: provider.data,
      color: body.color,
      verifier,
      returnTo: safeReturn(body.returnTo),
      reconnectAccountId: body.reconnectAccountId ?? null,
      exp: Date.now() + 10 * 60_000,
    };
    // Encrypted + authenticated: opaque to the browser, can't be forged or replayed after expiry.
    const sealed = Buffer.from(s.envelope.encryptJson(state)).toString("base64url");
    const common = { redirectUri: redirectUri(s, provider.data), state: sealed, codeChallenge: challenge, loginHint: body.loginHint };
    const url =
      provider.data === "gmail"
        ? googleAuthUrl({ ...common, clientId: s.config.google!.clientId })
        : microsoftAuthUrl({ ...common, clientId: s.config.microsoft!.clientId, tenant: s.config.microsoft!.tenant });
    return c.json({ url });
  });
  return r;
}

/** GET /oauth/:provider/callback: public (the encrypted state authenticates it). */
export function oauthCallbackRoutes(s: Services) {
  const r = new Hono();
  r.get("/:provider/callback", async (c) => {
    const back = (path: string, params: Record<string, string>) => c.redirect(`${s.config.appUrl}${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams(params)}`);
    let state: OAuthState;
    try {
      state = s.envelope.decryptJson<OAuthState>(Buffer.from(c.req.query("state") ?? "", "base64url").toString());
    } catch {
      return back("/settings/accounts", { error: "That sign-in link is invalid. Try again." });
    }
    if (state.exp < Date.now() || state.provider !== c.req.param("provider")) return back(state.returnTo, { error: "That sign-in took too long. Try again." });
    const code = c.req.query("code");
    if (!code) return back(state.returnTo, { error: c.req.query("error") === "access_denied" ? "Access wasn't granted." : "Sign-in was cancelled." });

    try {
      const account = await completeOAuth(s, state, code);
      return back(state.returnTo, { connected: account.id });
    } catch (err) {
      s.log.warn("oauth callback failed", { provider: state.provider }, err);
      return back(state.returnTo, { error: err instanceof HttpError || err instanceof Error ? err.message : "Couldn't connect that account." });
    }
  });
  return r;
}

async function completeOAuth(s: Services, state: OAuthState, code: string) {
  const cfg = configured(s, state.provider);
  const tokenCfg =
    state.provider === "gmail"
      ? { tokenUrl: GOOGLE_TOKEN_URL, clientId: cfg.clientId, clientSecret: cfg.clientSecret }
      : { tokenUrl: msTokenUrl(s.config.microsoft!.tenant), clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  const tokens = await exchangeCode(tokenCfg, { code, redirectUri: redirectUri(s, state.provider), codeVerifier: state.verifier, ...(state.provider === "outlook" ? { scope: MS_SCOPES.join(" ") } : {}) });
  const draft: GmailCredentials | OutlookCredentials = { email: "", tokens };
  const connected = await verifyProvider(s, state.provider, draft);
  const email = connected.identities[0]!.address.toLowerCase();
  const credentials = { ...draft, email };

  // Reconnect (needs_reauth) or a repeat connect of the same mailbox: refresh credentials in place.
  const [existing] = state.reconnectAccountId
    ? await s.db.select().from(accounts).where(and(eq(accounts.id, state.reconnectAccountId), eq(accounts.userId, state.userId)))
    : await s.db.select().from(accounts).where(and(eq(accounts.userId, state.userId), eq(accounts.provider, state.provider), eq(accounts.externalId, email)));
  if (existing) {
    if (existing.externalId && existing.externalId !== email) throw new Error(`You signed in as ${email}, but this account is ${existing.externalId}.`);
    await s.db.update(accounts).set({ encryptedCredentials: s.envelope.encryptJson(credentials), externalId: email }).where(eq(accounts.id, existing.id));
    for (const i of connected.identities) {
      await s.db.insert(identities).values({ accountId: existing.id, address: i.address, displayName: i.displayName }).onConflictDoNothing();
    }
    const row = await setAccountStatus(s, existing, "active", null);
    await s.queue.add("sync", { accountId: existing.id, mode: existing.syncCursor ? "incremental" : "initial" }, { jobId: `${existing.id}:reconnect` });
    return toAccountDto(row);
  }
  return finishConnect(s, state.userId, state.provider, state.color, credentials, connected, email);
}
