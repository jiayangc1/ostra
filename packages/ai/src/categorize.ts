import { CATEGORIES, type Category } from "@ostra/core";
import { z } from "zod";
import { relevantCorrections, type Correction } from "./corrections.ts";
import { heuristicCategory, type MessageSignals } from "./heuristics.ts";
import { UNTRUSTED_NOTE, untrusted, type LLMProvider } from "./llm.ts";

export interface CategoryResult {
  category: Category;
  confidence: number;
  source: "sender_rule" | "heuristic" | "ai" | "default";
}

/** Heuristics at or above this settle it without a model call. */
export const HEURISTIC_THRESHOLD = 0.85;

const SYSTEM = `You sort incoming email for one person into exactly one category:
- primary: written by a real person to them, or something that needs their attention personally (a client, investor, colleague, friend, recruiter writing directly, a doctor's office asking for a reply).
- newsletter: editorial content they subscribed to (Substack, digests, changelogs, blogs).
- notification: automated messages about their accounts and activity (receipts, deploys, alerts, security, calendar, shipping, social and app notifications).
- promotion: marketing, sales, offers and product announcements meant to sell.
When unsure between primary and anything else, choose primary: missing real mail is worse than an extra row.
The person's own past corrections, when given, override these definitions.
${UNTRUSTED_NOTE}`;

const Schema = z.object({ category: z.enum(CATEGORIES), confidence: z.number().min(0).max(1) });

function describe(m: MessageSignals): string {
  const headers = Object.entries(m.headers)
    .filter(([k]) => ["list-unsubscribe", "list-id", "precedence", "auto-submitted", "x-mailer", "feedback-id"].includes(k))
    .map(([k, v]) => `${k}: ${v.slice(0, 120)}`)
    .join("\n");
  return untrusted("email", `From: ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}\nSubject: ${m.subject}\n${headers}\n\n${m.snippet}`);
}

export async function categorize(
  llm: LLMProvider | null,
  m: MessageSignals,
  ctx: { senderRule?: Category | null; corrections?: Correction[] } = {},
): Promise<CategoryResult> {
  if (ctx.senderRule) return { category: ctx.senderRule, confidence: 1, source: "sender_rule" };
  const guess = heuristicCategory(m);
  if (guess && guess.confidence >= HEURISTIC_THRESHOLD) return { category: guess.category, confidence: guess.confidence, source: "heuristic" };
  if (!llm) return guess ? { category: guess.category, confidence: guess.confidence, source: "heuristic" } : { category: "primary", confidence: 0.5, source: "default" };

  const examples = relevantCorrections(ctx.corrections ?? [], m.from.address, "category", 6)
    .map((c) => untrusted("example", `From: ${c.sender}\nSubject: ${c.subject}\n${c.snippet}\n→ the person moved this from ${c.fromValue} to ${c.toValue}`))
    .join("\n");
  const prompt = [
    examples && `The person's past corrections:\n${examples}`,
    guess && `A rule-based guess (not certain): ${guess.category}, because ${guess.reason}.`,
    `Categorize this email:\n${describe(m)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await llm.json({ tier: "fast", system: SYSTEM, prompt, schema: Schema, maxTokens: 256 });
  return { category: r.category, confidence: r.confidence, source: "ai" };
}
