import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { DeveloperMonthlyRow, Period } from '@shared/types.js';

/**
 * Compute per-developer monthly time series — Phase 9.5 (CONT-02).
 *
 * Output shape (D-18): one row per (author, month) with prCount, commitCount,
 * mean+median linesPerCommit, mean+median filesPerCommit. Rows are emitted
 * only for months where the author has activity (any of: ≥1 non-bot commit,
 * ≥1 PR created). Inactive months in between produce gaps in the chart
 * client-side (D-19).
 *
 * Inclusion (D-20): every author with ≥1 non-bot commit OR PR created in the
 * window. No volume threshold at export time (researchers use Min Activity slider).
 *
 * Bots (D-23): canonical `authors.is_bot = 0` filter; no new heuristics.
 *
 * Lines per commit (D-18): `lines_added + lines_deleted` (total churn, NOT net).
 *   - Mean computed in SQL.
 *   - Median computed in TypeScript post-processing (SQLite has no MEDIAN()).
 *   - When commitCount = 0 in a month with PR activity, all 4 size fields are null.
 *
 * Period-array signature (D-25): periods provide date range only; output is
 * NOT segmented by period (matches Phase 9.4 D-19).
 *
 * SAFETY: repoIds validated by getCompleteRepoIds (SEC-01 / SEC-07 integer guard).
 *
 * @param repoIds  Optional repo filter; if omitted, uses all complete repos.
 * @param periods  Period array — used for date range only.
 */
export function getDeveloperMonthly(
  repoIds: number[] | undefined,
  periods: Period[],
): DeveloperMonthlyRow[] {
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

  // ── Query A: per-(author, month) commit aggregates (count + mean lines/files) ──
  // Bots filtered via a.is_bot = 0 (D-23).
  const commitAggRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', c.committed_at, 'unixepoch') AS month,
      a.github_login AS author,
      COUNT(*) AS commit_count,
      AVG(c.lines_added + c.lines_deleted) AS mean_lines_per_commit,
      AVG(c.files_changed) AS mean_files_per_commit
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
      AND CAST(c.committed_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
    GROUP BY month, a.github_login
  `)) as Array<{
    month: string;
    author: string;
    commit_count: number;
    mean_lines_per_commit: number | null;
    mean_files_per_commit: number | null;
  }>;

  // ── Query B: per-(author, month) PR count (created_at month basis, D-12 parity) ──
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

  // ── Query C: raw per-commit line/files rows for median computation (D-18) ──
  // Returns one row per non-bot commit so we can group + sort + take median in TS.
  // Per CONTEXT noted-constraint: "naive approach loads every commit's lines into
  // memory… likely fine for the seed-data and small-org case." Acceptable for v1.
  const perCommitRows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', c.committed_at, 'unixepoch') AS month,
      a.github_login AS author,
      (c.lines_added + c.lines_deleted) AS lines_total,
      c.files_changed AS files_changed
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE a.is_bot = 0
      AND c.repo_id IN (${repoIdList})
      AND CAST(c.committed_at AS INTEGER) BETWEEN ${startEpoch} AND ${endEpoch}
  `)) as Array<{ month: string; author: string; lines_total: number; files_changed: number }>;

  // ── Build (author, month) → median buckets ──
  // Key format: `${author}::${month}` (composite key; matches Phase 7.3 ContributorTable
  // per-repo-mode pattern of using `${authorLogin}::${repoId}`).
  const linesByKey = new Map<string, number[]>();
  const filesByKey = new Map<string, number[]>();
  for (const row of perCommitRows) {
    const key = `${row.author}::${row.month}`;
    if (!linesByKey.has(key)) linesByKey.set(key, []);
    if (!filesByKey.has(key)) filesByKey.set(key, []);
    linesByKey.get(key)!.push(row.lines_total);
    filesByKey.get(key)!.push(row.files_changed);
  }

  function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // ── Merge commit-agg + pr-count maps ──
  interface DevMonthData {
    commitCount: number;
    prCount: number;
    meanLinesPerCommit: number | null;
    meanFilesPerCommit: number | null;
  }
  const devMonthMap = new Map<string, DevMonthData>();

  function ensureKey(key: string): DevMonthData {
    if (!devMonthMap.has(key)) {
      devMonthMap.set(key, {
        commitCount: 0,
        prCount: 0,
        meanLinesPerCommit: null,
        meanFilesPerCommit: null,
      });
    }
    return devMonthMap.get(key)!;
  }

  for (const row of commitAggRows) {
    const key = `${row.author}::${row.month}`;
    const d = ensureKey(key);
    d.commitCount = row.commit_count;
    d.meanLinesPerCommit = row.mean_lines_per_commit;
    d.meanFilesPerCommit = row.mean_files_per_commit;
  }

  for (const row of prCreatedRows) {
    const key = `${row.author}::${row.month}`;
    const d = ensureKey(key);
    d.prCount = row.pr_count;
  }

  // ── Build result rows ──
  const results: DeveloperMonthlyRow[] = [];
  for (const [key, data] of devMonthMap.entries()) {
    const [author, month] = key.split('::');
    const linesArr = linesByKey.get(key) ?? [];
    const filesArr = filesByKey.get(key) ?? [];

    // D-19 null guard: per-commit size fields null when commitCount = 0
    const meanLines = data.commitCount > 0 ? data.meanLinesPerCommit : null;
    const medLines = data.commitCount > 0 ? median(linesArr) : null;
    const meanFiles = data.commitCount > 0 ? data.meanFilesPerCommit : null;
    const medFiles = data.commitCount > 0 ? median(filesArr) : null;

    results.push({
      authorLogin: author,
      month,
      prCount: data.prCount,
      commitCount: data.commitCount,
      meanLinesPerCommit: meanLines,
      medianLinesPerCommit: medLines,
      meanFilesPerCommit: meanFiles,
      medianFilesPerCommit: medFiles,
    });
  }

  // Sort by (author, month) ascending — consumers can chunk by author easily.
  return results.sort((a, b) => {
    if (a.authorLogin !== b.authorLogin) return a.authorLogin.localeCompare(b.authorLogin);
    return a.month.localeCompare(b.month);
  });
}

// ─── Date parsing utilities (verbatim from analytics-headcount.ts:185-196) ──────
// parseIsoDateUTC / parseIsoDateEndUTC: UTC-safe boundaries, no timezone offset.

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
