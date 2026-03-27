import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type {
  RollingComparisonParams,
  RollingComparisonResult,
  RollingPeriod,
  RollingPeriodMetrics,
} from '../../shared/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute percentage change from prior to current.
 * Returns null when prior is 0 to avoid divide-by-zero.
 */
export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

/**
 * Normalize a total value to a daily average.
 * If periodEnd is in the future relative to `now`, cap it at `now` (partial period).
 */
export function normalizeToDaily(
  total: number,
  periodStart: Date,
  periodEnd: Date,
  now: Date
): number {
  const effectiveEnd = periodEnd > now ? now : periodEnd;
  const days = (effectiveEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24);
  return days > 0 ? total / days : 0;
}

/**
 * Returns [currentPeriod, priorPeriod] for month-over-month comparison.
 * Dates use UTC boundary helpers for deterministic behavior.
 */
export function getMonthOverMonthPeriods(referenceDate: Date): [RollingPeriod, RollingPeriod] {
  // Use UTC-safe approach: create dates from the reference date's UTC year/month
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth(); // 0-based

  const currentStart = new Date(Date.UTC(year, month, 1));
  // End of current month: first day of next month minus 1 ms, but for epoch comparisons
  // we use end of day on last day of month
  const currentEnd = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

  const priorYear = month === 0 ? year - 1 : year;
  const priorMonth = month === 0 ? 11 : month - 1;
  const priorStart = new Date(Date.UTC(priorYear, priorMonth, 1));
  const priorEnd = new Date(Date.UTC(priorYear, priorMonth + 1, 0, 23, 59, 59, 999));

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const currentLabel = `${MONTHS[month]} ${year}`;
  const priorLabel = `${MONTHS[priorMonth]} ${priorYear}`;

  return [
    { label: currentLabel, startDate: currentStart, endDate: currentEnd },
    { label: priorLabel, startDate: priorStart, endDate: priorEnd },
  ];
}

/**
 * Returns [currentPeriod, priorPeriod] for quarter-over-quarter comparison.
 */
export function getQuarterOverQuarterPeriods(referenceDate: Date): [RollingPeriod, RollingPeriod] {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth(); // 0-based
  const quarter = Math.floor(month / 3) + 1; // 1-4

  const currentQStartMonth = (quarter - 1) * 3; // 0, 3, 6, or 9
  const currentQEndMonth = currentQStartMonth + 2;

  const currentStart = new Date(Date.UTC(year, currentQStartMonth, 1));
  const currentEnd = new Date(Date.UTC(year, currentQEndMonth + 1, 0, 23, 59, 59, 999));

  let priorYear = year;
  let priorQuarter = quarter - 1;
  if (priorQuarter === 0) {
    priorQuarter = 4;
    priorYear = year - 1;
  }

  const priorQStartMonth = (priorQuarter - 1) * 3;
  const priorQEndMonth = priorQStartMonth + 2;

  const priorStart = new Date(Date.UTC(priorYear, priorQStartMonth, 1));
  const priorEnd = new Date(Date.UTC(priorYear, priorQEndMonth + 1, 0, 23, 59, 59, 999));

  const currentLabel = `Q${quarter} ${year}`;
  const priorLabel = `Q${priorQuarter} ${priorYear}`;

  return [
    { label: currentLabel, startDate: currentStart, endDate: currentEnd },
    { label: priorLabel, startDate: priorStart, endDate: priorEnd },
  ];
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface PeriodAggregates {
  commits: {
    totalSize: number;    // SUM(lines_added + lines_deleted)
    count: number;        // COUNT(*)
    totalFiles: number;   // SUM(files_changed)
  };
  prs: {
    totalSize: number;
    count: number;
    totalFiles: number;
  };
}

/**
 * Query raw totals for commits and PRs within a date range and set of repos.
 * Bots excluded via is_bot = 0 join.
 */
function getPeriodAggregates(
  startDate: Date,
  endDate: Date,
  completeRepoIds: number[]
): PeriodAggregates {
  const startEpoch = Math.floor(startDate.getTime() / 1000);
  const endEpoch = Math.floor(endDate.getTime() / 1000);
  // SAFETY: repoIdList values come from DB query + integer guard (SEC-01).
  // These are never user-supplied. Do NOT pass user input here without parameterization.
  const repoIdList = completeRepoIds.join(',');

  // If no complete repos, return zero aggregates
  if (completeRepoIds.length === 0) {
    return {
      commits: { totalSize: 0, count: 0, totalFiles: 0 },
      prs: { totalSize: 0, count: 0, totalFiles: 0 },
    };
  }

  const commitRow = db.get(sql.raw(`
    SELECT
      COALESCE(SUM(c.lines_added + c.lines_deleted), 0) AS total_size,
      COUNT(*) AS count,
      COALESCE(SUM(c.files_changed), 0) AS total_files
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.committed_at >= ${startEpoch}
      AND c.committed_at <= ${endEpoch}
      AND c.repo_id IN (${repoIdList})
  `)) as { total_size: number; count: number; total_files: number };

  const prRow = db.get(sql.raw(`
    SELECT
      COALESCE(SUM(pr.lines_added + pr.lines_deleted), 0) AS total_size,
      COUNT(*) AS count,
      COALESCE(SUM(pr.files_changed), 0) AS total_files
    FROM pull_requests pr
    INNER JOIN authors a ON a.id = pr.author_id
    WHERE a.is_bot = 0
      AND pr.created_at >= ${startEpoch}
      AND pr.created_at <= ${endEpoch}
      AND pr.repo_id IN (${repoIdList})
  `)) as { total_size: number; count: number; total_files: number };

  return {
    commits: {
      totalSize: commitRow?.total_size ?? 0,
      count: commitRow?.count ?? 0,
      totalFiles: commitRow?.total_files ?? 0,
    },
    prs: {
      totalSize: prRow?.total_size ?? 0,
      count: prRow?.count ?? 0,
      totalFiles: prRow?.total_files ?? 0,
    },
  };
}

/**
 * Build a RollingPeriodMetrics object from raw aggregates and period boundaries.
 */
function buildPeriodMetrics(
  period: RollingPeriod,
  agg: PeriodAggregates,
  now: Date
): RollingPeriodMetrics {
  const commitCount = agg.commits.count;
  const prCount = agg.prs.count;
  const avgCommitSize = commitCount > 0 ? agg.commits.totalSize / commitCount : 0;
  const avgPrSize = prCount > 0 ? agg.prs.totalSize / prCount : 0;
  const avgFilesPerCommit = commitCount > 0 ? agg.commits.totalFiles / commitCount : 0;
  const avgFilesPerPr = prCount > 0 ? agg.prs.totalFiles / prCount : 0;

  const dailyAvgCommitSize = normalizeToDaily(agg.commits.totalSize, period.startDate, period.endDate, now);
  const dailyAvgPrSize = normalizeToDaily(agg.prs.totalSize, period.startDate, period.endDate, now);
  const dailyCommitCount = normalizeToDaily(agg.commits.count, period.startDate, period.endDate, now);
  const dailyPrCount = normalizeToDaily(agg.prs.count, period.startDate, period.endDate, now);

  return {
    label: period.label,
    startDate: period.startDate.toISOString(),
    endDate: period.endDate.toISOString(),
    avgCommitSize,
    avgPrSize,
    commitCount,
    prCount,
    avgFilesPerCommit,
    avgFilesPerPr,
    dailyAvgCommitSize,
    dailyAvgPrSize,
    dailyCommitCount,
    dailyPrCount,
  };
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Compute rolling window comparison metrics (month-over-month or quarter-over-quarter).
 *
 * Partial current periods are normalized to daily averages for fair comparison.
 * Bot authors and incomplete repos are excluded.
 */
export function getRollingComparison(params: RollingComparisonParams): RollingComparisonResult {
  const now = params.referenceDate ?? new Date();

  const [currentPeriod, priorPeriod] =
    params.granularity === 'month'
      ? getMonthOverMonthPeriods(now)
      : getQuarterOverQuarterPeriods(now);

  const completeRepoIds = getCompleteRepoIds(params.repoIds);

  const currentAgg = getPeriodAggregates(currentPeriod.startDate, currentPeriod.endDate, completeRepoIds);
  const priorAgg = getPeriodAggregates(priorPeriod.startDate, priorPeriod.endDate, completeRepoIds);

  const currentMetrics = buildPeriodMetrics(currentPeriod, currentAgg, now);
  const priorMetrics = buildPeriodMetrics(priorPeriod, priorAgg, now);

  // Compute percentage changes using daily averages (normalizes for partial periods)
  const changes = {
    commitSize: pctChange(currentMetrics.dailyAvgCommitSize, priorMetrics.dailyAvgCommitSize),
    prSize: pctChange(currentMetrics.dailyAvgPrSize, priorMetrics.dailyAvgPrSize),
    commitFrequency: pctChange(currentMetrics.dailyCommitCount, priorMetrics.dailyCommitCount),
    prFrequency: pctChange(currentMetrics.dailyPrCount, priorMetrics.dailyPrCount),
  };

  return {
    granularity: params.granularity,
    current: currentMetrics,
    prior: priorMetrics,
    changes,
  };
}
