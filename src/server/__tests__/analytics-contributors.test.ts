import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { vi } from 'vitest';

// Build an in-memory test database with the full schema
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
    CREATE INDEX idx_commits_repo_date ON commits (repo_id, committed_at);
    CREATE INDEX idx_commits_author ON commits (author_id);
    CREATE UNIQUE INDEX idx_commits_sha_repo ON commits (sha, repo_id);
    CREATE INDEX idx_commits_author_repo ON commits (author_id, repo_id);
    CREATE INDEX idx_prs_repo_date ON pull_requests (repo_id, created_at);
    CREATE INDEX idx_prs_author ON pull_requests (author_id);
    CREATE UNIQUE INDEX idx_prs_github_id_repo ON pull_requests (github_id, repo_id);
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import service AFTER mock
const { getContributorStats } = await import('../services/analytics-contributors.js');

// ---- Helpers ----

function insertRepo(id: number, fullName: string): number {
  testDb.insert(schema.repositories).values({
    id,
    githubId: id * 100,
    fullName,
    ownerLogin: fullName.split('/')[0],
    name: fullName.split('/')[1],
    isPrivate: false,
    defaultBranch: 'main',
    addedAt: new Date(),
  }).run();
  return id;
}

function insertAuthor(
  id: number,
  login: string,
  firstCommitAtDate: Date | null,
  isBot = false
): number {
  testDb.insert(schema.authors).values({
    id,
    githubLogin: login,
    isBot,
    firstCommitAt: firstCommitAtDate ?? undefined,
  }).run();
  return id;
}

let _shaCounter = 0;
function insertCommit(
  repoId: number,
  authorId: number,
  committedAtDate: Date,
  linesAdded = 10,
  linesDeleted = 5,
  filesChanged = 2
): void {
  _shaCounter++;
  testDb.insert(schema.commits).values({
    sha: `sha-contributors-${_shaCounter}`,
    repoId,
    authorId,
    message: `commit ${_shaCounter}`,
    committedAt: committedAtDate,
    linesAdded,
    linesDeleted,
    filesChanged,
  }).run();
}

let _prCounter = 100;
function insertPr(
  repoId: number,
  authorId: number,
  createdAtDate: Date,
  linesAdded = 20,
  linesDeleted = 8,
  filesChanged = 3
): void {
  _prCounter++;
  testDb.insert(schema.pullRequests).values({
    githubId: _prCounter * 1000,
    repoId,
    authorId,
    number: _prCounter,
    title: `PR ${_prCounter}`,
    state: 'merged',
    createdAt: createdAtDate,
    updatedAt: createdAtDate,
    linesAdded,
    linesDeleted,
    filesChanged,
  }).run();
}

function markRepoComplete(repoId: number): void {
  testDb.insert(schema.collectionState).values([
    {
      repoId,
      resourceType: 'commits',
      status: 'complete',
      lastRunAt: new Date(),
    },
    {
      repoId,
      resourceType: 'pull_requests',
      status: 'complete',
      lastRunAt: new Date(),
    },
  ]).run();
}

// ---- Tests ----

describe('getContributorStats', () => {
  // Seed once before all tests — shared in-memory DB
  beforeAll(() => {
    insertRepo(10, 'test-org/test-repo');
    markRepoComplete(10);

    // Author 1: joined 2+ years ago (senior cohort)
    const firstCommit = new Date('2023-01-01T00:00:00Z');
    insertAuthor(1, 'senior-dev', firstCommit);

    // Author 2: joined recently (new cohort — within 3 months of start)
    const recentFirst = new Date('2025-12-01T00:00:00Z');
    insertAuthor(2, 'new-dev', recentFirst);

    // Both have commits within the analysis window
    const inRange = new Date('2026-01-15T00:00:00Z');
    insertCommit(10, 1, inRange, 50, 10, 5);
    insertCommit(10, 2, inRange, 20, 5, 2);
    insertPr(10, 1, inRange, 100, 20, 8);
    insertPr(10, 2, inRange, 30, 10, 3);
  });

  it('returns per-author aggregate stats with correct commit and PR counts', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-02-01T00:00:00Z');

    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'global',
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    const seniorRow = results.find(r => r.authorLogin === 'senior-dev');
    const newRow = results.find(r => r.authorLogin === 'new-dev');
    expect(seniorRow).toBeDefined();
    expect(newRow).toBeDefined();
    expect(seniorRow!.totalCommits).toBe(1);
    expect(seniorRow!.totalPrs).toBe(1);
    expect(newRow!.totalCommits).toBe(1);
    expect(newRow!.totalPrs).toBe(1);
  });

  it('excludes commits outside the date range', () => {
    const start = new Date('2025-06-01T00:00:00Z');
    const end = new Date('2025-07-01T00:00:00Z');

    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'global',
    });

    // Our test commits are in January 2026, so this range should return no results
    expect(results).toHaveLength(0);
  });

  it('returns empty array when no complete repos match', () => {
    const results = getContributorStats({
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-02-01T00:00:00Z'),
      tenureMode: 'global',
      repoIds: [999], // non-existent repo
    });
    expect(results).toHaveLength(0);
  });

  it('returns firstCommitAt as ISO string', () => {
    const results = getContributorStats({
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-02-01T00:00:00Z'),
      tenureMode: 'global',
    });
    for (const row of results) {
      expect(typeof row.firstCommitAt).toBe('string');
      expect(() => new Date(row.firstCommitAt)).not.toThrow();
    }
  });
});
