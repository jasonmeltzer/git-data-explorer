import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { CohortMetricsParams, CohortMetricsRow, CohortLabel, PeriodLabel } from '../../shared/types.js';

// Tenure bucket boundaries in seconds (~91 days, ~365 days)
const THREE_MONTHS_S = 3 * 30 * 24 * 3600;   // ~91 days in seconds
const TWELVE_MONTHS_S = 12 * 30 * 24 * 3600;  // ~365 days in seconds

/**
 * Build the CASE WHEN SQL for cohort assignment.
 * For global tenure: uses authors.first_commit_at vs commits.committed_at
 * For repo tenure: uses MIN(committed_at) per (author_id, repo_id) subquery
 */
function buildCohortCase(tenureMode: 'global' | 'repo', dataPointColumn: string): string {
  const tenureExpr =
    tenureMode === 'global'
      ? `(${dataPointColumn} - a.first_commit_at)`
      : `(${dataPointColumn} - (SELECT MIN(c2.committed_at) FROM commits c2 WHERE c2.author_id = c.author_id AND c2.repo_id = c.repo_id))`;

  return `
    CASE
      WHEN ${tenureExpr} < ${THREE_MONTHS_S} THEN '0-3mo'
      WHEN ${tenureExpr} < ${TWELVE_MONTHS_S} THEN '3-12mo'
      ELSE '1yr+'
    END
  `;
}

/**
 * Build the period CASE WHEN SQL.
 * When aiMarkerDate is provided, split into 'before'/'after'.
 * Otherwise, return literal 'all'.
 */
function buildPeriodCase(dataPointColumn: string, aiMarkerDate?: Date | null): string {
  if (!aiMarkerDate) {
    return `'all'`;
  }
  const markerEpoch = Math.floor(aiMarkerDate.getTime() / 1000);
  return `CASE WHEN ${dataPointColumn} < ${markerEpoch} THEN 'before' ELSE 'after' END`;
}

/**
 * Get cohort-bucketed commit metrics.
 * Returns rows grouped by (cohort, period, periodMonth) with aggregate metrics.
 */
export function getCohortCommitMetrics(params: CohortMetricsParams): CohortMetricsRow[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  const startEpoch = Math.floor(params.startDate.getTime() / 1000);
  const endEpoch = Math.floor(params.endDate.getTime() / 1000);

  const repoIdList = completeRepoIds.join(',');
  const cohortCase = buildCohortCase(params.tenureMode, 'c.committed_at');
  const periodCase = buildPeriodCase('c.committed_at', params.aiMarkerDate);

  const nullCheck = params.tenureMode === 'global' ? `AND a.first_commit_at IS NOT NULL` : '';

  const rows = db.all(sql.raw(`
    SELECT
      ${cohortCase} AS cohort,
      ${periodCase} AS period,
      strftime('%Y-%m', c.committed_at, 'unixepoch') AS period_month,
      AVG(c.lines_added) AS avg_lines_added,
      AVG(c.lines_deleted) AS avg_lines_deleted,
      AVG(c.files_changed) AS avg_files_changed,
      COUNT(*) AS total_count,
      COUNT(DISTINCT c.author_id) AS contributor_count
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      ${nullCheck}
      AND c.committed_at >= ${startEpoch}
      AND c.committed_at <= ${endEpoch}
      AND c.repo_id IN (${repoIdList})
    GROUP BY cohort, period, period_month
    ORDER BY period_month, cohort, period
  `)) as Array<{
    cohort: string;
    period: string;
    period_month: string;
    avg_lines_added: number;
    avg_lines_deleted: number;
    avg_files_changed: number;
    total_count: number;
    contributor_count: number;
  }>;

  return rows.map(r => ({
    cohort: r.cohort as CohortLabel,
    period: r.period as PeriodLabel,
    periodMonth: r.period_month,
    avgLinesAdded: r.avg_lines_added,
    avgLinesDeleted: r.avg_lines_deleted,
    avgFilesChanged: r.avg_files_changed,
    totalCount: r.total_count,
    contributorCount: r.contributor_count,
  }));
}

/**
 * Get cohort-bucketed PR metrics.
 * Same logic as getCohortCommitMetrics but queries pull_requests using created_at.
 */
export function getCohortPrMetrics(params: CohortMetricsParams): CohortMetricsRow[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  const startEpoch = Math.floor(params.startDate.getTime() / 1000);
  const endEpoch = Math.floor(params.endDate.getTime() / 1000);

  const repoIdList = completeRepoIds.join(',');

  // For PR per-repo tenure, we still use commits table to find MIN(committed_at)
  // PR cohort uses the author's global first_commit_at (or per-repo if tenureMode='repo')
  const prTenureExpr =
    params.tenureMode === 'global'
      ? `(pr.created_at - a.first_commit_at)`
      : `(pr.created_at - (SELECT MIN(c2.committed_at) FROM commits c2 WHERE c2.author_id = pr.author_id AND c2.repo_id = pr.repo_id))`;

  const cohortCase = `
    CASE
      WHEN ${prTenureExpr} < ${THREE_MONTHS_S} THEN '0-3mo'
      WHEN ${prTenureExpr} < ${TWELVE_MONTHS_S} THEN '3-12mo'
      ELSE '1yr+'
    END
  `;

  const periodCase = buildPeriodCase('pr.created_at', params.aiMarkerDate);
  const nullCheck = params.tenureMode === 'global' ? `AND a.first_commit_at IS NOT NULL` : '';

  const rows = db.all(sql.raw(`
    SELECT
      ${cohortCase} AS cohort,
      ${periodCase} AS period,
      strftime('%Y-%m', pr.created_at, 'unixepoch') AS period_month,
      AVG(pr.lines_added) AS avg_lines_added,
      AVG(pr.lines_deleted) AS avg_lines_deleted,
      AVG(pr.files_changed) AS avg_files_changed,
      COUNT(*) AS total_count,
      COUNT(DISTINCT pr.author_id) AS contributor_count
    FROM pull_requests pr
    INNER JOIN authors a ON a.id = pr.author_id
    WHERE a.is_bot = 0
      ${nullCheck}
      AND pr.created_at >= ${startEpoch}
      AND pr.created_at <= ${endEpoch}
      AND pr.repo_id IN (${repoIdList})
    GROUP BY cohort, period, period_month
    ORDER BY period_month, cohort, period
  `)) as Array<{
    cohort: string;
    period: string;
    period_month: string;
    avg_lines_added: number;
    avg_lines_deleted: number;
    avg_files_changed: number;
    total_count: number;
    contributor_count: number;
  }>;

  return rows.map(r => ({
    cohort: r.cohort as CohortLabel,
    period: r.period as PeriodLabel,
    periodMonth: r.period_month,
    avgLinesAdded: r.avg_lines_added,
    avgLinesDeleted: r.avg_lines_deleted,
    avgFilesChanged: r.avg_files_changed,
    totalCount: r.total_count,
    contributorCount: r.contributor_count,
  }));
}
