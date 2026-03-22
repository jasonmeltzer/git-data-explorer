import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { collectionState, commits, pullRequests } from '../db/schema.js';

interface CollectionStateRow {
  cursor: string | null;
  status: string;
  lastPage: number | null;
  lastRunAt: Date | null;
  errorMessage: string | null;
}

/**
 * Upsert checkpoint -- uses uniqueIndex on (repoId, resourceType).
 * Creates on first call, updates on subsequent calls for the same (repoId, resourceType) pair.
 */
export function upsertCollectionState(
  repoId: number,
  resourceType: 'commits' | 'pull_requests',
  data: { cursor?: string; status?: string; lastPage?: number; errorMessage?: string | null }
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
    })
    .onConflictDoUpdate({
      target: [collectionState.repoId, collectionState.resourceType],
      set: {
        ...(data.cursor !== undefined ? { cursor: data.cursor } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.lastPage !== undefined ? { lastPage: data.lastPage } : {}),
        lastRunAt: new Date(),
        ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
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
