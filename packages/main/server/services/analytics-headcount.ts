import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { HeadcountMonthlyRow, Period } from '@shared/types.js';

/**
 * Compute active team size and headcount-normalized output per month.
 *
 * Active dev definition (D-09/D-10/D-11):
 *   A developer is active in a month if they have ≥1 commit (authored, bot=0)
 *   OR ≥1 PR created in that month OR ≥1 PR merged in that month.
 *   Bots (is_bot=1) are excluded.
 *
 * totalPrs semantics (D-12):
 *   totalPrs counts PRs by created_at month ONLY. A PR created in Jan and merged
 *   in Feb contributes 1 to totalPrs[Jan] and 0 to totalPrs[Feb].
 *   This matches the Plan 02 concentration basis (created_at month).
 *
 * merged_at usage:
 *   The merged_at query is used ONLY to expand the activeDevs author set (D-10).
 *   It does NOT contribute to totalPrs. A PR merged in Feb (but created in Jan)
 *   adds the author to activeDevs[Feb] but does NOT increment totalPrs[Feb].
 *
 * prsPerDev / commitsPerDev (D-12):
 *   Integer-month denominator — no day normalization.
 *   Returns null when activeDevs=0 to avoid NaN/Infinity.
 *
 * SAFETY: repoIds validated by getCompleteRepoIds (SEC-01 integer guard).
 *
 * @param repoIds  Optional repo filter; if omitted, uses all complete repos.
 * @param periods  Period array from buildPeriodsFromMarker — used for date range only.
 *                 Monthly series are NOT segmented by period (D-19).
 */
export function getHeadcountMonthly(
  repoIds: number[] | undefined,
  periods: Period[],
): HeadcountMonthlyRow[] {
  // SEC-01: validate and filter to complete repos only
  const completeRepoIds = getCompleteRepoIds(repoIds);
  if (completeRepoIds.length === 0) return [];
  if (periods.length === 0) return [];

  // SAFETY: completeRepoIds are DB-sourced integers after integer guard.
  const repoIdList = completeRepoIds.join(',');

  // Derive date range from periods (use UTC to avoid timezone offset issues)
  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const startEpoch = Math.floor(parseIsoDateUTC(firstPeriod.startDate) / 1000);
  const endEpoch = Math.floor(parseIsoDateEndUTC(lastPeriod.endDate) / 1000);

  // ── Query 1: commit authors + commit counts per month ────────────────────────
  // Groups by (YYYY-MM, author login) to get commit count per author per month.
  // Bots excluded via a.is_bot = 0.
  const commitRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', c.committed_at, 'unixepoch') AS month,
      a.github_login AS author,
      COUNT(*) AS commit_count
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
      AND CAST(c.committed_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
    GROUP BY month, a.github_login
  `)) as Array<{ month: string; author: string; commit_count: number }>;

  // ── Query 2: PR authors + PR counts per month (created_at month ONLY) ────────
  // IMPORTANT: totalPrs is derived from this query ONLY.
  // A PR created in Jan and merged in Feb counts as 1 PR in Jan, 0 in Feb.
  // This matches Plan 02 concentration basis assignment (created_at month ONLY).
  const prCreatedRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', p.created_at, 'unixepoch') AS month,
      a.github_login AS author,
      COUNT(*) AS pr_count
    FROM pull_requests p
    INNER JOIN authors a ON a.id = p.author_id
    WHERE a.is_bot = 0
      AND p.repo_id IN (${repoIdList})
      AND CAST(p.created_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
    GROUP BY month, a.github_login
  `)) as Array<{ month: string; author: string; pr_count: number }>;

  // ── Query 3: merged-PR authors per month — for activeDevs author set ONLY ────
  // -- merged_at query: author set only, NOT totalPrs --
  // IMPORTANT: This query is used ONLY to expand the activeDevs author set per D-10.
  // It does NOT contribute to totalPrs. A PR merged in Feb (but created in Jan) adds
  // the author to activeDevs[Feb] but does NOT increment totalPrs[Feb].
  const prMergedRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', p.merged_at, 'unixepoch') AS month,
      a.github_login AS author
    FROM pull_requests p
    INNER JOIN authors a ON a.id = p.author_id
    WHERE a.is_bot = 0
      AND p.repo_id IN (${repoIdList})
      AND p.merged_at IS NOT NULL
      AND CAST(p.merged_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
    GROUP BY month, a.github_login
  `)) as Array<{ month: string; author: string }>;

  // ── TypeScript merge: build month data map ────────────────────────────────────

  interface MonthData {
    commitAuthors: Set<string>;
    prCreatedAuthors: Set<string>;
    prMergedAuthors: Set<string>;
    totalCommits: number;
    totalPrs: number;
  }

  const monthMap = new Map<string, MonthData>();

  function ensureMonth(month: string): MonthData {
    if (!monthMap.has(month)) {
      monthMap.set(month, {
        commitAuthors: new Set(),
        prCreatedAuthors: new Set(),
        prMergedAuthors: new Set(),
        totalCommits: 0,
        totalPrs: 0,
      });
    }
    return monthMap.get(month)!;
  }

  // Accumulate commit data
  for (const row of commitRows) {
    const m = ensureMonth(row.month);
    m.commitAuthors.add(row.author);
    m.totalCommits += row.commit_count;
  }

  // Accumulate PR created data (totalPrs ONLY from created_at month)
  for (const row of prCreatedRows) {
    const m = ensureMonth(row.month);
    m.prCreatedAuthors.add(row.author);
    m.totalPrs += row.pr_count;
  }

  // Accumulate merged PR author set (author set only — NOT totalPrs)
  for (const row of prMergedRows) {
    const m = ensureMonth(row.month);
    m.prMergedAuthors.add(row.author);
  }

  // ── Build result rows ─────────────────────────────────────────────────────────

  const results: HeadcountMonthlyRow[] = [];

  for (const [month, data] of monthMap.entries()) {
    // activeDevs = union of all three author sets (D-09/D-10)
    const allAuthors = new Set([
      ...data.commitAuthors,
      ...data.prCreatedAuthors,
      ...data.prMergedAuthors,
    ]);
    const activeDevs = allAuthors.size;

    // Division-by-zero guard (D-12): return null, never NaN or Infinity
    const prsPerDev: number | null = activeDevs > 0 ? data.totalPrs / activeDevs : null;
    const commitsPerDev: number | null = activeDevs > 0 ? data.totalCommits / activeDevs : null;

    results.push({
      month,
      activeDevs,
      totalPrs: data.totalPrs,
      totalCommits: data.totalCommits,
      prsPerDev,
      commitsPerDev,
    });
  }

  // Return sorted by month ascending
  return results.sort((a, b) => a.month.localeCompare(b.month));
}

// ─── Date parsing utilities ────────────────────────────────────────────────────

/**
 * Parse ISO date string 'YYYY-MM-DD' to start-of-day UTC milliseconds.
 * Uses Date.UTC to avoid timezone offset errors (matches analytics-rolling.ts pattern).
 */
function parseIsoDateUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

/**
 * Parse ISO date string 'YYYY-MM-DD' to end-of-day UTC milliseconds.
 */
function parseIsoDateEndUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 23, 59, 59);
}
