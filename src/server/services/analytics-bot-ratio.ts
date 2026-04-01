import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { getCompleteRepoIds } from './analytics-utils.js';

export interface BotRatioRow {
  periodMonth: string;
  botCommits: number;
  humanCommits: number;
  totalCommits: number;
  botPercentage: number;  // 0-100
}

export interface BotRatioParams {
  startDate?: string;
  endDate?: string;
  repoIds?: number[];
}

export function getBotRatioTrend(params: BotRatioParams): BotRatioRow[] {
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) return [];

  // SAFETY: completeRepoIds come from DB query + integer guard (SEC-01).
  // These are never user-supplied. Do NOT pass user input here without parameterization.
  const repoIdList = completeRepoIds.join(',');

  const startEpoch = params.startDate ? Math.floor(new Date(params.startDate).getTime() / 1000) : null;
  const endEpoch = params.endDate ? Math.floor(new Date(params.endDate).getTime() / 1000) : null;

  const dateFilter = [
    startEpoch != null ? `AND c.committed_at >= ${startEpoch}` : '',
    endEpoch != null ? `AND c.committed_at <= ${endEpoch}` : '',
  ].join(' ');

  // IMPORTANT: Do NOT filter is_bot = 0. Need both bot and human counts in the total.
  // Use CASE WHEN to separate counts within the aggregation.
  const rows = db.all(sql.raw(`
    SELECT
      strftime('%Y-%m', c.committed_at, 'unixepoch') AS period_month,
      COUNT(CASE WHEN a.is_bot = 1 THEN 1 END) AS bot_commits,
      COUNT(CASE WHEN a.is_bot = 0 THEN 1 END) AS human_commits,
      COUNT(*) AS total_commits
    FROM commits c
    INNER JOIN authors a ON a.id = c.author_id
    WHERE c.repo_id IN (${repoIdList})
      ${dateFilter}
    GROUP BY period_month
    ORDER BY period_month
  `)) as Array<{
    period_month: string;
    bot_commits: number;
    human_commits: number;
    total_commits: number;
  }>;

  return rows.map(r => ({
    periodMonth: r.period_month,
    botCommits: r.bot_commits,
    humanCommits: r.human_commits,
    totalCommits: r.total_commits,
    botPercentage: r.total_commits > 0 ? Math.round((r.bot_commits / r.total_commits) * 100) : 0,
  }));
}
