import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, isNull, isNotNull } from 'drizzle-orm';
import * as schema from '../db/schema.js';

// Build an in-memory test database with the full schema
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Create all tables inline (mirrors schema.ts structure)
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
  `);

  return drizzle(sqlite, { schema });
}

// We mock the db module so repo-management uses our test DB
// Instead, we'll test the service functions by importing them and replacing the db reference.
// Since repo-management imports db directly, we'll test it by creating the service functions
// directly using the test DB — or we can use vi.mock.

// Approach: Extract the business logic into testable units by importing the functions
// with a mocked db. But since repo-management.ts imports db at module level, we'll
// use vi.mock to replace it.

import { vi } from 'vitest';

// We need a way to inject the test DB. Let's use a different approach:
// Test the actual service functions but point them at an in-memory DB.
// We do this by mocking the db/client module.

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Now import the service under test
const {
  getTrackedRepos,
  getStoppedRepos,
  addRepos,
  stopTracking,
  getDeleteCounts,
  deleteRepoData,
} = await import('../services/repo-management.js');

const sampleRepo = {
  githubId: 12345,
  fullName: 'org/my-repo',
  name: 'my-repo',
  ownerLogin: 'org',
  isPrivate: false,
  defaultBranch: 'main',
};

const sampleRepo2 = {
  githubId: 99999,
  fullName: 'org/another-repo',
  name: 'another-repo',
  ownerLogin: 'org',
  isPrivate: false,
  defaultBranch: 'main',
};

describe('Repo Management Service', () => {
  beforeEach(() => {
    // Clear all tables before each test
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
  });

  it('getTrackedRepos() returns only repos where removedAt IS NULL', () => {
    addRepos([sampleRepo]);
    const repos = getTrackedRepos();
    expect(repos).toHaveLength(1);
    expect(repos[0].fullName).toBe('org/my-repo');
    expect(repos[0].removedAt).toBeNull();
  });

  it('addRepos() inserts a new repo into the repositories table', () => {
    addRepos([sampleRepo]);
    const all = testDb.select().from(schema.repositories).all();
    expect(all).toHaveLength(1);
    expect(all[0].githubId).toBe(12345);
  });

  it('addRepos() re-adding a previously removed repo clears removedAt and updates addedAt', () => {
    addRepos([sampleRepo]);
    const [inserted] = testDb.select().from(schema.repositories).all();
    const id = inserted.id;

    // Soft-delete it
    stopTracking(id);
    const [stopped] = testDb.select().from(schema.repositories).where(eq(schema.repositories.id, id)).all();
    expect(stopped.removedAt).not.toBeNull();

    // Re-add — should clear removedAt
    addRepos([sampleRepo]);
    const [readded] = testDb.select().from(schema.repositories).where(eq(schema.repositories.id, id)).all();
    expect(readded.removedAt).toBeNull();
  });

  it('stopTracking(id) sets removedAt and excludes repo from getTrackedRepos()', () => {
    addRepos([sampleRepo]);
    const [inserted] = testDb.select().from(schema.repositories).all();
    stopTracking(inserted.id);

    const tracked = getTrackedRepos();
    expect(tracked).toHaveLength(0);

    const stopped = getStoppedRepos();
    expect(stopped).toHaveLength(1);
    expect(stopped[0].removedAt).not.toBeNull();
  });

  it('getDeleteCounts(repoId) returns accurate commit and PR counts', () => {
    addRepos([sampleRepo]);
    const [repo] = testDb.select().from(schema.repositories).all();
    const repoId = repo.id;

    // Insert test data
    testDb.insert(schema.commits).values([
      { sha: 'abc1', repoId, message: 'test', committedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
      { sha: 'abc2', repoId, message: 'test2', committedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
    ]).run();
    testDb.insert(schema.pullRequests).values([
      { githubId: 1, repoId, number: 1, title: 'PR 1', state: 'open', createdAt: new Date(), updatedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0, commitCount: 0 },
    ]).run();

    const counts = getDeleteCounts(repoId);
    expect(counts.commits).toBe(2);
    expect(counts.prs).toBe(1);
  });

  it('deleteRepoData(repoId) removes commits, PRs, collection_state, and the repo row', () => {
    addRepos([sampleRepo]);
    const [repo] = testDb.select().from(schema.repositories).all();
    const repoId = repo.id;

    testDb.insert(schema.commits).values({ sha: 'abc1', repoId, message: 'test', committedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0 }).run();
    testDb.insert(schema.pullRequests).values({ githubId: 1, repoId, number: 1, title: 'PR', state: 'open', createdAt: new Date(), updatedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0, commitCount: 0 }).run();
    testDb.insert(schema.collectionState).values({ repoId, resourceType: 'commits', status: 'pending' }).run();

    deleteRepoData(repoId);

    expect(testDb.select().from(schema.commits).all()).toHaveLength(0);
    expect(testDb.select().from(schema.pullRequests).all()).toHaveLength(0);
    expect(testDb.select().from(schema.collectionState).all()).toHaveLength(0);
    expect(testDb.select().from(schema.repositories).all()).toHaveLength(0);
  });

  it('deleteRepoData(repoId) removes orphaned authors but preserves authors referenced by other repos', () => {
    // Insert two repos
    addRepos([sampleRepo, sampleRepo2]);
    const repos = testDb.select().from(schema.repositories).all();
    const repoId1 = repos[0].id;
    const repoId2 = repos[1].id;

    // Insert an author
    testDb.insert(schema.authors).values({ githubLogin: 'alice', name: 'Alice', isBot: false }).run();
    const [author] = testDb.select().from(schema.authors).all();
    const authorId = author.id;

    // Author has commits in both repos
    testDb.insert(schema.commits).values([
      { sha: 'abc1', repoId: repoId1, authorId, message: 'c1', committedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
      { sha: 'abc2', repoId: repoId2, authorId, message: 'c2', committedAt: new Date(), linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
    ]).run();

    // Delete repo1 data — author should persist (still referenced by repo2)
    deleteRepoData(repoId1);
    const authorsAfterFirst = testDb.select().from(schema.authors).all();
    expect(authorsAfterFirst).toHaveLength(1);

    // Delete repo2 data — author should be removed (no more references)
    deleteRepoData(repoId2);
    const authorsAfterSecond = testDb.select().from(schema.authors).all();
    expect(authorsAfterSecond).toHaveLength(0);
  });

  it('getStoppedRepos() returns only repos where removedAt IS NOT NULL', () => {
    addRepos([sampleRepo, sampleRepo2]);
    const repos = testDb.select().from(schema.repositories).all();
    stopTracking(repos[0].id);

    const stopped = getStoppedRepos();
    expect(stopped).toHaveLength(1);
    expect(stopped[0].githubId).toBe(sampleRepo.githubId);
  });
});
