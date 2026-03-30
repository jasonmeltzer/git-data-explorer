import { describe, it, expect, beforeEach } from 'vitest';
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
const {
  getRollingComparison,
  pctChange,
  normalizeToDaily,
  getMonthOverMonthPeriods,
  getQuarterOverQuarterPeriods,
} = await import('../services/analytics-rolling.js');

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

function insertAuthor(id: number, login: string, isBot = false): number {
  testDb.insert(schema.authors).values({
    id,
    githubLogin: login,
    isBot,
    firstCommitAt: new Date('2025-01-01'),
  }).run();
  return id;
}

let _shaCounter = 0;
function insertCommit(
  repoId: number,
  authorId: number,
  committedAtDate: Date,
  linesAdded = 30,
  linesDeleted = 20,
  filesChanged = 3
): void {
  _shaCounter++;
  testDb.insert(schema.commits).values({
    sha: `sha${_shaCounter}`,
    repoId,
    authorId,
    message: `commit ${_shaCounter}`,
    committedAt: committedAtDate,
    linesAdded,
    linesDeleted,
    filesChanged,
  }).run();
}

let _prCounter = 0;
function insertPr(
  repoId: number,
  authorId: number,
  createdAtDate: Date,
  linesAdded = 40,
  linesDeleted = 10,
  filesChanged = 4
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
    { repoId, resourceType: 'commits', status: 'complete', lastRunAt: new Date() },
    { repoId, resourceType: 'pull_requests', status: 'complete', lastRunAt: new Date() },
  ]).run();
}

// ---- Tests ----

describe('pctChange', () => {
  it('returns null when prior is 0 (avoids divide-by-zero)', () => {
    expect(pctChange(100, 0)).toBeNull();
  });

  it('returns 25.0 when current=50 and prior=40', () => {
    expect(pctChange(50, 40)).toBeCloseTo(25.0, 5);
  });

  it('returns -20.0 when current=40 and prior=50', () => {
    expect(pctChange(40, 50)).toBeCloseTo(-20.0, 5);
  });

  it('returns 0 when current equals prior', () => {
    expect(pctChange(10, 10)).toBeCloseTo(0, 5);
  });
});

describe('normalizeToDaily', () => {
  it('returns total / days when period does not extend into the future', () => {
    const start = new Date('2026-02-01');
    const end = new Date('2026-02-10');
    const now = new Date('2026-02-28');
    // 9 days from Feb 1 to Feb 10 (end - start in ms / ms_per_day)
    const result = normalizeToDaily(90, start, end, now);
    expect(result).toBeCloseTo(90 / 9, 5);
  });

  it('caps endDate to now when endDate is in the future', () => {
    // Period: Mar 1 - Mar 31, but today is Mar 10 (10 days so far)
    const start = new Date('2026-03-01');
    const end = new Date('2026-03-31');
    const now = new Date('2026-03-10');
    // Effective days: Mar 1 to Mar 10 = 9 days
    const result = normalizeToDaily(90, start, end, now);
    expect(result).toBeCloseTo(90 / 9, 5);
  });

  it('returns 0 when effective days is 0', () => {
    const start = new Date('2026-03-10');
    const end = new Date('2026-03-10');
    const now = new Date('2026-03-10');
    expect(normalizeToDaily(100, start, end, now)).toBe(0);
  });
});

describe('getMonthOverMonthPeriods', () => {
  it('returns current month boundaries and previous month boundaries with correct labels', () => {
    // Reference: March 10, 2026
    const refDate = new Date('2026-03-10');
    const [current, prior] = getMonthOverMonthPeriods(refDate);

    expect(current.label).toBe('Mar 2026');
    expect(current.startDate.getUTCFullYear()).toBe(2026);
    expect(current.startDate.getUTCMonth()).toBe(2); // March = 2
    expect(current.startDate.getUTCDate()).toBe(1);

    expect(prior.label).toBe('Feb 2026');
    expect(prior.startDate.getUTCMonth()).toBe(1); // February = 1
    expect(prior.startDate.getUTCDate()).toBe(1);
  });

  it('wraps correctly from January to December of prior year', () => {
    const refDate = new Date('2026-01-15');
    const [current, prior] = getMonthOverMonthPeriods(refDate);

    expect(current.label).toBe('Jan 2026');
    expect(prior.label).toBe('Dec 2025');
    expect(prior.startDate.getUTCFullYear()).toBe(2025);
    expect(prior.startDate.getUTCMonth()).toBe(11); // December = 11
  });
});

describe('getQuarterOverQuarterPeriods', () => {
  it('returns current quarter boundaries and previous quarter boundaries', () => {
    // Reference: March 10, 2026 — Q1 2026
    const refDate = new Date('2026-03-10');
    const [current, prior] = getQuarterOverQuarterPeriods(refDate);

    expect(current.label).toBe('Q1 2026');
    expect(prior.label).toBe('Q4 2025');

    // Q1 starts Jan 1
    expect(current.startDate.getUTCMonth()).toBe(0);  // January
    expect(current.startDate.getUTCDate()).toBe(1);

    // Q4 2025 starts Oct 1
    expect(prior.startDate.getUTCFullYear()).toBe(2025);
    expect(prior.startDate.getUTCMonth()).toBe(9);  // October = 9
    expect(prior.startDate.getUTCDate()).toBe(1);
  });

  it('returns Q2 2026 and Q1 2026 when reference date is in Q2', () => {
    const refDate = new Date('2026-05-15');
    const [current, prior] = getQuarterOverQuarterPeriods(refDate);
    expect(current.label).toBe('Q2 2026');
    expect(prior.label).toBe('Q1 2026');
  });
});

describe('getRollingComparison - month granularity', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
    _shaCounter = 0;
    _prCounter = 0;
  });

  it('returns correct granularity and period structure', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1');

    // No commits — just check structure
    const result = getRollingComparison({
      granularity: 'month',
      referenceDate: new Date('2026-03-10'),
    });

    expect(result.granularity).toBe('month');
    expect(result.current.label).toBe('Mar 2026');
    expect(result.prior.label).toBe('Feb 2026');
    expect(result).toHaveProperty('changes');
    expect(result.changes).toHaveProperty('commitSize');
    expect(result.changes).toHaveProperty('prSize');
    expect(result.changes).toHaveProperty('commitFrequency');
    expect(result.changes).toHaveProperty('prFrequency');
  });

  it('partial current period normalized using referenceDate as now', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1');

    // March: 5 commits on Mar 5 (5 days into month)
    // Reference date: Mar 10
    for (let i = 0; i < 5; i++) {
      insertCommit(repoId, authorId, new Date('2026-03-05'), 100, 50, 5);
    }

    // February: 10 commits spread across the full month
    for (let i = 0; i < 10; i++) {
      insertCommit(repoId, authorId, new Date('2026-02-15'), 40, 20, 2);
    }

    const result = getRollingComparison({
      granularity: 'month',
      referenceDate: new Date('2026-03-10'),
    });

    // Current period has 5 commits within Mar 1 - Mar 10 (9 days effective)
    expect(result.current.commitCount).toBe(5);
    expect(result.current.dailyCommitCount).toBeGreaterThan(0);

    // Prior period has 10 commits across 28 days in Feb
    expect(result.prior.commitCount).toBe(10);

    // dailyCommitCount for prior = 10 / 28 days = ~0.357
    // dailyCommitCount for current = 5 / 9 days = ~0.556
    // So current has higher daily rate
    expect(result.current.dailyCommitCount).toBeGreaterThan(result.prior.dailyCommitCount);
  });

  it('pctChange is null when prior period has 0 commits', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1');

    // Only current period has commits
    insertCommit(repoId, authorId, new Date('2026-03-05'));

    const result = getRollingComparison({
      granularity: 'month',
      referenceDate: new Date('2026-03-10'),
    });

    // Prior commit count is 0, so frequency change should be null
    expect(result.changes.commitFrequency).toBeNull();
  });

  it('bot authors are excluded from rolling metrics', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const humanId = insertAuthor(1, 'dev1', false);
    const botId = insertAuthor(2, 'dependabot[bot]', true);

    // Bot has large commits in both periods
    insertCommit(repoId, botId, new Date('2026-02-15'), 10000, 10000, 100);
    insertCommit(repoId, botId, new Date('2026-03-05'), 10000, 10000, 100);

    // Human has small commit only in current
    insertCommit(repoId, humanId, new Date('2026-03-05'), 10, 5, 1);

    const result = getRollingComparison({
      granularity: 'month',
      referenceDate: new Date('2026-03-10'),
    });

    // Bot commits should be excluded; current should only count the human's commit
    expect(result.current.commitCount).toBe(1);
    expect(result.prior.commitCount).toBe(0);
  });

  it('incomplete repos are excluded from rolling metrics', () => {
    // Repo 1: only commits complete (not PRs)
    const repoId1 = insertRepo(1, 'org/repo1');
    testDb.insert(schema.collectionState).values([
      { repoId: repoId1, resourceType: 'commits', status: 'complete', lastRunAt: new Date() },
      { repoId: repoId1, resourceType: 'pull_requests', status: 'in_progress', lastRunAt: new Date() },
    ]).run();

    // Repo 2: both complete
    const repoId2 = insertRepo(2, 'org/repo2');
    markRepoComplete(repoId2);

    const authorId = insertAuthor(1, 'dev1');

    // Commits in both repos
    insertCommit(repoId1, authorId, new Date('2026-03-05'), 100, 100, 10);
    insertCommit(repoId2, authorId, new Date('2026-03-05'), 10, 5, 1);

    const result = getRollingComparison({
      granularity: 'month',
      referenceDate: new Date('2026-03-10'),
    });

    // Only repo2 (complete) commit should be counted
    expect(result.current.commitCount).toBe(1);
  });
});

describe('getRollingComparison - quarter granularity', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
    _shaCounter = 0;
    _prCounter = 0;
  });

  it('returns correct quarter labels and structure', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);

    const result = getRollingComparison({
      granularity: 'quarter',
      referenceDate: new Date('2026-03-10'),
    });

    expect(result.granularity).toBe('quarter');
    expect(result.current.label).toBe('Q1 2026');
    expect(result.prior.label).toBe('Q4 2025');
  });

  it('aggregates commits across full quarter correctly', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1');

    // Q4 2025 (Oct-Dec): 30 commits
    for (let i = 0; i < 30; i++) {
      insertCommit(repoId, authorId, new Date('2025-11-15'), 50, 20, 3);
    }

    // Q1 2026 (Jan-Mar, partial): 10 commits
    for (let i = 0; i < 10; i++) {
      insertCommit(repoId, authorId, new Date('2026-02-10'), 60, 30, 4);
    }

    const result = getRollingComparison({
      granularity: 'quarter',
      referenceDate: new Date('2026-03-10'),
    });

    expect(result.prior.commitCount).toBe(30);
    expect(result.current.commitCount).toBe(10);
  });
});
