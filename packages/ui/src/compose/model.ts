import { displayName, formatAddressList, normalizeAddress, uniqueAddresses, type Address, type MessageDetail } from "@ostra/core";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export interface DraftFields {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  /** What the person writes. AI drafts and rewrites only ever touch this. */
  body: string;
  /** Quoted original (replies) or forwarded message, appended on send. */
  quote: string;
  replyToMessageId: string | null;
}

const prefix = (p: "Re" | "Fwd", subject: string) => (new RegExp(`^${p}:`, "i").test(subject.trim()) ? subject.trim() : `${p}: ${subject.trim()}`);

function quoteOf(m: MessageDetail): string {
  const when = new Date(m.sentAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const text = (m.bodyText ?? m.snippet).trimEnd();
  return `On ${when}, ${displayName(m.from)} <${m.from.address}> wrote:\n${text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}`;
}

function forwardOf(m: MessageDetail): string {
  return [
    "---------- Forwarded message ---------",
    `From: ${displayName(m.from)} <${m.from.address}>`,
    `Date: ${new Date(m.sentAt).toUTCString()}`,
    `Subject: ${m.subject}`,
    `To: ${formatAddressList(m.to)}`,
    "",
    (m.bodyText ?? m.snippet).trimEnd(),
  ].join("\n");
}

/** Prefill a draft from a message. `own` are the user's addresses, never re-added as recipients. */
export function draftFor(mode: ComposeMode, m: MessageDetail | undefined, own: string[]): DraftFields {
  const empty: DraftFields = { to: "", cc: "", bcc: "", subject: "", body: "", quote: "", replyToMessageId: null };
  if (mode === "new" || !m) return empty;
  const mine = new Set(own.map(normalizeAddress));
  const notMine = (list: Address[]) => uniqueAddresses(list).filter((a) => !mine.has(normalizeAddress(a.address)));
  if (mode === "forward") return { ...empty, subject: prefix("Fwd", m.subject), quote: forwardOf(m), replyToMessageId: m.id };

  // Replying to your own sent message goes back to its recipients.
  const fromMe = mine.has(normalizeAddress(m.from.address));
  const primary = fromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
  const to = notMine(primary);
  const cc = mode === "replyAll" ? notMine([...(fromMe ? [] : m.to), ...m.cc]).filter((a) => !to.some((t) => normalizeAddress(t.address) === normalizeAddress(a.address))) : [];
  return { ...empty, to: formatAddressList(to), cc: formatAddressList(cc), subject: prefix("Re", m.subject), quote: quoteOf(m), replyToMessageId: m.id };
}

/** The text that's actually sent. */
export function fullBody(d: Pick<DraftFields, "body" | "quote">): string {
  return d.quote ? `${d.body.trimEnd()}\n\n${d.quote}` : d.body;
}
