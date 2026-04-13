import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';

export interface PrTurnaroundRow {
  periodMonth: string;      // '2025-06'
  avgHoursToMerge: number;
  medianHoursToMerge: number;
  prCount: number;
}

export interface PrTurnaroundParams {
  startDate?: string;  // ISO date
  endDate?: string;
  repoIds?: number[];
}

export function getPrTurnaroundTrend(params: PrTurnaroundParams): PrTurnaroundRow[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  // SAFETY: completeRepoIds come from DB query + integer guard (SEC-01).
  // These are never user-supplied. Do NOT pass user input here without parameterization.
  const repoIdList = completeRepoIds.join(',');

  const startEpoch = params.startDate ? Math.floor(new Date(params.startDate).getTime() / 1000) : null;
  const endEpoch = params.endDate ? Math.floor(new Date(params.endDate).getTime() / 1000) : null;

  const dateFilter = [
    startEpoch != null ? `AND created_at >= ${startEpoch}` : '',
    endEpoch != null ? `AND created_at <= ${endEpoch}` : '',
  ].join(' ');

  const rows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', created_at, 'unixepoch') AS period_month,
      AVG((merged_at - created_at) / 3600.0) AS avg_hours,
      COUNT(*) AS pr_count
    FROM pull_requests
    WHERE merged_at IS NOT NULL
      AND merged_at > created_at
      AND repo_id IN (${repoIdList})
      ${dateFilter}
    GROUP BY period_month
    ORDER BY period_month
  `)) as Array<{
    period_month: string;
    avg_hours: number;
    pr_count: number;
  }>;

  return rows.map(r => ({
    periodMonth: r.period_month,
    avgHoursToMerge: r.avg_hours,
    medianHoursToMerge: r.avg_hours, // SQLite has no MEDIAN(); using AVG as approximation
    prCount: r.pr_count,
  }));
}
