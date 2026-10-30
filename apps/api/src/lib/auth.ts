import type { Config } from "../config.ts";
import type { AuthIdentity } from "../services/context.ts";
import { log } from "./log.ts";

/**
 * Session token verification. With Clerk configured, tokens are Clerk
 * session JWTs verified networklessly against the instance JWKS. Without it
 * (development and tests only, never production) a token of the form
 * `dev` or `dev:<name>` signs in as a local dev user.
 */
export async function createTokenVerifier(config: Config): Promise<(token: string) => Promise<AuthIdentity | null>> {
  if (config.authMode === "clerk") {
    const { verifyToken, createClerkClient } = await import("@clerk/backend");
    const clerk = createClerkClient({ secretKey: config.clerk.secretKey! });
    const profiles = new Map<string, { email: string; name: string | null }>();
    return async (token) => {
      try {
        const payload = await verifyToken(token, { secretKey: config.clerk.secretKey!, authorizedParties: config.clerk.authorizedParties });
        const clerkUserId = payload.sub;
        let profile = profiles.get(clerkUserId);
        if (!profile) {
          // Session tokens don't carry the email; fetch once per process. Webhooks keep it fresh after that.
          const u = await clerk.users.getUser(clerkUserId);
          const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0];
          profile = { email: primary?.emailAddress ?? "", name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null };
          profiles.set(clerkUserId, profile);
        }
        return { clerkUserId, ...profile };
      } catch (err) {
        log.debug("token rejected", { reason: err instanceof Error ? err.message : String(err) });
        return null;
      }
    };
  }

  if (config.env === "production") throw new Error("Dev auth is not allowed in production");
  log.warn("Clerk is not configured: using development auth (any 'dev' token signs in)");
  return async (token) => {
    const m = token.match(/^dev(?::([a-z0-9_-]{1,32}))?$/i);
    if (!m) return null;
    const name = (m[1] ?? "you").toLowerCase();
    return { clerkUserId: `dev_${name}`, email: `${name}@dev.local`, name: name === "you" ? "You" : name };
  };
}
