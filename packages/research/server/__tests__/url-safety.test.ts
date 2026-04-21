import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('node:dns', () => ({
  promises: {
    lookup: vi.fn(),
  },
}));

import { promises as dns } from 'node:dns';
const lookupMock = dns.lookup as unknown as ReturnType<typeof vi.fn>;

import {
  isSafeUrl,
  isBlockedIPv4,
  isBlockedIPv6,
  resolveAndValidateHost,
} from '../services/url-safety.js';

describe('isSafeUrl', () => {
  it('1. rejects http:// as non_https', () => {
    const r = isSafeUrl('http://example.com/x');
    expect(r).toEqual({ ok: false, reason: 'non_https' });
  });

  it('2. rejects https://localhost as localhost_alias', () => {
    const r = isSafeUrl('https://localhost/x');
    expect(r).toEqual({ ok: false, reason: 'localhost_alias' });
  });

  it('3. rejects https://anything.localhost as localhost_alias', () => {
    const r = isSafeUrl('https://anything.localhost/x');
    expect(r).toEqual({ ok: false, reason: 'localhost_alias' });
  });

  it('4. rejects https://foo.local as localhost_alias', () => {
    const r = isSafeUrl('https://foo.local/x');
    expect(r).toEqual({ ok: false, reason: 'localhost_alias' });
  });

  it('5. rejects https://127.0.0.1 as ip_literal_host', () => {
    const r = isSafeUrl('https://127.0.0.1/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('6. rejects https://[::1] as ip_literal_host', () => {
    const r = isSafeUrl('https://[::1]/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('7. rejects https://2130706433 (decimal 127.0.0.1) as ip_literal_host', () => {
    const r = isSafeUrl('https://2130706433/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('8. rejects https://0x7f000001 (hex 127.0.0.1) as ip_literal_host', () => {
    const r = isSafeUrl('https://0x7f000001/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('9. rejects https://017700000001 (octal 127.0.0.1) as ip_literal_host', () => {
    const r = isSafeUrl('https://017700000001/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('10. rejects https://10.0.0.1 as ip_literal_host', () => {
    const r = isSafeUrl('https://10.0.0.1/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('11. rejects https://192.168.1.1 as ip_literal_host', () => {
    const r = isSafeUrl('https://192.168.1.1/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('12. rejects https://169.254.169.254 as ip_literal_host', () => {
    const r = isSafeUrl('https://169.254.169.254/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('13. rejects https://[::ffff:127.0.0.1] as ip_literal_host', () => {
    const r = isSafeUrl('https://[::ffff:127.0.0.1]/x');
    expect(r).toEqual({ ok: false, reason: 'ip_literal_host' });
  });

  it('14. rejects https://user:pass@example.com as credentials_in_url', () => {
    const r = isSafeUrl('https://user:pass@example.com/x');
    expect(r).toEqual({ ok: false, reason: 'credentials_in_url' });
  });

  it('15. rejects file:///etc/passwd as non_https', () => {
    const r = isSafeUrl('file:///etc/passwd');
    expect(r).toEqual({ ok: false, reason: 'non_https' });
  });

  it('16. rejects "not a url" as invalid_url', () => {
    const r = isSafeUrl('not a url');
    expect(r).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('17. accepts https://api.github.com/x as ok', () => {
    const r = isSafeUrl('https://api.github.com/x');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url.hostname).toBe('api.github.com');
    }
  });
});

describe('isBlockedIPv4', () => {
  it('18. 127.0.0.1 is blocked (loopback)', () => {
    expect(isBlockedIPv4('127.0.0.1')).toBe(true);
  });

  it('19. 10.0.0.1 is blocked (RFC1918)', () => {
    expect(isBlockedIPv4('10.0.0.1')).toBe(true);
  });

  it('20. 172.16.0.5 is blocked (RFC1918 172.16/12)', () => {
    expect(isBlockedIPv4('172.16.0.5')).toBe(true);
  });

  it('21. 172.31.255.255 is blocked (boundary of 172.16/12)', () => {
    expect(isBlockedIPv4('172.31.255.255')).toBe(true);
  });

  it('22. 172.32.0.0 is NOT blocked (outside 172.16/12)', () => {
    expect(isBlockedIPv4('172.32.0.0')).toBe(false);
  });

  it('23. 192.168.1.1 is blocked (RFC1918)', () => {
    expect(isBlockedIPv4('192.168.1.1')).toBe(true);
  });

  it('24. 169.254.169.254 is blocked (cloud metadata)', () => {
    expect(isBlockedIPv4('169.254.169.254')).toBe(true);
  });

  it('25. 8.8.8.8 is NOT blocked (public DNS)', () => {
    expect(isBlockedIPv4('8.8.8.8')).toBe(false);
  });
});

describe('isBlockedIPv6', () => {
  it('26. ::1 is blocked (loopback)', () => {
    expect(isBlockedIPv6('::1')).toBe(true);
  });

  it('27. ::ffff:127.0.0.1 is blocked via IPv4-mapped delegation (Pitfall 1)', () => {
    expect(isBlockedIPv6('::ffff:127.0.0.1')).toBe(true);
  });

  it('28. ::ffff:8.8.8.8 is NOT blocked (public IPv4 via mapping)', () => {
    expect(isBlockedIPv6('::ffff:8.8.8.8')).toBe(false);
  });

  it('29. fe80::1 is blocked (link-local)', () => {
    expect(isBlockedIPv6('fe80::1')).toBe(true);
  });

  it('30. fd00:ec2::254 is blocked (AWS IMDS)', () => {
    expect(isBlockedIPv6('fd00:ec2::254')).toBe(true);
  });

  it('31. 2001:4860:4860::8888 is NOT blocked (public IPv6, Google DNS)', () => {
    expect(isBlockedIPv6('2001:4860:4860::8888')).toBe(false);
  });
});

describe('resolveAndValidateHost', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('32. throws blocked_ip:127.0.0.1 when DNS returns loopback', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    await expect(resolveAndValidateHost('blocked-host.example')).rejects.toThrow('blocked_ip:127.0.0.1');
  });

  it('33. resolves with ["8.8.8.8"] for public IP', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    const result = await resolveAndValidateHost('example.com');
    expect(result).toEqual(['8.8.8.8']);
  });

  it('34. throws dns_no_records when DNS returns empty array', async () => {
    lookupMock.mockResolvedValueOnce([]);
    await expect(resolveAndValidateHost('empty-host.example')).rejects.toThrow('dns_no_records');
  });

  it('35. throws blocked_ip:127.0.0.1 when mixed records include one bad IP (all-records check)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(resolveAndValidateHost('mixed-host.example')).rejects.toThrow('blocked_ip:127.0.0.1');
  });
});
