import type { Category } from "@ostra/core";

export interface MessageSignals {
  from: { name?: string | undefined; address: string };
  subject: string;
  snippet: string;
  headers: Record<string, string>;
  /** The user has written in this thread before. */
  userParticipated?: boolean;
  /** The user has written to this sender before. */
  knownContact?: boolean;
}

export interface CategoryGuess {
  category: Category;
  confidence: number;
  reason: string;
}

const AUTOMATED_LOCAL = /^(no-?reply|do-?not-?reply|donotreply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|receipts?|billing|invoices?|security|accounts?-?noreply|automated|system)([+._-].*)?$/i;
const PROMO = /(\d{1,2}\s?% off|\bsale\b|\bdeal(s)?\b|\bdiscount|\bcoupon|\bpromo|free shipping|last (call|chance)|limited time|\boffer\b|\bshop now|\bbuy now|black friday|cyber monday|\bsave \$?\d)/i;

/**
 * Cheap, local rules that settle most mail without a model call. Returns
 * null when nothing is confident enough; the LLM decides those.
 */
export function heuristicCategory(m: MessageSignals): CategoryGuess | null {
  const h = m.headers;
  const local = m.from.address.split("@")[0] ?? "";

  if (m.userParticipated) return { category: "primary", confidence: 0.95, reason: "you replied in this thread" };

  if (h["x-github-reason"]) return { category: "notification", confidence: 0.95, reason: "GitHub notification" };
  const auto = h["auto-submitted"]?.toLowerCase();
  if (auto && auto !== "no") return { category: "notification", confidence: 0.9, reason: "auto-submitted" };

  const bulk = !!h["list-unsubscribe"] || !!h["list-id"] || /^(bulk|list)$/i.test(h.precedence ?? "");
  if (bulk) {
    if (PROMO.test(m.subject) || PROMO.test(m.snippet)) return { category: "promotion", confidence: 0.85, reason: "bulk mail with offer language" };
    if (AUTOMATED_LOCAL.test(local)) return { category: "notification", confidence: 0.8, reason: "bulk mail from an automated sender" };
    return { category: "newsletter", confidence: 0.85, reason: "List-Unsubscribe / bulk headers" };
  }

  if (AUTOMATED_LOCAL.test(local)) return { category: "notification", confidence: 0.85, reason: "automated sender address" };
  if (m.knownContact) return { category: "primary", confidence: 0.9, reason: "someone you've written to" };
  return null;
}
