import { chooseFromIdentity, domainMismatch, type Identity, type SmartFromInput } from "@ostra/core";
import { z } from "zod";
import { UNTRUSTED_NOTE, untrusted, type LLMProvider } from "./llm.ts";

export type PreSendWarning =
  | { kind: "wrong_account"; message: string; suggestedIdentityId: string }
  | { kind: "missing_attachment"; message: string }
  | { kind: "tone"; message: string };

export interface PreSendInput {
  identityId: string;
  smartFrom: Omit<SmartFromInput, "recipients">;
  recipients: string[];
  subject: string;
  body: string;
  attachmentCount: number;
  /** Recent messages in the thread, for the tone comparison. */
  thread?: { from: string; text: string }[];
}

const ATTACH = /\b(attach(ed|ing|ment|ments)?|enclosed|i('ve| have) included the (file|doc|pdf|deck|slides)|see the (file|doc|pdf)|find the (file|doc|pdf|deck))\b/i;

/** Mentions attaching something in the new text (not in quoted replies) but nothing is attached. */
export function mentionsAttachment(body: string): boolean {
  const own = body
    .split(/\n/)
    .filter((l) => !l.trimStart().startsWith(">"))
    .join("\n")
    .split(/\nOn .+ wrote:\n/)[0]!;
  return ATTACH.test(own);
}

const fmt = (i: Identity) => (i.displayName ? `${i.displayName} <${i.address}>` : i.address);

/** Deterministic checks: wrong account and missing attachment. */
export function localChecks(input: PreSendInput): PreSendWarning[] {
  const warnings: PreSendWarning[] = [];
  const ids = input.smartFrom.identities;
  const chosen = ids.find((i) => i.id === input.identityId);
  if (chosen) {
    const expected = chooseFromIdentity({ ...input.smartFrom, recipients: input.recipients });
    const mismatch = domainMismatch(chosen, ids, input.recipients);
    if (mismatch) {
      warnings.push({ kind: "wrong_account", message: `You're writing to ${mismatch.recipient} from ${chosen.address}. Send from ${mismatch.identity.address} instead?`, suggestedIdentityId: mismatch.identity.id });
    } else if (expected.identityId && expected.identityId !== chosen.id && (expected.reason === "reply" || expected.reason === "contact")) {
      const other = ids.find((i) => i.id === expected.identityId)!;
      const why = expected.reason === "reply" ? "This mail was sent to" : "You usually write to them from";
      warnings.push({ kind: "wrong_account", message: `${why} ${fmt(other)}, not ${chosen.address}.`, suggestedIdentityId: other.id });
    }
  }
  if (input.attachmentCount === 0 && mentionsAttachment(input.body)) {
    warnings.push({ kind: "missing_attachment", message: "You mention an attachment, but nothing is attached." });
  }
  return warnings;
}

const ToneSchema = z.object({ harsher: z.boolean(), note: z.string() });

/** LLM check: does the draft read significantly harsher than the thread? */
export async function toneCheck(llm: LLMProvider, input: Pick<PreSendInput, "body" | "thread">): Promise<PreSendWarning | null> {
  if (input.body.trim().length < 20) return null;
  const thread = (input.thread ?? []).slice(-4).map((m) => `From: ${m.from}\n${m.text.slice(0, 1200)}`).join("\n---\n");
  const r = await llm.json({
    tier: "fast",
    system: `You check an email draft before it's sent. Flag it only if it reads significantly harsher, ruder, or more passive-aggressive than the conversation so far, or would likely offend the recipient. Directness and brevity are fine. If you flag, give a short, kind note (under 20 words) saying what reads harsh.\n${UNTRUSTED_NOTE}`,
    prompt: `${thread ? `Conversation so far:\n${untrusted("thread", thread)}\n\n` : ""}Draft:\n${untrusted("draft", input.body.slice(0, 4000))}`,
    schema: ToneSchema,
    maxTokens: 200,
  });
  return r.harsher ? { kind: "tone", message: r.note || "This may read harsher than the rest of the thread." } : null;
}

/** All checks. Never blocks sending; the UI always offers "send anyway". */
export async function preSendCheck(llm: LLMProvider | null, input: PreSendInput): Promise<PreSendWarning[]> {
  const warnings = localChecks(input);
  if (llm) {
    try {
      const tone = await toneCheck(llm, input);
      if (tone) warnings.push(tone);
    } catch {
      // a failed tone check is no warning, not an error
    }
  }
  return warnings;
}
