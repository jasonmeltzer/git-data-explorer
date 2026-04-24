/**
 * SCOPE: route-level smoke check that SSRF rejections surface through the
 * JSON response body BEFORE any side effect (DNS/DB/fetch). Guard correctness
 * (every IP encoding, every localhost alias, every credential variant) is
 * verified at unit level in url-safety.test.ts (35-case matrix). This file
 * exists to catch regressions where the route forgets to CALL isSafeUrl().
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Mock dns so resolveAndValidateHost doesn't attempt real DNS lookups
vi.mock('node:dns', () => ({
  promises: {
    lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
  },
}));

// Mock the import-service so no real fetch/DB work happens
vi.mock('../../services/import-service.js', () => ({
  importBundle: vi.fn().mockReturnValue({ orgId: 1, snapshotId: 1, warnings: [], isDuplicate: false }),
  importFromUrl: vi.fn().mockResolvedValue({}),
  importFromDirectory: vi.fn().mockReturnValue([]),
  parseZipBundle: vi.fn().mockReturnValue({}),
}));

let app: Hono;

beforeAll(async () => {
  const { default: importRoutes } = await import('../../routes/import.js');
  app = new Hono();
  app.route('/', importRoutes);
});

// Each case: [inputUrl, expectedReasonSubstring]
const SSRF_REJECTION_CASES: [string, string][] = [
  ['http://example.com/bundle.json',           'non_https'],
  ['https://localhost/bundle.json',            'localhost_alias'],
  ['https://127.0.0.1/bundle.json',           'ip_literal_host'],
  ['https://[::1]/bundle.json',               'ip_literal_host'],
  ['https://2130706433/bundle.json',          'ip_literal_host'],
  ['https://0x7f000001/bundle.json',          'ip_literal_host'],
  ['https://10.0.0.1/bundle.json',            'ip_literal_host'],
  ['https://192.168.1.1/bundle.json',         'ip_literal_host'],
  ['https://169.254.169.254/bundle.json',     'ip_literal_host'],
  ['https://[::ffff:127.0.0.1]/bundle.json',  'ip_literal_host'],
  ['https://user:pass@example.com/bundle.json', 'credentials_in_url'],
  ['file:///etc/passwd',                       'non_https'],
];

describe('POST /api/import/url — SSRF rejection smoke check', () => {
  for (const [inputUrl, expectedReason] of SSRF_REJECTION_CASES) {
    it(`rejects "${inputUrl}" → ${expectedReason}`, async () => {
      // Scope note: the route returns 400 synchronously from isSafeUrl before DNS or DB is touched.
      // We do NOT depend on in-memory DB state — reject status must be 400 regardless.
      const res = await app.request('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { success: boolean; errors: string[] };
      expect(body.errors.join(',')).toContain(expectedReason);
    });
  }
});
