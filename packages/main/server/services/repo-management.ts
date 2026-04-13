import { db } from '../db/client.js';
import { repositories, commits, pullRequests, collectionState, authors } from '../db/schema.js';
import { eq, isNull, isNotNull, count, sql } from 'drizzle-orm';

/**
 * Return all actively tracked repos (removedAt IS NULL).
 */
export function getTrackedRepos() {
  return db.select().from(repositories).where(isNull(repositories.removedAt)).all();
}

/**
 * Return all stopped repos (removedAt IS NOT NULL).
 */
export function getStoppedRepos() {
  return db.select().from(repositories).where(isNotNull(repositories.removedAt)).all();
}

/**
 * Add or re-activate repos.
 * Uses upsert: if githubId already exists, clears removedAt and refreshes addedAt.
 */
export function addRepos(
  repos: Array<{
    githubId: number;
    fullName: string;
    name: string;
    ownerLogin: string;
    isPrivate: boolean;
    defaultBranch: string;
    repoCreatedAt?: string;
  }>
) {
  for (const repo of repos) {
    const repoCreatedAt = repo.repoCreatedAt ? new Date(repo.repoCreatedAt) : null;
    db.insert(repositories)
      .values({ ...repo, repoCreatedAt, addedAt: new Date(), removedAt: null })
      .onConflictDoUpdate({
        target: repositories.githubId,
        set: { removedAt: null, addedAt: new Date(), repoCreatedAt },
      })
      .run();
  }
}

/**
 * Soft-delete a repo by setting removedAt to now.
 * Repo is excluded from getTrackedRepos() after this call.
 */
export function stopTracking(id: number) {
  db.update(repositories)
    .set({ removedAt: new Date() })
    .where(eq(repositories.id, id))
    .run();
}

/**
 * Get the count of commits and PRs for a repo (used for delete preview).
 */
export function getDeleteCounts(repoId: number): { commits: number; prs: number } {
  const [commitCount] = db
    .select({ count: count() })
    .from(commits)
    .where(eq(commits.repoId, repoId))
    .all();

  const [prCount] = db
    .select({ count: count() })
    .from(pullRequests)
    .where(eq(pullRequests.repoId, repoId))
    .all();

  return {
    commits: commitCount?.count ?? 0,
    prs: prCount?.count ?? 0,
  };
}

/**
 * Hard-delete all data for a repo, in dependency order:
 * 1. collection_state
 * 2. commits
 * 3. pull_requests
 * 4. orphaned authors (not referenced by any remaining commit or PR)
 * 5. repositories row
 */
export function deleteRepoData(repoId: number) {
  db.delete(collectionState).where(eq(collectionState.repoId, repoId)).run();
  db.delete(commits).where(eq(commits.repoId, repoId)).run();
  db.delete(pullRequests).where(eq(pullRequests.repoId, repoId)).run();

  // Remove orphaned authors — authors not referenced by any remaining commit or PR
  db.run(sql`
    DELETE FROM authors
    WHERE id NOT IN (
      SELECT DISTINCT author_id FROM commits WHERE author_id IS NOT NULL
    )
    AND id NOT IN (
      SELECT DISTINCT author_id FROM pull_requests WHERE author_id IS NOT NULL
    )
  `);

  db.delete(repositories).where(eq(repositories.id, repoId)).run();
}
