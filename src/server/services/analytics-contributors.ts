import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { TenureMode, CohortLabel, ContributorStats, ContributorBeforeAfterStats } from '../../shared/types.js';
import { getThresholdSeconds } from '../../shared/cohort-config.js';
import { getCohortConfig } from './cohort-config-service.js';

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

  const config = getCohortConfig();
  const [t1Seconds, t2Seconds] = getThresholdSeconds(config);
  const [t0, t1Thresh, t2Thresh] = config.thresholds;
  const cohortCase = `
    CASE
      WHEN (${startEpoch} - ${tenureExpr}) < ${t1Seconds} THEN '${t0.key}'
      WHEN (${startEpoch} - ${tenureExpr}) < ${t2Seconds} THEN '${t1Thresh.key}'
      ELSE '${t2Thresh.key}'
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

export interface ContributorBeforeAfterParams {
  startDate: Date;
  endDate: Date;
  aiMarkerDate: Date;
  tenureMode: TenureMode;
  repoIds?: number[];
}

/**
 * Get per-author stats split at the AI marker date.
 * Runs getContributorStats twice (pre/post) and joins by authorLogin.
 * Contributors present in only one period get null for the missing side.
 */
export function getContributorBeforeAfterStats(params: ContributorBeforeAfterParams): ContributorBeforeAfterStats[] {
  const { startDate, endDate, aiMarkerDate, tenureMode, repoIds } = params;

  // Pre-AI period: startDate to day before marker
  const preEnd = new Date(aiMarkerDate.getTime() - 1);
  const preStats = getContributorStats({ startDate, endDate: preEnd, tenureMode, repoIds });

  // Post-AI period: marker to endDate
  const postStats = getContributorStats({ startDate: aiMarkerDate, endDate, tenureMode, repoIds });

  // Build lookup maps
  const preMap = new Map(preStats.map(s => [s.authorLogin, s]));
  const postMap = new Map(postStats.map(s => [s.authorLogin, s]));

  // Union of all logins
  const allLogins = new Set([...preMap.keys(), ...postMap.keys()]);

  return Array.from(allLogins).map(login => {
    const pre = preMap.get(login) ?? null;
    const post = postMap.get(login) ?? null;
    const either = pre ?? post!;
    return {
      authorLogin: login,
      cohort: either.cohort,
      firstCommitAt: either.firstCommitAt,
      pre,
      post,
    };
  });
}
