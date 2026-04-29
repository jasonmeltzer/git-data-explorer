import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// ── In-memory test database (must be created before module mock) ──────────────
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
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
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

// ── Module mock (must be hoisted before service imports) ──────────────────────
vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// ── Dynamic imports AFTER mock ─────────────────────────────────────────────────
const { getDeveloperMonthly } = await import('../services/analytics-developer-monthly.js');

// ── Time constants ─────────────────────────────────────────────────────────────
// Epoch seconds for fixed dates within test months (UTC)
const JAN_15_2025 = Math.floor(Date.UTC(2025, 0, 15) / 1000);  // 2025-01
const FEB_15_2025 = Math.floor(Date.UTC(2025, 1, 15) / 1000);  // 2025-02
const MAR_15_2025 = Math.floor(Date.UTC(2025, 2, 15) / 1000);  // 2025-03

// ── Test data helpers ──────────────────────────────────────────────────────────

const TEST_PERIODS = [
  {
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    label: 'All-time',
  },
];

let _shaCounter = 0;
let _githubIdCounter = 0;
let _prCounter = 0;

/**
 * Clear and seed a base repo (id=1) marked complete for both resource types.
 */
function clearAndSeedBase() {
  const raw = testDb.$client;
  raw.exec(`DELETE FROM collection_state`);
  raw.exec(`DELETE FROM pull_requests`);
  raw.exec(`DELETE FROM commits`);
  raw.exec(`DELETE FROM authors`);
  raw.exec(`DELETE FROM repositories`);
  _shaCounter = 0;
  _githubIdCounter = 0;
  _prCounter = 0;

  // repo id=1
  raw.prepare(`
    INSERT INTO repositories (id, github_id, full_name, owner_login, name, added_at)
    VALUES (1, 101, 'org/repo1', 'org', 'repo1', ${JAN_15_2025})
  `).run();

  // Mark repo complete for both resource types (required by getCompleteRepoIds)
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (1, 'commits', 'complete')`).run();
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (1, 'pull_requests', 'complete')`).run();
}

function insertAuthor(id: number, login: string, isBot = 0): void {
  const raw = testDb.$client;
  raw.prepare(`
    INSERT INTO authors (id, github_login, is_bot, first_commit_at)
    VALUES (?, ?, ?, ?)
  `).run(id, login, isBot, JAN_15_2025);
}

function insertCommit(authorId: number, committedAt: number, linesAdded = 10, linesDeleted = 0, filesChanged = 1): void {
  _shaCounter++;
  const raw = testDb.$client;
  raw.prepare(`
    INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted, files_changed)
    VALUES (?, 1, ?, 'msg', ?, ?, ?, ?)
  `).run(`sha${_shaCounter}`, authorId, committedAt, linesAdded, linesDeleted, filesChanged);
}

function insertPr(authorId: number, createdAt: number): void {
  _prCounter++;
  _githubIdCounter++;
  const raw = testDb.$client;
  raw.prepare(`
    INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, 'merged', ?, ?)
  `).run(_githubIdCounter, authorId, _prCounter, `PR ${_prCounter}`, createdAt, createdAt);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('getDeveloperMonthly', () => {

  beforeEach(() => {
    clearAndSeedBase();
  });

  it('returns one row per (active dev, month) — D-19/D-20', () => {
    // Author A active in 2025-01 and 2025-02; Author B active in 2025-02 and 2025-03
    insertAuthor(1, 'alice');
    insertAuthor(2, 'bob');

    insertCommit(1, JAN_15_2025);  // alice in 2025-01
    insertCommit(1, FEB_15_2025);  // alice in 2025-02
    insertCommit(2, FEB_15_2025);  // bob in 2025-02
    insertCommit(2, MAR_15_2025);  // bob in 2025-03

    const result = getDeveloperMonthly([1], TEST_PERIODS);

    expect(result).toHaveLength(4);
    const pairs = result.map(r => `${r.authorLogin}:${r.month}`);
    expect(pairs).toContain('alice:2025-01');
    expect(pairs).toContain('alice:2025-02');
    expect(pairs).toContain('bob:2025-02');
    expect(pairs).toContain('bob:2025-03');
  });

  it('excludes bot authors — D-23', () => {
    insertAuthor(1, 'alice');
    insertAuthor(2, 'dependabot[bot]', 1);  // is_bot=1

    insertCommit(1, JAN_15_2025);
    insertCommit(2, JAN_15_2025);  // bot commit
    insertPr(2, JAN_15_2025);       // bot PR

    const result = getDeveloperMonthly([1], TEST_PERIODS);

    expect(result.some(r => r.authorLogin === 'dependabot[bot]')).toBe(false);
    expect(result.some(r => r.authorLogin === 'alice')).toBe(true);
  });

  it('returns null per-commit-size fields when commitCount=0 — D-19', () => {
    // Author has 1 PR created in 2025-01 but ZERO commits
    insertAuthor(1, 'alice');
    insertPr(1, JAN_15_2025);

    const result = getDeveloperMonthly([1], TEST_PERIODS);

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.authorLogin).toBe('alice');
    expect(row.prCount).toBe(1);
    expect(row.commitCount).toBe(0);
    expect(row.meanLinesPerCommit).toBeNull();
    expect(row.medianLinesPerCommit).toBeNull();
    expect(row.meanFilesPerCommit).toBeNull();
    expect(row.medianFilesPerCommit).toBeNull();
  });

  it('computes correct median for odd-length series — D-18', () => {
    // 5 commits with line totals [10, 20, 30, 40, 50] → median = 30
    insertAuthor(1, 'alice');

    // lines_added + lines_deleted = total; seed so per-commit totals are 10,20,30,40,50
    insertCommit(1, JAN_15_2025, 10, 0, 1);   // lines_total=10
    insertCommit(1, JAN_15_2025, 15, 5, 1);   // lines_total=20
    insertCommit(1, JAN_15_2025, 20, 10, 1);  // lines_total=30
    insertCommit(1, JAN_15_2025, 30, 10, 1);  // lines_total=40
    insertCommit(1, JAN_15_2025, 40, 10, 1);  // lines_total=50

    const result = getDeveloperMonthly([1], TEST_PERIODS);
    const row = result.find(r => r.authorLogin === 'alice' && r.month === '2025-01');

    expect(row).toBeDefined();
    expect(row!.medianLinesPerCommit).toBe(30);
  });

  it('computes correct median for even-length series — D-18', () => {
    // 4 commits with line totals [10, 20, 30, 40] → median = (20+30)/2 = 25
    insertAuthor(1, 'alice');

    insertCommit(1, JAN_15_2025, 10, 0, 1);   // lines_total=10
    insertCommit(1, JAN_15_2025, 15, 5, 1);   // lines_total=20
    insertCommit(1, JAN_15_2025, 20, 10, 1);  // lines_total=30
    insertCommit(1, JAN_15_2025, 30, 10, 1);  // lines_total=40

    const result = getDeveloperMonthly([1], TEST_PERIODS);
    const row = result.find(r => r.authorLogin === 'alice' && r.month === '2025-01');

    expect(row).toBeDefined();
    expect(row!.medianLinesPerCommit).toBe(25);
  });

  it('uses additions + deletions (total churn, not net) — D-18', () => {
    // 1 commit with lines_added=50, lines_deleted=20 → lines_total=70 (NOT 30 net)
    insertAuthor(1, 'alice');
    insertCommit(1, JAN_15_2025, 50, 20, 3);

    const result = getDeveloperMonthly([1], TEST_PERIODS);
    const row = result.find(r => r.authorLogin === 'alice' && r.month === '2025-01');

    expect(row).toBeDefined();
    expect(row!.meanLinesPerCommit).toBeCloseTo(70, 5);
    expect(row!.medianLinesPerCommit).toBe(70);
  });

  it('returns empty array when no complete repos — SEC-01', () => {
    // Remove collection_state so no repos are "complete"
    const raw = testDb.$client;
    raw.exec(`DELETE FROM collection_state`);

    insertAuthor(1, 'alice');
    insertCommit(1, JAN_15_2025);

    const result = getDeveloperMonthly([1], TEST_PERIODS);
    expect(result).toHaveLength(0);
  });

  it('sorts results by (authorLogin, month) ascending', () => {
    // Seed 3 (author, month) pairs in intentionally unsorted insertion order
    insertAuthor(1, 'charlie');
    insertAuthor(2, 'alice');
    insertAuthor(3, 'bob');

    insertCommit(1, MAR_15_2025);  // charlie:2025-03
    insertCommit(2, JAN_15_2025);  // alice:2025-01
    insertCommit(3, FEB_15_2025);  // bob:2025-02

    const result = getDeveloperMonthly([1], TEST_PERIODS);

    expect(result).toHaveLength(3);
    expect(result[0].authorLogin).toBe('alice');
    expect(result[0].month).toBe('2025-01');
    expect(result[1].authorLogin).toBe('bob');
    expect(result[1].month).toBe('2025-02');
    expect(result[2].authorLogin).toBe('charlie');
    expect(result[2].month).toBe('2025-03');
  });

});
