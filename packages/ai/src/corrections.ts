import { domainOf, normalizeAddress } from "@ostra/core";

export interface Correction {
  kind: "category" | "label";
  fromValue: string | null;
  toValue: string | null;
  sender: string;
  subject: string;
  snippet: string;
  createdAt: string;
}

/**
 * The corrections most worth showing the model for this message: same
 * sender first, then same domain, then the most recent.
 */
export function relevantCorrections(all: Correction[], sender: string, kind: Correction["kind"], limit = 8): Correction[] {
  const s = normalizeAddress(sender);
  const d = domainOf(s);
  const score = (c: Correction) => (c.sender === s ? 2 : domainOf(c.sender) === d ? 1 : 0);
  return all
    .filter((c) => c.kind === kind)
    .map((c, i) => ({ c, i, score: score(c) }))
    .sort((a, b) => b.score - a.score || b.c.createdAt.localeCompare(a.c.createdAt) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}
