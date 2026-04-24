// Source: adapted from OWASP SSRF Prevention Cheat Sheet + Node docs
import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';

export const BLOCKED_CIDR_V4 = [
  { base: 0x00000000, mask: 0xff000000 }, // 0.0.0.0/8
  { base: 0x0a000000, mask: 0xff000000 }, // 10.0.0.0/8  (RFC1918)
  { base: 0x7f000000, mask: 0xff000000 }, // 127.0.0.0/8 (loopback)
  { base: 0xa9fe0000, mask: 0xffff0000 }, // 169.254.0.0/16 (link-local + 169.254.169.254 cloud metadata)
  { base: 0xac100000, mask: 0xfff00000 }, // 172.16.0.0/12 (RFC1918)
  { base: 0xc0a80000, mask: 0xffff0000 }, // 192.168.0.0/16 (RFC1918)
  { base: 0xe0000000, mask: 0xf0000000 }, // 224.0.0.0/4 (multicast)
  { base: 0xf0000000, mask: 0xf0000000 }, // 240.0.0.0/4 (reserved)
];

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_CIDR_V4.some(({ base, mask }) => (n & mask) === (base & mask));
}

export function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped: ::ffff:127.0.0.1 → delegate to v4 check
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  // IPv6 loopback, unspecified, link-local, multicast, unique-local, cloud metadata
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('ff')) return true; // link-local, multicast
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;    // unique-local (fc00::/7)
  if (lower === 'fd00:ec2::254') return true;                            // AWS IPv6 IMDS
  return false;
}

export function isSafeUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'non_https' };
  // Reject user@host (credentials)
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  // Reject hostnames that ARE raw IP literals in any encoding.
  // The WHATWG URL parser already normalizes hex/octal/decimal IPv4s to dotted-decimal,
  // so net.isIP() sees them as-resolved. Still, we explicitly forbid literal IP hosts.
  const host = url.hostname;
  // WHATWG URL parser wraps IPv6 addresses in brackets: '[::1]', '[::ffff:7f00:1]'.
  // net.isIP() does NOT handle bracketed addresses (returns 0 for '[::1]'), so we must
  // strip the brackets before checking. For IPv4 addresses (no brackets), isIP works directly.
  const hostForIpCheck = host.startsWith('[') && host.endsWith(']')
    ? host.slice(1, -1)
    : host;
  if (isIP(hostForIpCheck) !== 0) return { ok: false, reason: 'ip_literal_host' };
  // Reject localhost and common aliases (DNS may return 127.0.0.1; belt+suspenders)
  const lc = host.toLowerCase();
  if (lc === 'localhost' || lc.endsWith('.localhost') || lc.endsWith('.local')) {
    return { ok: false, reason: 'localhost_alias' };
  }
  return { ok: true, url };
}

// Source: Node dns/promises docs, OWASP SSRF Cheat Sheet
export async function resolveAndValidateHost(host: string): Promise<string[]> {
  const records = await dnsPromises.lookup(host, { all: true });
  if (records.length === 0) throw new Error('dns_no_records');
  for (const { address, family } of records) {
    const blocked = family === 4 ? isBlockedIPv4(address) : isBlockedIPv6(address);
    if (blocked) throw new Error(`blocked_ip:${address}`);
  }
  return records.map((r) => r.address);
}
