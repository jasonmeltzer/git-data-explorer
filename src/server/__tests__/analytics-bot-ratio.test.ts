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
const { getBotRatioTrend } = await import('../services/analytics-bot-ratio.js');

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
  }).run();
  return id;
}

let _shaCounter = 0;
function insertCommit(repoId: number, authorId: number, committedAtEpoch: number): void {
  _shaCounter++;
  testDb.insert(schema.commits).values({
    sha: `sha${_shaCounter}`,
    repoId,
    authorId,
    message: `commit ${_shaCounter}`,
    committedAt: new Date(committedAtEpoch * 1000),
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

describe('getBotRatioTrend', () => {
  // Jan 1 2025 00:00:00 UTC
  const JAN_1_2025 = 1735689600;
  // Feb 1 2025 00:00:00 UTC
  const FEB_1_2025 = 1738368000;

  beforeEach(() => {
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
    _shaCounter = 0;
  });

  it('returns empty array when no commits exist', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);

    const results = getBotRatioTrend({});

    expect(results).toEqual([]);
  });

  it('returns correct botPercentage per month (50% bots)', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const humanId = insertAuthor(1, 'dev1', false);
    const botId = insertAuthor(2, 'dependabot[bot]', true);

    // 1 human + 1 bot in January 2025 = 50% bot
    insertCommit(repoId, humanId, JAN_1_2025);
    insertCommit(repoId, botId, JAN_1_2025);

    const results = getBotRatioTrend({});

    expect(results).toHaveLength(1);
    expect(results[0].periodMonth).toBe('2025-01');
    expect(results[0].humanCommits).toBe(1);
    expect(results[0].botCommits).toBe(1);
    expect(results[0].totalCommits).toBe(2);
    expect(results[0].botPercentage).toBe(50);
  });

  it('returns 0% botPercentage when all commits are human', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const humanId = insertAuthor(1, 'dev1', false);

    insertCommit(repoId, humanId, JAN_1_2025);
    insertCommit(repoId, humanId, JAN_1_2025 + 1000);

    const results = getBotRatioTrend({});

    expect(results).toHaveLength(1);
    expect(results[0].botCommits).toBe(0);
    expect(results[0].humanCommits).toBe(2);
    expect(results[0].botPercentage).toBe(0);
  });

  it('returns 100% botPercentage when all commits are from bots', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const botId = insertAuthor(1, 'renovate[bot]', true);

    insertCommit(repoId, botId, JAN_1_2025);

    const results = getBotRatioTrend({});

    expect(results).toHaveLength(1);
    expect(results[0].botCommits).toBe(1);
    expect(results[0].humanCommits).toBe(0);
    expect(results[0].botPercentage).toBe(100);
  });

  it('groups by month correctly across multiple months', () => {
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const humanId = insertAuthor(1, 'dev1', false);
    const botId = insertAuthor(2, 'bot[bot]', true);

    insertCommit(repoId, humanId, JAN_1_2025);
    insertCommit(repoId, botId, FEB_1_2025);

    const results = getBotRatioTrend({});

    expect(results).toHaveLength(2);
    const jan = results.find(r => r.periodMonth === '2025-01');
    const feb = results.find(r => r.periodMonth === '2025-02');
    expect(jan).toBeDefined();
    expect(feb).toBeDefined();
    expect(jan!.botPercentage).toBe(0);
    expect(feb!.botPercentage).toBe(100);
  });

  it('does NOT filter by is_bot in WHERE clause — counts both bot and human in total', () => {
    // This test verifies the total counts include both human and bot commits
    const repoId = insertRepo(1, 'org/repo1');
    markRepoComplete(repoId);
    const humanId = insertAuthor(1, 'dev1', false);
    const botId = insertAuthor(2, 'dependabot[bot]', true);

    insertCommit(repoId, humanId, JAN_1_2025);
    insertCommit(repoId, botId, JAN_1_2025);
    insertCommit(repoId, botId, JAN_1_2025 + 100);

    const results = getBotRatioTrend({});

    expect(results).toHaveLength(1);
    expect(results[0].totalCommits).toBe(3); // all 3 counted
    expect(results[0].botCommits).toBe(2);
    expect(results[0].humanCommits).toBe(1);
  });

  it('returns empty array when no complete repos exist', () => {
    const results = getBotRatioTrend({});
    expect(results).toEqual([]);
  });
});
