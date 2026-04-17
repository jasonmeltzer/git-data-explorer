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
const { computeHhi, computeGini, computeBusFactor, getConcentrationMonthly } =
  await import('../services/analytics-concentration.js');

// ── Test data helpers ──────────────────────────────────────────────────────────

/**
 * Epoch seconds for Jan 15, 2025 (within test month '2025-01')
 * and Feb 15, 2025 (within test month '2025-02').
 */
const JAN_2025 = Math.floor(Date.UTC(2025, 0, 15) / 1000); // Jan 15 2025
const FEB_2025 = Math.floor(Date.UTC(2025, 1, 15) / 1000); // Feb 15 2025

/**
 * Seed a minimal test scenario:
 * - 1 repo (id=1), marked complete for both commits and pull_requests
 * - 3 authors: alice (dominant), bob, carol
 * - Jan 2025: 5 commits (alice=3, bob=1, carol=1), 3 PRs (alice=2, bob=1)
 * - Feb 2025: 4 commits (alice=1, bob=2, carol=1), 0 PRs (zero-PR month)
 *
 * This covers:
 *   - top-N share computation (Jan commits: alice=60%, bob=20%, carol=20%)
 *   - zero-PR null guard (Feb has no PRs)
 *   - multi-basis (commits, prs, lines all computed)
 */
function seedTestData() {
  const raw = testDb.$client;

  // Clear in dependency order
  raw.exec(`DELETE FROM collection_state`);
  raw.exec(`DELETE FROM pull_requests`);
  raw.exec(`DELETE FROM commits`);
  raw.exec(`DELETE FROM authors`);
  raw.exec(`DELETE FROM repositories`);

  // Insert repo
  raw.prepare(`
    INSERT INTO repositories (id, github_id, full_name, owner_login, name, added_at)
    VALUES (1, 101, 'org/repo1', 'org', 'repo1', ${JAN_2025})
  `).run();

  // Mark repo as complete for both resource types (SEC-01: getCompleteRepoIds requires 2 complete entries)
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (1, 'commits', 'complete')`).run();
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (1, 'pull_requests', 'complete')`).run();

  // Insert authors (including a bot to verify bot exclusion)
  raw.prepare(`
    INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES
      (1, 'alice', 0, ${JAN_2025}),
      (2, 'bob',   0, ${JAN_2025}),
      (3, 'carol', 0, ${JAN_2025}),
      (4, 'bot1',  1, ${JAN_2025})
  `).run();

  // Jan 2025 commits: alice=3 (100 lines each), bob=1 (50 lines), carol=1 (20 lines)
  raw.prepare(`
    INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES
      ('sha01', 1, 1, 'c1', ${JAN_2025}, 100, 0),
      ('sha02', 1, 1, 'c2', ${JAN_2025}, 100, 0),
      ('sha03', 1, 1, 'c3', ${JAN_2025}, 100, 0),
      ('sha04', 1, 2, 'c4', ${JAN_2025}, 50, 0),
      ('sha05', 1, 3, 'c5', ${JAN_2025}, 20, 0)
  `).run();

  // Feb 2025 commits: alice=1, bob=2, carol=1
  raw.prepare(`
    INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES
      ('sha06', 1, 1, 'c6', ${FEB_2025}, 10, 0),
      ('sha07', 1, 2, 'c7', ${FEB_2025}, 30, 0),
      ('sha08', 1, 2, 'c8', ${FEB_2025}, 30, 0),
      ('sha09', 1, 3, 'c9', ${FEB_2025}, 10, 0)
  `).run();

  // Jan 2025 PRs: alice=2, bob=1 (3 total)
  raw.prepare(`
    INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at) VALUES
      (201, 1, 1, 1, 'pr1', 'merged', ${JAN_2025}, ${JAN_2025}),
      (202, 1, 1, 2, 'pr2', 'merged', ${JAN_2025}, ${JAN_2025}),
      (203, 1, 2, 3, 'pr3', 'merged', ${JAN_2025}, ${JAN_2025})
  `).run();

  // Feb 2025: zero PRs (intentional — tests null guard)
}

const TEST_PERIODS = [
  {
    startDate: '2025-01-01',
    endDate: '2025-02-28',
    label: 'All-time',
  },
];

// ── Pure-math helpers ──────────────────────────────────────────────────────────

describe('HHI computation', () => {
  /**
   * Hand-verified fixture (D-06):
   * Shares [0.5, 0.3, 0.2] → HHI = 0.5² + 0.3² + 0.2² = 0.25 + 0.09 + 0.04 = 0.38
   */
  test('shares [0.5, 0.3, 0.2] returns HHI = 0.38', () => {
    const result = computeHhi([0.5, 0.3, 0.2]);
    expect(result).toBeCloseTo(0.38, 5);
  });

  test('single contributor returns HHI = 1 (perfect concentration)', () => {
    const result = computeHhi([1.0]);
    expect(result).toBeCloseTo(1.0, 5);
  });

  test('two equal contributors returns HHI = 0.5', () => {
    const result = computeHhi([0.5, 0.5]);
    expect(result).toBeCloseTo(0.5, 5);
  });
});

describe('Gini computation', () => {
  /**
   * Hand-verified fixture (D-06):
   * Values [10, 20, 30, 40] — sorted ascending, equal intervals.
   * Gini = (2 * Σ(i * x_i) / (n * Σ(x_i))) - (n+1)/n
   * n=4, total=100
   * = (2*(1*10 + 2*20 + 3*30 + 4*40)) / (4*100) - 5/4
   * = (2*(10+40+90+160)) / 400 - 1.25
   * = (2*300)/400 - 1.25
   * = 600/400 - 1.25
   * = 1.5 - 1.25 = 0.25
   */
  test('values [10, 20, 30, 40] returns Gini = 0.25', () => {
    const result = computeGini([10, 20, 30, 40]);
    expect(result).toBeCloseTo(0.25, 5);
  });

  test('equal values return Gini = 0 (perfect equality)', () => {
    const result = computeGini([25, 25, 25, 25]);
    expect(result).toBeCloseTo(0, 5);
  });
});

describe('busFactor computation', () => {
  /**
   * Hand-verified fixture (D-04):
   * Shares [50, 20, 15, 10, 5] — top-1 alone is 50%, covers 50%.
   * busFactor = 1 (minimum devs to reach 50%)
   */
  test('shares [50, 20, 15, 10, 5] returns busFactor = 1', () => {
    const result = computeBusFactor([50, 20, 15, 10, 5]);
    expect(result).toBe(1);
  });

  test('shares [30, 25, 20, 15, 10] requires 2 devs to reach 50%', () => {
    const result = computeBusFactor([30, 25, 20, 15, 10]);
    expect(result).toBe(2);
  });
});

// ── DB-dependent tests ─────────────────────────────────────────────────────────

describe('top-N share computation', () => {
  beforeAll(() => { seedTestData(); });

  test('top-1 share returns the leading contributor percentage from known monthly distribution (D-01)', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    // Jan commits: alice=3/5=60%
    const janCommits = rows.find(r => r.month === '2025-01' && r.basis === 'commits');
    expect(janCommits).toBeDefined();
    expect(janCommits!.top1Share).toBeCloseTo(60, 1);
    expect(janCommits!.topContributor).toBe('alice');
  });

  test('top-3 share sums the 3 leading contributor percentages for the month (D-01)', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    // Jan commits: alice=60%, bob=20%, carol=20% → top-3 = 100%
    const janCommits = rows.find(r => r.month === '2025-01' && r.basis === 'commits');
    expect(janCommits!.top3Share).toBeCloseTo(100, 1);
  });

  test('top-5 share sums the 5 leading contributor percentages for the month (D-01)', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    // Only 3 contributors → top-5 = top-3 = 100%
    const janCommits = rows.find(r => r.month === '2025-01' && r.basis === 'commits');
    expect(janCommits!.top5Share).toBeCloseTo(100, 1);
  });

  test('multi-basis computation: prs, commits, and lines all computed in a single call (D-02)', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    const bases = new Set(rows.map(r => r.basis));
    expect(bases.has('commits')).toBe(true);
    expect(bases.has('prs')).toBe(true);
    expect(bases.has('lines')).toBe(true);
  });
});

describe('zero-PR month null guard', () => {
  beforeAll(() => { seedTestData(); });

  test('PR basis returns null for top1Share/top3Share/top5Share/hhi/gini/busFactor when month has zero PRs', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    // Feb 2025 has no PRs
    const febPrs = rows.find(r => r.month === '2025-02' && r.basis === 'prs');
    // Feb has no PR rows, so the PR basis won't appear (not synthesized for empty months)
    // The service only emits rows for months that appear in the SQL results.
    // This test verifies: if a null-guard row IS returned, all concentration fields are null.
    // If no row exists at all, that is also acceptable (zero PRs = no row).
    if (febPrs) {
      expect(febPrs.top1Share).toBeNull();
      expect(febPrs.top3Share).toBeNull();
      expect(febPrs.top5Share).toBeNull();
      expect(febPrs.hhi).toBeNull();
      expect(febPrs.gini).toBeNull();
      expect(febPrs.busFactor).toBeNull();
    }
    // Either null-guarded row OR no row for zero-PR month is correct behavior
    // The key invariant: no PR row with non-null concentration metrics for Feb
    const febPrsAll = rows.filter(r => r.month === '2025-02' && r.basis === 'prs');
    for (const row of febPrsAll) {
      expect(row.top1Share).toBeNull();
    }
  });

  test('commit basis remains populated when zero PRs but commits exist in the same month', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    // Feb 2025: 4 commits exist (alice=1, bob=2, carol=1) even though no PRs
    const febCommits = rows.find(r => r.month === '2025-02' && r.basis === 'commits');
    expect(febCommits).toBeDefined();
    expect(febCommits!.top1Share).not.toBeNull();
    expect(febCommits!.activeDevs).toBe(3);
    // bob has 2/4 = 50%
    expect(febCommits!.top1Share).toBeCloseTo(50, 1);
    expect(febCommits!.topContributor).toBe('bob');
  });

  test('zero-PR month produces no PR basis row (null guard via row absence)', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    // Feb 2025: commits exist for all 3 humans but zero PRs were created in Feb.
    // The null-guard strategy is row absence rather than explicit null fields:
    // the PR basis query only returns rows for months with PR activity. Commit
    // basis rows for Feb remain populated (verified in the previous test).
    const febPrs = rows.find(r => r.month === '2025-02' && r.basis === 'prs');
    expect(febPrs).toBeUndefined();
  });
});

describe('multi-basis computation', () => {
  beforeAll(() => { seedTestData(); });

  test('prs, commits, and lines are all computed for the same month range in a single service call (D-02)', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    const janRows = rows.filter(r => r.month === '2025-01');
    const bases = new Set(janRows.map(r => r.basis));
    // All 3 bases present for Jan (which has activity on all 3)
    expect(bases.has('commits')).toBe(true);
    expect(bases.has('prs')).toBe(true);
    expect(bases.has('lines')).toBe(true);
  });

  test('result contains rows for all 3 bases: prs, commits, lines', () => {
    const rows = getConcentrationMonthly([1], TEST_PERIODS);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const bases = new Set(rows.map(r => r.basis));
    expect(bases.size).toBe(3);
    expect(bases).toContain('commits');
    expect(bases).toContain('prs');
    expect(bases).toContain('lines');
  });
});
