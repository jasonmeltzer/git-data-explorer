import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// Build an in-memory test database with full schema
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id INTEGER NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      owner_login TEXT NOT NULL,
      name TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT NOT NULL DEFAULT 'main',
      added_at INTEGER NOT NULL,
      removed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_login TEXT NOT NULL UNIQUE,
      name TEXT,
      is_bot INTEGER NOT NULL DEFAULT 0,
      first_commit_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS commits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sha TEXT NOT NULL,
      repo_id INTEGER NOT NULL REFERENCES repositories(id),
      author_id INTEGER REFERENCES authors(id),
      message TEXT NOT NULL,
      committed_at INTEGER NOT NULL,
      lines_added INTEGER NOT NULL DEFAULT 0,
      lines_deleted INTEGER NOT NULL DEFAULT 0,
      files_changed INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_commits_sha_repo ON commits(sha, repo_id);

    CREATE TABLE IF NOT EXISTS pull_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id INTEGER NOT NULL,
      repo_id INTEGER NOT NULL REFERENCES repositories(id),
      author_id INTEGER REFERENCES authors(id),
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      merged_at INTEGER,
      closed_at INTEGER,
      updated_at INTEGER NOT NULL,
      lines_added INTEGER NOT NULL DEFAULT 0,
      lines_deleted INTEGER NOT NULL DEFAULT 0,
      files_changed INTEGER NOT NULL DEFAULT 0,
      commit_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX idx_prs_github_id_repo ON pull_requests(github_id, repo_id);

    CREATE TABLE IF NOT EXISTS collection_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repositories(id),
      resource_type TEXT NOT NULL,
      cursor TEXT,
      last_page INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      last_run_at INTEGER,
      error_message TEXT,
      direction TEXT,
      oldest_month_collected TEXT,
      depth_target TEXT
    );
    CREATE UNIQUE INDEX idx_collection_repo_type_unique ON collection_state(repo_id, resource_type);
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Mock createCollectionOctokit to return null — prevents actual API calls
// Queue's processQueue() exits early when octokit is null
vi.mock('../services/collection-engine.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    createCollectionOctokit: vi.fn().mockReturnValue(null),
  };
});

const { CollectionQueue } = await import('../services/collection-queue.js');
const {
  upsertCollectionState,
  getCollectionState,
  getRepoItemCounts,
  setDepthSetting,
  resetMidCollectionRepo,
} = await import('../services/collection-state.js');

function insertTestRepo(id: number, fullName: string, addedAt?: Date): number {
  testDb.insert(schema.repositories).values({
    id,
    githubId: id * 1000,
    fullName,
    ownerLogin: fullName.split('/')[0],
    name: fullName.split('/')[1],
    isPrivate: false,
    defaultBranch: 'main',
    addedAt: addedAt ?? new Date(),
  }).run();
  return id;
}

function stopRepo(id: number) {
  testDb.update(schema.repositories)
    .set({ removedAt: new Date() })
    .where(eq(schema.repositories.id, id))
    .run();
}

describe('CollectionQueue', () => {
  let queue: InstanceType<typeof CollectionQueue>;

  beforeEach(() => {
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
    testDb.delete(schema.appConfig).run();

    queue = new CollectionQueue();
  });

  describe('getStatus()', () => {
    it('returns depthMonths from global setting', () => {
      insertTestRepo(1, 'org/repo1');
      setDepthSetting(6);

      const status = queue.getStatus();
      expect(status.depthMonths).toBe(6);
    });

    it('returns default depthMonths=3 when no setting configured', () => {
      insertTestRepo(1, 'org/repo1');

      const status = queue.getStatus();
      expect(status.depthMonths).toBe(3);
    });

    it('returns maxDepthMonths=1 for repo added this month', () => {
      insertTestRepo(1, 'org/new-repo', new Date());

      const status = queue.getStatus();
      expect(status.maxDepthMonths).toBe(1);
    });

    it('returns maxDepthMonths based on oldest tracked repo', () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
      insertTestRepo(1, 'org/old-repo', sixMonthsAgo);
      insertTestRepo(2, 'org/new-repo', new Date());

      const status = queue.getStatus();
      // Should be >= 6 (6 months ago)
      expect(status.maxDepthMonths).toBeGreaterThanOrEqual(6);
    });

    it('maxDepthMonths ignores stopped repos', () => {
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      insertTestRepo(1, 'org/old-stopped', yearAgo);
      insertTestRepo(2, 'org/new-active', new Date());
      stopRepo(1);

      const status = queue.getStatus();
      // Old stopped repo should not inflate maxDepthMonths
      expect(status.maxDepthMonths).toBe(1);
    });

    it('returns maxDepthMonths=1 when no tracked repos exist', () => {
      const status = queue.getStatus();
      expect(status.maxDepthMonths).toBe(1);
    });

    it('returns correct per-repo status derivation', () => {
      insertTestRepo(1, 'org/complete-repo');
      insertTestRepo(2, 'org/collecting-repo');
      insertTestRepo(3, 'org/paused-repo');

      upsertCollectionState(1, 'commits', { status: 'complete' });
      upsertCollectionState(1, 'pull_requests', { status: 'complete' });
      upsertCollectionState(2, 'commits', { status: 'in_progress' });
      upsertCollectionState(3, 'commits', { status: 'paused', errorMessage: 'Rate limit' });

      const status = queue.getStatus();
      expect(status.repoStatuses).toHaveLength(3);

      const complete = status.repoStatuses.find(r => r.repoId === 1);
      const collecting = status.repoStatuses.find(r => r.repoId === 2);
      const paused = status.repoStatuses.find(r => r.repoId === 3);

      expect(complete!.status).toBe('complete');
      expect(collecting!.status).toBe('collecting');
      expect(paused!.status).toBe('paused');
    });

    it('derives "updating" when one resource is complete and other is in_progress', () => {
      insertTestRepo(1, 'org/updating-repo');
      upsertCollectionState(1, 'commits', { status: 'complete' });
      upsertCollectionState(1, 'pull_requests', { status: 'in_progress' });

      const status = queue.getStatus();
      expect(status.repoStatuses[0].status).toBe('updating');
    });

    it('excludes stopped repos from repoStatuses', () => {
      insertTestRepo(1, 'org/active');
      insertTestRepo(2, 'org/stopped');
      stopRepo(2);

      upsertCollectionState(1, 'commits', { status: 'complete' });
      upsertCollectionState(2, 'commits', { status: 'complete' });

      const status = queue.getStatus();
      expect(status.repoStatuses).toHaveLength(1);
      expect(status.repoStatuses[0].repoId).toBe(1);
    });

    it('computes monthsCollected from oldestMonthCollected', () => {
      insertTestRepo(1, 'org/months-test');

      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      twoMonthsAgo.setDate(1);
      twoMonthsAgo.setHours(0, 0, 0, 0);

      upsertCollectionState(1, 'commits', {
        status: 'complete', direction: 'reverse',
        oldestMonthCollected: twoMonthsAgo.toISOString(),
      });

      const status = queue.getStatus();
      // Current month + 2 back = 3
      expect(status.repoStatuses[0].monthsCollected).toBe(3);
    });

    it('monthsCollected is null when no oldestMonthCollected set', () => {
      insertTestRepo(1, 'org/no-oldest');
      upsertCollectionState(1, 'commits', { status: 'in_progress' });

      const status = queue.getStatus();
      expect(status.repoStatuses[0].monthsCollected).toBeNull();
    });

    it('monthsCollected uses bottleneck (fewer months) between commits and PRs', () => {
      insertTestRepo(1, 'org/bottleneck-test');

      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 2);
      threeMonthsAgo.setDate(1);
      threeMonthsAgo.setHours(0, 0, 0, 0);

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth());
      oneMonthAgo.setDate(1);
      oneMonthAgo.setHours(0, 0, 0, 0);

      // Commits collected 3 months, PRs only 1 month
      upsertCollectionState(1, 'commits', {
        status: 'complete', direction: 'reverse',
        oldestMonthCollected: threeMonthsAgo.toISOString(),
      });
      upsertCollectionState(1, 'pull_requests', {
        status: 'complete', direction: 'reverse',
        oldestMonthCollected: oneMonthAgo.toISOString(),
      });

      const status = queue.getStatus();
      // Should use PR's 1 month (the bottleneck), not commit's 3
      expect(status.repoStatuses[0].monthsCollected).toBe(1);
    });

    it('each repo gets depthMonths in its status', () => {
      insertTestRepo(1, 'org/repo1');
      insertTestRepo(2, 'org/repo2');
      setDepthSetting(7);

      const status = queue.getStatus();
      expect(status.repoStatuses[0].depthMonths).toBe(7);
      expect(status.repoStatuses[1].depthMonths).toBe(7);
    });

    it('isActive is false when queue is idle', () => {
      insertTestRepo(1, 'org/repo1');
      const status = queue.getStatus();
      expect(status.isActive).toBe(false);
    });
  });

  describe('getIncompleteForResume()', () => {
    it('returns hasIncomplete=false when all complete', () => {
      insertTestRepo(1, 'org/repo1');
      upsertCollectionState(1, 'commits', { status: 'complete' });

      const result = queue.getIncompleteForResume();
      expect(result.hasIncomplete).toBe(false);
      expect(result.incomplete).toHaveLength(0);
    });

    it('returns hasIncomplete=true with paused repos', () => {
      insertTestRepo(1, 'org/repo1');
      upsertCollectionState(1, 'commits', { status: 'paused', errorMessage: 'Rate limit' });

      const result = queue.getIncompleteForResume();
      expect(result.hasIncomplete).toBe(true);
      expect(result.incomplete).toHaveLength(1);
      expect(result.incomplete[0].status).toBe('paused');
      expect(result.incomplete[0].errorMessage).toContain('Rate limit');
    });

    it('excludes stopped repos from incomplete list', () => {
      insertTestRepo(1, 'org/active');
      insertTestRepo(2, 'org/stopped');
      stopRepo(2);

      upsertCollectionState(1, 'commits', { status: 'complete' });
      upsertCollectionState(2, 'commits', { status: 'paused' });

      const result = queue.getIncompleteForResume();
      expect(result.hasIncomplete).toBe(false);
    });
  });

  describe('skipCurrent()', () => {
    it('skipCurrent() when inactive is a no-op — does not throw (BUG-03)', () => {
      // queue is freshly created — _isActive is false
      // With BUG-03 fix in place, skipCurrent should be guarded and NOT call engine.abort()
      // We verify: no error thrown, isActive remains false, no state mutation
      insertTestRepo(1, 'org/repo1');
      expect(() => queue.skipCurrent()).not.toThrow();
      // isActive should remain false (guard prevented any changes)
      expect(queue.getStatus().isActive).toBe(false);
    });

    it('skipCurrent() called multiple times when inactive stays safe (BUG-03)', () => {
      // Calling skipCurrent when inactive should always be idempotent
      insertTestRepo(1, 'org/repo1');
      expect(() => {
        queue.skipCurrent();
        queue.skipCurrent();
        queue.skipCurrent();
      }).not.toThrow();
      expect(queue.getStatus().isActive).toBe(false);
    });
  });

  describe('transitionLegacyRepos (via startBatch)', () => {
    // transitionLegacyRepos is private and runs once per module via _transitionDone flag.
    // We test it indirectly through startBatch. Since createCollectionOctokit is mocked null,
    // processQueue returns immediately after transition runs.

    it('resets mid-collection legacy repos (in_progress, no direction)', async () => {
      insertTestRepo(1, 'org/legacy-mid');

      // Simulate Phase 3 mid-collection state (no direction = legacy forward)
      upsertCollectionState(1, 'commits', { status: 'in_progress', cursor: 'old-cursor' });
      upsertCollectionState(1, 'pull_requests', { status: 'in_progress' });

      // Insert some data that should get deleted on reset
      testDb.insert(schema.commits).values({
        sha: 'legacy1', repoId: 1, message: 'old', committedAt: new Date(),
      }).run();

      await queue.startBatch();

      // Data should be deleted
      expect(getRepoItemCounts(1).commits).toBe(0);

      // State should be reset to pending
      const commitState = getCollectionState(1, 'commits');
      expect(commitState!.status).toBe('pending');
      expect(commitState!.cursor).toBeNull();
      expect(commitState!.direction).toBeNull();
    });

    it('preserves complete repos during transition', async () => {
      insertTestRepo(1, 'org/complete-legacy');

      upsertCollectionState(1, 'commits', { status: 'complete' });
      upsertCollectionState(1, 'pull_requests', { status: 'complete' });

      testDb.insert(schema.commits).values({
        sha: 'keep-me', repoId: 1, message: 'preserved', committedAt: new Date(),
      }).run();

      await queue.startBatch();

      // Data should be preserved
      expect(getRepoItemCounts(1).commits).toBe(1);
      expect(getCollectionState(1, 'commits')!.status).toBe('complete');
    });

    it('skips repos already using reverse direction', async () => {
      insertTestRepo(1, 'org/already-reverse');

      upsertCollectionState(1, 'commits', {
        status: 'in_progress', direction: 'reverse',
        oldestMonthCollected: '2026-01-01T00:00:00Z',
      });

      testDb.insert(schema.commits).values({
        sha: 'reverse1', repoId: 1, message: 'keep', committedAt: new Date(),
      }).run();

      await queue.startBatch();

      // Should NOT be reset — already using reverse strategy
      expect(getRepoItemCounts(1).commits).toBe(1);
      expect(getCollectionState(1, 'commits')!.direction).toBe('reverse');
    });
  });
});
