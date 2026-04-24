// Source: adapted from undici Client.md + firecrawl SSRF mitigation pattern
import { Agent, buildConnector } from 'undici';
import { isBlockedIPv4, isBlockedIPv6, isSafeUrl, resolveAndValidateHost } from './url-safety.js';

const baseConnector = buildConnector({ rejectUnauthorized: true });

export const ssrfSafeAgent = new Agent({
  connect(opts, cb) {
    baseConnector(opts, (err, socket) => {
      if (err) return cb(err, null);
      if (!socket) return cb(new Error('no_socket'), null);
      const addr = socket.remoteAddress ?? '';
      const family = socket.remoteFamily;
      // Re-validate resolved IP at connect time (DNS-rebinding defense).
      // socket.remoteFamily may be 'IPv6' even for ::ffff:127.0.0.1 — isBlockedIPv6
      // delegates IPv4-mapped addresses to isBlockedIPv4 (Pitfall 1).
      const blocked = family === 'IPv4' ? isBlockedIPv4(addr) : isBlockedIPv6(addr);
      if (blocked) {
        socket.destroy();
        return cb(new Error(`blocked_ip_post_resolve:${addr}`), null);
      }
      cb(null, socket);
    });
  },
});

/**
 * SSRF-safe fetch wrapper.
 * Validates the URL string before DNS lookup, validates all DNS records,
 * uses ssrfSafeAgent for connect-time IP re-check (DNS-rebinding defense),
 * and re-validates each redirect hop (redirect:'manual' + per-hop re-check).
 *
 * maxRedirects (default 3) — maximum number of redirects to follow.
 * Total fetch attempts = maxRedirects + 1 (initial request + each follow).
 * Matches the axios/undici/python-requests convention. Set to 0 to disable
 * redirect following entirely (any 3xx response becomes `too_many_redirects`).
 */
export async function safeFetch(
  startUrl: string,
  maxRedirects = 3,
  init?: RequestInit
): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = isSafeUrl(current);
    if (!check.ok) throw new Error(`ssrf_rejected:${check.reason}`);
    await resolveAndValidateHost(check.url.hostname);
    const res = await fetch(current, {
      ...init,
      dispatcher: ssrfSafeAgent as any, // Node fetch accepts dispatcher per undici docs
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect_without_location');
      current = new URL(loc, current).toString(); // resolve relative redirect
      continue;
    }
    return res;
  }
  throw new Error('too_many_redirects');
}
