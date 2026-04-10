/**
 * CSV flattening helpers for nested export bundle objects.
 *
 * These functions convert nested object types (rolling comparison, before/after,
 * executive summary) into flat CSV rows suitable for inclusion in CSV-format exports.
 */

import { toCsv } from './csv-serializer.js';
import type { RollingComparisonResult } from '@shared/types.js';
import type { BeforeAfterComparison, ExecutiveSummary } from '@shared/export-types.js';

/**
 * Flatten a RollingComparisonResult into a 3-row CSV string.
 *
 * Rows:
 *   1. "current" — current period metrics
 *   2. "prior"   — prior period metrics
 *   3. "changes" — percentage change values between current and prior
 */
export function rollingToCsv(rolling: RollingComparisonResult): string {
  const headers = [
    'period',
    'label',
    'startDate',
    'endDate',
    'avgCommitSize',
    'avgPrSize',
    'commitCount',
    'prCount',
    'avgFilesPerCommit',
    'avgFilesPerPr',
    'dailyAvgCommitSize',
    'dailyAvgPrSize',
    'dailyCommitCount',
    'dailyPrCount',
  ];

  const currentRow = [
    'current',
    rolling.current.label,
    rolling.current.startDate,
    rolling.current.endDate,
    rolling.current.avgCommitSize,
    rolling.current.avgPrSize,
    rolling.current.commitCount,
    rolling.current.prCount,
    rolling.current.avgFilesPerCommit,
    rolling.current.avgFilesPerPr,
    rolling.current.dailyAvgCommitSize,
    rolling.current.dailyAvgPrSize,
    rolling.current.dailyCommitCount,
    rolling.current.dailyPrCount,
  ];

  const priorRow = [
    'prior',
    rolling.prior.label,
    rolling.prior.startDate,
    rolling.prior.endDate,
    rolling.prior.avgCommitSize,
    rolling.prior.avgPrSize,
    rolling.prior.commitCount,
    rolling.prior.prCount,
    rolling.prior.avgFilesPerCommit,
    rolling.prior.avgFilesPerPr,
    rolling.prior.dailyAvgCommitSize,
    rolling.prior.dailyAvgPrSize,
    rolling.prior.dailyCommitCount,
    rolling.prior.dailyPrCount,
  ];

  // Changes row uses the change fields; non-applicable columns are empty
  const changesRow = [
    'changes',
    null,                              // label — not applicable
    null,                              // startDate — not applicable
    null,                              // endDate — not applicable
    rolling.changes.commitSize,        // avgCommitSize pct change
    rolling.changes.prSize,            // avgPrSize pct change
    rolling.changes.commitFrequency,   // commitCount pct change
    rolling.changes.prFrequency,       // prCount pct change
    null,                              // avgFilesPerCommit — no change metric
    null,                              // avgFilesPerPr — no change metric
    rolling.changes.commitSize,        // dailyAvgCommitSize — same pct
    rolling.changes.prSize,            // dailyAvgPrSize — same pct
    rolling.changes.commitFrequency,   // dailyCommitCount pct change
    rolling.changes.prFrequency,       // dailyPrCount pct change
  ];

  return toCsv(headers, [currentRow, priorRow, changesRow]);
}

/**
 * Flatten a BeforeAfterComparison into a 2-row CSV string.
 *
 * Rows:
 *   1. "before" — metrics before the AI marker date
 *   2. "after"  — metrics after the AI marker date
 */
export function beforeAfterToCsv(ba: BeforeAfterComparison): string {
  const headers = [
    'period',
    'avgCommitSize',
    'prFrequency',
    'rampUpSpeed',
    'activeContributors',
    'markerDate',
  ];

  const beforeRow = [
    'before',
    ba.before.avgCommitSize,
    ba.before.prFrequency,
    ba.before.rampUpSpeed,
    ba.before.activeContributors,
    ba.markerDate,
  ];

  const afterRow = [
    'after',
    ba.after.avgCommitSize,
    ba.after.prFrequency,
    ba.after.rampUpSpeed,
    ba.after.activeContributors,
    ba.markerDate,
  ];

  return toCsv(headers, [beforeRow, afterRow]);
}

/**
 * Flatten an ExecutiveSummary into a 1-row CSV string.
 */
export function executiveSummaryToCsv(summary: ExecutiveSummary): string {
  const headers = [
    'totalCommits',
    'activeContributors',
    'rampUpTrend',
    'aiAdoptionDelta',
  ];

  const row = [
    summary.totalCommits,
    summary.activeContributors,
    summary.rampUpTrend,
    summary.aiAdoptionDelta,
  ];

  return toCsv(headers, [row]);
}
