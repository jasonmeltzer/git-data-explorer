/**
 * CSV flattening helpers for nested export bundle objects.
 *
 * These functions convert nested object types (rolling comparison, period metrics,
 * executive summary, concentration, headcount) into flat CSV rows suitable for
 * inclusion in CSV-format exports.
 */

import { toCsv } from './csv-serializer.js';
import type { RollingComparisonResult } from '@shared/types.js';
import type { ExecutiveSummary, PeriodMetric, ConcentrationMonthlyRow, HeadcountMonthlyRow } from '@shared/export-types.js';

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
 * Flatten a PeriodMetric[] into a CSV string.
 *
 * One row per period. Metric keys are derived from the first entry's metrics object.
 * If the array is empty, returns an empty string.
 */
export function periodMetricsToCsv(periods: PeriodMetric[]): string {
  if (periods.length === 0) return '';

  // Collect all metric keys across all periods for consistent columns
  const metricKeys = Array.from(
    new Set(periods.flatMap((p) => Object.keys(p.metrics)))
  );

  const headers = ['label', 'startDate', 'endDate', 'markerDate', ...metricKeys];

  const rows = periods.map((p) => [
    p.period.label,
    p.period.startDate,
    p.period.endDate,
    p.period.markerDate ?? null,
    ...metricKeys.map((k) => p.metrics[k] ?? null),
  ]);

  return toCsv(headers, rows);
}

/**
 * Flatten a ConcentrationMonthlyRow[] into a CSV string.
 */
export function concentrationMonthlyToCsv(rows: ConcentrationMonthlyRow[]): string {
  if (rows.length === 0) return '';
  const headers = [
    'month', 'basis', 'top1Share', 'top3Share', 'top5Share',
    'hhi', 'gini', 'busFactor', 'activeDevs', 'topContributor',
  ];
  const data = rows.map((r) => [
    r.month, r.basis, r.top1Share, r.top3Share, r.top5Share,
    r.hhi, r.gini, r.busFactor, r.activeDevs, r.topContributor,
  ]);
  return toCsv(headers, data);
}

/**
 * Flatten a HeadcountMonthlyRow[] into a CSV string.
 */
export function headcountMonthlyToCsv(rows: HeadcountMonthlyRow[]): string {
  if (rows.length === 0) return '';
  const headers = [
    'month', 'activeDevs', 'totalPrs', 'totalCommits', 'prsPerDev', 'commitsPerDev',
  ];
  const data = rows.map((r) => [
    r.month, r.activeDevs, r.totalPrs, r.totalCommits, r.prsPerDev, r.commitsPerDev,
  ]);
  return toCsv(headers, data);
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
