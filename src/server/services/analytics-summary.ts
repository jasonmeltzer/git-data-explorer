import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import { getAiMarkerDate } from './analytics-config.js';

export interface ExecutiveSummary {
  totalCommits: number;
  activeContributors: number;       // unique non-bot authors
  rampUpTrend: string | null;       // e.g., "+18% faster" or null if no AI marker
  aiAdoptionDelta: string | null;   // e.g., "+34% avg PR size" or null
}

export interface ExecutiveSummaryParams {
  startDate?: string;
  endDate?: string;
  repoIds?: number[];
}

export function getExecutiveSummary(params: ExecutiveSummaryParams): ExecutiveSummary {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) {
    return { totalCommits: 0, activeContributors: 0, rampUpTrend: null, aiAdoptionDelta: null };
  }

  // SAFETY: completeRepoIds come from DB query + integer guard (SEC-01).
  const repoIdList = completeRepoIds.join(',');

  const startEpoch = params.startDate ? Math.floor(new Date(params.startDate).getTime() / 1000) : null;
  const endEpoch = params.endDate ? Math.floor(new Date(params.endDate).getTime() / 1000) : null;

  const commitDateFilter = [
    startEpoch != null ? `AND c.committed_at >= ${startEpoch}` : '',
    endEpoch != null ? `AND c.committed_at <= ${endEpoch}` : '',
  ].join(' ');


  // Total commits
  const commitResult = db.get(sql.raw(`
    SELECT COUNT(*) AS total_commits
    FROM commits c
    WHERE c.repo_id IN (${repoIdList})
      ${commitDateFilter}
  `)) as { total_commits: number } | undefined;

  const totalCommits = commitResult?.total_commits ?? 0;

  // Active contributors (non-bot authors with commits in range)
  const contributorResult = db.get(sql.raw(`
    SELECT COUNT(DISTINCT c.author_id) AS active_contributors
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
      ${commitDateFilter}
  `)) as { active_contributors: number } | undefined;

  const activeContributors = contributorResult?.active_contributors ?? 0;

  // AI-dependent metrics — return null if no marker set
  const markerDate = getAiMarkerDate();
  if (!markerDate) {
    return { totalCommits, activeContributors, rampUpTrend: null, aiAdoptionDelta: null };
  }

  const markerEpoch = Math.floor(markerDate.getTime() / 1000);

  // rampUpTrend: compare avg time-to-first-meaningful-commit for authors who
  // joined before vs after the AI marker. "Meaningful" = first commit with >=50 lines.
  // For each non-bot author, find MIN(committed_at) where lines_added >= 50,
  // compute the gap from their first_commit_at, then average by cohort.
  // NOTE: No date range filter — before/after comparison spans all available data
  const rampUpResult = db.get(sql.raw(`
    WITH author_rampup AS (
      SELECT
        a.id AS author_id,
        a.first_commit_at,
        MIN(c.committed_at) AS first_big_commit_at
      FROM authors a
      INNER JOIN commits c ON c.author_id = a.id
      WHERE a.is_bot = 0
        AND a.first_commit_at IS NOT NULL
        AND c.lines_added >= 50
        AND c.repo_id IN (${repoIdList})
      GROUP BY a.id
    )
    SELECT
      AVG(CASE WHEN first_commit_at < ${markerEpoch}
        THEN first_big_commit_at - first_commit_at END) AS before_avg,
      AVG(CASE WHEN first_commit_at >= ${markerEpoch}
        THEN first_big_commit_at - first_commit_at END) AS after_avg
    FROM author_rampup
  `)) as { before_avg: number | null; after_avg: number | null } | undefined;

  let rampUpTrend: string | null = null;
  const beforeAvg = rampUpResult?.before_avg ?? null;
  const afterAvg = rampUpResult?.after_avg ?? null;
  if (beforeAvg != null && afterAvg != null && beforeAvg > 0) {
    const pctChange = ((afterAvg - beforeAvg) / beforeAvg) * 100;
    const direction = pctChange < 0 ? '+' : '-';
    rampUpTrend = `${direction}${Math.abs(Math.round(pctChange))}% faster`;
  } else {
    rampUpTrend = 'Not enough data';
  }

  // aiAdoptionDelta: compare avg PR size before vs after marker
  // NOTE: No date range filter — before/after comparison spans all available data
  const prSizeResult = db.get(sql.raw(`
    SELECT
      AVG(CASE WHEN pr.created_at < ${markerEpoch} THEN pr.lines_added END) AS before_avg_lines,
      AVG(CASE WHEN pr.created_at >= ${markerEpoch} THEN pr.lines_added END) AS after_avg_lines
    FROM pull_requests pr
    WHERE pr.repo_id IN (${repoIdList})
  `)) as { before_avg_lines: number | null; after_avg_lines: number | null } | undefined;

  let aiAdoptionDelta: string | null = null;
  const beforeLines = prSizeResult?.before_avg_lines ?? null;
  const afterLines = prSizeResult?.after_avg_lines ?? null;
  if (beforeLines != null && afterLines != null && beforeLines > 0) {
    const pctChange = ((afterLines - beforeLines) / beforeLines) * 100;
    const sign = pctChange >= 0 ? '+' : '-';
    aiAdoptionDelta = `${sign}${Math.abs(Math.round(pctChange))}% avg PR size`;
  } else {
    aiAdoptionDelta = 'Not enough data';
  }

  return { totalCommits, activeContributors, rampUpTrend, aiAdoptionDelta };
}
