// Phase 9.6 — Cycle Time Correction. METHODOLOGY (D-02 — diverges from LDX3 intentionally): firstCommitAt per PR = MIN across all PR commits of MIN(commit.authored.date, commit.committer.date). LDX3 uses committedDate ONLY. MIN(authored, committed) preserves true 'work started' timing through rebases. See .planning/phases/09.6-cycle-time-correction-inserted/09.6-CONTEXT.md.
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import { getCycleTimeMaxDays } from './analytics-config.js';
import type { PrTurnaroundRow, Period } from '@shared/types.js';

/**
 * Compute per-month PR cycle-time trend — Phase 9.6 (D-02/D-05/D-06/D-07/D-08/D-10/D-17/D-18).
 *
 * Cycle time = `mergedAt - firstCommitAt` (first-commit-to-merge, NOT open-to-merge).
 * GAP-04 / GAP-10 fix: replaces the legacy SQL average-as-approximation shortcut
 * with a real median computed in TypeScript via sort + lower-midpoint indexing
 * (D-07). Mean is preserved alongside as `avgHoursToMerge`.
 *
 * NOTE on methodology (D-02): firstCommitAt is computed per PR as
 *   MIN across all PR commits of MIN(commit.authored.date, commit.committer.date).
 * This diverges from LDX3, which uses commit.committed.date only. The divergence
 * preserves true "work started" timing through rebases — LDX3's pure committedDate
 * resets to rebase time, biasing cycle time short for long-running branches.
 *
 * Filtering (D-05):
 *   - `first_commit_at IS NOT NULL` — exclude fallback PRs from the metric.
 *   - `merged_at > first_commit_at` (D-10 sanity guard — guards against pathological
 *     timestamps; never silently include negative cycle time).
 *
 * Cap (D-08):
 *   - `(merged_at - first_commit_at) <= cycle_time_max_days * 86400`.
 *   - Loaded at query time via `getCycleTimeMaxDays()` — changing the cap retroactively
 *     adjusts which PRs are in the metric (useful for D.Eng sensitivity analysis).
 *
 * Coverage (D-06):
 *   - `prCount` counts PRs included in medians (covered + capped + non-bot).
 *   - `totalPrCount` counts ALL non-bot PRs created in the month — feeds the
 *     "based on X of Y PRs" coverage caveat in the UI.
 *
 * Bots (Phase 9.4 D-23):
 *   - Both queries JOIN authors with `is_bot = 0` so the bot exclusion applies
 *     consistently to numerator and denominator.
 *
 * Median (D-07):
 *   - TypeScript post-processing, lower-midpoint for even N (`sorted[mid - 1]` when
 *     length is even). Documented choice — NOT averaging midpoints. Diverges from
 *     analytics-developer-monthly's averaging median because the cycle-time chart
 *     needs a value that corresponds to a real PR, not an interpolated midpoint.
 *
 * SAFETY: repoIds validated by getCompleteRepoIds (SEC-01 / SEC-07 integer guard).
 * All sql.raw interpolations use ONLY:
 *   - `repoIdList` (integer join from getCompleteRepoIds)
 *   - `startEpoch`, `endEpoch`, `capSeconds` (local numeric variables)
 * No untrusted strings enter SQL.
 *
 * @param repoIds  Optional repo filter; if omitted, uses all complete repos.
 * @param periods  Period array — used for date range only; output is NOT
 *                 segmented by period (matches Phase 9.4 D-19).
 */
export function getPrTurnaroundTrend(repoIds: number[] | undefined, periods: Period[]): PrTurnaroundRow[] {
  // SEC-01: validate and filter to complete repos only
  const completeRepoIds = getCompleteRepoIds(repoIds);
  if (completeRepoIds.length === 0) return [];
  if (periods.length === 0) return [];

  // SAFETY: completeRepoIds are DB-sourced integers after integer guard.
  const repoIdList = completeRepoIds.join(',');

  // Derive date range from periods (UTC-safe per analytics-headcount.ts pattern)
  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const startEpoch = Math.floor(parseIsoDateUTC(firstPeriod.startDate) / 1000);
  const endEpoch = Math.floor(parseIsoDateEndUTC(lastPeriod.endDate) / 1000);

  // D-08 cap — loaded at query time; changing it adjusts which PRs are in the metric.
  const capSeconds = getCycleTimeMaxDays() * 86_400;

  // ── Query A: total non-bot PRs per month (denominator for coverage caveat) ──
  // Groups by created_at month — total denominator includes PRs that will be
  // excluded from medians (firstCommitAt NULL, beyond cap, etc).
  const totalRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', pr.created_at, 'unixepoch') AS period_month,
      COUNT(*) AS total_pr_count
    FROM pull_requests pr
    INNER JOIN authors a ON a.id = pr.author_id
    WHERE a.is_bot = 0
      AND pr.merged_at IS NOT NULL
      AND pr.repo_id IN (${repoIdList})
      AND CAST(pr.created_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
    GROUP BY period_month
  `)) as Array<{ period_month: string; total_pr_count: number }>;

  // ── Query B: per-PR cycle-time hours for the covered + capped + non-bot set ──
  // Returns one row per qualifying PR; TS code groups by month and computes median.
  // Filters:
  //   - merged_at IS NOT NULL (only merged PRs have cycle time)
  //   - first_commit_at IS NOT NULL (D-05 — exclude fallback PRs)
  //   - merged_at > first_commit_at (D-10 — sanity guard against negative cycle)
  //   - (merged_at - first_commit_at) <= capSeconds (D-08 cap)
  //   - is_bot = 0 (D-23 — match denominator's bot filter)
  // Month grouping uses first_commit_at month (the cycle-time measurement basis).
  const perPrRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', pr.first_commit_at, 'unixepoch') AS month,
      (CAST(pr.merged_at AS INTEGER) - CAST(pr.first_commit_at AS INTEGER)) / 3600.0 AS hours_to_merge
    FROM pull_requests pr
    INNER JOIN authors a ON a.id = pr.author_id
    WHERE a.is_bot = 0
      AND pr.merged_at IS NOT NULL
      AND pr.first_commit_at IS NOT NULL
      AND CAST(pr.merged_at AS INTEGER) > CAST(pr.first_commit_at AS INTEGER)
      AND pr.repo_id IN (${repoIdList})
      AND CAST(pr.first_commit_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
      AND (CAST(pr.merged_at AS INTEGER) - CAST(pr.first_commit_at AS INTEGER)) <= ${capSeconds}
  `)) as Array<{ month: string; hours_to_merge: number }>;

  // ── Query C (D-10 sanity check): count PRs where merged_at <= first_commit_at ──
  // Should be zero in well-formed data. Log a warning if encountered — never
  // include such PRs in the median (they're already filtered out of Query B).
  const sanityRow = db.get(sql.raw(`
    SELECT COUNT(*) AS bad_count
    FROM pull_requests pr
    WHERE pr.merged_at IS NOT NULL
      AND pr.first_commit_at IS NOT NULL
      AND CAST(pr.merged_at AS INTEGER) <= CAST(pr.first_commit_at AS INTEGER)
      AND pr.repo_id IN (${repoIdList})
  `)) as { bad_count: number } | undefined;
  if (sanityRow && sanityRow.bad_count > 0) {
    console.warn(
      `[analytics-pr-turnaround] D-10 sanity guard: ${sanityRow.bad_count} PR(s) have ` +
      `merged_at <= first_commit_at (negative cycle time). Excluded from metric.`,
    );
  }

  // ── Group per-PR hours by month ──
  const hoursByMonth = new Map<string, number[]>();
  for (const row of perPrRows) {
    if (!hoursByMonth.has(row.month)) hoursByMonth.set(row.month, []);
    hoursByMonth.get(row.month)!.push(row.hours_to_merge);
  }

  // ── Build totalPrCount lookup ──
  const totalByMonth = new Map<string, number>();
  for (const row of totalRows) {
    totalByMonth.set(row.period_month, row.total_pr_count);
  }

  // ── Union of months from both maps, sorted ascending ──
  const allMonths = Array.from(
    new Set<string>([...hoursByMonth.keys(), ...totalByMonth.keys()]),
  ).sort();

  // ── Build result rows ──
  const results: PrTurnaroundRow[] = [];
  for (const month of allMonths) {
    const hours = hoursByMonth.get(month) ?? [];
    const prCount = hours.length;
    const medianHoursToMerge = median(hours) ?? 0;
    const avgHoursToMerge = prCount > 0
      ? hours.reduce((sum, h) => sum + h, 0) / prCount
      : 0;
    const totalPrCount = totalByMonth.get(month) ?? prCount;

    results.push({
      periodMonth: month,
      medianHoursToMerge,
      avgHoursToMerge,
      prCount,
      totalPrCount,
    });
  }

  return results;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Parse ISO date string 'YYYY-MM-DD' to start-of-day UTC milliseconds.
 * Uses Date.UTC to avoid timezone offset errors (verbatim from analytics-headcount.ts:185-188).
 */
function parseIsoDateUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 0, 0, 0);
}

/**
 * Parse ISO date string 'YYYY-MM-DD' to end-of-day UTC milliseconds.
 * Verbatim from analytics-headcount.ts:193-196.
 */
function parseIsoDateEndUTC(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day, 23, 59, 59);
}

/**
 * True median via lower-midpoint indexing per D-07.
 *   - Returns null on empty input.
 *   - Odd N: middle element.
 *   - Even N: lower midpoint `sorted[mid - 1]` (NOT the average of midpoints).
 *
 * Diverges from analytics-developer-monthly's averaging median because the
 * cycle-time chart needs a median that corresponds to an actual PR's cycle time
 * (the documented choice in D-07).
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : sorted[mid - 1];
}
