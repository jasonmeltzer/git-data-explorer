import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import { getAiMarkerDate } from './analytics-config.js';

export interface BeforeAfterMetrics {
  avgCommitSize: number;        // avg lines changed
  prFrequency: number;          // PRs per week per active contributor
  rampUpSpeed: number | null;   // median weeks to first PR >= 50 lines
  activeContributors: number;
}

export interface BeforeAfterComparison {
  before: BeforeAfterMetrics;
  after: BeforeAfterMetrics;
  markerDate: string;
}

export interface BeforeAfterParams {
  repoIds?: number[];
}

/**
 * Computes before/after comparison metrics split at the AI marker date.
 * Returns null if AI marker date is not set.
 */
export function getBeforeAfterComparison(params: BeforeAfterParams): BeforeAfterComparison | null {
  const markerDate = getAiMarkerDate();
  if (!markerDate) return null;

  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) {
    const empty: BeforeAfterMetrics = {
      avgCommitSize: 0,
      prFrequency: 0,
      rampUpSpeed: null,
      activeContributors: 0,
    };
    return { before: empty, after: empty, markerDate: markerDate.toISOString() };
  }

  // SAFETY: completeRepoIds come from DB query + integer guard (SEC-01).
  const repoIdList = completeRepoIds.join(',');
  const markerEpoch = Math.floor(markerDate.getTime() / 1000);

  // ── Avg commit size (lines added + deleted) before/after ─────────────────

  const commitSizeResult = db.get(sql.raw(`
    SELECT
      AVG(CASE WHEN c.committed_at < ${markerEpoch} THEN c.lines_added + c.lines_deleted END) AS before_avg_size,
      AVG(CASE WHEN c.committed_at >= ${markerEpoch} THEN c.lines_added + c.lines_deleted END) AS after_avg_size
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
  `)) as { before_avg_size: number | null; after_avg_size: number | null } | undefined;

  // ── Active contributors before/after ──────────────────────────────────────

  const contribResult = db.get(sql.raw(`
    SELECT
      COUNT(DISTINCT CASE WHEN c.committed_at < ${markerEpoch} THEN c.author_id END) AS before_contributors,
      COUNT(DISTINCT CASE WHEN c.committed_at >= ${markerEpoch} THEN c.author_id END) AS after_contributors
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
  `)) as { before_contributors: number; after_contributors: number } | undefined;

  // ── PR frequency (PRs per week per active contributor) ────────────────────

  // Get min/max timestamps for each period to calculate weeks
  const prFreqResult = db.get(sql.raw(`
    SELECT
      COUNT(CASE WHEN pr.created_at < ${markerEpoch} THEN 1 END) AS before_pr_count,
      COUNT(CASE WHEN pr.created_at >= ${markerEpoch} THEN 1 END) AS after_pr_count,
      MIN(pr.created_at) AS min_created_at,
      MAX(pr.created_at) AS max_created_at
    FROM pull_requests pr
    WHERE pr.repo_id IN (${repoIdList})
  `)) as {
    before_pr_count: number;
    after_pr_count: number;
    min_created_at: number | null;
    max_created_at: number | null;
  } | undefined;

  const beforeContribs = contribResult?.before_contributors ?? 0;
  const afterContribs = contribResult?.after_contributors ?? 0;

  // Compute weeks in each period for PR frequency
  const minTs = prFreqResult?.min_created_at ?? 0;
  const beforeWeeks = minTs > 0 && markerEpoch > minTs
    ? Math.max(1, (markerEpoch - minTs) / (7 * 86400))
    : 1;
  const maxTs = prFreqResult?.max_created_at ?? 0;
  const afterWeeks = maxTs > markerEpoch
    ? Math.max(1, (maxTs - markerEpoch) / (7 * 86400))
    : 1;

  const beforePrFreq = beforeContribs > 0
    ? (prFreqResult?.before_pr_count ?? 0) / beforeWeeks / beforeContribs
    : 0;
  const afterPrFreq = afterContribs > 0
    ? (prFreqResult?.after_pr_count ?? 0) / afterWeeks / afterContribs
    : 0;

  // ── Ramp-up speed: weeks from first commit to first PR >= 50 lines ────────

  // For each non-bot author, find the time from their first commit to their first
  // sizeable PR, split by when their first commit occurred (before/after marker)
  const rampUpRows = db.all(sql.raw(`
    SELECT
      a.id AS author_id,
      a.first_commit_at,
      MIN(pr.created_at) AS first_large_pr_at
    FROM authors a
    INNER JOIN pull_requests pr ON pr.author_id = a.id
    WHERE a.is_bot = 0
      AND a.first_commit_at IS NOT NULL
      AND pr.lines_added >= 50
      AND pr.repo_id IN (${repoIdList})
    GROUP BY a.id, a.first_commit_at
  `)) as Array<{ author_id: number; first_commit_at: number; first_large_pr_at: number }>;

  const beforeRampWeeks: number[] = [];
  const afterRampWeeks: number[] = [];

  for (const row of rampUpRows) {
    const weeksToRamp = (row.first_large_pr_at - row.first_commit_at) / (7 * 86400);
    if (weeksToRamp < 0) continue;
    if (row.first_commit_at < markerEpoch) {
      beforeRampWeeks.push(weeksToRamp);
    } else {
      afterRampWeeks.push(weeksToRamp);
    }
  }

  function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  const before: BeforeAfterMetrics = {
    avgCommitSize: commitSizeResult?.before_avg_size ?? 0,
    prFrequency: beforePrFreq,
    rampUpSpeed: median(beforeRampWeeks),
    activeContributors: beforeContribs,
  };

  const after: BeforeAfterMetrics = {
    avgCommitSize: commitSizeResult?.after_avg_size ?? 0,
    prFrequency: afterPrFreq,
    rampUpSpeed: median(afterRampWeeks),
    activeContributors: afterContribs,
  };

  return { before, after, markerDate: markerDate.toISOString() };
}
