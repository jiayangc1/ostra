import { UNTRUSTED_NOTE, untrusted, type LLMProvider } from "./llm.ts";

export interface ThreadForWriting {
  subject: string;
  messages: { from: { name?: string | undefined; address: string }; sentAt: string; text: string }[];
}

export interface WriterIdentity {
  address: string;
  displayName: string | null;
}

export const REWRITE_MODES = ["shorter", "longer", "friendlier", "more formal", "fix grammar"] as const;
export type RewriteMode = (typeof REWRITE_MODES)[number];

const WRITER = `You write email replies on behalf of one person. Match how they write in the thread when they've written before; otherwise be clear, warm and brief. Write only the body: no subject line, no "Subject:", no placeholders like [Name] unless a fact is truly unknown, and no sign-off name unless the person signs their mail. Plain text, no markdown.
${UNTRUSTED_NOTE}`;

function renderThread(t: ThreadForWriting, max = 6000): string {
  const parts = t.messages.slice(-8).map((m) => `From: ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address}\nDate: ${m.sentAt}\n\n${m.text.trim()}`);
  let text = parts.join("\n\n---\n\n");
  if (text.length > max) text = text.slice(text.length - max);
  return untrusted("thread", `Subject: ${t.subject}\n\n${text}`);
}

/** Stream a reply draft for the latest message. */
export function draftReply(llm: LLMProvider, thread: ThreadForWriting, identity: WriterIdentity, instructions?: string, signal?: AbortSignal): AsyncIterable<string> {
  const who = identity.displayName ? `${identity.displayName} <${identity.address}>` : identity.address;
  const prompt = [
    `You are writing as ${who}.`,
    renderThread(thread),
    instructions?.trim() ? `What they want to say: ${instructions.trim()}` : "Draft the most likely helpful reply to the latest message.",
  ].join("\n\n");
  return llm.stream({ tier: "smart", system: WRITER, prompt, maxTokens: 2048, signal });
}

const REWRITE_INSTRUCTIONS: Record<RewriteMode, string> = {
  shorter: "Make it noticeably shorter. Keep every fact, request and date.",
  longer: "Expand it a little with helpful detail or context, without padding.",
  friendlier: "Make it warmer and friendlier, still professional.",
  "more formal": "Make it more formal and polished.",
  "fix grammar": "Fix spelling, grammar and punctuation only. Change nothing else.",
};

/** Stream a rewrite of the composer text. */
export function rewrite(llm: LLMProvider, text: string, mode: RewriteMode, signal?: AbortSignal): AsyncIterable<string> {
  return llm.stream({
    tier: "smart",
    system: `You rewrite email drafts. Return only the rewritten text, in the same language, as plain text.\n${UNTRUSTED_NOTE}`,
    prompt: `${REWRITE_INSTRUCTIONS[mode]}\n\n${untrusted("draft", text)}`,
    maxTokens: 2048,
    signal,
  });
}
