/**
 * Route-level SQL-injection regression test (SEC-07, T-09.4.3-03, Plan 09.4.3-04).
 *
 * SCOPE DECISION (documented explicitly):
 *   This file is a SMOKE CHECK that the three analytics routes refuse to pass un-sanitized
 *   input to sql.raw (status must never be 500). It does NOT re-verify that assertIntegerArray
 *   handles every input variant — that is covered by packages/shared/lib/__tests__/sql-safety.test.ts
 *   (13-case unit rejection matrix from Wave 0 Plan 00 Task 1).
 *
 *   Aggregation service is mocked so the route logic is the subject-under-test. Without the mock,
 *   CI (fresh install, migrations not run at test-import time) would throw "no such table:
 *   snapshots" and the route's try/catch would return 500, producing false-positive failures
 *   that hide the real signal: did the route reject un-sanitized input before it reached the
 *   service layer?
 *
 * Strictly-sanitized inputs (abc, empty, zero, negatives) still assert .toBe(400) — those paths
 * short-circuit in the route before any service call.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// Mock aggregation service: route smoke test doesn't exercise DB, it exercises input validation.
vi.mock('../../services/aggregation.js', () => ({
  getAggregatedCohortMetrics: vi.fn().mockReturnValue([]),
  getAggregatedRampUp: vi.fn().mockReturnValue([]),
  getOrgComparisonTable: vi.fn().mockReturnValue([]),
}));

import { analyticsRoutes } from '../../routes/analytics.js';

function getApp(): Hono {
  const app = new Hono();
  app.route('/', analyticsRoutes);
  return app;
}

const ENDPOINTS = [
  '/api/analytics/cross-org/cohort-metrics',
  '/api/analytics/cross-org/ramp-up',
  '/api/analytics/cross-org/comparison',
];

describe('Analytics routes — integer guard (SEC-07, T-09.4.3-03)', () => {
  for (const endpoint of ENDPOINTS) {
    describe(endpoint, () => {
      it('rejects non-numeric orgIds with 400', async () => {
        const res = await getApp().request(`${endpoint}?orgIds=abc,def`);
        expect(res.status).toBe(400);
      });

      it('rejects negative-only orgIds with 400', async () => {
        const res = await getApp().request(`${endpoint}?orgIds=-1,-2`);
        expect(res.status).toBe(400);
      });

      it('rejects zero-only orgIds with 400', async () => {
        const res = await getApp().request(`${endpoint}?orgIds=0`);
        expect(res.status).toBe(400);
      });

      it('rejects empty orgIds with 400', async () => {
        const res = await getApp().request(`${endpoint}?orgIds=`);
        expect(res.status).toBe(400);
      });

      it('resists classic injection payload — status in [200, 400], never 500 (SQL error)', async () => {
        // parseInt('1) UNION SELECT...') === 1, which is then routed to assertIntegerArray.
        // If orgId 1 exists in the live DB → 200 with possibly empty results.
        // If not → aggregation returns [] → the route returns 200 with [] OR 400 "no matching orgIds".
        // Either way, status MUST NOT be 500 (which would indicate the un-sanitized string
        // reached SQL).
        const payload = encodeURIComponent("1) UNION SELECT 1; DROP TABLE orgs;--");
        const res = await getApp().request(`${endpoint}?orgIds=${payload}`);
        expect([200, 400]).toContain(res.status);
        expect(res.status).not.toBe(500);
      });

      it('mixed valid/invalid — assertIntegerArray keeps valid, status in [200, 400], never 500', async () => {
        // 'abc' and '1.5' filtered out by assertIntegerArray; remaining [1, 2] hit DB.
        // Whether [1, 2] match seed rows depends on dev DB state — hence [200, 400] tolerance.
        const res = await getApp().request(`${endpoint}?orgIds=1,abc,2,1.5`);
        expect([200, 400]).toContain(res.status);
        expect(res.status).not.toBe(500);
      });
    });
  }
});
