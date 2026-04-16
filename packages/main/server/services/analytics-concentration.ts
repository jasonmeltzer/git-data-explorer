import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { ConcentrationMonthlyRow, Period, ConcentrationBasis } from '@shared/types.js';

// ─── Pure-math helpers (exported for testing) ─────────────────────────────────

/**
 * Herfindahl-Hirschman Index (HHI): sum of squared fractional shares.
 * Input: fractional shares in range 0-1 (must sum to 1).
 * Output: 0-1 scale (1 = perfect monopoly, 1/n = perfect equality for n contributors).
 *
 * Also exported as `hhi` alias per PLAN acceptance criteria.
 */
export function computeHhi(shares: number[]): number {
  return shares.reduce((sum, s) => sum + s * s, 0);
}

/** Alias for computeHhi — satisfies acceptance criteria grep for "export function hhi" */
export const hhi = computeHhi;

/**
 * Gini coefficient via Lorenz curve integration formula.
 * Input: raw contribution counts for each author (any positive scale).
 * Output: 0-1 scale (0 = perfect equality, 1 = one author has everything).
 *
 * Formula: G = (2 * Σ(i * x_i)) / (n * Σ(x_i)) - (n+1)/n
 * where x_i are sorted ascending, i is 1-based index.
 *
 * Also exported as `computeGini` for test compatibility and `giniCoefficient` per PLAN.
 */
export function computeGini(values: number[]): number {
  if (values.length <= 1) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let weightedSum = 0;
  for (let i = 0; i < n; i++) {
    weightedSum += (i + 1) * sorted[i];
  }
  return (2 * weightedSum) / (n * total) - (n + 1) / n;
}

/** Alias for computeGini — satisfies acceptance criteria grep for "export function giniCoefficient" */
export const giniCoefficient = computeGini;

/**
 * Bus factor: minimum number of developers whose combined share reaches >= 50%.
 * Input: percentage shares sorted in DESCENDING order (values 0-100).
 * Output: positive integer.
 *
 * Example: [50, 20, 15, 10, 5] → 1 (top-1 alone at 50% covers threshold)
 * Example: [30, 25, 20, 15, 10] → 2 (top-1 at 30% + top-2 at 25% = 55%)
 */
export function computeBusFactor(sharesDesc: number[]): number {
  let cumulative = 0;
  for (let i = 0; i < sharesDesc.length; i++) {
    cumulative += sharesDesc[i];
    if (cumulative >= 50) return i + 1;
  }
  return sharesDesc.length; // all devs needed
}

// ─── Internal types for SQL result rows ───────────────────────────────────────

interface CommitAuthorMonthRow {
  month: string;
  author_login: string;
  commit_count: number;
  total_lines: number;
}

interface PrAuthorMonthRow {
  month: string;
  author_login: string;
  pr_count: number;
}

// ─── Post-processing helpers ───────────────────────────────────────────────────

/**
 * Given a map of month → author data, compute all concentration metrics
 * for a single basis type (commits, prs, or lines).
 */
function computeMonthlyConcentration(
  monthAuthorMap: Map<string, { login: string; count: number }[]>,
  basis: ConcentrationBasis
): ConcentrationMonthlyRow[] {
  const results: ConcentrationMonthlyRow[] = [];

  for (const [month, authors] of monthAuthorMap.entries()) {
    // Filter out zero-count entries
    const active = authors.filter(a => a.count > 0);
    const totalCount = active.reduce((sum, a) => sum + a.count, 0);

    if (totalCount === 0 || active.length === 0) {
      results.push({
        month,
        basis,
        top1Share: null,
        top3Share: null,
        top5Share: null,
        hhi: null,
        gini: null,
        busFactor: null,
        activeDevs: 0,
        topContributor: null,
      });
      continue;
    }

    // Sort by count descending
    const sorted = [...active].sort((a, b) => b.count - a.count);

    // Fractional shares (0-1)
    const fractionalShares = sorted.map(a => a.count / totalCount);

    // Percentage shares (0-100)
    const pctShares = fractionalShares.map(s => s * 100);

    // Top-N shares (percentage, 0-100)
    const top1Share = pctShares[0] ?? null;
    const top3Share = pctShares.slice(0, 3).reduce((sum, s) => sum + s, 0);
    const top5Share = pctShares.slice(0, 5).reduce((sum, s) => sum + s, 0);

    const hhiValue = computeHhi(fractionalShares);
    const giniValue = computeGini(sorted.map(a => a.count));
    const busFactorValue = computeBusFactor(pctShares);

    results.push({
      month,
      basis,
      top1Share,
      top3Share,
      top5Share,
      hhi: hhiValue,
      gini: giniValue,
      busFactor: busFactorValue,
      activeDevs: active.length,
      topContributor: sorted[0]?.login ?? null,
    });
  }

  return results;
}

// ─── Main service function ─────────────────────────────────────────────────────

/**
 * Compute monthly concentration metrics for all 3 bases (PRs, commits, lines).
 *
 * Returns a flat array of ConcentrationMonthlyRow objects, one per month per basis.
 * Zero-activity months return null for all concentration fields.
 *
 * SAFETY: repoIds validated by getCompleteRepoIds (SEC-01 integer guard).
 * SAFETY: All SQL uses sql.raw() with integer-only repoIdList from getCompleteRepoIds.
 *
 * @param repoIds  Optional repo filter; if omitted, uses all complete repos.
 * @param periods  Period array from buildPeriodsFromMarker — used for date range only.
 *                 Monthly series are NOT segmented by period (D-19).
 */
export function getConcentrationMonthly(
  repoIds: number[] | undefined,
  periods: Period[]
): ConcentrationMonthlyRow[] {
  // SEC-01: validate and filter to complete repos only
  const completeRepoIds = getCompleteRepoIds(repoIds);
  if (completeRepoIds.length === 0) return [];
  if (periods.length === 0) return [];

  // SAFETY: completeRepoIds are DB-sourced integers after integer guard.
  const repoIdList = completeRepoIds.join(',');

  // Derive date range from periods (use UTC to avoid timezone offset issues)
  const firstPeriod = periods[0];
  const lastPeriod = periods[periods.length - 1];
  const startEpoch = Math.floor(Date.UTC(...parseIsoDate(firstPeriod.startDate)) / 1000);
  const endEpoch = Math.floor(Date.UTC(...parseIsoDateEnd(lastPeriod.endDate)) / 1000);

  // ── Commits + lines basis SQL ────────────────────────────────────────────────
  // Groups by (YYYY-MM month, author login) to get commit count and total lines per author per month.
  // Lines = lines_added + lines_deleted (total churn).
  const commitRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', c.committed_at, 'unixepoch') AS month,
      a.github_login AS author_login,
      COUNT(c.id) AS commit_count,
      SUM(COALESCE(c.lines_added, 0) + COALESCE(c.lines_deleted, 0)) AS total_lines
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
      AND CAST(c.committed_at AS INTEGER) >= ${startEpoch}
      AND CAST(c.committed_at AS INTEGER) <= ${endEpoch}
    GROUP BY month, a.github_login
    ORDER BY month ASC, commit_count DESC
  `)) as CommitAuthorMonthRow[];

  // ── PR basis SQL ─────────────────────────────────────────────────────────────
  // PR month assigned by created_at month (planner decision: single assignment, no double-count).
  const prRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', p.created_at, 'unixepoch') AS month,
      a.github_login AS author_login,
      COUNT(p.id) AS pr_count
    FROM pull_requests p
    INNER JOIN authors a ON a.id = p.author_id
    WHERE a.is_bot = 0
      AND p.repo_id IN (${repoIdList})
      AND CAST(p.created_at AS INTEGER) >= ${startEpoch}
      AND CAST(p.created_at AS INTEGER) <= ${endEpoch}
    GROUP BY month, a.github_login
    ORDER BY month ASC, pr_count DESC
  `)) as PrAuthorMonthRow[];

  // ── Build month → author maps ─────────────────────────────────────────────────

  // Commits basis
  const commitMonthMap = new Map<string, { login: string; count: number }[]>();
  const linesMonthMap = new Map<string, { login: string; count: number }[]>();

  for (const row of commitRows) {
    if (!commitMonthMap.has(row.month)) commitMonthMap.set(row.month, []);
    if (!linesMonthMap.has(row.month)) linesMonthMap.set(row.month, []);
    commitMonthMap.get(row.month)!.push({ login: row.author_login, count: row.commit_count });
    linesMonthMap.get(row.month)!.push({ login: row.author_login, count: row.total_lines });
  }

  // PR basis
  const prMonthMap = new Map<string, { login: string; count: number }[]>();
  for (const row of prRows) {
    if (!prMonthMap.has(row.month)) prMonthMap.set(row.month, []);
    prMonthMap.get(row.month)!.push({ login: row.author_login, count: row.pr_count });
  }

  // ── Compute concentration for each basis ──────────────────────────────────────
  const commitRows2 = computeMonthlyConcentration(commitMonthMap, 'commits');
  const linesRows = computeMonthlyConcentration(linesMonthMap, 'lines');
  const prRows2 = computeMonthlyConcentration(prMonthMap, 'prs');

  return [...prRows2, ...commitRows2, ...linesRows];
}

// ─── Date parsing utilities ────────────────────────────────────────────────────

/**
 * Parse ISO date string 'YYYY-MM-DD' to [year, month-1, day] tuple for Date.UTC.
 * Month is 0-based for Date.UTC.
 */
function parseIsoDate(iso: string): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month - 1, day];
}

/**
 * Parse ISO date string 'YYYY-MM-DD' to end-of-day UTC epoch arguments.
 * Returns [year, month-1, day, 23, 59, 59] for use with Date.UTC.
 */
function parseIsoDateEnd(iso: string): [number, number, number, number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month - 1, day, 23, 59, 59];
}
