import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collectionState, commits, pullRequests, appConfig } from '../db/schema.js';

interface CollectionStateRow {
  cursor: string | null;
  status: string;
  lastPage: number | null;
  lastRunAt: Date | null;
  errorMessage: string | null;
  direction: string | null;
  oldestMonthCollected: string | null;
  depthTarget: string | null;
}

/**
 * Upsert checkpoint -- uses uniqueIndex on (repoId, resourceType).
 * Creates on first call, updates on subsequent calls for the same (repoId, resourceType) pair.
 */
export function upsertCollectionState(
  repoId: number,
  resourceType: 'commits' | 'pull_requests',
  data: {
    cursor?: string;
    status?: string;
    lastPage?: number;
    errorMessage?: string | null;
    direction?: string;
    oldestMonthCollected?: string;
    depthTarget?: string;
  }
): void {
  db.insert(collectionState)
    .values({
      repoId,
      resourceType,
      cursor: data.cursor ?? null,
      status: data.status ?? 'in_progress',
      lastPage: data.lastPage ?? null,
      lastRunAt: new Date(),
      errorMessage: data.errorMessage ?? null,
      direction: data.direction ?? null,
      oldestMonthCollected: data.oldestMonthCollected ?? null,
      depthTarget: data.depthTarget ?? null,
    })
    .onConflictDoUpdate({
      target: [collectionState.repoId, collectionState.resourceType],
      set: {
        ...(data.cursor !== undefined ? { cursor: data.cursor } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.lastPage !== undefined ? { lastPage: data.lastPage } : {}),
        lastRunAt: new Date(),
        ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
        ...(data.direction !== undefined ? { direction: data.direction } : {}),
        ...(data.oldestMonthCollected !== undefined ? { oldestMonthCollected: data.oldestMonthCollected } : {}),
        ...(data.depthTarget !== undefined ? { depthTarget: data.depthTarget } : {}),
      },
    })
    .run();
}

/**
 * Read single resource state for a (repoId, resourceType) pair.
 * Returns null if no row exists.
 */
export function getCollectionState(
  repoId: number,
  resourceType: 'commits' | 'pull_requests'
): CollectionStateRow | null {
  const rows = db.select()
    .from(collectionState)
    .where(and(
      eq(collectionState.repoId, repoId),
      eq(collectionState.resourceType, resourceType),
    ))
    .all();
  return rows[0] ?? null;
}

/**
 * Mark collection as paused with rate-limit info.
 * If resetAt is provided, it's appended to the error message.
 */
export function markCollectionPaused(
  repoId: number,
  resourceType: 'commits' | 'pull_requests',
  errorMessage: string,
  resetAt?: string
): void {
  const msg = resetAt ? `${errorMessage}|resetAt:${resetAt}` : errorMessage;
  upsertCollectionState(repoId, resourceType, { status: 'paused', errorMessage: msg });
}

/**
 * Mark collection as complete and clear any error message.
 */
export function markCollectionComplete(
  repoId: number,
  resourceType: 'commits' | 'pull_requests'
): void {
  upsertCollectionState(repoId, resourceType, { status: 'complete', errorMessage: null });
}

/**
 * Get incomplete collections for cross-session resume (COLL-08).
 * Returns rows with status IN ('pending', 'in_progress', 'paused').
 */
export function getIncompleteCollections(): Array<{
  repoId: number;
  resourceType: string;
  cursor: string | null;
  status: string;
  errorMessage: string | null;
}> {
  return db.select()
    .from(collectionState)
    .where(inArray(collectionState.status, ['pending', 'in_progress', 'paused']))
    .all();
}

/**
 * Get item counts per repo (for progress display).
 */
export function getRepoItemCounts(repoId: number): { commits: number; prs: number } {
  const commitCount = db.select({ count: sql<number>`count(*)` })
    .from(commits)
    .where(eq(commits.repoId, repoId))
    .get();
  const prCount = db.select({ count: sql<number>`count(*)` })
    .from(pullRequests)
    .where(eq(pullRequests.repoId, repoId))
    .get();
  return {
    commits: commitCount?.count ?? 0,
    prs: prCount?.count ?? 0,
  };
}

/**
 * Get the collection depth setting in months. Defaults to 3 (per D-06).
 */
export function getDepthSetting(): number {
  const row = db.select().from(appConfig).where(eq(appConfig.key, 'collection_depth_months')).get();
  return row ? parseInt(row.value, 10) : 3;
}

/**
 * Persist the collection depth setting in months.
 */
export function setDepthSetting(months: number): void {
  db.insert(appConfig)
    .values({ key: 'collection_depth_months', value: String(months), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: String(months), updatedAt: new Date() },
    })
    .run();
}

/**
 * Get the oldest month collected for a specific repo/resource.
 */
export function getOldestMonthCollected(repoId: number, resourceType: 'commits' | 'pull_requests'): string | null {
  const state = getCollectionState(repoId, resourceType);
  return state?.oldestMonthCollected ?? null;
}

/**
 * Reset a mid-collection repo — delete all collected data and reset collection state to pending (D-11).
 * Used by the queue on startup when it detects a repo was in_progress.
 */
export function resetMidCollectionRepo(repoId: number): void {
  // Delete commits and PRs for this repo
  db.delete(commits).where(eq(commits.repoId, repoId)).run();
  db.delete(pullRequests).where(eq(pullRequests.repoId, repoId)).run();
  // Reset collection state to pending
  db.update(collectionState)
    .set({ status: 'pending', cursor: null, lastPage: null, errorMessage: null, direction: null, oldestMonthCollected: null, depthTarget: null })
    .where(eq(collectionState.repoId, repoId))
    .run();
}
