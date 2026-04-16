import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { PeriodMetric, Period } from '@shared/types.js';

/**
 * Compute the same 4 metrics as the old beforeAfter section but parameterized
 * per period (D-18). Accepts a Period[] input — compatible with the period-array
 * data model introduced in Phase 9.4 for forward compatibility with Phase 10.
 *
 * Metrics per period:
 *   - avgCommitSize: avg (lines_added + lines_deleted) per commit
 *   - prFrequency: PRs per week per active contributor
 *   - rampUpSpeed: median weeks from first commit to first PR >= 50 lines
 *   - activeContributors: distinct human authors with ≥1 commit in period
 *
 * SAFETY: repoIds validated by getCompleteRepoIds (SEC-01 integer guard).
 * SAFETY: All SQL uses sql.raw() with integer-only repoIdList and epoch integers.
 *
 * @param repoIds  Optional repo filter; if omitted, uses all complete repos.
 * @param periods  Period[] from buildPeriodsFromMarker — each period gets its own metrics.
 */
export function getPeriodMetrics(
  repoIds: number[] | undefined,
  periods: Period[],
): PeriodMetric[] {
  const completeRepoIds = getCompleteRepoIds(repoIds);
  if (completeRepoIds.length === 0) return [];
  if (periods.length === 0) return [];

  // SAFETY: completeRepoIds come from DB query + integer guard (SEC-01).
  const repoIdList = completeRepoIds.join(',');

  return periods.map(period => {
    const startEpoch = Math.floor(new Date(period.startDate).getTime() / 1000);
    const endEpoch = Math.floor(new Date(period.endDate).getTime() / 1000);

    // ── Avg commit size (lines added + deleted) ──────────────────────────────

    const commitSizeResult = db.get(sql.raw(`
      SELECT
        AVG(c.lines_added + c.lines_deleted) AS avg_size
      FROM commits c
      INNER JOIN authors a ON a.id = c.author_id
      WHERE a.is_bot = 0
        AND c.repo_id IN (${repoIdList})
        AND CAST(c.committed_at AS INTEGER) >= ${startEpoch}
        AND CAST(c.committed_at AS INTEGER) <= ${endEpoch}
    `)) as { avg_size: number | null } | undefined;

    // ── Active contributors ──────────────────────────────────────────────────

    const contribResult = db.get(sql.raw(`
      SELECT COUNT(DISTINCT c.author_id) AS active_contributors
      FROM commits c
      INNER JOIN authors a ON a.id = c.author_id
      WHERE a.is_bot = 0
        AND c.repo_id IN (${repoIdList})
        AND CAST(c.committed_at AS INTEGER) >= ${startEpoch}
        AND CAST(c.committed_at AS INTEGER) <= ${endEpoch}
    `)) as { active_contributors: number } | undefined;

    const activeContributors = contribResult?.active_contributors ?? 0;

    // ── PR frequency (PRs per week per active contributor) ───────────────────

    const prFreqResult = db.get(sql.raw(`
      SELECT
        COUNT(*) AS pr_count,
        MIN(pr.created_at) AS min_created_at,
        MAX(pr.created_at) AS max_created_at
      FROM pull_requests pr
      WHERE pr.repo_id IN (${repoIdList})
        AND CAST(pr.created_at AS INTEGER) >= ${startEpoch}
        AND CAST(pr.created_at AS INTEGER) <= ${endEpoch}
    `)) as {
      pr_count: number;
      min_created_at: number | null;
      max_created_at: number | null;
    } | undefined;

    const prCount = prFreqResult?.pr_count ?? 0;
    const minTs = prFreqResult?.min_created_at ?? 0;
    const maxTs = prFreqResult?.max_created_at ?? 0;
    const periodWeeks = minTs > 0 && maxTs > minTs
      ? Math.max(1, (maxTs - minTs) / (7 * 86400))
      : 1;
    const prFrequency = activeContributors > 0
      ? prCount / periodWeeks / activeContributors
      : 0;

    // ── Ramp-up speed: median weeks to first PR >= 50 lines ──────────────────
    //
    // Only includes authors whose first_commit_at falls within the period.
    // Filters out long-tenured devs whose true first commit predates the window
    // (they would show artificially high ramp-up times due to data sparsity).

    const rampUpRows = db.all(sql.raw(`
      SELECT
        a.id AS author_id,
        a.first_commit_at,
        MIN(pr.created_at) AS first_large_pr_at
      FROM authors a
      INNER JOIN pull_requests pr ON pr.author_id = a.id
      WHERE a.is_bot = 0
        AND a.first_commit_at IS NOT NULL
        AND CAST(a.first_commit_at AS INTEGER) >= ${startEpoch}
        AND CAST(a.first_commit_at AS INTEGER) <= ${endEpoch}
        AND pr.lines_added >= 50
        AND pr.repo_id IN (${repoIdList})
      GROUP BY a.id, a.first_commit_at
    `)) as Array<{ author_id: number; first_commit_at: number; first_large_pr_at: number }>;

    const rampWeeks: number[] = [];
    for (const row of rampUpRows) {
      const weeksToRamp = (row.first_large_pr_at - row.first_commit_at) / (7 * 86400);
      if (weeksToRamp >= 0) rampWeeks.push(weeksToRamp);
    }

    const rampUpSpeed = median(rampWeeks);

    return {
      period,
      metrics: {
        avgCommitSize: commitSizeResult?.avg_size ?? 0,
        prFrequency,
        rampUpSpeed,
        activeContributors,
      },
    };
  });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
