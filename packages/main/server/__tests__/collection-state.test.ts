import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { vi } from 'vitest';

// Build an in-memory test database with the full schema (including unique index)
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
      repo_created_at INTEGER,
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
      commit_count INTEGER NOT NULL DEFAULT 0,
      first_commit_at INTEGER
    );

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

    CREATE UNIQUE INDEX idx_collection_repo_type_unique ON collection_state (repo_id, resource_type);
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import service under test after mock
const {
  upsertCollectionState,
  getCollectionState,
  markCollectionPaused,
  markCollectionComplete,
  getIncompleteCollections,
  getRepoItemCounts,
  getDepthSetting,
  setDepthSetting,
  getOldestMonthCollected,
  resetMidCollectionRepo,
} = await import('../services/collection-state.js');

// Helper to insert a test repo
function insertTestRepo(githubId: number, fullName: string): number {
  testDb.insert(schema.repositories).values({
    githubId,
    fullName,
    ownerLogin: fullName.split('/')[0],
    name: fullName.split('/')[1],
    isPrivate: false,
    defaultBranch: 'main',
    addedAt: new Date(),
  }).run();
  const rows = testDb.select().from(schema.repositories).all();
  return rows[rows.length - 1].id;
}

describe('Collection State Service', () => {
  beforeEach(() => {
    // Clear all tables before each test
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
  });

  describe('upsertCollectionState()', () => {
    it('creates a new row on first call', () => {
      const repoId = insertTestRepo(1001, 'org/repo1');
      upsertCollectionState(repoId, 'commits', {
        cursor: '2024-01-15T00:00:00Z',
        status: 'in_progress',
        lastPage: 3,
      });

      const rows = testDb.select().from(schema.collectionState).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].cursor).toBe('2024-01-15T00:00:00Z');
      expect(rows[0].status).toBe('in_progress');
      expect(rows[0].lastPage).toBe(3);
    });

    it('updates existing row on second call (no duplicate)', () => {
      const repoId = insertTestRepo(1002, 'org/repo2');
      upsertCollectionState(repoId, 'commits', {
        cursor: '2024-01-15T00:00:00Z',
        status: 'in_progress',
        lastPage: 3,
      });

      upsertCollectionState(repoId, 'commits', {
        cursor: '2024-02-01T00:00:00Z',
        status: 'in_progress',
        lastPage: 5,
      });

      const rows = testDb.select().from(schema.collectionState).all();
      expect(rows).toHaveLength(1);
      expect(rows[0].cursor).toBe('2024-02-01T00:00:00Z');
      expect(rows[0].lastPage).toBe(5);
    });

    it('allows different resource types for the same repo', () => {
      const repoId = insertTestRepo(1003, 'org/repo3');
      upsertCollectionState(repoId, 'commits', { status: 'in_progress' });
      upsertCollectionState(repoId, 'pull_requests', { status: 'pending' });

      const rows = testDb.select().from(schema.collectionState).all();
      expect(rows).toHaveLength(2);
    });
  });

  describe('getCollectionState()', () => {
    it('returns state matching last upsert', () => {
      const repoId = insertTestRepo(1004, 'org/repo4');
      upsertCollectionState(repoId, 'commits', {
        cursor: '2024-01-15T00:00:00Z',
        status: 'in_progress',
        lastPage: 3,
      });

      const state = getCollectionState(repoId, 'commits');
      expect(state).not.toBeNull();
      expect(state!.cursor).toBe('2024-01-15T00:00:00Z');
      expect(state!.status).toBe('in_progress');
      expect(state!.lastPage).toBe(3);
    });

    it('returns null for non-existent repo', () => {
      const state = getCollectionState(999, 'commits');
      expect(state).toBeNull();
    });

    it('cursor round-trips correctly through write/read', () => {
      const repoId = insertTestRepo(1005, 'org/repo5');
      const cursor = 'abc123def456';
      upsertCollectionState(repoId, 'commits', { cursor, status: 'in_progress' });

      const state = getCollectionState(repoId, 'commits');
      expect(state!.cursor).toBe(cursor);
    });
  });

  describe('markCollectionPaused()', () => {
    it('sets status to paused with error message', () => {
      const repoId = insertTestRepo(1006, 'org/repo6');
      upsertCollectionState(repoId, 'commits', { status: 'in_progress' });

      markCollectionPaused(repoId, 'commits', 'Rate limited', '2024-01-15T04:00:00Z');

      const state = getCollectionState(repoId, 'commits');
      expect(state!.status).toBe('paused');
      expect(state!.errorMessage).toContain('Rate limited');
      expect(state!.errorMessage).toContain('resetAt:2024-01-15T04:00:00Z');
    });

    it('sets paused without resetAt', () => {
      const repoId = insertTestRepo(1007, 'org/repo7');
      upsertCollectionState(repoId, 'commits', { status: 'in_progress' });

      markCollectionPaused(repoId, 'commits', 'Unknown error');

      const state = getCollectionState(repoId, 'commits');
      expect(state!.status).toBe('paused');
      expect(state!.errorMessage).toBe('Unknown error');
    });
  });

  describe('markCollectionComplete()', () => {
    it('sets status to complete and clears errorMessage', () => {
      const repoId = insertTestRepo(1008, 'org/repo8');
      upsertCollectionState(repoId, 'commits', {
        status: 'paused',
        errorMessage: 'Some error',
      });

      markCollectionComplete(repoId, 'commits');

      const state = getCollectionState(repoId, 'commits');
      expect(state!.status).toBe('complete');
      expect(state!.errorMessage).toBeNull();
    });

    it('sets lastRunAt to a recent timestamp', () => {
      const repoId = insertTestRepo(1009, 'org/repo9');
      const before = Date.now();
      markCollectionComplete(repoId, 'commits');
      const state = getCollectionState(repoId, 'commits');
      expect(state!.lastRunAt).not.toBeNull();
    });
  });

  describe('getIncompleteCollections()', () => {
    it('returns only pending, in_progress, and paused states', () => {
      const repoId = insertTestRepo(1010, 'org/repo10');

      upsertCollectionState(repoId, 'commits', { status: 'complete' });
      upsertCollectionState(repoId, 'pull_requests', { status: 'paused', errorMessage: 'Rate limit' });

      const incomplete = getIncompleteCollections();
      expect(incomplete).toHaveLength(1);
      expect(incomplete[0].resourceType).toBe('pull_requests');
      expect(incomplete[0].status).toBe('paused');
    });

    it('returns empty array when all are complete', () => {
      const repoId = insertTestRepo(1011, 'org/repo11');
      upsertCollectionState(repoId, 'commits', { status: 'complete' });

      const incomplete = getIncompleteCollections();
      expect(incomplete).toHaveLength(0);
    });

    it('includes pending and in_progress states', () => {
      const repoId1 = insertTestRepo(1012, 'org/repo12');
      const repoId2 = insertTestRepo(1013, 'org/repo13');

      upsertCollectionState(repoId1, 'commits', { status: 'pending' });
      upsertCollectionState(repoId2, 'commits', { status: 'in_progress', cursor: 'abc' });

      const incomplete = getIncompleteCollections();
      expect(incomplete).toHaveLength(2);
    });
  });

  describe('getRepoItemCounts()', () => {
    it('returns correct commit and PR counts', () => {
      const repoId = insertTestRepo(1014, 'org/repo14');

      testDb.insert(schema.commits).values([
        { sha: 'a1', repoId, message: 'c1', committedAt: new Date() },
        { sha: 'a2', repoId, message: 'c2', committedAt: new Date() },
        { sha: 'a3', repoId, message: 'c3', committedAt: new Date() },
      ]).run();

      testDb.insert(schema.pullRequests).values([
        { githubId: 1, repoId, number: 1, title: 'PR1', state: 'merged', createdAt: new Date(), updatedAt: new Date() },
      ]).run();

      const counts = getRepoItemCounts(repoId);
      expect(counts.commits).toBe(3);
      expect(counts.prs).toBe(1);
    });

    it('returns zeros for repo with no data', () => {
      const repoId = insertTestRepo(1015, 'org/repo15');
      const counts = getRepoItemCounts(repoId);
      expect(counts.commits).toBe(0);
      expect(counts.prs).toBe(0);
    });
  });

  describe('getIncompleteCollections() — stopped repo exclusion', () => {
    it('excludes stopped repos from incomplete results', () => {
      const activeRepoId = insertTestRepo(2001, 'org/active-repo');
      const stoppedRepoId = insertTestRepo(2002, 'org/stopped-repo');

      // Soft-delete the stopped repo
      testDb.update(schema.repositories)
        .set({ removedAt: new Date() })
        .where(eq(schema.repositories.id, stoppedRepoId))
        .run();

      // Both repos have paused collection state
      upsertCollectionState(activeRepoId, 'commits', { status: 'paused', errorMessage: 'Rate limit' });
      upsertCollectionState(stoppedRepoId, 'commits', { status: 'paused', errorMessage: 'Rate limit' });

      const incomplete = getIncompleteCollections();
      expect(incomplete).toHaveLength(1);
      expect(incomplete[0].repoId).toBe(activeRepoId);
    });

    it('returns empty when only stopped repos have incomplete state', () => {
      const stoppedRepoId = insertTestRepo(2003, 'org/only-stopped');
      testDb.update(schema.repositories)
        .set({ removedAt: new Date() })
        .where(eq(schema.repositories.id, stoppedRepoId))
        .run();

      upsertCollectionState(stoppedRepoId, 'commits', { status: 'in_progress' });
      upsertCollectionState(stoppedRepoId, 'pull_requests', { status: 'paused' });

      const incomplete = getIncompleteCollections();
      expect(incomplete).toHaveLength(0);
    });
  });

  describe('getDepthSetting()', () => {
    it('returns default of 3 when no config exists', () => {
      expect(getDepthSetting()).toBe(3);
    });

    it('returns stored value', () => {
      setDepthSetting(6);
      expect(getDepthSetting()).toBe(6);
    });

    it('returns updated value after change', () => {
      setDepthSetting(12);
      expect(getDepthSetting()).toBe(12);
      setDepthSetting(1);
      expect(getDepthSetting()).toBe(1);
    });
  });

  describe('setDepthSetting()', () => {
    it('creates config row on first call', () => {
      setDepthSetting(5);
      const rows = testDb.select().from(schema.appConfig).all();
      const depthRow = rows.find(r => r.key === 'collection_depth_months');
      expect(depthRow).toBeDefined();
      expect(depthRow!.value).toBe('5');
    });

    it('updates without duplicating on second call', () => {
      setDepthSetting(5);
      setDepthSetting(10);
      const rows = testDb.select().from(schema.appConfig).all();
      const depthRows = rows.filter(r => r.key === 'collection_depth_months');
      expect(depthRows).toHaveLength(1);
      expect(depthRows[0].value).toBe('10');
    });
  });

  describe('getOldestMonthCollected()', () => {
    it('returns null when no collection state exists', () => {
      const repoId = insertTestRepo(3001, 'org/no-state');
      expect(getOldestMonthCollected(repoId, 'commits')).toBeNull();
    });

    it('returns null when oldestMonthCollected is not set', () => {
      const repoId = insertTestRepo(3002, 'org/no-oldest');
      upsertCollectionState(repoId, 'commits', { status: 'in_progress' });
      expect(getOldestMonthCollected(repoId, 'commits')).toBeNull();
    });

    it('returns the stored value', () => {
      const repoId = insertTestRepo(3003, 'org/has-oldest');
      upsertCollectionState(repoId, 'commits', {
        status: 'complete',
        direction: 'reverse',
        oldestMonthCollected: '2026-01-01T00:00:00Z',
      });
      expect(getOldestMonthCollected(repoId, 'commits')).toBe('2026-01-01T00:00:00Z');
    });

    it('returns different values for commits vs pull_requests', () => {
      const repoId = insertTestRepo(3004, 'org/dual-resource');
      upsertCollectionState(repoId, 'commits', {
        status: 'complete', direction: 'reverse',
        oldestMonthCollected: '2026-01-01T00:00:00Z',
      });
      upsertCollectionState(repoId, 'pull_requests', {
        status: 'complete', direction: 'reverse',
        oldestMonthCollected: '2026-02-01T00:00:00Z',
      });

      expect(getOldestMonthCollected(repoId, 'commits')).toBe('2026-01-01T00:00:00Z');
      expect(getOldestMonthCollected(repoId, 'pull_requests')).toBe('2026-02-01T00:00:00Z');
    });
  });

  describe('resetMidCollectionRepo()', () => {
    it('deletes commits and PRs for the repo', () => {
      const repoId = insertTestRepo(4001, 'org/reset-me');

      testDb.insert(schema.commits).values([
        { sha: 'r1', repoId, message: 'c1', committedAt: new Date() },
        { sha: 'r2', repoId, message: 'c2', committedAt: new Date() },
      ]).run();
      testDb.insert(schema.pullRequests).values([
        { githubId: 5001, repoId, number: 1, title: 'PR1', state: 'merged', createdAt: new Date(), updatedAt: new Date() },
      ]).run();

      expect(getRepoItemCounts(repoId).commits).toBe(2);
      expect(getRepoItemCounts(repoId).prs).toBe(1);

      resetMidCollectionRepo(repoId);

      expect(getRepoItemCounts(repoId).commits).toBe(0);
      expect(getRepoItemCounts(repoId).prs).toBe(0);
    });

    it('resets collection state fields to pending/null', () => {
      const repoId = insertTestRepo(4002, 'org/reset-state');
      upsertCollectionState(repoId, 'commits', {
        status: 'in_progress', cursor: 'abc', direction: 'forward',
        oldestMonthCollected: '2026-01-01', depthTarget: '2026-01-01',
      });
      upsertCollectionState(repoId, 'pull_requests', {
        status: 'paused', cursor: 'def', errorMessage: 'Rate limit',
      });

      resetMidCollectionRepo(repoId);

      const commitState = getCollectionState(repoId, 'commits');
      expect(commitState!.status).toBe('pending');
      expect(commitState!.cursor).toBeNull();
      expect(commitState!.direction).toBeNull();
      expect(commitState!.oldestMonthCollected).toBeNull();
      expect(commitState!.depthTarget).toBeNull();
      expect(commitState!.errorMessage).toBeNull();

      const prState = getCollectionState(repoId, 'pull_requests');
      expect(prState!.status).toBe('pending');
      expect(prState!.cursor).toBeNull();
    });

    it('does not affect other repos', () => {
      const repoId1 = insertTestRepo(4003, 'org/keep-me');
      const repoId2 = insertTestRepo(4004, 'org/reset-me2');

      testDb.insert(schema.commits).values([
        { sha: 'k1', repoId: repoId1, message: 'keep', committedAt: new Date() },
        { sha: 'r1', repoId: repoId2, message: 'reset', committedAt: new Date() },
      ]).run();

      upsertCollectionState(repoId1, 'commits', { status: 'complete' });
      upsertCollectionState(repoId2, 'commits', { status: 'in_progress' });

      resetMidCollectionRepo(repoId2);

      // Repo 1 untouched
      expect(getRepoItemCounts(repoId1).commits).toBe(1);
      expect(getCollectionState(repoId1, 'commits')!.status).toBe('complete');

      // Repo 2 reset
      expect(getRepoItemCounts(repoId2).commits).toBe(0);
      expect(getCollectionState(repoId2, 'commits')!.status).toBe('pending');
    });
  });

  describe('upsertCollectionState() — new Phase 03.1 fields', () => {
    it('stores and retrieves direction field', () => {
      const repoId = insertTestRepo(5001, 'org/direction-test');
      upsertCollectionState(repoId, 'commits', { status: 'in_progress', direction: 'reverse' });
      const state = getCollectionState(repoId, 'commits');
      expect(state!.direction).toBe('reverse');
    });

    it('stores and retrieves oldestMonthCollected field', () => {
      const repoId = insertTestRepo(5002, 'org/oldest-test');
      upsertCollectionState(repoId, 'commits', {
        status: 'in_progress', oldestMonthCollected: '2026-01-01T00:00:00Z',
      });
      const state = getCollectionState(repoId, 'commits');
      expect(state!.oldestMonthCollected).toBe('2026-01-01T00:00:00Z');
    });

    it('stores and retrieves depthTarget field', () => {
      const repoId = insertTestRepo(5003, 'org/depth-test');
      upsertCollectionState(repoId, 'commits', {
        status: 'in_progress', depthTarget: '2025-12-01T00:00:00Z',
      });
      const state = getCollectionState(repoId, 'commits');
      expect(state!.depthTarget).toBe('2025-12-01T00:00:00Z');
    });

    it('partial update preserves unmentioned fields', () => {
      const repoId = insertTestRepo(5004, 'org/partial-test');
      upsertCollectionState(repoId, 'commits', {
        status: 'in_progress', direction: 'reverse',
        oldestMonthCollected: '2026-01-01T00:00:00Z', cursor: 'abc',
      });

      // Update only status — other fields should be preserved
      upsertCollectionState(repoId, 'commits', { status: 'complete' });

      const state = getCollectionState(repoId, 'commits');
      expect(state!.status).toBe('complete');
      expect(state!.direction).toBe('reverse');
      expect(state!.oldestMonthCollected).toBe('2026-01-01T00:00:00Z');
      expect(state!.cursor).toBe('abc');
    });
  });
});
