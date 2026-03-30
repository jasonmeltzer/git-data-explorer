import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { TenureMode, CohortLabel, ContributorStats } from '../../shared/types.js';

// Tenure bucket boundaries in seconds (~91 days, ~365 days)
const THREE_MONTHS_S = 3 * 30 * 24 * 3600;   // ~91 days in seconds
const TWELVE_MONTHS_S = 12 * 30 * 24 * 3600;  // ~365 days in seconds

export interface ContributorStatsParams {
  startDate: Date;
  endDate: Date;
  tenureMode: TenureMode;
  repoIds?: number[];
}

type ContributorRow = {
  authorLogin: string;
  cohort: CohortLabel;
  totalCommits: number;
  totalPrs: number;
  avgLinesAdded: number;
  avgLinesDeleted: number;
  avgFilesChanged: number;
  firstCommitAt: string;
};

/**
 * Get per-author aggregate stats for the contributor drill-down table.
 * Filters by date range and complete repo IDs. Returns one row per author.
 *
 * SAFETY: repoIds come from getCompleteRepoIds with integer guard (SEC-01).
 * Never pass user-supplied strings directly into sql.raw interpolation.
 */
export function getContributorStats(params: ContributorStatsParams): ContributorStats[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  const startEpoch = Math.floor(params.startDate.getTime() / 1000);
  const endEpoch = Math.floor(params.endDate.getTime() / 1000);

  // SAFETY: repoIdList values are DB-sourced integers validated by integer guard (SEC-01).
  const repoIdList = completeRepoIds.join(',');

  const tenureExpr =
    params.tenureMode === 'global'
      ? `(CAST(a.first_commit_at AS INTEGER))`
      : `(SELECT MIN(CAST(c2.committed_at AS INTEGER)) FROM commits c2 WHERE c2.author_id = a.id AND c2.repo_id IN (${repoIdList}))`;

  const cohortCase = `
    CASE
      WHEN (${startEpoch} - ${tenureExpr}) < ${THREE_MONTHS_S} THEN '0-3mo'
      WHEN (${startEpoch} - ${tenureExpr}) < ${TWELVE_MONTHS_S} THEN '3-12mo'
      ELSE '1yr+'
    END
  `;

  const rows = db.all(sql.raw(`
    SELECT
      a.github_login AS author_login,
      ${cohortCase} AS cohort,
      COUNT(DISTINCT c.id) AS total_commits,
      COUNT(DISTINCT p.id) AS total_prs,
      COALESCE(AVG(c.lines_added), 0) AS avg_lines_added,
      COALESCE(AVG(c.lines_deleted), 0) AS avg_lines_deleted,
      COALESCE(AVG(c.files_changed), 0) AS avg_files_changed,
      CAST(a.first_commit_at AS INTEGER) AS first_commit_at_epoch
    FROM authors a
    LEFT JOIN commits c
      ON c.author_id = a.id
      AND c.repo_id IN (${repoIdList})
      AND CAST(c.committed_at AS INTEGER) >= ${startEpoch}
      AND CAST(c.committed_at AS INTEGER) <= ${endEpoch}
    LEFT JOIN pull_requests p
      ON p.author_id = a.id
      AND p.repo_id IN (${repoIdList})
      AND CAST(p.created_at AS INTEGER) >= ${startEpoch}
      AND CAST(p.created_at AS INTEGER) <= ${endEpoch}
    WHERE a.is_bot = 0
      AND a.first_commit_at IS NOT NULL
      AND (c.id IS NOT NULL OR p.id IS NOT NULL)
    GROUP BY a.id
    ORDER BY total_commits DESC
  `)) as Array<{
    author_login: string;
    cohort: CohortLabel;
    total_commits: number;
    total_prs: number;
    avg_lines_added: number;
    avg_lines_deleted: number;
    avg_files_changed: number;
    first_commit_at_epoch: number;
  }>;

  return rows.map(row => ({
    authorLogin: row.author_login,
    cohort: row.cohort,
    totalCommits: row.total_commits,
    totalPrs: row.total_prs,
    avgLinesAdded: row.avg_lines_added,
    avgLinesDeleted: row.avg_lines_deleted,
    avgFilesChanged: row.avg_files_changed,
    firstCommitAt: new Date(row.first_commit_at_epoch * 1000).toISOString(),
  }));
}
