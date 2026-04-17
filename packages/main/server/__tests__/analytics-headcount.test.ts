import { describe, test, expect, vi, beforeAll } from 'vitest';
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
const { getHeadcountMonthly } = await import('../services/analytics-headcount.js');

// ── Time constants ─────────────────────────────────────────────────────────────
// Jan 15, 2025 (within '2025-01')
const JAN_2025 = Math.floor(Date.UTC(2025, 0, 15) / 1000);
// Feb 15, 2025 (within '2025-02')
const FEB_2025 = Math.floor(Date.UTC(2025, 1, 15) / 1000);
// Jan 20, 2025 (still '2025-01' for merged_at — PR created Jan 20, merged Feb)
const JAN_20_2025 = Math.floor(Date.UTC(2025, 0, 20) / 1000);

// ── Test data helpers ──────────────────────────────────────────────────────────

const TEST_PERIODS = [
  {
    startDate: '2025-01-01',
    endDate: '2025-02-28',
    label: 'All-time',
  },
];

/**
 * Base seed: 1 repo (id=1), 4 authors (alice, bob, carol, bot1), no data.
 * Actual data is seeded per-describe as needed.
 */
function clearAndSeedBase() {
  const raw = testDb.$client;
  raw.exec(`DELETE FROM collection_state`);
  raw.exec(`DELETE FROM pull_requests`);
  raw.exec(`DELETE FROM commits`);
  raw.exec(`DELETE FROM authors`);
  raw.exec(`DELETE FROM repositories`);

  // repo
  raw.prepare(`
    INSERT INTO repositories (id, github_id, full_name, owner_login, name, added_at)
    VALUES (1, 101, 'org/repo1', 'org', 'repo1', ${JAN_2025})
  `).run();

  // Mark repo complete for both resource types (required by getCompleteRepoIds)
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (1, 'commits', 'complete')`).run();
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (1, 'pull_requests', 'complete')`).run();

  // authors: alice, bob, carol (humans), bot1 (bot)
  raw.prepare(`
    INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES
      (1, 'alice', 0, ${JAN_2025}),
      (2, 'bob',   0, ${JAN_2025}),
      (3, 'carol', 0, ${JAN_2025}),
      (4, 'bot1',  1, ${JAN_2025})
  `).run();
}

// ── active dev count ──────────────────────────────────────────────────────────

describe('active dev count', () => {
  /**
   * D-09: Active = commit-OR-PR author in the month, bots excluded (is_bot = 0).
   * An author who only commits (no PRs) still counts.
   * An author who only has PRs created/merged (no commits) still counts.
   */
  beforeAll(() => {
    clearAndSeedBase();
    const raw = testDb.$client;

    // Jan: alice has 2 commits, bob has 1 PR created, carol has both commit+PR, bot1 has 1 commit
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added) VALUES
        ('sha01', 1, 1, 'alice commit', ${JAN_2025}, 10),
        ('sha02', 1, 1, 'alice commit2', ${JAN_2025}, 5),
        ('sha03', 1, 3, 'carol commit', ${JAN_2025}, 8),
        ('sha04', 1, 4, 'bot commit', ${JAN_2025}, 2)
    `).run();

    // bob: PR created in Jan (no commits)
    // carol: also has PR
    raw.prepare(`
      INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at) VALUES
        (201, 1, 2, 1, 'bob PR', 'merged', ${JAN_2025}, ${JAN_2025}),
        (202, 1, 3, 2, 'carol PR', 'merged', ${JAN_2025}, ${JAN_2025})
    `).run();
  });

  test('commit-OR-PR authors are counted as active devs in a month (D-09)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    expect(jan).toBeDefined();
    // alice (commit only), bob (PR only), carol (both) = 3 unique humans
    expect(jan!.activeDevs).toBe(3);
  });

  test('bots (is_bot=1) are excluded from active dev count (D-11)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    // bot1 has a commit but is_bot=1 — must NOT appear in activeDevs
    expect(jan!.activeDevs).toBe(3); // alice, bob, carol only
  });

  test('PR-only author (no commits that month) is counted as active (D-09)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    // bob has no commits but 1 PR created — must be in activeDevs
    expect(jan!.activeDevs).toBeGreaterThanOrEqual(1);
    // Specifically we already know it's 3 total including bob
    expect(jan!.activeDevs).toBe(3);
  });

  test('commit-only author (no PRs that month) is counted as active (D-09)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    // alice has commits but no PRs — must still be in activeDevs
    expect(jan!.activeDevs).toBe(3);
  });

  test('same author with both commits and PRs is counted only once (D-09)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    // carol has both a commit and a PR created — still counts as 1 active dev
    expect(jan!.activeDevs).toBe(3);
  });
});

// ── normalized output ─────────────────────────────────────────────────────────

describe('normalized output', () => {
  /**
   * D-12: prsPerDev = totalPrs / activeDevs (integer denominator, no day normalization).
   * commitsPerDev = totalCommits / activeDevs.
   */
  beforeAll(() => {
    clearAndSeedBase();
    const raw = testDb.$client;

    // Jan: alice=2 commits, bob=1 commit, carol=1 commit (4 total commits)
    //      alice=2 PRs, bob=1 PR (3 total PRs, by created_at Jan)
    //      activeDevs = 3 (alice, bob, carol)
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added) VALUES
        ('sha01', 1, 1, 'alice c1', ${JAN_2025}, 10),
        ('sha02', 1, 1, 'alice c2', ${JAN_2025}, 5),
        ('sha03', 1, 2, 'bob c1', ${JAN_2025}, 8),
        ('sha04', 1, 3, 'carol c1', ${JAN_2025}, 7)
    `).run();

    raw.prepare(`
      INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at) VALUES
        (201, 1, 1, 1, 'alice pr1', 'merged', ${JAN_2025}, ${JAN_2025}),
        (202, 1, 1, 2, 'alice pr2', 'merged', ${JAN_2025}, ${JAN_2025}),
        (203, 1, 2, 3, 'bob pr1', 'merged', ${JAN_2025}, ${JAN_2025})
    `).run();
  });

  test('prsPerDev = totalPrs / activeDevs with integer month denominator (D-12)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    expect(jan).toBeDefined();
    // 3 PRs / 3 activeDevs = 1.0
    expect(jan!.prsPerDev).toBeCloseTo(1.0, 5);
  });

  test('commitsPerDev = totalCommits / activeDevs with integer month denominator (D-12)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    // 4 commits / 3 activeDevs ≈ 1.333
    expect(jan!.commitsPerDev).toBeCloseTo(4 / 3, 5);
  });

  test('result row contains month, activeDevs, totalPrs, totalCommits, prsPerDev, commitsPerDev fields', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    expect(jan).toBeDefined();
    expect(jan).toHaveProperty('month');
    expect(jan).toHaveProperty('activeDevs');
    expect(jan).toHaveProperty('totalPrs');
    expect(jan).toHaveProperty('totalCommits');
    expect(jan).toHaveProperty('prsPerDev');
    expect(jan).toHaveProperty('commitsPerDev');
  });
});

// ── bot-only month produces no row (null guard via absence) ──────────────────

describe('bot-only month guard', () => {
  /**
   * The service's SQL filters `is_bot = 0` inline, so a month with only bot
   * activity produces no rows in any of the three underlying queries (commit
   * authors, PR-created authors, PR-merged authors). The monthMap never gets
   * an entry for that month, and no HeadcountMonthlyRow is emitted — this is
   * the null-guard strategy: row absence rather than explicit null fields.
   *
   * The `activeDevs > 0 ? ... : null` ternary in analytics-headcount.ts is
   * defensive: unreachable through real data but kept in case the SQL guards
   * are ever loosened. The previous version of this test paired a bot-only
   * fixture with `if (jan) { ... }` guards that never fired, producing a
   * vacuously-passing test. This version directly asserts the correct
   * behavior: a bot-only month emits no row.
   */
  beforeAll(() => {
    clearAndSeedBase();
    const raw = testDb.$client;

    // Only bot activity in Jan — no human commits or PRs
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added) VALUES
        ('sha01', 1, 4, 'bot commit', ${JAN_2025}, 5)
    `).run();
  });

  test('bot-only month emits no HeadcountMonthlyRow (no NaN, no Infinity)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    expect(jan).toBeUndefined();
  });
});

// ── PR created-Jan merged-Feb semantics ──────────────────────────────────────

describe('PR created-month vs merged-month semantics', () => {
  /**
   * D-10: totalPrs is credited to created_at month ONLY.
   * A PR created Jan, merged Feb → totalPrs[Jan]++, totalPrs[Feb] stays 0 for this PR.
   * But the author is ACTIVE in BOTH Jan (via created) AND Feb (via merged).
   */
  beforeAll(() => {
    clearAndSeedBase();
    const raw = testDb.$client;

    // alice: creates a PR on Jan 20, merges it on Feb 15
    // dave: commits only in Feb (no PRs) — so Feb has 1 active dev from commits + alice from merged PR
    raw.prepare(`
      INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES
        (5, 'dave', 0, ${JAN_2025})
      ON CONFLICT(github_login) DO NOTHING
    `).run();

    // No commits in Jan for alice — PR only
    // dave commits in Feb only
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added) VALUES
        ('sha01', 1, 5, 'dave feb commit', ${FEB_2025}, 10)
    `).run();

    // alice's PR: created Jan, merged Feb
    raw.prepare(`
      INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, merged_at, updated_at) VALUES
        (301, 1, 1, 1, 'alice cross-month PR', 'merged', ${JAN_20_2025}, ${FEB_2025}, ${FEB_2025})
    `).run();
  });

  test('PR created Jan, merged Feb → totalPrs[Jan]=1, totalPrs[Feb]=0 for that PR (created_at month only)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    const feb = rows.find(r => r.month === '2025-02');

    // Jan: alice PR created → totalPrs=1
    expect(jan).toBeDefined();
    expect(jan!.totalPrs).toBe(1);

    // Feb: no PRs created in Feb → totalPrs=0
    // (alice's PR was created in Jan, not Feb)
    if (feb) {
      expect(feb.totalPrs).toBe(0);
    }
  });

  test('author of PR created-Jan is active in Jan via created (D-10)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const jan = rows.find(r => r.month === '2025-01');
    expect(jan).toBeDefined();
    // alice created a PR in Jan → she is active in Jan
    expect(jan!.activeDevs).toBeGreaterThanOrEqual(1);
  });

  test('author of PR merged-Feb is active in Feb via merged (D-10)', () => {
    const rows = getHeadcountMonthly([1], TEST_PERIODS);
    const feb = rows.find(r => r.month === '2025-02');
    expect(feb).toBeDefined();
    // dave commits in Feb (1 active dev), alice merges in Feb (1 active dev) → 2 total
    expect(feb!.activeDevs).toBe(2);
  });
});
