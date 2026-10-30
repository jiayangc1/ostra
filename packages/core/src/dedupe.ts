import { normalizeAddress } from "./address.ts";
import type { NormalizedMessage } from "./types.ts";

/** `<Abc@Example.COM>` → `abc@example.com`. Returns null for empty/garbage ids. */
export function normalizeMessageId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim().replace(/^<+/, "").replace(/>+$/, "").trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** Parse a `References` / `In-Reply-To` header into normalized ids. */
export function parseMessageIdList(header: string | null | undefined): string[] {
  if (!header) return [];
  const ids = header.match(/<[^<>\s]+>/g) ?? header.split(/\s+/);
  const out: string[] = [];
  for (const raw of ids) {
    const n = normalizeMessageId(raw);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The key used to recognise the same email landing in several accounts.
 * Prefers the Message-ID; falls back to a content hash for the rare mail
 * without one.
 */
export function dedupeKey(m: Pick<NormalizedMessage, "rfcMessageId" | "from" | "subject" | "sentAt">): string {
  const id = normalizeMessageId(m.rfcMessageId);
  if (id) return `mid:${id}`;
  return `hash:${fnv1a64(`${normalizeAddress(m.from.address)}\n${m.subject.trim()}\n${new Date(m.sentAt).toISOString()}`)}`;
}

export interface Located<T> {
  accountId: string;
  message: T;
}

/**
 * Group messages from several accounts by dedupe key. Each group is one
 * logical message, with every account it was found in.
 */
export function groupDuplicates<T extends Pick<NormalizedMessage, "rfcMessageId" | "from" | "subject" | "sentAt">>(
  items: readonly Located<T>[],
): { key: string; message: T; accountIds: string[] }[] {
  const groups = new Map<string, { key: string; message: T; accountIds: string[] }>();
  for (const item of items) {
    const key = dedupeKey(item.message);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.accountIds.includes(item.accountId)) existing.accountIds.push(item.accountId);
    } else {
      groups.set(key, { key, message: item.message, accountIds: [item.accountId] });
    }
  }
  return [...groups.values()];
}

/** FNV-1a 64-bit, hex. Runs in browsers and Node alike; not cryptographic. */
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

const SUBJECT_PREFIX = /^\s*((re|fw|fwd|aw|wg|sv|vs|antw|rif|tr)(\[\d+\])?\s*:\s*)+/i;

export function normalizeSubject(subject: string): string {
  return subject.replace(SUBJECT_PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Message-ids that, if already stored, mean this message belongs to an existing thread. */
export function threadingCandidates(m: Pick<NormalizedMessage, "inReplyTo" | "references">): string[] {
  const out: string[] = [];
  const reply = normalizeMessageId(m.inReplyTo);
  if (reply) out.push(reply);
  for (const r of m.references) {
    const n = normalizeMessageId(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
