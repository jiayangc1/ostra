import type { Address } from "./types.ts";

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).trim().toLowerCase();
}

/** Split on commas/semicolons that are outside quotes and angle brackets. */
function splitList(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "\\" && inQuote) {
      current += ch + (input[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "<") depth++;
    else if (!inQuote && ch === ">") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && !inQuote && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function unquote(name: string): string {
  let n = name.trim();
  if (n.startsWith('"') && n.endsWith('"') && n.length >= 2) n = n.slice(1, -1).replace(/\\(.)/g, "$1");
  return n.trim();
}

/** Parse one RFC 5322 mailbox like `"Doe, Jane" <jane@x.com>` or `jane@x.com`. */
export function parseAddress(input: string): Address | null {
  const s = input.trim();
  if (!s) return null;
  const angle = s.match(/^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (angle) {
    const name = unquote(angle[1] ?? "");
    return name ? { name, address: angle[2]!.trim() } : { address: angle[2]!.trim() };
  }
  const bare = s.match(/^[^\s<>@]+@[^\s<>@]+$/);
  if (bare) return { address: s };
  // `jane@x.com (Jane Doe)` comment form
  const comment = s.match(/^([^\s<>@]+@[^\s<>@]+)\s*\((.*)\)$/);
  if (comment) return { name: comment[2]!.trim(), address: comment[1]! };
  return null;
}

export function parseAddressList(input: string | null | undefined): Address[] {
  if (!input) return [];
  return splitList(input)
    .map(parseAddress)
    .filter((a): a is Address => a !== null);
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.address;
  const needsQuote = /[",;<>@()[\]:\\.]/.test(a.name);
  const name = needsQuote ? `"${a.name.replace(/(["\\])/g, "\\$1")}"` : a.name;
  return `${name} <${a.address}>`;
}

export function formatAddressList(list: readonly Address[]): string {
  return list.map(formatAddress).join(", ");
}

export function displayName(a: Address): string {
  return a.name?.trim() || a.address.split("@")[0] || a.address;
}

/** Unique by normalized address, preserving the first occurrence (and its name). */
export function uniqueAddresses(list: readonly Address[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const a of list) {
    const key = normalizeAddress(a.address);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/** Turn a body into a one-line preview. */
export function makeSnippet(text: string | null | undefined, max = 160): string {
  if (!text) return "";
  const flat = text
    .replace(/^>.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Very small HTML → text fallback for snippets and AI input. Not a sanitizer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
