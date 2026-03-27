import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { commits, authors } from '../db/schema.js';
import { getCompleteRepoIds } from './analytics-utils.js';
import type { RampUpBucket, RampUpParams } from '../../shared/types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const RAMP_UP_WEEKS = 12;
const ONE_WEEK_S = 7 * 24 * 3600;
const RAMP_UP_WINDOW_S = RAMP_UP_WEEKS * ONE_WEEK_S;

/**
 * Formats a date as a join period string based on granularity.
 * - quarter: '2025-Q1', '2025-Q2', ...
 * - half:    '2025-H1', '2025-H2'
 * - year:    '2025'
 */
export function formatJoinPeriod(date: Date, granularity: 'quarter' | 'half' | 'year'): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // 1-12

  if (granularity === 'quarter') {
    const quarter = Math.ceil(month / 3);
    return `${year}-Q${quarter}`;
  } else if (granularity === 'half') {
    const half = month <= 6 ? 1 : 2;
    return `${year}-H${half}`;
  } else {
    return `${year}`;
  }
}

// ─── Raw row type from SQL query ─────────────────────────────────────────────

interface RawCommitRow {
  committedAtEpoch: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  authorId: number;
  firstCommitAtEpoch: number;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Computes ramp-up curves: weekly contribution trajectories for new developers
 * during their first 12 weeks, grouped by cohort join period.
 *
 * Strategy: SQL for filtering + TypeScript for week bucketing and aggregation.
 * This avoids SQLite integer-arithmetic edge cases with epoch timestamps.
 */
export function getRampUpCurves(params: RampUpParams): RampUpBucket[] {
  const { tenureMode, joinPeriodGranularity } = params;

  // Step 1: Get complete repo IDs
  const completeRepoIds = getCompleteRepoIds(params.repoIds);
  if (completeRepoIds.length === 0) {
    return [];
  }

  // Step 2: SQL query to fetch raw commit rows for authors within their first 12 weeks.
  // Drizzle stores `{ mode: 'timestamp' }` columns as epoch seconds in SQLite.
  // We use the sql template tag for arithmetic comparisons directly on epoch values.

  let rawRows: RawCommitRow[];

  if (tenureMode === 'global') {
    // Use author's global firstCommitAt as the tenure reference.
    // Drizzle stores { mode: 'timestamp' } columns as epoch seconds (INTEGER) in SQLite.
    // We cast to INTEGER explicitly to ensure arithmetic is on epoch seconds not text.
    rawRows = db
      .select({
        committedAtEpoch: sql<number>`CAST(${commits.committedAt} AS INTEGER)`.as('committed_at_epoch'),
        linesAdded: commits.linesAdded,
        linesDeleted: commits.linesDeleted,
        filesChanged: commits.filesChanged,
        authorId: commits.authorId,
        firstCommitAtEpoch: sql<number>`CAST(${authors.firstCommitAt} AS INTEGER)`.as('first_commit_at_epoch'),
      })
      .from(commits)
      .innerJoin(authors, eq(commits.authorId, authors.id))
      .where(
        and(
          eq(authors.isBot, false),
          sql`${authors.firstCommitAt} IS NOT NULL`,
          inArray(commits.repoId, completeRepoIds),
          sql`(CAST(${commits.committedAt} AS INTEGER) - CAST(${authors.firstCommitAt} AS INTEGER)) >= 0`,
          sql`(CAST(${commits.committedAt} AS INTEGER) - CAST(${authors.firstCommitAt} AS INTEGER)) < ${RAMP_UP_WINDOW_S}`,
        )
      )
      .all() as unknown as RawCommitRow[];
  } else {
    // Per-repo tenure mode: use MIN(committed_at) per (authorId, repoId) as reference
    rawRows = db
      .select({
        committedAtEpoch: sql<number>`CAST(${commits.committedAt} AS INTEGER)`.as('committed_at_epoch'),
        linesAdded: commits.linesAdded,
        linesDeleted: commits.linesDeleted,
        filesChanged: commits.filesChanged,
        authorId: commits.authorId,
        firstCommitAtEpoch: sql<number>`(SELECT MIN(CAST(c2.committed_at AS INTEGER)) FROM commits c2 WHERE c2.author_id = ${commits.authorId} AND c2.repo_id = ${commits.repoId})`.as('first_commit_at_epoch'),
      })
      .from(commits)
      .innerJoin(authors, eq(commits.authorId, authors.id))
      .where(
        and(
          eq(authors.isBot, false),
          sql`${authors.firstCommitAt} IS NOT NULL`,
          inArray(commits.repoId, completeRepoIds),
        )
      )
      .all() as unknown as RawCommitRow[];

    // Post-filter: only keep rows within the ramp-up window from their repo-specific first commit
    rawRows = rawRows.filter(row => {
      const diff = row.committedAtEpoch - row.firstCommitAtEpoch;
      return diff >= 0 && diff < RAMP_UP_WINDOW_S;
    });
  }

  if (rawRows.length === 0) {
    return [];
  }

  // Step 3: TypeScript post-processing — bucket by (joinPeriod, weekIndex)

  interface BucketAccumulator {
    totalLinesChanged: number;
    totalFilesChanged: number;
    count: number;
    authorIds: Set<number>;
  }

  const bucketMap = new Map<string, BucketAccumulator>();

  for (const row of rawRows) {
    const diff = row.committedAtEpoch - row.firstCommitAtEpoch;
    const weekIndex = Math.floor(diff / ONE_WEEK_S);

    // Clamp (should already be filtered, but guard against floating-point edge cases)
    if (weekIndex < 0 || weekIndex >= RAMP_UP_WEEKS) continue;

    const joinDate = new Date(row.firstCommitAtEpoch * 1000);
    const joinPeriod = formatJoinPeriod(joinDate, joinPeriodGranularity);

    const key = `${joinPeriod}::${weekIndex}`;
    let acc = bucketMap.get(key);
    if (!acc) {
      acc = {
        totalLinesChanged: 0,
        totalFilesChanged: 0,
        count: 0,
        authorIds: new Set(),
      };
      bucketMap.set(key, acc);
    }

    acc.totalLinesChanged += row.linesAdded + row.linesDeleted;
    acc.totalFilesChanged += row.filesChanged;
    acc.count += 1;
    acc.authorIds.add(row.authorId);
  }

  // Step 4: Convert map to sorted array of RampUpBucket
  const buckets: RampUpBucket[] = [];

  for (const [key, acc] of bucketMap.entries()) {
    const [joinPeriod, weekIndexStr] = key.split('::');
    const weekIndex = parseInt(weekIndexStr, 10);

    buckets.push({
      weekIndex,
      avgLinesChanged: acc.count > 0 ? acc.totalLinesChanged / acc.count : 0,
      avgFilesChanged: acc.count > 0 ? acc.totalFilesChanged / acc.count : 0,
      contributionCount: acc.count,
      contributorCount: acc.authorIds.size,
      joinPeriod,
    });
  }

  // Sort by joinPeriod ascending, then weekIndex ascending
  buckets.sort((a, b) => {
    if (a.joinPeriod < b.joinPeriod) return -1;
    if (a.joinPeriod > b.joinPeriod) return 1;
    return a.weekIndex - b.weekIndex;
  });

  return buckets;
}
