/**
 * SSRF protection for outbound webhook target URLs (#1484).
 *
 * Rules enforced:
 *   - HTTPS only (no http:, file:, gopher:, etc.)
 *   - No embedded credentials (user:pass@host)
 *   - Hostname must not resolve to a private, loopback, link-local,
 *     CGNAT, multicast or otherwise non-public address.
 *
 * Checks are performed twice:
 *   1. `assertSafeWebhookUrl(url)`  — syntactic + literal-IP checks (sync).
 *   2. `assertSafeResolvedAddresses(host, addrs)` — after DNS resolution,
 *      so a public hostname cannot rebind to an internal address.
 */

export class SsrfBlockedError extends Error {
  readonly code = 'SSRF_BLOCKED';

  constructor(reason: string) {
    super(`Blocked unsafe webhook URL: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** Private, loopback, link-local and other non-routable IPv4 ranges. */
export function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4(ip);
  if (!octets) return false;
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0) return true; // 203.0.113.0/24 documentation
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 255.255.255.255 broadcast

  return false;
}

/** Expand an IPv6 literal into its 8 groups. Returns null when unparseable. */
function expandIpv6(ip: string): number[] | null {
  let addr = ip.split('%')[0]; // strip zone id (fe80::1%eth0)
  if (addr.includes('.')) {
    // IPv4-mapped / IPv4-compatible tail, e.g. ::ffff:127.0.0.1
    const v4 = addr.slice(addr.lastIndexOf(':') + 1);
    const octets = parseIpv4(v4);
    if (!octets) return null;
    addr = `${addr.slice(0, addr.lastIndexOf(':') + 1)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const grp of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(grp)) return null;
      out.push(parseInt(grp, 16));
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = toGroups(halves[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = toGroups(halves[0]);
  const tail = toGroups(halves[1]);
  if (!head || !tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array(fill).fill(0), ...tail];
}

/** Loopback, link-local, unique-local and IPv4-mapped private IPv6. */
export function isBlockedIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return false;

  const isZero = (from: number, to: number) => groups.slice(from, to + 1).every((g) => g === 0);
  const head = groups[0];

  if (isZero(0, 7)) return true; // :: unspecified
  if (isZero(0, 6) && groups[7] === 1) return true; // ::1 loopback
  // ::ffff:a.b.c.d — IPv4-mapped (already normalized to hex groups above)
  if (isZero(0, 4) && groups[5] === 0xffff) {
    const hi = groups[6];
    const lo = groups[7];
    const octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    if (isBlockedIpv4(octets.join('.'))) return true;
  }
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

/** True when the IP (v4 or v6 literal) must never be reachable. */
export function isBlockedIp(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, '');
  if (parseIpv4(trimmed)) return isBlockedIpv4(trimmed);
  return isBlockedIpv6(trimmed);
}

/**
 * Synchronous URL validation: scheme, credentials and literal-IP hosts.
 * Throws `SsrfBlockedError` when the URL is not safe to call.
 */
export function assertSafeWebhookUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new SsrfBlockedError('empty URL');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('malformed URL');
  }

  if (url.protocol !== 'https:') {
    throw new SsrfBlockedError(`scheme "${url.protocol}" is not https`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('embedded credentials are not allowed');
  }
  if (!url.hostname) {
    throw new SsrfBlockedError('missing hostname');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new SsrfBlockedError(`hostname "${host}" is not publicly resolvable`);
  }

  const literal = host.startsWith('0x') ? null : host;
  if (literal && isBlockedIp(literal)) {
    throw new SsrfBlockedError(`address "${host}" is private, loopback or link-local`);
  }

  return url;
}

/**
 * Post-DNS-resolution check: rejects the target when ANY resolved address is
 * private, loopback or link-local. Call with the output of
 * `dns.lookup(host, { all: true })`.
 */
export function assertSafeResolvedAddresses(
  hostname: string,
  addresses: string[],
): void {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new SsrfBlockedError(`"${hostname}" resolved to no addresses`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(
        `"${hostname}" resolves to blocked address "${address}"`,
      );
    }
  }
}

export type DnsLookupFn = (hostname: string) => Promise<string[]>;

/** Default DNS lookup used at subscription creation time. */
export const defaultDnsLookup: DnsLookupFn = async (hostname) => {
  const dns = await import('node:dns/promises');
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

/** Full validation: syntactic checks + DNS resolution. */
export async function assertSafeWebhookUrlResolved(
  rawUrl: string,
  lookup: DnsLookupFn = defaultDnsLookup,
): Promise<URL> {
  const url = assertSafeWebhookUrl(rawUrl);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Literal IPs were already validated synchronously — skip the DNS round trip.
  if (isBlockedIp(host) || !host.includes('.') && !host.includes(':')) {
    // still guard against single-label hosts resolving to loopback
    throw new SsrfBlockedError(`hostname "${host}" is not publicly resolvable`);
  }
  if (parseIpv4(host) || host.includes(':')) return url;

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for "${host}"`);
  }
  assertSafeResolvedAddresses(host, addresses);
  return url;
}
