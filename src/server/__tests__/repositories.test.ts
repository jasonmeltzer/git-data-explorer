import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// Create an in-memory test database
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
    error_message TEXT
  );
`);
const testDb = drizzle(sqlite, { schema });

// Mock the db client and octokit before any imports
vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

vi.mock('../services/octokit.js', () => ({
  createOctokit: vi.fn(),
}));

// Import after mocks are set up
const { default: repositoriesRoute } = await import('../routes/repositories.js');
const { createOctokit } = await import('../services/octokit.js');

// Build a minimal test app
const app = new Hono();
app.route('/', repositoriesRoute);

const sampleRepo = {
  githubId: 42,
  fullName: 'org/test-repo',
  name: 'test-repo',
  ownerLogin: 'org',
  isPrivate: false,
  defaultBranch: 'main',
};

describe('Repositories API', () => {
  beforeEach(() => {
    // Clear tables before each test
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();
    vi.mocked(createOctokit).mockReturnValue(null);
  });

  it('GET /api/repos returns { repos: [] } initially', async () => {
    const res = await app.request('/api/repos');
    expect(res.status).toBe(200);
    const body = await res.json() as { repos: unknown[] };
    expect(body.repos).toEqual([]);
  });

  it('POST /api/repos with valid body returns { success: true }', async () => {
    const res = await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [sampleRepo] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('GET /api/repos returns the added repo after POST', async () => {
    await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [sampleRepo] }),
    });

    const res = await app.request('/api/repos');
    const body = await res.json() as { repos: Array<{ fullName: string }> };
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].fullName).toBe('org/test-repo');
  });

  it('PATCH /api/repos/:id/stop returns { success: true } and removes repo from GET /api/repos', async () => {
    // Add a repo
    await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [sampleRepo] }),
    });

    const allRepos = testDb.select().from(schema.repositories).all();
    const id = allRepos[0].id;

    const stopRes = await app.request(`/api/repos/${id}/stop`, { method: 'PATCH' });
    expect(stopRes.status).toBe(200);
    const stopBody = await stopRes.json() as { success: boolean };
    expect(stopBody.success).toBe(true);

    // Should no longer appear in active repos
    const activeRes = await app.request('/api/repos');
    const activeBody = await activeRes.json() as { repos: unknown[] };
    expect(activeBody.repos).toHaveLength(0);
  });

  it('GET /api/repos/stopped returns the stopped repo', async () => {
    await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [sampleRepo] }),
    });

    const allRepos = testDb.select().from(schema.repositories).all();
    const id = allRepos[0].id;
    await app.request(`/api/repos/${id}/stop`, { method: 'PATCH' });

    const res = await app.request('/api/repos/stopped');
    expect(res.status).toBe(200);
    const body = await res.json() as { repos: Array<{ fullName: string }> };
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].fullName).toBe('org/test-repo');
  });

  it('GET /api/repos/:id/delete-preview returns { commits: 0, prs: 0 } for a repo with no data', async () => {
    await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [sampleRepo] }),
    });

    const allRepos = testDb.select().from(schema.repositories).all();
    const id = allRepos[0].id;

    const res = await app.request(`/api/repos/${id}/delete-preview`);
    expect(res.status).toBe(200);
    const body = await res.json() as { commits: number; prs: number };
    expect(body.commits).toBe(0);
    expect(body.prs).toBe(0);
  });

  it('DELETE /api/repos/:id returns { success: true } and removes repo from stopped list', async () => {
    await app.request('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repos: [sampleRepo] }),
    });

    const allRepos = testDb.select().from(schema.repositories).all();
    const id = allRepos[0].id;

    // Stop it first
    await app.request(`/api/repos/${id}/stop`, { method: 'PATCH' });

    // Now hard-delete
    const deleteRes = await app.request(`/api/repos/${id}`, { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json() as { success: boolean };
    expect(deleteBody.success).toBe(true);

    // Should be gone from stopped list
    const stoppedRes = await app.request('/api/repos/stopped');
    const stoppedBody = await stoppedRes.json() as { repos: unknown[] };
    expect(stoppedBody.repos).toHaveLength(0);
  });

  it('GET /api/repos/available returns 401 when no token is configured', async () => {
    vi.mocked(createOctokit).mockReturnValue(null);
    const res = await app.request('/api/repos/available');
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('GitHub token not configured');
  });
});
