import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { formatAddress, formatAddressList } from "../address.ts";
import { normalizeMessageId } from "../dedupe.ts";
import type { IdentityRef, NormalizedMessage, OutgoingMessage } from "../types.ts";
import { makeSnippet } from "../address.ts";

export interface BuiltMessage {
  raw: Buffer;
  rfcMessageId: string;
  date: Date;
  /** Every envelope recipient (to + cc + bcc). */
  recipients: string[];
}

export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1] || "ostra.local";
  return `${randomUUID()}@${domain}`;
}

/** Build RFC 5322 bytes for an outgoing message. Bcc is kept out of the headers. */
export async function buildRawMessage(m: OutgoingMessage, identity: IdentityRef, opts: { messageId?: string; date?: Date } = {}): Promise<BuiltMessage> {
  const rfcMessageId = opts.messageId ?? newMessageId(identity.address);
  const date = opts.date ?? new Date();
  const references = (m.references ?? []).map((r) => `<${normalizeMessageId(r) ?? r}>`);
  const inReplyTo = normalizeMessageId(m.inReplyTo);
  const composer = new MailComposer({
    from: formatAddress({ name: identity.displayName ?? undefined, address: identity.address }),
    to: formatAddressList(m.to) || undefined,
    cc: formatAddressList(m.cc) || undefined,
    subject: m.subject,
    text: m.bodyText,
    html: m.bodyHtml,
    messageId: `<${rfcMessageId}>`,
    date,
    inReplyTo: inReplyTo ? `<${inReplyTo}>` : undefined,
    references: references.length ? references.join(" ") : undefined,
    attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content, encoding: "base64" })),
  });
  const raw = await composer.compile().build();
  const recipients = [...m.to, ...m.cc, ...m.bcc].map((a) => a.address);
  return { raw, rfcMessageId, date, recipients };
}

/** What we store locally right after sending, before the provider sync catches up. */
export function sentToNormalized(m: OutgoingMessage, identity: IdentityRef, sent: { providerMessageId: string; rfcMessageId: string; date: Date; providerThreadId?: string | undefined }): NormalizedMessage {
  return {
    providerMessageId: sent.providerMessageId,
    providerThreadId: sent.providerThreadId,
    rfcMessageId: normalizeMessageId(sent.rfcMessageId),
    inReplyTo: normalizeMessageId(m.inReplyTo),
    references: (m.references ?? []).map((r) => normalizeMessageId(r)).filter((r): r is string => !!r),
    from: { name: identity.displayName ?? undefined, address: identity.address },
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    replyTo: [],
    subject: m.subject,
    snippet: makeSnippet(m.bodyText),
    bodyText: m.bodyText,
    bodyHtml: m.bodyHtml ?? null,
    attachments: (m.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, size: Math.floor((a.content.length * 3) / 4) })),
    sentAt: sent.date.toISOString(),
    folder: "sent",
    isRead: true,
    headers: {},
  };
}
