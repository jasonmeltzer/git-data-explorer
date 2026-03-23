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

function makePR(id: number, number: number, login: string, updatedAt: string, createdAt?: string) {
  // Default created_at is recent (within 3-month depth boundary) so PRs pass the depth filter
  const defaultCreatedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 1 week ago
  return {
    id,
    number,
    title: `PR #${number}`,
    state: 'closed',
    user: { login, type: 'User' },
    created_at: createdAt ?? defaultCreatedAt,
    merged_at: createdAt ?? defaultCreatedAt,
    closed_at: createdAt ?? defaultCreatedAt,
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

  it('collectCommits uses since+until month-window params (newest-first)', async () => {
    // New behavior: collectCommits uses month windows (since + until) not a single cursor
    const recentDate = new Date();
    const recentIso = recentDate.toISOString();
    const page1 = [
      makeCommit('ddd444', 'alice', recentIso, { additions: 10, deletions: 2 }, [{}]),
    ];

    const octokit = createMockOctokit({ commitPages: [page1], prPages: [] });

    await engine.collectRepo(octokit!, testRepo);

    // The iterator was called with both since AND until params (month-window approach)
    const iteratorCalls = (octokit!.paginate.iterator as ReturnType<typeof vi.fn>).mock.calls;
    const commitCall = iteratorCalls.find((c: unknown[]) => c[0] === octokit!.rest.repos.listCommits);
    expect(commitCall).toBeDefined();
    const params = commitCall![1] as Record<string, unknown>;
    // since should be start of a month (ISO string)
    expect(params.since).toBeDefined();
    expect(typeof params.since).toBe('string');
    // until should also be set (month-window requires both since and until)
    expect(params.until).toBeDefined();
    expect(typeof params.until).toBe('string');
    // since should be before until
    expect(new Date(params.since as string) < new Date(params.until as string)).toBe(true);
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

  it('collectPRs stops pagination at depth boundary — skips PRs older than depth', async () => {
    // New behavior: PRs are sorted newest-first (sort=created direction=desc).
    // When a PR's created_at is older than the depth boundary, stop pagination.
    // PRs within the depth window are stored; PRs beyond are not.
    const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 1 week ago
    const oldDate = '2024-01-01T00:00:00Z'; // way before any 3-month depth boundary

    // Page 1: one recent PR (within depth), one old PR (beyond depth)
    const prPage = [
      makePR(1001, 1, 'alice', recentDate, recentDate),  // recent — should be stored
      makePR(1002, 2, 'bob', oldDate, oldDate),           // old — beyond depth, triggers stop
    ];

    // Page 2 should not be reached because depth boundary was hit on page 1
    const prPage2 = [
      makePR(1003, 3, 'charlie', recentDate, recentDate),
    ];

    const octokit = createMockOctokit({ commitPages: [], prPages: [prPage, prPage2] });
    await engine.collectRepo(octokit!, testRepo);

    // Only the recent PR should be stored; old PR beyond depth boundary skips
    const allPRs = testDb.select().from(schema.pullRequests).all();
    expect(allPRs).toHaveLength(1);
    expect(allPRs[0].githubId).toBe(1001);
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

  describe('multi-repo isolation', () => {
    const smallRepo = { id: 1, fullName: 'org/small-repo', ownerLogin: 'org', name: 'small-repo', defaultBranch: 'main' };
    const bigRepo = { id: 2, fullName: 'org/big-repo', ownerLogin: 'org', name: 'big-repo', defaultBranch: 'main' };

    beforeEach(() => {
      // Re-clear and insert both repos
      testDb.delete(schema.collectionState).run();
      testDb.delete(schema.commits).run();
      testDb.delete(schema.pullRequests).run();
      testDb.delete(schema.authors).run();
      testDb.delete(schema.repositories).run();
      insertTestRepo(1, 'org/small-repo');
      insertTestRepo(2, 'org/big-repo');
    });

    function createPerRepoMockOctokit(repoPages: Record<string, {
      commitPages: Array<Array<Record<string, unknown>>>;
      prPages: Array<Array<Record<string, unknown>>>;
    }>) {
      const mockOctokit = {
        rest: {
          repos: {
            listCommits: vi.fn(),
            getCommit: vi.fn().mockImplementation(({ ref }: { ref: string }) =>
              Promise.resolve({ data: { sha: ref, stats: { additions: 1, deletions: 0 }, files: [{}] } })),
          },
          pulls: {
            list: vi.fn(),
            get: vi.fn().mockImplementation(({ pull_number }: { pull_number: number }) =>
              Promise.resolve({ data: { additions: 10, deletions: 5, changed_files: 1, commits: 1 } })),
          },
        },
        paginate: {
          iterator: vi.fn().mockImplementation((endpoint: unknown, params: Record<string, unknown>) => {
            const repoName = params.repo as string;
            const repoData = repoPages[repoName] ?? { commitPages: [], prPages: [] };
            const isCommits = endpoint === mockOctokit.rest.repos.listCommits;
            const pages = isCommits ? repoData.commitPages : repoData.prPages;
            let idx = 0;
            return {
              [Symbol.asyncIterator]() {
                return {
                  async next() {
                    if (idx >= pages.length) return { done: true, value: undefined };
                    return { done: false, value: { data: pages[idx++] } };
                  },
                };
              },
            };
          }),
        },
      };
      return mockOctokit as unknown as ReturnType<typeof createCollectionOctokit>;
    }

    it('commit counts are isolated per repo — big repo does not inflate small repo count', async () => {
      const now = new Date();
      const recentDate = now.toISOString();

      const smallCommits = [
        makeCommit('s1', 'alice', recentDate, { additions: 1, deletions: 0 }, [{}]),
        makeCommit('s2', 'alice', recentDate, { additions: 2, deletions: 0 }, [{}]),
      ];
      const bigCommits = Array.from({ length: 50 }, (_, i) =>
        makeCommit(`b${i}`, 'bob', recentDate, { additions: i, deletions: 0 }, [{}])
      );

      const octokit = createPerRepoMockOctokit({
        'small-repo': { commitPages: [smallCommits], prPages: [] },
        'big-repo': { commitPages: [bigCommits], prPages: [] },
      });

      // Collect both repos sequentially (as processQueue would)
      await engine.collectRepo(octokit!, smallRepo);
      engine.resetAbort();
      await engine.collectRepo(octokit!, bigRepo);

      // Verify counts are isolated
      const smallCounts = getRepoItemCounts(1);
      const bigCounts = getRepoItemCounts(2);

      expect(smallCounts.commits).toBe(2);
      expect(bigCounts.commits).toBe(50);

      // Verify total in DB is 52, not mixed
      const allCommits = testDb.select().from(schema.commits).all();
      expect(allCommits).toHaveLength(52);
    });

    it('already-complete repo is skipped on re-collection — no API calls made', async () => {
      const now = new Date();
      const recentDate = now.toISOString();
      const { upsertCollectionState: upsert } = await import('../services/collection-state.js');
      const { startOfMonth: som, subMonths: sm } = await import('date-fns');

      const depthBoundary = som(sm(now, 0)); // current month start

      // Mark small repo as already complete with reverse direction
      upsert(1, 'commits', {
        status: 'complete',
        direction: 'reverse',
        oldestMonthCollected: depthBoundary.toISOString(),
        depthTarget: depthBoundary.toISOString(),
      });
      upsert(1, 'pull_requests', {
        status: 'complete',
        direction: 'reverse',
        depthTarget: depthBoundary.toISOString(),
      });

      const octokit = createPerRepoMockOctokit({
        'small-repo': { commitPages: [[makeCommit('s1', 'alice', recentDate)]], prPages: [] },
        'big-repo': { commitPages: [], prPages: [] },
      });

      // Collect the already-complete small repo
      await engine.collectRepo(octokit!, smallRepo, { depthBoundary });

      // Should NOT have called the API iterator for the small repo
      const iteratorCalls = (octokit!.paginate.iterator as ReturnType<typeof vi.fn>).mock.calls;
      const smallRepoCalls = iteratorCalls.filter(
        (c: unknown[]) => (c[1] as Record<string, unknown>).repo === 'small-repo'
      );
      expect(smallRepoCalls).toHaveLength(0);

      // State should still be complete
      const commitState = getCollectionState(1, 'commits');
      expect(commitState!.status).toBe('complete');
      const prState = getCollectionState(1, 'pull_requests');
      expect(prState!.status).toBe('complete');
    });

    it('complete repo IS re-fetched when depth expands', async () => {
      const now = new Date();
      const recentDate = now.toISOString();
      const { upsertCollectionState: upsert } = await import('../services/collection-state.js');
      const { startOfMonth: som, subMonths: sm } = await import('date-fns');

      const oldBoundary = som(now); // current month only
      const newBoundary = som(sm(now, 2)); // 3 months back

      // Mark as complete at depth=1
      upsert(1, 'commits', {
        status: 'complete',
        direction: 'reverse',
        oldestMonthCollected: oldBoundary.toISOString(),
        depthTarget: oldBoundary.toISOString(),
      });
      upsert(1, 'pull_requests', {
        status: 'complete',
        direction: 'reverse',
        depthTarget: oldBoundary.toISOString(),
      });

      const octokit = createPerRepoMockOctokit({
        'small-repo': { commitPages: [[makeCommit('s1', 'alice', recentDate)]], prPages: [] },
      });

      // Re-collect with expanded depth
      await engine.collectRepo(octokit!, smallRepo, { depthBoundary: newBoundary });

      // SHOULD have called the API since depth expanded
      const iteratorCalls = (octokit!.paginate.iterator as ReturnType<typeof vi.fn>).mock.calls;
      expect(iteratorCalls.length).toBeGreaterThan(0);
    });

    it('progress events include correct repoId — no cross-repo leaking', async () => {
      const now = new Date();
      const recentDate = now.toISOString();

      const octokit = createPerRepoMockOctokit({
        'small-repo': { commitPages: [[makeCommit('s1', 'alice', recentDate)]], prPages: [] },
        'big-repo': { commitPages: [[makeCommit('b1', 'bob', recentDate)]], prPages: [] },
      });

      const events: Array<{ type: string; repoId: number }> = [];
      engine.addProgressListener((e) => events.push({ type: e.type, repoId: e.repoId }));

      await engine.collectRepo(octokit!, smallRepo);
      engine.resetAbort();
      await engine.collectRepo(octokit!, bigRepo);

      // All events for small repo should have repoId=1
      const smallEvents = events.filter(e => e.repoId === 1);
      const bigEvents = events.filter(e => e.repoId === 2);

      expect(smallEvents.length).toBeGreaterThan(0);
      expect(bigEvents.length).toBeGreaterThan(0);

      // No events should have the wrong repoId
      expect(smallEvents.every(e => e.repoId === 1)).toBe(true);
      expect(bigEvents.every(e => e.repoId === 2)).toBe(true);
    });
  });
});
