import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// ── In-memory test database (must be created before module mock) ──────────────
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
      first_commit_at INTEGER,
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
const { getPrTurnaroundTrend } = await import('../services/analytics-pr-turnaround.js');
const { setCycleTimeMaxDays } = await import('../services/analytics-config.js');

// ── Time constants (UTC epochs, seconds) ──────────────────────────────────────
const JAN_15_2025 = Math.floor(Date.UTC(2025, 0, 15) / 1000);  // 2025-01-15
const JAN_20_2025 = Math.floor(Date.UTC(2025, 0, 20) / 1000);  // 2025-01-20
const FEB_10_2025 = Math.floor(Date.UTC(2025, 1, 10) / 1000);  // 2025-02-10

// ── Test data helpers ──────────────────────────────────────────────────────────

const ALL_2025_PERIOD = {
  startDate: '2025-01-01',
  endDate: '2025-12-31',
  label: 'All 2025',
};

let _prCounter = 0;

function resetDb(): void {
  const raw = testDb.$client;
  raw.exec(`DELETE FROM collection_state`);
  raw.exec(`DELETE FROM pull_requests`);
  raw.exec(`DELETE FROM commits`);
  raw.exec(`DELETE FROM authors`);
  raw.exec(`DELETE FROM repositories`);
  raw.exec(`DELETE FROM app_config`);
  _prCounter = 0;
}

/** Seed a repo (id=1) and mark it complete for both commits + pull_requests. */
function seedCompleteRepo(): void {
  const raw = testDb.$client;
  raw.prepare(`
    INSERT INTO repositories (id, github_id, full_name, owner_login, name, added_at)
    VALUES (1, 101, 'org/repo1', 'org', 'repo1', ?)
  `).run(JAN_15_2025);
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

/**
 * Insert a PR with explicit createdAt / mergedAt / firstCommitAt epochs.
 * Pass null for firstCommitAt to exercise the D-05 IS NOT NULL filter.
 */
function insertPr(
  authorId: number,
  createdAtEpoch: number,
  mergedAtEpoch: number | null,
  firstCommitAtEpoch: number | null,
  state = 'merged',
): void {
  _prCounter++;
  const raw = testDb.$client;
  raw.prepare(`
    INSERT INTO pull_requests (
      github_id, repo_id, author_id, number, title, state,
      created_at, merged_at, first_commit_at, updated_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    _prCounter * 1000,
    authorId,
    _prCounter,
    `PR ${_prCounter}`,
    state,
    createdAtEpoch,
    mergedAtEpoch,
    firstCommitAtEpoch,
    createdAtEpoch,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('getPrTurnaroundTrend', () => {

  beforeEach(() => {
    resetDb();
    seedCompleteRepo();
    insertAuthor(10, 'alice', 0);    // human author
    insertAuthor(11, 'depbot[bot]', 1);  // bot author
  });

  // ── Test 1: empty periods array ─────────────────────────────────────────────
  it('returns [] when periods array is empty', () => {
    const result = getPrTurnaroundTrend([1], []);
    expect(result).toEqual([]);
  });

  // ── Test 2: no complete repos ───────────────────────────────────────────────
  it('returns [] when no repos have complete coverage (SEC-01)', () => {
    // Wipe collection_state so no repos are "complete"
    const raw = testDb.$client;
    raw.exec(`DELETE FROM collection_state`);

    // PR exists but the SEC-01 gate filters out the repo
    insertPr(10, JAN_15_2025, JAN_20_2025, JAN_15_2025 - 3600);

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toEqual([]);
  });

  // ── Test 3: D-05 — first_commit_at IS NULL excluded from medians but counted in totalPrCount ─
  it('excludes PRs with first_commit_at = NULL from medians but counts them in totalPrCount (D-05/D-06)', () => {
    // 2 PRs in Jan: one with firstCommitAt set (cycle 5h), one with firstCommitAt NULL
    insertPr(10, JAN_15_2025,         JAN_15_2025 + 5 * 3600, JAN_15_2025);            // covered, 5h
    insertPr(10, JAN_15_2025 + 100,   JAN_15_2025 + 8 * 3600, null);                    // NOT covered (NULL)

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.periodMonth).toBe('2025-01');
    expect(row.prCount).toBe(1);          // only the covered PR feeds medians
    expect(row.totalPrCount).toBe(2);     // coverage caveat counts both
    expect(row.medianHoursToMerge).toBeCloseTo(5, 5);
  });

  // ── Test 4: D-10 sanity guard — merged_at <= first_commit_at excluded ─────────
  it('excludes PRs where merged_at <= first_commit_at (D-10 sanity guard)', () => {
    // Pathological PR: merged_at == first_commit_at → negative-or-zero cycle time → excluded
    insertPr(10, JAN_15_2025, JAN_15_2025 + 3600, JAN_15_2025 + 3600);  // mergedAt == firstCommitAt
    // Good PR for contrast
    insertPr(10, JAN_15_2025 + 100, JAN_15_2025 + 4 * 3600, JAN_15_2025);  // cycle 4h

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.prCount).toBe(1);            // only the good PR feeds medians
    expect(row.medianHoursToMerge).toBeCloseTo(4, 5);
    // totalPrCount counts the bad PR too (it's in created_at month, not bot)
    expect(row.totalPrCount).toBe(2);
  });

  // ── Test 5: D-08 cycle_time_max_days cap excludes outliers from medians ──────
  it('excludes PRs exceeding cycle_time_max_days cap from medians but counts them in totalPrCount (D-08)', () => {
    // Set cap to 7 days
    setCycleTimeMaxDays(7);

    // Within-cap PR: cycle 24h (well under 7 days)
    insertPr(10, JAN_15_2025, JAN_15_2025 + 24 * 3600, JAN_15_2025);
    // Over-cap PR: cycle 240h = 10 days (>7-day cap)
    insertPr(10, JAN_15_2025 + 100, JAN_15_2025 + 240 * 3600, JAN_15_2025);

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.prCount).toBe(1);           // only the within-cap PR
    expect(row.totalPrCount).toBe(2);      // coverage shows both
    expect(row.medianHoursToMerge).toBeCloseTo(24, 5);
  });

  // ── Test 6: Phase 9.4 D-23 — bot PRs excluded from both medians and totalPrCount ──
  it('excludes bot-authored PRs from BOTH medians and totalPrCount (Phase 9.4 D-23, is_bot = 0)', () => {
    // Human PR included
    insertPr(10, JAN_15_2025,       JAN_15_2025 + 10 * 3600, JAN_15_2025);
    // Bot PR — must be excluded from numerator AND denominator
    insertPr(11, JAN_15_2025 + 100, JAN_15_2025 + 5 * 3600,  JAN_15_2025);

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.prCount).toBe(1);           // only the human PR feeds medians
    expect(row.totalPrCount).toBe(1);      // bot is excluded from coverage too (consistent denominator)
    expect(row.medianHoursToMerge).toBeCloseTo(10, 5);
  });

  // ── Test 7: D-07 — median uses lower-midpoint for even N (NOT averaging) ─────
  it('computes median via lower-midpoint for even-N series (D-07)', () => {
    // 4 PRs with cycle hours [2, 4, 6, 8] → median = 4 (lower midpoint), NOT 5 (avg)
    insertPr(10, JAN_15_2025,         JAN_15_2025 + 2 * 3600, JAN_15_2025);   // 2h
    insertPr(10, JAN_15_2025 + 100,   JAN_15_2025 + 4 * 3600, JAN_15_2025);   // 4h
    insertPr(10, JAN_15_2025 + 200,   JAN_15_2025 + 6 * 3600, JAN_15_2025);   // 6h
    insertPr(10, JAN_15_2025 + 300,   JAN_15_2025 + 8 * 3600, JAN_15_2025);   // 8h

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.prCount).toBe(4);
    // D-07: lower midpoint for even N — result must be 4, NOT 5 (the average of midpoints)
    expect(row.medianHoursToMerge).toBe(4);
  });

  // ── Test 8: Median for odd N (middle element) ────────────────────────────────
  it('computes median as the middle element for odd-N series', () => {
    // 3 PRs with cycle hours [1, 5, 9] → median = 5
    insertPr(10, JAN_15_2025,         JAN_15_2025 + 1 * 3600, JAN_15_2025);   // 1h
    insertPr(10, JAN_15_2025 + 100,   JAN_15_2025 + 5 * 3600, JAN_15_2025);   // 5h
    insertPr(10, JAN_15_2025 + 200,   JAN_15_2025 + 9 * 3600, JAN_15_2025);   // 9h

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    expect(result[0].medianHoursToMerge).toBe(5);
  });

  // ── Test 9: avgHoursToMerge is the real mean of the covered+capped set ──────
  it('returns avgHoursToMerge as the real mean of the covered+capped set', () => {
    // Same fixture as Test 7: hours [2, 4, 6, 8] → mean = 5
    insertPr(10, JAN_15_2025,         JAN_15_2025 + 2 * 3600, JAN_15_2025);
    insertPr(10, JAN_15_2025 + 100,   JAN_15_2025 + 4 * 3600, JAN_15_2025);
    insertPr(10, JAN_15_2025 + 200,   JAN_15_2025 + 6 * 3600, JAN_15_2025);
    insertPr(10, JAN_15_2025 + 300,   JAN_15_2025 + 8 * 3600, JAN_15_2025);

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);
    expect(result).toHaveLength(1);
    expect(result[0].avgHoursToMerge).toBeCloseTo(5, 5);
  });

  // ── Test 10: CR-02 regression — month-straddling PR, prCount ≤ totalPrCount ──
  //
  // A PR whose first_commit_at is in Jan but created_at is in Feb would — before the
  // CR-02 fix — be bucketed into Jan by Query B (first_commit_at month) but into Feb
  // by Query A (created_at month).  In the Jan row, prCount would come from Query B
  // (1) while totalPrCount would be 0 (no Jan entry in Query A), causing prCount >
  // totalPrCount.  After the CR-02 fix both queries bucket by created_at, so the
  // straddling PR lands in Feb for both numerator and denominator, and the invariant
  // prCount ≤ totalPrCount holds for every row.
  it('guarantees prCount ≤ totalPrCount for every row (CR-02 coverage invariant, month-straddling PR)', () => {
    // Straddling PR: work started Jan (first_commit_at = JAN_15_2025), PR opened Feb
    // (created_at = FEB_10_2025), merged Feb a few hours later.  Positive cycle time.
    insertPr(
      10,
      FEB_10_2025,                   // created_at — Feb (denominator month)
      FEB_10_2025 + 6 * 3600,        // merged_at  — +6h (valid positive cycle)
      JAN_15_2025,                   // first_commit_at — Jan (work started before PR opened)
    );

    // Normal Feb PR: everything in Feb, short cycle time.
    insertPr(
      10,
      FEB_10_2025 + 100,             // created_at — Feb
      FEB_10_2025 + 100 + 5 * 3600, // merged_at  — +5h
      FEB_10_2025 - 3600,            // first_commit_at — 1h before opening (same Feb month)
    );

    // Jan anchor PR (keeps Jan in both Query A and Query B so totals are consistent).
    insertPr(
      10,
      JAN_15_2025,                   // created_at — Jan
      JAN_15_2025 + 4 * 3600,        // merged_at  — +4h
      JAN_15_2025 - 3600,            // first_commit_at — 1h before opening
    );

    const result = getPrTurnaroundTrend([1], [ALL_2025_PERIOD]);

    // Every returned row must satisfy the coverage invariant.
    for (const row of result) {
      expect(row.prCount).toBeLessThanOrEqual(row.totalPrCount);
    }
  });
});
