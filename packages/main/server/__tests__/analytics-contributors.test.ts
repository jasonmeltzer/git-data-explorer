import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
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
const { getContributorStats, getContributorBeforeAfterStats } = await import('../services/analytics-contributors.js');
const { getCohortCommitMetrics } = await import('../services/analytics-cohorts.js');

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

// ---- Per-repo mode tests (Task 1 TDD) ----

describe('getContributorStats - per-repo mode', () => {
  // Separate in-memory DB for per-repo tests to avoid conflicts
  function createPerRepoTestDb() {
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
      CREATE UNIQUE INDEX idx_coll_repo_type ON collection_state (repo_id, resource_type);
      CREATE INDEX idx_cmts_repo_date ON commits (repo_id, committed_at);
      CREATE INDEX idx_cmts_author ON commits (author_id);
      CREATE UNIQUE INDEX idx_cmts_sha_repo ON commits (sha, repo_id);
      CREATE INDEX idx_cmts_author_repo ON commits (author_id, repo_id);
      CREATE INDEX idx_prs_r_date ON pull_requests (repo_id, created_at);
      CREATE INDEX idx_prs_a ON pull_requests (author_id);
      CREATE UNIQUE INDEX idx_prs_github_repo ON pull_requests (github_id, repo_id);
    `);
    return drizzle(sqlite, { schema });
  }

  // Timestamps relative to NOW
  // Analysis window: last 3 months (startDate = 3mo ago)
  // alice has:
  //   repo-A: first commit 2yr ago (old), ALSO a recent commit 1mo ago (in analysis window)
  //   repo-B: first commit 1wk ago (new), a commit 1wk ago (in analysis window)
  // This means alice appears in analysis window for both repos, but with different per-repo tenures.
  const NOW_EPOCH = Math.floor(Date.now() / 1000);
  const THREE_MONTHS_AGO = NOW_EPOCH - 3 * 30 * 24 * 3600;
  const TWO_YEARS_AGO = NOW_EPOCH - 2 * 365 * 24 * 3600;
  const ONE_MONTH_AGO = NOW_EPOCH - 30 * 24 * 3600;
  const ONE_WEEK_AGO = NOW_EPOCH - 7 * 24 * 3600;
  const SIX_MONTHS_AGO = NOW_EPOCH - 6 * 30 * 24 * 3600;

  // Use repo IDs 20+21 to avoid conflicts with the main describe block (which uses 10)
  const REPO_A_ID = 20;
  const REPO_B_ID = 21;
  const ALICE_ID = 20;
  const BOB_ID = 21;

  let _perRepoShaCounter = 500;

  function insertPerRepoRepo(repoId: number, fullName: string): void {
    testDb.insert(schema.repositories).values({
      id: repoId,
      githubId: repoId * 777,
      fullName,
      ownerLogin: fullName.split('/')[0],
      name: fullName.split('/')[1],
      isPrivate: false,
      defaultBranch: 'main',
      addedAt: new Date(),
    }).run();
    testDb.insert(schema.collectionState).values([
      { repoId, resourceType: 'commits', status: 'complete', lastRunAt: new Date() },
      { repoId, resourceType: 'pull_requests', status: 'complete', lastRunAt: new Date() },
    ]).run();
  }

  function insertPerRepoAuthor(id: number, login: string, firstCommitAtEpoch: number): void {
    testDb.insert(schema.authors).values({
      id,
      githubLogin: login,
      isBot: false,
      firstCommitAt: new Date(firstCommitAtEpoch * 1000),
    }).run();
  }

  function insertPerRepoCommit(repoId: number, authorId: number, committedAtEpoch: number): void {
    _perRepoShaCounter++;
    testDb.insert(schema.commits).values({
      sha: `sha-perrepo-${_perRepoShaCounter}`,
      repoId,
      authorId,
      message: `commit ${_perRepoShaCounter}`,
      committedAt: new Date(committedAtEpoch * 1000),
      linesAdded: 10,
      linesDeleted: 5,
      filesChanged: 2,
    }).run();
  }

  beforeAll(() => {
    // Insert repo-A and repo-B
    insertPerRepoRepo(REPO_A_ID, 'test-org/repo-a');
    insertPerRepoRepo(REPO_B_ID, 'test-org/repo-b');

    // Alice: first_commit_at = 3 years ago (global)
    // repo-A: first commit 2yr ago (old), recent commit 1mo ago (in 3-mo analysis window)
    // repo-B: first commit 1wk ago (in 3-mo analysis window)
    const threeYearsAgo = NOW_EPOCH - 3 * 365 * 24 * 3600;
    insertPerRepoAuthor(ALICE_ID, 'alice', threeYearsAgo);
    // Alice's OLD first commit in repo-A (outside analysis window, but sets MIN(committed_at))
    insertPerRepoCommit(REPO_A_ID, ALICE_ID, TWO_YEARS_AGO);
    // Alice's RECENT commit in repo-A (within 3-mo analysis window)
    insertPerRepoCommit(REPO_A_ID, ALICE_ID, ONE_MONTH_AGO);
    // Alice's commit in repo-B (1 week ago — within window, and this IS her first in repo-B)
    insertPerRepoCommit(REPO_B_ID, ALICE_ID, ONE_WEEK_AGO);

    // Bob: first_commit_at = 6 months ago, commits in both repos from 6 months ago
    insertPerRepoAuthor(BOB_ID, 'bob', SIX_MONTHS_AGO);
    insertPerRepoCommit(REPO_A_ID, BOB_ID, SIX_MONTHS_AGO);
    insertPerRepoCommit(REPO_B_ID, BOB_ID, SIX_MONTHS_AGO);
  });

  it('per-repo mode returns one row per (author, repo), not one per author', () => {
    // Analysis window: last 3 months (so alice appears in BOTH repos)
    const start = new Date(THREE_MONTHS_AGO * 1000);
    const end = new Date(NOW_EPOCH * 1000);

    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_A_ID, REPO_B_ID],
    });

    const aliceRows = results.filter(r => r.authorLogin === 'alice');
    expect(aliceRows.length).toBe(2); // one per repo
  });

  it('per-repo mode: alice gets senior cohort for repo-A and new cohort for repo-B', () => {
    // Analysis window: last 3 months
    // Cohort relative to startEpoch (3mo ago):
    //   repo-A: MIN(committed_at) = 2yr ago → startEpoch - 2yr ago ≈ 2yr - 3mo >> 12mo → senior
    //   repo-B: MIN(committed_at) = 1wk ago → startEpoch - 1wk ago < 0 → BUT wait!
    //   Actually startEpoch - 1wk_ago = (3mo_ago) - (1wk_ago) = negative!
    //
    // To get 'new' for repo-B, we need startEpoch > MIN(committed_at) for repo-B.
    // So startDate must be BEFORE alice's repo-B first commit.
    // Use a wider window: startDate = 2 months ago, alice's repo-B commit = 1 week ago.
    // startEpoch(2mo ago) - MIN(1wk ago) = 2mo - 1wk ≈ 7 weeks, which is < 3mo → 'new'
    const twoMonthsAgo = NOW_EPOCH - 2 * 30 * 24 * 3600;
    const start = new Date(twoMonthsAgo * 1000);
    const end = new Date(NOW_EPOCH * 1000);

    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_A_ID, REPO_B_ID],
    }) as import('@shared/types.js').ContributorRepoStats[];

    const aliceRepoA = results.find(r => r.authorLogin === 'alice' && r.repoId === REPO_A_ID);
    const aliceRepoB = results.find(r => r.authorLogin === 'alice' && r.repoId === REPO_B_ID);

    expect(aliceRepoA).toBeDefined();
    expect(aliceRepoB).toBeDefined();
    expect(aliceRepoA!.cohort).toBe('senior'); // 2yr ago >> 12mo threshold relative to 2mo-ago startEpoch
    expect(aliceRepoB!.cohort).toBe('new');    // 1wk ago < 3mo threshold relative to 2mo-ago startEpoch
  });

  it('global mode still returns one row per author (unchanged behavior)', () => {
    const start = new Date(THREE_MONTHS_AGO * 1000);
    const end = new Date(NOW_EPOCH * 1000);

    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'global',
      repoIds: [REPO_A_ID, REPO_B_ID],
    });

    const aliceRows = results.filter(r => r.authorLogin === 'alice');
    expect(aliceRows.length).toBe(1); // one row per author in global mode
  });

  it('getContributorBeforeAfterStats per-repo mode uses composite (authorLogin::repoId) key', () => {
    const start = new Date(THREE_MONTHS_AGO * 1000);
    const end = new Date(NOW_EPOCH * 1000);
    // Set AI marker 2 weeks ago: alice's repo-A recent commit (1mo ago) is in pre period,
    // alice's repo-B commit (1wk ago) is in post period
    const twoWeeksAgo = NOW_EPOCH - 14 * 24 * 3600;
    const aiMarker = new Date(twoWeeksAgo * 1000);

    const results = getContributorBeforeAfterStats({
      startDate: start,
      endDate: end,
      aiMarkerDate: aiMarker,
      tenureMode: 'repo',
      repoIds: [REPO_A_ID, REPO_B_ID],
    }) as import('@shared/types.js').ContributorRepoBeforeAfterStats[];

    // alice-repo-A: appears in pre period (recent commit 1mo ago, before marker 2wk ago)
    // alice-repo-B: appears in post period (commit 1wk ago, after marker 2wk ago)
    const aliceRepoAEntry = results.find(r => r.authorLogin === 'alice' && r.repoId === REPO_A_ID);
    const aliceRepoBEntry = results.find(r => r.authorLogin === 'alice' && r.repoId === REPO_B_ID);

    // Both entries should exist as separate rows (composite key separates them)
    expect(aliceRepoAEntry).toBeDefined();
    expect(aliceRepoBEntry).toBeDefined();
  });
});

// ---- Per-repo tenure regression tests (D-11) ----

describe('per-repo tenure regression tests (D-11)', () => {
  // These tests use the same shared testDb (same vi.mock), but use IDs in the 30-39 range
  const NOW = Math.floor(Date.now() / 1000);
  const TWO_YRS = NOW - 2 * 365 * 24 * 3600;
  const ONE_MO = NOW - 30 * 24 * 3600;
  const ONE_WK = NOW - 7 * 24 * 3600;
  const SIX_MO = NOW - 6 * 30 * 24 * 3600;
  // Analysis window: last 3 months. For cohort calculation (startEpoch - MIN):
  //   senior threshold: 12mo * 30 * 86400 = 31,104,000s
  //   new threshold:    3mo  * 30 * 86400 = 7,776,000s
  // For alice's repo-A row to be 'senior': startEpoch - TWO_YRS must be > 31,104,000s
  //   3mo_ago - 2yr_ago ≈ (NOW - 3mo) - (NOW - 2yr) = 2yr - 3mo = ~21mo >> 12mo ✓
  // For alice's repo-B row to be 'new': startEpoch - ONE_WK must be < 7,776,000s
  //   3mo_ago - 1wk_ago = 3mo - 1wk ≈ 82 days ≈ 7,084,800s < 7,776,000s ✓
  const THREE_MO = NOW - 3 * 30 * 24 * 3600;

  const REPO_A = 30;
  const REPO_B = 31;
  const ALICE = 30;
  const BOB = 31;

  let _d11ShaCounter = 1000;

  function insertD11Repo(repoId: number, name: string): void {
    testDb.insert(schema.repositories).values({
      id: repoId,
      githubId: repoId * 999,
      fullName: `d11-org/${name}`,
      ownerLogin: 'd11-org',
      name,
      isPrivate: false,
      defaultBranch: 'main',
      addedAt: new Date(),
    }).run();
    testDb.insert(schema.collectionState).values([
      { repoId, resourceType: 'commits', status: 'complete', lastRunAt: new Date() },
      { repoId, resourceType: 'pull_requests', status: 'complete', lastRunAt: new Date() },
    ]).run();
  }

  function insertD11Author(id: number, login: string, firstCommitEpoch: number): void {
    testDb.insert(schema.authors).values({
      id,
      githubLogin: login,
      isBot: false,
      firstCommitAt: new Date(firstCommitEpoch * 1000),
    }).run();
  }

  function insertD11Commit(repoId: number, authorId: number, epochSeconds: number): void {
    _d11ShaCounter++;
    testDb.insert(schema.commits).values({
      sha: `sha-d11-${_d11ShaCounter}`,
      repoId,
      authorId,
      message: `d11 commit ${_d11ShaCounter}`,
      committedAt: new Date(epochSeconds * 1000),
      linesAdded: 10,
      linesDeleted: 5,
      filesChanged: 2,
    }).run();
  }

  beforeAll(() => {
    insertD11Repo(REPO_A, 'repo-a');
    insertD11Repo(REPO_B, 'repo-b');

    const threeYearsAgo = NOW - 3 * 365 * 24 * 3600;

    // alice: first_commit_at 3yr ago (global)
    // repo-A: ancient first commit (2yr ago) + recent commit (1mo ago, in analysis window)
    // repo-B: single commit from 1 week ago (first and only commit in this repo)
    insertD11Author(ALICE, 'd11-alice', threeYearsAgo);
    // Old first commit in repo-A (sets MIN committed_at = 2yr ago, but outside 3mo window)
    insertD11Commit(REPO_A, ALICE, TWO_YRS);
    // Recent commit in repo-A (so alice appears in the 3-mo analysis window)
    insertD11Commit(REPO_A, ALICE, ONE_MO);
    // Single commit in repo-B (1 week ago — both her first and only commit there)
    insertD11Commit(REPO_B, ALICE, ONE_WK);

    // bob: first_commit_at 6mo ago, recent commits in both repos
    insertD11Author(BOB, 'd11-bob', SIX_MO);
    insertD11Commit(REPO_A, BOB, ONE_MO);
    insertD11Commit(REPO_B, BOB, ONE_MO);
  });

  it("new repo doesn't reset tenure in contributor table (MIN across repos)", () => {
    // Analysis window: last 3 months
    // startEpoch (3mo ago): cohort calculation = startEpoch - MIN(committed_at)
    //   repo-A: MIN = 2yr ago → startEpoch - 2yr_ago = 2yr - 3mo ≈ 21mo > 12mo → senior
    //   repo-B: MIN = 1wk ago → startEpoch - 1wk_ago = 3mo - 1wk ≈ 82 days < 90 days (3mo) → new
    const start = new Date(THREE_MO * 1000);
    const end = new Date(NOW * 1000);

    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_A, REPO_B],
    }) as import('@shared/types.js').ContributorRepoStats[];

    // alice should have 2 rows - one per repo
    const aliceA = results.find(r => r.authorLogin === 'd11-alice' && r.repoId === REPO_A);
    const aliceB = results.find(r => r.authorLogin === 'd11-alice' && r.repoId === REPO_B);

    expect(aliceA).toBeDefined();
    expect(aliceB).toBeDefined();

    // repo-A row: alice's earliest commit in repo-A is 2yr ago → senior
    expect(aliceA!.cohort).toBe('senior');
    // repo-B row: alice's earliest commit in repo-B is 1wk ago → new
    expect(aliceB!.cohort).toBe('new');

    // Verify firstCommitInRepoAt fields reflect per-repo MIN
    const repoAFirstMs = new Date(aliceA!.firstCommitInRepoAt).getTime() / 1000;
    const repoBFirstMs = new Date(aliceB!.firstCommitInRepoAt).getTime() / 1000;

    // repo-A first commit should be approximately 2yr ago (within 1 day)
    expect(Math.abs(repoAFirstMs - TWO_YRS)).toBeLessThan(86400);
    // repo-B first commit should be approximately 1wk ago (within 1 day)
    expect(Math.abs(repoBFirstMs - ONE_WK)).toBeLessThan(86400);
  });

  it('cohort charts per-repo: new repo DOES reset tenure', () => {
    // Same 3-month analysis window
    const start = new Date(THREE_MO * 1000);
    const end = new Date(NOW * 1000);

    const results = getCohortCommitMetrics({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_A, REPO_B],
    });

    // With per-repo tenure: alice's repo-A commits should be in 'senior' cohort,
    // alice's repo-B commit should be in 'new' cohort
    const seniorRows = results.filter(r => r.cohort === 'senior');
    const newRows = results.filter(r => r.cohort === 'new');

    // Both cohorts should have data (alice in senior for repo-A, alice in new for repo-B)
    expect(seniorRows.length).toBeGreaterThan(0);
    expect(newRows.length).toBeGreaterThan(0);
  });

  it('global vs per-repo divergence with partial collection', () => {
    // Global mode uses first_commit_at from authors table (3yr ago for alice)
    // startEpoch (3mo ago) - first_commit_at (3yr ago) = 3yr - 3mo >> 12mo → senior
    const start = new Date(THREE_MO * 1000);
    const end = new Date(NOW * 1000);

    // Global mode: alice uses first_commit_at (3yr ago) → senior
    const globalResults = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'global',
      repoIds: [REPO_A, REPO_B],
    });

    const aliceGlobal = globalResults.find(r => r.authorLogin === 'd11-alice');
    expect(aliceGlobal).toBeDefined();
    expect(aliceGlobal!.cohort).toBe('senior');

    // Per-repo mode: alice's repo-A row is senior (2yr ago), repo-B row is new (1wk ago)
    const repoResults = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_A, REPO_B],
    }) as import('@shared/types.js').ContributorRepoStats[];

    const aliceRepoA = repoResults.find(r => r.authorLogin === 'd11-alice' && r.repoId === REPO_A);
    const aliceRepoB = repoResults.find(r => r.authorLogin === 'd11-alice' && r.repoId === REPO_B);

    expect(aliceRepoA!.cohort).toBe('senior');
    expect(aliceRepoB!.cohort).toBe('new');
  });

  it('seed data parity — both modes produce seniors', () => {
    const start = new Date(THREE_MO * 1000);
    const end = new Date(NOW * 1000);

    const globalResults = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'global',
      repoIds: [REPO_A, REPO_B],
    });

    const repoResults = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_A, REPO_B],
    });

    // At least one senior in global mode (alice with 3yr tenure)
    expect(globalResults.some(r => r.cohort === 'senior')).toBe(true);
    // At least one senior in repo mode (alice's repo-A row)
    expect(repoResults.some(r => r.cohort === 'senior')).toBe(true);
  });

  it('single-repo selection — per-repo table uses MIN from that repo only', () => {
    const start = new Date(THREE_MO * 1000);
    const end = new Date(NOW * 1000);

    // Filter to repo-B only
    const results = getContributorStats({
      startDate: start,
      endDate: end,
      tenureMode: 'repo',
      repoIds: [REPO_B],
    }) as import('@shared/types.js').ContributorRepoStats[];

    // Only authors with commits in repo-B should appear
    const aliceRow = results.find(r => r.authorLogin === 'd11-alice');
    const bobRow = results.find(r => r.authorLogin === 'd11-bob');

    expect(aliceRow).toBeDefined();
    expect(bobRow).toBeDefined();

    // alice's only commit in repo-B is from 1 week ago → new cohort
    expect(aliceRow!.cohort).toBe('new');

    // All rows should be for repo-B only
    expect(results.every(r => r.repoId === REPO_B)).toBe(true);
  });
});
