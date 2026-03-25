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
    CREATE INDEX idx_commits_author_repo ON commits (author_id, repo_id);
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import service under test AFTER mock
const { getRampUpCurves } = await import('../services/analytics-rampup.js');

// ─── Test data helpers ───────────────────────────────────────────────────────

let repoCounter = 100;
let authorCounter = 100;
let commitCounter = 100;

function insertRepo(fullName: string): number {
  const githubId = repoCounter++;
  testDb.insert(schema.repositories).values({
    githubId,
    fullName,
    ownerLogin: fullName.split('/')[0],
    name: fullName.split('/')[1],
    isPrivate: false,
    defaultBranch: 'main',
    addedAt: new Date(),
  }).run();
  const rows = testDb.select({ id: schema.repositories.id }).from(schema.repositories).all();
  return rows[rows.length - 1].id;
}

function insertAuthor(login: string, firstCommitAtDate: Date | null, isBot = false): number {
  const id = authorCounter++;
  // Use raw insert to set explicit id
  testDb.insert(schema.authors).values({
    githubLogin: login,
    isBot,
    firstCommitAt: firstCommitAtDate ?? undefined,
  }).run();
  const rows = testDb.select({ id: schema.authors.id }).from(schema.authors).all();
  return rows[rows.length - 1].id;
}

function insertCommit(
  sha: string,
  repoId: number,
  authorId: number | null,
  committedAtDate: Date,
  linesAdded = 10,
  linesDeleted = 5,
  filesChanged = 2
): void {
  testDb.insert(schema.commits).values({
    sha,
    repoId,
    authorId: authorId ?? undefined,
    message: `commit ${sha}`,
    committedAt: committedAtDate,
    linesAdded,
    linesDeleted,
    filesChanged,
  }).run();
}

function markRepoComplete(repoId: number): void {
  testDb.insert(schema.collectionState).values([
    { repoId, resourceType: 'commits', status: 'complete' },
    { repoId, resourceType: 'pull_requests', status: 'complete' },
  ]).run();
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 3600 * 1000);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getRampUpCurves()', () => {
  beforeEach(() => {
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
  });

  describe('basic week bucketing', () => {
    it('assigns correct weekIndex for commits at different days', () => {
      const repoId = insertRepo('org/repo-a');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorId = insertAuthor('alice', joinDate);

      // week 0: day 0
      insertCommit('c1', repoId, authorId, joinDate, 10, 0, 1);
      // week 1: day 8
      insertCommit('c2', repoId, authorId, daysAfter(joinDate, 8), 20, 5, 2);
      // week 3: day 22
      insertCommit('c3', repoId, authorId, daysAfter(joinDate, 22), 30, 10, 3);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      const weeks = result.map(b => b.weekIndex);
      expect(weeks).toContain(0);
      expect(weeks).toContain(1);
      expect(weeks).toContain(3);
    });

    it('excludes commits beyond week 11 (week 12+)', () => {
      const repoId = insertRepo('org/repo-b');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorId = insertAuthor('bob', joinDate);

      // week 0: in range
      insertCommit('c4', repoId, authorId, joinDate);
      // week 12: exactly at boundary — should be excluded (>= RAMP_UP_WEEKS)
      insertCommit('c5', repoId, authorId, daysAfter(joinDate, 84), 50, 0, 5);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      const weeks = result.map(b => b.weekIndex);
      expect(weeks).toContain(0);
      expect(weeks).not.toContain(12);
    });

    it('commits exactly at week boundary: day 0 = week 0, day 7 = week 1', () => {
      const repoId = insertRepo('org/repo-c');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorId = insertAuthor('carol', joinDate);

      // day 0 = week 0
      insertCommit('c6', repoId, authorId, joinDate, 5, 5, 1);
      // day 7 = week 1 (exactly 7 * 86400 seconds after)
      insertCommit('c7', repoId, authorId, daysAfter(joinDate, 7), 5, 5, 1);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      const weeksByIndex = new Map(result.map(b => [b.weekIndex, b]));

      expect(weeksByIndex.has(0)).toBe(true);
      expect(weeksByIndex.has(1)).toBe(true);
    });
  });

  describe('bucket metrics', () => {
    it('each bucket contains avgLinesChanged, avgFilesChanged, contributionCount, contributorCount', () => {
      const repoId = insertRepo('org/repo-d');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorId = insertAuthor('dave', joinDate);
      insertCommit('c8', repoId, authorId, joinDate, 10, 5, 2);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      expect(result).toHaveLength(1);
      const bucket = result[0];
      expect(bucket).toHaveProperty('weekIndex');
      expect(bucket).toHaveProperty('avgLinesChanged');
      expect(bucket).toHaveProperty('avgFilesChanged');
      expect(bucket).toHaveProperty('contributionCount');
      expect(bucket).toHaveProperty('contributorCount');
      expect(bucket).toHaveProperty('joinPeriod');

      expect(bucket.weekIndex).toBe(0);
      expect(bucket.avgLinesChanged).toBe(15); // 10+5
      expect(bucket.avgFilesChanged).toBe(2);
      expect(bucket.contributionCount).toBe(1);
      expect(bucket.contributorCount).toBe(1);
    });

    it('aggregates multiple authors in same join period', () => {
      const repoId = insertRepo('org/repo-e');
      markRepoComplete(repoId);

      const joinDate1 = new Date('2025-01-01T00:00:00Z');
      const joinDate2 = new Date('2025-02-01T00:00:00Z'); // both Q1

      const authorA = insertAuthor('author-a', joinDate1);
      const authorB = insertAuthor('author-b', joinDate2);

      // Both in week 0 of their own journey
      insertCommit('c9',  repoId, authorA, joinDate1,        20, 0, 2);
      insertCommit('c10', repoId, authorB, joinDate2, 40, 0, 4);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      const week0 = result.find(b => b.weekIndex === 0 && b.joinPeriod === '2025-Q1');
      expect(week0).toBeDefined();
      expect(week0!.contributionCount).toBe(2);
      expect(week0!.contributorCount).toBe(2);
      // avgLinesChanged = avg(20, 40) = 30
      expect(week0!.avgLinesChanged).toBe(30);
      // avgFilesChanged = avg(2, 4) = 3
      expect(week0!.avgFilesChanged).toBe(3);
    });
  });

  describe('join period grouping', () => {
    it('separates authors from different join periods', () => {
      const repoId = insertRepo('org/repo-f');
      markRepoComplete(repoId);

      // Author A: Q1 2025
      const joinA = new Date('2025-01-01T00:00:00Z');
      const authorA = insertAuthor('author-f1', joinA);
      insertCommit('c11', repoId, authorA, joinA, 10, 0, 1);

      // Author B: Q3 2025
      const joinB = new Date('2025-07-01T00:00:00Z');
      const authorB = insertAuthor('author-f2', joinB);
      insertCommit('c12', repoId, authorB, joinB, 20, 0, 2);
      insertCommit('c13', repoId, authorB, daysAfter(joinB, 7), 30, 0, 3);  // week 1

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      const q1Buckets = result.filter(b => b.joinPeriod === '2025-Q1');
      const q3Buckets = result.filter(b => b.joinPeriod === '2025-Q3');

      expect(q1Buckets.length).toBeGreaterThan(0);
      expect(q3Buckets.length).toBeGreaterThan(0);
      // Q1 and Q3 should have separate, non-overlapping series
      expect(q1Buckets.every(b => b.joinPeriod === '2025-Q1')).toBe(true);
      expect(q3Buckets.every(b => b.joinPeriod === '2025-Q3')).toBe(true);
    });

    it('formats joinPeriod as YYYY-QN for quarter granularity', () => {
      const repoId = insertRepo('org/repo-g');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-04-01T00:00:00Z'); // Q2
      const authorId = insertAuthor('grover', joinDate);
      insertCommit('c14', repoId, authorId, joinDate);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      expect(result.some(b => b.joinPeriod === '2025-Q2')).toBe(true);
    });

    it('formats joinPeriod as YYYY-H1 or YYYY-H2 for half granularity', () => {
      const repoId = insertRepo('org/repo-h');
      markRepoComplete(repoId);

      const joinH1 = new Date('2025-03-01T00:00:00Z'); // H1
      const joinH2 = new Date('2025-08-01T00:00:00Z'); // H2
      const authorH1 = insertAuthor('helen', joinH1);
      const authorH2 = insertAuthor('hank', joinH2);
      insertCommit('c15', repoId, authorH1, joinH1);
      insertCommit('c16', repoId, authorH2, joinH2);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'half' });
      const periods = result.map(b => b.joinPeriod);
      expect(periods).toContain('2025-H1');
      expect(periods).toContain('2025-H2');
    });

    it('formats joinPeriod as YYYY for year granularity', () => {
      const repoId = insertRepo('org/repo-i');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-06-15T00:00:00Z');
      const authorId = insertAuthor('ivan', joinDate);
      insertCommit('c17', repoId, authorId, joinDate);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'year' });
      expect(result.some(b => b.joinPeriod === '2025')).toBe(true);
    });
  });

  describe('exclusions', () => {
    it('excludes bot authors (isBot = true)', () => {
      const repoId = insertRepo('org/repo-j');
      markRepoComplete(repoId);

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const botId = insertAuthor('bot[bot]', joinDate, true);
      insertCommit('c18', repoId, botId, joinDate, 100, 0, 10);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      expect(result).toHaveLength(0);
    });

    it('excludes authors with NULL firstCommitAt', () => {
      const repoId = insertRepo('org/repo-k');
      markRepoComplete(repoId);

      const authorId = insertAuthor('null-first', null);
      insertCommit('c19', repoId, authorId, new Date('2025-03-01T00:00:00Z'), 50, 0, 5);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      expect(result).toHaveLength(0);
    });

    it('excludes repos with incomplete collection status', () => {
      const incompleteRepoId = insertRepo('org/incomplete-repo');
      // Only mark commits complete, not pull_requests
      testDb.insert(schema.collectionState).values([
        { repoId: incompleteRepoId, resourceType: 'commits', status: 'complete' },
        { repoId: incompleteRepoId, resourceType: 'pull_requests', status: 'in_progress' },
      ]).run();

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorId = insertAuthor('incomplete-author', joinDate);
      insertCommit('c20', incompleteRepoId, authorId, joinDate, 10, 0, 1);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      expect(result).toHaveLength(0);
    });
  });

  describe('incomplete repo exclusion', () => {
    it('only includes commits from repos where both commits and PRs are complete', () => {
      const completeRepoId = insertRepo('org/complete-repo');
      markRepoComplete(completeRepoId);

      const partialRepoId = insertRepo('org/partial-repo');
      testDb.insert(schema.collectionState).values([
        { repoId: partialRepoId, resourceType: 'commits', status: 'complete' },
        { repoId: partialRepoId, resourceType: 'pull_requests', status: 'pending' },
      ]).run();

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorA = insertAuthor('in-complete-repo', joinDate);
      const authorB = insertAuthor('in-partial-repo', joinDate);

      insertCommit('c21', completeRepoId, authorA, joinDate, 10, 0, 1);
      insertCommit('c22', partialRepoId, authorB, joinDate, 20, 0, 2);

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      // Only authorA's commit should be included
      expect(result).toHaveLength(1);
      expect(result[0].contributorCount).toBe(1);
      expect(result[0].avgLinesChanged).toBe(10);
    });
  });

  describe('per-repo tenure mode', () => {
    it('uses MIN(committed_at) per (authorId, repoId) for week calculation', () => {
      const repoId = insertRepo('org/repo-l');
      markRepoComplete(repoId);

      // Author has a firstCommitAt of Jan 1, but their first commit in this REPO is Feb 1
      const globalFirstCommit = new Date('2025-01-01T00:00:00Z');
      const repoFirstCommit = new Date('2025-02-01T00:00:00Z');
      const authorId = insertAuthor('repo-tenure', globalFirstCommit);

      // First commit in this repo: Feb 1
      insertCommit('c23', repoId, authorId, repoFirstCommit, 10, 0, 1);
      // Second commit: Feb 8 — week 1 from repo start, week 5 from global start
      insertCommit('c24', repoId, authorId, daysAfter(repoFirstCommit, 7), 20, 0, 2);

      const repoResult = getRampUpCurves({ tenureMode: 'repo', joinPeriodGranularity: 'quarter' });
      const globalResult = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      // In per-repo mode, Feb 1 commit is week 0, Feb 8 is week 1
      const repoWeeks = repoResult.map(b => b.weekIndex).sort((a, b) => a - b);
      expect(repoWeeks).toContain(0);
      expect(repoWeeks).toContain(1);

      // In global mode, first commit (Jan 1) is week 0 reference.
      // Feb 1 = ~4.4 weeks = week 4, Feb 8 = week 5
      const globalWeeks = globalResult.map(b => b.weekIndex).sort((a, b) => a - b);
      expect(globalWeeks).toContain(4); // Feb 1 is ~4 weeks after Jan 1
      expect(globalWeeks).toContain(5);
    });
  });

  describe('repoIds filter', () => {
    it('filters to specified repos only', () => {
      const repo1Id = insertRepo('org/repo-m1');
      const repo2Id = insertRepo('org/repo-m2');
      markRepoComplete(repo1Id);
      markRepoComplete(repo2Id);

      const joinDate = new Date('2025-01-01T00:00:00Z');
      const authorA = insertAuthor('in-repo1', joinDate);
      const authorB = insertAuthor('in-repo2', joinDate);

      insertCommit('c25', repo1Id, authorA, joinDate, 10, 0, 1);
      insertCommit('c26', repo2Id, authorB, joinDate, 20, 0, 2);

      const result = getRampUpCurves({
        tenureMode: 'global',
        repoIds: [repo1Id],
        joinPeriodGranularity: 'quarter',
      });

      expect(result).toHaveLength(1);
      expect(result[0].avgLinesChanged).toBe(10); // only repo1 author
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no qualifying authors', () => {
      const repoId = insertRepo('org/repo-n');
      markRepoComplete(repoId);
      // No commits at all

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      expect(result).toHaveLength(0);
    });

    it('returns empty array for join period with no qualifying authors', () => {
      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });
      expect(result).toHaveLength(0);
    });

    it('returns results sorted by joinPeriod then weekIndex', () => {
      const repoId = insertRepo('org/repo-o');
      markRepoComplete(repoId);

      const joinQ1 = new Date('2025-01-01T00:00:00Z');
      const joinQ3 = new Date('2025-07-01T00:00:00Z');

      const authorQ1 = insertAuthor('sorted-q1', joinQ1);
      const authorQ3 = insertAuthor('sorted-q3', joinQ3);

      insertCommit('c27', repoId, authorQ1, joinQ1);
      insertCommit('c28', repoId, authorQ1, daysAfter(joinQ1, 14)); // week 2
      insertCommit('c29', repoId, authorQ3, joinQ3);
      insertCommit('c30', repoId, authorQ3, daysAfter(joinQ3, 7)); // week 1

      const result = getRampUpCurves({ tenureMode: 'global', joinPeriodGranularity: 'quarter' });

      // Verify sorted
      for (let i = 1; i < result.length; i++) {
        const prev = result[i - 1];
        const curr = result[i];
        if (prev.joinPeriod === curr.joinPeriod) {
          expect(curr.weekIndex).toBeGreaterThan(prev.weekIndex);
        } else {
          expect(curr.joinPeriod >= prev.joinPeriod).toBe(true);
        }
      }
    });
  });
});
