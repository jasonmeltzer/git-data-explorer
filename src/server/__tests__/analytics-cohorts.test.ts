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

// Import services AFTER mock
const { getAiMarkerDate, setAiMarkerDate } = await import('../services/analytics-config.js');
const { getCohortCommitMetrics, getCohortPrMetrics } = await import('../services/analytics-cohorts.js');

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

describe('analytics-config', () => {
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

  it('getAiMarkerDate() returns null when no marker is set', () => {
    expect(getAiMarkerDate()).toBeNull();
  });

  it('setAiMarkerDate stores value and getAiMarkerDate returns that Date', () => {
    const date = new Date('2025-06-01');
    setAiMarkerDate(date);
    const result = getAiMarkerDate();
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(date.getTime());
  });

  it('setAiMarkerDate(null) clears marker, getAiMarkerDate() returns null', () => {
    setAiMarkerDate(new Date('2025-06-01'));
    setAiMarkerDate(null);
    expect(getAiMarkerDate()).toBeNull();
  });
});

describe('getCohortCommitMetrics', () => {
  const baseDate = new Date('2025-01-01'); // firstCommitAt
  const twoMonthsLater = new Date('2025-03-01');   // 0-3mo cohort
  const sixMonthsLater = new Date('2025-07-01');   // 3-12mo cohort
  const thirteenMonthsLater = new Date('2026-02-01'); // 1yr+ cohort
  const aiMarker = new Date('2025-06-15');

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

  it('author with 2mo tenure at data point time returns cohort 0-3mo', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    insertCommit(repoId, authorId, twoMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    expect(results.length).toBeGreaterThan(0);
    const row = results.find(r => r.cohort === '0-3mo');
    expect(row).toBeDefined();
    expect(row!.totalCount).toBe(1);
  });

  it('author with 6mo tenure at data point time returns cohort 3-12mo', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    insertCommit(repoId, authorId, sixMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    expect(results.length).toBeGreaterThan(0);
    const row = results.find(r => r.cohort === '3-12mo');
    expect(row).toBeDefined();
    expect(row!.totalCount).toBe(1);
  });

  it('author with 13mo tenure at data point time returns cohort 1yr+', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    insertCommit(repoId, authorId, thirteenMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      tenureMode: 'global',
    });

    expect(results.length).toBeGreaterThan(0);
    const row = results.find(r => r.cohort === '1yr+');
    expect(row).toBeDefined();
    expect(row!.totalCount).toBe(1);
  });

  it('dynamic cohort: same author appears in 0-3mo for early data and 3-12mo for later data (D-04)', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    // Early commit in 0-3mo window
    insertCommit(repoId, authorId, twoMonthsLater);
    // Later commit in 3-12mo window
    insertCommit(repoId, authorId, sixMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    const early = results.find(r => r.cohort === '0-3mo');
    const later = results.find(r => r.cohort === '3-12mo');
    expect(early).toBeDefined();
    expect(later).toBeDefined();
  });

  it('bot authors (isBot=true) are excluded from cohort metrics results', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const botId = insertAuthor(1, 'dependabot[bot]', baseDate, true);
    insertCommit(repoId, botId, twoMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    expect(results).toHaveLength(0);
  });

  it('authors with NULL firstCommitAt are excluded from global tenure results', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'ghost', null); // null firstCommitAt
    insertCommit(repoId, authorId, twoMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    expect(results).toHaveLength(0);
  });

  it('per-repo tenure mode uses MIN(committedAt) per author+repo instead of authors.firstCommitAt (D-01, D-02)', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    // Author's global firstCommitAt is 2024-01-01 (13+ months before test commits)
    // but first commit IN THIS REPO is 2025-01-01 (2 months before 2025-03-01)
    const authorId = insertAuthor(1, 'dev1', new Date('2024-01-01'));
    // First commit in this repo: 2025-01-01
    insertCommit(repoId, authorId, new Date('2025-01-01'), 5, 2, 1);
    // Second commit: 2025-03-01 (2 months after first in-repo commit => 0-3mo)
    insertCommit(repoId, authorId, twoMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'repo',
    });

    // With global tenure, the 2025-03-01 commit would be 1yr+ (13mo after 2024-01-01)
    // With repo tenure, it should be 0-3mo (2mo after 2025-01-01)
    const row = results.find(r => r.cohort === '0-3mo');
    expect(row).toBeDefined();
    // Should not have 1yr+ row from per-repo computation for these commits
    const wrongRow = results.find(r => r.cohort === '1yr+' && r.periodMonth === '2025-03');
    expect(wrongRow).toBeUndefined();
  });

  it('AI marker split: with marker set, returns data grouped by before/after period', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    // Before marker (2025-03-01 < 2025-06-15)
    insertCommit(repoId, authorId, twoMonthsLater);
    // After marker (2025-07-01 > 2025-06-15)
    insertCommit(repoId, authorId, sixMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
      aiMarkerDate: aiMarker,
    });

    const periods = new Set(results.map(r => r.period));
    expect(periods.has('before')).toBe(true);
    expect(periods.has('after')).toBe(true);
    expect(periods.has('all')).toBe(false);
  });

  it('no marker set: returns all data with period all', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    insertCommit(repoId, authorId, twoMonthsLater);
    insertCommit(repoId, authorId, sixMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
      aiMarkerDate: null,
    });

    const periods = new Set(results.map(r => r.period));
    expect(periods.has('all')).toBe(true);
    expect(periods.has('before')).toBe(false);
    expect(periods.has('after')).toBe(false);
  });

  it('only repos where BOTH commits and pull_requests status=complete are included', () => {
    // Repo 1: only commits complete
    const repoId1 = insertRepo(1, 'org/repo1');
    testDb.insert(schema.collectionState).values([
      { repoId: repoId1, resourceType: 'commits', status: 'complete', lastRunAt: new Date() },
      { repoId: repoId1, resourceType: 'pull_requests', status: 'in_progress', lastRunAt: new Date() },
    ]).run();

    // Repo 2: both complete
    const repoId2 = insertRepo(2, 'org/repo2');
    markRepoComplete(repoId2);

    const authorId1 = insertAuthor(1, 'dev1', baseDate);
    const authorId2 = insertAuthor(2, 'dev2', baseDate);

    insertCommit(repoId1, authorId1, twoMonthsLater, 100, 50, 10);
    insertCommit(repoId2, authorId2, twoMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    // Only repo2's data should appear (repoId1 not fully complete)
    const totalCount = results.reduce((sum, r) => sum + r.totalCount, 0);
    expect(totalCount).toBe(1); // only the commit from repo2
  });

  it('multi-repo isolation: repoIds filter returns data only for specified repos', () => {
    const repoId1 = insertRepo(1, 'org/repo1');
    const repoId2 = insertRepo(2, 'org/repo2');
    markRepoComplete(repoId1);
    markRepoComplete(repoId2);

    const authorId1 = insertAuthor(1, 'dev1', baseDate);
    const authorId2 = insertAuthor(2, 'dev2', baseDate);

    insertCommit(repoId1, authorId1, twoMonthsLater);
    insertCommit(repoId2, authorId2, twoMonthsLater);

    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
      repoIds: [repoId1],
    });

    // Only one commit from repo1
    const totalCount = results.reduce((sum, r) => sum + r.totalCount, 0);
    expect(totalCount).toBe(1);
  });

  it('returns empty array when no complete repos exist', () => {
    const results = getCohortCommitMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });
    expect(results).toHaveLength(0);
  });
});

describe('getCohortPrMetrics', () => {
  const baseDate = new Date('2025-01-01');
  const twoMonthsLater = new Date('2025-03-01');

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

  it('returns correct aggregates for PR data (linesAdded, linesDeleted, filesChanged, count)', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    insertPr(repoId, authorId, twoMonthsLater, 50, 20, 5);

    const results = getCohortPrMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    expect(results.length).toBeGreaterThan(0);
    const row = results.find(r => r.cohort === '0-3mo');
    expect(row).toBeDefined();
    expect(row!.totalCount).toBe(1);
    expect(row!.avgLinesAdded).toBeCloseTo(50, 0);
    expect(row!.avgLinesDeleted).toBeCloseTo(20, 0);
    expect(row!.avgFilesChanged).toBeCloseTo(5, 0);
    expect(row!.contributorCount).toBe(1);
  });

  it('bot authors excluded from PR metrics', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const botId = insertAuthor(1, 'renovate[bot]', baseDate, true);
    insertPr(repoId, botId, twoMonthsLater);

    const results = getCohortPrMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
    });

    expect(results).toHaveLength(0);
  });

  it('returns period all when no AI marker set', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const authorId = insertAuthor(1, 'dev1', baseDate);
    insertPr(repoId, authorId, twoMonthsLater);

    const results = getCohortPrMetrics({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      tenureMode: 'global',
      aiMarkerDate: null,
    });

    expect(results.every(r => r.period === 'all')).toBe(true);
  });
});
