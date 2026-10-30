/**
 * RFC 822 → NormalizedMessage, shared by every provider that can hand us
 * raw MIME (IMAP, Gmail `format=raw`, Resend inbound). Node only.
 */
import { simpleParser, type AddressObject, type HeaderValue, type ParsedMail } from "mailparser";
import { htmlToText, makeSnippet } from "../address.ts";
import { normalizeMessageId, parseMessageIdList } from "../dedupe.ts";
import type { Address, AttachmentMeta, NormalizedMessage, VirtualFolder } from "../types.ts";

/** Headers the categorizer and smart-from need. Everything else is dropped. */
const KEEP_HEADERS = new Set([
  "list-unsubscribe",
  "list-unsubscribe-post",
  "list-id",
  "list-post",
  "precedence",
  "auto-submitted",
  "delivered-to",
  "x-original-to",
  "feedback-id",
  "x-github-reason",
  "x-mailer",
  "x-auto-response-suppress",
  "x-campaign",
  "x-mailchimp-campaign",
  "x-sg-eid",
  "x-ses-outgoing",
  "x-mc-user",
]);

function addressList(v: AddressObject | AddressObject[] | undefined): Address[] {
  if (!v) return [];
  const objs = Array.isArray(v) ? v : [v];
  const out: Address[] = [];
  const walk = (list: AddressObject["value"]) => {
    for (const a of list) {
      if (a.group) walk(a.group);
      else if (a.address) out.push(a.name ? { name: a.name, address: a.address } : { address: a.address });
    }
  };
  for (const o of objs) walk(o.value);
  return out;
}

function headerText(v: HeaderValue | undefined): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  if (typeof v === "object" && "text" in v && typeof v.text === "string") return v.text;
  if (typeof v === "object" && "value" in v) return String((v as { value: unknown }).value);
  return String(v);
}

function keptHeaders(parsed: ParsedMail): Record<string, string> {
  const out: Record<string, string> = {};
  // headerLines keeps the raw values, which is what we want for List-Unsubscribe et al.
  for (const line of parsed.headerLines) {
    if (!KEEP_HEADERS.has(line.key)) continue;
    const value = line.line.slice(line.line.indexOf(":") + 1).replace(/\r?\n\s+/g, " ").trim();
    if (!(line.key in out)) out[line.key] = value.slice(0, 1000);
  }
  if (!out["list-id"]) {
    const v = headerText(parsed.headers.get("list-id"));
    if (v) out["list-id"] = v;
  }
  return out;
}

export interface MimeMeta {
  providerMessageId: string;
  providerThreadId?: string | undefined;
  folder: VirtualFolder;
  isRead: boolean;
  /** Fallback when the Date header is missing (IMAP INTERNALDATE, Gmail internalDate). */
  receivedAt?: Date | string | undefined;
  providerLabels?: string[] | undefined;
}

export async function parseMime(raw: Buffer | string, meta: MimeMeta): Promise<NormalizedMessage> {
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, keepCidLinks: true });
  return normalizeParsed(parsed, meta);
}

export function normalizeParsed(parsed: ParsedMail, meta: MimeMeta): NormalizedMessage {
  const from = addressList(parsed.from)[0] ?? { address: "" };
  const html = typeof parsed.html === "string" ? parsed.html : null;
  const text = parsed.text ?? (html ? htmlToText(html) : null);
  const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map((a, i) => ({
    filename: a.filename ?? `attachment-${i + 1}`,
    contentType: a.contentType,
    size: a.size,
    contentId: a.cid ?? undefined,
    inline: a.contentDisposition === "inline" && !!a.cid,
    providerAttachmentId: String(i),
  }));
  const date = parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : meta.receivedAt ? new Date(meta.receivedAt) : new Date();
  const refs = parsed.references;
  return {
    providerMessageId: meta.providerMessageId,
    providerThreadId: meta.providerThreadId,
    rfcMessageId: normalizeMessageId(parsed.messageId),
    inReplyTo: normalizeMessageId(parsed.inReplyTo),
    references: Array.isArray(refs) ? refs.flatMap((r) => parseMessageIdList(r)) : parseMessageIdList(refs),
    from,
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    bcc: addressList(parsed.bcc),
    replyTo: addressList(parsed.replyTo),
    subject: parsed.subject ?? "",
    snippet: makeSnippet(text),
    bodyText: text,
    bodyHtml: html,
    attachments,
    sentAt: date.toISOString(),
    folder: meta.folder,
    isRead: meta.isRead,
    headers: keptHeaders(parsed),
    providerLabels: meta.providerLabels,
  };
}

/** Extract one attachment's bytes from raw MIME by its index (providerAttachmentId). */
export async function mimeAttachment(raw: Buffer | string, index: number): Promise<Uint8Array | null> {
  const parsed = await simpleParser(raw);
  const a = parsed.attachments?.[index];
  return a ? new Uint8Array(a.content) : null;
}
