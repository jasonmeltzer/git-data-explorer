import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type {
  TenureMode,
  CohortLabel,
  ContributorStats,
  ContributorBeforeAfterStats,
  ContributorRepoStats,
  ContributorRepoBeforeAfterStats,
} from '../../shared/types.js';
import { getThresholdSeconds } from '../../shared/cohort-config.js';
import { getCohortConfig } from './cohort-config-service.js';

export interface ContributorStatsParams {
  startDate: Date;
  endDate: Date;
  tenureMode: TenureMode;
  repoIds?: number[];
}

/**
 * Get per-author aggregate stats for the contributor drill-down table.
 *
 * In global mode: returns one row per author using authors.first_commit_at for tenure.
 * In per-repo mode: returns one row per (author, repo) using MIN(committed_at) within
 * each repo for tenure — so an author with commits in multiple repos gets separate
 * cohort assignments per repo.
 *
 * SAFETY: repoIds come from getCompleteRepoIds with integer guard (SEC-01).
 * Never pass user-supplied strings directly into sql.raw interpolation.
 */
export function getContributorStats(params: ContributorStatsParams): ContributorStats[] | ContributorRepoStats[] {
  if (params.tenureMode === 'repo') {
    return getContributorStatsPerRepo(params);
  }
  return getContributorStatsGlobal(params);
}

function getContributorStatsGlobal(params: ContributorStatsParams): ContributorStats[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  const startEpoch = Math.floor(params.startDate.getTime() / 1000);
  const endEpoch = Math.floor(params.endDate.getTime() / 1000);

  // SAFETY: repoIdList values are DB-sourced integers validated by integer guard (SEC-01).
  const repoIdList = completeRepoIds.join(',');

  const tenureExpr = `(CAST(a.first_commit_at AS INTEGER))`;

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

/**
 * Per-repo mode: returns one row per (author, repo) pair.
 * Cohort is based on MIN(committed_at) within that specific repo only — not across all repos.
 * PR counts are scoped to the same repo.
 */
function getContributorStatsPerRepo(params: ContributorStatsParams): ContributorRepoStats[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  const startEpoch = Math.floor(params.startDate.getTime() / 1000);
  const endEpoch = Math.floor(params.endDate.getTime() / 1000);

  // SAFETY: repoIdList values are DB-sourced integers validated by integer guard (SEC-01).
  const repoIdList = completeRepoIds.join(',');

  const config = getCohortConfig();
  const [t1Seconds, t2Seconds] = getThresholdSeconds(config);
  const [t0, t1Thresh, t2Thresh] = config.thresholds;

  // CRITICAL: GROUP BY a.id, c.repo_id ensures one row per (author, repo).
  // Per-repo tenure uses a correlated subquery for true first commit in this repo (across ALL time,
  // not just the analysis window). This matches analytics-cohorts.ts per-repo behavior.
  // The analysis window filter only determines WHICH commits count toward metrics (commits, PRs, avgs).
  const rows = db.all(sql.raw(`
    SELECT
      a.github_login AS author_login,
      r.full_name AS repo_full_name,
      r.id AS repo_id,
      CASE
        WHEN (${startEpoch} - (SELECT MIN(CAST(c2.committed_at AS INTEGER)) FROM commits c2 WHERE c2.author_id = a.id AND c2.repo_id = c.repo_id)) < ${t1Seconds} THEN '${t0.key}'
        WHEN (${startEpoch} - (SELECT MIN(CAST(c2.committed_at AS INTEGER)) FROM commits c2 WHERE c2.author_id = a.id AND c2.repo_id = c.repo_id)) < ${t2Seconds} THEN '${t1Thresh.key}'
        ELSE '${t2Thresh.key}'
      END AS cohort,
      COUNT(DISTINCT c.id) AS total_commits,
      (SELECT COUNT(DISTINCT p.id) FROM pull_requests p
        WHERE p.author_id = a.id AND p.repo_id = c.repo_id
        AND CAST(p.created_at AS INTEGER) >= ${startEpoch}
        AND CAST(p.created_at AS INTEGER) <= ${endEpoch}) AS total_prs,
      COALESCE(AVG(c.lines_added), 0) AS avg_lines_added,
      COALESCE(AVG(c.lines_deleted), 0) AS avg_lines_deleted,
      COALESCE(AVG(c.files_changed), 0) AS avg_files_changed,
      CAST(a.first_commit_at AS INTEGER) AS first_commit_at_epoch,
      (SELECT MIN(CAST(c2.committed_at AS INTEGER)) FROM commits c2 WHERE c2.author_id = a.id AND c2.repo_id = c.repo_id) AS first_commit_in_repo_epoch
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    INNER JOIN repositories r ON r.id = c.repo_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
      AND CAST(c.committed_at AS INTEGER) >= ${startEpoch}
      AND CAST(c.committed_at AS INTEGER) <= ${endEpoch}
    GROUP BY a.id, c.repo_id
    ORDER BY a.github_login ASC, total_commits DESC
  `)) as Array<{
    author_login: string;
    repo_full_name: string;
    repo_id: number;
    cohort: CohortLabel;
    total_commits: number;
    total_prs: number;
    avg_lines_added: number;
    avg_lines_deleted: number;
    avg_files_changed: number;
    first_commit_at_epoch: number;
    first_commit_in_repo_epoch: number;
  }>;

  return rows.map(row => ({
    authorLogin: row.author_login,
    repoId: row.repo_id,
    repoFullName: row.repo_full_name,
    cohort: row.cohort,
    totalCommits: row.total_commits,
    totalPrs: row.total_prs,
    avgLinesAdded: row.avg_lines_added,
    avgLinesDeleted: row.avg_lines_deleted,
    avgFilesChanged: row.avg_files_changed,
    firstCommitAt: new Date(row.first_commit_at_epoch * 1000).toISOString(),
    firstCommitInRepoAt: new Date(row.first_commit_in_repo_epoch * 1000).toISOString(),
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
 *
 * In global mode: joins by authorLogin. Returns ContributorBeforeAfterStats[].
 * In per-repo mode: joins by composite key (authorLogin::repoId). Returns
 * ContributorRepoBeforeAfterStats[] so each author-repo pair has its own pre/post split.
 *
 * Contributors present in only one period get null for the missing side.
 */
export function getContributorBeforeAfterStats(
  params: ContributorBeforeAfterParams
): ContributorBeforeAfterStats[] | ContributorRepoBeforeAfterStats[] {
  const { startDate, endDate, aiMarkerDate, tenureMode, repoIds } = params;

  // Pre-AI period: all data up to day before marker (ignores dashboard startDate
  // so that pre-AI stats are complete even when the dashboard filter is narrow)
  const preEnd = new Date(aiMarkerDate.getTime() - 1);
  const preStats = getContributorStats({ startDate: new Date(0), endDate: preEnd, tenureMode, repoIds });

  // Post-AI period: marker to endDate
  const postStats = getContributorStats({ startDate: aiMarkerDate, endDate, tenureMode, repoIds });

  if (tenureMode === 'repo') {
    // Per-repo mode: composite key (authorLogin::repoId) to keep author-repo pairs separate
    const preMap = new Map(
      (preStats as ContributorRepoStats[]).map(s => [`${s.authorLogin}::${s.repoId}`, s])
    );
    const postMap = new Map(
      (postStats as ContributorRepoStats[]).map(s => [`${s.authorLogin}::${s.repoId}`, s])
    );

    const allKeys = new Set([...preMap.keys(), ...postMap.keys()]);

    return Array.from(allKeys).map(key => {
      const pre = preMap.get(key) ?? null;
      const post = postMap.get(key) ?? null;
      const either = (pre ?? post)!;
      return {
        authorLogin: either.authorLogin,
        repoId: either.repoId,
        repoFullName: either.repoFullName,
        cohort: either.cohort,
        firstCommitInRepoAt: either.firstCommitInRepoAt,
        firstCommitAt: either.firstCommitAt,
        pre,
        post,
      } as ContributorRepoBeforeAfterStats;
    });
  }

  // Global mode: join by authorLogin (unchanged behavior)
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
    } as ContributorBeforeAfterStats;
  });
}
