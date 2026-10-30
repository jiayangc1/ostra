import { AuthExpiredError, RateLimitedError } from "../provider.ts";

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope?: string | undefined;
}

export interface OAuthClientConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Extra form fields for refresh (Microsoft wants `scope`). */
  refreshParams?: Record<string, string>;
}

export type Fetch = typeof fetch;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (!h) return null;
  const secs = Number(h);
  if (!Number.isNaN(secs)) return secs * 1000;
  const date = Date.parse(h);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** Exchange an authorization code (with PKCE verifier) for tokens. */
export async function exchangeCode(cfg: OAuthClientConfig, params: { code: string; redirectUri: string; codeVerifier: string; scope?: string }, f: Fetch = fetch): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: params.codeVerifier,
    ...(params.scope ? { scope: params.scope } : {}),
  });
  const res = await f(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(data.error_description ?? data.error ?? "Token exchange failed");
  if (!data.refresh_token) throw new Error("The provider didn't grant offline access. Try connecting again.");
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000, scope: data.scope };
}

export async function refreshTokens(cfg: OAuthClientConfig, refreshToken: string, f: Fetch = fetch): Promise<OAuthTokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, ...cfg.refreshParams });
  const res = await f(cfg.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (res.status === 400 || res.status === 401) {
    // invalid_grant: revoked, expired, or password changed. Only a new sign-in fixes it.
    throw new AuthExpiredError(data.error ?? "refresh rejected");
  }
  if (res.status === 429) throw new RateLimitedError("token endpoint throttled", retryAfterMs(res));
  if (!res.ok || !data.access_token) throw new Error(`token refresh failed (${res.status})`);
  return {
    accessToken: data.access_token,
    // Some providers rotate refresh tokens.
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? undefined,
  };
}

/**
 * A fetch that carries the account's access token, refreshes it when it is
 * about to expire or gets a 401, persists rotated tokens, and maps
 * throttling and revoked access onto the provider error types.
 */
export class OAuthSession {
  constructor(
    private tokens: OAuthTokens,
    private readonly cfg: OAuthClientConfig,
    private readonly save: (t: OAuthTokens) => Promise<void>,
    private readonly f: Fetch = fetch,
  ) {}

  private async refresh() {
    this.tokens = await refreshTokens(this.cfg, this.tokens.refreshToken, this.f);
    await this.save(this.tokens);
  }

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    if (this.tokens.expiresAt - Date.now() < 60_000) await this.refresh();
    const go = () => this.f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.tokens.accessToken}` } });
    let res = await go();
    if (res.status === 401) {
      await this.refresh();
      res = await go();
      if (res.status === 401) throw new AuthExpiredError("access token rejected after refresh");
    }
    if (res.status === 429 || res.status === 503) throw new RateLimitedError(`throttled (${res.status})`, retryAfterMs(res));
    return res;
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(url, init);
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const msg = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
      throw new HttpError(res.status, msg, body);
    }
    return body as T;
  }
}

/** PKCE helpers. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const { randomBytes, createHash } = await import("node:crypto");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
