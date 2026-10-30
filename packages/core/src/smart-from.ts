import { domainOf, normalizeAddress } from "./address.ts";
import type { Address, Identity } from "./types.ts";

export type FromReason = "reply" | "contact" | "default" | "fallback";

export interface SmartFromInput {
  identities: readonly Identity[];
  /** Set when replying/forwarding: the message being answered. */
  original?: {
    to: readonly Address[];
    cc: readonly Address[];
    /** `Delivered-To` / `X-Original-To`, when the provider exposes it. */
    deliveredTo?: string | null | undefined;
    /** Accounts the original landed in. */
    accountIds: readonly string[];
  } | undefined;
  recipients: readonly string[];
  /** contact address (normalized) → identity id last used with them */
  lastIdentityByContact: ReadonlyMap<string, string>;
  defaultIdentityId: string | null;
}

export interface SmartFromResult {
  identityId: string | null;
  reason: FromReason;
}

/**
 * Pick the "from" identity, in order:
 *  1. Replying: the identity the original email was addressed to.
 *  2. New email: the identity last used with that contact.
 *  3. Otherwise: the user's default identity.
 */
export function chooseFromIdentity(input: SmartFromInput): SmartFromResult {
  const { identities } = input;
  if (identities.length === 0) return { identityId: null, reason: "fallback" };
  const byAddress = new Map(identities.map((i) => [normalizeAddress(i.address), i]));

  if (input.original) {
    const o = input.original;
    const addressed = [o.deliveredTo ?? null, ...o.to.map((a) => a.address), ...o.cc.map((a) => a.address)]
      .filter((a): a is string => !!a)
      .map(normalizeAddress);
    const matches = addressed.map((a) => byAddress.get(a)).filter((i): i is Identity => !!i);
    // Prefer an identity on an account the original actually landed in.
    const best = matches.find((i) => o.accountIds.includes(i.accountId)) ?? matches[0];
    if (best) return { identityId: best.id, reason: "reply" };
    // Addressed to an alias we don't know: answer from the receiving account.
    const receiving = identities.filter((i) => o.accountIds.includes(i.accountId));
    const pick = receiving.find((i) => i.isDefault) ?? receiving[0];
    if (pick) return { identityId: pick.id, reason: "reply" };
  } else {
    for (const r of input.recipients) {
      const id = input.lastIdentityByContact.get(normalizeAddress(r));
      if (id && identities.some((i) => i.id === id)) return { identityId: id, reason: "contact" };
    }
  }

  if (input.defaultIdentityId && identities.some((i) => i.id === input.defaultIdentityId)) {
    return { identityId: input.defaultIdentityId, reason: "default" };
  }
  const fallback = identities.find((i) => i.isDefault) ?? identities[0]!;
  return { identityId: fallback.id, reason: "fallback" };
}

/**
 * Identities whose domain matches a recipient's domain, other than the chosen
 * one. Used by the pre-send check: writing to @acme.com from your personal
 * Gmail when you own hello@acme.com is probably a mistake. Public mail
 * domains never count.
 */
export function domainMismatch(
  chosen: Identity,
  identities: readonly Identity[],
  recipients: readonly string[],
): { recipient: string; identity: Identity } | null {
  const chosenDomain = domainOf(chosen.address);
  for (const r of recipients) {
    const d = domainOf(r);
    if (!d || d === chosenDomain || PUBLIC_DOMAINS.has(d)) continue;
    const other = identities.find((i) => i.id !== chosen.id && domainOf(i.address) === d);
    if (other) return { recipient: r, identity: other };
  }
  return null;
}

export const PUBLIC_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "fastmail.com",
  "hey.com",
]);
