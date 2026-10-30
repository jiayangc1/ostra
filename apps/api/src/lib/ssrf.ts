import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

/** Only public unicast addresses are reachable from user-supplied hosts. */
function isPublic(ip: string): boolean {
  let addr = ipaddr.parse(ip);
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  return addr.range() === "unicast";
}

export class UnsafeHostError extends Error {
  override readonly name = "UnsafeHostError";
}

/**
 * Guard for user-supplied hosts (IMAP/SMTP servers, webhook targets):
 * resolve and reject loopback, private, link-local, CGNAT, multicast and
 * reserved ranges. Called before every connection, so a DNS change after
 * the account was added can't redirect us inward.
 */
export async function assertPublicHost(host: string, opts: { allowPrivate?: boolean } = {}): Promise<void> {
  if (opts.allowPrivate) return;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) {
    throw new UnsafeHostError(`${host} is not a public host`);
  }
  const addrs = ipaddr.isValid(h) ? [{ address: h }] : await lookup(h, { all: true, verbatim: true }).catch(() => {
    throw new UnsafeHostError(`Couldn't resolve ${host}`);
  });
  if (addrs.length === 0 || addrs.some((a) => !isPublic(a.address))) throw new UnsafeHostError(`${host} is not a public host`);
}

export function isAllowedPort(port: number): boolean {
  return [143, 993, 25, 465, 587, 2525, 1143, 1025].includes(port);
}
