import { describe, test, expect, vi, beforeEach } from 'vitest';
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

// ── Dynamic import AFTER mock ─────────────────────────────────────────────────
const { getPeriodMetrics } = await import('../services/analytics-period-metrics.js');

// ── Time constants (UTC epochs, seconds) ─────────────────────────────────────
const DEC_2024 = Math.floor(Date.UTC(2024, 11, 1) / 1000);
const JAN_2025 = Math.floor(Date.UTC(2025, 0, 15) / 1000);
const FEB_2025 = Math.floor(Date.UTC(2025, 1, 15) / 1000);
const APR_2025 = Math.floor(Date.UTC(2025, 3, 15) / 1000);
const JUN_2025 = Math.floor(Date.UTC(2025, 5, 15) / 1000);
const JUL_2025 = Math.floor(Date.UTC(2025, 6, 15) / 1000);
const SEP_2025 = Math.floor(Date.UTC(2025, 8, 15) / 1000);

const PRE_AI_PERIOD = {
  startDate: '2025-01-01',
  endDate: '2025-05-31',
  label: 'Pre-AI',
  markerDate: '2025-06-01',
};
const POST_AI_PERIOD = {
  startDate: '2025-06-01',
  endDate: '2025-09-30',
  label: 'Post-AI',
  markerDate: '2025-06-01',
};
const ALL_TIME_PERIOD = {
  startDate: '2025-01-01',
  endDate: '2025-09-30',
  label: 'All-time',
};

function resetDb() {
  const raw = testDb.$client;
  raw.exec(`DELETE FROM collection_state`);
  raw.exec(`DELETE FROM pull_requests`);
  raw.exec(`DELETE FROM commits`);
  raw.exec(`DELETE FROM authors`);
  raw.exec(`DELETE FROM repositories`);
}

function seedRepo(id: number) {
  const raw = testDb.$client;
  raw.prepare(`
    INSERT INTO repositories (id, github_id, full_name, owner_login, name, added_at)
    VALUES (?, ?, 'org/repo', 'org', 'repo', ?)
  `).run(id, 100 + id, JAN_2025);
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (?, 'commits', 'complete')`).run(id);
  raw.prepare(`INSERT INTO collection_state (repo_id, resource_type, status) VALUES (?, 'pull_requests', 'complete')`).run(id);
}

// ── getPeriodMetrics ──────────────────────────────────────────────────────────

describe('getPeriodMetrics', () => {
  beforeEach(() => {
    resetDb();
    seedRepo(1);
  });

  test('returns PeriodMetric[] with correct period labels when called with 2-period array (Pre-AI, Post-AI)', () => {
    const raw = testDb.$client;
    // Seed a minimal Pre-AI commit so the service does not crash on empty data
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JAN_2025);
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 10, 5)`).run(JAN_2025);

    const rows = getPeriodMetrics([1], [PRE_AI_PERIOD, POST_AI_PERIOD]);
    expect(rows).toHaveLength(2);
    expect(rows[0].period.label).toBe('Pre-AI');
    expect(rows[1].period.label).toBe('Post-AI');
    // Period fields preserved verbatim
    expect(rows[0].period.startDate).toBe('2025-01-01');
    expect(rows[0].period.endDate).toBe('2025-05-31');
    expect(rows[0].period.markerDate).toBe('2025-06-01');
  });

  test('computes avgCommitSize, prFrequency, rampUpSpeed, activeContributors per period', () => {
    const raw = testDb.$client;
    // 3 humans. anchor exists in Dec 2024 to establish the collection floor at DEC_2024;
    // dataFloor (earliest + 4 weeks) lands in Dec 2024, so alice (first commit Jan 15) and
    // bob (first commit Apr 15) are both past the floor and eligible for ramp-up.
    raw.prepare(`
      INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES
        (1, 'alice',  0, ?),
        (2, 'bob',    0, ?),
        (3, 'anchor', 0, ?)
    `).run(JAN_2025, APR_2025, DEC_2024);

    // Anchor commit 6 weeks before the period so dataFloor is still earlier than alice/bob
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES
        ('a0', 1, 3, 'anchor', ?, 5, 0)
    `).run(DEC_2024);

    // 4 commits in Pre-AI (lines_added+deleted: 30, 30, 40, 20 → avg 30)
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES
        ('c1', 1, 1, 'a1', ?, 20, 10),
        ('c2', 1, 1, 'a2', ?, 15, 15),
        ('c3', 1, 2, 'b1', ?, 25, 15),
        ('c4', 1, 2, 'b2', ?, 15, 5)
    `).run(JAN_2025, JAN_2025, APR_2025, APR_2025);

    // PRs in Pre-AI: alice has a large-PR 10 weeks after first commit → qualifies for rampUp
    raw.prepare(`
      INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at, lines_added) VALUES
        (1, 1, 1, 1, 'alice PR large', 'merged', ?, ?, 100),
        (2, 1, 2, 2, 'bob PR small',   'merged', ?, ?, 10)
    `).run(APR_2025, APR_2025, APR_2025, APR_2025);

    const rows = getPeriodMetrics([1], [PRE_AI_PERIOD]);
    expect(rows).toHaveLength(1);
    const m = rows[0].metrics;
    // avg only counts commits inside the period window (anchor's Dec 2024 commit
    // is outside). 4 alice/bob commits at 30/30/40/20 → avg = 30.
    expect(m.avgCommitSize).toBeCloseTo(30, 1);
    // anchor's only commit is outside [startEpoch, endEpoch] so they're not counted
    // in activeContributors.
    expect(m.activeContributors).toBe(2);
    expect(m.prFrequency).toBeGreaterThanOrEqual(0);
    // rampUpSpeed: alice first_commit Jan 15, first large PR Apr 15 ≈ 13 weeks
    expect(m.rampUpSpeed).not.toBeNull();
    expect(m.rampUpSpeed as number).toBeGreaterThan(10);
    expect(m.rampUpSpeed as number).toBeLessThan(16);
  });

  test('rampUpSpeed excludes data-sparsity-clamped authors (ported guard from analytics-before-after.ts)', () => {
    const raw = testDb.$client;
    // Only commits are Jan 15 2025. Earliest = Jan 15. dataFloor = Jan 15 + 28 days ≈ Feb 12.
    // alice's first_commit_at = JAN_2025 is BEFORE dataFloor → she must be filtered
    // out of ramp-up because her first_commit_at is likely clamped by the collection
    // window (true first work may have been before data collection).
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JAN_2025);
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 20, 10)`).run(JAN_2025);
    raw.prepare(`
      INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at, lines_added) VALUES
        (1, 1, 1, 1, 'alice PR large', 'merged', ?, ?, 100)
    `).run(APR_2025, APR_2025);

    const rows = getPeriodMetrics([1], [PRE_AI_PERIOD]);
    // alice is filtered by the data-sparsity floor → no ramp-up data → null
    expect(rows[0].metrics.rampUpSpeed).toBeNull();
  });

  test('returns empty array when no complete repos exist', () => {
    resetDb(); // wipe everything including the collection_state markers
    const raw = testDb.$client;
    raw.prepare(`INSERT INTO repositories (id, github_id, full_name, owner_login, name, added_at) VALUES (1, 101, 'org/repo', 'org', 'repo', ?)`).run(JAN_2025);
    // No collection_state rows → getCompleteRepoIds returns []
    const rows = getPeriodMetrics(undefined, [ALL_TIME_PERIOD]);
    expect(rows).toEqual([]);
  });

  test('single period (no marker) returns length-1 PeriodMetric[] with label All-time', () => {
    const raw = testDb.$client;
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JAN_2025);
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 10, 5)`).run(JUN_2025);

    const rows = getPeriodMetrics([1], [ALL_TIME_PERIOD]);
    expect(rows).toHaveLength(1);
    expect(rows[0].period.label).toBe('All-time');
    // ALL_TIME_PERIOD has no markerDate — should remain undefined on the returned period
    expect(rows[0].period.markerDate).toBeUndefined();
  });

  test('PeriodMetric.period carries the same startDate/endDate/label as the input Period', () => {
    const raw = testDb.$client;
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JAN_2025);
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 10, 5)`).run(JUL_2025);

    const input = [PRE_AI_PERIOD, POST_AI_PERIOD];
    const rows = getPeriodMetrics([1], input);
    for (let i = 0; i < input.length; i++) {
      expect(rows[i].period.startDate).toBe(input[i].startDate);
      expect(rows[i].period.endDate).toBe(input[i].endDate);
      expect(rows[i].period.label).toBe(input[i].label);
    }
  });

  test('metrics values are numbers or null (rampUpSpeed is null when no qualifying devs)', () => {
    const raw = testDb.$client;
    // One dev with a commit in Post-AI but NO PRs ≥50 lines in period → no rampUp data
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JUN_2025);
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 10, 5)`).run(JUL_2025);
    raw.prepare(`
      INSERT INTO pull_requests (github_id, repo_id, author_id, number, title, state, created_at, updated_at, lines_added) VALUES
        (1, 1, 1, 1, 'tiny PR', 'merged', ?, ?, 5)
    `).run(JUL_2025, JUL_2025);

    const rows = getPeriodMetrics([1], [POST_AI_PERIOD]);
    expect(rows).toHaveLength(1);
    const m = rows[0].metrics;
    expect(typeof m.avgCommitSize).toBe('number');
    expect(typeof m.prFrequency).toBe('number');
    expect(typeof m.activeContributors).toBe('number');
    expect(m.rampUpSpeed).toBeNull();
  });

  test('bots are excluded from active contributors count', () => {
    const raw = testDb.$client;
    raw.prepare(`
      INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES
        (1, 'alice', 0, ?),
        (2, 'bot1',  1, ?)
    `).run(JAN_2025, JAN_2025);
    raw.prepare(`
      INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES
        ('c1', 1, 1, 'human', ?, 10, 5),
        ('c2', 1, 2, 'bot',   ?, 100, 50)
    `).run(JAN_2025, JAN_2025);

    const rows = getPeriodMetrics([1], [PRE_AI_PERIOD]);
    expect(rows[0].metrics.activeContributors).toBe(1);
  });

  test('empty periods[] returns empty array', () => {
    const rows = getPeriodMetrics([1], []);
    expect(rows).toEqual([]);
  });
});

// ── Period assignment sanity ──────────────────────────────────────────────────

describe('period boundary handling', () => {
  beforeEach(() => {
    resetDb();
    seedRepo(1);
  });

  test('commits at period boundary (endDate) are included', () => {
    const raw = testDb.$client;
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JAN_2025);
    // Commit at 2025-05-31 00:00:00 UTC — within Pre-AI endDate
    const boundaryEpoch = Math.floor(Date.UTC(2025, 4, 31, 0, 0, 0) / 1000);
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 20, 10)`).run(boundaryEpoch);

    const rows = getPeriodMetrics([1], [PRE_AI_PERIOD]);
    expect(rows[0].metrics.activeContributors).toBe(1);
    expect(rows[0].metrics.avgCommitSize).toBeCloseTo(30, 1);
  });

  test('commits outside period are not counted', () => {
    const raw = testDb.$client;
    raw.prepare(`INSERT INTO authors (id, github_login, is_bot, first_commit_at) VALUES (1, 'alice', 0, ?)`).run(JAN_2025);
    // Commit in Post-AI window, query asks about Pre-AI
    raw.prepare(`INSERT INTO commits (sha, repo_id, author_id, message, committed_at, lines_added, lines_deleted) VALUES ('c1', 1, 1, 'msg', ?, 20, 10)`).run(SEP_2025);

    const rows = getPeriodMetrics([1], [PRE_AI_PERIOD]);
    expect(rows[0].metrics.activeContributors).toBe(0);
  });
});
