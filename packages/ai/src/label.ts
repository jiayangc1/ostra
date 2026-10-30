import { z } from "zod";
import { relevantCorrections, type Correction } from "./corrections.ts";
import type { MessageSignals } from "./heuristics.ts";
import { UNTRUSTED_NOTE, untrusted, type LLMProvider } from "./llm.ts";

export interface LabelDef {
  id: string;
  name: string;
  description: string | null;
}

export interface AppliedLabel {
  labelId: string;
  confidence: number;
}

/** Labels below this confidence aren't applied. */
export const LABEL_THRESHOLD = 0.6;

const SYSTEM = `You apply a person's own labels to an incoming email. Apply a label only when the email clearly belongs to it; most emails get zero or one label. Use the label descriptions and the person's past corrections. Return only labels from the given list, by exact name.
${UNTRUSTED_NOTE}`;

const Schema = z.object({ labels: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) })) });

/** Auto-label on arrival. Returns labels to apply directly (source = ai). */
export async function autoLabel(llm: LLMProvider, m: MessageSignals & { body?: string | null }, labels: LabelDef[], corrections: Correction[] = []): Promise<AppliedLabel[]> {
  if (labels.length === 0) return [];
  const list = labels.map((l) => `- ${l.name}${l.description ? `: ${l.description}` : ""}`).join("\n");
  const examples = relevantCorrections(corrections, m.from.address, "label", 8)
    .map((c) =>
      untrusted(
        "example",
        `From: ${c.sender}\nSubject: ${c.subject}\n${c.snippet}\n→ ${c.toValue ? `the person added "${c.toValue}"` : `the person removed "${c.fromValue}"`}`,
      ),
    )
    .join("\n");
  const body = (m.body ?? m.snippet).slice(0, 1500);
  const prompt = [
    `Labels:\n${list}`,
    examples && `Past corrections:\n${examples}`,
    `Email:\n${untrusted("email", `From: ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}\nSubject: ${m.subject}\n\n${body}`)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await llm.json({ tier: "fast", system: SYSTEM, prompt, schema: Schema, maxTokens: 512 });
  const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
  const seen = new Set<string>();
  const out: AppliedLabel[] = [];
  for (const l of r.labels) {
    const id = byName.get(l.name.trim().toLowerCase());
    if (!id || seen.has(id) || l.confidence < LABEL_THRESHOLD) continue;
    seen.add(id);
    out.push({ labelId: id, confidence: l.confidence });
  }
  return out;
}
