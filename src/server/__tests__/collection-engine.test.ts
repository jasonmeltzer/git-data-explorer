import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// Build an in-memory test database with full schema
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
    CREATE INDEX idx_commits_repo_date ON commits(repo_id, committed_at);
    CREATE INDEX idx_commits_author ON commits(author_id);
    CREATE UNIQUE INDEX idx_commits_sha_repo ON commits(sha, repo_id);

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
    CREATE INDEX idx_prs_repo_date ON pull_requests(repo_id, created_at);
    CREATE INDEX idx_prs_author ON pull_requests(author_id);
    CREATE UNIQUE INDEX idx_prs_github_id_repo ON pull_requests(github_id, repo_id);

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
    CREATE UNIQUE INDEX idx_collection_repo_type_unique ON collection_state(repo_id, resource_type);
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import after mock
const { CollectionEngine, RateLimitError, createCollectionOctokit } = await import('../services/collection-engine.js');
const { getCollectionState, markCollectionComplete, getRepoItemCounts } = await import('../services/collection-state.js');

// Helper: insert a test repo
function insertTestRepo(id = 1, fullName = 'org/test-repo') {
  testDb.insert(schema.repositories).values({
    id,
    githubId: id * 1000,
    fullName,
    ownerLogin: fullName.split('/')[0],
    name: fullName.split('/')[1],
    isPrivate: false,
    defaultBranch: 'main',
    addedAt: new Date(),
  }).run();
}

const testRepo = {
  id: 1,
  fullName: 'org/test-repo',
  ownerLogin: 'org',
  name: 'test-repo',
  defaultBranch: 'main',
};

// Create a mock Octokit with paginate.iterator
function createMockOctokit(opts?: {
  commitPages?: Array<Array<Record<string, unknown>>>;
  prPages?: Array<Array<Record<string, unknown>>>;
  prDetails?: Record<number, Record<string, unknown>>;
  commitDetails?: Record<string, Record<string, unknown>>;
  throwOnPage?: { resource: 'commits' | 'prs'; page: number; error: Error };
}) {
  const commitPages = opts?.commitPages ?? [];
  const prPages = opts?.prPages ?? [];
  const prDetails = opts?.prDetails ?? {};
  const commitDetails = opts?.commitDetails ?? {};
  const throwOnPage = opts?.throwOnPage;

  const mockOctokit = {
    rest: {
      repos: {
        listCommits: vi.fn(),
        getCommit: vi.fn().mockImplementation(({ ref }: { ref: string }) => {
          return Promise.resolve({ data: commitDetails[ref] ?? { sha: ref, stats: { additions: 10, deletions: 5 }, files: [{}] } });
        }),
      },
      pulls: {
        list: vi.fn(),
        get: vi.fn().mockImplementation(({ pull_number }: { pull_number: number }) => {
          return Promise.resolve({
            data: prDetails[pull_number] ?? {
              additions: 50,
              deletions: 20,
              changed_files: 3,
              commits: 2,
            },
          });
        }),
      },
    },
    paginate: {
      iterator: vi.fn().mockImplementation((endpoint: unknown) => {
        if (endpoint === mockOctokit.rest.repos.listCommits) {
          let pageIdx = 0;
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  if (throwOnPage?.resource === 'commits' && pageIdx === throwOnPage.page) {
                    throw throwOnPage.error;
                  }
                  if (pageIdx >= commitPages.length) return { done: true, value: undefined };
                  const data = commitPages[pageIdx++];
                  return { done: false, value: { data } };
                },
              };
            },
          };
        }
        if (endpoint === mockOctokit.rest.pulls.list) {
          let pageIdx = 0;
          return {
            [Symbol.asyncIterator]() {
              return {
                async next() {
                  if (throwOnPage?.resource === 'prs' && pageIdx === throwOnPage.page) {
                    throw throwOnPage.error;
                  }
                  if (pageIdx >= prPages.length) return { done: true, value: undefined };
                  const data = prPages[pageIdx++];
                  return { done: false, value: { data } };
                },
              };
            },
          };
        }
        throw new Error('Unknown endpoint');
      }),
    },
  };
  return mockOctokit as unknown as ReturnType<typeof createCollectionOctokit>;
}

function makeCommit(sha: string, login: string, date: string, stats?: { additions: number; deletions: number }, files?: unknown[]) {
  return {
    sha,
    author: { login, type: 'User' },
    commit: {
      author: { name: login, date },
      message: `commit ${sha}`,
    },
    stats: stats ?? undefined,
    files: files ?? undefined,
  };
}

function makePR(id: number, number: number, login: string, updatedAt: string) {
  return {
    id,
    number,
    title: `PR #${number}`,
    state: 'closed',
    user: { login, type: 'User' },
    created_at: '2025-01-01T00:00:00Z',
    merged_at: '2025-01-02T00:00:00Z',
    closed_at: '2025-01-02T00:00:00Z',
    updated_at: updatedAt,
  };
}

describe('CollectionEngine', () => {
  let engine: InstanceType<typeof CollectionEngine>;

  beforeEach(() => {
    // Clear all tables
    testDb.delete(schema.collectionState).run();
    testDb.delete(schema.commits).run();
    testDb.delete(schema.pullRequests).run();
    testDb.delete(schema.authors).run();
    testDb.delete(schema.repositories).run();

    insertTestRepo();
    engine = new CollectionEngine();
  });

  afterEach(() => {
    engine.abort();
  });

  it('collectCommits stores commits and checkpoints after each page', async () => {
    const page1 = [
      makeCommit('aaa111', 'alice', '2025-06-01T10:00:00Z', { additions: 10, deletions: 2 }, [{}, {}]),
      makeCommit('bbb222', 'bob', '2025-06-02T10:00:00Z', { additions: 20, deletions: 5 }, [{}]),
    ];
    const page2 = [
      makeCommit('ccc333', 'alice', '2025-06-03T10:00:00Z', { additions: 5, deletions: 1 }, [{}, {}, {}]),
    ];

    const octokit = createMockOctokit({ commitPages: [page1, page2], prPages: [] });
    await engine.collectRepo(octokit!, testRepo);

    // Verify commits stored
    const allCommits = testDb.select().from(schema.commits).all();
    expect(allCommits).toHaveLength(3);
    expect(allCommits[0].sha).toBe('aaa111');
    expect(allCommits[0].linesAdded).toBe(10);

    // Verify collection state is complete
    const state = getCollectionState(1, 'commits');
    expect(state).not.toBeNull();
    expect(state!.status).toBe('complete');
  });

  it('collectCommits with existing cursor only fetches since that cursor', async () => {
    // Pre-set a cursor
    const { upsertCollectionState } = await import('../services/collection-state.js');
    upsertCollectionState(1, 'commits', { cursor: '2025-06-01T00:00:00Z', status: 'in_progress', lastPage: 1 });

    const page1 = [
      makeCommit('ddd444', 'alice', '2025-06-02T10:00:00Z', { additions: 10, deletions: 2 }, [{}]),
    ];

    const octokit = createMockOctokit({ commitPages: [page1], prPages: [] });

    // Capture what params were passed to paginate.iterator
    await engine.collectRepo(octokit!, testRepo);

    // The iterator was called with since param
    const iteratorCalls = (octokit!.paginate.iterator as ReturnType<typeof vi.fn>).mock.calls;
    const commitCall = iteratorCalls.find((c: unknown[]) => c[0] === octokit!.rest.repos.listCommits);
    expect(commitCall).toBeDefined();
    expect((commitCall![1] as Record<string, unknown>).since).toBe('2025-06-01T00:00:00Z');
  });

  it('collectPRs fetches individual PR stats and stores to DB', async () => {
    const prPage = [
      makePR(1001, 1, 'alice', '2025-06-01T10:00:00Z'),
      makePR(1002, 2, 'bob', '2025-06-02T10:00:00Z'),
    ];

    const prDetails: Record<number, Record<string, unknown>> = {
      1: { additions: 100, deletions: 50, changed_files: 5, commits: 3 },
      2: { additions: 200, deletions: 10, changed_files: 2, commits: 1 },
    };

    const octokit = createMockOctokit({ commitPages: [], prPages: [prPage], prDetails });
    await engine.collectRepo(octokit!, testRepo);

    const allPRs = testDb.select().from(schema.pullRequests).all();
    expect(allPRs).toHaveLength(2);
    expect(allPRs[0].linesAdded).toBe(100);
    expect(allPRs[1].linesAdded).toBe(200);

    const prState = getCollectionState(1, 'pull_requests');
    expect(prState!.status).toBe('complete');
  });

  it('collectPRs stops pagination when all PRs <= cursor', async () => {
    // Pre-set cursor
    const { upsertCollectionState } = await import('../services/collection-state.js');
    upsertCollectionState(1, 'pull_requests', { cursor: '2025-06-10T00:00:00Z', status: 'in_progress', lastPage: 1 });

    const prPage = [
      makePR(1001, 1, 'alice', '2025-06-01T10:00:00Z'),
      makePR(1002, 2, 'bob', '2025-06-02T10:00:00Z'),
    ];

    // Second page shouldn't be reached
    const prPage2 = [
      makePR(1003, 3, 'charlie', '2025-06-11T10:00:00Z'),
    ];

    const octokit = createMockOctokit({ commitPages: [], prPages: [prPage, prPage2] });
    await engine.collectRepo(octokit!, testRepo);

    // No PRs should be stored (all were <= cursor)
    const allPRs = testDb.select().from(schema.pullRequests).all();
    expect(allPRs).toHaveLength(0);
  });

  it('duplicate commits are upserted, not duplicated', async () => {
    const page1 = [
      makeCommit('aaa111', 'alice', '2025-06-01T10:00:00Z', { additions: 10, deletions: 2 }, [{}]),
    ];

    const octokit = createMockOctokit({ commitPages: [page1], prPages: [] });

    // Run collection twice
    await engine.collectRepo(octokit!, testRepo);
    engine.resetAbort();
    // Need to reset collection state for second run
    const { upsertCollectionState } = await import('../services/collection-state.js');
    upsertCollectionState(1, 'commits', { status: 'pending' });
    upsertCollectionState(1, 'pull_requests', { status: 'pending' });

    const octokit2 = createMockOctokit({ commitPages: [page1], prPages: [] });
    await engine.collectRepo(octokit2!, testRepo);

    const allCommits = testDb.select().from(schema.commits).all();
    expect(allCommits).toHaveLength(1);
    expect(allCommits[0].sha).toBe('aaa111');
  });

  it('RateLimitError causes pause state to be written', async () => {
    const rateLimitError = new RateLimitError(300, false);

    const octokit = createMockOctokit({
      commitPages: [],
      prPages: [],
      throwOnPage: { resource: 'commits', page: 0, error: rateLimitError },
    });

    // collectRepo should handle the rate limit error
    await expect(engine.collectRepo(octokit!, testRepo)).rejects.toThrow(RateLimitError);

    const commitState = getCollectionState(1, 'commits');
    expect(commitState).not.toBeNull();
    expect(commitState!.status).toBe('paused');
    expect(commitState!.errorMessage).toContain('Rate limit hit');
  });

  it('abort() stops collection at next page boundary', async () => {
    const page1 = [
      makeCommit('aaa111', 'alice', '2025-06-01T10:00:00Z', { additions: 10, deletions: 2 }, [{}]),
    ];
    const page2 = [
      makeCommit('bbb222', 'bob', '2025-06-02T10:00:00Z', { additions: 20, deletions: 5 }, [{}]),
    ];
    const page3 = [
      makeCommit('ccc333', 'charlie', '2025-06-03T10:00:00Z', { additions: 30, deletions: 10 }, [{}]),
    ];

    // Create a mock that aborts after second page is yielded
    // (so first page processes, second page checks abort before processing)
    let pageCount = 0;
    const mockOctokit = {
      rest: {
        repos: {
          listCommits: vi.fn(),
          getCommit: vi.fn(),
        },
        pulls: {
          list: vi.fn(),
          get: vi.fn(),
        },
      },
      paginate: {
        iterator: vi.fn().mockImplementation((endpoint: unknown) => {
          if (endpoint === mockOctokit.rest.repos.listCommits) {
            const pages = [page1, page2, page3];
            pageCount = 0;
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    if (pageCount >= pages.length) return { done: true, value: undefined };
                    const data = pages[pageCount++];
                    // Abort after second page is yielded (so page 1 is processed, page 2 check sees abort)
                    if (pageCount === 2) {
                      engine.abort();
                    }
                    return { done: false, value: { data } };
                  },
                };
              },
            };
          }
          // PRs - return empty
          return {
            [Symbol.asyncIterator]() {
              return { async next() { return { done: true, value: undefined }; } };
            },
          };
        }),
      },
    } as unknown as ReturnType<typeof createCollectionOctokit>;

    await engine.collectRepo(mockOctokit!, testRepo);

    // Only page 1 commit should be stored - abort triggered before page 2 was processed
    const allCommits = testDb.select().from(schema.commits).all();
    expect(allCommits).toHaveLength(1);
    expect(allCommits[0].sha).toBe('aaa111');

    // State should be paused
    const state = getCollectionState(1, 'commits');
    expect(state!.status).toBe('paused');
  });

  it('bot authors are marked isBot=true in authors table', async () => {
    const page1 = [
      makeCommit('aaa111', 'dependabot[bot]', '2025-06-01T10:00:00Z', { additions: 1, deletions: 0 }, [{}]),
      makeCommit('bbb222', 'alice', '2025-06-02T10:00:00Z', { additions: 10, deletions: 2 }, [{}]),
    ];

    // Make one author a Bot type
    page1[0].author = { login: 'dependabot[bot]', type: 'Bot' } as typeof page1[0]['author'];

    const octokit = createMockOctokit({ commitPages: [page1], prPages: [] });
    await engine.collectRepo(octokit!, testRepo);

    const allAuthors = testDb.select().from(schema.authors).all();
    expect(allAuthors).toHaveLength(2);

    const botAuthor = allAuthors.find((a) => a.githubLogin === 'dependabot[bot]');
    expect(botAuthor).toBeDefined();
    expect(botAuthor!.isBot).toBe(true);

    const humanAuthor = allAuthors.find((a) => a.githubLogin === 'alice');
    expect(humanAuthor).toBeDefined();
    expect(humanAuthor!.isBot).toBe(false);
  });

  it('emits progress events during collection', async () => {
    const page1 = [
      makeCommit('aaa111', 'alice', '2025-06-01T10:00:00Z', { additions: 10, deletions: 2 }, [{}]),
    ];

    const octokit = createMockOctokit({ commitPages: [page1], prPages: [] });

    const events: Array<Record<string, unknown>> = [];
    engine.addProgressListener((event) => events.push(event as unknown as Record<string, unknown>));

    await engine.collectRepo(octokit!, testRepo);

    const types = events.map((e) => e.type);
    expect(types).toContain('repo_start');
    expect(types).toContain('page_complete');
    expect(types).toContain('repo_complete');
  });

  it('fetches individual commit stats when list endpoint lacks them', async () => {
    // Commits without stats (stats=undefined triggers individual fetches)
    const page1 = [
      makeCommit('aaa111', 'alice', '2025-06-01T10:00:00Z'),
    ];

    const commitDetails: Record<string, Record<string, unknown>> = {
      aaa111: {
        sha: 'aaa111',
        stats: { additions: 42, deletions: 7 },
        files: [{}, {}, {}],
      },
    };

    const octokit = createMockOctokit({ commitPages: [page1], prPages: [], commitDetails });
    await engine.collectRepo(octokit!, testRepo);

    const allCommits = testDb.select().from(schema.commits).all();
    expect(allCommits).toHaveLength(1);
    expect(allCommits[0].linesAdded).toBe(42);
    expect(allCommits[0].linesDeleted).toBe(7);
    expect(allCommits[0].filesChanged).toBe(3);
  });
});
