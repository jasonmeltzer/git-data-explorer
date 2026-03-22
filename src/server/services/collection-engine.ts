import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { eq, sql, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { commits, pullRequests, authors } from '../db/schema.js';
import { readToken } from './token.js';
import {
  upsertCollectionState,
  getCollectionState,
  markCollectionPaused,
  markCollectionComplete,
} from './collection-state.js';
import { isBot } from './bot-detection.js';
import type { CollectionProgressEvent } from '../../shared/types.js';

/**
 * Custom error thrown when GitHub rate limit is hit during collection.
 * Allows the collection loop to stop cleanly at a page boundary.
 */
export class RateLimitError extends Error {
  retryAfter: number;
  isSecondary: boolean;

  constructor(retryAfter: number, isSecondary: boolean) {
    super(`Rate limit hit — retry after ${retryAfter}s${isSecondary ? ' (secondary)' : ''}`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.isSecondary = isSecondary;
  }
}

const CollectionOctokit = Octokit.plugin(throttling);

/**
 * Create a collection-specific Octokit that throws RateLimitError on rate limits
 * instead of retrying silently. This lets the collection engine handle pause/resume.
 */
export function createCollectionOctokit(): InstanceType<typeof CollectionOctokit> | null {
  const token = readToken();
  if (!token) return null;

  return new CollectionOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, _options: { method: string; url: string }, _octokit: unknown, _retryCount: number) => {
        throw new RateLimitError(retryAfter, false);
      },
      onSecondaryRateLimit: (retryAfter: number, _options: { method: string; url: string }) => {
        const effectiveRetry = Math.max(retryAfter || 60, 60);
        throw new RateLimitError(effectiveRetry, true);
      },
    },
  });
}

type OctokitInstance = InstanceType<typeof CollectionOctokit>;

interface RepoInfo {
  id: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  defaultBranch: string;
}

/**
 * Upsert an author into the authors table.
 * Returns the author's DB id.
 */
function upsertAuthor(
  login: string,
  name: string | null,
  userType: string | null,
  commitDate: Date
): number {
  const bot = isBot(login, userType);

  db.insert(authors)
    .values({
      githubLogin: login,
      name: name ?? null,
      isBot: bot,
      firstCommitAt: commitDate,
    })
    .onConflictDoUpdate({
      target: authors.githubLogin,
      set: {
        name: sql`COALESCE(excluded.name, ${authors.name})`,
        isBot: bot,
        firstCommitAt: sql`MIN(${authors.firstCommitAt}, excluded.first_commit_at)`,
      },
    })
    .run();

  const row = db
    .select({ id: authors.id })
    .from(authors)
    .where(eq(authors.githubLogin, login))
    .get();
  return row!.id;
}

/**
 * Core collection engine that fetches GitHub commits and PRs for a repo,
 * checkpoints after each page, handles rate limits, and supports abort.
 */
export class CollectionEngine {
  private _listeners: Set<(event: CollectionProgressEvent) => void> = new Set();
  private _aborted: boolean = false;
  private _rateLimitResetAt: Date | null = null;
  private _rateLimitWaitTimer: NodeJS.Timeout | null = null;
  private _onResume: (() => void) | null = null;

  addProgressListener(fn: (event: CollectionProgressEvent) => void): void {
    this._listeners.add(fn);
  }

  removeProgressListener(fn: (event: CollectionProgressEvent) => void): void {
    this._listeners.delete(fn);
  }

  emitProgress(event: CollectionProgressEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break collection
      }
    }
  }

  abort(): void {
    this._aborted = true;
    if (this._rateLimitWaitTimer) {
      clearTimeout(this._rateLimitWaitTimer);
      this._rateLimitWaitTimer = null;
    }
  }

  isAborted(): boolean {
    return this._aborted;
  }

  resetAbort(): void {
    this._aborted = false;
  }

  get rateLimitResetAt(): Date | null {
    return this._rateLimitResetAt;
  }

  /**
   * Set the callback to invoke when rate-limit auto-resume fires.
   */
  setOnResume(fn: (() => void) | null): void {
    this._onResume = fn;
  }

  /**
   * Schedule auto-resume after a rate-limit pause (D-14).
   */
  private scheduleResume(retryAfterMs: number): void {
    if (this._rateLimitWaitTimer) {
      clearTimeout(this._rateLimitWaitTimer);
    }
    this._rateLimitWaitTimer = setTimeout(() => {
      this._rateLimitWaitTimer = null;
      this._rateLimitResetAt = null;
      if (this._onResume) {
        this._onResume();
      }
    }, retryAfterMs);
  }

  /**
   * Collect all commits and PRs for a single repo.
   * Emits progress events throughout. Checkpoints after each page.
   */
  async collectRepo(octokit: OctokitInstance, repo: RepoInfo): Promise<void> {
    this.emitProgress({
      type: 'repo_start',
      repoId: repo.id,
      repoFullName: repo.fullName,
    });

    try {
      await this.collectCommits(octokit, repo);
      await this.collectPRs(octokit, repo);

      this.emitProgress({
        type: 'repo_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        const resetAt = new Date(Date.now() + err.retryAfter * 1000);
        this._rateLimitResetAt = resetAt;

        // Mark both resources as paused
        markCollectionPaused(repo.id, 'commits', err.message, resetAt.toISOString());
        markCollectionPaused(repo.id, 'pull_requests', err.message, resetAt.toISOString());

        this.emitProgress({
          type: err.isSecondary ? 'secondary_rate_limit' : 'rate_limit',
          repoId: repo.id,
          repoFullName: repo.fullName,
          rateLimitResetAt: resetAt.toISOString(),
          errorMessage: err.message,
        });

        // Schedule auto-resume (D-14)
        const retryMs = err.isSecondary
          ? Math.max(err.retryAfter, 60) * 1000 + 2000 // 60s minimum + 2s buffer for secondary
          : err.retryAfter * 1000 + 2000; // retry-after + 2s buffer for primary
        this.scheduleResume(retryMs);

        // Re-throw so the queue knows this repo was rate-limited
        throw err;
      }

      // Non-rate-limit error
      const errorMessage = err instanceof Error ? err.message : String(err);
      upsertCollectionState(repo.id, 'commits', { status: 'error', errorMessage });
      upsertCollectionState(repo.id, 'pull_requests', { status: 'error', errorMessage });

      this.emitProgress({
        type: 'error',
        repoId: repo.id,
        repoFullName: repo.fullName,
        errorMessage,
      });
    }
  }

  /**
   * Fetch commits page-by-page using paginate.iterator (D-07: raw /commits endpoint).
   * Checkpoints after each page. Supports incremental collection via cursor (since param).
   */
  private async collectCommits(octokit: OctokitInstance, repo: RepoInfo): Promise<void> {
    const existing = getCollectionState(repo.id, 'commits');
    const cursor = existing?.cursor ?? null;

    const params: Record<string, unknown> = {
      owner: repo.ownerLogin,
      repo: repo.name,
      per_page: 100,
    };
    if (cursor) {
      params.since = cursor;
    }

    let pageNumber = existing?.lastPage ?? 0;
    let totalItems = 0;

    const iterator = octokit.paginate.iterator(
      octokit.rest.repos.listCommits,
      params as Parameters<typeof octokit.rest.repos.listCommits>[0]
    );

    for await (const response of iterator) {
      if (this._aborted) {
        // Checkpoint current progress and return
        if (totalItems > 0) {
          upsertCollectionState(repo.id, 'commits', {
            cursor: cursor ?? undefined,
            status: 'paused',
            lastPage: pageNumber,
          });
        }
        return;
      }

      pageNumber++;
      const page = response.data;

      if (page.length === 0) break;

      // Check if we need individual stats fetches
      let needsIndividualStats = false;
      const firstCommit = page[0] as Record<string, unknown>;
      if (!(firstCommit as { stats?: unknown }).stats) {
        needsIndividualStats = true;
      }

      let lastCommitDate: string | undefined;

      for (const commit of page) {
        const commitData = commit as Record<string, unknown>;
        const commitMeta = commitData.commit as { author?: { name?: string; date?: string }; message?: string } | undefined;
        const authorData = commitData.author as { login?: string; type?: string } | null;

        const login = authorData?.login ?? commitMeta?.author?.name ?? 'unknown';
        const authorName = commitMeta?.author?.name ?? null;
        const userType = authorData?.type ?? null;
        const dateStr = commitMeta?.author?.date ?? new Date().toISOString();
        const commitDate = new Date(dateStr);
        const sha = commitData.sha as string;
        const message = commitMeta?.message ?? '';

        const authorId = upsertAuthor(login, authorName, userType, commitDate);

        let linesAdded = 0;
        let linesDeleted = 0;
        let filesChanged = 0;

        const stats = (commitData as { stats?: { additions?: number; deletions?: number; total?: number } }).stats;
        const files = (commitData as { files?: Array<unknown> }).files;

        if (stats) {
          linesAdded = stats.additions ?? 0;
          linesDeleted = stats.deletions ?? 0;
          filesChanged = files?.length ?? 0;
        } else if (needsIndividualStats) {
          try {
            const detail = await octokit.rest.repos.getCommit({
              owner: repo.ownerLogin,
              repo: repo.name,
              ref: sha,
            });
            const detailData = detail.data as Record<string, unknown>;
            const detailStats = (detailData as { stats?: { additions?: number; deletions?: number } }).stats;
            const detailFiles = (detailData as { files?: Array<unknown> }).files;
            linesAdded = detailStats?.additions ?? 0;
            linesDeleted = detailStats?.deletions ?? 0;
            filesChanged = detailFiles?.length ?? 0;
          } catch {
            // If individual fetch fails, continue with zeros
          }
        }

        // Upsert commit — dedup on (sha, repoId) via unique index
        db.insert(commits)
          .values({
            sha,
            repoId: repo.id,
            authorId,
            message,
            committedAt: commitDate,
            linesAdded,
            linesDeleted,
            filesChanged,
          })
          .onConflictDoUpdate({
            target: [commits.sha, commits.repoId],
            set: {
              linesAdded: sql`CASE WHEN ${commits.linesAdded} = 0 THEN excluded.lines_added ELSE ${commits.linesAdded} END`,
              linesDeleted: sql`CASE WHEN ${commits.linesDeleted} = 0 THEN excluded.lines_deleted ELSE ${commits.linesDeleted} END`,
              filesChanged: sql`CASE WHEN ${commits.filesChanged} = 0 THEN excluded.files_changed ELSE ${commits.filesChanged} END`,
              authorId,
            },
          })
          .run();

        lastCommitDate = dateStr;
      }

      // Checkpoint after writing page
      upsertCollectionState(repo.id, 'commits', {
        cursor: lastCommitDate,
        status: 'in_progress',
        lastPage: pageNumber,
      });

      totalItems += page.length;

      this.emitProgress({
        type: 'page_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
        resourceType: 'commits',
        itemsInPage: page.length,
        totalItemsSoFar: totalItems,
      });
    }

    markCollectionComplete(repo.id, 'commits');
  }

  /**
   * Fetch PRs page-by-page. Fetches individual PR details for stats.
   * Supports incremental collection via cursor (updated_at comparison).
   */
  private async collectPRs(octokit: OctokitInstance, repo: RepoInfo): Promise<void> {
    const existing = getCollectionState(repo.id, 'pull_requests');
    const cursor = existing?.cursor ?? null;

    let pageNumber = existing?.lastPage ?? 0;
    let totalItems = 0;

    const iterator = octokit.paginate.iterator(
      octokit.rest.pulls.list,
      {
        owner: repo.ownerLogin,
        repo: repo.name,
        state: 'all',
        sort: 'updated',
        direction: 'asc',
        per_page: 100,
      }
    );

    for await (const response of iterator) {
      if (this._aborted) {
        upsertCollectionState(repo.id, 'pull_requests', {
          cursor: cursor ?? undefined,
          status: 'paused',
          lastPage: pageNumber,
        });
        return;
      }

      pageNumber++;
      const page = response.data;

      if (page.length === 0) break;

      let allSkipped = true;
      let lastUpdatedAt: string | undefined;

      for (const pr of page) {
        const prData = pr as Record<string, unknown>;
        const updatedAt = prData.updated_at as string;

        // Skip PRs we've already seen (cursor-based incremental)
        if (cursor && updatedAt <= cursor) {
          continue;
        }

        allSkipped = false;

        // Fetch full PR details for stats
        const prNumber = prData.number as number;
        let linesAdded = 0;
        let linesDeleted = 0;
        let filesChanged = 0;
        let commitCount = 0;

        try {
          const detail = await octokit.rest.pulls.get({
            owner: repo.ownerLogin,
            repo: repo.name,
            pull_number: prNumber,
          });
          const detailData = detail.data as Record<string, unknown>;
          linesAdded = (detailData.additions as number) ?? 0;
          linesDeleted = (detailData.deletions as number) ?? 0;
          filesChanged = (detailData.changed_files as number) ?? 0;
          commitCount = (detailData.commits as number) ?? 0;
        } catch {
          // Continue with zeros if individual fetch fails
        }

        const user = prData.user as { login?: string; type?: string } | null;
        const login = user?.login ?? 'unknown';
        const userType = user?.type ?? null;
        const createdAt = new Date(prData.created_at as string);

        const authorId = upsertAuthor(login, null, userType, createdAt);

        const githubId = prData.id as number;
        const title = prData.title as string;
        const state = prData.state as string;
        const mergedAt = prData.merged_at ? new Date(prData.merged_at as string) : null;
        const closedAt = prData.closed_at ? new Date(prData.closed_at as string) : null;

        // Upsert PR — dedup on (githubId, repoId)
        db.insert(pullRequests)
          .values({
            githubId,
            repoId: repo.id,
            authorId,
            number: prNumber,
            title,
            state,
            createdAt,
            mergedAt,
            closedAt,
            updatedAt: new Date(updatedAt),
            linesAdded,
            linesDeleted,
            filesChanged,
            commitCount,
          })
          .onConflictDoUpdate({
            target: [pullRequests.githubId, pullRequests.repoId],
            set: {
              title,
              state,
              mergedAt,
              closedAt,
              updatedAt: new Date(updatedAt),
              linesAdded,
              linesDeleted,
              filesChanged,
              commitCount,
              authorId,
            },
          })
          .run();

        lastUpdatedAt = updatedAt;
      }

      // If all PRs in page were skipped (all <= cursor), stop pagination
      if (allSkipped) {
        break;
      }

      // Checkpoint after writing page
      upsertCollectionState(repo.id, 'pull_requests', {
        cursor: lastUpdatedAt,
        status: 'in_progress',
        lastPage: pageNumber,
      });

      totalItems += page.filter((pr) => {
        if (!cursor) return true;
        return (pr as Record<string, unknown>).updated_at as string > cursor;
      }).length;

      this.emitProgress({
        type: 'page_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
        resourceType: 'pull_requests',
        itemsInPage: page.length,
        totalItemsSoFar: totalItems,
      });
    }

    markCollectionComplete(repo.id, 'pull_requests');
  }
}
