import { describe, test, vi } from 'vitest';

// ── Module mock (must be hoisted before service imports) ──────────────────────
vi.mock('../db/client.js', () => ({
  db: null,
  sqlite: null,
}));

/**
 * Test stubs for the period-metrics service (D-13).
 * This service replaces analytics-before-after.ts — it accepts Period[] and returns
 * PeriodMetric[] instead of a fixed before/after shape.
 *
 * Service import path (will fail until Plan 04a creates the service — RED state):
 * import { getPeriodMetrics } from '../services/analytics-period-metrics.js';
 */

// ── getPeriodMetrics ──────────────────────────────────────────────────────────

describe('getPeriodMetrics', () => {
  /**
   * D-13: Returns PeriodMetric[] where each entry has a Period and a metrics Record.
   * The canonical 4 metric keys are: avgCommitSize, prFrequency, rampUpSpeed, activeContributors.
   */
  test.todo('returns PeriodMetric[] with correct period labels when called with 2-period array (Pre-AI, Post-AI)');
  test.todo('computes avgCommitSize, prFrequency, rampUpSpeed, activeContributors per period');
  test.todo('returns empty array when no complete repos exist (getCompleteRepoIds returns [])');
  test.todo('single period (no marker) returns length-1 PeriodMetric[] with label All-time');
  test.todo('PeriodMetric.period carries the same startDate/endDate/label as the input Period');
  test.todo('metrics values are numbers or null (rampUpSpeed is null when no qualifying devs)');
});
